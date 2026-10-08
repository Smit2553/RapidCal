use crate::auth::{google::get_valid_google_access_token, CredentialVault};
use crate::db::Database;
use crate::models::{Account, Attendee, Calendar, EventMaster, OutboxMutation, UpsertEventInput};
use crate::rrule_engine::normalize_rrule;
use chrono::{DateTime, NaiveDate, TimeZone, Utc};
use reqwest::{Client, StatusCode};
use serde_json::{json, Value};

const GCAL_BASE: &str = "https://www.googleapis.com/calendar/v3";

pub async fn sync_google_account(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    account: &Account,
) -> Result<usize, String> {
    let token = get_valid_google_access_token(client, db, vault, &account.id).await?;

    // 1. Fetch calendarList
    let cal_list_url = format!("{}/users/me/calendarList", GCAL_BASE);
    let res = client
        .get(&cal_list_url)
        .bearer_auth(&token)
        .send()
        .await
        .map_err(|e| format!("Google calendarList request failed: {}", e))?;

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Google calendarList error: {}", body));
    }

    let payload: Value = res.json().await.map_err(|e| e.to_string())?;
    let existing_cals = db.list_calendars()?;
    let mut synced_events_count = 0usize;

    if let Some(items) = payload.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let remote_id = match item.get("id").and_then(|v| v.as_str()) {
                Some(id) => id.to_string(),
                None => continue,
            };
            let local_cal_id = existing_cals
                .iter()
                .find(|c| c.account_id == account.id && c.remote_id == remote_id)
                .map(|c| c.id.clone())
                .unwrap_or_else(|| format!("cal-g-{}", uuid::Uuid::new_v4()));

            let prev_sync_token = existing_cals
                .iter()
                .find(|c| c.id == local_cal_id)
                .and_then(|c| c.sync_token.clone());

            let cal = Calendar {
                id: local_cal_id.clone(),
                account_id: account.id.clone(),
                remote_id: remote_id.clone(),
                name: item
                    .get("summary")
                    .and_then(|v| v.as_str())
                    .unwrap_or("Google Calendar")
                    .to_string(),
                color_hex: item
                    .get("backgroundColor")
                    .and_then(|v| v.as_str())
                    .unwrap_or("#6366f1")
                    .to_string(),
                is_visible: true,
                is_primary: item
                    .get("primary")
                    .and_then(|v| v.as_bool())
                    .unwrap_or(false),
                access_role: item
                    .get("accessRole")
                    .and_then(|v| v.as_str())
                    .unwrap_or("owner")
                    .to_string(),
                sync_token: prev_sync_token.clone(),
                timezone: item
                    .get("timeZone")
                    .and_then(|v| v.as_str())
                    .unwrap_or("UTC")
                    .to_string(),
            };
            db.upsert_calendar(&cal)?;

            if let Ok(cnt) =
                sync_google_calendar_events(client, db, &token, &cal, prev_sync_token.as_deref())
                    .await
            {
                synced_events_count += cnt;
            }
        }
    }

    Ok(synced_events_count)
}

