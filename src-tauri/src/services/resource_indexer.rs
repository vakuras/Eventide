use std::path::{Path, PathBuf};

pub struct ResourceIndexer {
    session_state_dir: PathBuf,
}

impl ResourceIndexer {
    pub fn new(session_state_dir: &Path) -> Self {
        Self {
            session_state_dir: session_state_dir.to_path_buf(),
        }
    }

    pub fn get_resources_for_session(&self, _session_id: &str) -> Vec<serde_json::Value> {
        // TODO: Port from resource-indexer.js
        Vec::new()
    }
}
