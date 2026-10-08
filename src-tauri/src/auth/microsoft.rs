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

const MS_GRAPH_ME_URL: &str = "https://graph.microsoft.com/v1.0/me";
const MS_SCOPES: &str = "openid profile email offline_access Calendars.ReadWrite User.Read";

#[derive(Debug, Deserialize)]
struct MsTokenResponse {
    access_token: String,
    expires_in: Option<i64>,
    refresh_token: Option<String>,
    scope: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct MsGraphProfile {
    display_name: Option<String>,
    mail: Option<String>,
    user_principal_name: Option<String>,
}

pub async fn authenticate_microsoft_account(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
) -> Result<Account, String> {
    let config = db.get_oauth_config()?;
    if config.ms_client_id.trim().is_empty() {
        return Err(
            "Microsoft sign-in is not set up yet. Open Settings → Accounts to enter your Microsoft App ID."
                .to_string(),
        );
    }

    let tenant = if config.ms_tenant_id.trim().is_empty() {
        "common"
    } else {
        config.ms_tenant_id.trim()
    };

    let (listener, redirect_uri) = bind_loopback_server().await?;
    let (code_verifier, code_challenge) = generate_pkce_pair();
    let csrf_state = generate_csrf_state();

    let authorize_endpoint = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/authorize",
        tenant
    );
    let token_endpoint = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant
    );

    let mut auth_url = Url::parse(&authorize_endpoint).map_err(|e| e.to_string())?;
    auth_url
        .query_pairs_mut()
        .append_pair("client_id", config.ms_client_id.trim())
        .append_pair("response_type", "code")
        .append_pair("redirect_uri", &redirect_uri)
        .append_pair("response_mode", "query")
        .append_pair("scope", MS_SCOPES)
        .append_pair("code_challenge", &code_challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("state", &csrf_state);

    open::that_detached(auth_url.as_str())
        .map_err(|e| format!("Could not open your web browser for Microsoft sign-in: {}", e))?;

    let code = wait_for_oauth_callback(listener, &csrf_state, 180).await?;

    let form = [
        ("client_id", config.ms_client_id.trim().to_string()),
        ("scope", MS_SCOPES.to_string()),
        ("code", code),
        ("redirect_uri", redirect_uri),
        ("grant_type", "authorization_code".to_string()),
        ("code_verifier", code_verifier),
    ];

    let token_res = client
        .post(&token_endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Microsoft token exchange failed: {}", e))?;

    if !token_res.status().is_success() {
        let body = token_res.text().await.unwrap_or_default();
        return Err(format!("Microsoft token exchange error: {}", body));
    }

    let token_payload: MsTokenResponse = token_res
        .json()
        .await
        .map_err(|e| format!("Invalid Microsoft token JSON: {}", e))?;

    let expires_at_ts = Utc::now().timestamp() + token_payload.expires_in.unwrap_or(3600) - 60;
    let token_set = OAuthTokenSet {
        access_token: token_payload.access_token.clone(),
        refresh_token: token_payload.refresh_token,
        expires_at_ts,
        scope: token_payload.scope,
    };

    let profile_res = client
        .get(MS_GRAPH_ME_URL)
        .bearer_auth(&token_payload.access_token)
        .send()
        .await
        .map_err(|e| format!("Microsoft Graph /me failed: {}", e))?;

    let profile: MsGraphProfile = profile_res
        .json()
        .await
        .map_err(|e| format!("Microsoft Graph profile parse error: {}", e))?;

    let email = profile
        .mail
        .or(profile.user_principal_name)
        .unwrap_or_else(|| "outlook.user@microsoft.com".to_string());
    let display_name = profile.display_name.unwrap_or_else(|| email.clone());

    let account_id = format!("acc-ms-{}", Uuid::new_v4());
    let now_iso = Utc::now().to_rfc3339();
    let account = Account {
        id: account_id.clone(),
        provider: "microsoft".to_string(),
        email,
        display_name,
        avatar_url: None,
        status: "connected".to_string(),
        last_synced_at: Some(now_iso.clone()),
        created_at: now_iso,
    };

    vault.store_tokens(&account_id, &token_set)?;
    db.upsert_account(&account)?;
    Ok(account)
}

pub async fn get_valid_ms_access_token(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    account_id: &str,
) -> Result<String, String> {
    let existing = vault
        .load_tokens(account_id)?
        .ok_or_else(|| format!("No stored Microsoft OAuth token for account {}", account_id))?;

    let now_ts = Utc::now().timestamp();
    if existing.expires_at_ts > now_ts {
        return Ok(existing.access_token);
    }

    let refresh_token = existing.refresh_token.clone().ok_or_else(|| {
        "Microsoft access token expired and no refresh_token available".to_string()
    })?;

    let config = db.get_oauth_config()?;
    let tenant = if config.ms_tenant_id.trim().is_empty() {
        "common"
    } else {
        config.ms_tenant_id.trim()
    };
    let token_endpoint = format!(
        "https://login.microsoftonline.com/{}/oauth2/v2.0/token",
        tenant
    );

    let form = [
        ("client_id", config.ms_client_id.trim().to_string()),
        ("scope", MS_SCOPES.to_string()),
        ("refresh_token", refresh_token.clone()),
        ("grant_type", "refresh_token".to_string()),
    ];

    let res = client
        .post(&token_endpoint)
        .form(&form)
        .send()
        .await
        .map_err(|e| format!("Microsoft token refresh failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Microsoft token refresh error: {}", body));
    }

    let refreshed: MsTokenResponse = res.json().await.map_err(|e| e.to_string())?;
    let updated = OAuthTokenSet {
        access_token: refreshed.access_token.clone(),
        refresh_token: refreshed.refresh_token.or(Some(refresh_token)),
        expires_at_ts: now_ts + refreshed.expires_in.unwrap_or(3600) - 60,
        scope: refreshed.scope.or(existing.scope),
    };
    vault.store_tokens(account_id, &updated)?;
    Ok(updated.access_token)
}
