pub mod seed;

use crate::layout::compute_viewport_layout;
use crate::models::{
    Account, Attendee, Calendar, EventMaster, OAuthConfig, OutboxMutation, UpsertEventInput,
    ViewportEvent,
};
use crate::nlp::detect_conference_from_text;
use crate::rrule_engine::{
    describe_rrule_human, expand_event_instances, resolve_series_master_start_ts,
    shift_rrule_byday_weekday, shift_series_exdates,
};
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::json;
use std::path::Path;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

const MATERIALIZED_PAST_SECS: i64 = 365 * 86_400; // -1 year
const MATERIALIZED_FUTURE_SECS: i64 = 2 * 365 * 86_400; // +2 years

#[derive(Clone)]
pub struct Database {
    conn: Arc<Mutex<Connection>>,
}

impl Database {
    pub fn open<P: AsRef<Path>>(path: P) -> Result<Self, String> {
        let conn = Connection::open(path).map_err(|e| format!("SQLite open error: {}", e))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    pub fn open_in_memory() -> Result<Self, String> {
        let conn =
            Connection::open_in_memory().map_err(|e| format!("SQLite in-memory error: {}", e))?;
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
        };
        db.init_schema()?;
        Ok(db)
    }

    fn init_schema(&self) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute_batch(
            "
            PRAGMA journal_mode = WAL;
            PRAGMA synchronous = NORMAL;
            PRAGMA foreign_keys = ON;
            PRAGMA temp_store = MEMORY;
            PRAGMA mmap_size = 268435456;

            CREATE TABLE IF NOT EXISTS accounts (
                id TEXT PRIMARY KEY,
                provider TEXT NOT NULL,
                email TEXT NOT NULL,
                display_name TEXT NOT NULL,
                avatar_url TEXT,
                status TEXT NOT NULL DEFAULT 'connected',
                last_synced_at TEXT,
                created_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS oauth_settings (
                id INTEGER PRIMARY KEY CHECK (id = 1),
                google_client_id TEXT NOT NULL DEFAULT '',
                google_client_secret TEXT,
                ms_client_id TEXT NOT NULL DEFAULT '',
                ms_tenant_id TEXT NOT NULL DEFAULT 'common',
                hibernation_enabled INTEGER NOT NULL DEFAULT 1,
                secondary_timezone TEXT NOT NULL DEFAULT 'UTC',
                sync_interval_secs INTEGER NOT NULL DEFAULT 60
            );

            INSERT OR IGNORE INTO oauth_settings (
                id, google_client_id, google_client_secret, ms_client_id, ms_tenant_id,
                hibernation_enabled, secondary_timezone, sync_interval_secs
            ) VALUES (1, '', NULL, '', 'common', 1, 'UTC', 60);

            CREATE TABLE IF NOT EXISTS encrypted_credentials (
                key TEXT PRIMARY KEY,
                nonce_b64 TEXT NOT NULL,
                ciphertext_b64 TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE TABLE IF NOT EXISTS calendars (
                id TEXT PRIMARY KEY,
                account_id TEXT NOT NULL,
                remote_id TEXT NOT NULL,
                name TEXT NOT NULL,
                color_hex TEXT NOT NULL,
                is_visible INTEGER NOT NULL DEFAULT 1,
                is_primary INTEGER NOT NULL DEFAULT 0,
                access_role TEXT NOT NULL DEFAULT 'owner',
                sync_token TEXT,
                timezone TEXT NOT NULL DEFAULT 'UTC',
                FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS events_master (
                id TEXT PRIMARY KEY,
                calendar_id TEXT NOT NULL,
                remote_id TEXT,
                etag TEXT,
                ical_uid TEXT,
                recurring_event_id TEXT,
                original_start_time INTEGER,
                title TEXT NOT NULL,
                description TEXT NOT NULL DEFAULT '',
                location TEXT NOT NULL DEFAULT '',
                start_ts INTEGER NOT NULL,
                end_ts INTEGER NOT NULL,
                is_all_day INTEGER NOT NULL DEFAULT 0,
                timezone TEXT NOT NULL DEFAULT 'UTC',
                rrule TEXT,
                exdates_json TEXT NOT NULL DEFAULT '[]',
                status TEXT NOT NULL DEFAULT 'confirmed',
                self_rsvp TEXT NOT NULL DEFAULT 'accepted',
                attendees_json TEXT NOT NULL DEFAULT '[]',
                conference_url TEXT,
                conference_provider TEXT,
                busy_mirror_of_event_id TEXT,
                updated_at TEXT NOT NULL,
                is_dirty INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS event_instances (
                instance_id TEXT PRIMARY KEY,
                event_id TEXT NOT NULL,
                calendar_id TEXT NOT NULL,
                instance_start_ts INTEGER NOT NULL,
                instance_end_ts INTEGER NOT NULL,
                is_all_day INTEGER NOT NULL DEFAULT 0,
                is_exception INTEGER NOT NULL DEFAULT 0,
                FOREIGN KEY (event_id) REFERENCES events_master(id) ON DELETE CASCADE,
                FOREIGN KEY (calendar_id) REFERENCES calendars(id) ON DELETE CASCADE
            );

            CREATE INDEX IF NOT EXISTS idx_instances_window
                ON event_instances(instance_start_ts, instance_end_ts, calendar_id);

            CREATE INDEX IF NOT EXISTS idx_events_calendar
                ON events_master(calendar_id);

            CREATE VIRTUAL TABLE IF NOT EXISTS events_fts USING fts5(
                event_id UNINDEXED,
                calendar_id UNINDEXED,
                title,
                description,
                location,
                attendees_text,
                tokenize='porter unicode61'
            );

            CREATE TABLE IF NOT EXISTS outbox_mutations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                account_id TEXT NOT NULL,
                calendar_id TEXT NOT NULL,
                event_id TEXT NOT NULL,
                operation TEXT NOT NULL,
                payload_json TEXT NOT NULL,
                retry_count INTEGER NOT NULL DEFAULT 0,
                next_retry_at INTEGER NOT NULL DEFAULT 0,
                last_error TEXT,
                created_at TEXT NOT NULL
            );
            ",
        )
        .map_err(|e| format!("Schema initialization failed: {}", e))?;

        // Load environment defaults for OAuth client IDs if present
        let env_google_id = std::env::var("RAPIDCAL_GOOGLE_CLIENT_ID").unwrap_or_default();
        let env_google_secret = std::env::var("RAPIDCAL_GOOGLE_CLIENT_SECRET").ok();
        let env_ms_id = std::env::var("RAPIDCAL_MS_CLIENT_ID").unwrap_or_default();
        let env_ms_tenant =
            std::env::var("RAPIDCAL_MS_TENANT_ID").unwrap_or_else(|_| "common".to_string());

        if !env_google_id.is_empty() {
            let _ = conn.execute(
                "UPDATE oauth_settings SET google_client_id = ?1, google_client_secret = COALESCE(?2, google_client_secret) WHERE id = 1 AND google_client_id = ''",
                params![env_google_id, env_google_secret],
            );
        }
        if !env_ms_id.is_empty() {
            let _ = conn.execute(
                "UPDATE oauth_settings SET ms_client_id = ?1, ms_tenant_id = ?2 WHERE id = 1 AND ms_client_id = ''",
                params![env_ms_id, env_ms_tenant],
            );
        }

        Ok(())
    }

    pub fn ensure_demo_seed(&self) -> Result<(), String> {
        let count: i64 = {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.query_row("SELECT COUNT(*) FROM accounts", [], |row| row.get(0))
                .map_err(|e| e.to_string())?
        };
        if count == 0 {
            seed::seed_multi_account_demo(self)?;
        }
        Ok(())
    }

    pub fn reset_demo_seed(&self) -> Result<(), String> {
        {
            let conn = self.conn.lock().map_err(|e| e.to_string())?;
            conn.execute_batch(
                "
                DELETE FROM outbox_mutations;
                DELETE FROM events_fts;
                DELETE FROM event_instances;
                DELETE FROM events_master;
                DELETE FROM calendars;
                DELETE FROM accounts WHERE status = 'demo' OR provider = 'local';
                ",
            )
            .map_err(|e| e.to_string())?;
        }
        seed::seed_multi_account_demo(self)
    }

    pub fn list_accounts(&self) -> Result<Vec<Account>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, provider, email, display_name, avatar_url, status, last_synced_at, created_at
                 FROM accounts ORDER BY created_at ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Account {
                    id: row.get(0)?,
                    provider: row.get(1)?,
                    email: row.get(2)?,
                    display_name: row.get(3)?,
                    avatar_url: row.get(4)?,
                    status: row.get(5)?,
                    last_synced_at: row.get(6)?,
                    created_at: row.get(7)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn upsert_account(&self, account: &Account) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO accounts (id, provider, email, display_name, avatar_url, status, last_synced_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(id) DO UPDATE SET
                email = excluded.email,
                display_name = excluded.display_name,
                avatar_url = excluded.avatar_url,
                status = excluded.status,
                last_synced_at = excluded.last_synced_at",
            params![
                account.id,
                account.provider,
                account.email,
                account.display_name,
                account.avatar_url,
                account.status,
                account.last_synced_at,
                account.created_at,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn remove_account(&self, account_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM events_fts WHERE calendar_id IN (SELECT id FROM calendars WHERE account_id = ?1)",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM outbox_mutations WHERE account_id = ?1",
            params![account_id],
        )
        .map_err(|e| e.to_string())?;
        conn.execute("DELETE FROM accounts WHERE id = ?1", params![account_id])
            .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_calendars(&self) -> Result<Vec<Calendar>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, account_id, remote_id, name, color_hex, is_visible, is_primary, access_role, sync_token, timezone
                 FROM calendars ORDER BY is_primary DESC, name ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(Calendar {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    remote_id: row.get(2)?,
                    name: row.get(3)?,
                    color_hex: row.get(4)?,
                    is_visible: row.get::<_, i64>(5)? != 0,
                    is_primary: row.get::<_, i64>(6)? != 0,
                    access_role: row.get(7)?,
                    sync_token: row.get(8)?,
                    timezone: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn upsert_calendar(&self, cal: &Calendar) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO calendars (id, account_id, remote_id, name, color_hex, is_visible, is_primary, access_role, sync_token, timezone)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
             ON CONFLICT(id) DO UPDATE SET
                name = excluded.name,
                color_hex = excluded.color_hex,
                is_visible = excluded.is_visible,
                is_primary = excluded.is_primary,
                access_role = excluded.access_role,
                sync_token = COALESCE(excluded.sync_token, calendars.sync_token),
                timezone = excluded.timezone",
            params![
                cal.id,
                cal.account_id,
                cal.remote_id,
                cal.name,
                cal.color_hex,
                if cal.is_visible { 1 } else { 0 },
                if cal.is_primary { 1 } else { 0 },
                cal.access_role,
                cal.sync_token,
                cal.timezone,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn toggle_calendar_visibility(
        &self,
        calendar_id: &str,
        is_visible: bool,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE calendars SET is_visible = ?1 WHERE id = ?2",
            params![if is_visible { 1 } else { 0 }, calendar_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_calendar_color(&self, calendar_id: &str, color_hex: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE calendars SET color_hex = ?1 WHERE id = ?2",
            params![color_hex, calendar_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_event(&self, event_id: &str) -> Result<Option<EventMaster>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        Self::get_event_locked(&conn, event_id)
    }

    fn get_event_locked(conn: &Connection, event_id: &str) -> Result<Option<EventMaster>, String> {
        conn.query_row(
            "SELECT id, calendar_id, remote_id, etag, ical_uid, recurring_event_id, original_start_time,
                    title, description, location, start_ts, end_ts, is_all_day, timezone, rrule,
                    exdates_json, status, self_rsvp, attendees_json, conference_url, conference_provider,
                    busy_mirror_of_event_id, updated_at, is_dirty
             FROM events_master WHERE id = ?1",
            params![event_id],
            Self::row_to_event_master,
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    fn row_to_event_master(row: &rusqlite::Row<'_>) -> rusqlite::Result<EventMaster> {
        let exdates_str: String = row.get(15)?;
        let attendees_str: String = row.get(18)?;
        let exdates: Vec<i64> = serde_json::from_str(&exdates_str).unwrap_or_default();
        let attendees: Vec<Attendee> = serde_json::from_str(&attendees_str).unwrap_or_default();

        Ok(EventMaster {
            id: row.get(0)?,
            calendar_id: row.get(1)?,
            remote_id: row.get(2)?,
            etag: row.get(3)?,
            ical_uid: row.get(4)?,
            recurring_event_id: row.get(5)?,
            original_start_time: row.get(6)?,
            title: row.get(7)?,
            description: row.get(8)?,
            location: row.get(9)?,
            start_ts: row.get(10)?,
            end_ts: row.get(11)?,
            is_all_day: row.get::<_, i64>(12)? != 0,
            timezone: row.get(13)?,
            rrule: row.get(14)?,
            exdates,
            status: row.get(16)?,
            self_rsvp: row.get(17)?,
            attendees,
            conference_url: row.get(19)?,
            conference_provider: row.get(20)?,
            busy_mirror_of_event_id: row.get(21)?,
            updated_at: row.get(22)?,
            is_dirty: row.get::<_, i64>(23)? != 0,
        })
    }

    /// Insert or update an event (handling single-instance override on recurring series when `edit_scope == "single"`),
    /// rematerialize its instances in `event_instances`, index in `events_fts`, update linked busy mirrors,
    /// and optionally queue an outbox mutation.
    pub fn upsert_event(
        &self,
        input: UpsertEventInput,
        enqueue_outbox: bool,
    ) -> Result<EventMaster, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let now_iso = Utc::now().to_rfc3339();
        let existing = match input.id.as_deref() {
            Some(eid) => Self::get_event_locked(&tx, eid)?,
            None => None,
        };
        let existed_before = existing.is_some();

        // Check if this is a "single instance" edit on a recurring master series
        let is_single_occurrence_override = input
            .edit_scope
            .as_deref()
            .map(|s| s == "single")
            .unwrap_or(false)
            && existing.as_ref().and_then(|e| e.rrule.as_ref()).is_some();

        let target_event: EventMaster = if is_single_occurrence_override {
            let mut master = existing.unwrap();
            let occ_start = input.instance_start_ts.unwrap_or(input.start_ts);
            if !master.exdates.contains(&occ_start) {
                master.exdates.push(occ_start);
                master.updated_at = now_iso.clone();
                master.is_dirty = enqueue_outbox;
                Self::save_event_master_tx(&tx, &master)?;
                Self::rematerialize_event_instances_tx(&tx, &master)?;
                if enqueue_outbox {
                    Self::enqueue_outbox_tx(
                        &tx,
                        &master.calendar_id,
                        &master.id,
                        "update",
                        &json!(master),
                    )?;
                }

                // Propagate updated master exdates to any linked Cross-Account Busy Mirrors
                let master_mirror_ids: Vec<String> = {
                    let mut stmt = tx
                        .prepare("SELECT id FROM events_master WHERE busy_mirror_of_event_id = ?1")
                        .map_err(|e| e.to_string())?;
                    let rows = stmt
                        .query_map(params![master.id], |r| r.get(0))
                        .map_err(|e| e.to_string())?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?
                };
                for mid in master_mirror_ids {
                    if let Some(mut mirror) = Self::get_event_locked(&tx, &mid)? {
                        mirror.exdates = master.exdates.clone();
                        mirror.updated_at = now_iso.clone();
                        mirror.is_dirty = enqueue_outbox;
                        Self::save_event_master_tx(&tx, &mirror)?;
                        Self::rematerialize_event_instances_tx(&tx, &mirror)?;
                        if enqueue_outbox {
                            Self::enqueue_outbox_tx(
                                &tx,
                                &mirror.calendar_id,
                                &mirror.id,
                                "update",
                                &json!(mirror),
                            )?;
                        }
                    }
                }
            }

            let exception_id = format!("evt-{}", Uuid::new_v4());
            let (auto_prov, auto_url) = detect_conference_from_text(&format!(
                "{} {}",
                input.location.as_deref().unwrap_or(""),
                input.description.as_deref().unwrap_or("")
            ))
            .map(|(p, u)| (Some(p), Some(u)))
            .unwrap_or((None, None));

            EventMaster {
                id: exception_id,
                calendar_id: input.calendar_id.clone(),
                remote_id: None,
                etag: None,
                ical_uid: master.ical_uid.clone(),
                recurring_event_id: Some(master.id.clone()),
                original_start_time: Some(occ_start),
                title: input.title,
                description: input
                    .description
                    .unwrap_or_else(|| master.description.clone()),
                location: input.location.unwrap_or_else(|| master.location.clone()),
                start_ts: input.start_ts,
                end_ts: input.end_ts.max(input.start_ts + 300),
                is_all_day: input.is_all_day,
                timezone: input.timezone.unwrap_or_else(|| master.timezone.clone()),
                rrule: None,
                exdates: Vec::new(),
                status: input.status.unwrap_or_else(|| master.status.clone()),
                self_rsvp: input.self_rsvp.unwrap_or_else(|| master.self_rsvp.clone()),
                attendees: input.attendees.unwrap_or_else(|| master.attendees.clone()),
                conference_url: input.conference_url.or(auto_url).or(master.conference_url),
                conference_provider: input
                    .conference_provider
                    .or(auto_prov)
                    .or(master.conference_provider),
                busy_mirror_of_event_id: None,
                updated_at: now_iso.clone(),
                is_dirty: enqueue_outbox,
            }
        } else {
            let id = existing
                .as_ref()
                .map(|e| e.id.clone())
                .or(input.id.clone())
                .unwrap_or_else(|| format!("evt-{}", Uuid::new_v4()));

            let desc = input
                .description
                .or_else(|| existing.as_ref().map(|e| e.description.clone()))
                .unwrap_or_default();
            let loc = input
                .location
                .or_else(|| existing.as_ref().map(|e| e.location.clone()))
                .unwrap_or_default();

            let (auto_prov, auto_url) = detect_conference_from_text(&format!("{} {}", loc, desc))
                .map(|(p, u)| (Some(p), Some(u)))
                .unwrap_or((None, None));

            let resolved_tz = input
                .timezone
                .or_else(|| existing.as_ref().map(|e| e.timezone.clone()))
                .unwrap_or_else(|| "UTC".to_string());

            let raw_clean_rrule = input.rrule.and_then(|r| {
                let trimmed = r.trim().to_string();
                if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
                    None
                } else {
                    Some(trimmed)
                }
            });

            let clean_rrule = match (existing.as_ref(), raw_clean_rrule) {
                (Some(ex), Some(rule)) if ex.rrule.is_some() => {
                    let old_occ_ts = input.instance_start_ts.unwrap_or(ex.start_ts);
                    Some(shift_rrule_byday_weekday(
                        &rule,
                        old_occ_ts,
                        input.start_ts,
                        &resolved_tz,
                    ))
                }
                (_, r) => r,
            };

            let min_dur = if input.is_all_day { 86_400 } else { 300 };
            let requested_dur = (input.end_ts - input.start_ts).max(min_dur);
            let (resolved_start_ts, resolved_end_ts, resolved_exdates) = match existing.as_ref() {
                Some(ex) if ex.rrule.is_some() => {
                    let old_occ_ts = input.instance_start_ts.unwrap_or(ex.start_ts);
                    let new_master_start = resolve_series_master_start_ts(
                        ex.start_ts,
                        old_occ_ts,
                        input.start_ts,
                        clean_rrule.as_deref(),
                        &resolved_tz,
                    );
                    let shifted_exdates = shift_series_exdates(
                        &ex.exdates,
                        old_occ_ts,
                        input.start_ts,
                        clean_rrule.as_deref(),
                        &resolved_tz,
                    );
                    (
                        new_master_start,
                        new_master_start + requested_dur,
                        shifted_exdates,
                    )
                }
                Some(ex) => (
                    input.start_ts,
                    input.start_ts + requested_dur,
                    ex.exdates.clone(),
                ),
                None => (input.start_ts, input.start_ts + requested_dur, Vec::new()),
            };

            EventMaster {
                id,
                calendar_id: input.calendar_id,
                remote_id: existing.as_ref().and_then(|e| e.remote_id.clone()),
                etag: existing.as_ref().and_then(|e| e.etag.clone()),
                ical_uid: existing
                    .as_ref()
                    .and_then(|e| e.ical_uid.clone())
                    .or_else(|| Some(format!("{}@rapidcal.local", Uuid::new_v4()))),
                recurring_event_id: existing.as_ref().and_then(|e| e.recurring_event_id.clone()),
                original_start_time: existing.as_ref().and_then(|e| e.original_start_time),
                title: input.title,
                description: desc,
                location: loc,
                start_ts: resolved_start_ts,
                end_ts: resolved_end_ts,
                is_all_day: input.is_all_day,
                timezone: resolved_tz,
                rrule: clean_rrule,
                exdates: resolved_exdates,
                status: input
                    .status
                    .or_else(|| existing.as_ref().map(|e| e.status.clone()))
                    .unwrap_or_else(|| "confirmed".to_string()),
                self_rsvp: input
                    .self_rsvp
                    .or_else(|| existing.as_ref().map(|e| e.self_rsvp.clone()))
                    .unwrap_or_else(|| "accepted".to_string()),
                attendees: input
                    .attendees
                    .or_else(|| existing.as_ref().map(|e| e.attendees.clone()))
                    .unwrap_or_default(),
                conference_url: input
                    .conference_url
                    .or(auto_url)
                    .or_else(|| existing.as_ref().and_then(|e| e.conference_url.clone())),
                conference_provider: input.conference_provider.or(auto_prov).or_else(|| {
                    existing
                        .as_ref()
                        .and_then(|e| e.conference_provider.clone())
                }),
                busy_mirror_of_event_id: existing
                    .as_ref()
                    .and_then(|e| e.busy_mirror_of_event_id.clone()),
                updated_at: now_iso.clone(),
                is_dirty: enqueue_outbox,
            }
        };

        Self::save_event_master_tx(&tx, &target_event)?;
        Self::rematerialize_event_instances_tx(&tx, &target_event)?;
        Self::update_fts_tx(&tx, &target_event)?;

        if enqueue_outbox {
            let op = if existed_before && !is_single_occurrence_override {
                "update"
            } else {
                "create"
            };
            Self::enqueue_outbox_tx(
                &tx,
                &target_event.calendar_id,
                &target_event.id,
                op,
                &json!(target_event),
            )?;
        }

        // Propagate time changes to any linked Cross-Account Busy Mirrors
        let mirror_ids: Vec<String> = {
            let mut stmt = tx
                .prepare("SELECT id FROM events_master WHERE busy_mirror_of_event_id = ?1")
                .map_err(|e| e.to_string())?;
            let rows = stmt
                .query_map(params![target_event.id], |r| r.get(0))
                .map_err(|e| e.to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|e| e.to_string())?
        };

        for mid in mirror_ids {
            if let Some(mut mirror) = Self::get_event_locked(&tx, &mid)? {
                mirror.start_ts = target_event.start_ts;
                mirror.end_ts = target_event.end_ts;
                mirror.is_all_day = target_event.is_all_day;
                mirror.rrule = target_event.rrule.clone();
                mirror.exdates = target_event.exdates.clone();
                mirror.updated_at = now_iso.clone();
                mirror.is_dirty = enqueue_outbox;
                Self::save_event_master_tx(&tx, &mirror)?;
                Self::rematerialize_event_instances_tx(&tx, &mirror)?;
                Self::update_fts_tx(&tx, &mirror)?;
                if enqueue_outbox {
                    Self::enqueue_outbox_tx(
                        &tx,
                        &mirror.calendar_id,
                        &mirror.id,
                        "update",
                        &json!(mirror),
                    )?;
                }
            }
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(target_event)
    }

    /// Fast drag-to-move / drag-to-resize handler for calendar grid interactions.
    pub fn move_or_resize_event(
        &self,
        event_id: &str,
        instance_start_ts: Option<i64>,
        new_start_ts: i64,
        new_end_ts: i64,
        edit_scope: Option<String>,
    ) -> Result<EventMaster, String> {
        let existing = self
            .get_event(event_id)?
            .ok_or_else(|| format!("Event {} not found", event_id))?;

        let scope = edit_scope.unwrap_or_else(|| {
            if existing.rrule.is_some() {
                "single".to_string()
            } else {
                "all".to_string()
            }
        });

        let input = UpsertEventInput {
            id: Some(existing.id.clone()),
            calendar_id: existing.calendar_id,
            title: existing.title,
            description: Some(existing.description),
            location: Some(existing.location),
            start_ts: new_start_ts,
            end_ts: new_end_ts,
            is_all_day: existing.is_all_day,
            timezone: Some(existing.timezone),
            rrule: existing.rrule,
            status: Some(existing.status),
            self_rsvp: Some(existing.self_rsvp),
            attendees: Some(existing.attendees),
            conference_url: existing.conference_url,
            conference_provider: existing.conference_provider,
            edit_scope: Some(scope),
            instance_start_ts,
        };

        self.upsert_event(input, true)
    }

    pub fn delete_event(
        &self,
        event_id: &str,
        instance_start_ts: Option<i64>,
        delete_scope: Option<String>,
    ) -> Result<(), String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let existing = match Self::get_event_locked(&tx, event_id)? {
            Some(ev) => ev,
            None => return Ok(()),
        };

        let is_single = delete_scope
            .as_deref()
            .map(|s| s == "single")
            .unwrap_or(false)
            && existing.rrule.is_some()
            && instance_start_ts.is_some();

        if is_single {
            let mut master = existing;
            let occ_ts = instance_start_ts.unwrap();
            if !master.exdates.contains(&occ_ts) {
                let now_iso = Utc::now().to_rfc3339();
                master.exdates.push(occ_ts);
                master.updated_at = now_iso.clone();
                master.is_dirty = true;
                Self::save_event_master_tx(&tx, &master)?;
                Self::rematerialize_event_instances_tx(&tx, &master)?;
                Self::enqueue_outbox_tx(
                    &tx,
                    &master.calendar_id,
                    &master.id,
                    "update",
                    &json!(master),
                )?;

                // Propagate single-occurrence deletion to any linked Cross-Account Busy Mirrors
                let mirror_ids: Vec<String> = {
                    let mut stmt = tx
                        .prepare("SELECT id FROM events_master WHERE busy_mirror_of_event_id = ?1")
                        .map_err(|e| e.to_string())?;
                    let rows = stmt
                        .query_map(params![master.id], |r| r.get(0))
                        .map_err(|e| e.to_string())?;
                    rows.collect::<Result<Vec<_>, _>>()
                        .map_err(|e| e.to_string())?
                };
                for mid in mirror_ids {
                    if let Some(mut mirror) = Self::get_event_locked(&tx, &mid)? {
                        mirror.exdates = master.exdates.clone();
                        mirror.updated_at = now_iso.clone();
                        mirror.is_dirty = true;
                        Self::save_event_master_tx(&tx, &mirror)?;
                        Self::rematerialize_event_instances_tx(&tx, &mirror)?;
                        Self::enqueue_outbox_tx(
                            &tx,
                            &mirror.calendar_id,
                            &mirror.id,
                            "update",
                            &json!(mirror),
                        )?;
                    }
                }
            }
        } else {
            // Find and clean up any linked busy mirrors (FTS5 + outbox + master)
            let mirror_ids: Vec<(String, String, Option<String>)> = {
                let mut stmt = tx
                    .prepare(
                        "SELECT id, calendar_id, remote_id FROM events_master WHERE busy_mirror_of_event_id = ?1",
                    )
                    .map_err(|e| e.to_string())?;
                let rows = stmt
                    .query_map(params![existing.id], |r| {
                        Ok((r.get(0)?, r.get(1)?, r.get(2)?))
                    })
                    .map_err(|e| e.to_string())?;
                rows.collect::<Result<Vec<_>, _>>()
                    .map_err(|e| e.to_string())?
            };

            for (mid, mcal_id, mremote_id) in mirror_ids {
                tx.execute("DELETE FROM events_fts WHERE event_id = ?1", params![mid])
                    .map_err(|e| e.to_string())?;
                tx.execute(
                    "DELETE FROM outbox_mutations WHERE event_id = ?1",
                    params![mid],
                )
                .map_err(|e| e.to_string())?;
                if mremote_id.is_some() {
                    Self::enqueue_outbox_tx(
                        &tx,
                        &mcal_id,
                        &mid,
                        "delete",
                        &json!({ "id": mid, "remoteId": mremote_id }),
                    )?;
                }
            }

            tx.execute(
                "DELETE FROM events_master WHERE busy_mirror_of_event_id = ?1",
                params![existing.id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM events_fts WHERE event_id = ?1",
                params![existing.id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM outbox_mutations WHERE event_id = ?1",
                params![existing.id],
            )
            .map_err(|e| e.to_string())?;
            tx.execute(
                "DELETE FROM events_master WHERE id = ?1",
                params![existing.id],
            )
            .map_err(|e| e.to_string())?;

            Self::enqueue_outbox_tx(
                &tx,
                &existing.calendar_id,
                &existing.id,
                "delete",
                &json!({ "id": existing.id, "remoteId": existing.remote_id }),
            )?;
        }

        tx.commit().map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn update_rsvp(
        &self,
        event_id: &str,
        response_status: &str,
    ) -> Result<EventMaster, String> {
        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let mut ev = Self::get_event_locked(&tx, event_id)?
            .ok_or_else(|| format!("Event {} not found", event_id))?;

        ev.self_rsvp = response_status.to_string();
        ev.status = if response_status == "tentative" {
            "tentative".to_string()
        } else {
            "confirmed".to_string()
        };
        for att in &mut ev.attendees {
            if att.is_self {
                att.response_status = response_status.to_string();
            }
        }
        ev.updated_at = Utc::now().to_rfc3339();
        ev.is_dirty = true;

        Self::save_event_master_tx(&tx, &ev)?;
        Self::enqueue_outbox_tx(
            &tx,
            &ev.calendar_id,
            &ev.id,
            "rsvp",
            &json!({ "eventId": ev.id, "responseStatus": response_status }),
        )?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(ev)
    }

    /// Create (or update existing) Cross-Account Busy Block mirror of `source_event_id` on `target_calendar_id`.
    pub fn create_busy_mirror(
        &self,
        source_event_id: &str,
        target_calendar_id: &str,
        redact_title: bool,
    ) -> Result<EventMaster, String> {
        let source = self
            .get_event(source_event_id)?
            .ok_or_else(|| format!("Source event {} not found", source_event_id))?;

        let mirror_title = if redact_title {
            "[Busy] Private Commitment".to_string()
        } else {
            format!("[Busy] {}", source.title)
        };

        let mut conn = self.conn.lock().map_err(|e| e.to_string())?;
        let tx = conn.transaction().map_err(|e| e.to_string())?;

        let existing_mirror_id: Option<String> = tx
            .query_row(
                "SELECT id FROM events_master WHERE busy_mirror_of_event_id = ?1 AND calendar_id = ?2 LIMIT 1",
                params![source.id, target_calendar_id],
                |r| r.get(0),
            )
            .optional()
            .map_err(|e| e.to_string())?;

        let mirror_id =
            existing_mirror_id.unwrap_or_else(|| format!("evt-mirror-{}", Uuid::new_v4()));
        let mirror = EventMaster {
            id: mirror_id,
            calendar_id: target_calendar_id.to_string(),
            remote_id: None,
            etag: None,
            ical_uid: Some(format!("{}@rapidcal.local", Uuid::new_v4())),
            recurring_event_id: None,
            original_start_time: None,
            title: mirror_title,
            description: format!(
                "Automatically busy-blocked by RapidCal from event '{}'",
                source.title
            ),
            location: String::new(),
            start_ts: source.start_ts,
            end_ts: source.end_ts,
            is_all_day: source.is_all_day,
            timezone: source.timezone,
            rrule: source.rrule,
            exdates: source.exdates,
            status: "confirmed".to_string(),
            self_rsvp: "accepted".to_string(),
            attendees: Vec::new(),
            conference_url: None,
            conference_provider: None,
            busy_mirror_of_event_id: Some(source.id),
            updated_at: Utc::now().to_rfc3339(),
            is_dirty: true,
        };

        Self::save_event_master_tx(&tx, &mirror)?;
        Self::rematerialize_event_instances_tx(&tx, &mirror)?;
        Self::update_fts_tx(&tx, &mirror)?;
        Self::enqueue_outbox_tx(
            &tx,
            &mirror.calendar_id,
            &mirror.id,
            "busy_mirror",
            &json!(mirror),
        )?;

        tx.commit().map_err(|e| e.to_string())?;
        Ok(mirror)
    }

    /// Return all expanded event instances for visible calendars in `[window_start_ts, window_end_ts]`,
    /// enriched with calendar metadata and packed into non-overlapping columns.
    pub fn get_viewport_events(
        &self,
        window_start_ts: i64,
        window_end_ts: i64,
    ) -> Result<Vec<ViewportEvent>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        // 1. Query materialized non-recurring and recurring instances in window
        let mut stmt = conn
            .prepare(
                "SELECT
                    i.instance_id,
                    e.id,
                    e.recurring_event_id,
                    e.calendar_id,
                    c.account_id,
                    a.provider,
                    c.name,
                    c.color_hex,
                    e.title,
                    e.description,
                    e.location,
                    i.instance_start_ts,
                    i.instance_end_ts,
                    e.is_all_day,
                    e.timezone,
                    e.rrule,
                    i.is_exception,
                    e.status,
                    e.self_rsvp,
                    e.attendees_json,
                    e.conference_url,
                    e.conference_provider,
                    e.busy_mirror_of_event_id,
                    e.is_dirty
                 FROM event_instances i
                 JOIN events_master e ON e.id = i.event_id
                 JOIN calendars c ON c.id = i.calendar_id
                 JOIN accounts a ON a.id = c.account_id
                 WHERE c.is_visible = 1
                   AND e.status != 'cancelled'
                   AND i.instance_end_ts >= ?1
                   AND i.instance_start_ts <= ?2",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map(params![window_start_ts, window_end_ts], |row| {
                let rrule_opt: Option<String> = row.get(15)?;
                let rrule_human = rrule_opt.as_deref().map(describe_rrule_human);
                let attendees_str: String = row.get(19)?;
                let attendees: Vec<Attendee> =
                    serde_json::from_str(&attendees_str).unwrap_or_default();
                let master_id: Option<String> = row.get(2)?;
                let is_recurring = rrule_opt.is_some() || master_id.is_some();

                Ok(ViewportEvent {
                    instance_id: row.get(0)?,
                    event_id: row.get(1)?,
                    master_event_id: master_id,
                    calendar_id: row.get(3)?,
                    account_id: row.get(4)?,
                    provider: row.get(5)?,
                    calendar_name: row.get(6)?,
                    color_hex: row.get(7)?,
                    title: row.get(8)?,
                    description: row.get(9)?,
                    location: row.get(10)?,
                    start_ts: row.get(11)?,
                    end_ts: row.get(12)?,
                    is_all_day: row.get::<_, i64>(13)? != 0,
                    timezone: row.get(14)?,
                    rrule: rrule_opt,
                    rrule_human,
                    is_recurring,
                    is_exception: row.get::<_, i64>(16)? != 0,
                    status: row.get(17)?,
                    self_rsvp: row.get(18)?,
                    attendees,
                    conference_url: row.get(20)?,
                    conference_provider: row.get(21)?,
                    busy_mirror_of_event_id: row.get(22)?,
                    is_dirty: row.get::<_, i64>(23)? != 0,
                    col_index: 0,
                    total_cols: 1,
                    cluster_id: 0,
                })
            })
            .map_err(|e| e.to_string())?;

        let mut events: Vec<ViewportEvent> = rows
            .collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?;

        // 2. If user navigated beyond the materialized rolling window (-1yr..+2yr),
        // dynamically expand recurring master events on-the-fly!
        let now_ts = Utc::now().timestamp();
        let mat_min = now_ts - MATERIALIZED_PAST_SECS;
        let mat_max = now_ts + MATERIALIZED_FUTURE_SECS;
        if window_start_ts < mat_min || window_end_ts > mat_max {
            let existing_ids: std::collections::HashSet<String> =
                events.iter().map(|e| e.instance_id.clone()).collect();

            let mut rec_stmt = conn
                .prepare(
                    "SELECT e.id, e.calendar_id, c.account_id, a.provider, c.name, c.color_hex,
                            e.title, e.description, e.location, e.start_ts, e.end_ts, e.is_all_day,
                            e.timezone, e.rrule, e.exdates_json, e.status, e.self_rsvp, e.attendees_json,
                            e.conference_url, e.conference_provider, e.busy_mirror_of_event_id, e.is_dirty
                     FROM events_master e
                     JOIN calendars c ON c.id = e.calendar_id
                     JOIN accounts a ON a.id = c.account_id
                     WHERE c.is_visible = 1 AND e.rrule IS NOT NULL AND e.status != 'cancelled'",
                )
                .map_err(|e| e.to_string())?;

            let mut rec_rows = rec_stmt.query([]).map_err(|e| e.to_string())?;
            while let Some(row) = rec_rows.next().map_err(|e| e.to_string())? {
                let ev_id: String = row.get(0).map_err(|e| e.to_string())?;
                let start_ts: i64 = row.get(9).map_err(|e| e.to_string())?;
                let end_ts: i64 = row.get(10).map_err(|e| e.to_string())?;
                let tz: String = row.get(12).map_err(|e| e.to_string())?;
                let rrule_str: Option<String> = row.get(13).map_err(|e| e.to_string())?;
                let exdates_str: String = row.get(14).map_err(|e| e.to_string())?;
                let exdates: Vec<i64> = serde_json::from_str(&exdates_str).unwrap_or_default();

                let expanded = expand_event_instances(
                    start_ts,
                    end_ts,
                    &tz,
                    rrule_str.as_deref(),
                    &exdates,
                    window_start_ts,
                    window_end_ts,
                    250,
                );

                let attendees_str: String = row.get(17).map_err(|e| e.to_string())?;
                let attendees: Vec<Attendee> =
                    serde_json::from_str(&attendees_str).unwrap_or_default();
                let rrule_human = rrule_str.as_deref().map(describe_rrule_human);

                for (occ_start, occ_end) in expanded {
                    let inst_id = format!("{}:{}", ev_id, occ_start);
                    if existing_ids.contains(&inst_id) {
                        continue;
                    }
                    events.push(ViewportEvent {
                        instance_id: inst_id,
                        event_id: ev_id.clone(),
                        master_event_id: None,
                        calendar_id: row.get(1).map_err(|e| e.to_string())?,
                        account_id: row.get(2).map_err(|e| e.to_string())?,
                        provider: row.get(3).map_err(|e| e.to_string())?,
                        calendar_name: row.get(4).map_err(|e| e.to_string())?,
                        color_hex: row.get(5).map_err(|e| e.to_string())?,
                        title: row.get(6).map_err(|e| e.to_string())?,
                        description: row.get(7).map_err(|e| e.to_string())?,
                        location: row.get(8).map_err(|e| e.to_string())?,
                        start_ts: occ_start,
                        end_ts: occ_end,
                        is_all_day: row.get::<_, i64>(11).map_err(|e| e.to_string())? != 0,
                        timezone: tz.clone(),
                        rrule: rrule_str.clone(),
                        rrule_human: rrule_human.clone(),
                        is_recurring: true,
                        is_exception: false,
                        status: row.get(15).map_err(|e| e.to_string())?,
                        self_rsvp: row.get(16).map_err(|e| e.to_string())?,
                        attendees: attendees.clone(),
                        conference_url: row.get(18).map_err(|e| e.to_string())?,
                        conference_provider: row.get(19).map_err(|e| e.to_string())?,
                        busy_mirror_of_event_id: row.get(20).map_err(|e| e.to_string())?,
                        is_dirty: row.get::<_, i64>(21).map_err(|e| e.to_string())? != 0,
                        col_index: 0,
                        total_cols: 1,
                        cluster_id: 0,
                    });
                }
            }
        }

        compute_viewport_layout(&mut events);
        Ok(events)
    }

    /// Sub-2ms full-text search across titles, descriptions, locations, and attendees using SQLite FTS5.
    pub fn search_events_fts(
        &self,
        query: &str,
        limit: usize,
    ) -> Result<Vec<ViewportEvent>, String> {
        let trimmed = query.trim();
        if trimmed.is_empty() {
            return Ok(Vec::new());
        }

        // Sanitize tokens into prefix FTS5 expressions: `"term1"* AND "term2"*`
        let fts_tokens: Vec<String> = trimmed
            .split_whitespace()
            .map(|t| {
                let alphanumeric: String = t
                    .chars()
                    .filter(|c| c.is_alphanumeric() || *c == '@' || *c == '.')
                    .collect();
                alphanumeric
            })
            .filter(|s| !s.is_empty())
            .map(|s| format!("\"{}\"*", s))
            .collect();

        let conn = self.conn.lock().map_err(|e| e.to_string())?;

        let sql = if !fts_tokens.is_empty() {
            "SELECT
                e.id, e.recurring_event_id, e.calendar_id, c.account_id, a.provider,
                c.name, c.color_hex, e.title, e.description, e.location,
                e.start_ts, e.end_ts, e.is_all_day, e.timezone, e.rrule,
                e.status, e.self_rsvp, e.attendees_json, e.conference_url,
                e.conference_provider, e.busy_mirror_of_event_id, e.is_dirty
             FROM events_fts f
             JOIN events_master e ON e.id = f.event_id
             JOIN calendars c ON c.id = e.calendar_id
             JOIN accounts a ON a.id = c.account_id
             WHERE events_fts MATCH ?1
             ORDER BY rank
             LIMIT ?2"
        } else {
            "SELECT
                e.id, e.recurring_event_id, e.calendar_id, c.account_id, a.provider,
                c.name, c.color_hex, e.title, e.description, e.location,
                e.start_ts, e.end_ts, e.is_all_day, e.timezone, e.rrule,
                e.status, e.self_rsvp, e.attendees_json, e.conference_url,
                e.conference_provider, e.busy_mirror_of_event_id, e.is_dirty
             FROM events_master e
             JOIN calendars c ON c.id = e.calendar_id
             JOIN accounts a ON a.id = c.account_id
             WHERE e.title LIKE ?1 OR e.location LIKE ?1
             ORDER BY e.start_ts DESC
             LIMIT ?2"
        };

        let match_param = if !fts_tokens.is_empty() {
            fts_tokens.join(" AND ")
        } else {
            format!("%{}%", trimmed)
        };

        let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![match_param, limit as i64], |row| {
                let id: String = row.get(0)?;
                let start_ts: i64 = row.get(10)?;
                let rrule_opt: Option<String> = row.get(14)?;
                let rrule_human = rrule_opt.as_deref().map(describe_rrule_human);
                let attendees_str: String = row.get(17)?;
                let attendees: Vec<Attendee> =
                    serde_json::from_str(&attendees_str).unwrap_or_default();
                let master_id: Option<String> = row.get(1)?;

                Ok(ViewportEvent {
                    instance_id: format!("{}:{}", id, start_ts),
                    event_id: id,
                    master_event_id: master_id.clone(),
                    calendar_id: row.get(2)?,
                    account_id: row.get(3)?,
                    provider: row.get(4)?,
                    calendar_name: row.get(5)?,
                    color_hex: row.get(6)?,
                    title: row.get(7)?,
                    description: row.get(8)?,
                    location: row.get(9)?,
                    start_ts,
                    end_ts: row.get(11)?,
                    is_all_day: row.get::<_, i64>(12)? != 0,
                    timezone: row.get(13)?,
                    rrule: rrule_opt.clone(),
                    rrule_human,
                    is_recurring: rrule_opt.is_some() || master_id.is_some(),
                    is_exception: master_id.is_some(),
                    status: row.get(15)?,
                    self_rsvp: row.get(16)?,
                    attendees,
                    conference_url: row.get(18)?,
                    conference_provider: row.get(19)?,
                    busy_mirror_of_event_id: row.get(20)?,
                    is_dirty: row.get::<_, i64>(21)? != 0,
                    col_index: 0,
                    total_cols: 1,
                    cluster_id: 0,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    /// Find the next upcoming non-all-day event within the next 12 hours for the TopBar & System Tray ticker.
    pub fn get_up_next_event(&self, now_ts: i64) -> Result<Option<ViewportEvent>, String> {
        let horizon = now_ts + 12 * 3600;
        let events = self.get_viewport_events(now_ts - 900, horizon)?;
        Ok(events
            .into_iter()
            .filter(|e| !e.is_all_day && e.end_ts > now_ts && e.self_rsvp != "declined")
            .min_by_key(|e| e.start_ts))
    }

    pub fn set_event_remote_id(
        &self,
        event_id: &str,
        remote_id: &str,
        etag: Option<&str>,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE events_master SET remote_id = ?1, etag = COALESCE(?2, etag) WHERE id = ?3",
            params![remote_id, etag, event_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn list_outbox_mutations(&self) -> Result<Vec<OutboxMutation>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        let mut stmt = conn
            .prepare(
                "SELECT id, account_id, calendar_id, event_id, operation, payload_json,
                        retry_count, next_retry_at, last_error, created_at
                 FROM outbox_mutations ORDER BY id ASC",
            )
            .map_err(|e| e.to_string())?;

        let rows = stmt
            .query_map([], |row| {
                Ok(OutboxMutation {
                    id: row.get(0)?,
                    account_id: row.get(1)?,
                    calendar_id: row.get(2)?,
                    event_id: row.get(3)?,
                    operation: row.get(4)?,
                    payload_json: row.get(5)?,
                    retry_count: row.get(6)?,
                    next_retry_at: row.get(7)?,
                    last_error: row.get(8)?,
                    created_at: row.get(9)?,
                })
            })
            .map_err(|e| e.to_string())?;

        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())
    }

    pub fn mark_outbox_completed(&self, mutation_id: i64, event_id: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM outbox_mutations WHERE id = ?1",
            params![mutation_id],
        )
        .map_err(|e| e.to_string())?;
        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM outbox_mutations WHERE event_id = ?1",
                params![event_id],
                |r| r.get(0),
            )
            .unwrap_or(0);
        if remaining == 0 {
            let _ = conn.execute(
                "UPDATE events_master SET is_dirty = 0 WHERE id = ?1",
                params![event_id],
            );
        }
        Ok(())
    }

    pub fn mark_outbox_failed(
        &self,
        mutation_id: i64,
        error_msg: &str,
        next_retry_at: i64,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE outbox_mutations
             SET retry_count = retry_count + 1,
                 last_error = ?1,
                 next_retry_at = ?2
             WHERE id = ?3",
            params![error_msg, next_retry_at, mutation_id],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn get_oauth_config(&self) -> Result<OAuthConfig, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT google_client_id, google_client_secret, ms_client_id, ms_tenant_id,
                    hibernation_enabled, secondary_timezone, sync_interval_secs
             FROM oauth_settings WHERE id = 1",
            [],
            |row| {
                Ok(OAuthConfig {
                    google_client_id: row.get(0)?,
                    google_client_secret: row.get(1)?,
                    ms_client_id: row.get(2)?,
                    ms_tenant_id: row.get(3)?,
                    hibernation_enabled: row.get::<_, i64>(4)? != 0,
                    secondary_timezone: row.get(5)?,
                    sync_interval_secs: row.get::<_, i64>(6)? as u64,
                })
            },
        )
        .map_err(|e| e.to_string())
    }

    pub fn save_oauth_config(&self, config: &OAuthConfig) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "UPDATE oauth_settings
             SET google_client_id = ?1,
                 google_client_secret = ?2,
                 ms_client_id = ?3,
                 ms_tenant_id = ?4,
                 hibernation_enabled = ?5,
                 secondary_timezone = ?6,
                 sync_interval_secs = ?7
             WHERE id = 1",
            params![
                config.google_client_id.trim(),
                config.google_client_secret.as_deref().map(str::trim),
                config.ms_client_id.trim(),
                if config.ms_tenant_id.trim().is_empty() {
                    "common"
                } else {
                    config.ms_tenant_id.trim()
                },
                if config.hibernation_enabled { 1 } else { 0 },
                config.secondary_timezone.trim(),
                config.sync_interval_secs.max(15) as i64,
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn save_encrypted_credential(
        &self,
        key: &str,
        nonce_b64: &str,
        ciphertext_b64: &str,
    ) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "INSERT INTO encrypted_credentials (key, nonce_b64, ciphertext_b64, updated_at)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(key) DO UPDATE SET
                nonce_b64 = excluded.nonce_b64,
                ciphertext_b64 = excluded.ciphertext_b64,
                updated_at = excluded.updated_at",
            params![key, nonce_b64, ciphertext_b64, Utc::now().to_rfc3339()],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    pub fn load_encrypted_credential(&self, key: &str) -> Result<Option<(String, String)>, String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.query_row(
            "SELECT nonce_b64, ciphertext_b64 FROM encrypted_credentials WHERE key = ?1",
            params![key],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()
        .map_err(|e| e.to_string())
    }

    pub fn delete_encrypted_credential(&self, key: &str) -> Result<(), String> {
        let conn = self.conn.lock().map_err(|e| e.to_string())?;
        conn.execute(
            "DELETE FROM encrypted_credentials WHERE key = ?1",
            params![key],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn save_event_master_tx(conn: &Connection, ev: &EventMaster) -> Result<(), String> {
        let exdates_json = serde_json::to_string(&ev.exdates).unwrap_or_else(|_| "[]".to_string());
        let attendees_json =
            serde_json::to_string(&ev.attendees).unwrap_or_else(|_| "[]".to_string());

        conn.execute(
            "INSERT INTO events_master (
                id, calendar_id, remote_id, etag, ical_uid, recurring_event_id, original_start_time,
                title, description, location, start_ts, end_ts, is_all_day, timezone, rrule,
                exdates_json, status, self_rsvp, attendees_json, conference_url, conference_provider,
                busy_mirror_of_event_id, updated_at, is_dirty
             ) VALUES (
                ?1, ?2, ?3, ?4, ?5, ?6, ?7,
                ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15,
                ?16, ?17, ?18, ?19, ?20, ?21,
                ?22, ?23, ?24
             )
             ON CONFLICT(id) DO UPDATE SET
                calendar_id = excluded.calendar_id,
                remote_id = COALESCE(excluded.remote_id, events_master.remote_id),
                etag = COALESCE(excluded.etag, events_master.etag),
                ical_uid = COALESCE(excluded.ical_uid, events_master.ical_uid),
                recurring_event_id = excluded.recurring_event_id,
                original_start_time = excluded.original_start_time,
                title = excluded.title,
                description = excluded.description,
                location = excluded.location,
                start_ts = excluded.start_ts,
                end_ts = excluded.end_ts,
                is_all_day = excluded.is_all_day,
                timezone = excluded.timezone,
                rrule = excluded.rrule,
                exdates_json = excluded.exdates_json,
                status = excluded.status,
                self_rsvp = excluded.self_rsvp,
                attendees_json = excluded.attendees_json,
                conference_url = excluded.conference_url,
                conference_provider = excluded.conference_provider,
                busy_mirror_of_event_id = excluded.busy_mirror_of_event_id,
                updated_at = excluded.updated_at,
                is_dirty = excluded.is_dirty",
            params![
                ev.id,
                ev.calendar_id,
                ev.remote_id,
                ev.etag,
                ev.ical_uid,
                ev.recurring_event_id,
                ev.original_start_time,
                ev.title,
                ev.description,
                ev.location,
                ev.start_ts,
                ev.end_ts,
                if ev.is_all_day { 1 } else { 0 },
                ev.timezone,
                ev.rrule,
                exdates_json,
                ev.status,
                ev.self_rsvp,
                attendees_json,
                ev.conference_url,
                ev.conference_provider,
                ev.busy_mirror_of_event_id,
                ev.updated_at,
                if ev.is_dirty { 1 } else { 0 },
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn rematerialize_event_instances_tx(conn: &Connection, ev: &EventMaster) -> Result<(), String> {
        conn.execute(
            "DELETE FROM event_instances WHERE event_id = ?1",
            params![ev.id],
        )
        .map_err(|e| e.to_string())?;

        if ev.status == "cancelled" {
            return Ok(());
        }

        let now_ts = Utc::now().timestamp();
        let (win_start, win_end) = if ev.rrule.is_some() {
            (
                now_ts - MATERIALIZED_PAST_SECS,
                now_ts + MATERIALIZED_FUTURE_SECS,
            )
        } else {
            (
                (now_ts - MATERIALIZED_PAST_SECS).min(ev.start_ts - 86_400),
                (now_ts + MATERIALIZED_FUTURE_SECS).max(ev.end_ts + 86_400),
            )
        };

        let occurrences = expand_event_instances(
            ev.start_ts,
            ev.end_ts,
            &ev.timezone,
            ev.rrule.as_deref(),
            &ev.exdates,
            win_start,
            win_end,
            2500,
        );

        let is_exception = if ev.recurring_event_id.is_some() {
            1
        } else {
            0
        };
        let is_all_day = if ev.is_all_day { 1 } else { 0 };

        let mut stmt = conn
            .prepare(
                "INSERT OR REPLACE INTO event_instances (
                    instance_id, event_id, calendar_id, instance_start_ts, instance_end_ts, is_all_day, is_exception
                 ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            )
            .map_err(|e| e.to_string())?;

        for (occ_start, occ_end) in occurrences {
            let instance_id = format!("{}:{}", ev.id, occ_start);
            stmt.execute(params![
                instance_id,
                ev.id,
                ev.calendar_id,
                occ_start,
                occ_end,
                is_all_day,
                is_exception
            ])
            .map_err(|e| e.to_string())?;
        }

        Ok(())
    }

    fn update_fts_tx(conn: &Connection, ev: &EventMaster) -> Result<(), String> {
        conn.execute("DELETE FROM events_fts WHERE event_id = ?1", params![ev.id])
            .map_err(|e| e.to_string())?;

        let attendees_text: String = ev
            .attendees
            .iter()
            .map(|a| format!("{} {}", a.display_name.as_deref().unwrap_or(""), a.email))
            .collect::<Vec<_>>()
            .join(" ");

        conn.execute(
            "INSERT INTO events_fts (event_id, calendar_id, title, description, location, attendees_text)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                ev.id,
                ev.calendar_id,
                ev.title,
                ev.description,
                ev.location,
                attendees_text
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }

    fn enqueue_outbox_tx(
        conn: &Connection,
        calendar_id: &str,
        event_id: &str,
        operation: &str,
        payload: &serde_json::Value,
    ) -> Result<(), String> {
        let account_id: String = conn
            .query_row(
                "SELECT account_id FROM calendars WHERE id = ?1",
                params![calendar_id],
                |r| r.get(0),
            )
            .unwrap_or_else(|_| "unknown".to_string());

        conn.execute(
            "INSERT INTO outbox_mutations (account_id, calendar_id, event_id, operation, payload_json, retry_count, next_retry_at, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, 0, 0, ?6)",
            params![
                account_id,
                calendar_id,
                event_id,
                operation,
                payload.to_string(),
                Utc::now().to_rfc3339()
            ],
        )
        .map_err(|e| e.to_string())?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_sqlite_wal_fts5_outbox_and_busy_mirror() {
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed().expect("demo seed");

        let accounts = db.list_accounts().expect("accounts");
        assert!(accounts.len() >= 3);

        let calendars = db.list_calendars().expect("calendars");
        assert!(calendars.len() >= 4);

        // Create an event and verify FTS5 search and Outbox mutation
        let created = db
            .upsert_event(
                UpsertEventInput {
                    id: None,
                    calendar_id: calendars[0].id.clone(),
                    title: "Hyperion Rust Kernel Benchmark".to_string(),
                    description: Some("Sub-millisecond SQLite FTS5 indexing".to_string()),
                    location: Some("https://meet.google.com/hyp-rust-cal".to_string()),
                    start_ts: 1_790_000_000,
                    end_ts: 1_790_003_600,
                    is_all_day: false,
                    timezone: Some("UTC".to_string()),
                    rrule: None,
                    status: Some("confirmed".to_string()),
                    self_rsvp: Some("accepted".to_string()),
                    attendees: None,
                    conference_url: None,
                    conference_provider: None,
                    edit_scope: None,
                    instance_start_ts: None,
                },
                true,
            )
            .expect("create event");

        assert_eq!(created.conference_provider.as_deref(), Some("meet"));
        assert!(created.is_dirty);

        // Search via FTS5
        let hits = db.search_events_fts("Hyperion Kernel", 10).expect("fts");
        assert_eq!(hits.len(), 1);
        assert_eq!(hits[0].event_id, created.id);

        // Mirror as Busy onto another calendar
        let mirror = db
            .create_busy_mirror(&created.id, &calendars[2].id, false)
            .expect("busy mirror");
        assert_eq!(
            mirror.busy_mirror_of_event_id.as_deref(),
            Some(created.id.as_str())
        );
        assert!(mirror.title.starts_with("[Busy]"));

        // Move the source event and verify the mirror automatically updates its time!
        db.move_or_resize_event(&created.id, None, 1_790_010_000, 1_790_013_600, None)
            .expect("move source");
        let updated_mirror = db.get_event(&mirror.id).expect("get").expect("mirror");
        assert_eq!(updated_mirror.start_ts, 1_790_010_000);
    }

    #[test]
    fn test_recurring_series_all_scope_weekday_shift() {
        use chrono::TimeZone;
        let db = Database::open_in_memory().expect("in-memory db");
        db.ensure_demo_seed().expect("demo seed");
        let calendars = db.list_calendars().expect("calendars");

        // Monday 2026-10-05 09:00 UTC
        let mon_wk1 = Utc
            .with_ymd_and_hms(2026, 10, 5, 9, 0, 0)
            .unwrap()
            .timestamp();
        let mon_wk2 = mon_wk1 + 7 * 86_400;
        let mon_wk3 = mon_wk1 + 14 * 86_400;
        // Wednesday 2026-10-14 10:00 UTC (week 2 moved from Monday 09:00 -> Wednesday 10:00)
        let wed_wk2 = Utc
            .with_ymd_and_hms(2026, 10, 14, 10, 0, 0)
            .unwrap()
            .timestamp();
        let wed_wk1_expected = Utc
            .with_ymd_and_hms(2026, 10, 7, 10, 0, 0)
            .unwrap()
            .timestamp();
        let wed_wk3_expected = wed_wk1_expected + 14 * 86_400;

        let series = db
            .upsert_event(
                UpsertEventInput {
                    id: None,
                    calendar_id: calendars[0].id.clone(),
                    title: "Weekly Architecture Sync".to_string(),
                    description: None,
                    location: None,
                    start_ts: mon_wk1,
                    end_ts: mon_wk1 + 3600,
                    is_all_day: false,
                    timezone: Some("UTC".to_string()),
                    rrule: Some("FREQ=WEEKLY;BYDAY=MO".to_string()),
                    status: Some("confirmed".to_string()),
                    self_rsvp: Some("accepted".to_string()),
                    attendees: None,
                    conference_url: None,
                    conference_provider: None,
                    edit_scope: None,
                    instance_start_ts: None,
                },
                true,
            )
            .expect("create weekly series");

        // Create a Cross-Account Busy Mirror of the recurring series
        let mirror = db
            .create_busy_mirror(&series.id, &calendars[2].id, false)
            .expect("create busy mirror of series");

        // Delete single occurrence on Week 3 (`mon_wk3`) and verify both master and busy mirror get the exdate
        db.delete_event(&series.id, Some(mon_wk3), Some("single".to_string()))
            .expect("delete week 3 single occurrence");

        let mirror_after_del = db.get_event(&mirror.id).expect("get").expect("mirror");
        assert_eq!(mirror_after_del.exdates, vec![mon_wk3]);

        // Move week 2 occurrence from Monday 09:00 to Wednesday 10:00 with edit_scope = "all"
        let shifted = db
            .move_or_resize_event(
                &series.id,
                Some(mon_wk2),
                wed_wk2,
                wed_wk2 + 3600,
                Some("all".to_string()),
            )
            .expect("shift all in series to Wednesday");

        assert_eq!(shifted.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=WE"));
        assert_eq!(shifted.start_ts, wed_wk1_expected);
        assert_eq!(shifted.exdates, vec![wed_wk3_expected]);

        // Verify linked busy mirror also shifted its rrule, start_ts, and exdates
        let mirror_after_shift = db.get_event(&mirror.id).expect("get").expect("mirror");
        assert_eq!(
            mirror_after_shift.rrule.as_deref(),
            Some("FREQ=WEEKLY;BYDAY=WE")
        );
        assert_eq!(mirror_after_shift.start_ts, wed_wk1_expected);
        assert_eq!(mirror_after_shift.exdates, vec![wed_wk3_expected]);
    }
}
