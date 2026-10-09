use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Account {
    pub id: String,
    pub provider: String, // "google" | "microsoft" | "local"
    pub email: String,
    pub display_name: String,
    pub avatar_url: Option<String>,
    pub status: String, // "connected" | "syncing" | "offline" | "demo" | "error"
    pub last_synced_at: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Calendar {
    pub id: String,
    pub account_id: String,
    pub remote_id: String,
    pub name: String,
    pub color_hex: String,
    pub is_visible: bool,
    pub is_primary: bool,
    pub access_role: String, // "owner" | "writer" | "reader"
    pub sync_token: Option<String>,
    pub timezone: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct Attendee {
    pub email: String,
    pub display_name: Option<String>,
    pub response_status: String, // "accepted" | "tentative" | "declined" | "needsAction"
    pub is_organizer: bool,
    pub is_self: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventMaster {
    pub id: String,
    pub calendar_id: String,
    pub remote_id: Option<String>,
    pub etag: Option<String>,
    pub ical_uid: Option<String>,
    pub recurring_event_id: Option<String>,
    pub original_start_time: Option<i64>,
    pub title: String,
    pub description: String,
    pub location: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub is_all_day: bool,
    pub timezone: String,
    pub rrule: Option<String>,
    pub exdates: Vec<i64>,
    pub status: String,    // "confirmed" | "tentative" | "cancelled"
    pub self_rsvp: String, // "accepted" | "tentative" | "declined" | "needsAction"
    pub attendees: Vec<Attendee>,
    pub conference_url: Option<String>,
    pub conference_provider: Option<String>, // "meet" | "teams" | "zoom" | "webex"
    pub busy_mirror_of_event_id: Option<String>,
    pub updated_at: String,
    pub is_dirty: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ViewportEvent {
    pub instance_id: String,
    pub event_id: String,
    pub master_event_id: Option<String>,
    pub calendar_id: String,
    pub account_id: String,
    pub provider: String,
    pub calendar_name: String,
    pub color_hex: String,
    pub title: String,
    pub description: String,
    pub location: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub is_all_day: bool,
    pub timezone: String,
    pub rrule: Option<String>,
    pub rrule_human: Option<String>,
    pub is_recurring: bool,
    pub is_exception: bool,
    pub status: String,
    pub self_rsvp: String,
    pub attendees: Vec<Attendee>,
    pub conference_url: Option<String>,
    pub conference_provider: Option<String>,
    pub busy_mirror_of_event_id: Option<String>,
    pub is_dirty: bool,
    pub col_index: usize,
    pub total_cols: usize,
    pub cluster_id: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpsertEventInput {
    pub id: Option<String>,
    pub calendar_id: String,
    pub title: String,
    pub description: Option<String>,
    pub location: Option<String>,
    pub start_ts: i64,
    pub end_ts: i64,
    pub is_all_day: bool,
    pub timezone: Option<String>,
    pub rrule: Option<String>,
    pub status: Option<String>,
    pub self_rsvp: Option<String>,
    pub attendees: Option<Vec<Attendee>>,
    pub conference_url: Option<String>,
    pub conference_provider: Option<String>,
    pub edit_scope: Option<String>, // "single" | "all"
    pub instance_start_ts: Option<i64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OutboxMutation {
    pub id: i64,
    pub account_id: String,
    pub calendar_id: String,
    pub event_id: String,
    pub operation: String, // "create" | "update" | "delete" | "rsvp" | "busy_mirror"
    pub payload_json: String,
    pub retry_count: i32,
    pub next_retry_at: i64,
    pub last_error: Option<String>,
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OAuthConfig {
    pub google_client_id: String,
    pub google_client_secret: Option<String>,
    pub ms_client_id: String,
    pub ms_tenant_id: String,
    pub hibernation_enabled: bool,
    pub secondary_timezone: String,
    pub sync_interval_secs: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SyncStatusSnapshot {
    pub state: String, // "idle" | "syncing" | "offline" | "error"
    pub pending_outbox_count: usize,
    pub last_sync_at: Option<String>,
    pub last_message: String,
    pub up_next_label: Option<String>,
    pub up_next_event_id: Option<String>,
    pub up_next_conference_url: Option<String>,
    pub hibernation_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NlpParseResult {
    pub raw_input: String,
    pub title: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub is_all_day: bool,
    pub rrule: Option<String>,
    pub rrule_human: Option<String>,
    pub location: Option<String>,
    pub conference_url: Option<String>,
    pub conference_provider: Option<String>,
    pub calendar_hint: Option<String>,
    pub matched_calendar_id: Option<String>,
    pub attendees: Vec<String>,
    pub confidence: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseAsset {
    pub name: String,
    pub download_url: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateCheckResult {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    pub release_name: String,
    pub release_notes: String,
    pub release_url: String,
    pub published_at: Option<String>,
    pub checked_at: String,
    pub recommended_asset: Option<ReleaseAsset>,
    pub assets: Vec<ReleaseAsset>,
}
