#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
use auto_launch::AutoLaunchBuilder;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::net::SocketAddr;
use std::process::Command;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{
  AppHandle, CustomMenuItem, Manager, State, SystemTray, SystemTrayEvent, SystemTrayMenu,
  SystemTrayMenuItem, Window, WindowEvent,
};
use tokio::net::lookup_host;
use tokio::time::timeout;
use trust_dns_resolver::config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts};
use trust_dns_resolver::TokioAsyncResolver;
use surge_ping::{Client as PingClient, Config as PingConfig, ICMP, PingIdentifier, PingSequence};

const GITHUB_REPO: &str = "SM8KE1/PulseNet";
const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/SM8KE1/PulseNet/releases/latest";

const CLOUDFLARE_BASE: &str = "https://speed.cloudflare.com";
const DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;
const UPLOAD_BYTES: usize = 5 * 1024 * 1024;
const PING_SAMPLES: usize = 5;
const DNS_TIMEOUT_MS: u64 = 4000;

const DNS_SERVERS: [&str; 8] = [
  "8.8.8.8",
  "8.8.4.4",
  "1.1.1.1",
  "1.0.0.1",
  "9.9.9.9",
  "149.112.112.112",
  "208.67.222.222",
  "208.67.220.220",
];

struct AppState {
  close_action: Mutex<String>,
}

impl Default for AppState {
  fn default() -> Self {
    Self {
      close_action: Mutex::new("ask".to_string()),
    }
  }
}

#[derive(Serialize)]
struct PingResponse {
  alive: bool,
  time: Option<f64>,
  error: Option<String>,
}

#[derive(Serialize)]
struct DnsResult {
  server: String,
  status: bool,
  #[serde(rename = "responseTimeMs")]
  response_time_ms: u128,
  error: Option<String>,
}

#[derive(Serialize)]
struct DnsResponse {
  error: Option<String>,
  results: Vec<DnsResult>,
}

#[derive(Serialize)]
struct SpeedTestResult {
  #[serde(rename = "downloadMbps")]
  download_mbps: f64,
  #[serde(rename = "uploadMbps")]
  upload_mbps: f64,
  #[serde(rename = "latencyMs")]
  latency_ms: f64,
  #[serde(rename = "jitterMs")]
  jitter_ms: f64,
  ip: String,
  country: String,
  error: Option<String>,
}

#[derive(Serialize)]
struct UpdateCheckResult {
  #[serde(rename = "currentVersion")]
  current_version: String,
  #[serde(rename = "latestVersion")]
  latest_version: String,
  #[serde(rename = "updateAvailable")]
  update_available: bool,
  url: String,
  error: Option<String>,
}

#[derive(Deserialize, Serialize)]
struct AutoLaunchPref {
  enabled: bool,
}

fn auto_launch_config_path(app: &tauri::AppHandle) -> PathBuf {
  if let Some(dir) = app.path_resolver().app_config_dir() {
    return dir.join("auto-launch.json");
  }
  PathBuf::from("auto-launch.json")
}

#[cfg(not(target_os = "windows"))]
fn read_auto_launch_pref(app: &tauri::AppHandle) -> Option<bool> {
  let path = auto_launch_config_path(app);
  let raw = fs::read_to_string(path).ok()?;
  let parsed: AutoLaunchPref = serde_json::from_str(&raw).ok()?;
  Some(parsed.enabled)
}

fn write_auto_launch_pref(app: &tauri::AppHandle, enabled: bool) {
  let path = auto_launch_config_path(app);
  if let Some(parent) = path.parent() {
    let _ = fs::create_dir_all(parent);
  }
  let data = AutoLaunchPref { enabled };
  let _ = fs::write(path, serde_json::to_vec(&data).unwrap_or_default());
}

