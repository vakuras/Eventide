use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Notification {
    pub id: u64,
    #[serde(rename = "type")]
    pub notification_type: String,
    pub title: String,
    pub body: String,
    pub session_id: Option<String>,
    pub timestamp: String,
    pub read: bool,
}

pub struct NotificationService {
    notifications_dir: PathBuf,
    notifications: Vec<Notification>,
    next_id: u64,
}

impl NotificationService {
    pub fn new(notifications_dir: &Path) -> Self {
        let _ = fs::create_dir_all(notifications_dir);
        Self {
            notifications_dir: notifications_dir.to_path_buf(),
            notifications: Vec::new(),
            next_id: 1,
        }
    }

    pub fn get_all(&self) -> Vec<Notification> {
        self.notifications.clone()
    }

    pub fn get_unread_count(&self) -> u64 {
        self.notifications.iter().filter(|n| !n.read).count() as u64
    }

    pub fn mark_read(&mut self, id: u64) {
        if let Some(n) = self.notifications.iter_mut().find(|n| n.id == id) {
            n.read = true;
        }
    }

    pub fn mark_all_read(&mut self) {
        for n in &mut self.notifications {
            n.read = true;
        }
    }

    pub fn dismiss(&mut self, id: u64) {
        self.notifications.retain(|n| n.id != id);
    }

    pub fn clear_all(&mut self) {
        self.notifications.clear();
    }
}
