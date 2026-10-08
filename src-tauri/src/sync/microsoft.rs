use crate::auth::{microsoft::get_valid_ms_access_token, CredentialVault};
use crate::db::Database;
use crate::models::{Account, Attendee, Calendar, EventMaster, OutboxMutation, UpsertEventInput};
use crate::rrule_engine::{ms_recurrence_to_rrule, rrule_to_ms_recurrence};
use chrono::{DateTime, NaiveDateTime, TimeZone, Utc};
use reqwest::Client;
use serde_json::{json, Value};

const MS_GRAPH_BASE: &str = "https://graph.microsoft.com/v1.0";

pub async fn sync_microsoft_account(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    account: &Account,
) -> Result<usize, String> {
    let token = get_valid_ms_access_token(client, db, vault, &account.id).await?;

    let cals_url = format!("{}/me/calendars", MS_GRAPH_BASE);
    let res = client
        .get(&cals_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Microsoft Graph /me/calendars failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Microsoft calendars error: {}", body));
    }

    let payload: Value = res.json().await.map_err(|e| e.to_string())?;
    let existing_cals = db.list_calendars()?;
    let mut synced_events = 0usize;

    if let Some(items) = payload.get("value").and_then(|v| v.as_array()) {
        for item in items {
            let remote_id = match item.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };
            let local_cal_id = existing_cals
                .iter()
                .find(|c| c.account_id == account.id && c.remote_id == remote_id)
                .map(|c| c.id.clone())
                .unwrap_or_else(|| format!("cal-ms-{}", uuid::Uuid::new_v4()));

            let prev_delta_link = existing_cals
                .iter()
                .find(|c| c.id == local_cal_id)
                .and_then(|c| c.sync_token.clone());

            let cal = Calendar {
                id: local_cal_id.clone(),
                account_id: account.id.clone(),
                remote_id: remote_id.clone(),
                name: item
                    .get("name")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Outlook Calendar")
                    .to_string(),
                color_hex: item
                    .get("hexColor")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or("#0ea5e9")
                    .to_string(),
                is_visible: true,
                is_primary: item
                    .get("isDefaultCalendar")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                access_role: if item
                    .get("canEdit")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true)
                {
                    "owner".to_string()
                } else {
                    "reader".to_string()
                },
                sync_token: prev_delta_link.clone(),
                timezone: "UTC".to_string(),
            };
            db.upsert_calendar(&cal)?;

            if let Ok(cnt) =
                sync_ms_calendar_delta(client, db, &token, &cal, prev_delta_link.as_deref()).await
            {
                synced_events += cnt;
            }
        }
    }

    Ok(synced_events)
}

async fn sync_ms_calendar_delta(
    client: &Client,
    db: &Database,
    token: &str,
    cal: &Calendar,
    delta_link: Option<&str>,
) -> Result<usize, String> {
    let url = match delta_link.filter(|s| s.starts_with("https://")) {
        Some(dl) => dl.to_string(),
        None => format!("{}/me/calendars/{}/events", MS_GRAPH_BASE, cal.remote_id),
    };

    let res = client
        .get(&url)
        .bearer_auth(token)
        .header("Prefer", "outlook.timezone=\"UTC\"")
        .send()
        .await
        .map_err(|e| e.to_string())?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Microsoft Graph events error: {}", body));
    }

    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let mut count = 0usize;

    if let Some(items) = body.get("value").and_then(|v| v.as_array()) {
        for item in items {
            let remote_id = match item.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };
            let local_id = format!("evt-ms-{}-{}", cal.id, remote_id);

            if item.get("@removed").is_some()
                || item
                    .get("isCancelled")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false)
            {
                let _ = db.delete_event(&local_id, None, Some("all".to_string()));
                continue;
            }

            let start_ts = parse_ms_datetime(item.get("start"));
            let end_ts = parse_ms_datetime(item.get("end")).max(start_ts + 300);
            let is_all_day = item
                .get("isAllDay")
                .and_then(|v| v.as_bool())
                .unwrap_or(false);

            let rrule = item.get("recurrence").and_then(ms_recurrence_to_rrule);

            let conference_url = item
                .get("onlineMeeting")
                .and_then(|om| om.get("joinUrl"))
                .and_then(|v| v.as_str())
                .or_else(|| item.get("onlineMeetingUrl").and_then(|v| v.as_str()))
                .map(String::from);
            let conference_provider = conference_url.as_ref().map(|_| "teams".to_string());

            let self_rsvp = map_ms_response_status(
                item.get("responseStatus")
                    .and_then(|r| r.get("response"))
                    .and_then(|v| v.as_str()),
            );

            let mut attendees = Vec::new();
            if let Some(att_arr) = item.get("attendees").and_then(|v| v.as_array()) {
                for a in att_arr {
                    let email = a
                        .get("emailAddress")
                        .and_then(|e| e.get("address"))
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let name = a
                        .get("emailAddress")
                        .and_then(|e| e.get("name"))
                        .and_then(|v| v.as_str())
                        .map(String::from);
                    let resp = map_ms_response_status(
                        a.get("status")
                            .and_then(|s| s.get("response"))
                            .and_then(|v| v.as_str()),
                    );
                    attendees.push(Attendee {
                        email,
                        display_name: name,
                        response_status: resp,
                        is_organizer: false,
                        is_self: false,
                    });
                }
            }

            let location = item
                .get("location")
                .and_then(|l| l.get("displayName"))
                .and_then(|v| v.as_str())
                .map(String::from);

            let description = item
                .get("bodyPreview")
                .and_then(|v| v.as_str())
                .map(String::from);

            let _ = db.upsert_event(
                UpsertEventInput {
                    id: Some(local_id),
                    calendar_id: cal.id.clone(),
                    title: item
                        .get("subject")
                        .and_then(|v| v.as_str())
                        .unwrap_or("(No subject)")
                        .to_string(),
                    description,
                    location,
                    start_ts,
                    end_ts,
                    is_all_day,
                    timezone: Some("UTC".to_string()),
                    rrule,
                    status: Some(if self_rsvp == "tentative" {
                        "tentative".to_string()
                    } else {
                        "confirmed".to_string()
                    }),
                    self_rsvp: Some(self_rsvp),
                    attendees: Some(attendees),
                    conference_url,
                    conference_provider,
                    edit_scope: Some("all".to_string()),
                    instance_start_ts: None,
                },
                false,
            );
            count += 1;
        }
    }

    if let Some(new_delta) = body.get("@odata.deltaLink").and_then(|v| v.as_str()) {
        let mut updated_cal = cal.clone();
        updated_cal.sync_token = Some(new_delta.to_string());
        let _ = db.upsert_calendar(&updated_cal);
    }

    Ok(count)
}

