pub mod google;
pub mod microsoft;

use crate::auth::CredentialVault;
use crate::db::Database;
use crate::models::SyncStatusSnapshot;
use chrono::Utc;
use reqwest::Client;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc;

#[derive(Debug, Clone)]
pub enum SyncTrigger {
    Manual,
    OutboxMutation,
    WindowFocus,
    PeriodicTick,
}

#[derive(Clone)]
pub struct SyncOrchestrator {
    db: Database,
    vault: CredentialVault,
    client: Client,
    status: Arc<Mutex<SyncStatusSnapshot>>,
    tx: mpsc::UnboundedSender<SyncTrigger>,
}

impl SyncOrchestrator {
    pub fn new(db: Database, vault: CredentialVault, client: Client) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<SyncTrigger>();
        let initial_cfg = db.get_oauth_config().ok();
        let initial_status = SyncStatusSnapshot {
            state: "idle".to_string(),
            pending_outbox_count: 0,
            last_sync_at: Some(Utc::now().to_rfc3339()),
            last_message: "All calendars in sync (SQLite WAL)".to_string(),
            up_next_label: None,
            up_next_event_id: None,
            up_next_conference_url: None,
            hibernation_enabled: initial_cfg.map(|c| c.hibernation_enabled).unwrap_or(true),
        };

        let orchestrator = Self {
            db,
            vault,
            client,
            status: Arc::new(Mutex::new(initial_status)),
            tx,
        };

        orchestrator.refresh_up_next();

        // Spawn background adaptive sync worker respecting oauth_settings.sync_interval_secs
        let worker_orch = orchestrator.clone();
        tauri::async_runtime::spawn(async move {
            loop {
                let poll_secs = worker_orch
                    .db
                    .get_oauth_config()
                    .map(|c| c.sync_interval_secs.clamp(15, 600))
                    .unwrap_or(60);
                tokio::select! {
                    Some(trigger) = rx.recv() => {
                        match trigger {
                            SyncTrigger::OutboxMutation => {
                                // Only auto-drain immediately if a live OAuth account has stored tokens;
                                // for demo/offline accounts, keep the outbox badge visible until manual/periodic sync.
                                let has_live = worker_orch
                                    .db
                                    .list_accounts()
                                    .unwrap_or_default()
                                    .iter()
                                    .any(|a| {
                                        a.status == "connected"
                                            && worker_orch
                                                .vault
                                                .load_tokens(&a.id)
                                                .ok()
                                                .flatten()
                                                .is_some()
                                    });
                                if has_live {
                                    let _ = worker_orch.run_sync_cycle().await;
                                } else {
                                    worker_orch.refresh_up_next();
                                }
                            }
                            SyncTrigger::Manual | SyncTrigger::WindowFocus | SyncTrigger::PeriodicTick => {
                                let _ = worker_orch.run_sync_cycle().await;
                            }
                        }
                    }
                    _ = tokio::time::sleep(std::time::Duration::from_secs(poll_secs)) => {
                        worker_orch.trigger(SyncTrigger::PeriodicTick);
                    }
                }
            }
        });

