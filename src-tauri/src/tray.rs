use crate::db::Database;
use crate::sync::{SyncOrchestrator, SyncTrigger};
use tauri::{
    menu::{Menu, MenuItem, PredefinedMenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Emitter, Manager, WindowEvent,
};

pub fn setup_tray_and_hibernation(
    app: &AppHandle,
    db: Database,
    sync_orchestrator: SyncOrchestrator,
) -> Result<(), String> {
    let up_next_item = MenuItem::with_id(
        app,
        "up_next",
        "⏱ Up Next: Checking schedule…",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;

    let open_item = MenuItem::with_id(app, "open_window", "Open RapidCal", true, None::<&str>)
        .map_err(|e| e.to_string())?;
    let quick_add_item = MenuItem::with_id(
        app,
        "quick_add",
        "Quick-Add Event (Cmd/Ctrl+K)",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let join_meeting_item = MenuItem::with_id(
        app,
        "join_meeting",
        "Join Next Video Meeting (Cmd/Ctrl+J)",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sync_now_item = MenuItem::with_id(
        app,
        "sync_now",
        "Sync All Calendars Now",
        true,
        None::<&str>,
    )
    .map_err(|e| e.to_string())?;
    let sep1 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let sep2 = PredefinedMenuItem::separator(app).map_err(|e| e.to_string())?;
    let quit_item = MenuItem::with_id(app, "quit", "Quit RapidCal", true, None::<&str>)
        .map_err(|e| e.to_string())?;

    let menu = Menu::with_items(
        app,
        &[
            &up_next_item,
            &sep1,
            &open_item,
            &quick_add_item,
            &join_meeting_item,
            &sync_now_item,
            &sep2,
            &quit_item,
        ],
    )
    .map_err(|e| e.to_string())?;

    let sync_for_menu = sync_orchestrator.clone();
    let mut builder = TrayIconBuilder::with_id("rapidcal-tray")
        .menu(&menu)
        .tooltip("RapidCal — Sub-ms Desktop Calendar")
        .on_menu_event(move |app_handle, event| match event.id.as_ref() {
            "open_window" | "up_next" => {
                show_and_focus_main_window(app_handle);
            }
            "quick_add" => {
                show_and_focus_main_window(app_handle);
                let _ = app_handle.emit("rapidcal://open-command-palette", "quick-add");
            }
            "join_meeting" => {
                let snap = sync_for_menu.get_status_snapshot();
                if let Some(url) = snap.up_next_conference_url {
                    let _ = open::that(url);
                } else {
                    show_and_focus_main_window(app_handle);
                }
            }
            "sync_now" => {
                sync_for_menu.trigger(SyncTrigger::Manual);
            }
            "quit" => {
                app_handle.exit(0);
            }
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_and_focus_main_window(tray.app_handle());
            }
        });

    if let Some(icon) = app.default_window_icon().cloned() {
        builder = builder.icon(icon);
    }

    let tray_icon = builder.build(app).map_err(|e| e.to_string())?;

    // Intercept window close to hibernate to tray when `hibernation_enabled` is true
    if let Some(main_win) = app.get_webview_window("main") {
        let db_for_close = db.clone();
        let sync_for_focus = sync_orchestrator.clone();
        let win_clone = main_win.clone();
        main_win.on_window_event(move |event| match event {
            WindowEvent::CloseRequested { api, .. } => {
                let hibernate = db_for_close
                    .get_oauth_config()
                    .map(|c| c.hibernation_enabled)
                    .unwrap_or(true);
                if hibernate {
                    api.prevent_close();
                    let _ = win_clone.hide();
                }
            }
            WindowEvent::Focused(true) => {
                sync_for_focus.trigger(SyncTrigger::WindowFocus);
            }
            _ => {}
        });
    }

    // Spawn 15-second "Up Next" countdown ticker for Tray title + tooltip + frontend event
    let app_for_ticker = app.clone();
    let sync_for_ticker = sync_orchestrator;
    tauri::async_runtime::spawn(async move {
        let mut interval = tokio::time::interval(std::time::Duration::from_secs(15));
        loop {
            interval.tick().await;
            let snapshot = sync_for_ticker.get_status_snapshot();
            let title_text = snapshot
                .up_next_label
                .clone()
                .unwrap_or_else(|| "No upcoming meetings".to_string());
            let _ = up_next_item.set_text(format!("⏱ {}", title_text));
            let _ = tray_icon.set_tooltip(Some(format!("RapidCal • {}", title_text)));
            let _ = app_for_ticker.emit("rapidcal://sync-status", &snapshot);
        }
    });

    Ok(())
}

pub fn show_and_focus_main_window(app: &AppHandle) {
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.show();
        let _ = win.set_focus();
    }
}
