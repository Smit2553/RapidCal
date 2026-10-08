use crate::models::ViewportEvent;

const MIN_VISUAL_DURATION_SECS: i64 = 900; // 15 minutes minimum height for overlap detection

/// Compute connected overlap clusters and column packing (`col_index`, `total_cols`, `cluster_id`)
/// in O(N log N) time for a list of viewport events.
pub fn compute_viewport_layout(events: &mut [ViewportEvent]) {
    if events.is_empty() {
        return;
    }

    // Sort chronologically by start_ts ASC, longer events first, then deterministic instance_id
    events.sort_by(|a, b| {
        a.start_ts
            .cmp(&b.start_ts)
            .then_with(|| (b.end_ts - b.start_ts).cmp(&(a.end_ts - a.start_ts)))
            .then_with(|| a.instance_id.cmp(&b.instance_id))
    });

    // Separate indices of timed events vs all-day events
    let mut timed_indices: Vec<usize> = Vec::with_capacity(events.len());
    for (idx, ev) in events.iter_mut().enumerate() {
        if ev.is_all_day {
            ev.col_index = 0;
            ev.total_cols = 1;
            ev.cluster_id = 0;
        } else {
            timed_indices.push(idx);
        }
    }

    if timed_indices.is_empty() {
        return;
    }

    let mut cluster_id_counter: usize = 1;
    let mut current_cluster_members: Vec<usize> = Vec::new();
    let mut column_end_times: Vec<i64> = Vec::new();
    let mut cluster_max_end: i64 = i64::MIN;

    for &ev_idx in &timed_indices {
        let ev_start = events[ev_idx].start_ts;
        let ev_visual_end = events[ev_idx]
            .end_ts
            .max(ev_start + MIN_VISUAL_DURATION_SECS);

        // If this event starts at or after the max visual end of the current cluster, finalize the cluster
        if !current_cluster_members.is_empty() && ev_start >= cluster_max_end {
            let total_cols = column_end_times.len().max(1);
            for &member_idx in &current_cluster_members {
                events[member_idx].total_cols = total_cols;
                events[member_idx].cluster_id = cluster_id_counter;
            }
            cluster_id_counter += 1;
            current_cluster_members.clear();
            column_end_times.clear();
            cluster_max_end = i64::MIN;
        }

        // Find the first column where the previous event has ended by `ev_start`
        let mut assigned_col = None;
        for (col_idx, col_end) in column_end_times.iter_mut().enumerate() {
            if *col_end <= ev_start {
                *col_end = ev_visual_end;
                assigned_col = Some(col_idx);
                break;
            }
        }

        let col_idx = match assigned_col {
            Some(c) => c,
            None => {
                column_end_times.push(ev_visual_end);
                column_end_times.len() - 1
            }
        };

        events[ev_idx].col_index = col_idx;
        current_cluster_members.push(ev_idx);
        if ev_visual_end > cluster_max_end {
            cluster_max_end = ev_visual_end;
        }
    }

    // Finalize the trailing cluster
    if !current_cluster_members.is_empty() {
        let total_cols = column_end_times.len().max(1);
        for &member_idx in &current_cluster_members {
            events[member_idx].total_cols = total_cols;
            events[member_idx].cluster_id = cluster_id_counter;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_event(id: &str, start_ts: i64, end_ts: i64) -> ViewportEvent {
        ViewportEvent {
            instance_id: format!("{}:{}", id, start_ts),
            event_id: id.to_string(),
            master_event_id: None,
            calendar_id: "cal-1".to_string(),
            account_id: "acc-1".to_string(),
            provider: "google".to_string(),
            calendar_name: "Work".to_string(),
            color_hex: "#6366f1".to_string(),
            title: format!("Event {}", id),
            description: String::new(),
            location: String::new(),
            start_ts,
            end_ts,
            is_all_day: false,
            timezone: "UTC".to_string(),
            rrule: None,
            rrule_human: None,
            is_recurring: false,
            is_exception: false,
            status: "confirmed".to_string(),
            self_rsvp: "accepted".to_string(),
            attendees: Vec::new(),
            conference_url: None,
            conference_provider: None,
            busy_mirror_of_event_id: None,
            is_dirty: false,
            col_index: 0,
            total_cols: 1,
            cluster_id: 0,
        }
    }

    #[test]
    fn test_overlapping_cluster_column_packing() {
        // A: 09:00 - 10:30
        // B: 09:30 - 10:00 (overlaps A -> col 1)
        // C: 10:00 - 11:00 (overlaps A, but B ended at 10:00 -> reuses col 1!)
        // D: 13:00 - 14:00 (separate cluster -> col 0, total_cols 1)
        let mut events = vec![
            sample_event("A", 9 * 3600, 10 * 3600 + 1800),
            sample_event("B", 9 * 3600 + 1800, 10 * 3600),
            sample_event("C", 10 * 3600, 11 * 3600),
            sample_event("D", 13 * 3600, 14 * 3600),
        ];

        compute_viewport_layout(&mut events);

        assert_eq!(events[0].event_id, "A");
        assert_eq!(events[0].col_index, 0);
        assert_eq!(events[0].total_cols, 2);

        assert_eq!(events[1].event_id, "B");
        assert_eq!(events[1].col_index, 1);
        assert_eq!(events[1].total_cols, 2);

        assert_eq!(events[2].event_id, "C");
        assert_eq!(events[2].col_index, 1);
        assert_eq!(events[2].total_cols, 2);
        assert_eq!(events[0].cluster_id, events[2].cluster_id);

        assert_eq!(events[3].event_id, "D");
        assert_eq!(events[3].col_index, 0);
        assert_eq!(events[3].total_cols, 1);
        assert_ne!(events[3].cluster_id, events[0].cluster_id);
    }
}