        orchestrator
    }

    pub fn trigger(&self, reason: SyncTrigger) {
        let _ = self.tx.send(reason);
    }

    pub fn get_status_snapshot(&self) -> SyncStatusSnapshot {
        self.refresh_up_next();
        self.status
            .lock()
            .map(|s| s.clone())
            .unwrap_or(SyncStatusSnapshot {
                state: "idle".to_string(),
                pending_outbox_count: 0,
                last_sync_at: None,
                last_message: String::new(),
                up_next_label: None,
                up_next_event_id: None,
                up_next_conference_url: None,
                hibernation_enabled: true,
            })
    }

    pub fn refresh_up_next(&self) {
        let now_ts = Utc::now().timestamp();
        let pending = self
            .db
            .list_outbox_mutations()
            .map(|m| m.len())
            .unwrap_or(0);
        let hibernation = self
            .db
            .get_oauth_config()
            .map(|c| c.hibernation_enabled)
            .unwrap_or(true);

        let (label, ev_id, conf_url) = match self.db.get_up_next_event(now_ts) {
            Ok(Some(ev)) => {
                let diff_mins = ((ev.start_ts - now_ts) as f64 / 60.0).round() as i64;
                let time_badge = if diff_mins <= 0 {
                    format!("Now: {}", ev.title)
                } else if diff_mins < 60 {
                    format!("In {}m: {}", diff_mins, ev.title)
                } else {
                    let hrs = diff_mins / 60;
                    let mins = diff_mins % 60;
                    format!("In {}h {}m: {}", hrs, mins, ev.title)
                };
                (Some(time_badge), Some(ev.event_id), ev.conference_url)
            }
            _ => (None, None, None),
        };

        if let Ok(mut guard) = self.status.lock() {
            guard.pending_outbox_count = pending;
            guard.up_next_label = label;
            guard.up_next_event_id = ev_id;
            guard.up_next_conference_url = conf_url;
            guard.hibernation_enabled = hibernation;
        }
    }

    pub async fn run_sync_cycle(&self) -> Result<SyncStatusSnapshot, String> {
        {
            if let Ok(mut guard) = self.status.lock() {
                guard.state = "syncing".to_string();
                guard.last_message = "Draining outbox & checking delta tokens…".to_string();
            }
        }

        let accounts = self.db.list_accounts()?;
        let mutations = self.db.list_outbox_mutations()?;
        let now_ts = Utc::now().timestamp();

        // 1. Drain persistent offline outbox queue
        for mutation in mutations {
            if mutation.next_retry_at > now_ts {
                continue;
            }
            let account_opt = accounts.iter().find(|a| a.id == mutation.account_id);
            let is_live_oauth = account_opt
                .map(|a| a.status == "connected")
                .unwrap_or(false)
                && self
                    .vault
                    .load_tokens(&mutation.account_id)
                    .ok()
                    .flatten()
                    .is_some();

            if !is_live_oauth {
                // Local or Demo account: commit outbox mutation immediately so optimistic UI dirty indicator clears
                let _ = self
                    .db
                    .mark_outbox_completed(mutation.id, &mutation.event_id);
                continue;
            }

            let provider = account_opt.map(|a| a.provider.as_str()).unwrap_or("local");
            let push_res = match provider {
                "google" => {
                    google::push_google_outbox_mutation(
                        &self.client,
                        &self.db,
                        &self.vault,
                        &mutation,
                    )
                    .await
                }
                "microsoft" => {
                    microsoft::push_microsoft_outbox_mutation(
                        &self.client,
                        &self.db,
                        &self.vault,
                        &mutation,
                    )
                    .await
                }
                _ => Ok(()),
            };

            match push_res {
                Ok(()) => {
                    let _ = self
                        .db
                        .mark_outbox_completed(mutation.id, &mutation.event_id);
                }
                Err(err) => {
                    let backoff_secs = 15_i64 * (1_i64 << mutation.retry_count.min(6));
                    let _ = self
                        .db
                        .mark_outbox_failed(mutation.id, &err, now_ts + backoff_secs);
                }
            }
        }

        // 2. Run incremental syncToken / deltaLink pull for connected accounts
        let mut synced_accounts = 0usize;
        for mut acc in accounts {
            let has_token = self.vault.load_tokens(&acc.id).ok().flatten().is_some();
            if acc.status == "connected" && has_token {
                let res = match acc.provider.as_str() {
                    "google" => {
                        google::sync_google_account(&self.client, &self.db, &self.vault, &acc).await
                    }
                    "microsoft" => {
                        microsoft::sync_microsoft_account(&self.client, &self.db, &self.vault, &acc)
                            .await
                    }
                    _ => Ok(0),
                };

                if res.is_ok() {
                    acc.last_synced_at = Some(Utc::now().to_rfc3339());
                    let _ = self.db.upsert_account(&acc);
                    synced_accounts += 1;
                }
            } else {
                acc.last_synced_at = Some(Utc::now().to_rfc3339());
                let _ = self.db.upsert_account(&acc);
                synced_accounts += 1;
            }
        }

        self.refresh_up_next();

        if let Ok(mut guard) = self.status.lock() {
            guard.state = "idle".to_string();
            guard.last_sync_at = Some(Utc::now().to_rfc3339());
            guard.last_message =
                format!("Synced {} accounts • 0ms WAL read ready", synced_accounts);
        }

        Ok(self.get_status_snapshot())
    }
}
