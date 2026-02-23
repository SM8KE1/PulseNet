#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
use auto_launch::AutoLaunchBuilder;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::path::PathBuf;
use std::net::SocketAddr;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
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
const GITHUB_RELEASES_LIST_URL: &str = "https://api.github.com/repos/SM8KE1/PulseNet/releases?per_page=20";

const CLOUDFLARE_BASE: &str = "https://speed.cloudflare.com";
const HETZNER_DOWNLOAD_URL: &str = "https://speed.hetzner.de/10MB.bin";
const HETZNER_UPLOAD_URL: &str = "https://httpbin.org/post";
const IPWHOIS_URL: &str = "https://ipwho.is/";
const DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;
const UPLOAD_BYTES: usize = 5 * 1024 * 1024;
const PING_SAMPLES: usize = 5;
const DNS_TIMEOUT_MS: u64 = 4000;
const DNS_ADAPTER_CACHE_TTL_MS: u128 = 5000;
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

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

fn parse_dns_server_socket(server: &str) -> Option<SocketAddr> {
  let trimmed = server.trim();
  if trimmed.is_empty() {
    return None;
  }
  if let Ok(addr) = trimmed.parse::<SocketAddr>() {
    return Some(addr);
  }
  if let Ok(ipv4) = trimmed.parse::<std::net::Ipv4Addr>() {
    return Some(SocketAddr::new(std::net::IpAddr::V4(ipv4), 53));
  }
  if let Ok(ipv6) = trimmed.parse::<std::net::Ipv6Addr>() {
    return Some(SocketAddr::new(std::net::IpAddr::V6(ipv6), 53));
  }
  None
}

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

#[derive(Serialize, Clone)]
struct DnsAdapter {
  name: String,
  dns: Vec<String>,
}

#[derive(Serialize)]
struct DnsManagerResult {
  success: bool,
  error: Option<String>,
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
  #[serde(rename = "isPrerelease")]
  is_prerelease: bool,
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

fn now_millis() -> u128 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|duration| duration.as_millis())
    .unwrap_or(0)
}

#[cfg(target_os = "windows")]
fn dns_adapter_cache() -> &'static Mutex<Option<(u128, Vec<DnsAdapter>)>> {
  static CACHE: OnceLock<Mutex<Option<(u128, Vec<DnsAdapter>)>>> = OnceLock::new();
  CACHE.get_or_init(|| Mutex::new(None))
}

#[cfg(target_os = "windows")]
fn clear_dns_adapter_cache() {
  if let Ok(mut guard) = dns_adapter_cache().lock() {
    *guard = None;
  }
}

#[cfg(target_os = "windows")]
fn run_powershell(command: &str) -> Result<String, String> {
  let output = Command::new("powershell")
    .creation_flags(CREATE_NO_WINDOW)
    .args([
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-Command",
      command,
    ])
    .output()
    .map_err(|error| error.to_string())?;
  if output.status.success() {
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
  } else {
    Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
  }
}

fn ps_escape_single(value: &str) -> String {
  value.replace('\'', "''")
}

#[cfg(target_os = "windows")]
fn parse_dns_adapters_from_output(output: &str) -> Vec<DnsAdapter> {
  if output.is_empty() {
    return vec![];
  }
  let parsed = match serde_json::from_str::<serde_json::Value>(output) {
    Ok(value) => value,
    Err(_) => return vec![],
  };
  let mut adapters = Vec::new();
  let items = if let Some(array) = parsed.as_array() {
    array.clone()
  } else {
    vec![parsed]
  };
  for item in items {
    let name = item
      .get("InterfaceAlias")
      .and_then(|value| value.as_str())
      .unwrap_or("")
      .trim()
      .to_string();
    if name.is_empty() {
      continue;
    }
    let dns = item
      .get("ServerAddresses")
      .and_then(|value| value.as_array())
      .map(|values| {
        values
          .iter()
          .filter_map(|value| value.as_str().map(|s| s.trim().to_string()))
          .filter(|value| !value.is_empty())
          .collect::<Vec<String>>()
      })
      .unwrap_or_default();
    adapters.push(DnsAdapter { name, dns });
  }
  adapters.sort_by(|left, right| left.name.cmp(&right.name));
  adapters
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
  test_dns_servers_with_custom(domain, None).await
}