pub async fn push_microsoft_outbox_mutation(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    mutation: &OutboxMutation,
) -> Result<(), String> {
    let token = get_valid_ms_access_token(client, db, vault, &mutation.account_id).await?;
    let cals = db.list_calendars()?;
    let cal = cals
        .iter()
        .find(|c| c.id == mutation.calendar_id)
        .ok_or_else(|| "Calendar not found for Microsoft outbox push".to_string())?;

    match mutation.operation.as_str() {
        "delete" => {
            let payload: Value =
                serde_json::from_str(&mutation.payload_json).unwrap_or_else(|_| json!({}));
            if let Some(remote_id) = payload.get("remoteId").and_then(|v| v.as_str()) {
                let url = format!(
                    "{}/me/calendars/{}/events/{}",
                    MS_GRAPH_BASE, cal.remote_id, remote_id
                );
                let _ = client.delete(&url).bearer_auth(&token).send().await;
            }
            Ok(())
        }
        _ => {
            if let Some(ev) = db.get_event(&mutation.event_id)? {
                let body = build_ms_event_payload(&ev);
                let url = if let Some(remote_id) = ev.remote_id.as_deref() {
                    format!(
                        "{}/me/calendars/{}/events/{}",
                        MS_GRAPH_BASE, cal.remote_id, remote_id
                    )
                } else {
                    format!("{}/me/calendars/{}/events", MS_GRAPH_BASE, cal.remote_id)
                };

                let req = if ev.remote_id.is_some() {
                    client.patch(&url)
                } else {
                    client.post(&url)
                };

                let res = req
                    .bearer_auth(&token)
                    .json(&body)
                    .send()
                    .await
                    .map_err(|e| e.to_string())?;

                if !res.status().is_success() {
                    let err_txt = res.text().await.unwrap_or_default();
                    return Err(format!("Microsoft Graph push error: {}", err_txt));
                }

                if let Ok(resp_json) = res.json::<Value>().await {
                    if let Some(rem_id) = resp_json.get("id").and_then(|v| v.as_str()) {
                        let etag = resp_json.get("@odata.etag").and_then(|v| v.as_str());
                        let _ = db.set_event_remote_id(&ev.id, rem_id, etag);
                    }
                }
            }
            Ok(())
        }
    }
}

fn build_ms_event_payload(ev: &EventMaster) -> Value {
    let start_dt = Utc
        .timestamp_opt(ev.start_ts, 0)
        .single()
        .unwrap_or_else(Utc::now);
    let end_dt = Utc
        .timestamp_opt(ev.end_ts, 0)
        .single()
        .unwrap_or_else(Utc::now);

    let mut payload = json!({
        "subject": ev.title,
        "body": {
            "contentType": "text",
            "content": ev.description,
        },
        "location": {
            "displayName": ev.location,
        },
        "start": {
            "dateTime": start_dt.format("%Y-%m-%dT%H:%M:%S").to_string(),
            "timeZone": "UTC"
        },
        "end": {
            "dateTime": end_dt.format("%Y-%m-%dT%H:%M:%S").to_string(),
            "timeZone": "UTC"
        },
        "isAllDay": ev.is_all_day,
    });

    if !ev.attendees.is_empty() {
        let ms_attendees: Vec<Value> = ev
            .attendees
            .iter()
            .map(|a| {
                json!({
                    "emailAddress": {
                        "address": a.email,
                        "name": a.display_name.clone().unwrap_or_else(|| a.email.clone())
                    },
                    "type": "required"
                })
            })
            .collect();
        payload["attendees"] = json!(ms_attendees);
    }

    if let Some(rrule) = &ev.rrule {
        if let Some(ms_rec) = rrule_to_ms_recurrence(rrule, ev.start_ts) {
            payload["recurrence"] = ms_rec;
        }
    }

    payload
}

fn parse_ms_datetime(val: Option<&Value>) -> i64 {
    let now_ts = Utc::now().timestamp();
    let dt_str = match val.and_then(|v| v.get("dateTime")).and_then(|v| v.as_str()) {
        Some(s) => s,
        None => return now_ts,
    };

    if let Ok(dt) = DateTime::parse_from_rfc3339(dt_str) {
        return dt.timestamp();
    }
    let trimmed = dt_str.split('.').next().unwrap_or(dt_str);
    if let Ok(ndt) = NaiveDateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S") {
        return Utc.from_utc_datetime(&ndt).timestamp();
    }
    now_ts
}

fn map_ms_response_status(raw: Option<&str>) -> String {
    match raw.unwrap_or("accepted") {
        "accepted" | "organizer" => "accepted".to_string(),
        "tentativelyAccepted" => "tentative".to_string(),
        "declined" => "declined".to_string(),
        _ => "needsAction".to_string(),
    }
}
