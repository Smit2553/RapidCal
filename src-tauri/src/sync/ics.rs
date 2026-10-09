use crate::db::Database;
use crate::models::{Account, Attendee, Calendar, UpsertEventInput};
use chrono::{DateTime, NaiveDate, NaiveDateTime, TimeZone, Utc};
use chrono_tz::Tz;
use reqwest::Client;
use sha2::{Digest, Sha256};
use std::collections::HashSet;

#[derive(Debug, Clone)]
pub struct ParsedIcsFeed {
    pub calendar_name: Option<String>,
    pub timezone: String,
    pub events: Vec<ParsedIcsEvent>,
}

#[derive(Debug, Clone)]
pub struct ParsedIcsEvent {
    pub uid: String,
    pub recurrence_id: Option<i64>,
    pub title: String,
    pub description: String,
    pub location: String,
    pub start_ts: i64,
    pub end_ts: i64,
    pub is_all_day: bool,
    pub timezone: String,
    pub rrule: Option<String>,
    pub exdates: Vec<i64>,
    pub status: String,
    pub attendees: Vec<Attendee>,
    pub conference_url: Option<String>,
    pub conference_provider: Option<String>,
}

/// Normalizes an `.ics` or `webcal://` URL into a validated `http://` or `https://` URL.
pub fn normalize_ics_url(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Please enter a valid .ics or webcal:// calendar URL.".to_string());
    }

    let replaced = if let Some(rest) = trimmed
        .strip_prefix("webcal://")
        .or_else(|| trimmed.strip_prefix("WEBCAL://"))
    {
        format!("https://{}", rest)
    } else if let Some(rest) = trimmed
        .strip_prefix("webcals://")
        .or_else(|| trimmed.strip_prefix("WEBCALS://"))
    {
        format!("https://{}", rest)
    } else {
        trimmed.to_string()
    };

    let parsed = url::Url::parse(&replaced)
        .map_err(|e| format!("Invalid calendar feed URL ({}): {}", trimmed, e))?;

    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(
            "Calendar feed URL must start with https://, http://, or webcal://".to_string(),
        );
    }

    Ok(parsed.to_string())
}

/// Connects or updates a read-only `.ics` calendar subscription account and performs an initial sync.
pub async fn connect_ics_account(
    client: &Client,
    db: &Database,
    raw_url: &str,
    custom_name: Option<String>,
) -> Result<Account, String> {
    let feed_url = normalize_ics_url(raw_url)?;

    let body = fetch_ics_text(client, &feed_url).await?;
    let parsed = parse_ics_feed(&body)?;

    // Deterministic account & calendar IDs derived from the normalized feed URL
    let mut hasher = Sha256::new();
    hasher.update(feed_url.as_bytes());
    let digest = format!("{:x}", hasher.finalize());
    let short_hash = &digest[..16];

    let acc_id = format!("acc-ics-{}", short_hash);
    let cal_id = format!("cal-ics-{}", short_hash);

    let host_label = url::Url::parse(&feed_url)
        .ok()
        .and_then(|u| u.host_str().map(|s| s.to_string()))
        .unwrap_or_else(|| "ics-feed".to_string());

    let resolved_name = custom_name
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .or(parsed.calendar_name.clone())
        .unwrap_or_else(|| format!("ICS Feed ({})", host_label));

    let now_iso = Utc::now().to_rfc3339();
    let account = Account {
        id: acc_id.clone(),
        provider: "ics".to_string(),
        email: feed_url.clone(),
        display_name: resolved_name.clone(),
        avatar_url: None,
        status: "connected".to_string(),
        last_synced_at: Some(now_iso.clone()),
        created_at: now_iso,
    };
    db.upsert_account(&account)?;

    let existing_cal = db.list_calendars()?.into_iter().find(|c| c.id == cal_id);

    let calendar = Calendar {
        id: cal_id,
        account_id: acc_id,
        remote_id: feed_url,
        name: resolved_name,
        color_hex: existing_cal
            .as_ref()
            .map(|c| c.color_hex.clone())
            .unwrap_or_else(|| "#0ea5e9".to_string()),
        is_visible: existing_cal.as_ref().map(|c| c.is_visible).unwrap_or(true),
        is_primary: false,
        access_role: "reader".to_string(),
        sync_token: None,
        timezone: parsed.timezone.clone(),
    };
    db.upsert_calendar(&calendar)?;

    apply_parsed_ics_events(db, &calendar, &parsed)?;

    Ok(account)
}

