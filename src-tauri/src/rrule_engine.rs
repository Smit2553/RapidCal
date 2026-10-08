use chrono::{DateTime, Datelike, TimeZone, Utc};
use rrule::{RRuleSet, Tz};
use serde_json::{json, Value};
use std::collections::HashSet;
use std::str::FromStr;

/// Normalize an incoming RRULE string into a clean `FREQ=...` clause (without leading `RRULE:`).
pub fn normalize_rrule(raw: &str) -> String {
    let trimmed = raw.trim();
    let without_prefix = trimmed
        .strip_prefix("RRULE:")
        .or_else(|| trimmed.strip_prefix("rrule:"))
        .unwrap_or(trimmed);
    without_prefix.trim().to_uppercase()
}

/// Expand a master event (with optional RFC 5545 RRULE) into `(instance_start_ts, instance_end_ts)` pairs
/// intersecting `[window_start_ts, window_end_ts]`.
#[allow(clippy::too_many_arguments)]
pub fn expand_event_instances(
    event_start_ts: i64,
    event_end_ts: i64,
    timezone: &str,
    rrule_opt: Option<&str>,
    exdates: &[i64],
    window_start_ts: i64,
    window_end_ts: i64,
    max_instances: usize,
) -> Vec<(i64, i64)> {
    let duration = (event_end_ts - event_start_ts).max(0);
    let exdate_set: HashSet<i64> = exdates.iter().copied().collect();

    let rrule_raw = match rrule_opt.map(str::trim).filter(|s| !s.is_empty()) {
        Some(r) => r,
        None => {
            if event_end_ts >= window_start_ts
                && event_start_ts <= window_end_ts
                && !exdate_set.contains(&event_start_ts)
            {
                return vec![(event_start_ts, event_end_ts)];
            }
            return Vec::new();
        }
    };

    let clean_rule = normalize_rrule(rrule_raw);

    // Resolve timezone via rrule::Tz, defaulting to UTC
    let tz: Tz = chrono_tz::Tz::from_str(timezone)
        .map(Tz::Tz)
        .unwrap_or(Tz::UTC);

    let start_utc = match Utc.timestamp_opt(event_start_ts, 0).single() {
        Some(dt) => dt,
        None => return Vec::new(),
    };
    let start_local = start_utc.with_timezone(&tz);

    // Format DTSTART with TZID (or Z if UTC)
    let dtstart_line = match tz {
        t if t == Tz::UTC => format!("DTSTART:{}", start_utc.format("%Y%m%dT%H%M%SZ")),
        Tz::Tz(ctz) => format!(
            "DTSTART;TZID={}:{}",
            ctz.name(),
            start_local.format("%Y%m%dT%H%M%S")
        ),
        _ => format!("DTSTART:{}", start_utc.format("%Y%m%dT%H%M%SZ")),
    };

    let rruleset_str = format!("{}\nRRULE:{}", dtstart_line, clean_rule);

    if let Ok(rrule_set) = rruleset_str.parse::<RRuleSet>() {
        // Bound the search window so we don't expand unbounded rules forever
        let search_after_ts = (window_start_ts - duration - 86_400).max(event_start_ts - 86_400);
        let search_before_ts = window_end_ts + 86_400;

        if let (Some(after_utc), Some(before_utc)) = (
            Utc.timestamp_opt(search_after_ts, 0).single(),
            Utc.timestamp_opt(search_before_ts, 0).single(),
        ) {
            let after_tz = after_utc.with_timezone(&tz);
            let before_tz = before_utc.with_timezone(&tz);

            let result = rrule_set
                .after(after_tz)
                .before(before_tz)
                .all(max_instances as u16);

            let mut instances = Vec::with_capacity(result.dates.len());
            for occ in result.dates {
                let occ_start = occ.timestamp();
                let occ_end = occ_start + duration;
                // Exclude if exact timestamp or same local day matches an exdate
                if exdate_set.contains(&occ_start)
                    || exdate_set.iter().any(|&ex| (ex - occ_start).abs() < 60)
                {
                    continue;
                }
                if occ_end >= window_start_ts && occ_start <= window_end_ts {
                    instances.push((occ_start, occ_end));
                }
            }
            return instances;
        }
    }

    // Resilient fallback if an external provider gives a non-standard rule
    if event_end_ts >= window_start_ts
        && event_start_ts <= window_end_ts
        && !exdate_set.contains(&event_start_ts)
    {
        vec![(event_start_ts, event_end_ts)]
    } else {
        Vec::new()
    }
}

