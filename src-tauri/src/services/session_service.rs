use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionInfo {
    pub id: String,
    pub title: String,
    pub cwd: String,
    pub created_at: String,
    pub updated_at: String,
    pub last_modified: i64,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub resources: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub id: String,
    pub preview: String,
}

pub struct SessionService {
    dir: PathBuf,
}

impl SessionService {
    pub fn new(session_state_dir: &Path) -> Self {
        Self {
            dir: session_state_dir.to_path_buf(),
        }
    }

    pub fn list_sessions(&self) -> Result<Vec<SessionInfo>, String> {
        // TODO: Port from session-service.js
        Ok(Vec::new())
    }

    pub fn search_sessions(&self, _query: &str) -> Result<Vec<SearchMatch>, String> {
        // TODO: Port from session-service.js
        Ok(Vec::new())
    }

    pub fn get_last_user_prompt(&self, _session_id: &str) -> Result<String, String> {
        // TODO: Port from session-service.js
        Ok(String::new())
    }

    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let title_path = self.dir.join(session_id).join(".eventide-title");
        std::fs::write(&title_path, title.trim()).map_err(|e| e.to_string())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let session_dir = self.dir.join(session_id);
        std::fs::remove_dir_all(&session_dir).map_err(|e| e.to_string())
    }

    pub fn get_cwd(&self, session_id: &str) -> Result<String, String> {
        let session_dir = self.dir.join(session_id);
        // 1. Check .eventide-cwd, fallback to .deepsky-cwd
        for filename in &[".eventide-cwd", ".deepsky-cwd"] {
            if let Ok(cwd) = std::fs::read_to_string(session_dir.join(filename)) {
                let cwd = cwd.trim().to_string();
                if !cwd.is_empty() {
                    return Ok(cwd);
                }
            }
        }
        // 2. Fallback to workspace.yaml
        // TODO: parse workspace.yaml cwd field
        Ok(String::new())
    }

    pub fn save_cwd(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        let session_dir = self.dir.join(session_id);
        std::fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
        std::fs::write(session_dir.join(".eventide-cwd"), cwd.trim())
            .map_err(|e| e.to_string())
    }

    pub fn clean_empty_sessions(&self) -> Result<u32, String> {
        // TODO: Port from session-service.js
        Ok(0)
    }
}
