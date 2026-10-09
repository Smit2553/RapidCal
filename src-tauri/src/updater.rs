use crate::models::{ReleaseAsset, UpdateCheckResult};
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;

pub const GITHUB_LATEST_RELEASE_URL: &str =
    "https://api.github.com/repos/Smit2553/RapidCal/releases/latest";
pub const GITHUB_RELEASES_LIST_URL: &str =
    "https://api.github.com/repos/Smit2553/RapidCal/releases?per_page=5";
pub const GITHUB_RELEASES_WEB_URL: &str = "https://github.com/Smit2553/RapidCal/releases";

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubReleaseAsset {
    pub name: String,
    pub browser_download_url: String,
    #[serde(default)]
    pub size: u64,
}

#[derive(Debug, Clone, Deserialize)]
pub struct GitHubRelease {
    pub tag_name: String,
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub body: Option<String>,
    pub html_url: String,
    #[serde(default)]
    pub published_at: Option<String>,
    #[serde(default)]
    pub draft: bool,
    #[serde(default)]
    pub assets: Vec<GitHubReleaseAsset>,
}

/// Strips leading 'v'/'V' and surrounding whitespace from a version string.
pub fn normalize_version(version: &str) -> String {
    let trimmed = version.trim();
    trimmed
        .strip_prefix('v')
        .or_else(|| trimmed.strip_prefix('V'))
        .unwrap_or(trimmed)
        .trim()
        .to_string()
}

#[derive(Debug, PartialEq, Eq)]
struct ParsedSemver {
    major: u64,
    minor: u64,
    patch: u64,
    prerelease: Option<String>,
}

fn parse_semver(raw: &str) -> Option<ParsedSemver> {
    let normalized = normalize_version(raw);
    if normalized.is_empty() {
        return None;
    }

    // Strip build metadata (+...)
    let without_build = normalized.split('+').next().unwrap_or(&normalized);

    // Split pre-release (-alpha.1, -rc.1, etc.)
    let (core, prerelease) = match without_build.split_once('-') {
        Some((c, pre)) => (c, Some(pre.trim().to_string())),
        None => (without_build, None),
    };

    let mut parts = core.split('.');
    let major = parts.next()?.parse::<u64>().ok()?;
    let minor = parts.next().unwrap_or("0").parse::<u64>().ok()?;
    let patch = parts.next().unwrap_or("0").parse::<u64>().ok()?;

    // Reject if there are extra non-numeric segments
    if parts.next().is_some() {
        return None;
    }

    Some(ParsedSemver {
        major,
        minor,
        patch,
        prerelease: prerelease.filter(|s| !s.is_empty()),
    })
}

/// Returns `true` if `latest` represents a strictly newer semantic version than `current`.
pub fn is_newer_version(current: &str, latest: &str) -> bool {
    let Some(cur) = parse_semver(current) else {
        return false;
    };
    let Some(lat) = parse_semver(latest) else {
        return false;
    };

    let cur_tuple = (cur.major, cur.minor, cur.patch);
    let lat_tuple = (lat.major, lat.minor, lat.patch);

    if lat_tuple != cur_tuple {
        return lat_tuple > cur_tuple;
    }

    // Same major.minor.patch:
    // According to SemVer, a normal release (None) is newer than a pre-release (Some).
    match (&cur.prerelease, &lat.prerelease) {
        (Some(_), None) => true,
        (None, Some(_)) => false,
        (None, None) => false,
        (Some(cur_pre), Some(lat_pre)) => compare_prerelease(lat_pre, cur_pre) > 0,
    }
}

fn compare_prerelease(a: &str, b: &str) -> i32 {
    if a == b {
        return 0;
    }
    let a_parts: Vec<&str> = a.split('.').collect();
    let b_parts: Vec<&str> = b.split('.').collect();
    let len = a_parts.len().max(b_parts.len());

    for i in 0..len {
        let Some(ap) = a_parts.get(i) else {
            return -1;
        };
        let Some(bp) = b_parts.get(i) else {
            return 1;
        };
        if ap == bp {
            continue;
        }
        match (ap.parse::<u64>(), bp.parse::<u64>()) {
            (Ok(an), Ok(bn)) => return if an > bn { 1 } else { -1 },
            // Numeric identifiers always have lower precedence than non-numeric identifiers in SemVer
            (Ok(_), Err(_)) => return -1,
            (Err(_), Ok(_)) => return 1,
            (Err(_), Err(_)) => return if ap > bp { 1 } else { -1 },
        }
    }
    0
}

