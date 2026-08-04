#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

#[cfg(not(target_os = "windows"))]
use auto_launch::AutoLaunchBuilder;
#[cfg(target_os = "windows")]
use base64::{engine::general_purpose, Engine as _};
#[cfg(target_os = "linux")]
use dbus::arg::{PropMap, RefArg, Variant};
#[cfg(target_os = "linux")]
use dbus::blocking::stdintf::org_freedesktop_dbus::Properties;
#[cfg(target_os = "linux")]
use dbus::blocking::Connection as DbusConnection;
#[cfg(target_os = "linux")]
use dbus::Path as DbusPath;
use reqwest::Client as HttpClient;
use serde::{Deserialize, Serialize};
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::collections::HashMap;
#[cfg(target_os = "linux")]
use std::collections::HashMap as StdHashMap;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::collections::HashSet;
use std::env;
#[cfg(target_os = "windows")]
use std::ffi::{CStr, OsString};
use std::fs;
#[cfg(target_os = "linux")]
use std::io::Write;
#[cfg(any(target_os = "windows", target_os = "linux"))]
use std::net::Ipv4Addr;
use std::net::SocketAddr;
#[cfg(target_os = "windows")]
use std::os::windows::ffi::{OsStrExt, OsStringExt};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::PathBuf;
use std::process::Command;
#[cfg(target_os = "linux")]
use std::process::Stdio;
#[cfg(target_os = "windows")]
use std::ptr::{null, null_mut};
#[cfg(target_os = "windows")]
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
#[cfg(target_os = "linux")]
use std::{os::unix::fs::MetadataExt, thread};
use surge_ping::{Client as PingClient, Config as PingConfig, PingIdentifier, PingSequence, ICMP};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, Window, WindowEvent};
use tokio::net::lookup_host;
use tokio::time::timeout;
use trust_dns_resolver::config::{NameServerConfig, Protocol, ResolverConfig, ResolverOpts};
use trust_dns_resolver::TokioAsyncResolver;
#[cfg(target_os = "windows")]
use windows_sys::Win32::Foundation::{
    CloseHandle, GetLastError, ERROR_BUFFER_OVERFLOW, ERROR_INSUFFICIENT_BUFFER, ERROR_SUCCESS,
    FALSE, GENERIC_READ, GENERIC_WRITE, INVALID_HANDLE_VALUE, NO_ERROR,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Graphics::Gdi::{
    DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO, BITMAPINFOHEADER,
    BI_RGB, DIB_RGB_COLORS, RGBQUAD,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::NetworkManagement::IpHelper::{
    FreeMibTable, GetAdaptersAddresses, GetExtendedTcpTable, GetExtendedUdpTable, GetIfTable2,
    GAA_FLAG_INCLUDE_GATEWAYS, IF_TYPE_SOFTWARE_LOOPBACK, IP_ADAPTER_ADDRESSES_LH, MIB_IF_TABLE2,
    MIB_TCPTABLE_OWNER_PID, MIB_UDPTABLE_OWNER_PID, TCP_TABLE_OWNER_PID_ALL, UDP_TABLE_OWNER_PID,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::NetworkManagement::Ndis::{IfOperStatusUp, MediaConnectStateConnected};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Networking::WinSock::{AF_INET, SOCKADDR_IN, SOCKET_ADDRESS};
#[cfg(target_os = "windows")]
use windows_sys::Win32::Storage::FileSystem::{
    CreateFileW, ReadFile, WriteFile, FILE_ATTRIBUTE_NORMAL, OPEN_EXISTING,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Pipes::WaitNamedPipeW;
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Services::{
    CloseServiceHandle, OpenSCManagerW, OpenServiceW, QueryServiceStatusEx, SC_MANAGER_CONNECT,
    SC_STATUS_PROCESS_INFO, SERVICE_QUERY_STATUS, SERVICE_RUNNING, SERVICE_STATUS_PROCESS,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::System::Threading::{
    OpenProcess, QueryFullProcessImageNameW, PROCESS_QUERY_LIMITED_INFORMATION,
};
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::Shell::ExtractIconExW;
#[cfg(target_os = "windows")]
use windows_sys::Win32::UI::WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO};

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
const NETWORK_USAGE_CACHE_TTL_MS: u128 = 250;
const BANDWIDTH_LIMIT_MIN_BPS: u64 = 1024;
const BANDWIDTH_LIMIT_MAX_BPS: u64 = 10_000_000_000;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_SERVICE_NAME: &str = "PulseNetNetworkControl";
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_PIPE_NAME: &str = r"\\.\pipe\PulseNetNetworkControl";
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_IPC_MAGIC: u32 = 0x504E4E43;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_PROTOCOL_VERSION: u16 = 1;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_COMMAND_HANDSHAKE: u16 = 1;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_COMMAND_REPLACE_RULES: u16 = 3;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_COMMAND_GET_USAGE: u16 = 4;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_STATUS_SERVICE_READY: u32 = 0x0000_0001;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_STATUS_FIREWALL_READY: u32 = 0x0000_0002;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_STATUS_READY_MASK: u32 =
    BANDWIDTH_LIMITER_STATUS_SERVICE_READY | BANDWIDTH_LIMITER_STATUS_FIREWALL_READY;
#[cfg(target_os = "windows")]
const BANDWIDTH_LIMITER_MAX_MESSAGE_SIZE: usize = 1024 * 1024;
#[cfg(target_os = "windows")]
static BANDWIDTH_LIMITER_REQUEST_ID: AtomicU64 = AtomicU64::new(1);
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

#[derive(Serialize, Deserialize, Clone)]
struct NetworkAdapterUsage {
    name: String,
    #[serde(rename = "receivedBytes")]
    received_bytes: u64,
    #[serde(rename = "sentBytes")]
    sent_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
struct NetworkProcessUsage {
    pid: u32,
    name: String,
    path: Option<String>,
    #[serde(rename = "iconDataUrl")]
    icon_data_url: Option<String>,
    connections: u32,
    #[serde(rename = "remoteAddresses")]
    remote_addresses: Vec<String>,
}

#[derive(Serialize, Deserialize, Clone)]
struct NetworkApplicationUsage {
    name: String,
    path: Option<String>,
    #[serde(rename = "iconDataUrl")]
    icon_data_url: Option<String>,
    #[serde(rename = "downloadBytes")]
    download_bytes: u64,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PersistedNetworkApplicationUsage {
    key: String,
    name: String,
    path: Option<String>,
    total_download_bytes: u64,
    last_helper_download_bytes: u64,
}

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct PersistedNetworkApplicationUsageState {
    #[serde(default)]
    reset_pending: bool,
    applications: Vec<PersistedNetworkApplicationUsage>,
}

#[derive(Serialize, Clone)]
struct NetworkUsageSnapshot {
    #[serde(rename = "timestampMs")]
    timestamp_ms: u128,
    #[serde(rename = "receivedBytes")]
    received_bytes: u64,
    #[serde(rename = "sentBytes")]
    sent_bytes: u64,
    adapters: Vec<NetworkAdapterUsage>,
    processes: Vec<NetworkProcessUsage>,
    applications: Vec<NetworkApplicationUsage>,
    error: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
struct BandwidthLimitRule {
    id: String,
    executable_path: String,
    process_name: String,
    download_limit_bps: Option<u64>,
    upload_limit_bps: Option<u64>,
    #[serde(default)]
    blocked: bool,
    enabled: bool,
    updated_at_ms: u128,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BandwidthLimitRuleInput {
    executable_path: String,
    process_name: String,
    download_limit_bps: Option<u64>,
    upload_limit_bps: Option<u64>,
    blocked: Option<bool>,
    enabled: Option<bool>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct BandwidthLimiterEngineStatus {
    platform: String,
    mode: String,
    supported: bool,
    installed: bool,
    running: bool,
    ready: bool,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct BandwidthLimiterState {
    engine: BandwidthLimiterEngineStatus,
    rules: Vec<BandwidthLimitRule>,
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

fn bandwidth_limits_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("bandwidth-limits.json"))
        .unwrap_or_else(|_| PathBuf::from("bandwidth-limits.json"))
}

fn network_application_usage_path(app: &tauri::AppHandle) -> PathBuf {
    app.path()
        .app_config_dir()
        .map(|dir| dir.join("network-application-usage.json"))
        .unwrap_or_else(|_| PathBuf::from("network-application-usage.json"))
}

fn network_application_usage_lock() -> &'static Mutex<()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(()))
}

fn network_application_usage_key(name: &str, path: Option<&str>) -> String {
    path.filter(|value| !value.trim().is_empty())
        .map(normalize_executable_path)
        .unwrap_or_else(|| format!("name:{}", name.trim().to_lowercase()))
}

fn load_network_application_usage_state(
    app: &tauri::AppHandle,
) -> Result<PersistedNetworkApplicationUsageState, String> {
    let path = network_application_usage_path(app);
    if !path.exists() {
        return Ok(PersistedNetworkApplicationUsageState::default());
    }
    let raw = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&raw).map_err(|error| format!("invalid-network-usage-history: {error}"))
}

fn save_network_application_usage_state(
    app: &tauri::AppHandle,
    state: &PersistedNetworkApplicationUsageState,
) -> Result<(), String> {
    let path = network_application_usage_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec_pretty(state).map_err(|error| error.to_string())?;
    fs::write(path, data).map_err(|error| error.to_string())
}

fn normalize_executable_path(path: &str) -> String {
    let trimmed = path.trim();
    #[cfg(target_os = "windows")]
    {
        return trimmed.replace('/', "\\").to_lowercase();
    }
    #[cfg(not(target_os = "windows"))]
    {
        trimmed.to_string()
    }
}

fn load_bandwidth_limit_rules(app: &tauri::AppHandle) -> Result<Vec<BandwidthLimitRule>, String> {
    let path = bandwidth_limits_path(app);
    if !path.exists() {
        return Ok(Vec::new());
    }
    let raw = fs::read_to_string(&path).map_err(|error| error.to_string())?;
    let mut rules = serde_json::from_str::<Vec<BandwidthLimitRule>>(&raw)
        .map_err(|error| format!("invalid-bandwidth-rules: {error}"))?;
    rules.sort_by(|left, right| {
        left.process_name
            .to_lowercase()
            .cmp(&right.process_name.to_lowercase())
    });
    Ok(rules)
}

fn save_bandwidth_limit_rules(
    app: &tauri::AppHandle,
    rules: &[BandwidthLimitRule],
) -> Result<(), String> {
    let path = bandwidth_limits_path(app);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let data = serde_json::to_vec_pretty(rules).map_err(|error| error.to_string())?;
    fs::write(path, &data).map_err(|error| error.to_string())?;
    #[cfg(target_os = "linux")]
    write_linux_network_rules(&data)?;
    Ok(())
}

#[cfg(target_os = "linux")]
const LINUX_NETWORK_HELPER_ARGUMENT: &str = "--linux-network-helper-daemon";
#[cfg(target_os = "linux")]
const LINUX_NETWORK_HELPER_PID_PATH: &str = "/run/pulsenet-network-control.pid";
#[cfg(target_os = "linux")]
const LINUX_NETWORK_CGROUP_ROOT: &str = "/sys/fs/cgroup/pulsenet";

#[cfg(target_os = "linux")]
fn linux_current_uid() -> Option<u32> {
    fs::read_to_string("/proc/self/status")
        .ok()?
        .lines()
        .find_map(|line| line.strip_prefix("Uid:"))?
        .split_whitespace()
        .next()?
        .parse()
        .ok()
}

#[cfg(target_os = "linux")]
fn linux_runtime_rules_path(uid: u32) -> PathBuf {
    PathBuf::from(format!("/run/user/{uid}/pulsenet-network-rules.json"))
}

#[cfg(target_os = "linux")]
fn write_linux_network_rules(data: &[u8]) -> Result<(), String> {
    let uid = linux_current_uid().ok_or_else(|| "linux-user-id-unavailable".to_string())?;
    let path = linux_runtime_rules_path(uid);
    let parent = path
        .parent()
        .ok_or_else(|| "linux-runtime-directory-unavailable".to_string())?;
    if !parent.is_dir() {
        return Err("linux-runtime-directory-unavailable".to_string());
    }
    fs::write(path, data).map_err(|error| format!("linux-rule-sync-failed:{error}"))
}

#[cfg(target_os = "linux")]
fn linux_hash64(input: &[u8]) -> u64 {
    input.iter().fold(0xCBF2_9CE4_8422_2325, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01B3)
    })
}

#[cfg(target_os = "linux")]
fn linux_rule_key(rule: &BandwidthLimitRule) -> String {
    format!("{:016x}", linux_hash64(rule.executable_path.as_bytes()))
}

#[cfg(target_os = "linux")]
fn linux_nft_command() -> Option<PathBuf> {
    ["/usr/sbin/nft", "/sbin/nft", "/usr/bin/nft"]
        .into_iter()
        .map(PathBuf::from)
        .find(|path| path.is_file())
}

#[cfg(target_os = "linux")]
fn linux_run_nft(nft: &PathBuf, arguments: &[&str]) -> Result<(), String> {
    let status = Command::new(nft)
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .status()
        .map_err(|error| format!("nft-exec-failed:{error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| format!("nft-failed:{}", status.code().unwrap_or(-1)))
}

#[cfg(target_os = "linux")]
fn linux_apply_nft_rules(
    nft: &PathBuf,
    uid: u32,
    rules: &[BandwidthLimitRule],
) -> Result<(), String> {
    let table = format!("pulsenet_{uid}");
    if linux_run_nft(nft, &["list", "table", "inet", &table]).is_err() {
        linux_run_nft(nft, &["add", "table", "inet", &table])?;
    }

    let mut script = format!(
        "flush table inet {table}\n\
         add chain inet {table} output {{ type filter hook output priority filter; policy accept; }}\n\
         add chain inet {table} input {{ type filter hook input priority filter; policy accept; }}\n"
    );
    for rule in rules.iter().filter(|rule| rule.enabled) {
        let key = linux_rule_key(rule);
        let cgroup = format!("pulsenet/{uid}/{key}");
        if rule.blocked {
            script.push_str(&format!(
                "add rule inet {table} output socket cgroupv2 level 3 \"{cgroup}\" counter drop\n\
                 add rule inet {table} input socket cgroupv2 level 3 \"{cgroup}\" counter drop\n"
            ));
            continue;
        }
        if let Some(limit) = rule.upload_limit_bps.filter(|limit| *limit > 0) {
            let bytes = (limit / 8).max(128);
            let burst = (bytes / 5).clamp(4096, 1_048_576);
            script.push_str(&format!(
                "add rule inet {table} output socket cgroupv2 level 3 \"{cgroup}\" limit rate over {bytes} bytes/second burst {burst} bytes counter drop\n"
            ));
        }
        if let Some(limit) = rule.download_limit_bps.filter(|limit| *limit > 0) {
            let bytes = (limit / 8).max(128);
            let burst = (bytes / 5).clamp(4096, 1_048_576);
            script.push_str(&format!(
                "add rule inet {table} input socket cgroupv2 level 3 \"{cgroup}\" limit rate over {bytes} bytes/second burst {burst} bytes counter drop\n"
            ));
        }
    }

    let mut child = Command::new(nft)
        .args(["-f", "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| format!("nft-exec-failed:{error}"))?;
    child
        .stdin
        .as_mut()
        .ok_or_else(|| "nft-stdin-unavailable".to_string())?
        .write_all(script.as_bytes())
        .map_err(|error| format!("nft-write-failed:{error}"))?;
    let status = child
        .wait()
        .map_err(|error| format!("nft-wait-failed:{error}"))?;
    status
        .success()
        .then_some(())
        .ok_or_else(|| format!("nft-apply-failed:{}", status.code().unwrap_or(-1)))
}

#[cfg(target_os = "linux")]
fn linux_move_matching_processes(uid: u32, rules: &[BandwidthLimitRule]) {
    let destinations: HashMap<String, PathBuf> = rules
        .iter()
        .filter(|rule| rule.enabled)
        .map(|rule| {
            let destination = PathBuf::from(LINUX_NETWORK_CGROUP_ROOT)
                .join(uid.to_string())
                .join(linux_rule_key(rule));
            let _ = fs::create_dir_all(&destination);
            (rule.executable_path.clone(), destination)
        })
        .collect();
    if destinations.is_empty() {
        return;
    }

    let Ok(processes) = fs::read_dir("/proc") else {
        return;
    };
    for process in processes.flatten() {
        let Some(pid) = process
            .file_name()
            .to_str()
            .and_then(|value| value.parse::<u32>().ok())
        else {
            continue;
        };
        if process.metadata().map(|metadata| metadata.uid()).ok() != Some(uid) {
            continue;
        }
        let Ok(executable) = fs::read_link(process.path().join("exe")) else {
            continue;
        };
        let executable = executable.to_string_lossy();
        let Some(destination) = destinations.get(executable.as_ref()) else {
            continue;
        };
        let _ = fs::write(destination.join("cgroup.procs"), pid.to_string());
    }
}

#[cfg(target_os = "linux")]
fn linux_helper_is_running() -> bool {
    let Ok(pid) = fs::read_to_string(LINUX_NETWORK_HELPER_PID_PATH) else {
        return false;
    };
    let Ok(pid) = pid.trim().parse::<u32>() else {
        return false;
    };
    fs::read_to_string(format!("/proc/{pid}/cmdline"))
        .map(|command| command.contains(LINUX_NETWORK_HELPER_ARGUMENT))
        .unwrap_or(false)
}

#[cfg(target_os = "linux")]
fn run_linux_network_helper() -> Result<(), String> {
    if linux_current_uid() != Some(0) {
        return Err("linux-network-helper-requires-root".to_string());
    }
    if !PathBuf::from("/sys/fs/cgroup/cgroup.controllers").is_file() {
        return Err("cgroup-v2-required".to_string());
    }
    let nft = linux_nft_command().ok_or_else(|| "nftables-required".to_string())?;
    fs::create_dir_all(LINUX_NETWORK_CGROUP_ROOT)
        .map_err(|error| format!("cgroup-create-failed:{error}"))?;
    fs::write(
        LINUX_NETWORK_HELPER_PID_PATH,
        std::process::id().to_string(),
    )
    .map_err(|error| format!("helper-pid-write-failed:{error}"))?;

    let mut applied = HashMap::<u32, u64>::new();
    loop {
        let mut active_users = HashSet::new();
        if let Ok(entries) = fs::read_dir("/run/user") {
            for entry in entries.flatten() {
                let Some(uid) = entry
                    .file_name()
                    .to_str()
                    .and_then(|value| value.parse::<u32>().ok())
                else {
                    continue;
                };
                let path = linux_runtime_rules_path(uid);
                let Ok(metadata) = fs::metadata(&path) else {
                    continue;
                };
                if metadata.uid() != uid || !metadata.is_file() {
                    continue;
                }
                let Ok(data) = fs::read(&path) else {
                    continue;
                };
                let Ok(rules) = serde_json::from_slice::<Vec<BandwidthLimitRule>>(&data) else {
                    continue;
                };
                active_users.insert(uid);
                linux_move_matching_processes(uid, &rules);
                let fingerprint = linux_hash64(&data);
                if applied.get(&uid) != Some(&fingerprint)
                    && linux_apply_nft_rules(&nft, uid, &rules).is_ok()
                {
                    applied.insert(uid, fingerprint);
                }
            }
        }
        let stale: Vec<u32> = applied
            .keys()
            .copied()
            .filter(|uid| !active_users.contains(uid))
            .collect();
        for uid in stale {
            if linux_apply_nft_rules(&nft, uid, &[]).is_ok() {
                applied.remove(&uid);
            }
        }
        thread::sleep(Duration::from_secs(1));
    }
}

fn validate_bandwidth_limit(value: Option<u64>) -> Result<Option<u64>, String> {
    match value {
        None | Some(0) => Ok(None),
        Some(value) if value < BANDWIDTH_LIMIT_MIN_BPS => {
            Err("bandwidth-limit-below-minimum".to_string())
        }
        Some(value) if value > BANDWIDTH_LIMIT_MAX_BPS => {
            Err("bandwidth-limit-above-maximum".to_string())
        }
        Some(value) => Ok(Some(value)),
    }
}

#[cfg(target_os = "windows")]
#[derive(Debug, PartialEq, Eq)]
struct LimiterServiceResponse {
    status_flags: u32,
    win32_error: u32,
    active_rule_count: u32,
}

#[cfg(target_os = "windows")]
struct OwnedWindowsHandle(windows_sys::Win32::Foundation::HANDLE);

#[cfg(target_os = "windows")]
impl Drop for OwnedWindowsHandle {
    fn drop(&mut self) {
        unsafe {
            let _ = CloseHandle(self.0);
        }
    }
}

#[cfg(target_os = "windows")]
fn append_u16(output: &mut Vec<u8>, value: u16) {
    output.extend_from_slice(&value.to_le_bytes());
}

#[cfg(target_os = "windows")]
fn append_u32(output: &mut Vec<u8>, value: u32) {
    output.extend_from_slice(&value.to_le_bytes());
}

#[cfg(target_os = "windows")]
fn append_u64(output: &mut Vec<u8>, value: u64) {
    output.extend_from_slice(&value.to_le_bytes());
}

#[cfg(target_os = "windows")]
fn read_u16(input: &[u8], offset: usize) -> Option<u16> {
    Some(u16::from_le_bytes(
        input.get(offset..offset + 2)?.try_into().ok()?,
    ))
}

#[cfg(target_os = "windows")]
fn read_u32(input: &[u8], offset: usize) -> Option<u32> {
    Some(u32::from_le_bytes(
        input.get(offset..offset + 4)?.try_into().ok()?,
    ))
}

#[cfg(target_os = "windows")]
fn read_u64(input: &[u8], offset: usize) -> Option<u64> {
    Some(u64::from_le_bytes(
        input.get(offset..offset + 8)?.try_into().ok()?,
    ))
}

#[cfg(target_os = "windows")]
fn fnv1a64(input: &[u8], seed: u64) -> u64 {
    input.iter().fold(seed, |hash, byte| {
        (hash ^ u64::from(*byte)).wrapping_mul(0x0000_0100_0000_01B3)
    })
}

#[cfg(target_os = "windows")]
fn bandwidth_rule_identifier(path: &str) -> [u8; 16] {
    let normalized = normalize_executable_path(path);
    let bytes = normalized.as_bytes();
    let first = fnv1a64(bytes, 0xCBF2_9CE4_8422_2325);
    let second = fnv1a64(bytes, 0x8422_2325_CBF2_9CE4);
    let mut identifier = [0u8; 16];
    identifier[..8].copy_from_slice(&first.to_le_bytes());
    identifier[8..].copy_from_slice(&second.to_le_bytes());
    identifier[6] = (identifier[6] & 0x0F) | 0x50;
    identifier[8] = (identifier[8] & 0x3F) | 0x80;
    identifier
}

#[cfg(target_os = "windows")]
fn serialize_bandwidth_rules(rules: &[BandwidthLimitRule]) -> Result<Vec<u8>, String> {
    let rule_count = u32::try_from(rules.len()).map_err(|_| "too-many-bandwidth-rules")?;
    if rule_count > 4096 {
        return Err("too-many-bandwidth-rules".to_string());
    }

    let mut payload = Vec::new();
    append_u32(&mut payload, rule_count);
    append_u32(&mut payload, 0);
    for rule in rules {
        let path: Vec<u16> = rule.executable_path.encode_utf16().collect();
        let name: Vec<u16> = rule.process_name.encode_utf16().collect();
        let path_len = u32::try_from(path.len()).map_err(|_| "bandwidth-path-too-long")?;
        let name_len = u32::try_from(name.len()).map_err(|_| "bandwidth-name-too-long")?;
        if path_len == 0 || path_len > 32767 || name_len > 32767 {
            return Err("bandwidth-rule-text-too-long".to_string());
        }

        payload.extend_from_slice(&bandwidth_rule_identifier(&rule.executable_path));
        append_u64(&mut payload, rule.download_limit_bps.unwrap_or(0));
        append_u64(&mut payload, rule.upload_limit_bps.unwrap_or(0));
        append_u32(&mut payload, u32::from(rule.enabled && rule.blocked));
        append_u32(&mut payload, path_len);
        append_u32(&mut payload, name_len);
        append_u32(&mut payload, 0);
        for character in path.into_iter().chain(name) {
            append_u16(&mut payload, character);
        }

        if payload.len() > BANDWIDTH_LIMITER_MAX_MESSAGE_SIZE {
            return Err("bandwidth-rules-payload-too-large".to_string());
        }
    }
    Ok(payload)
}

#[cfg(target_os = "windows")]
fn parse_limiter_response(
    response: &[u8],
    expected_command: u16,
    expected_request_id: u64,
) -> Result<LimiterServiceResponse, String> {
    if response.len() != 36
        || read_u32(response, 0) != Some(BANDWIDTH_LIMITER_IPC_MAGIC)
        || read_u16(response, 4) != Some(BANDWIDTH_LIMITER_PROTOCOL_VERSION)
        || read_u16(response, 6) != Some(expected_command)
        || read_u32(response, 8) != Some(16)
        || read_u64(response, 12) != Some(expected_request_id)
        || read_u32(response, 32) != Some(0)
    {
        return Err("invalid-limiter-service-response".to_string());
    }
    Ok(LimiterServiceResponse {
        status_flags: read_u32(response, 20).unwrap_or(0),
        win32_error: read_u32(response, 24).unwrap_or(u32::MAX),
        active_rule_count: read_u32(response, 28).unwrap_or(0),
    })
}

#[cfg(target_os = "windows")]
fn write_windows_handle(
    handle: windows_sys::Win32::Foundation::HANDLE,
    data: &[u8],
) -> Result<(), String> {
    let mut offset = 0usize;
    while offset < data.len() {
        let remaining = u32::try_from(data.len() - offset).unwrap_or(u32::MAX);
        let mut written = 0u32;
        let success = unsafe {
            WriteFile(
                handle,
                data[offset..].as_ptr(),
                remaining,
                &mut written,
                null_mut(),
            )
        };
        if success == 0 || written == 0 {
            return Err(format!("limiter-pipe-write-failed:{}", unsafe {
                GetLastError()
            }));
        }
        offset += written as usize;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn read_windows_handle_exact(
    handle: windows_sys::Win32::Foundation::HANDLE,
    data: &mut [u8],
) -> Result<(), String> {
    let mut offset = 0usize;
    while offset < data.len() {
        let mut read = 0u32;
        let success = unsafe {
            ReadFile(
                handle,
                data[offset..].as_mut_ptr(),
                (data.len() - offset) as u32,
                &mut read,
                null_mut(),
            )
        };
        if success == 0 || read == 0 {
            return Err(format!("limiter-pipe-read-failed:{}", unsafe {
                GetLastError()
            }));
        }
        offset += read as usize;
    }
    Ok(())
}

#[cfg(target_os = "windows")]
fn send_limiter_request(command: u16, payload: &[u8]) -> Result<LimiterServiceResponse, String> {
    if payload.len() > BANDWIDTH_LIMITER_MAX_MESSAGE_SIZE {
        return Err("bandwidth-rules-payload-too-large".to_string());
    }
    let pipe_name = to_wide_null(BANDWIDTH_LIMITER_PIPE_NAME);
    if unsafe { WaitNamedPipeW(pipe_name.as_ptr(), 750) } == 0 {
        return Err(format!("limiter-pipe-unavailable:{}", unsafe {
            GetLastError()
        }));
    }

    let raw_handle = unsafe {
        CreateFileW(
            pipe_name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if raw_handle == INVALID_HANDLE_VALUE {
        return Err(format!("limiter-pipe-open-failed:{}", unsafe {
            GetLastError()
        }));
    }
    let handle = OwnedWindowsHandle(raw_handle);
    let request_id = BANDWIDTH_LIMITER_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let mut request = Vec::with_capacity(20 + payload.len());
    append_u32(&mut request, BANDWIDTH_LIMITER_IPC_MAGIC);
    append_u16(&mut request, BANDWIDTH_LIMITER_PROTOCOL_VERSION);
    append_u16(&mut request, command);
    append_u32(&mut request, payload.len() as u32);
    append_u64(&mut request, request_id);
    request.extend_from_slice(payload);
    write_windows_handle(handle.0, &request)?;

    let mut response = [0u8; 36];
    read_windows_handle_exact(handle.0, &mut response)?;
    parse_limiter_response(&response, command, request_id)
}

#[cfg(target_os = "windows")]
fn send_limiter_usage_request() -> Result<Vec<NetworkApplicationUsage>, String> {
    let pipe_name = to_wide_null(BANDWIDTH_LIMITER_PIPE_NAME);
    if unsafe { WaitNamedPipeW(pipe_name.as_ptr(), 750) } == 0 {
        return Err(format!("limiter-pipe-unavailable:{}", unsafe {
            GetLastError()
        }));
    }

    let raw_handle = unsafe {
        CreateFileW(
            pipe_name.as_ptr(),
            GENERIC_READ | GENERIC_WRITE,
            0,
            null(),
            OPEN_EXISTING,
            FILE_ATTRIBUTE_NORMAL,
            null_mut(),
        )
    };
    if raw_handle == INVALID_HANDLE_VALUE {
        return Err(format!("limiter-pipe-open-failed:{}", unsafe {
            GetLastError()
        }));
    }
    let handle = OwnedWindowsHandle(raw_handle);
    let request_id = BANDWIDTH_LIMITER_REQUEST_ID.fetch_add(1, Ordering::Relaxed);
    let mut request = Vec::with_capacity(20);
    append_u32(&mut request, BANDWIDTH_LIMITER_IPC_MAGIC);
    append_u16(&mut request, BANDWIDTH_LIMITER_PROTOCOL_VERSION);
    append_u16(&mut request, BANDWIDTH_LIMITER_COMMAND_GET_USAGE);
    append_u32(&mut request, 0);
    append_u64(&mut request, request_id);
    write_windows_handle(handle.0, &request)?;

    let mut header = [0u8; 20];
    read_windows_handle_exact(handle.0, &mut header)?;
    let payload_size = read_u32(&header, 8).unwrap_or(u32::MAX) as usize;
    if read_u32(&header, 0) != Some(BANDWIDTH_LIMITER_IPC_MAGIC)
        || read_u16(&header, 4) != Some(BANDWIDTH_LIMITER_PROTOCOL_VERSION)
        || read_u16(&header, 6) != Some(BANDWIDTH_LIMITER_COMMAND_GET_USAGE)
        || read_u64(&header, 12) != Some(request_id)
        || !(16..=BANDWIDTH_LIMITER_MAX_MESSAGE_SIZE).contains(&payload_size)
    {
        return Err("invalid-network-usage-response-header".to_string());
    }

    let mut payload = vec![0u8; payload_size];
    read_windows_handle_exact(handle.0, &mut payload)?;
    let win32_error = read_u32(&payload, 4).unwrap_or(u32::MAX);
    let entry_count = read_u32(&payload, 8).unwrap_or(u32::MAX);
    if win32_error != ERROR_SUCCESS || read_u32(&payload, 12) != Some(0) || entry_count > 64 {
        return Err(format!("network-usage-service-error:{win32_error}"));
    }

    let mut offset = 16usize;
    let mut applications = Vec::with_capacity(entry_count as usize);
    for _ in 0..entry_count {
        if payload.len().saturating_sub(offset) < 20 {
            return Err("truncated-network-usage-entry".to_string());
        }
        let download_bytes = read_u64(&payload, offset).unwrap_or(0);
        let path_chars = read_u32(&payload, offset + 8).unwrap_or(u32::MAX) as usize;
        let name_chars = read_u32(&payload, offset + 12).unwrap_or(u32::MAX) as usize;
        if read_u32(&payload, offset + 16) != Some(0) || path_chars > 32767 || name_chars > 32767 {
            return Err("invalid-network-usage-entry".to_string());
        }
        offset += 20;
        let text_bytes = path_chars
            .checked_add(name_chars)
            .and_then(|value| value.checked_mul(2))
            .ok_or_else(|| "network-usage-text-overflow".to_string())?;
        if payload.len().saturating_sub(offset) < text_bytes {
            return Err("truncated-network-usage-text".to_string());
        }
        let decode = |start: usize, characters: usize| {
            let values = payload[start..start + characters * 2]
                .chunks_exact(2)
                .map(|bytes| u16::from_le_bytes([bytes[0], bytes[1]]))
                .collect::<Vec<_>>();
            String::from_utf16_lossy(&values)
        };
        let path = decode(offset, path_chars);
        offset += path_chars * 2;
        let name = decode(offset, name_chars);
        offset += name_chars * 2;
        let icon_data_url = if path.is_empty() {
            None
        } else {
            windows_process_icon_data_url(&path)
        };
        applications.push(NetworkApplicationUsage {
            name,
            path: (!path.is_empty()).then_some(path),
            icon_data_url,
            download_bytes,
        });
    }
    if offset != payload.len() {
        return Err("unexpected-network-usage-response-data".to_string());
    }
    Ok(applications)
}

#[cfg(target_os = "windows")]
fn replace_limiter_rules(rules: &[BandwidthLimitRule]) -> Result<LimiterServiceResponse, String> {
    let payload = serialize_bandwidth_rules(rules)?;
    send_limiter_request(BANDWIDTH_LIMITER_COMMAND_REPLACE_RULES, &payload)
}

#[cfg(target_os = "windows")]
fn limiter_status_message(response: &LimiterServiceResponse) -> String {
    if response.win32_error != ERROR_SUCCESS {
        return format!("service-error:{}", response.win32_error);
    }
    if response.status_flags & BANDWIDTH_LIMITER_STATUS_SERVICE_READY == 0 {
        "service-not-ready".to_string()
    } else if response.status_flags & BANDWIDTH_LIMITER_STATUS_FIREWALL_READY == 0 {
        "wfp-not-ready".to_string()
    } else {
        "ready".to_string()
    }
}

#[cfg(target_os = "windows")]
fn apply_limiter_response(
    mut status: BandwidthLimiterEngineStatus,
    response: LimiterServiceResponse,
) -> BandwidthLimiterEngineStatus {
    status.ready = response.win32_error == ERROR_SUCCESS
        && response.status_flags & BANDWIDTH_LIMITER_STATUS_READY_MASK
            == BANDWIDTH_LIMITER_STATUS_READY_MASK;
    status.message = limiter_status_message(&response);
    status
}

#[cfg(target_os = "windows")]
fn bandwidth_limiter_engine_status() -> BandwidthLimiterEngineStatus {
    let service_name = to_wide_null(BANDWIDTH_LIMITER_SERVICE_NAME);
    unsafe {
        let manager = OpenSCManagerW(null(), null(), SC_MANAGER_CONNECT);
        if manager.is_null() {
            return BandwidthLimiterEngineStatus {
                platform: "windows".to_string(),
                mode: "windows-wfp".to_string(),
                supported: true,
                installed: false,
                running: false,
                ready: false,
                message: "service-manager-unavailable".to_string(),
            };
        }

        let service = OpenServiceW(manager, service_name.as_ptr(), SERVICE_QUERY_STATUS);
        if service.is_null() {
            let _ = CloseServiceHandle(manager);
            return BandwidthLimiterEngineStatus {
                platform: "windows".to_string(),
                mode: "windows-wfp".to_string(),
                supported: true,
                installed: false,
                running: false,
                ready: false,
                message: "setup-required".to_string(),
            };
        }

        let mut status: SERVICE_STATUS_PROCESS = std::mem::zeroed();
        let mut bytes_needed = 0u32;
        let queried = QueryServiceStatusEx(
            service,
            SC_STATUS_PROCESS_INFO,
            &mut status as *mut SERVICE_STATUS_PROCESS as *mut u8,
            std::mem::size_of::<SERVICE_STATUS_PROCESS>() as u32,
            &mut bytes_needed,
        );
        let _ = CloseServiceHandle(service);
        let _ = CloseServiceHandle(manager);

        let running = queried != 0 && status.dwCurrentState == SERVICE_RUNNING;
        let status = BandwidthLimiterEngineStatus {
            platform: "windows".to_string(),
            mode: "windows-wfp".to_string(),
            supported: true,
            installed: true,
            running,
            ready: false,
            message: if running {
                "service-handshake-required".to_string()
            } else {
                "service-stopped".to_string()
            },
        };
        if !running {
            return status;
        }
        match send_limiter_request(BANDWIDTH_LIMITER_COMMAND_HANDSHAKE, &[]) {
            Ok(response) => apply_limiter_response(status, response),
            Err(_) => BandwidthLimiterEngineStatus {
                ready: false,
                message: "service-handshake-failed".to_string(),
                ..status
            },
        }
    }
}

#[cfg(target_os = "linux")]
fn bandwidth_limiter_engine_status() -> BandwidthLimiterEngineStatus {
    let running = linux_helper_is_running();
    BandwidthLimiterEngineStatus {
        platform: "linux".to_string(),
        mode: "cgroup-nftables".to_string(),
        supported: true,
        installed: PathBuf::from("/etc/systemd/system/pulsenet-network-control.service").is_file()
            || PathBuf::from("/usr/lib/systemd/system/pulsenet-network-control.service").is_file(),
        running,
        ready: running,
        message: if running {
            "ready".to_string()
        } else {
            "linux-helper-stopped".to_string()
        },
    }
}

#[cfg(all(not(target_os = "windows"), not(target_os = "linux")))]
fn bandwidth_limiter_engine_status() -> BandwidthLimiterEngineStatus {
    BandwidthLimiterEngineStatus {
        platform: env::consts::OS.to_string(),
        mode: "unavailable".to_string(),
        supported: false,
        installed: false,
        running: false,
        ready: false,
        message: "platform-engine-pending".to_string(),
    }
}

fn bandwidth_limiter_state(app: &tauri::AppHandle) -> Result<BandwidthLimiterState, String> {
    let rules = load_bandwidth_limit_rules(app)?;
    #[cfg(target_os = "linux")]
    {
        let data = serde_json::to_vec_pretty(&rules).map_err(|error| error.to_string())?;
        write_linux_network_rules(&data)?;
    }
    let engine = bandwidth_limiter_engine_status();
    #[cfg(target_os = "windows")]
    let engine = if engine.running {
        match replace_limiter_rules(&rules) {
            Ok(response) => apply_limiter_response(engine, response),
            Err(_) => BandwidthLimiterEngineStatus {
                ready: false,
                message: "service-sync-failed".to_string(),
                ..engine
            },
        }
    } else {
        engine
    };
    Ok(BandwidthLimiterState { engine, rules })
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

fn empty_network_usage_snapshot(error: Option<String>) -> NetworkUsageSnapshot {
    NetworkUsageSnapshot {
        timestamp_ms: now_millis(),
        received_bytes: 0,
        sent_bytes: 0,
        adapters: vec![],
        processes: vec![],
        applications: vec![],
        error,
    }
}

fn network_usage_cache() -> &'static Mutex<Option<(u128, NetworkUsageSnapshot)>> {
    static CACHE: OnceLock<Mutex<Option<(u128, NetworkUsageSnapshot)>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(None))
}

fn get_cached_network_usage_snapshot() -> NetworkUsageSnapshot {
    let now = now_millis();
    if let Ok(guard) = network_usage_cache().lock() {
        if let Some((cached_at, snapshot)) = guard.as_ref() {
            if now.saturating_sub(*cached_at) < NETWORK_USAGE_CACHE_TTL_MS {
                return snapshot.clone();
            }
        }
    }

    let snapshot = get_platform_network_usage_snapshot();
    if let Ok(mut guard) = network_usage_cache().lock() {
        *guard = Some((now_millis(), snapshot.clone()));
    }
    snapshot
}

fn update_network_application_usage_state(
    state: PersistedNetworkApplicationUsageState,
    current: &[NetworkApplicationUsage],
) -> PersistedNetworkApplicationUsageState {
    let reset_pending = state.reset_pending;
    let mut persisted = state
        .applications
        .into_iter()
        .map(|application| (application.key.clone(), application))
        .collect::<HashMap<_, _>>();

    for application in current {
        let key = network_application_usage_key(&application.name, application.path.as_deref());
        if reset_pending {
            persisted.insert(
                key.clone(),
                PersistedNetworkApplicationUsage {
                    key,
                    name: application.name.clone(),
                    path: application.path.clone(),
                    total_download_bytes: 0,
                    last_helper_download_bytes: application.download_bytes,
                },
            );
        } else if let Some(existing) = persisted.get_mut(&key) {
            let delta = if application.download_bytes >= existing.last_helper_download_bytes {
                application
                    .download_bytes
                    .saturating_sub(existing.last_helper_download_bytes)
            } else {
                application.download_bytes
            };
            existing.total_download_bytes = existing.total_download_bytes.saturating_add(delta);
            existing.last_helper_download_bytes = application.download_bytes;
            existing.name = application.name.clone();
            existing.path = application.path.clone();
        } else {
            persisted.insert(
                key.clone(),
                PersistedNetworkApplicationUsage {
                    key,
                    name: application.name.clone(),
                    path: application.path.clone(),
                    total_download_bytes: application.download_bytes,
                    last_helper_download_bytes: application.download_bytes,
                },
            );
        }
    }

    let mut applications = persisted.into_values().collect::<Vec<_>>();
    applications.sort_by(|left, right| {
        right
            .total_download_bytes
            .cmp(&left.total_download_bytes)
            .then_with(|| left.name.to_lowercase().cmp(&right.name.to_lowercase()))
    });

    PersistedNetworkApplicationUsageState {
        reset_pending: reset_pending && current.is_empty(),
        applications,
    }
}

fn merge_network_application_usage_history(
    app: &tauri::AppHandle,
    current: &[NetworkApplicationUsage],
) -> Result<Vec<NetworkApplicationUsage>, String> {
    let _guard = network_application_usage_lock()
        .lock()
        .map_err(|_| "network-usage-history-lock-poisoned".to_string())?;
    let state =
        update_network_application_usage_state(load_network_application_usage_state(app)?, current);
    save_network_application_usage_state(app, &state)?;
    let mut current_icons = current
        .iter()
        .map(|application| {
            (
                network_application_usage_key(&application.name, application.path.as_deref()),
                application.icon_data_url.clone(),
            )
        })
        .collect::<HashMap<_, _>>();

    Ok(state
        .applications
        .into_iter()
        .filter(|application| application.total_download_bytes > 0)
        .map(|application| {
            let icon_data_url = current_icons.remove(&application.key).flatten();
            #[cfg(target_os = "windows")]
            let icon_data_url = icon_data_url.or_else(|| {
                application
                    .path
                    .as_deref()
                    .and_then(windows_process_icon_data_url)
            });
            NetworkApplicationUsage {
                name: application.name,
                path: application.path,
                icon_data_url,
                download_bytes: application.total_download_bytes,
            }
        })
        .collect())
}

#[cfg(target_os = "windows")]
fn reset_network_application_usage_history(app: &tauri::AppHandle) -> Result<(), String> {
    let current = send_limiter_usage_request();
    let _guard = network_application_usage_lock()
        .lock()
        .map_err(|_| "network-usage-history-lock-poisoned".to_string())?;
    let reset_pending = current.is_err();
    let mut applications = current
        .unwrap_or_default()
        .into_iter()
        .map(|application| PersistedNetworkApplicationUsage {
            key: network_application_usage_key(&application.name, application.path.as_deref()),
            name: application.name,
            path: application.path,
            total_download_bytes: 0,
            last_helper_download_bytes: application.download_bytes,
        })
        .collect::<Vec<_>>();
    applications.sort_by(|left, right| left.key.cmp(&right.key));
    save_network_application_usage_state(
        app,
        &PersistedNetworkApplicationUsageState {
            reset_pending,
            applications,
        },
    )
}

#[cfg(not(target_os = "windows"))]
fn reset_network_application_usage_history(app: &tauri::AppHandle) -> Result<(), String> {
    let _guard = network_application_usage_lock()
        .lock()
        .map_err(|_| "network-usage-history-lock-poisoned".to_string())?;
    save_network_application_usage_state(app, &PersistedNetworkApplicationUsageState::default())
}

#[cfg(target_os = "windows")]
fn wide_array_to_string(buffer: &[u16]) -> String {
    let len = buffer
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(buffer.len());
    OsString::from_wide(&buffer[..len])
        .to_string_lossy()
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
unsafe fn wide_ptr_to_string(ptr: *const u16) -> String {
    if ptr.is_null() {
        return String::new();
    }
    let mut len = 0usize;
    while *ptr.add(len) != 0 {
        len += 1;
    }
    OsString::from_wide(std::slice::from_raw_parts(ptr, len))
        .to_string_lossy()
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
unsafe fn c_ptr_to_string(ptr: *const u8) -> String {
    if ptr.is_null() {
        return String::new();
    }
    CStr::from_ptr(ptr as *const i8)
        .to_string_lossy()
        .trim()
        .to_string()
}

#[cfg(target_os = "windows")]
unsafe fn socket_address_ipv4(address: &SOCKET_ADDRESS) -> Option<String> {
    if address.lpSockaddr.is_null()
        || address.iSockaddrLength < std::mem::size_of::<SOCKADDR_IN>() as i32
    {
        return None;
    }
    if (*address.lpSockaddr).sa_family != AF_INET {
        return None;
    }
    let sockaddr = &*(address.lpSockaddr as *const SOCKADDR_IN);
    let raw = sockaddr.sin_addr.S_un.S_addr;
    Some(Ipv4Addr::from(u32::from_be(raw)).to_string())
}

#[cfg(target_os = "windows")]
fn aligned_windows_api_buffer(size: u32) -> Vec<usize> {
    let word_size = std::mem::size_of::<usize>();
    vec![0usize; (size as usize + word_size - 1) / word_size]
}

#[cfg(target_os = "windows")]
fn windows_process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, FALSE, pid);
        if handle.is_null() {
            return None;
        }
        let mut buffer = vec![0u16; 32768];
        let mut size = buffer.len() as u32;
        let ok = QueryFullProcessImageNameW(handle, 0, buffer.as_mut_ptr(), &mut size);
        let _ = CloseHandle(handle);
        if ok == 0 || size == 0 {
            return None;
        }
        Some(
            OsString::from_wide(&buffer[..size as usize])
                .to_string_lossy()
                .to_string(),
        )
    }
}

#[cfg(target_os = "windows")]
fn windows_process_name(pid: u32, path: Option<&str>) -> String {
    path.and_then(|value| {
        PathBuf::from(value)
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
    })
    .filter(|value| !value.is_empty())
    .unwrap_or_else(|| format!("PID {}", pid))
}

#[cfg(target_os = "windows")]
fn process_icon_cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(|| Mutex::new(HashMap::new()))
}

#[cfg(target_os = "windows")]
fn to_wide_null(value: &str) -> Vec<u16> {
    OsString::from(value)
        .encode_wide()
        .chain(std::iter::once(0))
        .collect()
}

#[cfg(target_os = "windows")]
fn png_data_url_from_bgra(width: i32, height: i32, pixels: &[u8]) -> Option<String> {
    if width <= 0 || height <= 0 {
        return None;
    }

    let width = width as usize;
    let height = height as usize;
    let pixel_len = width.checked_mul(height)?.checked_mul(4)?;
    if pixels.len() != pixel_len {
        return None;
    }

    let mut rgba = Vec::with_capacity(pixel_len);
    for pixel in pixels.chunks_exact(4) {
        rgba.extend_from_slice(&[pixel[2], pixel[1], pixel[0], pixel[3]]);
    }

    let mut encoded = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut encoded, width as u32, height as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
    }

    Some(format!(
        "data:image/png;base64,{}",
        general_purpose::STANDARD.encode(encoded)
    ))
}

#[cfg(target_os = "windows")]
fn hicon_to_png_data_url(icon: HICON) -> Option<String> {
    unsafe {
        let mut icon_info: ICONINFO = std::mem::zeroed();
        if GetIconInfo(icon, &mut icon_info) == 0 {
            return None;
        }

        let result = (|| {
            if icon_info.hbmColor.is_null() {
                return None;
            }

            let mut bitmap: BITMAP = std::mem::zeroed();
            if GetObjectW(
                icon_info.hbmColor as _,
                std::mem::size_of::<BITMAP>() as i32,
                &mut bitmap as *mut _ as _,
            ) == 0
            {
                return None;
            }

            if bitmap.bmWidth <= 0 || bitmap.bmHeight <= 0 {
                return None;
            }

            let width = bitmap.bmWidth;
            let height = bitmap.bmHeight;
            let mut bitmap_info = BITMAPINFO {
                bmiHeader: BITMAPINFOHEADER {
                    biSize: std::mem::size_of::<BITMAPINFOHEADER>() as u32,
                    biWidth: width,
                    biHeight: -height,
                    biPlanes: 1,
                    biBitCount: 32,
                    biCompression: BI_RGB as u32,
                    biSizeImage: (width as u32)
                        .saturating_mul(height as u32)
                        .saturating_mul(4),
                    biXPelsPerMeter: 0,
                    biYPelsPerMeter: 0,
                    biClrUsed: 0,
                    biClrImportant: 0,
                },
                bmiColors: [RGBQUAD {
                    rgbBlue: 0,
                    rgbGreen: 0,
                    rgbRed: 0,
                    rgbReserved: 0,
                }],
            };

            let pixel_len = (width as usize)
                .checked_mul(height as usize)?
                .checked_mul(4)?;
            let mut pixels = vec![0u8; pixel_len];
            let hdc = GetDC(null_mut());
            if hdc.is_null() {
                return None;
            }
            let copied = GetDIBits(
                hdc,
                icon_info.hbmColor,
                0,
                height as u32,
                pixels.as_mut_ptr() as _,
                &mut bitmap_info,
                DIB_RGB_COLORS,
            );
            let _ = ReleaseDC(null_mut(), hdc);
            if copied == 0 {
                return None;
            }

            if pixels.chunks_exact(4).all(|pixel| pixel[3] == 0) {
                for pixel in pixels.chunks_exact_mut(4) {
                    if pixel[0] != 0 || pixel[1] != 0 || pixel[2] != 0 {
                        pixel[3] = 255;
                    }
                }
            }

            png_data_url_from_bgra(width, height, &pixels)
        })();

        if !icon_info.hbmColor.is_null() {
            let _ = DeleteObject(icon_info.hbmColor as _);
        }
        if !icon_info.hbmMask.is_null() {
            let _ = DeleteObject(icon_info.hbmMask as _);
        }

        result
    }
}

#[cfg(target_os = "windows")]
fn extract_windows_process_icon(path: &str) -> Option<String> {
    let wide_path = to_wide_null(path);
    unsafe {
        let mut large_icon: HICON = null_mut();
        let count = ExtractIconExW(wide_path.as_ptr(), 0, &mut large_icon, null_mut(), 1);
        if count == 0 || large_icon.is_null() {
            return None;
        }
        let data_url = hicon_to_png_data_url(large_icon);
        let _ = DestroyIcon(large_icon);
        data_url
    }
}

#[cfg(target_os = "windows")]
fn windows_process_icon_data_url(path: &str) -> Option<String> {
    let key = path.to_lowercase();
    if let Ok(cache) = process_icon_cache().lock() {
        if let Some(value) = cache.get(&key) {
            return value.clone();
        }
    }

    let icon = extract_windows_process_icon(path);
    if let Ok(mut cache) = process_icon_cache().lock() {
        if cache.len() > 256 {
            cache.clear();
        }
        cache.insert(key, icon.clone());
    }
    icon
}

#[cfg(target_os = "windows")]
fn add_windows_process_connection(
    processes: &mut HashMap<u32, (u32, HashSet<String>)>,
    pid: u32,
    remote_address: Option<String>,
) {
    if pid == 0 {
        return;
    }
    let entry = processes.entry(pid).or_insert_with(|| (0, HashSet::new()));
    entry.0 = entry.0.saturating_add(1);
    if let Some(address) = remote_address {
        if !address.is_empty() && address != "0.0.0.0" {
            entry.1.insert(address);
        }
    }
}

#[cfg(target_os = "windows")]
fn windows_internet_adapter_names() -> HashSet<String> {
    windows_dns_adapters()
        .into_iter()
        .map(|adapter| adapter.name)
        .collect()
}

#[cfg(target_os = "windows")]
fn windows_adapter_usage() -> Result<Vec<NetworkAdapterUsage>, String> {
    unsafe {
        let internet_adapters = windows_internet_adapter_names();
        let mut table: *mut MIB_IF_TABLE2 = null_mut();
        let result = GetIfTable2(&mut table);
        if result != NO_ERROR {
            return Err(format!("GetIfTable2 failed: {}", result));
        }
        if table.is_null() {
            return Ok(vec![]);
        }

        let rows =
            std::slice::from_raw_parts((*table).Table.as_ptr(), (*table).NumEntries as usize);
        let mut adapters = Vec::new();
        for row in rows {
            let name = wide_array_to_string(&row.Alias).trim().to_string();
            let description = wide_array_to_string(&row.Description);
            let is_vpn = windows_adapter_is_vpn_related(&name, &description, "");
            let media_connected = row.MediaConnectState == MediaConnectStateConnected;
            let has_internet_match =
                internet_adapters.contains(&name) && (!is_vpn || media_connected);
            let fallback_usable = internet_adapters.is_empty()
                && row.OperStatus == IfOperStatusUp
                && row.Type != IF_TYPE_SOFTWARE_LOOPBACK
                && (row.PhysicalAddressLength > 0 || is_vpn)
                && (!is_vpn || media_connected)
                && !windows_adapter_is_excluded(&name, &description, "");

            if name.is_empty() || (!has_internet_match && !fallback_usable) {
                continue;
            }
            adapters.push(NetworkAdapterUsage {
                name,
                received_bytes: row.InOctets,
                sent_bytes: row.OutOctets,
            });
        }
        FreeMibTable(table as _);
        Ok(adapters)
    }
}

#[cfg(target_os = "windows")]
fn windows_process_usage() -> Vec<NetworkProcessUsage> {
    let mut grouped: HashMap<u32, (u32, HashSet<String>)> = HashMap::new();

    unsafe {
        let mut size = 0u32;
        let first = GetExtendedTcpTable(
            null_mut(),
            &mut size,
            FALSE,
            AF_INET as u32,
            TCP_TABLE_OWNER_PID_ALL,
            0,
        );
        if first == ERROR_INSUFFICIENT_BUFFER || first == ERROR_BUFFER_OVERFLOW {
            let mut buffer = aligned_windows_api_buffer(size);
            if GetExtendedTcpTable(
                buffer.as_mut_ptr() as _,
                &mut size,
                FALSE,
                AF_INET as u32,
                TCP_TABLE_OWNER_PID_ALL,
                0,
            ) == ERROR_SUCCESS
            {
                let table = buffer.as_ptr() as *const MIB_TCPTABLE_OWNER_PID;
                let rows = std::slice::from_raw_parts(
                    (*table).table.as_ptr(),
                    (*table).dwNumEntries as usize,
                );
                for row in rows {
                    let remote = Ipv4Addr::from(u32::from_be(row.dwRemoteAddr)).to_string();
                    add_windows_process_connection(&mut grouped, row.dwOwningPid, Some(remote));
                }
            }
        }

        size = 0;
        let first = GetExtendedUdpTable(
            null_mut(),
            &mut size,
            FALSE,
            AF_INET as u32,
            UDP_TABLE_OWNER_PID,
            0,
        );
        if first == ERROR_INSUFFICIENT_BUFFER || first == ERROR_BUFFER_OVERFLOW {
            let mut buffer = aligned_windows_api_buffer(size);
            if GetExtendedUdpTable(
                buffer.as_mut_ptr() as _,
                &mut size,
                FALSE,
                AF_INET as u32,
                UDP_TABLE_OWNER_PID,
                0,
            ) == ERROR_SUCCESS
            {
                let table = buffer.as_ptr() as *const MIB_UDPTABLE_OWNER_PID;
                let rows = std::slice::from_raw_parts(
                    (*table).table.as_ptr(),
                    (*table).dwNumEntries as usize,
                );
                for row in rows {
                    add_windows_process_connection(&mut grouped, row.dwOwningPid, None);
                }
            }
        }
    }

    let mut processes = grouped
        .into_iter()
        .map(|(pid, (connections, remote_addresses))| {
            let path = windows_process_path(pid);
            let name = windows_process_name(pid, path.as_deref());
            let icon_data_url = path.as_deref().and_then(windows_process_icon_data_url);
            let mut remote_addresses = remote_addresses.into_iter().collect::<Vec<String>>();
            remote_addresses.sort();
            remote_addresses.truncate(6);
            NetworkProcessUsage {
                pid,
                name,
                path,
                icon_data_url,
                connections,
                remote_addresses,
            }
        })
        .collect::<Vec<_>>();

    processes.sort_by(|left, right| right.connections.cmp(&left.connections));
    processes.truncate(40);
    processes
}

#[cfg(target_os = "windows")]
fn get_platform_network_usage_snapshot() -> NetworkUsageSnapshot {
    let adapters = match windows_adapter_usage() {
        Ok(adapters) => adapters,
        Err(error) => return empty_network_usage_snapshot(Some(error)),
    };
    let processes = windows_process_usage();
    let applications = send_limiter_usage_request().unwrap_or_default();
    let received_bytes = adapters
        .iter()
        .map(|adapter| adapter.received_bytes)
        .sum::<u64>();
    let sent_bytes = adapters
        .iter()
        .map(|adapter| adapter.sent_bytes)
        .sum::<u64>();

    NetworkUsageSnapshot {
        timestamp_ms: now_millis(),
        received_bytes,
        sent_bytes,
        adapters,
        processes,
        applications,
        error: None,
    }
}

#[cfg(target_os = "linux")]
fn get_platform_network_usage_snapshot() -> NetworkUsageSnapshot {
    let raw = match fs::read_to_string("/proc/net/dev") {
        Ok(value) => value,
        Err(error) => return empty_network_usage_snapshot(Some(error.to_string())),
    };

    let active_devices = linux_active_usage_devices();
    let mut adapters = Vec::new();
    for line in raw.lines().skip(2) {
        let Some((name, stats)) = line.split_once(':') else {
            continue;
        };
        let adapter_name = name.trim().to_string();
        if linux_usage_adapter_is_excluded(&adapter_name) {
            continue;
        }
        if let Some(devices) = active_devices.as_ref() {
            if !devices.contains(&adapter_name) {
                continue;
            }
        } else if !linux_usage_adapter_is_active(&adapter_name) {
            continue;
        }
        let fields: Vec<&str> = stats.split_whitespace().collect();
        if fields.len() < 16 {
            continue;
        }
        let received_bytes = fields[0].parse::<u64>().unwrap_or(0);
        let sent_bytes = fields[8].parse::<u64>().unwrap_or(0);
        adapters.push(NetworkAdapterUsage {
            name: adapter_name,
            received_bytes,
            sent_bytes,
        });
    }

    let received_bytes = adapters
        .iter()
        .map(|adapter| adapter.received_bytes)
        .sum::<u64>();
    let sent_bytes = adapters
        .iter()
        .map(|adapter| adapter.sent_bytes)
        .sum::<u64>();

    let processes = linux_process_usage();

    NetworkUsageSnapshot {
        timestamp_ms: now_millis(),
        received_bytes,
        sent_bytes,
        adapters,
        processes,
        applications: vec![],
        error: None,
    }
}

#[cfg(target_os = "linux")]
fn linux_parse_proc_net_ipv4(value: &str) -> Option<String> {
    let Some((host, _port)) = value.split_once(':') else {
        return None;
    };
    if host.len() != 8 {
        return None;
    }
    let raw = u32::from_str_radix(host, 16).ok()?;
    let ip = Ipv4Addr::from(raw.to_le_bytes());
    if ip.is_unspecified() {
        None
    } else {
        Some(ip.to_string())
    }
}

#[cfg(target_os = "linux")]
fn linux_collect_socket_inodes_from_proc_net(
    socket_map: &mut HashMap<String, HashSet<String>>,
    path: &str,
    parse_ipv4: bool,
) {
    let Ok(raw) = fs::read_to_string(path) else {
        return;
    };
    for line in raw.lines().skip(1) {
        let fields = line.split_whitespace().collect::<Vec<_>>();
        if fields.len() <= 9 {
            continue;
        }
        let inode = fields[9].trim();
        if inode.is_empty() || inode == "0" {
            continue;
        }
        let entry = socket_map.entry(inode.to_string()).or_default();
        if parse_ipv4 {
            if let Some(remote) = fields
                .get(2)
                .and_then(|value| linux_parse_proc_net_ipv4(value))
            {
                entry.insert(remote);
            }
        }
    }
}

#[cfg(target_os = "linux")]
fn linux_socket_inode_map() -> HashMap<String, HashSet<String>> {
    let mut socket_map = HashMap::new();
    linux_collect_socket_inodes_from_proc_net(&mut socket_map, "/proc/net/tcp", true);
    linux_collect_socket_inodes_from_proc_net(&mut socket_map, "/proc/net/udp", true);
    linux_collect_socket_inodes_from_proc_net(&mut socket_map, "/proc/net/tcp6", false);
    linux_collect_socket_inodes_from_proc_net(&mut socket_map, "/proc/net/udp6", false);
    socket_map
}

#[cfg(target_os = "linux")]
fn linux_process_path(pid: u32) -> Option<String> {
    fs::read_link(format!("/proc/{pid}/exe"))
        .ok()
        .map(|path| path.to_string_lossy().to_string())
        .filter(|path| !path.trim().is_empty())
}

#[cfg(target_os = "linux")]
fn linux_process_name(pid: u32, path: Option<&str>) -> String {
    if let Some(path) = path {
        if let Some(name) = std::path::Path::new(path).file_name() {
            let value = name.to_string_lossy().trim().to_string();
            if !value.is_empty() {
                return value;
            }
        }
    }

    fs::read_to_string(format!("/proc/{pid}/comm"))
        .unwrap_or_else(|_| format!("PID {pid}"))
        .trim()
        .to_string()
}

#[cfg(target_os = "linux")]
fn linux_process_socket_inodes(pid: u32) -> Vec<String> {
    let Ok(entries) = fs::read_dir(format!("/proc/{pid}/fd")) else {
        return vec![];
    };
    let mut inodes = Vec::new();
    for entry in entries.flatten() {
        let Ok(target) = fs::read_link(entry.path()) else {
            continue;
        };
        let target = target.to_string_lossy();
        if let Some(inode) = target
            .strip_prefix("socket:[")
            .and_then(|value| value.strip_suffix(']'))
            .filter(|value| !value.is_empty())
        {
            inodes.push(inode.to_string());
        }
    }
    inodes
}

#[cfg(target_os = "linux")]
fn linux_process_usage() -> Vec<NetworkProcessUsage> {
    let socket_map = linux_socket_inode_map();
    if socket_map.is_empty() {
        return vec![];
    }

    let Ok(entries) = fs::read_dir("/proc") else {
        return vec![];
    };
    let mut grouped: HashMap<u32, (u32, HashSet<String>)> = HashMap::new();

    for entry in entries.flatten() {
        let Some(pid) = entry
            .file_name()
            .to_string_lossy()
            .parse::<u32>()
            .ok()
            .filter(|pid| *pid > 0)
        else {
            continue;
        };

        for inode in linux_process_socket_inodes(pid) {
            let Some(remotes) = socket_map.get(&inode) else {
                continue;
            };
            let process = grouped.entry(pid).or_insert_with(|| (0, HashSet::new()));
            process.0 = process.0.saturating_add(1);
            process.1.extend(remotes.iter().cloned());
        }
    }

    let mut processes = grouped
        .into_iter()
        .map(|(pid, (connections, remote_addresses))| {
            let path = linux_process_path(pid);
            let name = linux_process_name(pid, path.as_deref());
            let mut remote_addresses = remote_addresses.into_iter().collect::<Vec<_>>();
            remote_addresses.sort();
            remote_addresses.truncate(6);
            NetworkProcessUsage {
                pid,
                name,
                path,
                icon_data_url: None,
                connections,
                remote_addresses,
            }
        })
        .collect::<Vec<_>>();

    processes.sort_by(|left, right| right.connections.cmp(&left.connections));
    processes.truncate(40);
    processes
}

#[cfg(target_os = "linux")]
fn linux_active_usage_devices() -> Option<HashSet<String>> {
    let conn = linux_nm_system_connection().ok()?;
    let active_connections = linux_nm_active_connection_paths(&conn).ok()?;
    let mut devices = HashSet::new();

    for active_path in active_connections {
        let Ok(Some(active)) = linux_nm_active_connection(&conn, &active_path) else {
            continue;
        };
        if !linux_connection_type_supported(&active.connection_type)
            || linux_connection_is_excluded(
                &active.name,
                active.device_interface.as_deref().unwrap_or(""),
                &active.connection_type,
            )
        {
            continue;
        }
        if let Some(device) = active.device_interface {
            devices.insert(device);
        }
    }

    Some(devices)
}

#[cfg(target_os = "linux")]
fn linux_usage_adapter_is_active(name: &str) -> bool {
    let path = PathBuf::from("/sys/class/net").join(name).join("operstate");
    let state = fs::read_to_string(path)
        .unwrap_or_default()
        .trim()
        .to_lowercase();
    !matches!(
        state.as_str(),
        "down" | "notpresent" | "lowerlayerdown" | "dormant"
    )
}

#[cfg(target_os = "linux")]
fn linux_usage_adapter_is_excluded(name: &str) -> bool {
    let text = name.to_lowercase();
    ["lo", "docker", "veth", "bridge", "br-", "virbr", "dummy"]
        .iter()
        .any(|needle| text == *needle || text.contains(needle))
}

#[cfg(not(any(target_os = "windows", target_os = "linux")))]
fn get_platform_network_usage_snapshot() -> NetworkUsageSnapshot {
    empty_network_usage_snapshot(Some("unsupported-platform".to_string()))
}

#[cfg(target_os = "linux")]
const NM_DEST: &str = "org.freedesktop.NetworkManager";
#[cfg(target_os = "linux")]
const NM_ROOT: &str = "/org/freedesktop/NetworkManager";
#[cfg(target_os = "linux")]
const NM_ROOT_IFACE: &str = "org.freedesktop.NetworkManager";
#[cfg(target_os = "linux")]
const NM_ACTIVE_IFACE: &str = "org.freedesktop.NetworkManager.Connection.Active";
#[cfg(target_os = "linux")]
const NM_DEVICE_IFACE: &str = "org.freedesktop.NetworkManager.Device";
#[cfg(target_os = "linux")]
const NM_IP4_IFACE: &str = "org.freedesktop.NetworkManager.IP4Config";
#[cfg(target_os = "linux")]
const NM_SETTINGS: &str = "/org/freedesktop/NetworkManager/Settings";
#[cfg(target_os = "linux")]
const NM_SETTINGS_IFACE: &str = "org.freedesktop.NetworkManager.Settings";
#[cfg(target_os = "linux")]
const NM_SETTINGS_CONNECTION_IFACE: &str = "org.freedesktop.NetworkManager.Settings.Connection";
#[cfg(target_os = "linux")]
const DBUS_TIMEOUT_SECS: u64 = 4;

#[cfg(target_os = "linux")]
type NmSettingsMap = StdHashMap<String, PropMap>;

#[cfg(target_os = "linux")]
struct LinuxNmActiveConnection {
    name: String,
    uuid: String,
    connection_type: String,
    connection_path: DbusPath<'static>,
    active_path: DbusPath<'static>,
    device_path: Option<DbusPath<'static>>,
    device_interface: Option<String>,
    state: u32,
    dns: Vec<String>,
    ipv4: Option<String>,
    gateway: Option<String>,
}

#[cfg(target_os = "linux")]
fn linux_dbus_error(error: dbus::Error) -> String {
    let text = error.to_string();
    if text.to_lowercase().contains("not authorized")
        || text.to_lowercase().contains("permission")
        || text.to_lowercase().contains("access denied")
    {
        "permission-required".to_string()
    } else {
        text
    }
}

#[cfg(target_os = "linux")]
fn linux_nm_system_connection() -> Result<DbusConnection, String> {
    DbusConnection::new_system().map_err(linux_dbus_error)
}

#[cfg(target_os = "linux")]
fn linux_nm_active_connection_paths(
    conn: &DbusConnection,
) -> Result<Vec<DbusPath<'static>>, String> {
    let proxy = conn.with_proxy(NM_DEST, NM_ROOT, Duration::from_secs(DBUS_TIMEOUT_SECS));
    proxy
        .get(NM_ROOT_IFACE, "ActiveConnections")
        .map_err(linux_dbus_error)
}

#[cfg(target_os = "linux")]
fn linux_nm_active_connection(
    conn: &DbusConnection,
    active_path: &DbusPath<'static>,
) -> Result<Option<LinuxNmActiveConnection>, String> {
    let proxy = conn.with_proxy(
        NM_DEST,
        active_path.clone(),
        Duration::from_secs(DBUS_TIMEOUT_SECS),
    );
    let name: String = proxy.get(NM_ACTIVE_IFACE, "Id").map_err(linux_dbus_error)?;
    let uuid: String = proxy
        .get(NM_ACTIVE_IFACE, "Uuid")
        .map_err(linux_dbus_error)?;
    let connection_type: String = proxy
        .get(NM_ACTIVE_IFACE, "Type")
        .map_err(linux_dbus_error)?;
    let connection_path: DbusPath<'static> = proxy
        .get(NM_ACTIVE_IFACE, "Connection")
        .map_err(linux_dbus_error)?;
    let devices: Vec<DbusPath<'static>> = proxy
        .get(NM_ACTIVE_IFACE, "Devices")
        .map_err(linux_dbus_error)?;
    let state: u32 = proxy
        .get(NM_ACTIVE_IFACE, "State")
        .map_err(linux_dbus_error)?;

    let device_path = devices.into_iter().next();
    let mut device_interface = None;
    let mut dns = Vec::new();
    let mut ipv4 = None;
    let mut gateway = None;

    if let Some(path) = device_path.as_ref() {
        let device_proxy = conn.with_proxy(
            NM_DEST,
            path.clone(),
            Duration::from_secs(DBUS_TIMEOUT_SECS),
        );
        device_interface = device_proxy.get(NM_DEVICE_IFACE, "Interface").ok();
        let device_state = device_proxy
            .get::<u32>(NM_DEVICE_IFACE, "State")
            .unwrap_or_default();
        if device_state < 100 {
            return Ok(None);
        }
        let ip4_path = device_proxy
            .get::<DbusPath<'static>>(NM_DEVICE_IFACE, "Ip4Config")
            .ok();
        if let Some(ip4_path) = ip4_path.filter(|path| path.to_string() != "/") {
            let details = linux_nm_ip4_config(conn, &ip4_path);
            dns = details.0;
            ipv4 = details.1;
            gateway = details.2;
        }
    }

    Ok(Some(LinuxNmActiveConnection {
        name,
        uuid,
        connection_type,
        connection_path,
        active_path: active_path.clone(),
        device_path,
        device_interface,
        state,
        dns,
        ipv4,
        gateway,
    }))
}

#[cfg(target_os = "linux")]
fn linux_nm_ip4_config(
    conn: &DbusConnection,
    path: &DbusPath<'static>,
) -> (Vec<String>, Option<String>, Option<String>) {
    let proxy = conn.with_proxy(
        NM_DEST,
        path.clone(),
        Duration::from_secs(DBUS_TIMEOUT_SECS),
    );
    let mut dns = Vec::new();

    if let Ok(nameserver_data) = proxy.get::<Vec<PropMap>>(NM_IP4_IFACE, "NameserverData") {
        for item in nameserver_data {
            if let Some(address) = linux_prop_string(&item, "address") {
                dns.push(address);
            }
        }
    }

    if dns.is_empty() {
        if let Ok(nameservers) = proxy.get::<Vec<u32>>(NM_IP4_IFACE, "Nameservers") {
            dns.extend(nameservers.into_iter().map(linux_nm_ipv4_from_u32));
        }
    }

    let ipv4 = proxy
        .get::<Vec<PropMap>>(NM_IP4_IFACE, "AddressData")
        .ok()
        .and_then(|items| {
            items
                .into_iter()
                .find_map(|item| linux_prop_string(&item, "address"))
        });
    let gateway = proxy
        .get::<String>(NM_IP4_IFACE, "Gateway")
        .ok()
        .filter(|value| !value.trim().is_empty());

    (dns, ipv4, gateway)
}

#[cfg(target_os = "linux")]
fn linux_prop_string(map: &PropMap, key: &str) -> Option<String> {
    map.get(key)
        .and_then(|value| value.0.as_str())
        .map(|value| value.to_string())
        .filter(|value| !value.trim().is_empty())
}

#[cfg(target_os = "linux")]
fn linux_variant<T: RefArg + 'static>(value: T) -> Variant<Box<dyn RefArg + 'static>> {
    Variant(Box::new(value))
}

#[cfg(target_os = "linux")]
fn linux_nm_ipv4_from_u32(value: u32) -> String {
    Ipv4Addr::from(value.to_ne_bytes()).to_string()
}

#[cfg(target_os = "linux")]
fn linux_nm_ipv4_to_u32(value: &str) -> Result<u32, String> {
    let ip = value
        .parse::<Ipv4Addr>()
        .map_err(|_| "invalid-input".to_string())?;
    Ok(u32::from_ne_bytes(ip.octets()))
}

#[cfg(target_os = "linux")]
fn linux_nm_active_connections(
    conn: &DbusConnection,
) -> Result<Vec<LinuxNmActiveConnection>, String> {
    let mut values = Vec::new();
    for path in linux_nm_active_connection_paths(conn)? {
        if let Some(active) = linux_nm_active_connection(conn, &path)? {
            values.push(active);
        }
    }
    Ok(values)
}

#[cfg(target_os = "linux")]
fn linux_nm_get_settings(
    conn: &DbusConnection,
    connection_path: &DbusPath<'static>,
) -> Result<NmSettingsMap, String> {
    let proxy = conn.with_proxy(
        NM_DEST,
        connection_path.clone(),
        Duration::from_secs(DBUS_TIMEOUT_SECS),
    );
    let (settings,): (NmSettingsMap,) = proxy
        .method_call(NM_SETTINGS_CONNECTION_IFACE, "GetSettings", ())
        .map_err(linux_dbus_error)?;
    Ok(settings)
}

#[cfg(target_os = "linux")]
fn linux_nm_update_settings(
    conn: &DbusConnection,
    connection_path: &DbusPath<'static>,
    settings: NmSettingsMap,
) -> Result<(), String> {
    let proxy = conn.with_proxy(
        NM_DEST,
        connection_path.clone(),
        Duration::from_secs(DBUS_TIMEOUT_SECS),
    );
    proxy
        .method_call(NM_SETTINGS_CONNECTION_IFACE, "Update", (settings,))
        .map_err(linux_dbus_error)
}

#[cfg(target_os = "linux")]
fn linux_nm_connection_path_from_id(
    conn: &DbusConnection,
    adapter_id: &str,
) -> Result<DbusPath<'static>, String> {
    if adapter_id.starts_with('/') {
        return DbusPath::new(adapter_id.to_string()).map_err(|_| "invalid-input".to_string());
    }

    let proxy = conn.with_proxy(NM_DEST, NM_SETTINGS, Duration::from_secs(DBUS_TIMEOUT_SECS));
    let (paths,): (Vec<DbusPath<'static>>,) = proxy
        .method_call(NM_SETTINGS_IFACE, "ListConnections", ())
        .map_err(linux_dbus_error)?;
    for path in paths {
        let settings = linux_nm_get_settings(conn, &path)?;
        let Some(connection) = settings.get("connection") else {
            continue;
        };
        if linux_prop_string(connection, "uuid").as_deref() == Some(adapter_id) {
            return Ok(path);
        }
    }

    Err("adapter-not-found".to_string())
}

#[cfg(target_os = "linux")]
fn linux_nm_apply_connection(
    conn: &DbusConnection,
    connection_path: &DbusPath<'static>,
) -> Result<(), String> {
    let active = linux_nm_active_connections(conn)?
        .into_iter()
        .find(|item| item.connection_path == *connection_path);
    let Some(active) = active else {
        return Ok(());
    };
    let Some(device_path) = active.device_path else {
        return Ok(());
    };
    let root = conn.with_proxy(NM_DEST, NM_ROOT, Duration::from_secs(DBUS_TIMEOUT_SECS));
    let _: () = root
        .method_call(NM_ROOT_IFACE, "DeactivateConnection", (active.active_path,))
        .map_err(linux_dbus_error)?;
    let empty_path = DbusPath::new("/").map_err(|_| "invalid-input".to_string())?;
    let _: (DbusPath<'static>,) = root
        .method_call(
            NM_ROOT_IFACE,
            "ActivateConnection",
            (connection_path.clone(), device_path, empty_path),
        )
        .map_err(linux_dbus_error)?;
    Ok(())
}

#[cfg(target_os = "linux")]
fn linux_connection_type_supported(connection_type: &str) -> bool {
    matches!(
        connection_type.trim().to_lowercase().as_str(),
        "ethernet" | "wifi" | "802-3-ethernet" | "802-11-wireless" | "vpn" | "wireguard"
    )
}

#[cfg(target_os = "linux")]
fn linux_connection_is_excluded(name: &str, device: &str, connection_type: &str) -> bool {
    let text = format!("{} {} {}", name, device, connection_type).to_lowercase();
    [
        "docker", "veth", "bridge", "br-", "virbr", "loopback", "dummy",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(target_os = "windows")]
fn windows_adapter_is_vpn_related(name: &str, description: &str, adapter_name: &str) -> bool {
    let text = format!("{} {} {}", name, description, adapter_name).to_lowercase();
    [
        "vpn",
        "openvpn",
        "wireguard",
        "wintun",
        "tap",
        "tun",
        "tunnel",
        "tailscale",
        "zerotier",
        "hamachi",
        "expressvpn",
        "nordvpn",
        "protonvpn",
        "surfshark",
        "wiresock",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(target_os = "windows")]
fn windows_adapter_is_excluded(name: &str, description: &str, adapter_name: &str) -> bool {
    let text = format!("{} {} {}", name, description, adapter_name).to_lowercase();
    [
        "bluetooth",
        "virtualbox",
        "vmware",
        "hyper-v",
        "loopback",
        "pseudo",
    ]
    .iter()
    .any(|needle| text.contains(needle))
}

#[cfg(target_os = "windows")]
fn windows_collect_dns_servers(
    mut node: *mut windows_sys::Win32::NetworkManagement::IpHelper::IP_ADAPTER_DNS_SERVER_ADDRESS_XP,
) -> Vec<String> {
    let mut values = Vec::new();
    unsafe {
        while !node.is_null() {
            if let Some(address) = socket_address_ipv4(&(*node).Address) {
                values.push(address);
            }
            node = (*node).Next;
        }
    }
    values
}

#[cfg(target_os = "windows")]
fn windows_first_unicast_ipv4(
    mut node: *mut windows_sys::Win32::NetworkManagement::IpHelper::IP_ADAPTER_UNICAST_ADDRESS_LH,
) -> Option<String> {
    unsafe {
        while !node.is_null() {
            if let Some(address) = socket_address_ipv4(&(*node).Address) {
                return Some(address);
            }
            node = (*node).Next;
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_first_gateway_ipv4(
    mut node: *mut windows_sys::Win32::NetworkManagement::IpHelper::IP_ADAPTER_GATEWAY_ADDRESS_LH,
) -> Option<String> {
    unsafe {
        while !node.is_null() {
            if let Some(address) = socket_address_ipv4(&(*node).Address) {
                return Some(address);
            }
            node = (*node).Next;
        }
    }
    None
}

#[cfg(target_os = "windows")]
fn windows_dns_adapters() -> Vec<DnsAdapter> {
    unsafe {
        let mut size = 15_000u32;
        let mut buffer = aligned_windows_api_buffer(size);
        let mut result = GetAdaptersAddresses(
            AF_INET as u32,
            GAA_FLAG_INCLUDE_GATEWAYS,
            null(),
            buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
            &mut size,
        );

        if result == ERROR_BUFFER_OVERFLOW || result == ERROR_INSUFFICIENT_BUFFER {
            buffer = aligned_windows_api_buffer(size);
            result = GetAdaptersAddresses(
                AF_INET as u32,
                GAA_FLAG_INCLUDE_GATEWAYS,
                null(),
                buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH,
                &mut size,
            );
        }

        if result != ERROR_SUCCESS {
            return vec![];
        }

        let mut adapters = Vec::new();
        let mut adapter = buffer.as_mut_ptr() as *mut IP_ADAPTER_ADDRESSES_LH;
        while !adapter.is_null() {
            let friendly_name = wide_ptr_to_string((*adapter).FriendlyName);
            let description = wide_ptr_to_string((*adapter).Description);
            let adapter_name = c_ptr_to_string((*adapter).AdapterName);
            let dns = windows_collect_dns_servers((*adapter).FirstDnsServerAddress);
            let ipv4 = windows_first_unicast_ipv4((*adapter).FirstUnicastAddress);
            let gateway = windows_first_gateway_ipv4((*adapter).FirstGatewayAddress);
            let is_vpn =
                windows_adapter_is_vpn_related(&friendly_name, &description, &adapter_name);

            let is_usable = (*adapter).OperStatus == IfOperStatusUp
                && (*adapter).IfType != IF_TYPE_SOFTWARE_LOOPBACK
                && gateway.is_some()
                && ((*adapter).PhysicalAddressLength > 0 || is_vpn)
                && !windows_adapter_is_excluded(&friendly_name, &description, &adapter_name);

            if is_usable && !friendly_name.is_empty() {
                adapters.push(DnsAdapter {
                    id: friendly_name.clone(),
                    name: friendly_name,
                    dns,
                    ipv4,
                    gateway,
                    status: Some("Up".to_string()),
                });
            }

            adapter = (*adapter).Next;
        }
        adapters.sort_by(|left, right| left.name.cmp(&right.name));
        adapters
    }
}

#[cfg(target_os = "windows")]
fn run_windows_command(program: &str, args: &[String]) -> Result<(), String> {
    let output = Command::new(program)
        .creation_flags(CREATE_NO_WINDOW)
        .args(args)
        .output()
        .map_err(|error| error.to_string())?;

    if output.status.success() {
        Ok(())
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

#[cfg(target_os = "windows")]
fn run_netsh(args: Vec<String>) -> Result<(), String> {
    run_windows_command("netsh", &args)
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

        let adapters = windows_dns_adapters();
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

        let conn = match linux_nm_system_connection() {
            Ok(conn) => conn,
            Err(_) => return vec![],
        };

        let mut adapters = Vec::new();
        let active_connections = match linux_nm_active_connections(&conn) {
            Ok(values) => values,
            Err(_) => return vec![],
        };
        for active in active_connections {
            let device = active.device_interface.as_deref().unwrap_or("");
            if active.name.is_empty()
                || active.uuid.is_empty()
                || device.is_empty()
                || !linux_connection_type_supported(&active.connection_type)
                || linux_connection_is_excluded(&active.name, device, &active.connection_type)
            {
                continue;
            }

            let name = if device.is_empty() {
                active.name.clone()
            } else {
                format!("{} ({})", active.name, device)
            };
            adapters.push(DnsAdapter {
                id: active.connection_path.to_string(),
                name,
                dns: active.dns,
                ipv4: active.ipv4,
                gateway: active.gateway,
                status: Some(
                    if active.state >= 2 {
                        "Activated"
                    } else {
                        "Activating"
                    }
                    .to_string(),
                ),
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

        let set_result = run_netsh(vec![
            "interface".to_string(),
            "ipv4".to_string(),
            "set".to_string(),
            "dnsservers".to_string(),
            format!("name={}", adapter),
            "static".to_string(),
            primary.to_string(),
            "primary".to_string(),
            "validate=no".to_string(),
        ]);

        let result = set_result.and_then(|_| {
            let Some(secondary) = secondary_dns else {
                return Ok(());
            };
            let trimmed = secondary.trim();
            if trimmed.is_empty() {
                return Ok(());
            }
            run_netsh(vec![
                "interface".to_string(),
                "ipv4".to_string(),
                "add".to_string(),
                "dnsservers".to_string(),
                format!("name={}", adapter),
                format!("address={}", trimmed),
                "index=2".to_string(),
                "validate=no".to_string(),
            ])
        });

        match result {
            Ok(()) => {
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
        let adapter_id = adapter_name.trim();
        let primary = primary_dns.trim();
        if adapter_id.is_empty() || primary.is_empty() {
            return DnsManagerResult {
                success: false,
                error: Some("invalid-input".to_string()),
            };
        }

        let conn = match linux_nm_system_connection() {
            Ok(conn) => conn,
            Err(error) => {
                return DnsManagerResult {
                    success: false,
                    error: Some(error),
                }
            }
        };
        let connection_path = match linux_nm_connection_path_from_id(&conn, adapter_id) {
            Ok(path) => path,
            Err(error) => {
                return DnsManagerResult {
                    success: false,
                    error: Some(error),
                }
            }
        };
        let mut dns_servers = vec![primary.to_string()];
        if let Some(secondary) = secondary_dns {
            let secondary = secondary.trim();
            if !secondary.is_empty() {
                dns_servers.push(secondary.to_string());
            }
        }

        let result = (|| {
            let mut settings = linux_nm_get_settings(&conn, &connection_path)?;
            let ipv4 = settings.entry("ipv4".to_string()).or_default();
            let dns_values = dns_servers
                .iter()
                .map(|server| linux_nm_ipv4_to_u32(server))
                .collect::<Result<Vec<u32>, String>>()?;
            ipv4.insert("ignore-auto-dns".to_string(), linux_variant(true));
            ipv4.insert("dns".to_string(), linux_variant(dns_values));
            linux_nm_update_settings(&conn, &connection_path, settings)?;
            linux_nm_apply_connection(&conn, &connection_path)
        })();

        match result {
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
        match run_netsh(vec![
            "interface".to_string(),
            "ipv4".to_string(),
            "set".to_string(),
            "dnsservers".to_string(),
            format!("name={}", adapter),
            "source=dhcp".to_string(),
        ]) {
            Ok(()) => {
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
        let adapter_id = adapter_name.trim();
        if adapter_id.is_empty() {
            return DnsManagerResult {
                success: false,
                error: Some("invalid-input".to_string()),
            };
        }

        let conn = match linux_nm_system_connection() {
            Ok(conn) => conn,
            Err(error) => {
                return DnsManagerResult {
                    success: false,
                    error: Some(error),
                }
            }
        };
        let connection_path = match linux_nm_connection_path_from_id(&conn, adapter_id) {
            Ok(path) => path,
            Err(error) => {
                return DnsManagerResult {
                    success: false,
                    error: Some(error),
                }
            }
        };

        let result = (|| {
            let mut settings = linux_nm_get_settings(&conn, &connection_path)?;
            let ipv4 = settings.entry("ipv4".to_string()).or_default();
            ipv4.insert("ignore-auto-dns".to_string(), linux_variant(false));
            ipv4.insert("dns".to_string(), linux_variant(Vec::<u32>::new()));
            linux_nm_update_settings(&conn, &connection_path, settings)?;
            linux_nm_apply_connection(&conn, &connection_path)
        })();

        match result {
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
async fn get_network_usage_snapshot(app: AppHandle) -> NetworkUsageSnapshot {
    tokio::task::spawn_blocking(move || {
        let mut snapshot = get_cached_network_usage_snapshot();
        match merge_network_application_usage_history(&app, &snapshot.applications) {
            Ok(applications) => snapshot.applications = applications,
            Err(error) => snapshot.error = Some(error),
        }
        snapshot
    })
    .await
    .unwrap_or_else(|error| empty_network_usage_snapshot(Some(error.to_string())))
}

#[tauri::command]
async fn reset_network_application_usage(app: AppHandle) -> Result<(), String> {
    tokio::task::spawn_blocking(move || reset_network_application_usage_history(&app))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
fn get_bandwidth_limiter_state(app: AppHandle) -> Result<BandwidthLimiterState, String> {
    bandwidth_limiter_state(&app)
}

#[tauri::command]
fn upsert_bandwidth_limit_rule(
    app: AppHandle,
    rule: BandwidthLimitRuleInput,
) -> Result<BandwidthLimiterState, String> {
    let executable_path = rule.executable_path.trim().to_string();
    if executable_path.is_empty() || !PathBuf::from(&executable_path).is_absolute() {
        return Err("invalid-executable-path".to_string());
    }

    let download_limit_bps = validate_bandwidth_limit(rule.download_limit_bps)?;
    let upload_limit_bps = validate_bandwidth_limit(rule.upload_limit_bps)?;
    let blocked = rule.blocked.unwrap_or(false);
    if !blocked && download_limit_bps.is_none() && upload_limit_bps.is_none() {
        return Err("bandwidth-limit-required".to_string());
    }

    let id = normalize_executable_path(&executable_path);
    let process_name = rule.process_name.trim();
    let process_name = if process_name.is_empty() {
        PathBuf::from(&executable_path)
            .file_stem()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| "Application".to_string())
    } else {
        process_name.to_string()
    };

    let mut rules = load_bandwidth_limit_rules(&app)?;
    let next_rule = BandwidthLimitRule {
        id: id.clone(),
        executable_path,
        process_name,
        download_limit_bps,
        upload_limit_bps,
        blocked,
        enabled: rule.enabled.unwrap_or(true),
        updated_at_ms: now_millis(),
    };
    if let Some(existing) = rules.iter_mut().find(|item| item.id == id) {
        *existing = next_rule;
    } else {
        rules.push(next_rule);
    }
    save_bandwidth_limit_rules(&app, &rules)?;
    bandwidth_limiter_state(&app)
}

#[tauri::command]
fn remove_bandwidth_limit_rule(
    app: AppHandle,
    executable_path: String,
) -> Result<BandwidthLimiterState, String> {
    let id = normalize_executable_path(&executable_path);
    let mut rules = load_bandwidth_limit_rules(&app)?;
    rules.retain(|rule| rule.id != id);
    save_bandwidth_limit_rules(&app, &rules)?;
    bandwidth_limiter_state(&app)
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

#[tauri::command]
fn toggle_window_maximize(window: Window) -> bool {
    if window.is_maximized().unwrap_or(false) {
        let _ = window.unmaximize();
    } else {
        let _ = window.maximize();
    }
    window.is_maximized().unwrap_or(false)
}

#[tauri::command]
fn is_window_maximized(window: Window) -> bool {
    window.is_maximized().unwrap_or(false)
}

#[cfg(test)]
mod bandwidth_limiter_tests {
    use super::*;

    fn test_application_usage(download_bytes: u64) -> NetworkApplicationUsage {
        NetworkApplicationUsage {
            name: "Example.exe".to_string(),
            path: Some(r"C:\Apps\Example.exe".to_string()),
            icon_data_url: None,
            download_bytes,
        }
    }

    #[test]
    fn accumulates_only_new_application_download_bytes() {
        let state = update_network_application_usage_state(
            PersistedNetworkApplicationUsageState::default(),
            &[test_application_usage(100)],
        );
        let state = update_network_application_usage_state(state, &[test_application_usage(140)]);

        assert_eq!(state.applications.len(), 1);
        assert_eq!(state.applications[0].total_download_bytes, 140);
        assert_eq!(state.applications[0].last_helper_download_bytes, 140);
    }

    #[test]
    fn keeps_history_when_the_usage_helper_counter_restarts() {
        let state = update_network_application_usage_state(
            PersistedNetworkApplicationUsageState::default(),
            &[test_application_usage(1_000)],
        );
        let state = update_network_application_usage_state(state, &[test_application_usage(25)]);

        assert_eq!(state.applications[0].total_download_bytes, 1_025);
        assert_eq!(state.applications[0].last_helper_download_bytes, 25);
    }

    #[test]
    fn pending_reset_uses_the_next_sample_as_a_zero_baseline() {
        let state = PersistedNetworkApplicationUsageState {
            reset_pending: true,
            applications: vec![],
        };
        let state = update_network_application_usage_state(state, &[test_application_usage(500)]);

        assert!(!state.reset_pending);
        assert_eq!(state.applications[0].total_download_bytes, 0);
        assert_eq!(state.applications[0].last_helper_download_bytes, 500);
    }

    #[test]
    fn zero_limit_is_treated_as_unlimited() {
        assert_eq!(validate_bandwidth_limit(Some(0)).unwrap(), None);
    }

    #[test]
    fn rejects_limits_outside_supported_range() {
        assert!(validate_bandwidth_limit(Some(BANDWIDTH_LIMIT_MIN_BPS - 1)).is_err());
        assert!(validate_bandwidth_limit(Some(BANDWIDTH_LIMIT_MAX_BPS + 1)).is_err());
    }

    #[test]
    fn accepts_limits_inside_supported_range() {
        assert_eq!(
            validate_bandwidth_limit(Some(25_000_000)).unwrap(),
            Some(25_000_000)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn normalizes_windows_rule_paths() {
        assert_eq!(
            normalize_executable_path(" C:/Program Files/Example/App.exe "),
            "c:\\program files\\example\\app.exe"
        );
    }

    #[cfg(target_os = "windows")]
    fn test_rule(path: &str, name: &str) -> BandwidthLimitRule {
        BandwidthLimitRule {
            id: normalize_executable_path(path),
            executable_path: path.to_string(),
            process_name: name.to_string(),
            download_limit_bps: Some(8_000_000),
            upload_limit_bps: None,
            blocked: true,
            enabled: true,
            updated_at_ms: 1,
        }
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn generates_stable_case_insensitive_rule_identifiers() {
        assert_eq!(
            bandwidth_rule_identifier(r"C:\Program Files\Example\App.exe"),
            bandwidth_rule_identifier(r"c:/program files/example/app.exe")
        );
        assert_ne!(
            bandwidth_rule_identifier(r"C:\Apps\One.exe"),
            bandwidth_rule_identifier(r"C:\Apps\Two.exe")
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn serializes_rules_with_packed_wire_layout_and_utf16_lengths() {
        let rule = test_rule(r"C:\Apps\Pulse.exe", "Pulse برنامه");
        let payload = serialize_bandwidth_rules(&[rule.clone()]).unwrap();
        let path_chars = rule.executable_path.encode_utf16().count() as u32;
        let name_chars = rule.process_name.encode_utf16().count() as u32;

        assert_eq!(read_u32(&payload, 0), Some(1));
        assert_eq!(read_u64(&payload, 24), Some(8_000_000));
        assert_eq!(read_u64(&payload, 32), Some(0));
        assert_eq!(read_u32(&payload, 40), Some(1));
        assert_eq!(read_u32(&payload, 44), Some(path_chars));
        assert_eq!(read_u32(&payload, 48), Some(name_chars));
        assert_eq!(
            payload.len(),
            8 + 48 + ((path_chars + name_chars) as usize * 2)
        );
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn validates_limiter_status_response_envelope() {
        let request_id = 77;
        let mut response = Vec::new();
        append_u32(&mut response, BANDWIDTH_LIMITER_IPC_MAGIC);
        append_u16(&mut response, BANDWIDTH_LIMITER_PROTOCOL_VERSION);
        append_u16(&mut response, BANDWIDTH_LIMITER_COMMAND_HANDSHAKE);
        append_u32(&mut response, 16);
        append_u64(&mut response, request_id);
        append_u32(&mut response, BANDWIDTH_LIMITER_STATUS_READY_MASK);
        append_u32(&mut response, ERROR_SUCCESS);
        append_u32(&mut response, 2);
        append_u32(&mut response, 0);

        assert_eq!(
            parse_limiter_response(&response, BANDWIDTH_LIMITER_COMMAND_HANDSHAKE, request_id)
                .unwrap(),
            LimiterServiceResponse {
                status_flags: BANDWIDTH_LIMITER_STATUS_READY_MASK,
                win32_error: ERROR_SUCCESS,
                active_rule_count: 2,
            }
        );
        response[0] = 0;
        assert!(
            parse_limiter_response(&response, BANDWIDTH_LIMITER_COMMAND_HANDSHAKE, request_id)
                .is_err()
        );
    }
}

fn main() {
    #[cfg(target_os = "linux")]
    if env::args().nth(1).as_deref() == Some(LINUX_NETWORK_HELPER_ARGUMENT) {
        if let Err(error) = run_linux_network_helper() {
            eprintln!("PulseNet network helper failed: {error}");
            std::process::exit(1);
        }
        return;
    }

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(AppState::default())
        .setup(|app| {
            let show = MenuItem::with_id(app, "show", "Show PulseNet", true, None::<&str>)?;
            let settings = MenuItem::with_id(app, "settings", "Settings", true, None::<&str>)?;
            let restart =
                MenuItem::with_id(app, "restart", "Restart PulseNet", true, None::<&str>)?;
            let exit = MenuItem::with_id(app, "exit", "Exit", true, None::<&str>)?;
            let separator = PredefinedMenuItem::separator(app)?;
            let tray_menu =
                Menu::with_items(app, &[&show, &settings, &separator, &restart, &exit])?;

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
                            let _ = window
                                .emit("tray-open-page", serde_json::json!({ "page": "settings" }));
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
        .on_window_event(|window, event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                api.prevent_close();
                let state: State<AppState> = window.state();
                handle_close_requested(window, &state);
            }
            WindowEvent::Resized(_) => {
                if let Ok(maximized) = window.is_maximized() {
                    let _ = window.emit("window-maximized-changed", maximized);
                }
            }
            _ => {}
        })
        .invoke_handler(tauri::generate_handler![
            ping_host,
            get_app_version,
            get_username,
            get_public_network_info,
            get_network_usage_snapshot,
            reset_network_application_usage,
            get_bandwidth_limiter_state,
            upsert_bandwidth_limit_rule,
            remove_bandwidth_limit_rule,
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
            check_for_updates,
            toggle_window_maximize,
            is_window_maximized
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