#[cfg(not(target_os = "windows"))]
fn auto_launcher() -> auto_launch::AutoLaunch {
  let app_path = env::current_exe()
    .ok()
    .and_then(|path| path.to_str().map(|s| s.to_string()))
    .unwrap_or_default();
  AutoLaunchBuilder::new()
    .set_app_name("PulseNet")
    .set_app_path(&app_path)
    .build()
    .unwrap()
}

#[cfg(target_os = "windows")]
fn auto_launch_task_name() -> &'static str {
  "PulseNet"
}

#[cfg(target_os = "windows")]
fn is_auto_launch_enabled() -> bool {
  Command::new("schtasks")
    .args(["/Query", "/TN", auto_launch_task_name()])
    .status()
    .map(|status| status.success())
    .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn set_auto_launch_enabled(enabled: bool) -> bool {
  let app_path = env::current_exe()
    .ok()
    .and_then(|path| path.to_str().map(|s| s.to_string()))
    .unwrap_or_default();
  if app_path.is_empty() {
    return false;
  }

  if enabled {
    Command::new("schtasks")
      .args([
        "/Create",
        "/F",
        "/RL",
        "HIGHEST",
        "/SC",
        "ONLOGON",
        "/TN",
        auto_launch_task_name(),
        "/TR",
        &format!("\"{}\"", app_path),
      ])
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  } else {
    Command::new("schtasks")
      .args(["/Delete", "/TN", auto_launch_task_name(), "/F"])
      .status()
      .map(|status| status.success())
      .unwrap_or(false)
  }
}

fn sanitize_domain(input: &str) -> String {
  input
    .trim()
    .trim_start_matches("https://")
    .trim_start_matches("http://")
    .split('/')
    .next()
    .unwrap_or("")
    .split('?')
    .next()
    .unwrap_or("")
    .split('#')
    .next()
    .unwrap_or("")
    .to_string()
}

#[tauri::command]
async fn ping_host(host: String) -> PingResponse {
  let host_addr = match lookup_host(format!("{}:0", host)).await {
    Ok(mut addrs) => addrs.next(),
    Err(error) => {
      return PingResponse {
        alive: false,
        time: None,
        error: Some(error.to_string()),
      }
    }
  };

  let addr = match host_addr {
    Some(addr) => addr,
    None => {
      return PingResponse {
        alive: false,
        time: None,
        error: Some("Unable to resolve host".to_string()),
      }
    }
  };

  let mut config_builder = PingConfig::builder();
  if addr.is_ipv6() {
    config_builder = config_builder.kind(ICMP::V6);
  }
  let config = config_builder.build();
  let client = match PingClient::new(&config) {
    Ok(client) => client,
    Err(error) => {
      return PingResponse {
        alive: false,
        time: None,
        error: Some(error.to_string()),
      }
    }
  };

  let identifier = PingIdentifier((std::process::id() & 0xffff) as u16);
  let mut pinger = client.pinger(addr.ip(), identifier).await;
  if let SocketAddr::V6(v6_addr) = addr {
    pinger.scope_id(v6_addr.scope_id());
  }
  pinger.timeout(Duration::from_secs(2));

  let payload = vec![0u8; 32];
  let result = timeout(Duration::from_secs(2), pinger.ping(PingSequence(0), &payload)).await;
  match result {
    Ok(Ok((_packet, rtt))) => PingResponse {
      alive: true,
      time: Some(rtt.as_secs_f64() * 1000.0),
      error: None,
    },
    Ok(Err(error)) => PingResponse {
      alive: false,
      time: None,
      error: Some(error.to_string()),
    },
    Err(_) => PingResponse {
      alive: false,
      time: None,
      error: Some("timeout".to_string()),
    },
  }
}

#[tauri::command]
fn get_app_version(app: tauri::AppHandle) -> String {
  app.package_info().version.to_string()
}

#[tauri::command]
fn get_username() -> String {
  env::var("USERNAME")
    .or_else(|_| env::var("USER"))
    .unwrap_or_else(|_| "User".to_string())
}

#[tauri::command]
fn get_auto_launch(_app: tauri::AppHandle) -> bool {
  #[cfg(target_os = "windows")]
  {
    return is_auto_launch_enabled();
  }

  #[cfg(not(target_os = "windows"))]
  {
    read_auto_launch_pref(&_app).unwrap_or(false)
  }
}

#[tauri::command]
fn set_auto_launch(app: tauri::AppHandle, enabled: bool) -> bool {
  write_auto_launch_pref(&app, enabled);
  #[cfg(target_os = "windows")]
  {
    return set_auto_launch_enabled(enabled);
  }

  #[cfg(not(target_os = "windows"))]
  {
    let launcher = auto_launcher();
    let _ = if enabled { launcher.enable() } else { launcher.disable() };
    launcher.is_enabled().unwrap_or(false)
  }
}

#[tauri::command]
fn get_close_action(state: State<AppState>) -> String {
  state
    .close_action
    .lock()
    .map(|guard| guard.clone())
    .unwrap_or_else(|_| "ask".to_string())
}

#[tauri::command]
fn set_close_action(state: State<AppState>, action: String) -> String {
  if ["hide", "exit", "ask"].contains(&action.as_str()) {
    if let Ok(mut guard) = state.close_action.lock() {
      *guard = action;
    }
  }
  state
    .close_action
    .lock()
    .map(|guard| guard.clone())
    .unwrap_or_else(|_| "ask".to_string())
}

#[tauri::command]
fn perform_close_action(action: String, window: Window) -> bool {
  match action.as_str() {
    "exit" => {
      window.app_handle().exit(0);
    }
    "hide" => {
      let _ = window.hide();
    }
    "minimize" => {
      let _ = window.minimize();
    }
    _ => {}
  }
  true
}

#[tauri::command]
async fn test_dns_servers(domain: String) -> DnsResponse {
  let sanitized = sanitize_domain(&domain);
  if sanitized.is_empty() {
    return DnsResponse {
      error: Some("invalid-domain".to_string()),
      results: vec![],
    };
  }
  let mut results = Vec::new();
  for server in DNS_SERVERS {
    let start = Instant::now();
    let socket_addr = format!("{}:53", server);
    let socket_addr = socket_addr.parse().ok();
    if socket_addr.is_none() {
      results.push(DnsResult {
        server: server.to_string(),
        status: false,
        response_time_ms: start.elapsed().as_millis(),
        error: Some("invalid-server".to_string()),
      });
      continue;
    }
    let mut resolver_config = ResolverConfig::new();
    let name_server = NameServerConfig {
      socket_addr: socket_addr.unwrap(),
      protocol: Protocol::Udp,
      tls_dns_name: None,
      trust_negative_responses: false,
      bind_addr: None,
    };
    resolver_config.add_name_server(name_server);
    let mut opts = ResolverOpts::default();
    opts.timeout = Duration::from_millis(DNS_TIMEOUT_MS);

    let resolver = TokioAsyncResolver::tokio(resolver_config, opts);
    let lookup = timeout(Duration::from_millis(DNS_TIMEOUT_MS), resolver.lookup_ip(sanitized.clone())).await;
    match lookup {
      Ok(Ok(_)) => results.push(DnsResult {
        server: server.to_string(),
        status: true,
        response_time_ms: start.elapsed().as_millis(),
        error: None,
      }),
      Ok(Err(err)) => results.push(DnsResult {
        server: server.to_string(),
        status: false,
        response_time_ms: start.elapsed().as_millis(),
        error: Some(err.to_string()),
      }),
      Err(_) => results.push(DnsResult {
        server: server.to_string(),
        status: false,
        response_time_ms: start.elapsed().as_millis(),
        error: Some("timeout".to_string()),
      }),
    }
  }

  DnsResponse { error: None, results }
}

async fn measure_ping(client: &HttpClient) -> (f64, f64) {
  let mut samples = Vec::new();
  for _ in 0..PING_SAMPLES {
    let start = Instant::now();
    let _ = client.get(format!("{}/__ping", CLOUDFLARE_BASE)).send().await;
    samples.push(start.elapsed().as_secs_f64() * 1000.0);
  }
  let avg = samples.iter().sum::<f64>() / samples.len().max(1) as f64;
  let mut jitter = 0.0;
  if samples.len() > 1 {
    let mut sum = 0.0;
    for idx in 1..samples.len() {
      sum += (samples[idx] - samples[idx - 1]).abs();
    }
    jitter = sum / (samples.len() - 1) as f64;
  }
  (avg, jitter)
}

async fn measure_download(client: &HttpClient) -> f64 {
  let start = Instant::now();
  let response = client
    .get(format!("{}/__down?bytes={}", CLOUDFLARE_BASE, DOWNLOAD_BYTES))
    .send()
    .await;
  if response.is_err() {
    return 0.0;
  }
  let bytes = response.unwrap().bytes().await.unwrap_or_default();
  let duration = start.elapsed().as_secs_f64();
  if duration == 0.0 {
    return 0.0;
  }
  (bytes.len() as f64 * 8.0) / duration / 1_000_000.0
}

async fn measure_upload(client: &HttpClient) -> f64 {
  let payload = vec![0u8; UPLOAD_BYTES];
  let start = Instant::now();
  let response = client
    .post(format!("{}/__up", CLOUDFLARE_BASE))
    .body(payload)
    .send()
    .await;
  if response.is_err() {
    return 0.0;
  }
  let duration = start.elapsed().as_secs_f64();
  if duration == 0.0 {
    return 0.0;
  }
  (UPLOAD_BYTES as f64 * 8.0) / duration / 1_000_000.0
}

fn extract_ip_from_trace(body: &str) -> Option<String> {
  for line in body.lines() {
    if let Some(value) = line.strip_prefix("ip=") {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
    }
  }
  None
}

fn extract_country_from_trace(body: &str) -> Option<String> {
  for line in body.lines() {
    if let Some(value) = line.strip_prefix("loc=") {
      let trimmed = value.trim();
      if !trimmed.is_empty() {
        return Some(trimmed.to_string());
      }
    }
  }
  None
}

#[tauri::command]
async fn speedtest_cloudflare() -> SpeedTestResult {
  let client = HttpClient::new();
  let (latency, jitter) = measure_ping(&client).await;
  let download = measure_download(&client).await;
  let upload = measure_upload(&client).await;
  let (ip, country) = match client
    .get(format!("{}/cdn-cgi/trace", CLOUDFLARE_BASE))
    .header("User-Agent", "PulseNet")
    .send()
    .await
  {
    Ok(resp) => {
      let body = resp.text().await.unwrap_or_default();
      let ip = extract_ip_from_trace(&body).unwrap_or_else(|| "N/A".to_string());
      let country = extract_country_from_trace(&body).unwrap_or_else(|| "N/A".to_string());
      (ip, country)
    }
    Err(_) => ("N/A".to_string(), "N/A".to_string()),
  };

  SpeedTestResult {
    download_mbps: (download * 100.0).round() / 100.0,
    upload_mbps: (upload * 100.0).round() / 100.0,
    latency_ms: (latency * 100.0).round() / 100.0,
    jitter_ms: (jitter * 100.0).round() / 100.0,
    ip,
    country,
    error: None,
  }
}

fn parse_version_parts(version: &str) -> Vec<u64> {
  version
    .trim_start_matches('v')
    .split('.')
    .map(|part| part.parse::<u64>().unwrap_or(0))
    .collect()
}

fn is_newer_version(latest: &str, current: &str) -> bool {
  let latest_parts = parse_version_parts(latest);
  let current_parts = parse_version_parts(current);
  let max_len = latest_parts.len().max(current_parts.len());
  for idx in 0..max_len {
    let left = *latest_parts.get(idx).unwrap_or(&0);
    let right = *current_parts.get(idx).unwrap_or(&0);
    if left > right {
      return true;
    }
    if left < right {
      return false;
    }
  }
  false
}

#[tauri::command]
async fn check_for_updates() -> UpdateCheckResult {
  let client = HttpClient::new();
  let response = client
    .get(GITHUB_RELEASES_URL)
    .header("User-Agent", "PulseNet")
    .send()
    .await;

  let current_version = env!("CARGO_PKG_VERSION").to_string();
  if response.is_err() {
    return UpdateCheckResult {
      current_version,
      latest_version: String::new(),
      update_available: false,
      url: format!("https://github.com/{}/releases/latest", GITHUB_REPO),
      error: Some("update-check-failed".to_string()),
    };
  }
  let json = response.unwrap().json::<serde_json::Value>().await;
  if json.is_err() {
    return UpdateCheckResult {
      current_version,
      latest_version: String::new(),
      update_available: false,
      url: format!("https://github.com/{}/releases/latest", GITHUB_REPO),
      error: Some("invalid-response".to_string()),
    };
  }
  let data = json.unwrap();
  let latest = data
    .get("tag_name")
    .and_then(|value| value.as_str())
    .unwrap_or("")
    .trim_start_matches('v')
    .to_string();
  let update_available = !latest.is_empty() && is_newer_version(&latest, &current_version);
  let url = data
    .get("html_url")
    .and_then(|value| value.as_str())
    .unwrap_or(&format!("https://github.com/{}/releases/latest", GITHUB_REPO))
    .to_string();

  UpdateCheckResult {
    current_version,
    latest_version: latest,
    update_available,
    url,
    error: None,
  }
}

fn handle_close_requested(window: &Window, state: &State<AppState>) {
  let action = state
    .close_action
    .lock()
    .map(|guard| guard.clone())
    .unwrap_or_else(|_| "ask".to_string());

  if action == "exit" {
    window.app_handle().exit(0);
    return;
  }
  if action == "hide" {
    let _ = window.hide();
    return;
  }
  let _ = window.emit("close-requested", serde_json::json!({ "reason": "close" }));
}

fn show_main_window(app: &AppHandle) {
  if let Some(window) = app.get_window("main") {
    let _ = window.show();
    let _ = window.unminimize();
    let _ = window.set_focus();
  }
}

fn main() {
  let tray_menu = SystemTrayMenu::new()
    .add_item(CustomMenuItem::new("show".to_string(), "Show PulseNet"))
    .add_item(CustomMenuItem::new("settings".to_string(), "Settings"))
    .add_native_item(SystemTrayMenuItem::Separator)
    .add_item(CustomMenuItem::new("restart".to_string(), "Restart PulseNet"))
    .add_item(CustomMenuItem::new("exit".to_string(), "Exit"));

  tauri::Builder::default()
    .manage(AppState::default())
    .system_tray(SystemTray::new().with_menu(tray_menu))
    .on_system_tray_event(|app, event| {
      match event {
        SystemTrayEvent::LeftClick { .. } => {
          show_main_window(app);
        }
        SystemTrayEvent::MenuItemClick { id, .. } => match id.as_str() {
          "show" => show_main_window(app),
          "settings" => {
            show_main_window(app);
            if let Some(window) = app.get_window("main") {
              let _ = window.emit("tray-open-page", serde_json::json!({ "page": "settings" }));
            }
          }
          "restart" => {
            app.restart();
          }
          "exit" => {
            app.exit(0);
          }
          _ => {}
        }
        _ => {}
      }
    })
    .on_window_event(|event| {
      if let WindowEvent::CloseRequested { api, .. } = event.event() {
        api.prevent_close();
        let window = event.window();
        let state: State<AppState> = window.state();
        handle_close_requested(&window, &state);
      }
    })
    .invoke_handler(tauri::generate_handler![
      ping_host,
      get_app_version,
      get_username,
      get_auto_launch,
      set_auto_launch,
      get_close_action,
      set_close_action,
      perform_close_action,
      test_dns_servers,
      speedtest_cloudflare,
      check_for_updates
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
