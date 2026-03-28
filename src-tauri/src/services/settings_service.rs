use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    #[serde(default = "default_max_concurrent")]
    pub max_concurrent: u32,
    #[serde(default = "default_sidebar_width")]
    pub sidebar_width: u32,
    #[serde(default)]
    pub sidebar_collapsed: bool,
    #[serde(default = "default_last_active_tab")]
    pub last_active_tab: String,
    #[serde(default = "default_theme")]
    pub theme: String,
    #[serde(default)]
    pub copilot_path: String,
    #[serde(default)]
    pub open_tabs: Vec<String>,
    #[serde(default)]
    pub active_tab: Option<String>,
    #[serde(default)]
    pub tab_groups: Vec<serde_json::Value>,
    #[serde(default)]
    pub session_order: Vec<String>,
    #[serde(default = "default_zoom_factor")]
    pub zoom_factor: f64,
    #[serde(default)]
    pub prompt_for_workdir: bool,
    #[serde(default)]
    pub default_workdir: String,
}

fn default_max_concurrent() -> u32 { 5 }
fn default_sidebar_width() -> u32 { 280 }
fn default_last_active_tab() -> String { "active".to_string() }
fn default_theme() -> String { "mocha".to_string() }
fn default_zoom_factor() -> f64 { 1.0 }

impl Default for Settings {
    fn default() -> Self {
        Self {
            max_concurrent: default_max_concurrent(),
            sidebar_width: default_sidebar_width(),
            sidebar_collapsed: false,
            last_active_tab: default_last_active_tab(),
            theme: default_theme(),
            copilot_path: String::new(),
            open_tabs: Vec::new(),
            active_tab: None,
            tab_groups: Vec::new(),
            session_order: Vec::new(),
            zoom_factor: default_zoom_factor(),
            prompt_for_workdir: false,
            default_workdir: String::new(),
        }
    }
}

pub struct SettingsService {
    config_path: PathBuf,
    settings: Settings,
}

impl SettingsService {
    pub fn new(config_dir: &Path) -> Self {
        Self {
            config_path: config_dir.join("session-gui-settings.json"),
            settings: Settings::default(),
        }
    }

    pub fn load(&mut self) {
        match fs::read_to_string(&self.config_path) {
            Ok(data) => {
                match serde_json::from_str::<Settings>(&data) {
                    Ok(saved) => self.settings = saved,
                    Err(_) => self.settings = Settings::default(),
                }
            }
            Err(_) => self.settings = Settings::default(),
        }
    }

    pub fn save(&self) {
        if let Some(parent) = self.config_path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        if let Ok(json) = serde_json::to_string_pretty(&self.settings) {
            let _ = fs::write(&self.config_path, json);
        }
    }

    pub fn get(&self) -> Settings {
        self.settings.clone()
    }

    pub fn update(&mut self, partial: serde_json::Value) -> Settings {
        // Merge partial into current settings
        if let Ok(mut current_json) = serde_json::to_value(&self.settings) {
            if let Some(current_obj) = current_json.as_object_mut() {
                if let Some(partial_obj) = partial.as_object() {
                    for (key, value) in partial_obj {
                        current_obj.insert(key.clone(), value.clone());
                    }
                }
            }
            if let Ok(merged) = serde_json::from_value::<Settings>(current_json) {
                self.settings = merged;
            }
        }
        self.save();
        self.settings.clone()
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
    fn test_defaults() {
        let dir = temp_dir();
        let svc = SettingsService::new(dir.path());
        let s = svc.get();
        assert_eq!(s.max_concurrent, 5);
        assert_eq!(s.theme, "mocha");
        assert_eq!(s.zoom_factor, 1.0);
        assert!(!s.sidebar_collapsed);
        assert!(s.open_tabs.is_empty());
    }

    #[test]
    fn test_save_and_load() {
        let dir = temp_dir();
        {
            let mut svc = SettingsService::new(dir.path());
            svc.update(serde_json::json!({ "theme": "latte", "maxConcurrent": 10 }));
        }
        {
            let mut svc = SettingsService::new(dir.path());
            svc.load();
            let s = svc.get();
            assert_eq!(s.theme, "latte");
            assert_eq!(s.max_concurrent, 10);
            // Defaults preserved for unset fields
            assert_eq!(s.zoom_factor, 1.0);
        }
    }

    #[test]
    fn test_partial_update_preserves_other_fields() {
        let dir = temp_dir();
        let mut svc = SettingsService::new(dir.path());
        svc.update(serde_json::json!({ "theme": "latte" }));
        let s = svc.get();
        assert_eq!(s.theme, "latte");
        assert_eq!(s.max_concurrent, 5); // unchanged

        svc.update(serde_json::json!({ "maxConcurrent": 3 }));
        let s = svc.get();
        assert_eq!(s.theme, "latte"); // still latte
        assert_eq!(s.max_concurrent, 3);
    }

    #[test]
    fn test_load_missing_file_uses_defaults() {
        let dir = temp_dir();
        let mut svc = SettingsService::new(dir.path());
        svc.load();
        assert_eq!(svc.get().theme, "mocha");
    }

    #[test]
    fn test_load_corrupt_file_uses_defaults() {
        let dir = temp_dir();
        fs::write(dir.path().join("session-gui-settings.json"), "not json!").unwrap();
        let mut svc = SettingsService::new(dir.path());
        svc.load();
        assert_eq!(svc.get().theme, "mocha");
    }
}
