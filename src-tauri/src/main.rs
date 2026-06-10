#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
use auto_launch::AutoLaunchBuilder;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
use std::env;
use std::fs;
use std::net::SocketAddr;
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use surge_ping::{Client as PingClient, Config as PingConfig, PingIdentifier, PingSequence, ICMP};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};
use tokio::net::lookup_host;
use tokio::time::timeout;
use trust_dns_resolver::config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts};
use trust_dns_resolver::TokioAsyncResolver;

const GITHUB_REPO: &str = "SM8KE1/PulseNet";
const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/SM8KE1/PulseNet/releases/latest";
const GITHUB_RELEASES_LIST_URL: &str =
    "https://api.github.com/repos/SM8KE1/PulseNet/releases?per_page=20";

const CLOUDFLARE_BASE: &str = "https://speed.cloudflare.com";
const HETZNER_DOWNLOAD_URL: &str = "https://speed.hetzner.de/10MB.bin";
const HETZNER_UPLOAD_URL: &str = "https://httpbin.org/post";
const IPWHOIS_URL: &str = "https://ipwho.is/";
const DOWNLOAD_BYTES: usize = 10 * 1024 * 1024;
const UPLOAD_BYTES: usize = 5 * 1024 * 1024;
const PING_SAMPLES: usize = 5;
const DNS_TIMEOUT_MS: u64 = 4000;
const DNS_ADAPTER_CACHE_TTL_MS: u128 = 30_000;
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
    id: String,
    name: String,
    dns: Vec<String>,
    ipv4: Option<String>,
    gateway: Option<String>,
    status: Option<String>,
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
struct PublicNetworkInfo {
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
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("auto-launch.json"))
        .unwrap_or_else(|_| PathBuf::from("auto-launch.json"))
}

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
fn auto_launch_app_path() -> Option<String> {
    env::current_exe()
        .ok()
        .and_then(|path| path.to_str().map(|s| s.to_string()))
}

#[cfg(target_os = "windows")]
fn schtasks_command() -> Command {
    let mut command = Command::new("schtasks");
    command.creation_flags(CREATE_NO_WINDOW);
    command
}

#[cfg(target_os = "windows")]
fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

#[cfg(target_os = "windows")]
fn auto_launch_task_xml() -> Option<String> {
    let output = schtasks_command()
        .args(["/Query", "/TN", auto_launch_task_name(), "/XML"])
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).to_string())
}

#[cfg(target_os = "windows")]
fn is_auto_launch_enabled() -> bool {
    auto_launch_task_xml()
        .map(|xml| !xml.contains("<Enabled>false</Enabled>"))
        .unwrap_or(false)
}

#[cfg(target_os = "windows")]
fn auto_launch_task_matches_current_exe() -> bool {
    let Some(app_path) = auto_launch_app_path() else {
        return false;
    };
    let Some(xml) = auto_launch_task_xml() else {
        return false;
    };
    let escaped_path = xml_escape(&app_path);
    let plain_command = format!("<Command>{}</Command>", escaped_path);
    let quoted_command = format!("<Command>\"{}\"</Command>", escaped_path);
    xml.contains(&plain_command) || xml.contains(&quoted_command)
}

#[cfg(target_os = "windows")]
fn set_auto_launch_enabled(enabled: bool) -> bool {
    let Some(app_path) = auto_launch_app_path() else {
        return false;
    };

    if enabled {
        let _ = schtasks_command()
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
            .status();
        is_auto_launch_enabled() && auto_launch_task_matches_current_exe()
    } else {
        let _ = schtasks_command()
            .args(["/Delete", "/TN", auto_launch_task_name(), "/F"])
            .status();
        is_auto_launch_enabled()
    }
}

#[cfg(target_os = "windows")]
fn ensure_auto_launch_task_current(app: &tauri::AppHandle) -> bool {
    if is_auto_launch_enabled() {
        if auto_launch_task_matches_current_exe() {
            return true;
        }
        return set_auto_launch_enabled(true);
    }

    if read_auto_launch_pref(app).unwrap_or(false) {
        return set_auto_launch_enabled(true);
    }

    false
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

#[cfg(any(target_os = "windows", target_os = "linux"))]
fn dns_adapter_cache() -> &'static Mutex<Option<(u128, Vec<DnsAdapter>)>> {
    static CACHE: OnceLock<Mutex<Option<(u128, Vec<DnsAdapter>)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

#[cfg(any(target_os = "windows", target_os = "linux"))]
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

#[cfg(target_os = "linux")]
fn split_nmcli_fields(line: &str) -> Vec<String> {
    let mut fields = Vec::new();
    let mut current = String::new();
    let mut escaped = false;

    for ch in line.chars() {
        if escaped {
            current.push(ch);
            escaped = false;
            continue;
        }
        if ch == '\\' {
            escaped = true;
            continue;
        }
        if ch == ':' {
            fields.push(current);
            current = String::new();
        } else {
            current.push(ch);
        }
    }

    fields.push(current);
    fields
}

#[cfg(target_os = "linux")]
fn run_command_output(program: &str, args: &[String]) -> Result<String, String> {
    let output = Command::new(program).args(args).output().map_err(|error| {
        if error.kind() == std::io::ErrorKind::NotFound {
            format!("{}-not-found", program)
        } else {
            error.to_string()
        }
    })?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        if stderr.is_empty() {
            Err(stdout)
        } else {
            Err(stderr)
        }
    }
}

