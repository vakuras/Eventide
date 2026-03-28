use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const MAX_NOTIFICATIONS: usize = 500;

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

#[derive(Debug, Serialize, Deserialize)]
struct NotificationState {
    notifications: Vec<Notification>,
    #[serde(rename = "nextId")]
    next_id: u64,
}

/// Incoming notification from a JSON file dropped by Copilot CLI.
#[derive(Debug, Deserialize)]
struct IncomingNotification {
    #[serde(rename = "type", default)]
    notification_type: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(rename = "sessionId", default)]
    session_id: Option<String>,
    #[serde(default)]
    timestamp: Option<String>,
}

pub struct NotificationService {
    notifications_dir: PathBuf,
    state_file: PathBuf,
    notifications: Vec<Notification>,
    next_id: u64,
    processed_files: std::collections::HashSet<String>,
}

impl NotificationService {
    pub fn new(notifications_dir: &Path) -> Self {
        let _ = fs::create_dir_all(notifications_dir);
        let state_file = notifications_dir.join(".state.json");

        let mut svc = Self {
            notifications_dir: notifications_dir.to_path_buf(),
            state_file,
            notifications: Vec::new(),
            next_id: 1,
            processed_files: std::collections::HashSet::new(),
        };
        svc.load_state();
        svc.scan_existing();
        svc
    }

    fn load_state(&mut self) {
        if let Ok(data) = fs::read_to_string(&self.state_file) {
            if let Ok(state) = serde_json::from_str::<NotificationState>(&data) {
                self.notifications = state.notifications;
                self.next_id = state.next_id;
            }
        }
    }

    fn save_state(&self) {
        let mut notifications = self.notifications.clone();
        if notifications.len() > MAX_NOTIFICATIONS {
            notifications = notifications.split_off(notifications.len() - MAX_NOTIFICATIONS);
        }

        let state = NotificationState {
            notifications,
            next_id: self.next_id,
        };

        if let Ok(json) = serde_json::to_string_pretty(&state) {
            let _ = fs::write(&self.state_file, json);
        }
    }

    fn scan_existing(&mut self) {
        if let Ok(entries) = fs::read_dir(&self.notifications_dir) {
            let files: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.ends_with(".json") && name != ".state.json"
                })
                .collect();

            for entry in files {
                let filename = entry.file_name().to_string_lossy().to_string();
                self.process_file(&filename);
            }
        }
    }

    fn process_file(&mut self, filename: &str) {
        if self.processed_files.contains(filename) {
            return;
        }

        let file_path = self.notifications_dir.join(filename);
        if !file_path.exists() {
            return;
        }

        match fs::read_to_string(&file_path) {
            Ok(content) => {
                if let Ok(data) = serde_json::from_str::<IncomingNotification>(&content) {
                    let notification = Notification {
                        id: self.next_id,
                        notification_type: data.notification_type.unwrap_or_else(|| "info".to_string()),
                        title: data.title.unwrap_or_else(|| "Notification".to_string()),
                        body: data.body.unwrap_or_default(),
                        session_id: data.session_id,
                        timestamp: data
                            .timestamp
                            .unwrap_or_else(|| chrono::Utc::now().to_rfc3339()),
                        read: false,
                    };
                    self.next_id += 1;
                    self.notifications.push(notification);
                    self.save_state();
                }
            }
            Err(_) => {}
        }

        self.processed_files.insert(filename.to_string());

        // Cap processed files set
        if self.processed_files.len() > 1000 {
            let excess: Vec<_> = self.processed_files.iter().take(500).cloned().collect();
            for f in excess {
                self.processed_files.remove(&f);
            }
        }

        // Consume the file
        let _ = fs::remove_file(&file_path);
    }

    /// Push a notification programmatically (e.g., on session exit).
    pub fn push(&mut self, notification_type: &str, title: &str, body: &str, session_id: Option<&str>) -> Notification {
        let n = Notification {
            id: self.next_id,
            notification_type: notification_type.to_string(),
            title: title.to_string(),
            body: body.to_string(),
            session_id: session_id.map(|s| s.to_string()),
            timestamp: chrono::Utc::now().to_rfc3339(),
            read: false,
        };
        self.next_id += 1;
        self.notifications.push(n.clone());
        self.save_state();
        n
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
            self.save_state();
        }
    }

    pub fn mark_all_read(&mut self) {
        for n in &mut self.notifications {
            n.read = true;
        }
        self.save_state();
    }

    pub fn dismiss(&mut self, id: u64) {
        self.notifications.retain(|n| n.id != id);
        self.save_state();
    }

    pub fn clear_all(&mut self) {
        self.notifications.clear();
        self.save_state();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    #[test]
    fn test_push_and_get() {
        let dir = temp_dir();
        let mut svc = NotificationService::new(dir.path());
        svc.push("task-done", "Build passed", "exit 0", Some("sess-1"));

        let all = svc.get_all();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Build passed");
        assert_eq!(all[0].notification_type, "task-done");
        assert_eq!(all[0].session_id, Some("sess-1".to_string()));
        assert!(!all[0].read);
    }

    #[test]
    fn test_unread_count() {
        let dir = temp_dir();
        let mut svc = NotificationService::new(dir.path());
        svc.push("info", "One", "", None);
        svc.push("info", "Two", "", None);
        assert_eq!(svc.get_unread_count(), 2);

        svc.mark_read(1);
        assert_eq!(svc.get_unread_count(), 1);
    }

    #[test]
    fn test_mark_all_read() {
        let dir = temp_dir();
        let mut svc = NotificationService::new(dir.path());
        svc.push("info", "One", "", None);
        svc.push("info", "Two", "", None);
        svc.mark_all_read();
        assert_eq!(svc.get_unread_count(), 0);
    }

    #[test]
    fn test_dismiss() {
        let dir = temp_dir();
        let mut svc = NotificationService::new(dir.path());
        svc.push("info", "One", "", None);
        svc.push("info", "Two", "", None);
        svc.dismiss(1);
        assert_eq!(svc.get_all().len(), 1);
        assert_eq!(svc.get_all()[0].title, "Two");
    }

    #[test]
    fn test_clear_all() {
        let dir = temp_dir();
        let mut svc = NotificationService::new(dir.path());
        svc.push("info", "One", "", None);
        svc.push("info", "Two", "", None);
        svc.clear_all();
        assert!(svc.get_all().is_empty());
    }

    #[test]
    fn test_state_persistence() {
        let dir = temp_dir();
        {
            let mut svc = NotificationService::new(dir.path());
            svc.push("error", "Session crashed", "exit 1", Some("s1"));
            svc.mark_read(1);
        }
        {
            let svc = NotificationService::new(dir.path());
            let all = svc.get_all();
            assert_eq!(all.len(), 1);
            assert_eq!(all[0].title, "Session crashed");
            assert!(all[0].read);
        }
    }

    #[test]
    fn test_consumes_json_files() {
        let dir = temp_dir();
        let notif_json = serde_json::json!({
            "type": "task-done",
            "title": "Build complete",
            "body": "All tests passed",
            "sessionId": "abc-123"
        });
        fs::write(dir.path().join("notif-001.json"), notif_json.to_string()).unwrap();

        let svc = NotificationService::new(dir.path());
        let all = svc.get_all();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].title, "Build complete");

        // File should be consumed (deleted)
        assert!(!dir.path().join("notif-001.json").exists());
    }
}
