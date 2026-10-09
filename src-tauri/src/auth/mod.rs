pub mod google;
pub mod microsoft;

use crate::db::Database;
use crate::models::OAuthConfig;
use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use base64::{engine::general_purpose::URL_SAFE_NO_PAD, Engine as _};
use rand::RngCore;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::time::Duration;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

const KEYRING_SERVICE: &str = "dev.rapidcal.desktop";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthTokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_at_ts: i64,
    pub scope: Option<String>,
}

#[derive(Clone)]
pub struct CredentialVault {
    db: Database,
    cipher_key: [u8; 32],
}

impl CredentialVault {
    pub fn new(db: Database) -> Self {
        let mut hasher = Sha256::new();
        hasher.update(b"rapidcal-v1-local-vault-key:");
        if let Ok(user) = std::env::var("USER").or_else(|_| std::env::var("USERNAME")) {
            hasher.update(user.as_bytes());
        }
        if let Ok(home) = std::env::var("HOME").or_else(|_| std::env::var("USERPROFILE")) {
            hasher.update(home.as_bytes());
        }
        let digest = hasher.finalize();
        let mut key = [0u8; 32];
        key.copy_from_slice(&digest[..32]);
        Self {
            db,
            cipher_key: key,
        }
    }

    pub fn store_tokens(&self, account_id: &str, tokens: &OAuthTokenSet) -> Result<(), String> {
        let serialized = serde_json::to_string(tokens).map_err(|e| e.to_string())?;

        // 1. Try native OS Keychain (macOS Keychain / Windows Credential Manager / Linux Secret Service)
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account_id) {
            let _ = entry.set_password(&serialized);
        }

        // 2. Always persist AES-256-GCM encrypted backup in SQLite so offline/headless environments never lose tokens
        let cipher = Aes256Gcm::new_from_slice(&self.cipher_key)
            .map_err(|e| format!("Cipher init: {}", e))?;
        let mut nonce_bytes = [0u8; 12];
        rand::thread_rng().fill_bytes(&mut nonce_bytes);
        let nonce = Nonce::from_slice(&nonce_bytes);
        let ciphertext = cipher
            .encrypt(nonce, serialized.as_bytes())
            .map_err(|e| format!("AES-GCM encrypt error: {}", e))?;

        let nonce_b64 = URL_SAFE_NO_PAD.encode(nonce_bytes);
        let cipher_b64 = URL_SAFE_NO_PAD.encode(ciphertext);
        self.db
            .save_encrypted_credential(account_id, &nonce_b64, &cipher_b64)
    }

    pub fn load_tokens(&self, account_id: &str) -> Result<Option<OAuthTokenSet>, String> {
        // 1. Try native OS Keychain first
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account_id) {
            if let Ok(secret) = entry.get_password() {
                if let Ok(tokens) = serde_json::from_str::<OAuthTokenSet>(&secret) {
                    return Ok(Some(tokens));
                }
            }
        }

        // 2. Fallback to AES-256-GCM encrypted SQLite vault
        if let Some((nonce_b64, cipher_b64)) = self.db.load_encrypted_credential(account_id)? {
            let nonce_bytes = URL_SAFE_NO_PAD
                .decode(nonce_b64.as_bytes())
                .map_err(|e| e.to_string())?;
            let ciphertext = URL_SAFE_NO_PAD
                .decode(cipher_b64.as_bytes())
                .map_err(|e| e.to_string())?;
            if nonce_bytes.len() == 12 {
                let cipher = Aes256Gcm::new_from_slice(&self.cipher_key)
                    .map_err(|e| format!("Cipher init: {}", e))?;
                let nonce = Nonce::from_slice(&nonce_bytes);
                let plaintext = cipher
                    .decrypt(nonce, ciphertext.as_ref())
                    .map_err(|e| format!("AES-GCM decrypt error: {}", e))?;
                let tokens: OAuthTokenSet =
                    serde_json::from_slice(&plaintext).map_err(|e| e.to_string())?;
                return Ok(Some(tokens));
            }
        }

        Ok(None)
    }

    pub fn delete_tokens(&self, account_id: &str) -> Result<(), String> {
        if let Ok(entry) = keyring::Entry::new(KEYRING_SERVICE, account_id) {
            let _ = entry.delete_credential();
        }
        self.db.delete_encrypted_credential(account_id)
    }
}

/// Generate a cryptographic PKCE `(code_verifier, code_challenge)` pair using SHA-256 (`S256`).
pub fn generate_pkce_pair() -> (String, String) {
    let mut verifier_bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut verifier_bytes);
    let code_verifier = URL_SAFE_NO_PAD.encode(verifier_bytes);

    let mut hasher = Sha256::new();
    hasher.update(code_verifier.as_bytes());
    let challenge_digest = hasher.finalize();
    let code_challenge = URL_SAFE_NO_PAD.encode(challenge_digest);

    (code_verifier, code_challenge)
}

pub fn generate_csrf_state() -> String {
    let mut state_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut state_bytes);
    URL_SAFE_NO_PAD.encode(state_bytes)
}