/// Syncs all `.ics` calendars belonging to an `"ics"` account.
pub async fn sync_ics_account(
    client: &Client,
    db: &Database,
    account: &Account,
) -> Result<usize, String> {
    let calendars: Vec<Calendar> = db
        .list_calendars()?
        .into_iter()
        .filter(|c| c.account_id == account.id)
        .collect();

    let mut total_synced = 0usize;
    for mut cal in calendars {
        let feed_url = normalize_ics_url(&cal.remote_id)?;
        let body = fetch_ics_text(client, &feed_url).await?;
        let parsed = parse_ics_feed(&body)?;

        if cal.timezone != parsed.timezone && !parsed.timezone.is_empty() {
            cal.timezone = parsed.timezone.clone();
            let _ = db.upsert_calendar(&cal);
        }

        total_synced += apply_parsed_ics_events(db, &cal, &parsed)?;
    }

    Ok(total_synced)
}

async fn fetch_ics_text(client: &Client, feed_url: &str) -> Result<String, String> {
    let res = client
        .get(feed_url)
        .header("Accept", "text/calendar, text/plain, */*")
        .send()
        .await
        .map_err(|e| format!("Failed to fetch .ics calendar feed: {}", e))?;

    if !res.status().is_success() {
        return Err(format!(
            "Calendar feed returned HTTP {} {}",
            res.status().as_u16(),
            res.status().canonical_reason().unwrap_or("")
        ));
    }

    let text = res
        .text()
        .await
        .map_err(|e| format!("Failed to read .ics response body: {}", e))?;

    if !text.contains("BEGIN:VCALENDAR") {
        return Err(
            "The URL did not return a valid iCalendar (.ics) feed (missing BEGIN:VCALENDAR)."
                .to_string(),
        );
    }

    Ok(text)
}