/// Convert a Microsoft Graph `patternedRecurrence` JSON object into an RFC 5545 `RRULE` string.
pub fn ms_recurrence_to_rrule(recurrence: &Value) -> Option<String> {
    let pattern = recurrence.get("pattern")?;
    let pattern_type = pattern.get("type")?.as_str()?;
    let interval = pattern
        .get("interval")
        .and_then(|v| v.as_u64())
        .unwrap_or(1)
        .max(1);

    let mut parts: Vec<String> = Vec::new();

    match pattern_type {
        "daily" => {
            parts.push("FREQ=DAILY".to_string());
        }
        "weekly" => {
            parts.push("FREQ=WEEKLY".to_string());
            if let Some(days) = pattern.get("daysOfWeek").and_then(|v| v.as_array()) {
                let byday: Vec<&str> = days
                    .iter()
                    .filter_map(|d| d.as_str())
                    .filter_map(ms_day_to_rrule_day)
                    .collect();
                if !byday.is_empty() {
                    parts.push(format!("BYDAY={}", byday.join(",")));
                }
            }
        }
        "absoluteMonthly" => {
            parts.push("FREQ=MONTHLY".to_string());
            if let Some(dom) = pattern.get("dayOfMonth").and_then(|v| v.as_u64()) {
                parts.push(format!("BYMONTHDAY={}", dom));
            }
        }
        "relativeMonthly" => {
            parts.push("FREQ=MONTHLY".to_string());
            let index_prefix = pattern
                .get("index")
                .and_then(|v| v.as_str())
                .and_then(ms_index_to_rrule_pos)
                .unwrap_or("1");
            if let Some(days) = pattern.get("daysOfWeek").and_then(|v| v.as_array()) {
                if let Some(first_day) = days
                    .first()
                    .and_then(|d| d.as_str())
                    .and_then(ms_day_to_rrule_day)
                {
                    parts.push(format!("BYDAY={}{}", index_prefix, first_day));
                }
            }
        }
        "absoluteYearly" => {
            parts.push("FREQ=YEARLY".to_string());
            if let Some(month) = pattern.get("month").and_then(|v| v.as_u64()) {
                parts.push(format!("BYMONTH={}", month));
            }
            if let Some(dom) = pattern.get("dayOfMonth").and_then(|v| v.as_u64()) {
                parts.push(format!("BYMONTHDAY={}", dom));
            }
        }
        "relativeYearly" => {
            parts.push("FREQ=YEARLY".to_string());
            if let Some(month) = pattern.get("month").and_then(|v| v.as_u64()) {
                parts.push(format!("BYMONTH={}", month));
            }
            let index_prefix = pattern
                .get("index")
                .and_then(|v| v.as_str())
                .and_then(ms_index_to_rrule_pos)
                .unwrap_or("1");
            if let Some(days) = pattern.get("daysOfWeek").and_then(|v| v.as_array()) {
                if let Some(first_day) = days
                    .first()
                    .and_then(|d| d.as_str())
                    .and_then(ms_day_to_rrule_day)
                {
                    parts.push(format!("BYDAY={}{}", index_prefix, first_day));
                }
            }
        }
        _ => return None,
    }

    if interval > 1 {
        parts.push(format!("INTERVAL={}", interval));
    }

    if let Some(range) = recurrence.get("range") {
        if let Some(range_type) = range.get("type").and_then(|v| v.as_str()) {
            match range_type {
                "numbered" => {
                    if let Some(count) = range.get("numberOfOccurrences").and_then(|v| v.as_u64()) {
                        parts.push(format!("COUNT={}", count));
                    }
                }
                "endDate" => {
                    if let Some(end_date) = range.get("endDate").and_then(|v| v.as_str()) {
                        let clean_date = end_date.replace('-', "");
                        if clean_date.len() == 8 {
                            parts.push(format!("UNTIL={}T235959Z", clean_date));
                        }
                    }
                }
                _ => {}
            }
        }
    }

    Some(parts.join(";"))
}

