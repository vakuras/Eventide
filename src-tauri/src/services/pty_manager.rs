use std::collections::HashMap;
use std::sync::Mutex;
use serde::Serialize;
use tauri::AppHandle;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub id: String,
    pub opened_at: i64,
    pub last_data_at: i64,
}

pub struct PtyManager {
    copilot_path: String,
    app_handle: Option<AppHandle>,
    sessions: Mutex<HashMap<String, PtySession>>,
    max_concurrent: u32,
}

struct PtySession {
    alive: bool,
    opened_at: i64,
    last_data_at: Option<i64>,
    // TODO: portable-pty child process handle
}

impl PtyManager {
    pub fn new(copilot_path: String, app_handle: AppHandle) -> Self {
        Self {
            copilot_path,
            app_handle: Some(app_handle),
            sessions: Mutex::new(HashMap::new()),
            max_concurrent: 5,
        }
    }

    pub fn set_max_concurrent(&mut self, max: u32) {
        self.max_concurrent = max;
    }

    pub fn open_session(&self, _session_id: &str, _cwd: Option<&str>) -> Result<String, String> {
        // TODO: Port from pty-manager.js using portable-pty
        Err("PTY manager not yet implemented".to_string())
    }

    pub fn new_session(&self, _cwd: Option<&str>) -> Result<String, String> {
        // TODO: Port from pty-manager.js using portable-pty
        Err("PTY manager not yet implemented".to_string())
    }

    pub fn write(&self, _session_id: &str, _data: &str) -> Result<(), String> {
        // TODO: Port from pty-manager.js
        Err("PTY manager not yet implemented".to_string())
    }

    pub fn resize(&self, _session_id: &str, _cols: u16, _rows: u16) -> Result<(), String> {
        // TODO: Port from pty-manager.js
        Err("PTY manager not yet implemented".to_string())
    }

    pub fn kill(&self, _session_id: &str) -> Result<(), String> {
        // TODO: Port from pty-manager.js
        Ok(())
    }

    pub fn get_active_sessions(&self) -> Vec<ActiveSession> {
        // TODO: Port from pty-manager.js
        Vec::new()
    }

    pub fn change_cwd(&self, _session_id: &str, _cwd: &str) -> Result<String, String> {
        // TODO: Port from pty-manager.js
        Err("PTY manager not yet implemented".to_string())
    }
}