fn apply_parsed_ics_events(
    db: &Database,
    cal: &Calendar,
    parsed: &ParsedIcsFeed,
) -> Result<usize, String> {
    let existing_ids: HashSet<String> = db
        .list_event_ids_for_calendar(&cal.id)?
        .into_iter()
        .collect();
    let mut active_ids: HashSet<String> = HashSet::new();

    for ev in &parsed.events {
        let event_id = compute_ics_event_id(&cal.id, &ev.uid, ev.recurrence_id);

        if ev.status == "cancelled" {
            let _ = db.delete_event(&event_id, None, Some("all".to_string()));
            continue;
        }

        let input = UpsertEventInput {
            id: Some(event_id.clone()),
            calendar_id: cal.id.clone(),
            title: ev.title.clone(),
            description: Some(ev.description.clone()),
            location: Some(ev.location.clone()),
            start_ts: ev.start_ts,
            end_ts: ev.end_ts.max(ev.start_ts + 900),
            is_all_day: ev.is_all_day,
            timezone: Some(ev.timezone.clone()),
            rrule: ev.rrule.clone(),
            status: Some(ev.status.clone()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(ev.attendees.clone()),
            conference_url: ev.conference_url.clone(),
            conference_provider: ev.conference_provider.clone(),
            edit_scope: Some("all".to_string()),
            instance_start_ts: None,
        };

        let _ = db.upsert_event(input, false)?;
        let _ = db.set_event_remote_id(&event_id, &ev.uid, None);

        if !ev.exdates.is_empty() {
            let _ = db.set_event_exdates(&event_id, &ev.exdates);
        }

        active_ids.insert(event_id);
    }

    // Remove stale events that disappeared from the published .ics feed
    for stale_id in existing_ids.difference(&active_ids) {
        let _ = db.delete_event(stale_id, None, Some("all".to_string()));
    }

    Ok(active_ids.len())
}

fn compute_ics_event_id(cal_id: &str, uid: &str, recurrence_id: Option<i64>) -> String {
    let mut hasher = Sha256::new();
    hasher.update(cal_id.as_bytes());
    hasher.update(b":");
    hasher.update(uid.as_bytes());
    if let Some(rec_ts) = recurrence_id {
        hasher.update(b":");
        hasher.update(rec_ts.to_string().as_bytes());
    }
    let digest = format!("{:x}", hasher.finalize());
    format!("evt-ics-{}", &digest[..20])
}

/// Unfolds RFC 5545 lines (CRLF or LF followed by a single space or horizontal tab)
/// and parses the `.ics` feed into calendar metadata + `VEVENT` items.
pub fn parse_ics_feed(raw_ics: &str) -> Result<ParsedIcsFeed, String> {
    if !raw_ics.contains("BEGIN:VCALENDAR") {
        return Err("Invalid .ics content: missing BEGIN:VCALENDAR".to_string());
    }

    let unfolded = unfold_ics_lines(raw_ics);
    let mut calendar_name: Option<String> = None;
    let mut calendar_tz = "UTC".to_string();
    let mut events = Vec::new();

    let mut in_vevent = false;
    let mut in_subcomponent: usize = 0; // e.g., VALARM inside VEVENT
    let mut current_props: Vec<IcsProperty> = Vec::new();

    for line in unfolded {
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        if trimmed.eq_ignore_ascii_case("BEGIN:VEVENT") {
            in_vevent = true;
            in_subcomponent = 0;
            current_props.clear();
            continue;
        }

        if trimmed.eq_ignore_ascii_case("END:VEVENT") {
            if in_vevent {
                if let Some(ev) = build_ics_event(&current_props, &calendar_tz) {
                    events.push(ev);
                }
            }
            in_vevent = false;
            in_subcomponent = 0;
            current_props.clear();
            continue;
        }

        if in_vevent {
            if trimmed.len() >= 6 && trimmed[..6].eq_ignore_ascii_case("BEGIN:") {
                in_subcomponent += 1;
                continue;
            }
            if trimmed.len() >= 4 && trimmed[..4].eq_ignore_ascii_case("END:") {
                in_subcomponent = in_subcomponent.saturating_sub(1);
                continue;
            }
            if in_subcomponent > 0 {
                continue;
            }

            if let Some(prop) = parse_ics_property(&line) {
                current_props.push(prop);
            }
        } else if let Some(prop) = parse_ics_property(&line) {
            match prop.name.as_str() {
                "X-WR-CALNAME" => {
                    let unescaped = unescape_ics_text(&prop.value);
                    if !unescaped.trim().is_empty() {
                        calendar_name = Some(unescaped.trim().to_string());
                    }
                }
                "X-WR-TIMEZONE" => {
                    let raw_tz = unescape_ics_text(&prop.value);
                    if let Some(mapped) = normalize_tzid(raw_tz.trim()) {
                        calendar_tz = mapped;
                    }
                }
                _ => {}
            }
        }
    }

    Ok(ParsedIcsFeed {
        calendar_name,
        timezone: calendar_tz,
        events,
    })
}

#[derive(Debug, Clone)]
struct IcsProperty {
    name: String,
    params: Vec<(String, String)>,
    value: String,
}

impl IcsProperty {
    fn param(&self, key: &str) -> Option<&str> {
        self.params
            .iter()
            .find(|(k, _)| k.eq_ignore_ascii_case(key))
            .map(|(_, v)| v.as_str())
    }
}

fn unfold_ics_lines(raw: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw_line in raw.lines() {
        let clean_line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        if let Some(rest) = clean_line
            .strip_prefix(' ')
            .or_else(|| clean_line.strip_prefix('\t'))
        {
            if let Some(last) = lines.last_mut() {
                last.push_str(rest);
                continue;
            }
        }
        lines.push(clean_line.to_string());
    }
    lines
}

fn parse_ics_property(line: &str) -> Option<IcsProperty> {
    // Split at the first ':' that is not inside double quotes
    let mut in_quotes = false;
    let mut colon_idx = None;
    for (idx, ch) in line.char_indices() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == ':' && !in_quotes {
            colon_idx = Some(idx);
            break;
        }
    }

    let colon = colon_idx?;
    let left = &line[..colon];
    let value = line[colon + 1..].to_string();

    // Split left into property name and `;PARAM=VALUE` segments (respecting quotes)
    let mut segments = Vec::new();
    let mut start = 0;
    in_quotes = false;
    for (idx, ch) in left.char_indices() {
        if ch == '"' {
            in_quotes = !in_quotes;
        } else if ch == ';' && !in_quotes {
            segments.push(&left[start..idx]);
            start = idx + 1;
        }
    }
    segments.push(&left[start..]);

    let name = segments.first()?.trim().to_ascii_uppercase();
    if name.is_empty() {
        return None;
    }

    let mut params = Vec::new();
    for seg in segments.into_iter().skip(1) {
        if let Some((k, v)) = seg.split_once('=') {
            let clean_k = k.trim().to_ascii_uppercase();
            let clean_v = v.trim().trim_matches('"').to_string();
            params.push((clean_k, clean_v));
        }
    }

    Some(IcsProperty {
        name,
        params,
        value,
    })
}

