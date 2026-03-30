mod commands;
mod services;
mod copilot;

use tauri::Manager;

use commands::{
    settings::{get_settings, update_settings},
    session::{
        list_sessions, search_sessions, rename_session, delete_session,
        get_session_cwd, save_session_cwd, get_last_user_prompt, clean_empty_sessions,
    },
    pty::{
        open_session, new_session, write_pty, resize_pty, kill_pty,
        get_active_sessions, change_cwd,
    },
    status::{get_session_status, get_session_diffs},
    notifications::{
        get_notifications, get_unread_count, mark_notification_read,
        mark_all_notifications_read, dismiss_notification, clear_all_notifications,
    },
    instructions::{read_instructions, write_instructions},
    app::{get_app_version, get_app_changelog},
};

use services::app_state::AppState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .manage(AppState::new())
        .setup(|app| {
            let state = app.state::<AppState>();
            state.initialize(app.handle().clone())?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            // Settings
            get_settings,
            update_settings,
            // Sessions
            list_sessions,
            search_sessions,
            rename_session,
            delete_session,
            get_session_cwd,
            save_session_cwd,
            get_last_user_prompt,
            clean_empty_sessions,
            // PTY
            open_session,
            new_session,
            write_pty,
            resize_pty,
            kill_pty,
            get_active_sessions,
            change_cwd,
            // Status
            get_session_status,
            get_session_diffs,
            // Notifications
            get_notifications,
            get_unread_count,
            mark_notification_read,
            mark_all_notifications_read,
            dismiss_notification,
            clear_all_notifications,
            // Instructions
            read_instructions,
            write_instructions,
            // App
            get_app_version,
            get_app_changelog,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Eventide");
}