/// Bind an ephemeral localhost loopback listener on `127.0.0.1:0` and return `(listener, redirect_uri)`.
pub async fn bind_loopback_server() -> Result<(TcpListener, String), String> {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .map_err(|e| format!("Failed to bind localhost OAuth loopback port: {}", e))?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    let redirect_uri = format!("http://127.0.0.1:{}/callback", port);
    Ok((listener, redirect_uri))
}

/// Wait for the OAuth2 redirect on the loopback listener, verify CSRF state, and return the authorization `code`.
pub async fn wait_for_oauth_callback(
    listener: TcpListener,
    expected_state: &str,
    timeout_secs: u64,
) -> Result<String, String> {
    let accept_fut = async {
        let (mut stream, _) = listener.accept().await.map_err(|e| e.to_string())?;
        let mut buf = vec![0u8; 4096];
        let n = stream.read(&mut buf).await.map_err(|e| e.to_string())?;
        let req_str = String::from_utf8_lossy(&buf[..n]);
        let first_line = req_str.lines().next().unwrap_or("");
        let path = first_line.split_whitespace().nth(1).unwrap_or("/");
        let full_url = format!("http://127.0.0.1{}", path);
        let parsed = Url::parse(&full_url).map_err(|e| e.to_string())?;

        let mut code_opt = None;
        let mut state_opt = None;
        let mut err_opt = None;

        for (k, v) in parsed.query_pairs() {
            match k.as_ref() {
                "code" => code_opt = Some(v.to_string()),
                "state" => state_opt = Some(v.to_string()),
                "error" => err_opt = Some(v.to_string()),
                _ => {}
            }
        }

        let (status_line, html_body, result) = if let Some(err) = err_opt {
            (
                "HTTP/1.1 400 Bad Request",
                format!(
                    "<html><body style='background:#09090b;color:#f4f4f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='border:1px solid #27272a;padding:32px;border-radius:12px;max-width:420px;text-align:center'><h2 style='color:#f43f5e;margin-top:0'>Sign-In Cancelled</h2><p style='color:#a1a1aa'>Sign-in could not be completed ({})</p></div></body></html>",
                    err
                ),
                Err(format!("Sign-in cancelled: {}", err)),
            )
        } else if state_opt.as_deref() != Some(expected_state) {
            (
                "HTTP/1.1 400 Bad Request",
                "<html><body style='background:#09090b;color:#f4f4f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='border:1px solid #27272a;padding:32px;border-radius:12px;max-width:420px;text-align:center'><h2 style='color:#f43f5e;margin-top:0'>Verification Failed</h2><p style='color:#a1a1aa'>Please close this window and try connecting your account again.</p></div></body></html>".to_string(),
                Err("Sign-in security check did not match. Please try again.".to_string()),
            )
        } else if let Some(code) = code_opt {
            (
                "HTTP/1.1 200 OK",
                "<html><body style='background:#09090b;color:#f4f4f5;font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;margin:0'><div style='border:1px solid #27272a;background:#18181b;padding:32px;border-radius:12px;max-width:420px;text-align:center'><h2 style='color:#818cf8;margin-top:0'>Connected to RapidCal</h2><p style='color:#a1a1aa;font-size:14px'>Your calendar account is now connected. You can close this tab and return to RapidCal.</p></div></body></html>".to_string(),
                Ok(code),
            )
        } else {
            (
                "HTTP/1.1 400 Bad Request",
                "<html><body>Sign-in incomplete. Please return to RapidCal and try again.</body></html>".to_string(),
                Err("Sign-in was not completed".to_string()),
            )
        };

        let response = format!(
            "{}\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            status_line,
            html_body.len(),
            html_body
        );
        let _ = stream.write_all(response.as_bytes()).await;
        let _ = stream.flush().await;
        result
    };

    tokio::time::timeout(Duration::from_secs(timeout_secs), accept_fut)
        .await
        .map_err(|_| "Timed out waiting for OAuth callback in browser".to_string())?
}

fn read_dotenv_var(key: &str) -> Option<String> {
    for rel in [".env", "../.env"] {
        let Ok(contents) = std::fs::read_to_string(rel) else {
            continue;
        };
        for raw_line in contents.lines() {
            let line = raw_line.trim();
            if line.is_empty() || line.starts_with('#') {
                continue;
            }
            let line = line.strip_prefix("export ").unwrap_or(line).trim();
            if let Some((k, v)) = line.split_once('=') {
                if k.trim() == key {
                    let mut val = v.trim();
                    if (val.starts_with('"') && val.ends_with('"') && val.len() >= 2)
                        || (val.starts_with('\'') && val.ends_with('\'') && val.len() >= 2)
                    {
                        val = &val[1..val.len() - 1];
                    }
                    let trimmed = val.trim();
                    if !trimmed.is_empty() {
                        return Some(trimmed.to_string());
                    }
                }
            }
        }
    }
    None
}