fn build_ics_event(props: &[IcsProperty], default_tz: &str) -> Option<ParsedIcsEvent> {
    let mut uid: Option<String> = None;
    let mut recurrence_id: Option<i64> = None;
    let mut title = "Busy".to_string();
    let mut description = String::new();
    let mut location = String::new();
    let mut start_ts: Option<i64> = None;
    let mut end_ts: Option<i64> = None;
    let mut duration_secs: Option<i64> = None;
    let mut is_all_day = false;
    let mut event_tz = default_tz.to_string();
    let mut rrule: Option<String> = None;
    let mut exdates: Vec<i64> = Vec::new();
    let mut status = "confirmed".to_string();
    let mut attendees: Vec<Attendee> = Vec::new();
    let mut explicit_conf_url: Option<String> = None;

    for prop in props {
        match prop.name.as_str() {
            "UID" => {
                let v = unescape_ics_text(&prop.value).trim().to_string();
                if !v.is_empty() {
                    uid = Some(v);
                }
            }
            "SUMMARY" => {
                let v = unescape_ics_text(&prop.value).trim().to_string();
                if !v.is_empty() {
                    title = v;
                }
            }
            "DESCRIPTION" => {
                description = unescape_ics_text(&prop.value);
            }
            "LOCATION" => {
                location = unescape_ics_text(&prop.value);
            }
            "STATUS" => {
                let s = prop.value.trim().to_ascii_uppercase();
                status = match s.as_str() {
                    "TENTATIVE" => "tentative".to_string(),
                    "CANCELLED" => "cancelled".to_string(),
                    _ => "confirmed".to_string(),
                };
            }
            "DTSTART" => {
                if let Some((ts, all_day, resolved_tz)) = parse_ics_datetime(prop, default_tz) {
                    start_ts = Some(ts);
                    is_all_day = all_day;
                    if let Some(tz_str) = resolved_tz {
                        event_tz = tz_str;
                    }
                }
            }
            "DTEND" => {
                if let Some((ts, _, _)) = parse_ics_datetime(prop, default_tz) {
                    end_ts = Some(ts);
                }
            }
            "DURATION" => {
                duration_secs = parse_ics_duration(prop.value.trim());
            }
            "RECURRENCE-ID" => {
                if let Some((ts, _, _)) = parse_ics_datetime(prop, default_tz) {
                    recurrence_id = Some(ts);
                }
            }
            "RRULE" => {
                let clean = prop
                    .value
                    .trim()
                    .strip_prefix("RRULE:")
                    .unwrap_or(prop.value.trim())
                    .trim();
                if !clean.is_empty() {
                    rrule = Some(clean.to_string());
                }
            }
            "EXDATE" => {
                let tz_param = prop.param("TZID");
                for part in prop.value.split(',') {
                    let single_prop = IcsProperty {
                        name: "EXDATE".to_string(),
                        params: tz_param
                            .map(|t| vec![("TZID".to_string(), t.to_string())])
                            .unwrap_or_default(),
                        value: part.trim().to_string(),
                    };
                    if let Some((ts, _, _)) = parse_ics_datetime(&single_prop, &event_tz) {
                        if !exdates.contains(&ts) {
                            exdates.push(ts);
                        }
                    }
                }
            }
            "ATTENDEE" => {
                let email = prop
                    .value
                    .trim()
                    .strip_prefix("mailto:")
                    .or_else(|| prop.value.trim().strip_prefix("MAILTO:"))
                    .unwrap_or(prop.value.trim())
                    .trim()
                    .to_string();
                if !email.is_empty() {
                    let display_name = prop.param("CN").map(unescape_ics_text);
                    let response_status = match prop
                        .param("PARTSTAT")
                        .unwrap_or("NEEDS-ACTION")
                        .to_ascii_uppercase()
                        .as_str()
                    {
                        "ACCEPTED" => "accepted",
                        "TENTATIVE" => "tentative",
                        "DECLINED" => "declined",
                        _ => "needsAction",
                    }
                    .to_string();
                    attendees.push(Attendee {
                        email,
                        display_name,
                        response_status,
                        is_organizer: false,
                        is_self: false,
                    });
                }
            }
            "X-MICROSOFT-SKYPETEAMSMEETINGURL" | "X-GOOGLE-CONFERENCE" | "CONFERENCE" | "URL" => {
                let candidate = unescape_ics_text(&prop.value).trim().to_string();
                if candidate.starts_with("https://") || candidate.starts_with("http://") {
                    explicit_conf_url = Some(candidate);
                }
            }
            _ => {}
        }
    }

    let resolved_start = start_ts?;
    let resolved_end = end_ts
        .or_else(|| duration_secs.map(|d| resolved_start + d))
        .unwrap_or_else(|| {
            if is_all_day {
                resolved_start + 86_400
            } else {
                resolved_start + 3_600
            }
        });

    let resolved_uid = uid.unwrap_or_else(|| format!("anon-{}-{}", resolved_start, title));

    let combined_search_text = format!(
        "{} {} {}",
        explicit_conf_url.as_deref().unwrap_or(""),
        location,
        description
    );
    let (conference_url, conference_provider) =
        detect_conference_from_text(&combined_search_text, explicit_conf_url.as_deref());

    Some(ParsedIcsEvent {
        uid: resolved_uid,
        recurrence_id,
        title,
        description,
        location,
        start_ts: resolved_start,
        end_ts: resolved_end.max(resolved_start + 900),
        is_all_day,
        timezone: event_tz,
        rrule,
        exdates,
        status,
        attendees,
        conference_url,
        conference_provider,
    })
}

