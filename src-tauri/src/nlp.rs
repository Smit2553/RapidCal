use crate::models::{Calendar, NlpParseResult};
use crate::rrule_engine::describe_rrule_human;
use chrono::{Datelike, Duration, NaiveDate, TimeZone, Timelike, Utc, Weekday};
use chrono_tz::Tz;
use std::str::FromStr;

/// Detect a video conference link or provider from free text.
pub fn detect_conference_from_text(text: &str) -> Option<(String, String)> {
    for token in text.split_whitespace() {
        let clean =
            token.trim_matches(|c: char| c == '<' || c == '>' || c == '(' || c == ')' || c == ',');
        let lower = clean.to_ascii_lowercase();
        if lower.contains("meet.google.com/") {
            return Some(("meet".to_string(), clean.to_string()));
        }
        if lower.contains("teams.microsoft.com/") || lower.contains("teams.live.com/") {
            return Some(("teams".to_string(), clean.to_string()));
        }
        if lower.contains("zoom.us/j/") || lower.contains("zoom.us/my/") {
            return Some(("zoom".to_string(), clean.to_string()));
        }
        if lower.contains("webex.com/") {
            return Some(("webex".to_string(), clean.to_string()));
        }
    }
    None
}

/// Parse a natural-language quick-add string into a structured `NlpParseResult`.
/// Example: `"Sync with Alex Fri 2pm-3pm every Fri at Zoom @Work"`
pub fn parse_natural_event(
    raw_input: &str,
    reference_ts: i64,
    default_tz: &str,
    calendars: &[Calendar],
) -> NlpParseResult {
    let tz: Tz = Tz::from_str(default_tz.trim()).unwrap_or(chrono_tz::UTC);
    let ref_utc = Utc
        .timestamp_opt(reference_ts, 0)
        .single()
        .unwrap_or_else(Utc::now);
    let ref_dt = ref_utc.with_timezone(&tz);

    let mut target_date: NaiveDate = ref_dt.date_naive();
    let mut start_minutes: i64 = (ref_dt.hour() as i64 + 1).min(23) * 60;
    let mut duration_minutes: i64 = 60;
    let mut has_explicit_time = false;
    let mut has_explicit_date = false;
    let mut is_all_day = false;
    let mut rrule: Option<String> = None;
    let mut location: Option<String> = None;
    let mut conference_url: Option<String> = None;
    let mut conference_provider: Option<String> = None;
    let mut calendar_hint: Option<String> = None;
    let mut matched_calendar_id: Option<String> = calendars
        .iter()
        .find(|c| c.is_primary && c.is_visible)
        .or_else(|| calendars.iter().find(|c| c.is_visible))
        .or_else(|| calendars.first())
        .map(|c| c.id.clone());
    let mut attendees: Vec<String> = Vec::new();

    if let Some((prov, url)) = detect_conference_from_text(raw_input) {
        conference_provider = Some(prov);
        conference_url = Some(url);
    }

    let raw_tokens: Vec<&str> = raw_input.split_whitespace().collect();
    let mut used = vec![false; raw_tokens.len()];

    // 1. Extract @CalendarTag and attendee emails
    for (i, &tok) in raw_tokens.iter().enumerate() {
        if let Some(tag) = tok.strip_prefix('@') {
            if !tag.is_empty() && !tag.contains('.') {
                calendar_hint = Some(tag.to_string());
                used[i] = true;
                let tag_lower = tag.to_ascii_lowercase();
                if let Some(cal) = calendars
                    .iter()
                    .find(|c| {
                        c.name.to_ascii_lowercase().contains(&tag_lower)
                            || c.remote_id.to_ascii_lowercase().contains(&tag_lower)
                    })
                    .or_else(|| {
                        calendars.iter().find(|c| {
                            c.is_primary && c.account_id.to_ascii_lowercase().contains(&tag_lower)
                        })
                    })
                    .or_else(|| {
                        calendars
                            .iter()
                            .find(|c| c.account_id.to_ascii_lowercase().contains(&tag_lower))
                    })
                {
                    matched_calendar_id = Some(cal.id.clone());
                }
            }
        } else if tok.contains('@') && tok.contains('.') && !tok.starts_with("http") {
            let clean_email = tok
                .trim_matches(|c: char| c == ',' || c == ';' || c == '<' || c == '>')
                .to_string();
            attendees.push(clean_email);
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("with") {
                used[i - 1] = true;
            }
        }
    }

    // 2. Extract recurrence phrases ("every weekday", "every day", "daily", "weekly", "monthly", "every Fri")
    for i in 0..raw_tokens.len() {
        if used[i] {
            continue;
        }
        let lower = raw_tokens[i].to_ascii_lowercase();
        if lower == "daily" {
            rrule = Some("FREQ=DAILY".to_string());
            used[i] = true;
        } else if lower == "weekly" {
            rrule = Some("FREQ=WEEKLY".to_string());
            used[i] = true;
        } else if lower == "weekdays" {
            rrule = Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".to_string());
            used[i] = true;
        } else if lower == "monthly" {
            rrule = Some("FREQ=MONTHLY".to_string());
            used[i] = true;
        } else if lower == "every" && i + 1 < raw_tokens.len() {
            let next_lower = raw_tokens[i + 1].trim_matches(',').to_ascii_lowercase();
            match next_lower.as_str() {
                "day" => {
                    rrule = Some("FREQ=DAILY".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                "weekday" | "weekdays" => {
                    rrule = Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                "week" => {
                    rrule = Some("FREQ=WEEKLY".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                "month" => {
                    rrule = Some("FREQ=MONTHLY".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                _ => {
                    // Check if `next_lower` is one or more comma-separated weekdays e.g. "Tue,Thu" or "Fri"
                    let mut bydays = Vec::new();
                    for part in next_lower.split(',') {
                        if let Some((wd, code)) = parse_weekday_token(part) {
                            bydays.push(code);
                            if !has_explicit_date {
                                target_date = next_or_same_weekday(ref_dt.date_naive(), wd, false);
                                has_explicit_date = true;
                            }
                        }
                    }
                    if !bydays.is_empty() {
                        rrule = Some(format!("FREQ=WEEKLY;BYDAY={}", bydays.join(",")));
                        used[i] = true;
                        used[i + 1] = true;
                    }
                }
            }
        }
    }

    // 3. Extract "all day" keyword
    for i in 0..raw_tokens.len().saturating_sub(1) {
        if !used[i]
            && !used[i + 1]
            && raw_tokens[i].eq_ignore_ascii_case("all")
            && raw_tokens[i + 1].eq_ignore_ascii_case("day")
        {
            is_all_day = true;
            used[i] = true;
            used[i + 1] = true;
        }
    }

    // 4. Extract time ranges & single times
    for i in 0..raw_tokens.len() {
        if used[i] {
            continue;
        }
        let tok = raw_tokens[i];

        // Check combined range token like "2pm-3pm", "11-1pm", or "14:00-15:30"
        if let Some((s_min, e_min)) = parse_compact_time_range(tok) {
            start_minutes = s_min;
            duration_minutes = (e_min - s_min).max(15);
            has_explicit_time = true;
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("at") {
                used[i - 1] = true;
            }
            continue;
        }

        // Check 3-token range like "2pm - 3:30pm", "2 - 3:30pm", or "11 to 1pm"
        if i + 2 < raw_tokens.len()
            && (raw_tokens[i + 1] == "-" || raw_tokens[i + 1].eq_ignore_ascii_case("to"))
        {
            if let Some((s_min, e_min)) = resolve_time_range(tok, raw_tokens[i + 2]) {
                start_minutes = s_min;
                duration_minutes = (e_min - s_min).max(15);
                has_explicit_time = true;
                used[i] = true;
                used[i + 1] = true;
                used[i + 2] = true;
                if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("at") {
                    used[i - 1] = true;
                }
                continue;
            }
        }

        // Check single time token like "2pm" or "14:30"
        if let Some(s_min) = parse_single_time(tok, None) {
            // Only treat bare numbers as time if preceded by "at" or has am/pm/colon
            let has_suffix_or_colon = tok.contains(':')
                || tok.to_ascii_lowercase().ends_with("am")
                || tok.to_ascii_lowercase().ends_with("pm");
            let preceded_by_at = i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("at");
            if has_suffix_or_colon || preceded_by_at {
                start_minutes = s_min;
                has_explicit_time = true;
                used[i] = true;
                if preceded_by_at {
                    used[i - 1] = true;
                }
            }
        }
    }

    // 5. Extract duration ("for 30m", "for 45 mins", "for 2h")
    for i in 0..raw_tokens.len().saturating_sub(1) {
        if !used[i] && raw_tokens[i].eq_ignore_ascii_case("for") && !used[i + 1] {
            if let Some(mins) = parse_duration_token(raw_tokens[i + 1]) {
                duration_minutes = mins;
                used[i] = true;
                used[i + 1] = true;
            }
        }
    }

    // 6. Extract date tokens ("today", "tomorrow", "tmrw", "next Mon", "Fri", "2026-10-15")
    for i in 0..raw_tokens.len() {
        if used[i] {
            continue;
        }
        let lower = raw_tokens[i]
            .trim_matches(|c: char| c == ',' || c == '.')
            .to_ascii_lowercase();

        if lower == "today" || lower == "tod" {
            target_date = ref_dt.date_naive();
            has_explicit_date = true;
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("on") {
                used[i - 1] = true;
            }
            continue;
        }

        if lower == "tomorrow" || lower == "tmrw" || lower == "tmw" {
            target_date = ref_dt.date_naive() + Duration::days(1);
            has_explicit_date = true;
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("on") {
                used[i - 1] = true;
            }
            continue;
        }

        if lower == "next" && i + 1 < raw_tokens.len() && !used[i + 1] {
            let next_clean = raw_tokens[i + 1]
                .trim_matches(|c: char| c == ',' || c == '.')
                .to_ascii_lowercase();
            if let Some((wd, _)) = parse_weekday_token(&next_clean) {
                target_date = next_or_same_weekday(ref_dt.date_naive(), wd, true);
                has_explicit_date = true;
                used[i] = true;
                used[i + 1] = true;
                continue;
            }
        }

        if let Some((wd, _)) = parse_weekday_token(&lower) {
            target_date = next_or_same_weekday(ref_dt.date_naive(), wd, false);
            has_explicit_date = true;
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("on") {
                used[i - 1] = true;
            }
            continue;
        }

        if let Ok(iso_date) = NaiveDate::parse_from_str(&lower, "%Y-%m-%d") {
            target_date = iso_date;
            has_explicit_date = true;
            used[i] = true;
            if i > 0 && raw_tokens[i - 1].eq_ignore_ascii_case("on") {
                used[i - 1] = true;
            }
            continue;
        }
    }

    // 7. Extract conference keyword or location ("at Zoom", "at Meet", "at Teams", "at Room 4B")
    for i in 0..raw_tokens.len().saturating_sub(1) {
        if used[i] {
            continue;
        }
        if raw_tokens[i].eq_ignore_ascii_case("at")
            || raw_tokens[i].eq_ignore_ascii_case("in")
            || raw_tokens[i].eq_ignore_ascii_case("on")
        {
            if used[i + 1] {
                continue;
            }
            let target = raw_tokens[i + 1].trim_matches(',');
            let target_lower = target.to_ascii_lowercase();
            match target_lower.as_str() {
                "zoom" => {
                    conference_provider = Some("zoom".to_string());
                    conference_url
                        .get_or_insert_with(|| "https://zoom.us/j/rapidcal-instant".to_string());
                    location = Some("Zoom Video".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                "meet" | "gmeet" => {
                    conference_provider = Some("meet".to_string());
                    conference_url
                        .get_or_insert_with(|| "https://meet.google.com/rcd-fast-sync".to_string());
                    location = Some("Google Meet".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                "teams" => {
                    conference_provider = Some("teams".to_string());
                    conference_url.get_or_insert_with(|| {
                        "https://teams.microsoft.com/l/meetup-join/rapidcal".to_string()
                    });
                    location = Some("Microsoft Teams".to_string());
                    used[i] = true;
                    used[i + 1] = true;
                }
                _ if raw_tokens[i].eq_ignore_ascii_case("at")
                    || raw_tokens[i].eq_ignore_ascii_case("in") =>
                {
                    // Collect up to 3 unused location words
                    let mut loc_words = Vec::new();
                    let mut j = i + 1;
                    while j < raw_tokens.len() && !used[j] && loc_words.len() < 3 {
                        loc_words.push(raw_tokens[j]);
                        used[j] = true;
                        j += 1;
                    }
                    if !loc_words.is_empty() {
                        used[i] = true;
                        location = Some(loc_words.join(" "));
                    }
                }
                _ => {}
            }
        }
    }

    // 8. Assemble title from remaining unused tokens
    let title_words: Vec<&str> = raw_tokens
        .iter()
        .enumerate()
        .filter_map(|(i, &w)| if !used[i] { Some(w) } else { None })
        .collect();

    let raw_title = title_words.join(" ").trim().to_string();
    let title = if raw_title.is_empty() {
        "New Event".to_string()
    } else {
        raw_title
    };

    let utc_midnight_ts = target_date
        .and_hms_opt(0, 0, 0)
        .map(|ndt| Utc.from_utc_datetime(&ndt).timestamp())
        .unwrap_or(reference_ts);

    let (start_ts, end_ts) = if is_all_day {
        (utc_midnight_ts, utc_midnight_ts + 86_400)
    } else {
        let local_day_start_ts = target_date
            .and_hms_opt(0, 0, 0)
            .and_then(|ndt| {
                tz.from_local_datetime(&ndt)
                    .earliest()
                    .or_else(|| tz.from_local_datetime(&ndt).latest())
            })
            .map(|dt| dt.timestamp())
            .unwrap_or(utc_midnight_ts);

        let clamped_start = start_minutes.clamp(0, 24 * 60 - 15);
        let h = (clamped_start / 60) as u32;
        let m = (clamped_start % 60) as u32;
        let s = target_date
            .and_hms_opt(h, m, 0)
            .and_then(|ndt| {
                tz.from_local_datetime(&ndt)
                    .earliest()
                    .or_else(|| tz.from_local_datetime(&ndt).latest())
            })
            .map(|dt| dt.timestamp())
            .unwrap_or(local_day_start_ts + clamped_start * 60);
        let e = s + duration_minutes * 60;
        (s, e)
    };

    let rrule_human = rrule.as_deref().map(describe_rrule_human);

    let mut confidence: f32 = 0.4;
    if has_explicit_time {
        confidence += 0.3;
    }
    if has_explicit_date {
        confidence += 0.2;
    }
    if calendar_hint.is_some() || rrule.is_some() || location.is_some() {
        confidence += 0.1;
    }

    NlpParseResult {
        raw_input: raw_input.to_string(),
        title,
        start_ts,
        end_ts,
        is_all_day,
        rrule,
        rrule_human,
        location,
        conference_url,
        conference_provider,
        calendar_hint,
        matched_calendar_id,
        attendees,
        confidence: confidence.min(1.0),
    }
}

fn parse_compact_time_range(token: &str) -> Option<(i64, i64)> {
    let parts: Vec<&str> = token.split('-').collect();
    if parts.len() != 2 {
        return None;
    }
    resolve_time_range(parts[0], parts[1])
}

fn has_explicit_meridiem(token: &str) -> bool {
    let lower = token
        .trim_matches(|c: char| c == ',' || c == '.')
        .to_ascii_lowercase();
    lower.ends_with("am") || lower.ends_with("pm") || lower.ends_with('a') || lower.ends_with('p')
}

fn resolve_time_range(start_tok: &str, end_tok: &str) -> Option<(i64, i64)> {
    let start_has_mer = has_explicit_meridiem(start_tok);
    let end_has_mer = has_explicit_meridiem(end_tok);

    if start_has_mer && end_has_mer {
        let s = parse_single_time(start_tok, None)?;
        let e = parse_single_time(end_tok, None)?;
        let adjusted_end = if e <= s { e + 12 * 60 } else { e };
        return Some((s, adjusted_end));
    }

    if !start_has_mer && end_has_mer {
        let e = parse_single_time(end_tok, None)?;
        let s_same_mer = parse_single_time(start_tok, Some(end_tok))?;
        let s_raw_am = parse_single_time(start_tok, Some("am"))?;
        // Handle noon-crossing ranges like "11-1pm" or "9:30-12:30pm" where start is morning (9am..11:59am)
        // and end is afternoon (12:00pm..5:59pm)
        if s_same_mer >= e
            && (9 * 60..12 * 60).contains(&s_raw_am)
            && (12 * 60..18 * 60).contains(&e)
        {
            return Some((s_raw_am, e));
        }
        let adjusted_end = if e <= s_same_mer { e + 12 * 60 } else { e };
        return Some((s_same_mer, adjusted_end));
    }

    // Start has meridiem (or 24h colon format) and end inherits from start
    let s = parse_single_time(start_tok, None)?;
    let e = parse_single_time(end_tok, Some(start_tok))?;
    if !start_has_mer && !end_has_mer && !start_tok.contains(':') && !end_tok.contains(':') {
        return None;
    }
    let adjusted_end = if e <= s { e + 12 * 60 } else { e };
    Some((s, adjusted_end))
}

fn parse_single_time(token: &str, meridiem_fallback_from: Option<&str>) -> Option<i64> {
    let lower = token
        .trim_matches(|c: char| c == ',' || c == '.')
        .to_ascii_lowercase();
    if lower.is_empty() {
        return None;
    }

    let (num_part, meridiem) = if let Some(stripped) = lower.strip_suffix("am") {
        (stripped, Some("am"))
    } else if let Some(stripped) = lower.strip_suffix("pm") {
        (stripped, Some("pm"))
    } else if let Some(stripped) = lower.strip_suffix('a') {
        (stripped, Some("am"))
    } else if let Some(stripped) = lower.strip_suffix('p') {
        (stripped, Some("pm"))
    } else {
        let fallback_meridiem = meridiem_fallback_from.and_then(|fb| {
            let fbl = fb.to_ascii_lowercase();
            if fbl.ends_with("pm") || fbl.ends_with('p') {
                Some("pm")
            } else if fbl.ends_with("am") || fbl.ends_with('a') {
                Some("am")
            } else {
                None
            }
        });
        (lower.as_str(), fallback_meridiem)
    };

    let (mut hour, minute): (i64, i64) = if let Some((h_str, m_str)) = num_part.split_once(':') {
        (h_str.parse().ok()?, m_str.parse().ok()?)
    } else {
        (num_part.parse().ok()?, 0)
    };

    if !(0..=23).contains(&hour) || !(0..=59).contains(&minute) {
        return None;
    }

    if let Some(m) = meridiem {
        if hour > 12 {
            return None;
        }
        if m == "pm" && hour < 12 {
            hour += 12;
        } else if m == "am" && hour == 12 {
            hour = 0;
        }
    }

    Some(hour * 60 + minute)
}

fn parse_duration_token(token: &str) -> Option<i64> {
    let lower = token.to_ascii_lowercase();
    if let Some(m_str) = lower
        .strip_suffix("min")
        .or_else(|| lower.strip_suffix("mins"))
        .or_else(|| lower.strip_suffix('m'))
    {
        let mins: i64 = m_str.parse().ok()?;
        return Some(mins.clamp(5, 1440));
    }
    if let Some(h_str) = lower
        .strip_suffix("hr")
        .or_else(|| lower.strip_suffix("hrs"))
        .or_else(|| lower.strip_suffix('h'))
    {
        let hours: f64 = h_str.parse().ok()?;
        return Some(((hours * 60.0) as i64).clamp(15, 1440));
    }
    None
}

fn parse_weekday_token(token: &str) -> Option<(Weekday, &'static str)> {
    match token.to_ascii_lowercase().as_str() {
        "mon" | "monday" => Some((Weekday::Mon, "MO")),
        "tue" | "tues" | "tuesday" => Some((Weekday::Tue, "TU")),
        "wed" | "wednesday" => Some((Weekday::Wed, "WE")),
        "thu" | "thur" | "thurs" | "thursday" => Some((Weekday::Thu, "TH")),
        "fri" | "friday" => Some((Weekday::Fri, "FR")),
        "sat" | "saturday" => Some((Weekday::Sat, "SA")),
        "sun" | "sunday" => Some((Weekday::Sun, "SU")),
        _ => None,
    }
}

fn next_or_same_weekday(from: NaiveDate, target: Weekday, force_next_week: bool) -> NaiveDate {
    let from_num = from.weekday().num_days_from_monday() as i64;
    let target_num = target.num_days_from_monday() as i64;
    let mut delta = (target_num - from_num).rem_euclid(7);
    if delta == 0 && force_next_week {
        delta = 7;
    }
    from + Duration::days(delta)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_natural_language_quick_add() {
        let calendars = vec![
            Calendar {
                id: "cal-work".to_string(),
                account_id: "acc-google-work".to_string(),
                remote_id: "alex@acme.dev".to_string(),
                name: "Acme Engineering".to_string(),
                color_hex: "#6366f1".to_string(),
                is_visible: true,
                is_primary: true,
                access_role: "owner".to_string(),
                sync_token: None,
                timezone: "UTC".to_string(),
            },
            Calendar {
                id: "cal-outlook".to_string(),
                account_id: "acc-ms-outlook".to_string(),
                remote_id: "AAMkADk2".to_string(),
                name: "Contoso Enterprise".to_string(),
                color_hex: "#0ea5e9".to_string(),
                is_visible: true,
                is_primary: true,
                access_role: "owner".to_string(),
                sync_token: None,
                timezone: "UTC".to_string(),
            },
        ];

        // Reference: Monday 2026-10-05 08:00:00 UTC
        let ref_ts = Utc
            .with_ymd_and_hms(2026, 10, 5, 8, 0, 0)
            .unwrap()
            .timestamp();

        let parsed = parse_natural_event(
            "Sync with Alex Fri 2pm-3:30pm every Fri at Zoom @Work",
            ref_ts,
            "UTC",
            &calendars,
        );

        assert_eq!(parsed.title, "Sync with Alex");
        assert_eq!(parsed.matched_calendar_id.as_deref(), Some("cal-work"));
        assert_eq!(parsed.rrule.as_deref(), Some("FREQ=WEEKLY;BYDAY=FR"));
        assert_eq!(parsed.conference_provider.as_deref(), Some("zoom"));
        // Friday 2026-10-09 14:00 UTC
        let expected_start = Utc
            .with_ymd_and_hms(2026, 10, 9, 14, 0, 0)
            .unwrap()
            .timestamp();
        let expected_end = Utc
            .with_ymd_and_hms(2026, 10, 9, 15, 30, 0)
            .unwrap()
            .timestamp();
        assert_eq!(parsed.start_ts, expected_start);
        assert_eq!(parsed.end_ts, expected_end);

        // Test AM-to-PM noon crossover ("11-1pm") and @Outlook account_id matching
        let lunch = parse_natural_event(
            "Architecture Lunch 11-1pm tomorrow @Outlook",
            ref_ts,
            "UTC",
            &calendars,
        );
        assert_eq!(lunch.title, "Architecture Lunch");
        assert_eq!(lunch.matched_calendar_id.as_deref(), Some("cal-outlook"));
        let expected_lunch_start = Utc
            .with_ymd_and_hms(2026, 10, 6, 11, 0, 0)
            .unwrap()
            .timestamp();
        let expected_lunch_end = Utc
            .with_ymd_and_hms(2026, 10, 6, 13, 0, 0)
            .unwrap()
            .timestamp();
        assert_eq!(lunch.start_ts, expected_lunch_start);
        assert_eq!(lunch.end_ts, expected_lunch_end);

        // Test 3-token range without start meridiem ("2 - 3:30pm") and America/New_York timezone (-04:00 EDT in Oct)
        let ny_event = parse_natural_event(
            "Design Review 2 - 3:30pm today",
            ref_ts,
            "America/New_York",
            &calendars,
        );
        assert_eq!(ny_event.title, "Design Review");
        // 14:00 EDT on 2026-10-05 is 18:00 UTC
        let expected_ny_start = Utc
            .with_ymd_and_hms(2026, 10, 5, 18, 0, 0)
            .unwrap()
            .timestamp();
        let expected_ny_end = Utc
            .with_ymd_and_hms(2026, 10, 5, 19, 30, 0)
            .unwrap()
            .timestamp();
        assert_eq!(ny_event.start_ts, expected_ny_start);
        assert_eq!(ny_event.end_ts, expected_ny_end);
    }
}
