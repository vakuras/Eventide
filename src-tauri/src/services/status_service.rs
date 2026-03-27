use serde::Serialize;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};

const MAX_NEXT_STEP_WORDS: usize = 6;
const TRAILING_FILLER_WORDS: &[&str] = &[
    "a", "an", "and", "by", "for", "from", "in", "of", "on", "or", "the", "to", "with",
];

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
    cache: std::sync::Mutex<HashMap<String, CachedStatus>>,
}

struct CachedStatus {
    data: SessionStatus,
    mtime_ms: u128,
}

impl StatusService {
    pub fn new(session_state_dir: &Path) -> Self {
        Self {
            session_state_dir: session_state_dir.to_path_buf(),
            cache: std::sync::Mutex::new(HashMap::new()),
        }
    }

    pub fn get_session_status(&self, session_id: &str) -> SessionStatus {
        let session_dir = self.session_state_dir.join(session_id);

        // Check cache freshness
        if let Ok(stat) = fs::metadata(&session_dir) {
            let mtime_ms = stat
                .modified()
                .ok()
                .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|d| d.as_millis())
                .unwrap_or(0);

            if let Ok(cache) = self.cache.lock() {
                if let Some(cached) = cache.get(session_id) {
                    if mtime_ms <= cached.mtime_ms {
                        return cached.data.clone();
                    }
                }
            }
        }

        let intent = self.read_intent(&session_dir);
        let summary = self.read_summary(&session_dir);
        let next_steps = self.read_plan(&session_dir);
        let files = self.read_files(&session_dir);
        let timeline = self.read_timeline(&session_dir);

        let data = SessionStatus {
            intent,
            summary,
            next_steps,
            files,
            timeline,
        };