fn parse_ics_datetime(
    prop: &IcsProperty,
    fallback_tz: &str,
) -> Option<(i64, bool, Option<String>)> {
    let val = prop.value.trim();
    let is_date_param = prop
        .param("VALUE")
        .map(|v| v.eq_ignore_ascii_case("DATE"))
        .unwrap_or(false);

    let tz_str = prop
        .param("TZID")
        .and_then(normalize_tzid)
        .unwrap_or_else(|| fallback_tz.to_string());

    // All-day date: YYYYMMDD
    if is_date_param || (val.len() == 8 && val.chars().all(|c| c.is_ascii_digit())) {
        let date = NaiveDate::parse_from_str(val, "%Y%m%d").ok()?;
        let naive_dt = date.and_hms_opt(0, 0, 0)?;
        let ts = Utc.from_utc_datetime(&naive_dt).timestamp();
        return Some((ts, true, Some(tz_str)));
    }

    // UTC date-time: YYYYMMDDTHHMMSSZ or YYYYMMDDTHHMMZ
    if let Some(stripped) = val.strip_suffix('Z').or_else(|| val.strip_suffix('z')) {
        let naive = NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M%S")
            .or_else(|_| NaiveDateTime::parse_from_str(stripped, "%Y%m%dT%H%M"))
            .ok()?;
        let ts = Utc.from_utc_datetime(&naive).timestamp();
        return Some((ts, false, Some(tz_str)));
    }

    // Local/TZID date-time: YYYYMMDDTHHMMSS or YYYYMMDDTHHMM
    if let Ok(naive) = NaiveDateTime::parse_from_str(val, "%Y%m%dT%H%M%S")
        .or_else(|_| NaiveDateTime::parse_from_str(val, "%Y%m%dT%H%M"))
    {
        if let Ok(tz) = tz_str.parse::<Tz>() {
            if let Some(dt) = tz
                .from_local_datetime(&naive)
                .earliest()
                .or_else(|| tz.from_local_datetime(&naive).latest())
            {
                return Some((dt.timestamp(), false, Some(tz.name().to_string())));
            }
        }
        let ts = Utc.from_utc_datetime(&naive).timestamp();
        return Some((ts, false, Some(tz_str)));
    }

    // ISO-8601 fallback
    if let Ok(dt) = DateTime::parse_from_rfc3339(val) {
        return Some((dt.timestamp(), false, Some(tz_str)));
    }

    None
}

