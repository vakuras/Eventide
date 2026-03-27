use std::path::PathBuf;
use std::sync::Mutex;

use tauri::{AppHandle, Manager};

use super::settings_service::SettingsService;
use super::session_service::SessionService;
use super::pty_manager::PtyManager;
use super::tag_indexer::TagIndexer;
use super::resource_indexer::ResourceIndexer;
use super::status_service::StatusService;
use super::notification_service::NotificationService;
use crate::copilot;

/// Shared application state managed by Tauri.
/// All services are behind Mutex for thread-safe IPC access.
pub struct AppState {
    pub settings: Mutex<Option<SettingsService>>,
    pub sessions: Mutex<Option<SessionService>>,
    pub pty: Mutex<Option<PtyManager>>,
    pub tags: Mutex<Option<TagIndexer>>,
    pub resources: Mutex<Option<ResourceIndexer>>,
    pub status: Mutex<Option<StatusService>>,
    pub notifications: Mutex<Option<NotificationService>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            settings: Mutex::new(None),
            sessions: Mutex::new(None),
            pty: Mutex::new(None),
            tags: Mutex::new(None),
            resources: Mutex::new(None),
            status: Mutex::new(None),
            notifications: Mutex::new(None),
        }
    }

    /// Initialize all services. Called during Tauri setup.
    pub fn initialize(&self, app_handle: AppHandle) -> Result<(), Box<dyn std::error::Error>> {
        let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
        let copilot_config_dir = home.join(".copilot");
        let session_state_dir = copilot_config_dir.join("session-state");
        let notifications_dir = copilot_config_dir.join("notifications");
        let _instructions_path = copilot_config_dir.join("copilot-instructions.md");

        // Settings
        let mut settings_svc = SettingsService::new(&copilot_config_dir);
        settings_svc.load();

        let copilot_path = {
            let custom = settings_svc.get().copilot_path.clone();
            if custom.is_empty() {
                copilot::resolve_copilot_path()
            } else {
                custom
            }
        };

        *self.settings.lock().unwrap() = Some(settings_svc);

        // Sessions
        *self.sessions.lock().unwrap() = Some(SessionService::new(&session_state_dir));

        // PTY Manager
        *self.pty.lock().unwrap() = Some(PtyManager::new(
            copilot_path,
            app_handle.clone(),
        ));

        // Tag Indexer
        *self.tags.lock().unwrap() = Some(TagIndexer::new(&session_state_dir));

        // Resource Indexer
        *self.resources.lock().unwrap() = Some(ResourceIndexer::new(&session_state_dir));

        // Status Service
        *self.status.lock().unwrap() = Some(StatusService::new(&session_state_dir));

        // Notification Service
        *self.notifications.lock().unwrap() = Some(NotificationService::new(&notifications_dir));

        log::info!("Eventide services initialized");
        Ok(())
    }
}
