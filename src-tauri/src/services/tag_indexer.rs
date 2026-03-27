use std::path::{Path, PathBuf};

pub struct TagIndexer {
    session_state_dir: PathBuf,
}

impl TagIndexer {
    pub fn new(session_state_dir: &Path) -> Self {
        Self {
            session_state_dir: session_state_dir.to_path_buf(),
        }
    }

    pub fn get_tags_for_session(&self, _session_id: &str) -> Vec<String> {
        // TODO: Port from tag-indexer.js
        Vec::new()
    }
}