#[cfg(target_os = "linux")]
fn run_nmcli(args: &[String]) -> Result<String, String> {
    run_command_output("nmcli", args)
}

#[cfg(target_os = "linux")]
fn is_nmcli_permission_error(error: &str) -> bool {
    let text = error.to_lowercase();
    text.contains("not authorized")
        || text.contains("permission")
        || text.contains("polkit")
        || text.contains("access denied")
        || text.contains("insufficient privileges")
}

#[cfg(target_os = "linux")]
fn run_nmcli_with_auth(args: &[String]) -> Result<String, String> {
    match run_nmcli(args) {
        Ok(output) => Ok(output),
        Err(error) => {
            if !is_nmcli_permission_error(&error) {
                return Err(error);
            }
            let mut pkexec_args = Vec::with_capacity(args.len() + 1);
            pkexec_args.push("nmcli".to_string());
            pkexec_args.extend(args.iter().cloned());
            run_command_output("pkexec", &pkexec_args).map_err(|pkexec_error| {
                if pkexec_error == "pkexec-not-found" {
                    "permission-required".to_string()
                } else {
                    pkexec_error
                }
            })
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_connection_type_supported(connection_type: &str) -> bool {
    matches!(
        connection_type.trim().to_lowercase().as_str(),
        "ethernet" | "wifi" | "802-3-ethernet" | "802-11-wireless"
    )
}

#[cfg(target_os = "linux")]
fn linux_connection_is_excluded(name: &str, device: &str, connection_type: &str) -> bool {
    let text = format!("{} {} {}", name, device, connection_type).to_lowercase();
    [
        "vpn",
        "wireguard",
        "openvpn",
        "tun",
        "tap",
        "tailscale",
        "zerotier",
        "hamachi",
        "docker",
        "veth",
        "bridge",
        "br-",
        "virbr",
        "loopback",
        "dummy",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(target_os = "linux")]
fn linux_connection_details(uuid: &str) -> (Vec<String>, Option<String>, Option<String>) {
    let args = vec![
        "-t".to_string(),
        "-f".to_string(),
        "IP4.DNS,IP4.ADDRESS,IP4.GATEWAY".to_string(),
        "connection".to_string(),
        "show".to_string(),
        uuid.to_string(),
    ];
    let output = match run_nmcli(&args) {
        Ok(output) => output,
        Err(_) => return (vec![], None, None),
    };

    let mut dns = Vec::new();
    let mut ipv4 = None;
    let mut gateway = None;

    for line in output.lines() {
        let fields = split_nmcli_fields(line);
        if fields.len() < 2 {
            continue;
        }
        let key = fields[0].trim();
        let value = fields[1..].join(":").trim().to_string();
        if value.is_empty() {
            continue;
        }
        if key.starts_with("IP4.DNS") {
            dns.push(value);
        } else if key.starts_with("IP4.ADDRESS") && ipv4.is_none() {
            ipv4 = Some(value.split('/').next().unwrap_or("").trim().to_string())
                .filter(|address| !address.is_empty());
        } else if key == "IP4.GATEWAY" && gateway.is_none() {
            gateway = Some(value);
        }
    }

    (dns, ipv4, gateway)
}

#[cfg(target_os = "linux")]
fn normalize_linux_dns_server(value: &str) -> Option<(String, bool)> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Ok(ip) = trimmed.parse::<std::net::IpAddr>() {
        return Some((ip.to_string(), ip.is_ipv6()));
    }
    if let Ok(socket) = trimmed.parse::<SocketAddr>() {
        let ip = socket.ip();
        return Some((ip.to_string(), ip.is_ipv6()));
    }
    None
}

#[cfg(target_os = "linux")]
fn build_linux_dns_modify_args(
    uuid: &str,
    primary_dns: &str,
    secondary_dns: Option<String>,
) -> Result<Vec<String>, String> {
    let mut ipv4_servers = Vec::new();
    let mut ipv6_servers = Vec::new();
    let mut input_servers = vec![primary_dns.to_string()];
    if let Some(secondary) = secondary_dns {
        if !secondary.trim().is_empty() {
            input_servers.push(secondary);
        }
    }

    for server in input_servers {
        let Some((normalized, is_ipv6)) = normalize_linux_dns_server(&server) else {
            return Err("invalid-input".to_string());
        };
        if is_ipv6 {
            ipv6_servers.push(normalized);
        } else {
            ipv4_servers.push(normalized);
        }
    }

    let mut args = vec![
        "connection".to_string(),
        "modify".to_string(),
        uuid.to_string(),
    ];
    args.extend([
        "ipv4.ignore-auto-dns".to_string(),
        "yes".to_string(),
        "ipv4.dns".to_string(),
        ipv4_servers.join(" "),
        "ipv6.dns".to_string(),
        ipv6_servers.join(" "),
    ]);
    if !ipv6_servers.is_empty() {
        args.extend(["ipv6.ignore-auto-dns".to_string(), "yes".to_string()]);
    }

    Ok(args)
}

#[cfg(target_os = "linux")]
fn linux_reactivate_connection(uuid: &str) -> Result<(), String> {
    let args = vec!["connection".to_string(), "up".to_string(), uuid.to_string()];
    run_nmcli_with_auth(&args).map(|_| ())
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
        let dns_value = item.get("ServerAddresses").or_else(|| {
            item.get("DNSServer")
                .and_then(|value| value.get("ServerAddresses"))
        });
        let dns = dns_value
            .and_then(|value| value.as_array())
            .map(|values| {
                values
                    .iter()
                    .filter_map(|value| value.as_str().map(|s| s.trim().to_string()))
                    .filter(|value| !value.is_empty())
                    .collect::<Vec<String>>()
            })
            .unwrap_or_default();
        let ipv4 = item
            .get("IPv4Address")
            .and_then(|value| value.get("IPAddress").or(Some(value)))
            .and_then(|value| {
                if let Some(text) = value.as_str() {
                    Some(text.trim().to_string())
                } else {
                    value
                        .as_array()
                        .and_then(|items| items.first())
                        .and_then(|first| {
                            first
                                .as_str()
                                .or_else(|| first.get("IPAddress").and_then(|ip| ip.as_str()))
                        })
                        .map(|text| text.trim().to_string())
                }
            })
            .filter(|value| !value.is_empty());
        let gateway = item
            .get("IPv4DefaultGateway")
            .and_then(|value| value.get("NextHop").or(Some(value)))
            .and_then(|value| {
                if let Some(text) = value.as_str() {
                    Some(text.trim().to_string())
                } else {
                    value
                        .as_array()
                        .and_then(|items| items.first())
                        .and_then(|first| {
                            first
                                .as_str()
                                .or_else(|| first.get("NextHop").and_then(|hop| hop.as_str()))
                        })
                        .map(|text| text.trim().to_string())
                }
            })
            .filter(|value| !value.is_empty());
        let status = item
            .get("NetAdapter")
            .and_then(|value| value.get("Status"))
            .or_else(|| item.get("Status"))
            .and_then(|value| value.as_str())
            .map(|text| text.trim().to_string())
            .filter(|value| !value.is_empty());
        adapters.push(DnsAdapter {
            id: name.clone(),
            name,
            dns,
            ipv4,
            gateway,
            status,
        });
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
    let result = timeout(
        Duration::from_secs(2),
        pinger.ping(PingSequence(0), &payload),
    )
    .await;
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
        return ensure_auto_launch_task_current(&_app);
    }

    #[cfg(not(target_os = "windows"))]
    {
        read_auto_launch_pref(&_app).unwrap_or(false)
    }
}

#[tauri::command]
fn set_auto_launch(app: tauri::AppHandle, enabled: bool) -> bool {
    #[cfg(target_os = "windows")]
    {
        let updated = set_auto_launch_enabled(enabled);
        write_auto_launch_pref(&app, updated);
        return updated;
    }

    #[cfg(not(target_os = "windows"))]
    {
        write_auto_launch_pref(&app, enabled);
        let launcher = auto_launcher();
        let _ = if enabled {
            launcher.enable()
        } else {
            launcher.disable()
        };
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
fn set_tray_status(app: AppHandle, status: String) -> bool {
    app.tray_by_id("main")
        .map(|tray| tray.set_tooltip(Some(&status)).is_ok())
        .unwrap_or(false)
}

#[tauri::command]
async fn test_dns_servers_with_custom(
    domain: String,
    custom_servers: Option<Vec<String>>,
) -> DnsResponse {
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
        let lookup = timeout(
            Duration::from_millis(DNS_TIMEOUT_MS),
            resolver.lookup_ip(sanitized.clone()),
        )
        .await;
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

    DnsResponse {
        error: None,
        results,
    }
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

        let command = "$excludedPattern = '(?i)(bluetooth|vpn|openvpn|wireguard|wintun|tap|tun|tunnel|tailscale|zerotier|hamachi|expressvpn|nordvpn|protonvpn|surfshark|virtualbox|vmware|hyper-v|loopback|pseudo|wiresock)'; $dnsItems = @(Get-DnsClientServerAddress -AddressFamily IPv4); $adapters = @(Get-NetAdapter); $ips = @(Get-NetIPAddress -AddressFamily IPv4 -ErrorAction SilentlyContinue); $routes = @(Get-NetRoute -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Where-Object { $_.NextHop -and $_.NextHop -ne '0.0.0.0' }); $defaultRouteIndexes = @($routes | Select-Object -ExpandProperty InterfaceIndex -Unique); $dnsItems | ForEach-Object { $dns = $_; $adapter = $adapters | Where-Object { $_.InterfaceIndex -eq $dns.InterfaceIndex } | Select-Object -First 1; if (-not $adapter) { return }; $ipv4 = @($ips | Where-Object { $_.InterfaceIndex -eq $dns.InterfaceIndex -and $_.IPAddress -and $_.PrefixOrigin -ne 'WellKnown' } | Select-Object -First 1 -ExpandProperty IPAddress); $gateway = @($routes | Where-Object { $_.InterfaceIndex -eq $dns.InterfaceIndex } | Select-Object -First 1 -ExpandProperty NextHop); $searchText = \"$($dns.InterfaceAlias) $($adapter.Name) $($adapter.InterfaceDescription) $($adapter.ComponentID)\"; $isExcluded = $searchText -match $excludedPattern; $isUsable = $adapter.Status -eq 'Up' -and $adapter.HardwareInterface -eq $true -and $adapter.Virtual -ne $true -and -not $isExcluded -and (($gateway.Count -gt 0) -or ($defaultRouteIndexes -contains $dns.InterfaceIndex)); if ($isUsable) { [pscustomobject]@{ InterfaceAlias = $dns.InterfaceAlias; InterfaceIndex = $dns.InterfaceIndex; ServerAddresses = $dns.ServerAddresses; IPv4Address = $ipv4; IPv4DefaultGateway = $gateway; Status = $adapter.Status } } } | ConvertTo-Json -Depth 4 -Compress";
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
    #[cfg(target_os = "linux")]
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

        let args = vec![
            "-t".to_string(),
            "-f".to_string(),
            "NAME,UUID,TYPE,DEVICE,STATE".to_string(),
            "connection".to_string(),
            "show".to_string(),
            "--active".to_string(),
        ];
        let output = match run_nmcli(&args) {
            Ok(output) => output,
            Err(_) => return vec![],
        };

        let mut adapters = Vec::new();
        for line in output.lines() {
            let fields = split_nmcli_fields(line);
            if fields.len() < 5 {
                continue;
            }
            let connection_name = fields[0].trim();
            let uuid = fields[1].trim();
            let connection_type = fields[2].trim();
            let device = fields[3].trim();
            let state = fields[4].trim();

            if connection_name.is_empty()
                || uuid.is_empty()
                || device.is_empty()
                || !linux_connection_type_supported(connection_type)
                || linux_connection_is_excluded(connection_name, device, connection_type)
            {
                continue;
            }

            let (dns, ipv4, gateway) = linux_connection_details(uuid);
            let name = if device.is_empty() {
                connection_name.to_string()
            } else {
                format!("{} ({})", connection_name, device)
            };
            adapters.push(DnsAdapter {
                id: uuid.to_string(),
                name,
                dns,
                ipv4,
                gateway,
                status: Some(state.to_string()).filter(|value| !value.is_empty()),
            });
        }

        adapters.sort_by(|left, right| left.name.cmp(&right.name));
        if let Ok(mut guard) = dns_adapter_cache().lock() {
            *guard = Some((now_millis(), adapters.clone()));
        }
        adapters
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "linux")))]
    {
        let _ = force_refresh;
        vec![]
    }
}