/// Convert an RFC 5545 `RRULE` string and start timestamp into a Microsoft Graph `patternedRecurrence` JSON object.
pub fn rrule_to_ms_recurrence(rrule_str: &str, start_ts: i64) -> Option<Value> {
    let clean = normalize_rrule(rrule_str);
    let mut freq = "";
    let mut interval: u64 = 1;
    let mut byday: Vec<String> = Vec::new();
    let mut bymonthday: Option<u64> = None;
    let mut bymonth: Option<u64> = None;
    let mut count: Option<u64> = None;
    let mut until: Option<String> = None;

    for kv in clean.split(';') {
        let mut iter = kv.splitn(2, '=');
        let key = iter.next()?.trim();
        let val = iter.next().unwrap_or("").trim();
        match key {
            "FREQ" => freq = val,
            "INTERVAL" => interval = val.parse().unwrap_or(1),
            "BYDAY" => {
                byday = val
                    .split(',')
                    .map(|s| s.trim().to_string())
                    .filter(|s| !s.is_empty())
                    .collect();
            }
            "BYMONTHDAY" => bymonthday = val.parse().ok(),
            "BYMONTH" => bymonth = val.parse().ok(),
            "COUNT" => count = val.parse().ok(),
            "UNTIL" => until = Some(val.to_string()),
            _ => {}
        }
    }

    let start_dt: DateTime<Utc> = Utc.timestamp_opt(start_ts, 0).single()?;
    let start_date_str = start_dt.format("%Y-%m-%d").to_string();

    let pattern = match freq {
        "DAILY" => json!({
            "type": "daily",
            "interval": interval
        }),
        "WEEKLY" => {
            let days: Vec<&str> = if byday.is_empty() {
                vec![weekday_to_ms(start_dt.weekday())]
            } else {
                byday
                    .iter()
                    .filter_map(|d| rrule_day_to_ms_day(d.as_str()))
                    .collect()
            };
            json!({
                "type": "weekly",
                "interval": interval,
                "daysOfWeek": days,
                "firstDayOfWeek": "sunday"
            })
        }
        "MONTHLY" => {
            if let Some(first_byday) = byday.first() {
                if let Some((index_str, day_name)) = rrule_pos_day_to_ms(first_byday) {
                    json!({
                        "type": "relativeMonthly",
                        "interval": interval,
                        "index": index_str,
                        "daysOfWeek": [day_name]
                    })
                } else {
                    let dom = bymonthday.unwrap_or_else(|| start_dt.day() as u64);
                    json!({
                        "type": "absoluteMonthly",
                        "interval": interval,
                        "dayOfMonth": dom
                    })
                }
            } else {
                let dom = bymonthday.unwrap_or_else(|| start_dt.day() as u64);
                json!({
                    "type": "absoluteMonthly",
                    "interval": interval,
                    "dayOfMonth": dom
                })
            }
        }
        "YEARLY" => {
            let month = bymonth.unwrap_or_else(|| start_dt.month() as u64);
            if let Some(first_byday) = byday.first() {
                if let Some((index_str, day_name)) = rrule_pos_day_to_ms(first_byday) {
                    json!({
                        "type": "relativeYearly",
                        "interval": interval,
                        "month": month,
                        "index": index_str,
                        "daysOfWeek": [day_name]
                    })
                } else {
                    let dom = bymonthday.unwrap_or_else(|| start_dt.day() as u64);
                    json!({
                        "type": "absoluteYearly",
                        "interval": interval,
                        "dayOfMonth": dom,
                        "month": month
                    })
                }
            } else {
                let dom = bymonthday.unwrap_or_else(|| start_dt.day() as u64);
                json!({
                    "type": "absoluteYearly",
                    "interval": interval,
                    "dayOfMonth": dom,
                    "month": month
                })
            }
        }
        _ => return None,
    };

    let range = if let Some(c) = count {
        json!({
            "type": "numbered",
            "startDate": start_date_str,
            "numberOfOccurrences": c
        })
    } else if let Some(u) = until {
        let digits: String = u.chars().take(8).collect();
        let end_date = if digits.len() == 8 {
            format!("{}-{}-{}", &digits[0..4], &digits[4..6], &digits[6..8])
        } else {
            start_date_str.clone()
        };
        json!({
            "type": "endDate",
            "startDate": start_date_str,
            "endDate": end_date
        })
    } else {
        json!({
            "type": "noEnd",
            "startDate": start_date_str
        })
    };

    Some(json!({
        "pattern": pattern,
        "range": range
    }))
}

