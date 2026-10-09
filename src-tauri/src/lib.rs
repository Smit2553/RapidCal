pub mod auth;
pub mod db;
pub mod layout;
pub mod models;
pub mod nlp;
pub mod rrule_engine;
pub mod sync;
pub mod tray;

use crate::auth::CredentialVault;
use crate::db::Database;
use crate::models::{
    Account, Calendar, EventMaster, NlpParseResult, OAuthConfig, OutboxMutation,
    SyncStatusSnapshot, UpsertEventInput, ViewportEvent,
};
use crate::sync::{SyncOrchestrator, SyncTrigger};
use chrono::Utc;
use reqwest::Client;
use tauri::{Manager, State};

pub struct AppState {
    pub db: Database,
    pub vault: CredentialVault,
    pub client: Client,
    pub sync_orchestrator: SyncOrchestrator,
}

#[tauri::command]
fn list_accounts(state: State<'_, AppState>) -> Result<Vec<Account>, String> {
    state.db.list_accounts()
}

#[tauri::command]
fn remove_account(state: State<'_, AppState>, account_id: String) -> Result<(), String> {
    let _ = state.vault.delete_tokens(&account_id);
    state.db.remove_account(&account_id)
}

#[tauri::command]
async fn connect_oauth_account(
    state: State<'_, AppState>,
    provider: String,
) -> Result<Account, String> {
    let acc = match provider.to_ascii_lowercase().as_str() {
        "google" => {
            auth::google::authenticate_google_account(&state.client, &state.db, &state.vault)
                .await?
        }
        "microsoft" | "outlook" => {
            auth::microsoft::authenticate_microsoft_account(&state.client, &state.db, &state.vault)
                .await?
        }
        other => return Err(format!("Unsupported OAuth provider: {}", other)),
    };
    state.sync_orchestrator.trigger(SyncTrigger::Manual);
    Ok(acc)
}

#[tauri::command]
async fn connect_ics_account(
    state: State<'_, AppState>,
    url: String,
    name: Option<String>,
) -> Result<Account, String> {
    let acc = sync::ics::connect_ics_account(&state.client, &state.db, &url, name).await?;
    state.sync_orchestrator.refresh_up_next();
    Ok(acc)
}

#[tauri::command]
fn list_calendars(state: State<'_, AppState>) -> Result<Vec<Calendar>, String> {
    state.db.list_calendars()
}

#[tauri::command]
fn toggle_calendar_visibility(
    state: State<'_, AppState>,
    calendar_id: String,
    is_visible: bool,
) -> Result<(), String> {
    state
        .db
        .toggle_calendar_visibility(&calendar_id, is_visible)
}

#[tauri::command]
fn update_calendar_color(
    state: State<'_, AppState>,
    calendar_id: String,
    color_hex: String,
) -> Result<(), String> {
    state.db.update_calendar_color(&calendar_id, &color_hex)
}

#[tauri::command]
fn get_viewport_events(
    state: State<'_, AppState>,
    start_ts: i64,
    end_ts: i64,
) -> Result<Vec<ViewportEvent>, String> {
    state.db.get_viewport_events(start_ts, end_ts)
}

#[tauri::command]
fn get_event(state: State<'_, AppState>, event_id: String) -> Result<Option<EventMaster>, String> {
    state.db.get_event(&event_id)
}

#[tauri::command]
fn upsert_event(
    state: State<'_, AppState>,
    input: UpsertEventInput,
) -> Result<EventMaster, String> {
    let ev = state.db.upsert_event(input, true)?;
    state.sync_orchestrator.refresh_up_next();
    state.sync_orchestrator.trigger(SyncTrigger::OutboxMutation);
    Ok(ev)
}

#[tauri::command]
fn move_or_resize_event(
    state: State<'_, AppState>,
    event_id: String,
    instance_start_ts: Option<i64>,
    new_start_ts: i64,
    new_end_ts: i64,
    edit_scope: Option<String>,
) -> Result<EventMaster, String> {
    let ev = state.db.move_or_resize_event(
        &event_id,
        instance_start_ts,
        new_start_ts,
        new_end_ts,
        edit_scope,
    )?;
    state.sync_orchestrator.refresh_up_next();
    state.sync_orchestrator.trigger(SyncTrigger::OutboxMutation);
    Ok(ev)
}

#[tauri::command]
fn delete_event(
    state: State<'_, AppState>,
    event_id: String,
    instance_start_ts: Option<i64>,
    delete_scope: Option<String>,
) -> Result<(), String> {
    state
        .db
        .delete_event(&event_id, instance_start_ts, delete_scope)?;
    state.sync_orchestrator.refresh_up_next();
    state.sync_orchestrator.trigger(SyncTrigger::OutboxMutation);
    Ok(())
}

#[tauri::command]
fn update_rsvp(
    state: State<'_, AppState>,
    event_id: String,
    response_status: String,
) -> Result<EventMaster, String> {
    let ev = state.db.update_rsvp(&event_id, &response_status)?;
    state.sync_orchestrator.refresh_up_next();
    state.sync_orchestrator.trigger(SyncTrigger::OutboxMutation);
    Ok(ev)
}

#[tauri::command]
fn create_busy_mirror(
    state: State<'_, AppState>,
    source_event_id: String,
    target_calendar_id: String,
    redact_title: bool,
) -> Result<EventMaster, String> {
    let mirror =
        state
            .db
            .create_busy_mirror(&source_event_id, &target_calendar_id, redact_title)?;
    state.sync_orchestrator.refresh_up_next();
    state.sync_orchestrator.trigger(SyncTrigger::OutboxMutation);
    Ok(mirror)
}