#[tauri::command]
fn set_adapter_dns(
    adapter_name: String,
    primary_dns: String,
    secondary_dns: Option<String>,
) -> DnsManagerResult {
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

    #[cfg(target_os = "linux")]
    {
        let uuid = adapter_name.trim();
        let primary = primary_dns.trim();
        if uuid.is_empty() || primary.is_empty() {
            return DnsManagerResult {
                success: false,
                error: Some("invalid-input".to_string()),
            };
        }

        let modify_args = match build_linux_dns_modify_args(uuid, primary, secondary_dns) {
            Ok(args) => args,
            Err(error) => {
                return DnsManagerResult {
                    success: false,
                    error: Some(error),
                }
            }
        };

        match run_nmcli_with_auth(&modify_args).and_then(|_| linux_reactivate_connection(uuid)) {
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

    #[cfg(all(not(target_os = "windows"), not(target_os = "linux")))]
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

    #[cfg(target_os = "linux")]
    {
        let uuid = adapter_name.trim();
        if uuid.is_empty() {
            return DnsManagerResult {
                success: false,
                error: Some("invalid-input".to_string()),
            };
        }

        let args = vec![
            "connection".to_string(),
            "modify".to_string(),
            uuid.to_string(),
            "ipv4.ignore-auto-dns".to_string(),
            "no".to_string(),
            "ipv4.dns".to_string(),
            "".to_string(),
            "ipv6.ignore-auto-dns".to_string(),
            "no".to_string(),
            "ipv6.dns".to_string(),
            "".to_string(),
        ];

        match run_nmcli_with_auth(&args).and_then(|_| linux_reactivate_connection(uuid)) {
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

    #[cfg(all(not(target_os = "windows"), not(target_os = "linux")))]
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
        .get(format!(
            "{}/__down?bytes={}",
            CLOUDFLARE_BASE, DOWNLOAD_BYTES
        ))
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
    let response = client.post(HETZNER_UPLOAD_URL).body(payload).send().await;
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
async fn get_public_network_info() -> PublicNetworkInfo {
    let client = HttpClient::new();
    let mut ip = "N/A".to_string();
    let mut country = "N/A".to_string();

    if let Ok(resp) = client
        .get(format!("{}/cdn-cgi/trace", CLOUDFLARE_BASE))
        .header("User-Agent", "PulseNet")
        .send()
        .await
    {
        let body = resp.text().await.unwrap_or_default();
        if let Some(value) = extract_ip_from_trace(&body) {
            ip = value;
        }
        if let Some(value) = extract_country_from_trace(&body) {
            country = value;
        }
    }

    if ip == "N/A" || country == "N/A" {
        if let Ok(resp) = client
            .get(IPWHOIS_URL)
            .header("User-Agent", "PulseNet")
            .send()
            .await
        {
            let body = resp.text().await.unwrap_or_default();
            let (fallback_ip, fallback_country) = extract_ip_country_from_ipwhois(&body);
            if ip == "N/A" {
                ip = fallback_ip;
            }
            if country == "N/A" {
                country = fallback_country;
            }
        }
    }

    let error = if ip == "N/A" && country == "N/A" {
        Some("Failed to fetch network info".to_string())
    } else {
        None
    };

    PublicNetworkInfo { ip, country, error }
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
        .get(if include_prerelease {
            GITHUB_RELEASES_LIST_URL
        } else {
            GITHUB_RELEASES_URL
        })
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
        data.as_array()
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
        .unwrap_or(&format!(
            "https://github.com/{}/releases/latest",
            GITHUB_REPO
        ))
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
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(AppState::default())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show PulseNet", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let restart =
                MenuItem::with_id(app, "restart", "Restart PulseNet", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let tray_menu = Menu::with_items(
                app,
                &[&show, &settings, &separator, &restart, &exit],
            )?;

            TrayIconBuilder::with_id("main")
                .menu(&tray_menu)
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        show_main_window(&tray.app_handle());
                    }
                })
                .on_menu_event(|app, event| match event.id().as_ref() {
                    "show" => show_main_window(app),
                    "settings" => {
                        show_main_window(app);
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.emit(
                                "tray-open-page",
                                serde_json::json!({ "page": "settings" }),
                            );
                        }
                    }
                    "restart" => {
                        app.restart();
                    }
                    "exit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let state: State<AppState> = window.state();
                handle_close_requested(window, &state);
            }
        })
        .invoke_handler(tauri::generate_handler![
            ping_host,
            get_app_version,
            get_username,
            get_public_network_info,
            get_auto_launch,
            set_auto_launch,
            get_close_action,
            set_close_action,
            perform_close_action,
            set_tray_status,
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