/// Produce a crisp human-readable description for an RFC 5545 RRULE string.
pub fn describe_rrule_human(rrule_str: &str) -> String {
    let clean = normalize_rrule(rrule_str);
    if clean == "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"
        || clean.starts_with("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;")
    {
        return "Every weekday (Mon–Fri)".to_string();
    }

    let mut freq = "";
    let mut interval: u64 = 1;
    let mut byday: Vec<&str> = Vec::new();

    for kv in clean.split(';') {
        let mut iter = kv.splitn(2, '=');
        let key = iter.next().unwrap_or("").trim();
        let val = iter.next().unwrap_or("").trim();
        match key {
            "FREQ" => freq = val,
            "INTERVAL" => interval = val.parse().unwrap_or(1),
            "BYDAY" => byday = val.split(',').collect(),
            _ => {}
        }
    }

    let day_names: Vec<&str> = byday
        .iter()
        .map(|&d| match d {
            "MO" => "Mon",
            "TU" => "Tue",
            "WE" => "Wed",
            "TH" => "Thu",
            "FR" => "Fri",
            "SA" => "Sat",
            "SU" => "Sun",
            other => other,
        })
        .collect();

    match (freq, interval) {
        ("DAILY", 1) => "Every day".to_string(),
        ("DAILY", n) => format!("Every {} days", n),
        ("WEEKLY", 1) if !day_names.is_empty() => format!("Weekly on {}", day_names.join(", ")),
        ("WEEKLY", 1) => "Every week".to_string(),
        ("WEEKLY", n) if !day_names.is_empty() => {
            format!("Every {} weeks on {}", n, day_names.join(", "))
        }
        ("WEEKLY", n) => format!("Every {} weeks", n),
        ("MONTHLY", 1) => "Every month".to_string(),
        ("MONTHLY", n) => format!("Every {} months", n),
        ("YEARLY", 1) => "Every year".to_string(),
        ("YEARLY", n) => format!("Every {} years", n),
        _ => clean,
    }
}

fn ms_day_to_rrule_day(day: &str) -> Option<&'static str> {
    match day.to_ascii_lowercase().as_str() {
        "monday" => Some("MO"),
        "tuesday" => Some("TU"),
        "wednesday" => Some("WE"),
        "thursday" => Some("TH"),
        "friday" => Some("FR"),
        "saturday" => Some("SA"),
        "sunday" => Some("SU"),
        _ => None,
    }
}

fn rrule_day_to_ms_day(day: &str) -> Option<&'static str> {
    let suffix = if day.len() >= 2 {
        &day[day.len() - 2..]
    } else {
        day
    };
    match suffix {
        "MO" => Some("monday"),
        "TU" => Some("tuesday"),
        "WE" => Some("wednesday"),
        "TH" => Some("thursday"),
        "FR" => Some("friday"),
        "SA" => Some("saturday"),
        "SU" => Some("sunday"),
        _ => None,
    }
}

fn rrule_pos_day_to_ms(token: &str) -> Option<(&'static str, &'static str)> {
    let trimmed = token.trim();
    if trimmed.len() < 2 {
        return None;
    }
    let (prefix, day_part) = trimmed.split_at(trimmed.len() - 2);
    let day_name = rrule_day_to_ms_day(day_part)?;
    let index_str = match prefix {
        "" | "1" | "+1" => "first",
        "2" | "+2" => "second",
        "3" | "+3" => "third",
        "4" | "+4" => "fourth",
        "-1" => "last",
        _ => return None,
    };
    Some((index_str, day_name))
}

fn weekday_to_ms(wd: chrono::Weekday) -> &'static str {
    match wd {
        chrono::Weekday::Mon => "monday",
        chrono::Weekday::Tue => "tuesday",
        chrono::Weekday::Wed => "wednesday",
        chrono::Weekday::Thu => "thursday",
        chrono::Weekday::Fri => "friday",
        chrono::Weekday::Sat => "saturday",
        chrono::Weekday::Sun => "sunday",
    }
}

