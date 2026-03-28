use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::SystemTime;

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
pub struct SearchResult {
    pub id: String,
    pub occurrences: Vec<SearchMatch>,
    pub preview: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatch {
    pub preview: String,
    pub before_text: String,
    pub match_text: String,
    pub after_text: String,
    pub source_label: String,
}

/// Minimal representation of workspace.yaml fields we need.
#[derive(Debug, Deserialize, Default)]
struct WorkspaceMeta {
    summary: Option<String>,
    cwd: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
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
        let entries = fs::read_dir(&self.dir).map_err(|e| e.to_string())?;
        let mut sessions = Vec::new();

        for entry in entries.flatten() {
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            if let Some(session) = self.load_session(&entry.file_name().to_string_lossy()) {
                sessions.push(session);
            }
        }

        // Sort by last modified, newest first
        sessions.sort_by(|a, b| b.last_modified.cmp(&a.last_modified));
        Ok(sessions)
    }

    fn load_session(&self, session_id: &str) -> Option<SessionInfo> {
        let session_dir = self.dir.join(session_id);
        let yaml_path = session_dir.join("workspace.yaml");

        let yaml_content = fs::read_to_string(&yaml_path).ok()?;
        let meta: WorkspaceMeta = serde_yaml::from_str(&yaml_content).unwrap_or_default();

        // Title resolution: .eventide-title > summary > events > fallback
        let (title, is_custom) = self.resolve_title(session_id, &session_dir, &meta);

        // CWD resolution: .eventide-cwd > workspace.yaml cwd
        let cwd = self.resolve_cwd(&session_dir, &meta);

        // Timestamps
        let stat = fs::metadata(&session_dir).ok()?;
        let mtime = stat
            .modified()
            .ok()
            .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let created_at = meta.created_at.unwrap_or_else(|| {
            stat.created()
                .ok()
                .map(|t| format_system_time(t))
                .unwrap_or_default()
        });
        let updated_at = meta.updated_at.unwrap_or_else(|| {
            stat.modified()
                .ok()
                .map(|t| format_system_time(t))
                .unwrap_or_default()
        });

        let _ = is_custom; // used in title cleanup logic below

        Some(SessionInfo {
            id: session_id.to_string(),
            title,
            cwd,
            created_at,
            updated_at,
            last_modified: mtime,
            tags: Vec::new(),
            resources: Vec::new(),
        })
    }