fn read_builtin_env(key: &str, compile_time: Option<&'static str>) -> Option<String> {
    if let Ok(val) = std::env::var(key) {
        let trimmed = val.trim();
        if !trimmed.is_empty() {
            return Some(trimmed.to_string());
        }
    }
    if let Some(val) = read_dotenv_var(key) {
        return Some(val);
    }
    compile_time
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .map(ToOwned::to_owned)
}

/// Resolve Google OAuth `(client_id, client_secret)` using:
/// 1. Custom developer override stored in `OAuthConfig` (if non-empty)
/// 2. Runtime environment / `.env` / compile-time embedded `RAPIDCAL_GOOGLE_CLIENT_ID` & `RAPIDCAL_GOOGLE_CLIENT_SECRET`
pub fn resolve_google_oauth_credentials(
    config: &OAuthConfig,
) -> Result<(String, Option<String>), String> {
    let custom_id = config.google_client_id.trim();
    if !custom_id.is_empty() {
        let custom_secret = config
            .google_client_secret
            .as_deref()
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(ToOwned::to_owned);
        return Ok((custom_id.to_string(), custom_secret));
    }

    let builtin_id = read_builtin_env(
        "RAPIDCAL_GOOGLE_CLIENT_ID",
        option_env!("RAPIDCAL_GOOGLE_CLIENT_ID"),
    )
    .ok_or_else(|| {
        "Google sign-in is not set up yet. Open Settings → Advanced to enter a Google Client ID."
            .to_string()
    })?;

    let builtin_secret = read_builtin_env(
        "RAPIDCAL_GOOGLE_CLIENT_SECRET",
        option_env!("RAPIDCAL_GOOGLE_CLIENT_SECRET"),
    );

    Ok((builtin_id, builtin_secret))
}

/// Resolve Microsoft Entra ID `(client_id, tenant_id)` using:
/// 1. Custom developer override stored in `OAuthConfig` (if non-empty)
/// 2. Runtime environment / `.env` / compile-time embedded `RAPIDCAL_MS_CLIENT_ID` & `RAPIDCAL_MS_TENANT_ID`
pub fn resolve_microsoft_oauth_credentials(
    config: &OAuthConfig,
) -> Result<(String, String), String> {
    let custom_id = config.ms_client_id.trim();
    let custom_tenant = config.ms_tenant_id.trim();

    if !custom_id.is_empty() {
        let tenant = if custom_tenant.is_empty() {
            "common".to_string()
        } else {
            custom_tenant.to_string()
        };
        return Ok((custom_id.to_string(), tenant));
    }

    let builtin_id = read_builtin_env(
        "RAPIDCAL_MS_CLIENT_ID",
        option_env!("RAPIDCAL_MS_CLIENT_ID"),
    )
    .ok_or_else(|| {
        "Microsoft sign-in is not set up yet. Open Settings → Advanced to enter a Microsoft Application (Client) ID."
            .to_string()
    })?;

    let tenant = if !custom_tenant.is_empty() && custom_tenant != "common" {
        custom_tenant.to_string()
    } else {
        read_builtin_env(
            "RAPIDCAL_MS_TENANT_ID",
            option_env!("RAPIDCAL_MS_TENANT_ID"),
        )
        .unwrap_or_else(|| "common".to_string())
    };

    Ok((builtin_id, tenant))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_pkce_and_encrypted_vault_roundtrip() {
        let (verifier, challenge) = generate_pkce_pair();
        assert!(verifier.len() >= 43);
        assert!(!challenge.is_empty());
        assert_ne!(verifier, challenge);

        let db = Database::open_in_memory().expect("db");
        let vault = CredentialVault::new(db);
        let token_set = OAuthTokenSet {
            access_token: "ya29.test-access-token".to_string(),
            refresh_token: Some("1//test-refresh-token".to_string()),
            expires_at_ts: 1_900_000_000,
            scope: Some("https://www.googleapis.com/auth/calendar".to_string()),
        };

        vault
            .store_tokens("acc-test-vault", &token_set)
            .expect("store");
        let loaded = vault
            .load_tokens("acc-test-vault")
            .expect("load")
            .expect("some");
        assert_eq!(loaded.access_token, token_set.access_token);
        assert_eq!(loaded.refresh_token, token_set.refresh_token);
    }

    #[test]
    fn test_custom_oauth_override_precedence() {
        let cfg = OAuthConfig {
            google_client_id: "custom-google.apps.googleusercontent.com".to_string(),
            google_client_secret: Some("GOCSPX-custom-secret".to_string()),
            ms_client_id: "11111111-2222-3333-4444-555555555555".to_string(),
            ms_tenant_id: "organizations".to_string(),
            hibernation_enabled: true,
            secondary_timezone: "UTC".to_string(),
            sync_interval_secs: 60,
        };

        let (g_id, g_secret) = resolve_google_oauth_credentials(&cfg).expect("google custom");
        assert_eq!(g_id, "custom-google.apps.googleusercontent.com");
        assert_eq!(g_secret.as_deref(), Some("GOCSPX-custom-secret"));

        let (ms_id, ms_tenant) = resolve_microsoft_oauth_credentials(&cfg).expect("ms custom");
        assert_eq!(ms_id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(ms_tenant, "organizations");
    }
}