fn weekday_to_rrule_code(wd: chrono::Weekday) -> &'static str {
    match wd {
        chrono::Weekday::Mon => "MO",
        chrono::Weekday::Tue => "TU",
        chrono::Weekday::Wed => "WE",
        chrono::Weekday::Thu => "TH",
        chrono::Weekday::Fri => "FR",
        chrono::Weekday::Sat => "SA",
        chrono::Weekday::Sun => "SU",
    }
}

fn rrule_code_weekday_order(code: &str) -> Option<u8> {
    match code {
        "MO" => Some(0),
        "TU" => Some(1),
        "WE" => Some(2),
        "TH" => Some(3),
        "FR" => Some(4),
        "SA" => Some(5),
        "SU" => Some(6),
        _ => None,
    }
}

/// When editing `"All in series"` (`edit_scope == "all"`) on a recurring series by moving an occurrence
/// from `old_occ_ts` to `new_occ_ts` on a different day of the week, shift any `BYDAY` token matching
/// the old weekday to the new weekday (preserving any ordinal prefix like `2TU` -> `2WE`, deduplicating,
/// and canonically sorting plain weekday lists).
pub fn shift_rrule_byday_weekday(
    rrule_str: &str,
    old_occ_ts: i64,
    new_occ_ts: i64,
    timezone: &str,
) -> String {
    let clean = normalize_rrule(rrule_str);
    let tz: Tz = chrono_tz::Tz::from_str(timezone)
        .map(Tz::Tz)
        .unwrap_or(Tz::UTC);

    let (old_utc, new_utc) = match (
        Utc.timestamp_opt(old_occ_ts, 0).single(),
        Utc.timestamp_opt(new_occ_ts, 0).single(),
    ) {
        (Some(o), Some(n)) => (o, n),
        _ => return clean,
    };

    let old_wd = weekday_to_rrule_code(old_utc.with_timezone(&tz).weekday());
    let new_wd = weekday_to_rrule_code(new_utc.with_timezone(&tz).weekday());
    if old_wd == new_wd {
        return clean;
    }

    clean
        .split(';')
        .map(|clause| {
            let mut iter = clause.splitn(2, '=');
            let key = iter.next().unwrap_or("").trim();
            let val = match iter.next() {
                Some(v) => v.trim(),
                None => return clause.to_string(),
            };
            if key != "BYDAY" {
                return clause.to_string();
            }

            let mut updated_tokens: Vec<String> = Vec::new();
            for raw_tok in val.split(',') {
                let tok = raw_tok.trim();
                if tok.is_empty() {
                    continue;
                }
                let mapped = if tok.len() >= 2 && tok.ends_with(old_wd) {
                    let prefix = &tok[..tok.len() - 2];
                    format!("{}{}", prefix, new_wd)
                } else {
                    tok.to_string()
                };
                if !updated_tokens.contains(&mapped) {
                    updated_tokens.push(mapped);
                }
            }

            if updated_tokens.len() > 1
                && updated_tokens
                    .iter()
                    .all(|t| rrule_code_weekday_order(t.as_str()).is_some())
            {
                updated_tokens.sort_by_key(|t| rrule_code_weekday_order(t.as_str()).unwrap_or(9));
            }

            if updated_tokens.is_empty() {
                clause.to_string()
            } else {
                format!("BYDAY={}", updated_tokens.join(","))
            }
        })
        .collect::<Vec<_>>()
        .join(";")
}

