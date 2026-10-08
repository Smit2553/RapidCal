use crate::db::Database;
use crate::models::{Account, Attendee, Calendar, UpsertEventInput};
use chrono::{Datelike, Duration, TimeZone, Utc};

pub fn seed_multi_account_demo(db: &Database) -> Result<(), String> {
    let now = Utc::now();
    let now_iso = now.to_rfc3339();

    // 1. Seed 3 Accounts: Work (Google), Client/Enterprise (Outlook), and Personal (Google)
    let accounts = vec![
        Account {
            id: "acc-google-work".to_string(),
            provider: "google".to_string(),
            email: "alex@acme.com".to_string(),
            display_name: "Alex Morgan (Work)".to_string(),
            avatar_url: None,
            status: "demo".to_string(),
            last_synced_at: Some(now_iso.clone()),
            created_at: now_iso.clone(),
        },
        Account {
            id: "acc-ms-outlook".to_string(),
            provider: "microsoft".to_string(),
            email: "alex.morgan@contoso.com".to_string(),
            display_name: "Alex Morgan (Contoso)".to_string(),
            avatar_url: None,
            status: "demo".to_string(),
            last_synced_at: Some(now_iso.clone()),
            created_at: now_iso.clone(),
        },
        Account {
            id: "acc-google-personal".to_string(),
            provider: "google".to_string(),
            email: "alex.personal@gmail.com".to_string(),
            display_name: "Alex Personal".to_string(),
            avatar_url: None,
            status: "demo".to_string(),
            last_synced_at: Some(now_iso.clone()),
            created_at: now_iso.clone(),
        },
    ];

    for acc in &accounts {
        db.upsert_account(acc)?;
    }

    // 2. Seed 5 Calendars with distinct accent colors
    let calendars = vec![
        Calendar {
            id: "cal-acme-eng".to_string(),
            account_id: "acc-google-work".to_string(),
            remote_id: "alex@acme.com".to_string(),
            name: "Work Schedule".to_string(),
            color_hex: "#6366f1".to_string(), // Indigo
            is_visible: true,
            is_primary: true,
            access_role: "owner".to_string(),
            sync_token: Some("gcal-sync-token-v3-demo".to_string()),
            timezone: "UTC".to_string(),
        },
        Calendar {
            id: "cal-acme-launches".to_string(),
            account_id: "acc-google-work".to_string(),
            remote_id: "launches@acme.com".to_string(),
            name: "Product & Launches".to_string(),
            color_hex: "#ec4899".to_string(), // Pink
            is_visible: true,
            is_primary: false,
            access_role: "writer".to_string(),
            sync_token: Some("gcal-sync-token-v3-launches".to_string()),
            timezone: "UTC".to_string(),
        },
        Calendar {
            id: "cal-contoso-ent".to_string(),
            account_id: "acc-ms-outlook".to_string(),
            remote_id: "AAMkADk2-outlook-primary".to_string(),
            name: "Contoso Team".to_string(),
            color_hex: "#0ea5e9".to_string(), // Sky Blue
            is_visible: true,
            is_primary: true,
            access_role: "owner".to_string(),
            sync_token: Some("ms-graph-deltalink-v1-demo".to_string()),
            timezone: "UTC".to_string(),
        },
        Calendar {
            id: "cal-contoso-exec".to_string(),
            account_id: "acc-ms-outlook".to_string(),
            remote_id: "AAMkADk2-outlook-exec".to_string(),
            name: "Leadership & Planning".to_string(),
            color_hex: "#f59e0b".to_string(), // Amber
            is_visible: true,
            is_primary: false,
            access_role: "writer".to_string(),
            sync_token: Some("ms-graph-deltalink-v1-exec".to_string()),
            timezone: "UTC".to_string(),
        },
        Calendar {
            id: "cal-personal".to_string(),
            account_id: "acc-google-personal".to_string(),
            remote_id: "alex.personal@gmail.com".to_string(),
            name: "Personal & Wellness".to_string(),
            color_hex: "#10b981".to_string(), // Emerald
            is_visible: true,
            is_primary: true,
            access_role: "owner".to_string(),
            sync_token: Some("gcal-sync-token-v3-personal".to_string()),
            timezone: "UTC".to_string(),
        },
    ];

    for cal in &calendars {
        db.upsert_calendar(cal)?;
    }

    // Anchor events around the Monday of the current week so any day/week view is rich with events
    let today_midnight = Utc
        .with_ymd_and_hms(now.year(), now.month(), now.day(), 0, 0, 0)
        .single()
        .unwrap_or(now);
    let days_since_monday = today_midnight.weekday().num_days_from_monday() as i64;
    let monday = today_midnight - Duration::days(days_since_monday);

    let ts = |day_offset: i64, hour: i64, min: i64| -> i64 {
        (monday + Duration::days(day_offset) + Duration::hours(hour) + Duration::minutes(min))
            .timestamp()
    };

    // Helper for sample attendees
    let team_attendees = vec![
        Attendee {
            email: "alex@acme.com".to_string(),
            display_name: Some("Alex Morgan".to_string()),
            response_status: "accepted".to_string(),
            is_organizer: true,
            is_self: true,
        },
        Attendee {
            email: "sarah.chen@acme.com".to_string(),
            display_name: Some("Sarah Chen".to_string()),
            response_status: "accepted".to_string(),
            is_organizer: false,
            is_self: false,
        },
        Attendee {
            email: "marcus.vance@acme.com".to_string(),
            display_name: Some("Marcus Vance".to_string()),
            response_status: "tentative".to_string(),
            is_organizer: false,
            is_self: false,
        },
    ];

    let outlook_attendees = vec![
        Attendee {
            email: "elena.rostova@contoso.com".to_string(),
            display_name: Some("Elena Rostova".to_string()),
            response_status: "accepted".to_string(),
            is_organizer: true,
            is_self: false,
        },
        Attendee {
            email: "alex.morgan@contoso.com".to_string(),
            display_name: Some("Alex Morgan".to_string()),
            response_status: "accepted".to_string(),
            is_organizer: false,
            is_self: true,
        },
    ];

    let tentative_attendees = vec![
        Attendee {
            email: "priya.patel@contoso.com".to_string(),
            display_name: Some("Priya Patel".to_string()),
            response_status: "accepted".to_string(),
            is_organizer: true,
            is_self: false,
        },
        Attendee {
            email: "alex.morgan@contoso.com".to_string(),
            display_name: Some("Alex Morgan".to_string()),
            response_status: "tentative".to_string(),
            is_organizer: false,
            is_self: true,
        },
    ];

    // 3. Seed Recurring & Single Events
    let events_to_seed = vec![
        // Recurring Daily Weekday Check-In on Google Workspace (Mon-Fri 09:30 - 10:00)
        UpsertEventInput {
            id: Some("evt-standup-series".to_string()),
            calendar_id: "cal-acme-eng".to_string(),
            title: "Daily Team Check-In".to_string(),
            description: Some(
                "Quick morning check-in to coordinate priorities for the day.\nAgenda:\n• Highlights from yesterday\n• Today's focus\n• Open questions"
                    .to_string(),
            ),
            location: Some("Google Meet".to_string()),
            start_ts: ts(-14, 9, 30),
            end_ts: ts(-14, 10, 0),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: Some("FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR".to_string()),
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(team_attendees.clone()),
            conference_url: Some("https://meet.google.com/rcd-core-sync".to_string()),
            conference_provider: Some("meet".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        // All-day multi-day event (Tue-Wed): Product Launch Week
        UpsertEventInput {
            id: Some("evt-release-freeze".to_string()),
            calendar_id: "cal-acme-launches".to_string(),
            title: "🚀 Fall Product Launch".to_string(),
            description: Some("Final preparation, announcements, and customer onboarding.".to_string()),
            location: Some("Global / Remote".to_string()),
            start_ts: ts(1, 0, 0),
            end_ts: ts(3, 0, 0),
            is_all_day: true,
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
        // Monday 11:00 - 12:15: Product Strategy & Roadmap Review
        UpsertEventInput {
            id: Some("evt-rust-arch".to_string()),
            calendar_id: "cal-acme-eng".to_string(),
            title: "Product Strategy & Roadmap Review".to_string(),
            description: Some("Reviewing upcoming quarterly milestones, customer feedback, and team goals.".to_string()),
            location: Some("Google Meet • Room 4B".to_string()),
            start_ts: ts(0, 11, 0),
            end_ts: ts(0, 12, 15),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: None,
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(team_attendees.clone()),
            conference_url: Some("https://meet.google.com/wal-fts-perf".to_string()),
            conference_provider: Some("meet".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        // Monday 11:30 - 12:30: Overlapping Microsoft Outlook Client Sync
        UpsertEventInput {
            id: Some("evt-contoso-arch".to_string()),
            calendar_id: "cal-contoso-ent".to_string(),
            title: "Client Partnership Sync — Contoso".to_string(),
            description: Some("Aligning on project deliverables, timeline, and next steps with the Contoso team.".to_string()),
            location: Some("Microsoft Teams".to_string()),
            start_ts: ts(0, 11, 30),
            end_ts: ts(0, 12, 30),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: None,
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(outlook_attendees.clone()),
            conference_url: Some("https://teams.microsoft.com/l/meetup-join/contoso-delta-sync".to_string()),
            conference_provider: Some("teams".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        // Tuesday 14:00 - 15:00: Tentative Leadership Planning
        UpsertEventInput {
            id: Some("evt-tentative-roadmap".to_string()),
            calendar_id: "cal-contoso-exec".to_string(),
            title: "Quarterly Budget & Operations Planning".to_string(),
            description: Some("Reviewing department goals, resource allocation, and upcoming hiring plans.".to_string()),
            location: Some("Microsoft Teams".to_string()),
            start_ts: ts(1, 14, 0),
            end_ts: ts(1, 15, 0),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: Some("FREQ=WEEKLY;BYDAY=TU,TH".to_string()),
            status: Some("tentative".to_string()),
            self_rsvp: Some("tentative".to_string()),
            attendees: Some(tentative_attendees.clone()),
            conference_url: Some("https://teams.microsoft.com/l/meetup-join/exec-sec-audit".to_string()),
            conference_provider: Some("teams".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        // Wednesday 13:00 - 14:30: Design Studio Review
        UpsertEventInput {
            id: Some("evt-design-crit".to_string()),
            calendar_id: "cal-acme-launches".to_string(),
            title: "Brand & Design Studio Review".to_string(),
            description: Some("Walkthrough of the updated visual identity, presentation deck, and launch campaign assets.".to_string()),
            location: Some("Zoom Video".to_string()),
            start_ts: ts(2, 13, 0),
            end_ts: ts(2, 14, 30),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: None,
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(team_attendees.clone()),
            conference_url: Some("https://zoom.us/j/9823419283".to_string()),
            conference_provider: Some("zoom".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        // Wednesday 16:00 - 17:00: Personal Dentist Appointment
        UpsertEventInput {
            id: Some("evt-personal-dentist".to_string()),
            calendar_id: "cal-personal".to_string(),
            title: "Dr. Nguyen — Dental Checkup".to_string(),
            description: Some("Routine checkup — time also marked as Busy on the Contoso work calendar.".to_string()),
            location: Some("450 Sutter St, Suite 1200".to_string()),
            start_ts: ts(2, 16, 0),
            end_ts: ts(2, 17, 0),
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
        // Friday 15:00 - 16:00: Weekly Team Show & Tell
        UpsertEventInput {
            id: Some("evt-friday-demos".to_string()),
            calendar_id: "cal-acme-eng".to_string(),
            title: "Friday Team Show & Tell".to_string(),
            description: Some("End-of-week highlights, project demos, and team shoutouts.".to_string()),
            location: Some("Google Meet".to_string()),
            start_ts: ts(-7, 15, 0),
            end_ts: ts(-7, 16, 0),
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: Some("FREQ=WEEKLY;BYDAY=FR".to_string()),
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(team_attendees.clone()),
            conference_url: Some("https://meet.google.com/fri-show-tell".to_string()),
            conference_provider: Some("meet".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
    ];

    for ev_input in events_to_seed {
        db.upsert_event(ev_input, false)?;
    }

    // Create an automatic Busy Block of the personal dentist appointment onto Contoso Outlook
    let _ = db.create_busy_mirror("evt-personal-dentist", "cal-contoso-ent", false);

    // Seed an upcoming event starting ~15 minutes from right now
    let rounded_now = (now.timestamp() / 300) * 300;
    let up_next_start = rounded_now + 15 * 60;
    let up_next_end = up_next_start + 45 * 60;
    let _ = db.upsert_event(
        UpsertEventInput {
            id: Some("evt-live-up-next".to_string()),
            calendar_id: "cal-acme-eng".to_string(),
            title: "Weekly Design & Product Sync".to_string(),
            description: Some(
                "Catching up on weekly progress and upcoming milestones.".to_string(),
            ),
            location: Some("Google Meet".to_string()),
            start_ts: up_next_start,
            end_ts: up_next_end,
            is_all_day: false,
            timezone: Some("UTC".to_string()),
            rrule: None,
            status: Some("confirmed".to_string()),
            self_rsvp: Some("accepted".to_string()),
            attendees: Some(team_attendees),
            conference_url: Some("https://meet.google.com/rapidcal-live-demo".to_string()),
            conference_provider: Some("meet".to_string()),
            edit_scope: None,
            instance_start_ts: None,
        },
        false,
    );

    // Clear initial seed outbox mutations so initial state starts clean
    if let Ok(mutations) = db.list_outbox_mutations() {
        for m in mutations {
            let _ = db.mark_outbox_completed(m.id, &m.event_id);
        }
    }

    Ok(())
}
