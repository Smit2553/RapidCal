use crate::auth::{
    bind_loopback_server, generate_csrf_state, generate_pkce_pair, wait_for_oauth_callback,
    CredentialVault, OAuthTokenSet,
};
use crate::db::Database;
use crate::models::Account;
use chrono::Utc;
use reqwest::Client;
use serde::Deserialize;
use url::Url;
use uuid::Uuid;

const GOOGLE_AUTH_URL: &str = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL: &str = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL: &str = "https://www.googleapis.com/oauth2/v2/userinfo";
const GOOGLE_SCOPES: &str = "openid email profile https://www.googleapis.com/auth/calendar";

#[derive(Debug, Deserialize)]
struct GoogleTokenResponse {
    access_token: String,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GoogleUserInfo {
    email: String,
    name: Option<String>,
    picture: Option<String>,
}

pub async fn authenticate_google_account(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
) -> Result<Account, String> {
    let config = db.get_oauth_config()?;
    if config.google_client_id.trim().is_empty() {
        return Err(
            "Google sign-in is not set up yet. Open Settings → Accounts to enter your Google App ID."
                .to_string(),
        );
    }

    let (listener, redirect_uri) = bind_loopback_server().await?;
    let (code_verifier, code_challenge) = generate_pkce_pair();
    let csrf_state = generate_csrf_state();

    let mut auth_url = Url::parse(GOOGLE_AUTH_URL).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", config.google_client_id.trim())
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_type", "code")
        .append_pair("scope", GOOGLE_SCOPES)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("access_type", "offline")
        .append_pair("prompt", "consent")
        .append_pair("state", &csrf_state);

    open::that_detached(auth_url.as_str())
        .map_err(|e| format!("Could not open your web browser for Google sign-in: {}", e))?;

    let code = wait_for_oauth_callback(listener, &csrf_state, 180).await?;

    let mut form = vec![
        ("client_id", config.google_client_id.trim().to_string()),
        ("code", code),
        ("code_verifier", code_verifier),
        ("grant_type", "authorization_code".to_string()),
        ("redirect_uri", redirect_uri),
    ];
    if let Some(secret) = config
        .google_client_secret
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        form.push(("client_secret", secret.to_string()));
    }

    let token_res = client
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Google token exchange request failed: {}", e))?;

    if !token_res.status().is_success() {
        let body = token_res.text().await.unwrap_or_default();
        return Err(format!("Google token exchange failed: {}", body));
    }

    let token_payload: GoogleTokenResponse = token_res
        .json()
        .await
        .map_err(|e| format!("Invalid Google token JSON: {}", e))?;

    let expires_at_ts = Utc::now().timestamp() + token_payload.expires_in.unwrap_or(3600) - 60;
    let token_set = OAuthTokenSet {
        access_token: token_payload.access_token.clone(),
        refresh_token: token_payload.refresh_token,
        expires_at_ts,
        scope: token_payload.scope,
    };

    // Fetch user profile
    let profile_res = client
        .get(GOOGLE_USERINFO_URL)
        .bearer_auth(&token_payload.access_token)
        .send()
        .await
        .map_err(|e| format!("Google userinfo fetch failed: {}", e))?;

    let profile: GoogleUserInfo = profile_res
        .json()
        .await
        .map_err(|e| format!("Google userinfo parse error: {}", e))?;

    let account_id = format!("acc-google-{}", Uuid::new_v4());
    let now_iso = Utc::now().to_rfc3339();
    let account = Account {
        id: account_id.clone(),
        provider: "google".to_string(),
        email: profile.email.clone(),
        display_name: profile.name.unwrap_or_else(|| profile.email.clone()),
        avatar_url: profile.picture,
        status: "connected".to_string(),
        last_synced_at: Some(now_iso.clone()),
        created_at: now_iso,
    };

    vault.store_tokens(&account_id, &token_set)?;
    db.upsert_account(&account)?;
    Ok(account)
}

pub async fn get_valid_google_access_token(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    account_id: &str,
) -> Result<String, String> {
    let existing = vault
        .load_tokens(account_id)?
        .ok_or_else(|| format!("No stored OAuth token for account {}", account_id))?;

    let now_ts = Utc::now().timestamp();
    if existing.expires_at_ts > now_ts {
        return Ok(existing.access_token);
    }

    let refresh_token = existing.refresh_token.clone().ok_or_else(|| {
        "Google access token expired and no refresh_token is available".to_string()
    })?;

    let config = db.get_oauth_config()?;
    let mut form = vec![
        ("client_id", config.google_client_id.trim().to_string()),
        ("refresh_token", refresh_token.clone()),
        ("grant_type", "refresh_token".to_string()),
    ];
    if let Some(secret) = config
        .google_client_secret
        .as_ref()
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
    {
        form.push(("client_secret", secret.to_string()));
    }

    let res = client
        .post(GOOGLE_TOKEN_URL)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Google token refresh failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Google token refresh error: {}", body));
    }

    let refreshed: GoogleTokenResponse = res.json().await.map_err(|e| e.to_string())?;
    let updated = OAuthTokenSet {
        access_token: refreshed.access_token.clone(),
        refresh_token: refreshed.refresh_token.or(Some(refresh_token)),
        expires_at_ts: now_ts + refreshed.expires_in.unwrap_or(3600) - 60,
        scope: refreshed.scope.or(existing.scope),
    };
    vault.store_tokens(account_id, &updated)?;
    Ok(updated.access_token)
}