#[tauri::command]
async fn test_dns_servers_with_custom(domain: String, custom_servers: Option<Vec<String>>) -> DnsResponse {
  let sanitized = sanitize_domain(&domain);
  if sanitized.is_empty() {
    return DnsResponse {
      error: Some("invalid-domain".to_string()),
      results: vec![],
    };
  }
  let mut all_servers: Vec<String> = DNS_SERVERS.iter().map(|item| item.to_string()).collect();
  if let Some(custom) = custom_servers {
    for server in custom {
      let normalized = server.trim().to_string();
      if normalized.is_empty() {
        continue;
      }
      if !all_servers.contains(&normalized) {
        all_servers.push(normalized);
      }
    }
  }
  let mut results = Vec::new();
  for server in all_servers {
    let start = Instant::now();
    let socket_addr = parse_dns_server_socket(&server);
    if socket_addr.is_none() {
      results.push(DnsResult {
        server,
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
        server,
        status: true,
        response_time_ms: start.elapsed().as_millis(),
        error: None,
      }),
      Ok(Err(err)) => results.push(DnsResult {
        server,
        status: false,
        response_time_ms: start.elapsed().as_millis(),
        error: Some(err.to_string()),
      }),
      Err(_) => results.push(DnsResult {
        server,
        status: false,
        response_time_ms: start.elapsed().as_millis(),
        error: Some("timeout".to_string()),
      }),
    }
  }

  DnsResponse { error: None, results }
}

#[tauri::command]
fn list_dns_adapters(force_refresh: Option<bool>) -> Vec<DnsAdapter> {
  #[cfg(target_os = "windows")]
  {
    let force_refresh = force_refresh.unwrap_or(false);
    if !force_refresh {
      if let Ok(guard) = dns_adapter_cache().lock() {
        if let Some((cached_at, adapters)) = guard.as_ref() {
          if now_millis().saturating_sub(*cached_at) <= DNS_ADAPTER_CACHE_TTL_MS {
            return adapters.clone();
          }
        }
      }
    }

    let command = "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object InterfaceAlias,ServerAddresses | ConvertTo-Json -Depth 4 -Compress";
    let output = match run_powershell(command) {
      Ok(stdout) => stdout,
      Err(_) => return vec![],
    };
    let adapters = parse_dns_adapters_from_output(&output);
    if let Ok(mut guard) = dns_adapter_cache().lock() {
      *guard = Some((now_millis(), adapters.clone()));
    }
    return adapters;
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = force_refresh;
    vec![]
  }
}

#[tauri::command]
fn set_adapter_dns(adapter_name: String, primary_dns: String, secondary_dns: Option<String>) -> DnsManagerResult {
  #[cfg(target_os = "windows")]
  {
    let adapter = adapter_name.trim();
    let primary = primary_dns.trim();
    if adapter.is_empty() || primary.is_empty() {
      return DnsManagerResult {
        success: false,
        error: Some("invalid-input".to_string()),
      };
    }
    let mut servers = vec![format!("'{}'", ps_escape_single(primary))];
    if let Some(secondary) = secondary_dns {
      let trimmed = secondary.trim();
      if !trimmed.is_empty() {
        servers.push(format!("'{}'", ps_escape_single(trimmed)));
      }
    }
    let command = format!(
      "Set-DnsClientServerAddress -InterfaceAlias '{}' -ServerAddresses @({})",
      ps_escape_single(adapter),
      servers.join(",")
    );
    match run_powershell(&command) {
      Ok(_) => {
        clear_dns_adapter_cache();
        DnsManagerResult {
          success: true,
          error: None,
        }
      }
      Err(error) => DnsManagerResult {
        success: false,
        error: Some(error),
      },
    }
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = (adapter_name, primary_dns, secondary_dns);
    DnsManagerResult {
      success: false,
      error: Some("unsupported-platform".to_string()),
    }
  }
}

#[tauri::command]
fn reset_adapter_dns(adapter_name: String) -> DnsManagerResult {
  #[cfg(target_os = "windows")]
  {
    let adapter = adapter_name.trim();
    if adapter.is_empty() {
      return DnsManagerResult {
        success: false,
        error: Some("invalid-input".to_string()),
      };
    }
    let command = format!(
      "Set-DnsClientServerAddress -InterfaceAlias '{}' -ResetServerAddresses",
      ps_escape_single(adapter)
    );
    match run_powershell(&command) {
      Ok(_) => {
        clear_dns_adapter_cache();
        DnsManagerResult {
          success: true,
          error: None,
        }
      }
      Err(error) => DnsManagerResult {
        success: false,
        error: Some(error),
      },
    }
  }

  #[cfg(not(target_os = "windows"))]
  {
    let _ = adapter_name;
    DnsManagerResult {
      success: false,
      error: Some("unsupported-platform".to_string()),
    }
  }
}