/// Picks the most appropriate installer asset for the given OS (`macos`, `windows`, `linux`)
/// and CPU architecture (`aarch64`, `x86_64`, etc.).
pub fn select_recommended_asset(
    assets: &[ReleaseAsset],
    os: &str,
    arch: &str,
) -> Option<ReleaseAsset> {
    if assets.is_empty() {
        return None;
    }

    let is_non_sig = |name: &str| !name.to_ascii_lowercase().ends_with(".sig");

    match os {
        "macos" => {
            if arch == "aarch64" {
                if let Some(a) = assets.iter().find(|a| {
                    let n = a.name.to_ascii_lowercase();
                    is_non_sig(&n)
                        && n.ends_with(".dmg")
                        && (n.contains("aarch64") || n.contains("arm64"))
                }) {
                    return Some(a.clone());
                }
            } else if arch == "x86_64" {
                if let Some(a) = assets.iter().find(|a| {
                    let n = a.name.to_ascii_lowercase();
                    is_non_sig(&n)
                        && n.ends_with(".dmg")
                        && (n.contains("x64") || n.contains("x86_64"))
                }) {
                    return Some(a.clone());
                }
            }
            // Fallback to universal .dmg or any .dmg
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_ascii_lowercase();
                is_non_sig(&n) && n.ends_with(".dmg") && n.contains("universal")
            }) {
                return Some(a.clone());
            }
            assets
                .iter()
                .find(|a| {
                    let n = a.name.to_ascii_lowercase();
                    is_non_sig(&n) && n.ends_with(".dmg")
                })
                .cloned()
        }
        "windows" => {
            // Prefer NSIS setup .exe or .msi
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_ascii_lowercase();
                is_non_sig(&n) && n.ends_with("-setup.exe")
            }) {
                return Some(a.clone());
            }
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_ascii_lowercase();
                is_non_sig(&n) && (n.ends_with(".exe") || n.ends_with(".msi"))
            }) {
                return Some(a.clone());
            }
            None
        }
        "linux" => {
            // Prefer .AppImage or .deb
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_ascii_lowercase();
                is_non_sig(&n) && n.ends_with(".appimage")
            }) {
                return Some(a.clone());
            }
            if let Some(a) = assets.iter().find(|a| {
                let n = a.name.to_ascii_lowercase();
                is_non_sig(&n) && (n.ends_with(".deb") || n.ends_with(".rpm"))
            }) {
                return Some(a.clone());
            }
            None
        }
        _ => None,
    }
}

pub fn build_update_result_from_release(
    current_version: &str,
    release: GitHubRelease,
    os: &str,
    arch: &str,
) -> UpdateCheckResult {
    let cur_norm = normalize_version(current_version);
    let latest_norm = normalize_version(&release.tag_name);
    let update_available = is_newer_version(&cur_norm, &latest_norm);

    let assets: Vec<ReleaseAsset> = release
        .assets
        .into_iter()
        .filter(|a| !a.name.to_ascii_lowercase().ends_with(".sig"))
        .filter_map(|a| {
            let valid_url = crate::validate_external_url(&a.browser_download_url).ok()?;
            Some(ReleaseAsset {
                name: a.name,
                download_url: valid_url,
                size_bytes: a.size,
            })
        })
        .collect();

    let recommended_asset = select_recommended_asset(&assets, os, arch);
    let release_name = release
        .name
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| format!("RapidCal v{}", latest_norm));
    let release_notes = release
        .body
        .filter(|s| !s.trim().is_empty())
        .unwrap_or_else(|| "No release notes provided for this version.".to_string());
    let release_url = crate::validate_external_url(&release.html_url)
        .unwrap_or_else(|_| GITHUB_RELEASES_WEB_URL.to_string());

    UpdateCheckResult {
        current_version: cur_norm,
        latest_version: latest_norm,
        update_available,
        release_name,
        release_notes,
        release_url,
        published_at: release.published_at,
        checked_at: Utc::now().to_rfc3339(),
        recommended_asset,
        assets,
    }
}

pub fn build_up_to_date_fallback(current_version: &str) -> UpdateCheckResult {
    let cur_norm = normalize_version(current_version);
    UpdateCheckResult {
        current_version: cur_norm.clone(),
        latest_version: cur_norm.clone(),
        update_available: false,
        release_name: format!("RapidCal v{}", cur_norm),
        release_notes: "You are running the latest version of RapidCal.".to_string(),
        release_url: GITHUB_RELEASES_WEB_URL.to_string(),
        published_at: None,
        checked_at: Utc::now().to_rfc3339(),
        recommended_asset: None,
        assets: Vec::new(),
    }
}

pub async fn check_github_releases(client: &Client) -> Result<UpdateCheckResult, String> {
    check_github_releases_with_urls(
        client,
        env!("CARGO_PKG_VERSION"),
        GITHUB_LATEST_RELEASE_URL,
        GITHUB_RELEASES_LIST_URL,
    )
    .await
}

