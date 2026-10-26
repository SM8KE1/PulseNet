use reqwest::Client as HttpClient;
use serde::Serialize;
use std::time::Duration;

const GITHUB_REPO: &str = "SM8KE1/PulseNet";
const GITHUB_RELEASES_URL: &str = "https://api.github.com/repos/SM8KE1/PulseNet/releases/latest";
const GITHUB_RELEASES_LIST_URL: &str =
    "https://api.github.com/repos/SM8KE1/PulseNet/releases?per_page=20";

#[derive(Serialize)]
pub(crate) struct UpdateCheckResult {
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

fn release_url() -> String {
    format!("https://github.com/{GITHUB_REPO}/releases/latest")
}

#[tauri::command]
pub(crate) async fn check_for_updates(include_prerelease: Option<bool>) -> UpdateCheckResult {
    let include_prerelease = include_prerelease.unwrap_or(false);
    let current_version = env!("CARGO_PKG_VERSION").to_string();
    let client = match HttpClient::builder()
        .timeout(Duration::from_secs(12))
        .build()
    {
        Ok(client) => client,
        Err(_) => {
            return UpdateCheckResult {
                current_version,
                latest_version: String::new(),
                update_available: false,
                is_prerelease: false,
                url: release_url(),
                error: Some("update-check-failed".to_string()),
            };
        }
    };
    let response = client
        .get(if include_prerelease {
            GITHUB_RELEASES_LIST_URL
        } else {
            GITHUB_RELEASES_URL
        })
        .header("User-Agent", "PulseNet")
        .send()
        .await;
    let Ok(response) = response else {
        return UpdateCheckResult {
            current_version,
            latest_version: String::new(),
            update_available: false,
            is_prerelease: false,
            url: release_url(),
            error: Some("update-check-failed".to_string()),
        };
    };
    if !response.status().is_success() {
        return UpdateCheckResult {
            current_version,
            latest_version: String::new(),
            update_available: false,
            is_prerelease: false,
            url: release_url(),
            error: Some("update-service-unavailable".to_string()),
        };
    }
    let Ok(data) = response.json::<serde_json::Value>().await else {
        return UpdateCheckResult {
            current_version,
            latest_version: String::new(),
            update_available: false,
            is_prerelease: false,
            url: release_url(),
            error: Some("invalid-response".to_string()),
        };
    };
    let release = if include_prerelease {
        data.as_array()
            .and_then(|items| {
                items.iter().find(|item| {
                    !item
                        .get("draft")
                        .and_then(|value| value.as_bool())
                        .unwrap_or(false)
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
    if latest.is_empty() {
        return UpdateCheckResult {
            current_version,
            latest_version: String::new(),
            update_available: false,
            is_prerelease: false,
            url: release_url(),
            error: Some("invalid-response".to_string()),
        };
    }
    let is_prerelease = release
        .get("prerelease")
        .and_then(|value| value.as_bool())
        .unwrap_or(false);
    let url = release
        .get("html_url")
        .and_then(|value| value.as_str())
        .map(str::to_owned)
        .unwrap_or_else(release_url);

    UpdateCheckResult {
        current_version: current_version.clone(),
        update_available: !latest.is_empty() && is_newer_version(&latest, &current_version),
        latest_version: latest,
        is_prerelease,
        url,
        error: None,
    }
}

#[cfg(test)]
mod tests {
    use super::{is_newer_version, parse_version_parts};

    #[test]
    fn parses_prefixed_and_plain_versions() {
        assert_eq!(parse_version_parts("v2.0.1"), vec![2, 0, 1]);
        assert_eq!(parse_version_parts("2.0"), vec![2, 0]);
    }

    #[test]
    fn compares_versions_with_different_lengths() {
        assert!(is_newer_version("2.0.1", "2.0.0"));
        assert!(is_newer_version("2.1", "2.0.9"));
        assert!(!is_newer_version("2.0", "2.0.0"));
        assert!(!is_newer_version("1.9.9", "2.0.0"));
    }
}