#[tauri::command]
fn search_events(
    state: State<'_, AppState>,
    query: String,
    limit: Option<usize>,
) -> Result<Vec<ViewportEvent>, String> {
    state
        .db
        .search_events_fts(&query, limit.unwrap_or(25).min(100))
}

#[tauri::command]
fn parse_natural_language_event(
    state: State<'_, AppState>,
    raw_input: String,
    reference_ts: Option<i64>,
    timezone: Option<String>,
) -> Result<NlpParseResult, String> {
    let calendars = state.db.list_calendars()?;
    let ref_ts = reference_ts.unwrap_or_else(|| Utc::now().timestamp());
    let tz = timezone.unwrap_or_else(|| "UTC".to_string());
    Ok(nlp::parse_natural_event(
        &raw_input, ref_ts, &tz, &calendars,
    ))
}

#[tauri::command]
fn get_sync_status(state: State<'_, AppState>) -> Result<SyncStatusSnapshot, String> {
    Ok(state.sync_orchestrator.get_status_snapshot())
}

#[tauri::command]
async fn trigger_sync_now(state: State<'_, AppState>) -> Result<SyncStatusSnapshot, String> {
    state.sync_orchestrator.run_sync_cycle().await
}

#[tauri::command]
fn list_outbox_mutations(state: State<'_, AppState>) -> Result<Vec<OutboxMutation>, String> {
    state.db.list_outbox_mutations()
}

#[tauri::command]
fn get_oauth_config(state: State<'_, AppState>) -> Result<OAuthConfig, String> {
    state.db.get_oauth_config()
}

#[tauri::command]
fn save_oauth_config(
    state: State<'_, AppState>,
    config: OAuthConfig,
) -> Result<OAuthConfig, String> {
    state.db.save_oauth_config(&config)?;
    state.sync_orchestrator.refresh_up_next();
    state.db.get_oauth_config()
}

pub fn validate_external_url(url: &str) -> Result<String, String> {
    let trimmed = url.trim();
    let parsed = url::Url::parse(trimmed)
        .map_err(|_| "Only http:// and https:// URLs are allowed".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err("Only http:// and https:// URLs are allowed".to_string());
    }
    Ok(parsed.to_string())
}

pub fn launch_external_url(url: &str) -> Result<(), String> {
    let validated = validate_external_url(url)?;
    open::that_detached(&validated).map_err(|e| format!("Failed to open URL: {}", e))
}

#[tauri::command]
fn open_external_url(url: String) -> Result<(), String> {
    launch_external_url(&url)
}

#[tauri::command]
fn reset_demo_data(state: State<'_, AppState>) -> Result<(), String> {
    state.db.reset_demo_seed()?;
    state.sync_orchestrator.refresh_up_next();
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data_dir = app
                .path()
                .app_data_dir()
                .unwrap_or_else(|_| std::env::temp_dir().join("rapidcal"));
            let _ = std::fs::create_dir_all(&app_data_dir);
            let db_path = app_data_dir.join("rapidcal_wal.sqlite3");

            let db = Database::open(&db_path)
                .or_else(|_| Database::open_in_memory())
                .expect("Failed to initialize RapidCal SQLite WAL database");
            let _ = db.purge_demo_accounts();

            let vault = CredentialVault::new(db.clone());
            let client = Client::builder()
                .user_agent("RapidCal/0.1.0 (Tauri v2; Rust)")
                .timeout(std::time::Duration::from_secs(20))
                .build()
                .expect("Failed to build HTTPS client");

            let sync_orchestrator =
                SyncOrchestrator::new(db.clone(), vault.clone(), client.clone());

            let _ = tray::setup_tray_and_hibernation(
                app.handle(),
                db.clone(),
                sync_orchestrator.clone(),
            );

            app.manage(AppState {
                db,
                vault,
                client,
                sync_orchestrator,
            });

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_accounts,
            remove_account,
            connect_oauth_account,
            connect_ics_account,
            list_calendars,
            toggle_calendar_visibility,
            update_calendar_color,
            get_viewport_events,
            get_event,
            upsert_event,
            move_or_resize_event,
            delete_event,
            update_rsvp,
            create_busy_mirror,
            search_events,
            parse_natural_language_event,
            get_sync_status,
            trigger_sync_now,
            list_outbox_mutations,
            get_oauth_config,
            save_oauth_config,
            open_external_url,
            reset_demo_data,
        ])
        .run(tauri::generate_context!())
        .expect("error while running RapidCal tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_open_external_url_rejects_non_http_schemes_and_hostless_urls() {
        for bad_url in [
            "",
            "   ",
            "http://",
            "https://",
            "javascript:alert(1)",
            "file:///C:/Windows/System32/cmd.exe",
            r"C:\Windows\System32\calc.exe",
            r"\\attacker\share\payload.exe",
            "cmd://calc",
            "ftp://example.com/file",
        ] {
            let err = open_external_url(bad_url.to_string()).unwrap_err();
            assert_eq!(err, "Only http:// and https:// URLs are allowed");
        }
    }

    #[test]
    fn test_validate_external_url_normalizes_whitespace_and_uppercase_schemes() {
        assert_eq!(
            validate_external_url("  https://meet.google.com/rcd-core-sync  ").unwrap(),
            "https://meet.google.com/rcd-core-sync"
        );
        assert_eq!(
            validate_external_url("HTTPS://teams.microsoft.com/l/meetup-join/123").unwrap(),
            "https://teams.microsoft.com/l/meetup-join/123"
        );
        assert_eq!(
            validate_external_url("Http://localhost:8080/callback").unwrap(),
            "http://localhost:8080/callback"
        );
    }
}