async fn measure_ping(client: &HttpClient, url: &str) -> (f64, f64) {
  let mut samples = Vec::new();
  for _ in 0..PING_SAMPLES {
    let start = Instant::now();
    let _ = client.get(url).send().await;
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

async fn measure_download_cloudflare(client: &HttpClient) -> f64 {
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

async fn measure_download_hetzner(client: &HttpClient) -> f64 {
  let start = Instant::now();
  let response = client.get(HETZNER_DOWNLOAD_URL).send().await;
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

async fn measure_upload_cloudflare(client: &HttpClient) -> f64 {
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

async fn measure_upload_hetzner(client: &HttpClient) -> f64 {
  let payload = vec![0u8; UPLOAD_BYTES];
  let start = Instant::now();
  let response = client
    .post(HETZNER_UPLOAD_URL)
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

fn extract_ip_country_from_ipwhois(body: &str) -> (String, String) {
  if let Ok(value) = serde_json::from_str::<serde_json::Value>(body) {
    let ip = value
      .get("ip")
      .and_then(|item| item.as_str())
      .unwrap_or("N/A")
      .to_string();
    let country = value
      .get("country_code")
      .or_else(|| value.get("countryCode"))
      .and_then(|item| item.as_str())
      .unwrap_or("N/A")
      .to_string();
    return (ip, country);
  }
  ("N/A".to_string(), "N/A".to_string())
}

#[tauri::command]
async fn speedtest_cloudflare() -> SpeedTestResult {
  let client = HttpClient::new();
  let (latency, jitter) = measure_ping(&client, &format!("{}/__ping", CLOUDFLARE_BASE)).await;
  let download = measure_download_cloudflare(&client).await;
  let upload = measure_upload_cloudflare(&client).await;
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

#[tauri::command]
async fn speedtest_hetzner() -> SpeedTestResult {
  let client = HttpClient::new();
  let (latency, jitter) = measure_ping(&client, "https://www.gstatic.com/generate_204").await;
  let download = measure_download_hetzner(&client).await;
  let upload = measure_upload_hetzner(&client).await;
  let (ip, country) = match client
    .get(IPWHOIS_URL)
    .header("User-Agent", "PulseNet")
    .send()
    .await
  {
    Ok(resp) => {
      let body = resp.text().await.unwrap_or_default();
      extract_ip_country_from_ipwhois(&body)
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
async fn check_for_updates(include_prerelease: Option<bool>) -> UpdateCheckResult {
  let client = HttpClient::new();
  let include_prerelease = include_prerelease.unwrap_or(false);
  let current_version = env!("CARGO_PKG_VERSION").to_string();
  let response = client
    .get(if include_prerelease { GITHUB_RELEASES_LIST_URL } else { GITHUB_RELEASES_URL })
    .header("User-Agent", "PulseNet")
    .send()
    .await;
  if response.is_err() {
    return UpdateCheckResult {
      current_version,
      latest_version: String::new(),
      update_available: false,
      is_prerelease: false,
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
      is_prerelease: false,
      url: format!("https://github.com/{}/releases/latest", GITHUB_REPO),
      error: Some("invalid-response".to_string()),
    };
  }
  let data = json.unwrap();
  let release = if include_prerelease {
    data
      .as_array()
      .and_then(|items| {
        items.iter().find(|item| {
          let is_draft = item.get("draft").and_then(|v| v.as_bool()).unwrap_or(false);
          !is_draft
        })
      })
      .cloned()
      .unwrap_or(serde_json::Value::Null)
  } else {
    data
  };
  let latest = release
    .get("tag_name")
    .and_then(|value| value.as_str())
    .unwrap_or("")
    .trim_start_matches('v')
    .to_string();
  let update_available = !latest.is_empty() && is_newer_version(&latest, &current_version);
  let is_prerelease = release
    .get("prerelease")
    .and_then(|value| value.as_bool())
    .unwrap_or(false);
  let url = release
    .get("html_url")
    .and_then(|value| value.as_str())
    .unwrap_or(&format!("https://github.com/{}/releases/latest", GITHUB_REPO))
    .to_string();

  UpdateCheckResult {
    current_version,
    latest_version: latest,
    update_available,
    is_prerelease,
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
      test_dns_servers_with_custom,
      list_dns_adapters,
      set_adapter_dns,
      reset_adapter_dns,
      speedtest_cloudflare,
      speedtest_hetzner,
      check_for_updates
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