    fn resolve_title(
        &self,
        session_id: &str,
        session_dir: &Path,
        meta: &WorkspaceMeta,
    ) -> (String, bool) {
        // 1. Custom title (.eventide-title)
        if let Ok(content) = fs::read_to_string(session_dir.join(".eventide-title")) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return (trimmed, true);
            }
        }

        // 2. workspace.yaml summary
        if let Some(ref summary) = meta.summary {
            if !summary.is_empty() {
                return (self.clean_auto_title(summary), false);
            }
        }

        // 3. First user message in events.jsonl
        if let Some(title) = self.extract_title_from_events(session_dir) {
            return (self.clean_auto_title(&title), false);
        }

        // 4. Fallback
        let short_id = &session_id[..session_id.len().min(8)];
        (format!("Session {}", short_id), false)
    }

    fn clean_auto_title(&self, raw: &str) -> String {
        let mut title = raw.to_string();

        if title.starts_with('"') {
            title = title.trim_start_matches('"').trim_end_matches('"').to_string();
            if title.starts_with("Use the 'knowledge-based-answer'") {
                if let Some(pos) = title.find("answer:") {
                    title = title[pos + 7..].trim().to_string();
                    if title.len() > 60 {
                        title = format!("{}...", &title[..57]);
                    }
                    return title;
                }
                if title.len() > 60 {
                    title = title[..60].to_string();
                }
                return title;
            }
            if title.starts_with("Follow the workflow") && title.len() > 60 {
                title = title[..60].to_string();
                return title;
            }
        }

        if title.len() > 70 {
            title = format!("{}...", &title[..67]);
        }

        title
    }

    fn resolve_cwd(&self, session_dir: &Path, meta: &WorkspaceMeta) -> String {
        // 1. .eventide-cwd
        if let Ok(content) = fs::read_to_string(session_dir.join(".eventide-cwd")) {
            let trimmed = content.trim().to_string();
            if !trimmed.is_empty() {
                return trimmed;
            }
        }
        // 2. workspace.yaml cwd
        meta.cwd.clone().unwrap_or_default()
    }

    fn extract_title_from_events(&self, session_dir: &Path) -> Option<String> {
        let events_path = session_dir.join("events.jsonl");
        let file = fs::File::open(&events_path).ok()?;
        let reader = BufReader::new(file);

        for line in reader.lines() {
            let line = line.ok()?;
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if event.get("type").and_then(|t| t.as_str()) == Some("user.message") {
                    if let Some(content) = event
                        .pointer("/data/content")
                        .and_then(|c| c.as_str())
                    {
                        let mut title = content.trim().lines().next().unwrap_or("").to_string();
                        if title.len() > 70 {
                            title = format!("{}...", &title[..67]);
                        }
                        return Some(title);
                    }
                }
            }
        }
        None
    }

    pub fn search_sessions(&self, query: &str) -> Result<Vec<SearchResult>, String> {
        let needle = query.trim().to_lowercase();
        if needle.is_empty() {
            return Ok(Vec::new());
        }

        let entries = fs::read_dir(&self.dir).map_err(|e| e.to_string())?;
        let mut results = Vec::new();

        for entry in entries.flatten() {
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }
            let session_id = entry.file_name().to_string_lossy().to_string();
            let session_dir = self.dir.join(&session_id);

            if let Some(result) = self.search_events_for_occurrences(&session_id, &session_dir, &needle, 3) {
                results.push(result);
            }
        }

        Ok(results)
    }

    fn search_events_for_occurrences(
        &self,
        session_id: &str,
        session_dir: &Path,
        needle: &str,
        max_occurrences: usize,
    ) -> Option<SearchResult> {
        let events_path = session_dir.join("events.jsonl");
        let file = fs::File::open(&events_path).ok()?;
        let reader = BufReader::new(file);
        let mut occurrences = Vec::new();

        for line in reader.lines().flatten() {
            if occurrences.len() >= max_occurrences {
                break;
            }

            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");
                let source_label = match event_type {
                    "user.message" => "User",
                    "assistant.message" => "Assistant",
                    "tool.execution_complete" => "Tool",
                    _ => continue,
                };

                let texts = self.extract_searchable_texts(&event, event_type);
                for text in texts {
                    let remaining = max_occurrences - occurrences.len();
                    if remaining == 0 {
                        break;
                    }
                    let mut matches =
                        collect_matches_from_text(&text, needle, source_label, remaining);
                    occurrences.append(&mut matches);
                }
            }
        }

        if occurrences.is_empty() {
            return None;
        }

        let preview = occurrences[0].preview.clone();
        Some(SearchResult {
            id: session_id.to_string(),
            occurrences,
            preview,
        })
    }

    fn extract_searchable_texts(&self, event: &serde_json::Value, event_type: &str) -> Vec<String> {
        let mut texts = Vec::new();

        match event_type {
            "user.message" => {
                if let Some(content) = event.pointer("/data/content").and_then(|c| c.as_str()) {
                    texts.push(normalize_text(content));
                }
                if let Some(content) = event.pointer("/data/transformedContent").and_then(|c| c.as_str()) {
                    texts.push(normalize_text(content));
                }
            }
            "assistant.message" => {
                if let Some(data) = event.get("data") {
                    collect_visible_strings(data, &mut texts);
                }
            }
            "tool.execution_complete" => {
                if let Some(content) = event.pointer("/data/result/content").and_then(|c| c.as_str()) {
                    texts.push(normalize_text(content));
                }
                if let Some(content) = event.pointer("/data/result/detailedContent").and_then(|c| c.as_str()) {
                    texts.push(normalize_text(content));
                }
            }
            _ => {}
        }

        texts
    }

    pub fn get_last_user_prompt(&self, session_id: &str) -> Result<String, String> {
        let events_path = self.dir.join(session_id).join("events.jsonl");
        let file = fs::File::open(&events_path).map_err(|e| e.to_string())?;
        let reader = BufReader::new(file);
        let mut last_prompt = String::new();

        for line in reader.lines().flatten() {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if event.get("type").and_then(|t| t.as_str()) != Some("user.message") {
                    continue;
                }
                let content = event
                    .pointer("/data/content")
                    .or_else(|| event.pointer("/data/transformedContent"))
                    .and_then(|c| c.as_str())
                    .unwrap_or("");
                let prompt = normalize_text(content);
                if prompt.is_empty() {
                    continue;
                }
                last_prompt = if prompt.len() > 160 {
                    format!("{}...", &prompt[..157])
                } else {
                    prompt
                };
            }
        }

        Ok(last_prompt)
    }

    pub fn rename_session(&self, session_id: &str, title: &str) -> Result<(), String> {
        let title_path = self.dir.join(session_id).join(".eventide-title");
        fs::write(&title_path, title.trim()).map_err(|e| e.to_string())
    }

    pub fn delete_session(&self, session_id: &str) -> Result<(), String> {
        let session_dir = self.dir.join(session_id);
        fs::remove_dir_all(&session_dir).map_err(|e| e.to_string())
    }

    pub fn get_cwd(&self, session_id: &str) -> Result<String, String> {
        let session_dir = self.dir.join(session_id);
        let meta = self.read_workspace_meta(&session_dir);
        Ok(self.resolve_cwd(&session_dir, &meta))
    }

    pub fn save_cwd(&self, session_id: &str, cwd: &str) -> Result<(), String> {
        let session_dir = self.dir.join(session_id);
        fs::create_dir_all(&session_dir).map_err(|e| e.to_string())?;
        fs::write(session_dir.join(".eventide-cwd"), cwd.trim()).map_err(|e| e.to_string())
    }

    pub fn clean_empty_sessions(&self) -> Result<u32, String> {
        let entries = fs::read_dir(&self.dir).map_err(|e| e.to_string())?;
        let mut cleaned = 0u32;

        for entry in entries.flatten() {
            if !entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false) {
                continue;
            }

            let session_dir = entry.path();
            let events_path = session_dir.join("events.jsonl");

            let events_exist = events_path.exists();
            let events_empty = events_exist
                && fs::metadata(&events_path)
                    .map(|m| m.len() == 0)
                    .unwrap_or(true);

            if !events_exist || events_empty {
                // Check if workspace.yaml has a summary
                let meta = self.read_workspace_meta(&session_dir);
                if meta.summary.as_ref().map(|s| s.is_empty()).unwrap_or(true) {
                    let _ = fs::remove_dir_all(&session_dir);
                    cleaned += 1;
                }
            }
        }

        log::info!("Cleaned {} empty sessions", cleaned);
        Ok(cleaned)
    }

    fn read_workspace_meta(&self, session_dir: &Path) -> WorkspaceMeta {
        let yaml_path = session_dir.join("workspace.yaml");
        fs::read_to_string(&yaml_path)
            .ok()
            .and_then(|content| serde_yaml::from_str(&content).ok())
            .unwrap_or_default()
    }
}