pub async fn check_github_releases_with_urls(
    client: &Client,
    current_version: &str,
    latest_url: &str,
    list_url: &str,
) -> Result<UpdateCheckResult, String> {
    let os = std::env::consts::OS;
    let arch = std::env::consts::ARCH;

    let response = client
        .get(latest_url)
        .header("Accept", "application/vnd.github+json")
        .header("X-GitHub-Api-Version", "2022-11-28")
        .send()
        .await
        .map_err(|e| format!("Failed to reach GitHub Releases API: {}", e))?;

    if response.status().is_success() {
        let release: GitHubRelease = response
            .json()
            .await
            .map_err(|e| format!("Invalid GitHub release payload: {}", e))?;
        return Ok(build_update_result_from_release(
            current_version,
            release,
            os,
            arch,
        ));
    }

    // If /releases/latest returns 404 (e.g., only pre-releases exist or no releases published yet),
    // check /releases?per_page=5 before falling back to up-to-date.
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        if let Ok(list_resp) = client
            .get(list_url)
            .header("Accept", "application/vnd.github+json")
            .header("X-GitHub-Api-Version", "2022-11-28")
            .send()
            .await
        {
            if list_resp.status().is_success() {
                if let Ok(releases) = list_resp.json::<Vec<GitHubRelease>>().await {
                    if let Some(first_published) = releases.into_iter().find(|r| !r.draft) {
                        return Ok(build_update_result_from_release(
                            current_version,
                            first_published,
                            os,
                            arch,
                        ));
                    }
                }
            }
        }
        return Ok(build_up_to_date_fallback(current_version));
    }

    Err(format!("GitHub API returned status {}", response.status()))
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncReadExt, AsyncWriteExt};
    use tokio::net::TcpListener;

    #[test]
    fn test_normalize_version_strips_prefix_and_whitespace() {
        assert_eq!(normalize_version("v0.1.0"), "0.1.0");
        assert_eq!(normalize_version("  V1.2.3  "), "1.2.3");
        assert_eq!(normalize_version("0.2.0-beta.1"), "0.2.0-beta.1");
    }

    #[test]
    fn test_is_newer_version_compares_semver_correctly() {
        assert!(is_newer_version("0.1.0", "0.1.1"));
        assert!(is_newer_version("0.1.0", "v0.2.0"));
        assert!(is_newer_version("0.1.0", "1.0.0"));
        assert!(!is_newer_version("0.1.0", "0.1.0"));
        assert!(!is_newer_version("v0.2.0", "0.1.9"));
        assert!(!is_newer_version("1.0.0", "0.9.9"));

        // Pre-release vs stable
        assert!(is_newer_version("0.2.0-alpha.1", "0.2.0"));
        assert!(!is_newer_version("0.2.0", "0.2.0-rc.1"));
        assert!(is_newer_version("0.2.0-alpha.1", "0.2.0-alpha.2"));
        assert!(is_newer_version("0.2.0-alpha.2", "0.2.0-beta.1"));
        assert!(is_newer_version("0.1.0", "0.2.0-alpha.1"));

        // Invalid versions return false safely
        assert!(!is_newer_version("0.1.0", "not-a-version"));
        assert!(!is_newer_version("", "0.2.0"));
    }

    #[test]
    fn test_select_recommended_asset_for_each_platform() {
        let assets = vec![
            ReleaseAsset {
                name: "RapidCal_0.2.0_universal.dmg".to_string(),
                download_url: "https://example.com/universal.dmg".to_string(),
                size_bytes: 100,
            },
            ReleaseAsset {
                name: "RapidCal_0.2.0_aarch64.dmg".to_string(),
                download_url: "https://example.com/aarch64.dmg".to_string(),
                size_bytes: 90,
            },
            ReleaseAsset {
                name: "RapidCal_0.2.0_x64.dmg".to_string(),
                download_url: "https://example.com/x64.dmg".to_string(),
                size_bytes: 95,
            },
            ReleaseAsset {
                name: "RapidCal_0.2.0_x64-setup.exe".to_string(),
                download_url: "https://example.com/setup.exe".to_string(),
                size_bytes: 80,
            },
            ReleaseAsset {
                name: "RapidCal_0.2.0_amd64.AppImage".to_string(),
                download_url: "https://example.com/linux.AppImage".to_string(),
                size_bytes: 110,
            },
        ];

        let mac_arm = select_recommended_asset(&assets, "macos", "aarch64").unwrap();
        assert_eq!(mac_arm.name, "RapidCal_0.2.0_aarch64.dmg");

        let mac_intel = select_recommended_asset(&assets, "macos", "x86_64").unwrap();
        assert_eq!(mac_intel.name, "RapidCal_0.2.0_x64.dmg");

        let win = select_recommended_asset(&assets, "windows", "x86_64").unwrap();
        assert_eq!(win.name, "RapidCal_0.2.0_x64-setup.exe");

        let linux = select_recommended_asset(&assets, "linux", "x86_64").unwrap();
        assert_eq!(linux.name, "RapidCal_0.2.0_amd64.AppImage");
    }

    #[test]
    fn test_build_update_result_from_release_detects_new_version_and_filters_sig() {
        let release = GitHubRelease {
            tag_name: "v0.2.0".to_string(),
            name: Some("RapidCal v0.2.0".to_string()),
            body: Some("### What's New\n- Faster sync".to_string()),
            html_url: "https://github.com/Smit2553/RapidCal/releases/tag/v0.2.0".to_string(),
            published_at: Some("2026-10-09T12:00:00Z".to_string()),
            draft: false,
            assets: vec![
                GitHubReleaseAsset {
                    name: "RapidCal_0.2.0_amd64.AppImage".to_string(),
                    browser_download_url: "https://example.com/app.AppImage".to_string(),
                    size: 52_428_800,
                },
                GitHubReleaseAsset {
                    name: "RapidCal_0.2.0_amd64.AppImage.sig".to_string(),
                    browser_download_url: "https://example.com/app.AppImage.sig".to_string(),
                    size: 512,
                },
                GitHubReleaseAsset {
                    name: "unsafe.exe".to_string(),
                    browser_download_url: "javascript:alert(1)".to_string(),
                    size: 100,
                },
            ],
        };

        let result = build_update_result_from_release("0.1.0", release, "linux", "x86_64");
        assert!(result.update_available);
        assert_eq!(result.current_version, "0.1.0");
        assert_eq!(result.latest_version, "0.2.0");
        assert_eq!(result.assets.len(), 1);
        assert_eq!(
            result.recommended_asset.unwrap().name,
            "RapidCal_0.2.0_amd64.AppImage"
        );
    }

    #[tokio::test]
    async fn test_check_github_releases_with_mock_http_server() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();

        let server = tokio::spawn(async move {
            // 1st request: /releases/latest returns 200 OK with v0.3.0
            if let Ok((mut socket, _)) = listener.accept().await {
                let mut buf = [0u8; 1024];
                let _ = socket.read(&mut buf).await;
                let body = r#"{
                    "tag_name": "v0.3.0",
                    "name": "RapidCal v0.3.0",
                    "body": "Release notes for 0.3.0",
                    "html_url": "https://github.com/Smit2553/RapidCal/releases/tag/v0.3.0",
                    "published_at": "2026-10-09T15:00:00Z",
                    "draft": false,
                    "assets": []
                }"#;
                let resp = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                    body.len(),
                    body
                );
                let _ = socket.write_all(resp.as_bytes()).await;
            }

            // 2nd + 3rd requests: /releases/latest returns 404, /releases list returns empty []
            for status_and_body in [
                ("404 Not Found", r#"{"message":"Not Found"}"#),
                ("200 OK", "[]"),
            ] {
                if let Ok((mut socket, _)) = listener.accept().await {
                    let mut buf = [0u8; 1024];
                    let _ = socket.read(&mut buf).await;
                    let resp = format!(
                        "HTTP/1.1 {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                        status_and_body.0,
                        status_and_body.1.len(),
                        status_and_body.1
                    );
                    let _ = socket.write_all(resp.as_bytes()).await;
                }
            }
        });

        let client = Client::builder()
            .user_agent("RapidCal-Test")
            .no_proxy()
            .build()
            .unwrap();
        let base_url = format!("http://{}", addr);

        // Case 1: 200 OK with newer release v0.3.0
        let res1 = check_github_releases_with_urls(
            &client,
            "0.1.0",
            &format!("{}/releases/latest", base_url),
            &format!("{}/releases", base_url),
        )
        .await
        .unwrap();
        assert!(res1.update_available);
        assert_eq!(res1.latest_version, "0.3.0");
        assert_eq!(res1.release_name, "RapidCal v0.3.0");

        // Case 2: 404 on /releases/latest + empty /releases list -> graceful up-to-date fallback
        let res2 = check_github_releases_with_urls(
            &client,
            "0.1.0",
            &format!("{}/releases/latest", base_url),
            &format!("{}/releases", base_url),
        )
        .await
        .unwrap();
        assert!(!res2.update_available);
        assert_eq!(res2.current_version, "0.1.0");
        assert_eq!(res2.latest_version, "0.1.0");

        let _ = server.await;
    }
}