fn parse_ics_duration(raw: &str) -> Option<i64> {
    let s = raw.trim().strip_prefix('+').unwrap_or(raw.trim());
    if s.starts_with('-') || !s.starts_with('P') {
        return None;
    }
    let body = &s[1..];
    let mut total_secs: i64 = 0;
    let mut num_buf = String::new();
    let mut in_time = false;

    for ch in body.chars() {
        if ch == 'T' {
            in_time = true;
            continue;
        }
        if ch.is_ascii_digit() {
            num_buf.push(ch);
            continue;
        }
        let n: i64 = num_buf.parse().unwrap_or(0);
        num_buf.clear();
        match (in_time, ch) {
            (false, 'W') => total_secs += n * 7 * 86_400,
            (false, 'D') => total_secs += n * 86_400,
            (true, 'H') => total_secs += n * 3_600,
            (true, 'M') => total_secs += n * 60,
            (true, 'S') => total_secs += n,
            _ => {}
        }
    }

    if total_secs > 0 {
        Some(total_secs)
    } else {
        None
    }
}

fn unescape_ics_text(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\\' {
            match chars.peek().copied() {
                Some('n') | Some('N') => {
                    chars.next();
                    out.push('\n');
                }
                Some(',') => {
                    chars.next();
                    out.push(',');
                }
                Some(';') => {
                    chars.next();
                    out.push(';');
                }
                Some('\\') => {
                    chars.next();
                    out.push('\\');
                }
                _ => out.push(ch),
            }
        } else {
            out.push(ch);
        }
    }
    out
}