async fn sync_google_calendar_events(
    client: &Client,
    db: &Database,
    token: &str,
    cal: &Calendar,
    sync_token: Option<&str>,
) -> Result<usize, String> {
    let encoded_cal_id = urlencoding_encode(&cal.remote_id);
    let events_url = format!("{}/calendars/{}/events", GCAL_BASE, encoded_cal_id);

    let mut req = client
        .get(&events_url)
        .bearer_auth(token)
        .query(&[("singleEvents", "false"), ("maxResults", "250")]);

    if let Some(st) = sync_token {
        req = req.query(&[("syncToken", st)]);
    }

    let res = req.send().await.map_err(|e| e.to_string())?;

    // 410 GONE means Google invalidated the incremental syncToken -> full resync
    if res.status() == StatusCode::GONE {
        return Box::pin(sync_google_calendar_events(client, db, token, cal, None)).await;
    }

    if !res.status().is_success() {
        let body = res.text().await.unwrap_or_default();
        return Err(format!("Google events delta error: {}", body));
    }

    let body: Value = res.json().await.map_err(|e| e.to_string())?;
    let mut count = 0usize;

    if let Some(items) = body.get("items").and_then(|v| v.as_array()) {
        for item in items {
            let remote_id = match item.get("id").and_then(|v| v.as_str()) {
                Some(id) => id,
                None => continue,
            };
            let local_id = format!("evt-g-{}-{}", cal.id, remote_id);
            let status = item
                .get("status")
                .and_then(|v| v.as_str())
                .unwrap_or("confirmed");

            if status == "cancelled" {
                let _ = db.delete_event(&local_id, None, Some("all".to_string()));
                continue;
            }

            let (start_ts, is_all_day, tz) = parse_gcal_time(item.get("start"), &cal.timezone);
            let (end_ts, _, _) = parse_gcal_time(item.get("end"), &cal.timezone);

            let rrule = item
                .get("recurrence")
                .and_then(|v| v.as_array())
                .and_then(|arr| {
                    arr.iter()
                        .filter_map(|line| line.as_str())
                        .find(|line| line.to_uppercase().starts_with("RRULE:"))
                        .map(normalize_rrule)
                });

            let mut conference_url = item
                .get("hangoutLink")
                .and_then(|v| v.as_str())
                .map(String::from);
            let mut conference_provider = conference_url.as_ref().map(|_| "meet".to_string());

            if conference_url.is_none() {
                if let Some(entry_points) = item
                    .get("conferenceData")
                    .and_then(|c| c.get("entryPoints"))
                    .and_then(|e| e.as_array())
                {
                    if let Some(video_uri) = entry_points
                        .iter()
                        .find(|ep| {
                            ep.get("entryPointType").and_then(|t| t.as_str()) == Some("video")
                        })
                        .and_then(|ep| ep.get("uri").and_then(|u| u.as_str()))
                    {
                        conference_url = Some(video_uri.to_string());
                        conference_provider = Some("meet".to_string());
                    }
                }
            }

            let mut self_rsvp = "accepted".to_string();
            let mut attendees = Vec::new();
            if let Some(att_arr) = item.get("attendees").and_then(|v| v.as_array()) {
                for a in att_arr {
                    let email = a
                        .get("email")
                        .and_then(|v| v.as_str())
                        .unwrap_or("")
                        .to_string();
                    let resp = a
                        .get("responseStatus")
                        .and_then(|v| v.as_str())
                        .unwrap_or("needsAction")
                        .to_string();
                    let is_self = a.get("self").and_then(|v| v.as_bool()).unwrap_or(false);
                    if is_self {
                        self_rsvp = resp.clone();
                    }
                    attendees.push(Attendee {
                        email,
                        display_name: a
                            .get("displayName")
                            .and_then(|v| v.as_str())
                            .map(String::from),
                        response_status: resp,
                        is_organizer: a
                            .get("organizer")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false),
                        is_self,
                    });
                }
            }

            let _ = db.upsert_event(
                UpsertEventInput {
                    id: Some(local_id),
                    calendar_id: cal.id.clone(),
                    title: item
                        .get("summary")
                        .and_then(|v| v.as_str())
                        .unwrap_or("(No title)")
                        .to_string(),
                    description: item
                        .get("description")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    location: item
                        .get("location")
                        .and_then(|v| v.as_str())
                        .map(String::from),
                    start_ts,
                    end_ts: end_ts.max(start_ts + 300),
                    is_all_day,
                    timezone: Some(tz),
                    rrule,
                    status: Some(status.to_string()),
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

    if let Some(next_token) = body.get("nextSyncToken").and_then(|v| v.as_str()) {
        let mut updated_cal = cal.clone();
        updated_cal.sync_token = Some(next_token.to_string());
        let _ = db.upsert_calendar(&updated_cal);
    }

    Ok(count)
}

pub async fn push_google_outbox_mutation(
    client: &Client,
    db: &Database,
    vault: &CredentialVault,
    mutation: &OutboxMutation,
) -> Result<(), String> {
    let token = get_valid_google_access_token(client, db, vault, &mutation.account_id).await?;
    let cals = db.list_calendars()?;
    let cal = cals
        .iter()
        .find(|c| c.id == mutation.calendar_id)
        .ok_or_else(|| "Calendar not found for Google outbox push".to_string())?;
    let encoded_cal_id = urlencoding_encode(&cal.remote_id);

    match mutation.operation.as_str() {
        "delete" => {
            let payload: Value =
                serde_json::from_str(&mutation.payload_json).unwrap_or_else(|_| json!({}));
            if let Some(remote_id) = payload.get("remoteId").and_then(|v| v.as_str()) {
                let url = format!(
                    "{}/calendars/{}/events/{}",
                    GCAL_BASE,
                    encoded_cal_id,
                    urlencoding_encode(remote_id)
                );
                let _ = client.delete(&url).bearer_auth(&token).send().await;
            }
            Ok(())
        }
        _ => {
            if let Some(ev) = db.get_event(&mutation.event_id)? {
                let body = build_gcal_event_payload(&ev);
                let url = if let Some(remote_id) = ev.remote_id.as_deref() {
                    format!(
                        "{}/calendars/{}/events/{}",
                        GCAL_BASE,
                        encoded_cal_id,
                        urlencoding_encode(remote_id)
                    )
                } else {
                    format!("{}/calendars/{}/events", GCAL_BASE, encoded_cal_id)
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
                    return Err(format!("Google outbox push HTTP error: {}", err_txt));
                }

                if let Ok(resp_json) = res.json::<Value>().await {
                    if let Some(rem_id) = resp_json.get("id").and_then(|v| v.as_str()) {
                        let etag = resp_json.get("etag").and_then(|v| v.as_str());
                        let _ = db.set_event_remote_id(&ev.id, rem_id, etag);
                    }
                }
            }
            Ok(())
        }
    }
}

fn build_gcal_event_payload(ev: &EventMaster) -> Value {
    let start_dt = Utc
        .timestamp_opt(ev.start_ts, 0)
        .single()
        .unwrap_or_else(Utc::now);
    let end_dt = Utc
        .timestamp_opt(ev.end_ts, 0)
        .single()
        .unwrap_or_else(Utc::now);

    let (start_obj, end_obj) = if ev.is_all_day {
        (
            json!({ "date": start_dt.format("%Y-%m-%d").to_string() }),
            json!({ "date": end_dt.format("%Y-%m-%d").to_string() }),
        )
    } else {
        (
            json!({ "dateTime": start_dt.to_rfc3339(), "timeZone": ev.timezone }),
            json!({ "dateTime": end_dt.to_rfc3339(), "timeZone": ev.timezone }),
        )
    };

    let mut payload = json!({
        "summary": ev.title,
        "description": ev.description,
        "location": ev.location,
        "start": start_obj,
        "end": end_obj,
        "status": ev.status,
    });

    if !ev.attendees.is_empty() {
        let gcal_attendees: Vec<Value> = ev
            .attendees
            .iter()
            .map(|a| {
                json!({
                    "email": a.email,
                    "displayName": a.display_name,
                    "responseStatus": a.response_status,
                })
            })
            .collect();
        payload["attendees"] = json!(gcal_attendees);
    }

    if let Some(rrule) = &ev.rrule {
        payload["recurrence"] = json!([format!("RRULE:{}", normalize_rrule(rrule))]);
    }

    payload
}

fn parse_gcal_time(val: Option<&Value>, fallback_tz: &str) -> (i64, bool, String) {
    let now_ts = Utc::now().timestamp();
    let obj = match val {
        Some(v) => v,
        None => return (now_ts, false, fallback_tz.to_string()),
    };
    let tz = obj
        .get("timeZone")
        .and_then(|v| v.as_str())
        .unwrap_or(fallback_tz)
        .to_string();

    if let Some(dt_str) = obj.get("dateTime").and_then(|v| v.as_str()) {
        if let Ok(dt) = DateTime::parse_from_rfc3339(dt_str) {
            return (dt.timestamp(), false, tz);
        }
    }
    if let Some(d_str) = obj.get("date").and_then(|v| v.as_str()) {
        if let Ok(nd) = NaiveDate::parse_from_str(d_str, "%Y-%m-%d") {
            if let Some(ndt) = nd.and_hms_opt(0, 0, 0) {
                return (Utc.from_utc_datetime(&ndt).timestamp(), true, tz);
            }
        }
    }
    (now_ts, false, tz)
}

fn urlencoding_encode(input: &str) -> String {
    url::form_urlencoded::byte_serialize(input.as_bytes()).collect()
}