        // Cache result
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(
                session_id.to_string(),
                CachedStatus {
                    data: data.clone(),
                    mtime_ms: std::time::SystemTime::now()
                        .duration_since(std::time::SystemTime::UNIX_EPOCH)
                        .map(|d| d.as_millis())
                        .unwrap_or(0),
                },
            );
        }

        data
    }

    /// Read the latest report_intent from the tail of events.jsonl.
    fn read_intent(&self, session_dir: &Path) -> Option<String> {
        let events_path = session_dir.join("events.jsonl");
        let mut file = fs::File::open(&events_path).ok()?;
        let file_len = file.metadata().ok()?.len();

        // Read last 64KB
        let read_size = file_len.min(64 * 1024);
        let offset = file_len - read_size;
        file.seek(SeekFrom::Start(offset)).ok()?;

        let mut buf = vec![0u8; read_size as usize];
        file.read_exact(&mut buf).ok()?;

        let text = String::from_utf8_lossy(&buf);
        let lines: Vec<&str> = text.lines().collect();

        for line in lines.iter().rev() {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(line) {
                if event.get("type").and_then(|t| t.as_str())
                    == Some("tool.execution_complete")
                {
                    let content = event.pointer("/data/result/content").and_then(|c| c.as_str());
                    let detailed = event
                        .pointer("/data/result/detailedContent")
                        .and_then(|c| c.as_str());

                    if content == Some("Intent logged") {
                        return detailed.map(|s| s.to_string());
                    }
                }
            }
        }

        None
    }

    /// Read session summary from session-summary.md, checkpoints, or workspace.yaml.
    fn read_summary(&self, session_dir: &Path) -> Option<SummaryInfo> {
        // 1. session-summary.md
        if let Ok(content) = fs::read_to_string(session_dir.join("session-summary.md")) {
            // Look for ## Summary section
            if let Some(pos) = content.find("## Summary") {
                let after = &content[pos + "## Summary".len()..];
                let end = after.find("\n## ").unwrap_or(after.len());
                let text = after[..end].trim().to_string();
                if !text.is_empty() {
                    return Some(SummaryInfo {
                        text,
                        source: "session-summary".to_string(),
                    });
                }
            }
            // Fallback: whole file minus title
            let body = content
                .lines()
                .skip_while(|l| l.starts_with('#'))
                .collect::<Vec<_>>()
                .join("\n")
                .trim()
                .to_string();
            if !body.is_empty() {
                return Some(SummaryInfo {
                    text: body[..body.len().min(500)].to_string(),
                    source: "session-summary".to_string(),
                });
            }
        }

        // 2. Latest checkpoint
        let checkpoint_dir = session_dir.join("checkpoints");
        if let Ok(entries) = fs::read_dir(&checkpoint_dir) {
            let mut md_files: Vec<_> = entries
                .flatten()
                .filter(|e| {
                    let name = e.file_name().to_string_lossy().to_string();
                    name.ends_with(".md") && name != "index.md"
                })
                .collect();
            md_files.sort_by_key(|e| e.file_name());

            if let Some(latest) = md_files.last() {
                if let Ok(content) = fs::read_to_string(latest.path()) {
                    if let Some(start) = content.find("<overview>") {
                        if let Some(end) = content.find("</overview>") {
                            let text = content[start + "<overview>".len()..end].trim().to_string();
                            if !text.is_empty() {
                                return Some(SummaryInfo {
                                    text,
                                    source: "checkpoint".to_string(),
                                });
                            }
                        }
                    }
                }
            }
        }

        // 3. workspace.yaml summary
        if let Ok(yaml_content) = fs::read_to_string(session_dir.join("workspace.yaml")) {
            for line in yaml_content.lines() {
                if let Some(rest) = line.strip_prefix("summary:") {
                    let text = rest.trim().to_string();
                    if !text.is_empty() {
                        return Some(SummaryInfo {
                            text,
                            source: "workspace".to_string(),
                        });
                    }
                }
            }
        }

        None
    }

    /// Parse plan.md for todo items (markdown checkboxes).
    fn read_plan(&self, session_dir: &Path) -> Vec<PlanItem> {
        let plan_path = session_dir.join("plan.md");
        let content = match fs::read_to_string(&plan_path) {
            Ok(c) => c,
            Err(_) => return Vec::new(),
        };

        let mut items = Vec::new();
        let mut found_first_unchecked = false;

        for line in content.lines() {
            let trimmed = line.trim_start();

            // [x] done items
            if let Some(rest) = trimmed
                .strip_prefix("- [x] ")
                .or_else(|| trimmed.strip_prefix("- [X] "))
                .or_else(|| trimmed.strip_prefix("* [x] "))
                .or_else(|| trimmed.strip_prefix("* [X] "))
            {
                if let Some(text) = summarize_next_step(rest) {
                    items.push(PlanItem { text, done: true, current: false });
                }
            }
            // [ ] pending items
            else if let Some(rest) = trimmed
                .strip_prefix("- [ ] ")
                .or_else(|| trimmed.strip_prefix("- [] "))
                .or_else(|| trimmed.strip_prefix("* [ ] "))
                .or_else(|| trimmed.strip_prefix("* [] "))
            {
                if let Some(text) = summarize_next_step(rest) {
                    let is_current = !found_first_unchecked;
                    found_first_unchecked = true;
                    items.push(PlanItem { text, done: false, current: is_current });
                }
            }
        }

        // Fallback: numbered list items
        if items.is_empty() {
            let re = regex::Regex::new(r"^\s*\d+\.\s+\*\*(.+?)\*\*").ok();
            if let Some(re) = re {
                for line in content.lines() {
                    if let Some(caps) = re.captures(line) {
                        if let Some(text) = summarize_next_step(&caps[1]) {
                            items.push(PlanItem {
                                text,
                                done: false,
                                current: items.is_empty(),
                            });
                        }
                    }
                }
            }
        }

        items
    }

    /// Extract file paths from edit/create tool events.
    fn read_files(&self, session_dir: &Path) -> Vec<FileChange> {
        let events_path = session_dir.join("events.jsonl");
        let file = match fs::File::open(&events_path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let mut files: HashMap<String, String> = HashMap::new();

        for line in reader.lines().flatten() {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                if event.get("type").and_then(|t| t.as_str()) != Some("tool.execution_start") {
                    continue;
                }
                let tool_name = event.pointer("/data/toolName").and_then(|t| t.as_str()).unwrap_or("");
                if tool_name != "edit" && tool_name != "create" {
                    continue;
                }

                let file_path = event
                    .pointer("/data/arguments/path")
                    .and_then(|p| p.as_str())
                    .or_else(|| {
                        event.pointer("/data/arguments")
                            .and_then(|a| a.as_str())
                            .and_then(|s| {
                                s.find("\"path\"")
                                    .and_then(|_| {
                                        let re = regex::Regex::new(r#""path"\s*:\s*"([^"]+)""#).ok()?;
                                        re.captures(s).map(|c| c.get(1).unwrap().as_str())
                                    })
                            })
                    });

                if let Some(path) = file_path {
                    let short = path
                        .replace('\\', "/")
                        .split('/')
                        .rev()
                        .take(2)
                        .collect::<Vec<_>>()
                        .into_iter()
                        .rev()
                        .collect::<Vec<_>>()
                        .join("/");
                    let action = if tool_name == "create" { "A" } else { "M" };
                    files.insert(short, action.to_string());
                }
            }
        }

        files
            .into_iter()
            .map(|(path, action)| FileChange { path, action })
            .collect()
    }

    /// Extract key timeline events from events.jsonl.
    fn read_timeline(&self, session_dir: &Path) -> Vec<TimelineEvent> {
        let events_path = session_dir.join("events.jsonl");
        let file = match fs::File::open(&events_path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let mut events = Vec::new();
        let mut user_msg_count = 0u32;

        for line in reader.lines().flatten() {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let ts = match event.get("timestamp").and_then(|t| t.as_str()) {
                    Some(t) => t.to_string(),
                    None => continue,
                };

                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

                match event_type {
                    "session.start" => {
                        events.push(TimelineEvent {
                            time: ts,
                            event_type: "start".to_string(),
                            text: "Session started".to_string(),
                        });
                    }
                    "session.resume" => {
                        events.push(TimelineEvent {
                            time: ts,
                            event_type: "resume".to_string(),
                            text: "Session resumed".to_string(),
                        });
                    }
                    "user.message" => {
                        user_msg_count += 1;
                        if user_msg_count <= 10 {
                            let content = event
                                .pointer("/data/content")
                                .and_then(|c| c.as_str())
                                .unwrap_or("")
                                .trim()
                                .lines()
                                .next()
                                .unwrap_or("");
                            let preview = if content.len() > 60 {
                                format!("{}...", &content[..57])
                            } else {
                                content.to_string()
                            };
                            events.push(TimelineEvent {
                                time: ts,
                                event_type: "user".to_string(),
                                text: preview,
                            });
                        }
                    }
                    "session.plan_changed" => {
                        let op = event
                            .pointer("/data/operation")
                            .and_then(|o| o.as_str())
                            .unwrap_or("updated");
                        events.push(TimelineEvent {
                            time: ts,
                            event_type: "plan".to_string(),
                            text: format!("Plan {}", op),
                        });
                    }
                    "subagent.started" => {
                        let desc = event
                            .pointer("/data/description")
                            .and_then(|d| d.as_str())
                            .unwrap_or("task");
                        events.push(TimelineEvent {
                            time: ts,
                            event_type: "agent".to_string(),
                            text: format!("Sub-agent started: {}", desc),
                        });
                    }
                    "subagent.completed" => {
                        events.push(TimelineEvent {
                            time: ts,
                            event_type: "agent".to_string(),
                            text: "Sub-agent completed".to_string(),
                        });
                    }
                    _ => {}
                }
            }
        }

        events.reverse();
        events.truncate(20);
        events
    }
}

fn summarize_next_step(text: &str) -> Option<String> {
    let cleaned: String = text
        .replace('`', "")
        .chars()
        .map(|c| {
            if c.is_alphanumeric() || c.is_whitespace() || c == '_' || c == '-' {
                c
            } else {
                ' '
            }
        })
        .collect();
    let cleaned = cleaned.split_whitespace().collect::<Vec<_>>().join(" ");

    if cleaned.is_empty() {
        return None;
    }

    let words: Vec<&str> = cleaned.split_whitespace().collect();
    if words.len() <= MAX_NEXT_STEP_WORDS {
        return Some(cleaned);
    }

    let mut shortened: Vec<&str> = words[..MAX_NEXT_STEP_WORDS].to_vec();
    while shortened.len() > 1
        && TRAILING_FILLER_WORDS.contains(&shortened.last().unwrap().to_lowercase().as_str())
    {
        shortened.pop();
    }

    Some(shortened.join(" "))
}