/// Compute the updated master `start_ts` when editing all occurrences of a recurring series.
/// Preserves all matching weekdays in the master start week when shifting multi-day `BYDAY` rules
/// or moving occurrences to an earlier weekday.
pub fn resolve_series_master_start_ts(
    master_start_ts: i64,
    old_occ_ts: i64,
    new_occ_ts: i64,
    rrule_opt: Option<&str>,
    timezone: &str,
) -> i64 {
    let tz: Tz = chrono_tz::Tz::from_str(timezone)
        .map(Tz::Tz)
        .unwrap_or(Tz::UTC);

    if let (Some(rrule_raw), Some(m_utc), Some(o_utc), Some(n_utc)) = (
        rrule_opt,
        Utc.timestamp_opt(master_start_ts, 0).single(),
        Utc.timestamp_opt(old_occ_ts, 0).single(),
        Utc.timestamp_opt(new_occ_ts, 0).single(),
    ) {
        let clean = normalize_rrule(rrule_raw);
        let mut is_weekly = false;
        let mut plain_bydays: Vec<&str> = Vec::new();

        for clause in clean.split(';') {
            let mut iter = clause.splitn(2, '=');
            let k = iter.next().unwrap_or("").trim();
            let v = iter.next().unwrap_or("").trim();
            if k == "FREQ" && v == "WEEKLY" {
                is_weekly = true;
            } else if k == "BYDAY" {
                let toks: Vec<&str> = v
                    .split(',')
                    .map(str::trim)
                    .filter(|s| !s.is_empty())
                    .collect();
                if !toks.is_empty() && toks.iter().all(|t| rrule_code_weekday_order(t).is_some()) {
                    plain_bydays = toks;
                }
            }
        }

        if is_weekly && !plain_bydays.is_empty() {
            let m_local = m_utc.with_timezone(&tz);
            let o_local = o_utc.with_timezone(&tz);
            let n_local = n_utc.with_timezone(&tz);

            let m_monday = m_local.date_naive()
                - chrono::Duration::days(m_local.weekday().num_days_from_monday() as i64);
            let o_monday = o_local.date_naive()
                - chrono::Duration::days(o_local.weekday().num_days_from_monday() as i64);
            let n_monday = n_local.date_naive()
                - chrono::Duration::days(n_local.weekday().num_days_from_monday() as i64);

            let week_shift_days = (n_monday - o_monday).num_days();
            let target_monday = m_monday + chrono::Duration::days(week_shift_days);

            for day_offset in 0..7 {
                let candidate_date = target_monday + chrono::Duration::days(day_offset);
                let code = weekday_to_rrule_code(candidate_date.weekday());
                if plain_bydays.contains(&code) {
                    let candidate_ndt = candidate_date.and_time(n_local.time());
                    if let Some(resolved_dt) = tz
                        .from_local_datetime(&candidate_ndt)
                        .earliest()
                        .or_else(|| tz.from_local_datetime(&candidate_ndt).latest())
                    {
                        return resolved_dt.timestamp();
                    }
                }
            }
        }
    }

    if old_occ_ts == master_start_ts {
        return new_occ_ts;
    }

    let delta = new_occ_ts - old_occ_ts;
    master_start_ts + delta
}

/// Shift existing `exdates` timestamps when an entire recurring series (`edit_scope == "all"`) is moved
/// from `old_occ_ts` to `new_occ_ts`, so previously deleted or overridden single instances remain excluded.
pub fn shift_series_exdates(
    exdates: &[i64],
    old_occ_ts: i64,
    new_occ_ts: i64,
    rrule_opt: Option<&str>,
    timezone: &str,
) -> Vec<i64> {
    if exdates.is_empty() || old_occ_ts == new_occ_ts {
        return exdates.to_vec();
    }

    let tz: Tz = chrono_tz::Tz::from_str(timezone)
        .map(Tz::Tz)
        .unwrap_or(Tz::UTC);

    let has_byday = rrule_opt
        .map(|r| normalize_rrule(r).contains("BYDAY="))
        .unwrap_or(false);

    if let (Some(o_utc), Some(n_utc)) = (
        Utc.timestamp_opt(old_occ_ts, 0).single(),
        Utc.timestamp_opt(new_occ_ts, 0).single(),
    ) {
        let o_local = o_utc.with_timezone(&tz);
        let n_local = n_utc.with_timezone(&tz);
        let day_delta = (n_local.date_naive() - o_local.date_naive()).num_days();

        let mut out = Vec::with_capacity(exdates.len());
        for &ex_ts in exdates {
            if let Some(ex_utc) = Utc.timestamp_opt(ex_ts, 0).single() {
                let ex_local = ex_utc.with_timezone(&tz);
                let target_date = if !has_byday || ex_local.weekday() == o_local.weekday() {
                    ex_local.date_naive() + chrono::Duration::days(day_delta)
                } else {
                    ex_local.date_naive()
                };
                let target_ndt = target_date.and_time(n_local.time());
                if let Some(shifted_dt) = tz
                    .from_local_datetime(&target_ndt)
                    .earliest()
                    .or_else(|| tz.from_local_datetime(&target_ndt).latest())
                {
                    let ts = shifted_dt.timestamp();
                    if !out.contains(&ts) {
                        out.push(ts);
                    }
                    continue;
                }
            }
            let fallback_ts = ex_ts + (new_occ_ts - old_occ_ts);
            if !out.contains(&fallback_ts) {
                out.push(fallback_ts);
            }
        }
        return out;
    }

    let delta = new_occ_ts - old_occ_ts;
    exdates.iter().map(|&ex| ex + delta).collect()
}

