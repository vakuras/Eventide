use serde::Serialize;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionStatus {
    pub intent: Option<String>,
    pub summary: Option<SummaryInfo>,
    pub next_steps: Vec<PlanItem>,
    pub files: Vec<FileChange>,
    pub timeline: Vec<TimelineEvent>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SummaryInfo {
    pub text: String,
    pub source: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PlanItem {
    pub text: String,
    pub done: bool,
    pub current: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileChange {
    pub path: String,
    pub action: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TimelineEvent {
    pub time: String,
    #[serde(rename = "type")]
    pub event_type: String,
    pub text: String,
}

pub struct StatusService {
    session_state_dir: PathBuf,
}

impl StatusService {
    pub fn new(session_state_dir: &Path) -> Self {
        Self {
            session_state_dir: session_state_dir.to_path_buf(),
        }
    }

    pub fn get_session_status(&self, _session_id: &str) -> SessionStatus {
        // TODO: Port from status-service.js
        SessionStatus {
            intent: None,
            summary: None,
            next_steps: Vec::new(),
            files: Vec::new(),
            timeline: Vec::new(),
        }
    }
}