// --- Helper functions ---

fn normalize_text(value: &str) -> String {
    value
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn format_system_time(t: SystemTime) -> String {
    t.duration_since(SystemTime::UNIX_EPOCH)
        .ok()
        .map(|d| {
            let secs = d.as_secs() as i64;
            chrono::DateTime::from_timestamp(secs, 0)
                .map(|dt| dt.to_rfc3339())
                .unwrap_or_default()
        })
        .unwrap_or_default()
}

const VISIBLE_KEYS: &[&str] = &["content", "text", "body", "title", "summary", "markdown", "message"];

fn collect_visible_strings(value: &serde_json::Value, output: &mut Vec<String>) {
    match value {
        serde_json::Value::String(s) => {
            let normalized = normalize_text(s);
            if !normalized.is_empty() {
                output.push(normalized);
            }
        }
        serde_json::Value::Array(arr) => {
            for item in arr {
                collect_visible_strings(item, output);
            }
        }
        serde_json::Value::Object(map) => {
            for (key, nested) in map {
                if VISIBLE_KEYS.contains(&key.as_str()) {
                    collect_visible_strings(nested, output);
                } else if matches!(nested, serde_json::Value::Object(_) | serde_json::Value::Array(_)) {
                    collect_visible_strings(nested, output);
                }
            }
        }
        _ => {}
    }
}

fn collect_matches_from_text(
    text: &str,
    needle: &str,
    source_label: &str,
    max_matches: usize,
) -> Vec<SearchMatch> {
    let lower = text.to_lowercase();
    let mut matches = Vec::new();
    let mut from = 0;

    while from <= lower.len().saturating_sub(needle.len()) && matches.len() < max_matches {
        if let Some(idx) = lower[from..].find(needle) {
            let abs_idx = from + idx;
            matches.push(build_search_match(text, abs_idx, needle.len(), source_label));
            from = abs_idx + needle.len().max(1);
        } else {
            break;
        }
    }

    matches
}

/// Snap a byte index to the nearest valid UTF-8 char boundary.
/// If `round_down` is false, snaps forward; if true, snaps backward won't go past len.
fn snap_to_char_boundary(s: &str, index: usize, round_up: bool) -> usize {
    if index >= s.len() {
        return s.len();
    }
    if s.is_char_boundary(index) {
        return index;
    }
    if round_up {
        let mut i = index;
        while i < s.len() && !s.is_char_boundary(i) {
            i += 1;
        }
        i
    } else {
        let mut i = index;
        while i > 0 && !s.is_char_boundary(i) {
            i -= 1;
        }
        i
    }
}

fn build_search_match(text: &str, match_index: usize, match_length: usize, source_label: &str) -> SearchMatch {
    let preview_radius = 42;
    let context_radius = 28;
    let preview_start = snap_to_char_boundary(text, match_index.saturating_sub(preview_radius), false);
    let preview_end = snap_to_char_boundary(text, (match_index + match_length + preview_radius).min(text.len()), true);
    let context_start = snap_to_char_boundary(text, match_index.saturating_sub(context_radius), false);
    let context_end = snap_to_char_boundary(text, (match_index + match_length + context_radius).min(text.len()), true);
    let safe_match_end = snap_to_char_boundary(text, (match_index + match_length).min(text.len()), true);

    let prefix = if preview_start > 0 { "…" } else { "" };
    let suffix = if preview_end < text.len() { "…" } else { "" };

    SearchMatch {
        preview: format!("{}{}{}", prefix, &text[preview_start..preview_end], suffix),
        before_text: text[context_start..match_index].to_string(),
        match_text: text[match_index..safe_match_end].to_string(),
        after_text: text[safe_match_end..context_end].to_string(),
        source_label: source_label.to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_session_dir() -> tempfile::TempDir {
        tempfile::tempdir().unwrap()
    }

    fn create_session(dir: &Path, id: &str, yaml: &str, events: Option<&str>) {
        let session_dir = dir.join(id);
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(session_dir.join("workspace.yaml"), yaml).unwrap();
        if let Some(events_content) = events {
            fs::write(session_dir.join("events.jsonl"), events_content).unwrap();
        }
    }

    // --- Title cleaning ---

    #[test]
    fn test_clean_auto_title_short() {
        let svc = SessionService::new(Path::new("/tmp"));
        assert_eq!(svc.clean_auto_title("Fix the bug"), "Fix the bug");
    }

    #[test]
    fn test_clean_auto_title_truncates_long() {
        let svc = SessionService::new(Path::new("/tmp"));
        let long = "a".repeat(80);
        let result = svc.clean_auto_title(&long);
        assert!(result.len() <= 70);
        assert!(result.ends_with("..."));
    }

    #[test]
    fn test_clean_auto_title_strips_quotes() {
        let svc = SessionService::new(Path::new("/tmp"));
        assert_eq!(svc.clean_auto_title("\"some prompt\""), "some prompt");
    }

    #[test]
    fn test_clean_auto_title_knowledge_answer() {
        let svc = SessionService::new(Path::new("/tmp"));
        let result = svc.clean_auto_title("\"Use the 'knowledge-based-answer' answer: what is Tauri?\"");
        assert_eq!(result, "what is Tauri?");
    }

    // --- CWD resolution ---

    #[test]
    fn test_cwd_eventide_file_takes_priority() {
        let dir = temp_session_dir();
        let session_dir = dir.path().join("sess1");
        fs::create_dir_all(&session_dir).unwrap();
        fs::write(session_dir.join(".eventide-cwd"), "C:\\eventide").unwrap();

        let svc = SessionService::new(dir.path());
        let meta = WorkspaceMeta::default();
        assert_eq!(svc.resolve_cwd(&session_dir, &meta), "C:\\eventide");
    }

    #[test]
    fn test_cwd_workspace_yaml_fallback() {
        let dir = temp_session_dir();
        let session_dir = dir.path().join("sess1");
        fs::create_dir_all(&session_dir).unwrap();

        let svc = SessionService::new(dir.path());
        let meta = WorkspaceMeta { cwd: Some("C:\\yaml".to_string()), ..Default::default() };
        assert_eq!(svc.resolve_cwd(&session_dir, &meta), "C:\\yaml");
    }

    // --- List sessions ---

    #[test]
    fn test_list_sessions_with_summary() {
        let dir = temp_session_dir();
        create_session(dir.path(), "abc-123", "summary: Fix auth bug\ncwd: C:\\dev", None);

        let svc = SessionService::new(dir.path());
        let sessions = svc.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "Fix auth bug");
        assert_eq!(sessions[0].cwd, "C:\\dev");
    }

    #[test]
    fn test_list_sessions_title_from_events() {
        let dir = temp_session_dir();
        let events = r#"{"type":"user.message","data":{"content":"deploy the service to prod"}}"#;
        create_session(dir.path(), "def-456", "cwd: C:\\dev", Some(events));

        let svc = SessionService::new(dir.path());
        let sessions = svc.list_sessions().unwrap();
        assert_eq!(sessions.len(), 1);
        assert_eq!(sessions[0].title, "deploy the service to prod");
    }

    #[test]
    fn test_list_sessions_custom_title() {
        let dir = temp_session_dir();
        create_session(dir.path(), "ghi-789", "summary: auto title", None);
        fs::write(dir.path().join("ghi-789").join(".eventide-title"), "My Custom Title").unwrap();

        let svc = SessionService::new(dir.path());
        let sessions = svc.list_sessions().unwrap();
        assert_eq!(sessions[0].title, "My Custom Title");
    }

    // --- Search ---

    #[test]
    fn test_search_finds_user_message() {
        let dir = temp_session_dir();
        let events = r#"{"type":"user.message","data":{"content":"fix the authentication bug in login"}}"#;
        create_session(dir.path(), "search-1", "summary: test", Some(events));

        let svc = SessionService::new(dir.path());
        let results = svc.search_sessions("authentication").unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "search-1");
        assert!(!results[0].occurrences.is_empty());
        assert!(results[0].occurrences[0].match_text.contains("authentication"));
    }

    #[test]
    fn test_search_no_results() {
        let dir = temp_session_dir();
        let events = r#"{"type":"user.message","data":{"content":"hello world"}}"#;
        create_session(dir.path(), "search-2", "summary: test", Some(events));

        let svc = SessionService::new(dir.path());
        let results = svc.search_sessions("nonexistent").unwrap();
        assert!(results.is_empty());
    }

    // --- Helper functions ---

    #[test]
    fn test_normalize_text() {
        assert_eq!(normalize_text("  hello   world  "), "hello world");
        assert_eq!(normalize_text("single"), "single");
        assert_eq!(normalize_text(""), "");
    }

    #[test]
    fn test_collect_matches_basic() {
        let matches = collect_matches_from_text("hello world hello", "hello", "User", 10);
        assert_eq!(matches.len(), 2);
        assert_eq!(matches[0].match_text, "hello");
        assert_eq!(matches[1].match_text, "hello");
    }

    #[test]
    fn test_collect_matches_case_insensitive() {
        let matches = collect_matches_from_text("Hello HELLO hello", "hello", "User", 10);
        assert_eq!(matches.len(), 3);
    }

    #[test]
    fn test_collect_matches_respects_limit() {
        let matches = collect_matches_from_text("aaa aaa aaa aaa", "aaa", "User", 2);
        assert_eq!(matches.len(), 2);
    }

    // --- Rename & Delete ---

    #[test]
    fn test_rename_creates_eventide_title() {
        let dir = temp_session_dir();
        let session_dir = dir.path().join("rename-1");
        fs::create_dir_all(&session_dir).unwrap();

        let svc = SessionService::new(dir.path());
        svc.rename_session("rename-1", "New Title").unwrap();

        let content = fs::read_to_string(session_dir.join(".eventide-title")).unwrap();
        assert_eq!(content, "New Title");
    }

    #[test]
    fn test_delete_removes_directory() {
        let dir = temp_session_dir();
        create_session(dir.path(), "delete-1", "summary: test", None);
        assert!(dir.path().join("delete-1").exists());

        let svc = SessionService::new(dir.path());
        svc.delete_session("delete-1").unwrap();
        assert!(!dir.path().join("delete-1").exists());
    }

    // --- Clean empty sessions ---

    #[test]
    fn test_clean_removes_empty_sessions() {
        let dir = temp_session_dir();
        create_session(dir.path(), "empty-1", "cwd: C:\\dev", None);
        create_session(dir.path(), "has-summary", "summary: important work", None);
        let events = r#"{"type":"user.message","data":{"content":"hello"}}"#;
        create_session(dir.path(), "has-events", "cwd: C:\\dev", Some(events));

        let svc = SessionService::new(dir.path());
        let cleaned = svc.clean_empty_sessions().unwrap();
        assert_eq!(cleaned, 1);
        assert!(!dir.path().join("empty-1").exists());
        assert!(dir.path().join("has-summary").exists());
        assert!(dir.path().join("has-events").exists());
    }

    // --- UTF-8 char boundary safety ---

    #[test]
    fn test_snap_to_char_boundary() {
        let s = "hello—world"; // em dash is 3 bytes at positions 5,6,7
        assert_eq!(snap_to_char_boundary(s, 5, false), 5); // already valid
        assert_eq!(snap_to_char_boundary(s, 6, false), 5); // snap back to start of —
        assert_eq!(snap_to_char_boundary(s, 7, false), 5); // snap back
        assert_eq!(snap_to_char_boundary(s, 6, true), 8);  // snap forward past —
        assert_eq!(snap_to_char_boundary(s, 7, true), 8);  // snap forward
        assert_eq!(snap_to_char_boundary(s, 100, true), s.len()); // past end
    }

    #[test]
    fn test_build_search_match_multibyte() {
        // Should not panic on text containing multi-byte UTF-8 characters
        let text = "Copilot uses AI — so always check for mistakes and verify results.";
        let idx = text.find("check").unwrap();
        let result = build_search_match(text, idx, 5, "User");
        assert!(result.match_text.contains("check"));
    }
}