fn ms_index_to_rrule_pos(index: &str) -> Option<&'static str> {
    match index.to_ascii_lowercase().as_str() {
        "first" => Some("1"),
        "second" => Some("2"),
        "third" => Some("3"),
        "fourth" => Some("4"),
        "last" => Some("-1"),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_weekday_rrule_expansion_with_exdate() {
        // Monday 2026-10-05 09:00:00 UTC -> 1791190800
        let start = Utc
            .with_ymd_and_hms(2026, 10, 5, 9, 0, 0)
            .unwrap()
            .timestamp();
        let end = start + 1800; // 30m
        let wed_start = Utc
            .with_ymd_and_hms(2026, 10, 7, 9, 0, 0)
            .unwrap()
            .timestamp();
        let window_start = Utc
            .with_ymd_and_hms(2026, 10, 5, 0, 0, 0)
            .unwrap()
            .timestamp();
        let window_end = Utc
            .with_ymd_and_hms(2026, 10, 11, 23, 59, 59)
            .unwrap()
            .timestamp();

        let instances = expand_event_instances(
            start,
            end,
            "UTC",
            Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR"),
            &[wed_start], // exclude Wednesday
            window_start,
            window_end,
            100,
        );

        // Mon, Tue, Thu, Fri = 4 instances (Wed excluded, Sat/Sun not matching)
        assert_eq!(instances.len(), 4);
        assert!(instances.iter().all(|(s, _)| *s != wed_start));
    }

    #[test]
    fn test_ms_recurrence_roundtrip() {
        let start_ts = Utc
            .with_ymd_and_hms(2026, 10, 5, 14, 0, 0)
            .unwrap()
            .timestamp();
        let original_rrule = "FREQ=WEEKLY;BYDAY=MO,WE,FR;COUNT=12";
        let ms_json = rrule_to_ms_recurrence(original_rrule, start_ts).expect("to ms json");
        let back_rrule = ms_recurrence_to_rrule(&ms_json).expect("back to rrule");
        assert_eq!(back_rrule, original_rrule);

        // Also verify relativeMonthly and relativeYearly round-trips
        let rel_monthly = "FREQ=MONTHLY;BYDAY=2TU;COUNT=6";
        let ms_rel = rrule_to_ms_recurrence(rel_monthly, start_ts).expect("rel monthly json");
        assert_eq!(ms_rel["pattern"]["type"], "relativeMonthly");
        assert_eq!(ms_rel["pattern"]["index"], "second");
        let back_rel = ms_recurrence_to_rrule(&ms_rel).expect("back rel monthly");
        assert_eq!(back_rel, rel_monthly);
    }

    #[test]
    fn test_dst_boundary_rrule_expansion() {
        // 2026 US Spring-Forward DST transition in America/New_York is Sunday 2026-03-08:
        // Saturday 2026-03-07 09:00 EST (-05:00) == 14:00 UTC
        // Monday   2026-03-09 09:00 EDT (-04:00) == 13:00 UTC
        let sat_est_start = Utc
            .with_ymd_and_hms(2026, 3, 7, 14, 0, 0)
            .unwrap()
            .timestamp();
        let sat_est_end = sat_est_start + 3600;
        let win_start = Utc
            .with_ymd_and_hms(2026, 3, 7, 0, 0, 0)
            .unwrap()
            .timestamp();
        let win_end = Utc
            .with_ymd_and_hms(2026, 3, 10, 0, 0, 0)
            .unwrap()
            .timestamp();

        let instances = expand_event_instances(
            sat_est_start,
            sat_est_end,
            "America/New_York",
            Some("FREQ=DAILY;COUNT=3"),
            &[],
            win_start,
            win_end,
            10,
        );

        assert_eq!(instances.len(), 3);
        let mon_edt_expected = Utc
            .with_ymd_and_hms(2026, 3, 9, 13, 0, 0)
            .unwrap()
            .timestamp();
        assert_eq!(instances[0].0, sat_est_start);
        assert_eq!(instances[2].0, mon_edt_expected);
    }

    #[test]
    fn test_shift_rrule_byday_weekday() {
        // Monday 2026-10-05 -> Wednesday 2026-10-07
        let mon_ts = Utc
            .with_ymd_and_hms(2026, 10, 5, 9, 0, 0)
            .unwrap()
            .timestamp();
        let wed_ts = Utc
            .with_ymd_and_hms(2026, 10, 7, 10, 0, 0)
            .unwrap()
            .timestamp();
        let thu_ts = Utc
            .with_ymd_and_hms(2026, 10, 8, 10, 0, 0)
            .unwrap()
            .timestamp();
        let fri_ts = Utc
            .with_ymd_and_hms(2026, 10, 9, 9, 0, 0)
            .unwrap()
            .timestamp();

        assert_eq!(
            shift_rrule_byday_weekday("FREQ=WEEKLY;BYDAY=MO", mon_ts, wed_ts, "UTC"),
            "FREQ=WEEKLY;BYDAY=WE"
        );
        assert_eq!(
            shift_rrule_byday_weekday("FREQ=WEEKLY;BYDAY=MO,TH", mon_ts, wed_ts, "UTC"),
            "FREQ=WEEKLY;BYDAY=WE,TH"
        );
        // Moving Monday to Thursday in MO,WE,FR canonically sorts to WE,TH,FR
        assert_eq!(
            shift_rrule_byday_weekday("FREQ=WEEKLY;BYDAY=MO,WE,FR", mon_ts, thu_ts, "UTC"),
            "FREQ=WEEKLY;BYDAY=WE,TH,FR"
        );
        // When Monday is moved to Thursday in MO,WE,FR, master_start_ts anchors on Wednesday Oct 7 10:00
        // so Wednesday Oct 7 is not lost from Week 1!
        let master_after_mon_to_thu = resolve_series_master_start_ts(
            mon_ts,
            mon_ts,
            thu_ts,
            Some("FREQ=WEEKLY;BYDAY=WE,TH,FR"),
            "UTC",
        );
        assert_eq!(master_after_mon_to_thu, wed_ts);

        // When Friday in WE,FR (starting Wed Oct 7 09:00) is moved earlier in the week to Monday Oct 5 09:00,
        // master_start_ts moves back to Monday Oct 5 09:00 so Monday Oct 5 is included!
        let wed_9am = Utc
            .with_ymd_and_hms(2026, 10, 7, 9, 0, 0)
            .unwrap()
            .timestamp();
        let master_after_fri_to_mon = resolve_series_master_start_ts(
            wed_9am,
            fri_ts,
            mon_ts,
            Some("FREQ=WEEKLY;BYDAY=MO,WE"),
            "UTC",
        );
        assert_eq!(master_after_fri_to_mon, mon_ts);

        assert_eq!(
            shift_rrule_byday_weekday("FREQ=MONTHLY;BYDAY=2MO;COUNT=6", mon_ts, wed_ts, "UTC"),
            "FREQ=MONTHLY;BYDAY=2WE;COUNT=6"
        );

        // Verify exdates shift across weekdays and times
        let mon_wk3 = mon_ts + 14 * 86_400;
        let wed_wk3 = wed_ts + 14 * 86_400;
        let shifted_exdates = shift_series_exdates(
            &[mon_wk3],
            mon_ts + 7 * 86_400,
            wed_ts + 7 * 86_400,
            Some("FREQ=WEEKLY;BYDAY=WE"),
            "UTC",
        );
        assert_eq!(shifted_exdates, vec![wed_wk3]);
    }
}