/// Maps both IANA timezone names and Microsoft Windows / Outlook `TZID` names to canonical IANA names.
pub fn normalize_tzid(raw_tzid: &str) -> Option<String> {
    let cleaned = raw_tzid.trim().trim_matches('"');
    if cleaned.is_empty() {
        return None;
    }

    if let Ok(tz) = cleaned.parse::<Tz>() {
        return Some(tz.name().to_string());
    }

    // Handle leading slash in some iCal generators (e.g., `/America/Phoenix`)
    if let Some(stripped) = cleaned.strip_prefix('/') {
        if let Ok(tz) = stripped.parse::<Tz>() {
            return Some(tz.name().to_string());
        }
    }

    let mapped = match cleaned {
        "UTC" | "Etc/GMT" | "GMT Standard Time" | "Greenwich Standard Time" => "UTC",
        "US Mountain Standard Time" => "America/Phoenix",
        "Mountain Standard Time" | "Mountain Daylight Time" => "America/Denver",
        "Pacific Standard Time" | "Pacific Daylight Time" => "America/Los_Angeles",
        "Central Standard Time" | "Central Daylight Time" => "America/Chicago",
        "Eastern Standard Time" | "Eastern Daylight Time" | "US Eastern Standard Time" => {
            "America/New_York"
        }
        "Alaskan Standard Time" => "America/Anchorage",
        "Hawaiian Standard Time" => "Pacific/Honolulu",
        "Atlantic Standard Time" => "America/Halifax",
        "Canada Central Standard Time" => "America/Regina",
        "Central Standard Time (Mexico)" => "America/Mexico_City",
        "SA Pacific Standard Time" => "America/Bogota",
        "E. South America Standard Time" => "America/Sao_Paulo",
        "Argentina Standard Time" => "America/Argentina/Buenos_Aires",
        "W. Europe Standard Time"
        | "Romance Standard Time"
        | "Central Europe Standard Time"
        | "Central European Standard Time" => "Europe/Berlin",
        "GMT" | "W. Europe Daylight Time" => "Europe/London",
        "GTB Standard Time" | "FLE Standard Time" => "Europe/Athens",
        "Russian Standard Time" => "Europe/Moscow",
        "Israel Standard Time" => "Asia/Jerusalem",
        "Arabian Standard Time" => "Asia/Dubai",
        "India Standard Time" => "Asia/Kolkata",
        "China Standard Time" | "Singapore Standard Time" | "Taipei Standard Time" => {
            "Asia/Singapore"
        }
        "Tokyo Standard Time" => "Asia/Tokyo",
        "Korea Standard Time" => "Asia/Seoul",
        "AUS Eastern Standard Time" => "Australia/Sydney",
        "E. Australia Standard Time" => "Australia/Brisbane",
        "Cen. Australia Standard Time" => "Australia/Adelaide",
        "W. Australia Standard Time" => "Australia/Perth",
        "New Zealand Standard Time" => "Pacific/Auckland",
        _ => return None,
    };

    Some(mapped.to_string())
}

fn detect_conference_from_text(
    text: &str,
    explicit_url: Option<&str>,
) -> (Option<String>, Option<String>) {
    if let Some(url) = explicit_url {
        let lower = url.to_ascii_lowercase();
        if lower.contains("teams.microsoft.com") || lower.contains("teams.live.com") {
            return (Some(url.to_string()), Some("teams".to_string()));
        }
        if lower.contains("meet.google.com") {
            return (Some(url.to_string()), Some("meet".to_string()));
        }
        if lower.contains("zoom.us") {
            return (Some(url.to_string()), Some("zoom".to_string()));
        }
        if lower.contains("webex.com") {
            return (Some(url.to_string()), Some("webex".to_string()));
        }
    }

    for token in text.split(|c: char| {
        c.is_whitespace() || matches!(c, '<' | '>' | '"' | '\'' | '(' | ')' | '[' | ']')
    }) {
        let clean = token.trim_end_matches(['.', ',', ';']);
        let lower = clean.to_ascii_lowercase();
        if lower.starts_with("https://meet.google.com/") {
            return (Some(clean.to_string()), Some("meet".to_string()));
        }
        if lower.starts_with("https://teams.microsoft.com/")
            || lower.starts_with("https://teams.live.com/")
        {
            return (Some(clean.to_string()), Some("teams".to_string()));
        }
        if lower.contains("zoom.us/j/") || lower.contains("zoom.us/my/") {
            return (Some(clean.to_string()), Some("zoom".to_string()));
        }
        if lower.contains("webex.com/meet/") || lower.contains("webex.com/join/") {
            return (Some(clean.to_string()), Some("webex".to_string()));
        }
    }

    (None, None)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_normalize_ics_url_converts_webcal_and_validates() {
        assert_eq!(
            normalize_ics_url("webcal://outlook.office365.com/owa/calendar/123/reachcalendar.ics")
                .unwrap(),
            "https://outlook.office365.com/owa/calendar/123/reachcalendar.ics"
        );
        assert_eq!(
            normalize_ics_url(
                "  https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics  "
            )
            .unwrap(),
            "https://outlook.office365.com/owa/calendar/abc/reachcalendar.ics"
        );
        assert!(normalize_ics_url("").is_err());
        assert!(normalize_ics_url("ftp://example.com/cal.ics").is_err());
        assert!(normalize_ics_url("javascript:alert(1)").is_err());
    }

    #[test]
    fn test_parse_outlook_ics_feed_with_asu_timezone_teams_and_rrule() {
        let sample_ics = concat!(
            "BEGIN:VCALENDAR\r\n",
            "PRODID:-//Microsoft Corporation//Outlook 16.0 MIMEDIR//EN\r\n",
            "VERSION:2.0\r\n",
            "METHOD:PUBLISH\r\n",
            "X-WR-CALNAME:ASU Calendar - ssdevruk@asu.edu\r\n",
            "X-WR-TIMEZONE:US Mountain Standard Time\r\n",
            "BEGIN:VEVENT\r\n",
            "UID:040000008200E00074C5B7101A82E00800000000\r\n",
            "SUMMARY:CSE 575 Statistical Machine Learning\r\n",
            "DESCRIPTION:Join Microsoft Teams Meeting\\nhttps://teams.microsoft.com/l/me\r\n",
            " etup-join/19%3ameeting_asu_cse575\r\n",
            "LOCATION:BYENG 210\r\n",
            "DTSTART;TZID=\"US Mountain Standard Time\":20261012T103000\r\n",
            "DTEND;TZID=\"US Mountain Standard Time\":20261012T114500\r\n",
            "RRULE:FREQ=WEEKLY;BYDAY=MO,WE\r\n",
            "EXDATE;TZID=\"US Mountain Standard Time\":20261014T103000\r\n",
            "STATUS:CONFIRMED\r\n",
            "END:VEVENT\r\n",
            "END:VCALENDAR\r\n"
        );

        let feed = parse_ics_feed(sample_ics).expect("Should parse Outlook .ics feed");
        assert_eq!(
            feed.calendar_name.as_deref(),
            Some("ASU Calendar - ssdevruk@asu.edu")
        );
        assert_eq!(feed.timezone, "America/Phoenix");
        assert_eq!(feed.events.len(), 1);

        let ev = &feed.events[0];
        assert_eq!(ev.title, "CSE 575 Statistical Machine Learning");
        assert_eq!(ev.location, "BYENG 210");
        assert_eq!(ev.timezone, "America/Phoenix");
        assert_eq!(ev.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=MO,WE"));
        assert_eq!(ev.exdates.len(), 1);
        assert_eq!(
            ev.conference_url.as_deref(),
            Some("https://teams.microsoft.com/l/meetup-join/19%3ameeting_asu_cse575")
        );
        assert_eq!(ev.conference_provider.as_deref(), Some("teams"));
        // 2026-10-12 10:30:00 in America/Phoenix (UTC-7) == 2026-10-12 17:30:00 UTC
        assert_eq!(ev.start_ts, 1_791_826_200);
        assert_eq!(ev.end_ts - ev.start_ts, 75 * 60);
    }
}
