use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const CACHE_FILE: &str = "session-tags.json";

// Repo name pattern — matches team-prefixed project names
const REPO_PATTERN: &str = r"(?:^|\s|/)((?:Cloud|Detection|Mgmt|InR|InE|Nexus|WDATP|WD|MD|MDE|TVM|NDR|Response|Sense|OneCyber|MDATP|AutomatedIR|CaseManagement|Geneva|XSPM|FE|Subscriptions|AAPT)[\w.]*)";

const TOOL_TAGS: &[(&str, &str)] = &[
    ("kusto-mcp", "kusto"),
    ("ado-mcp", "azure-devops"),
    ("workiq", "work-iq"),
    ("nexus-meridian", "nexus-meridian"),
    ("github-mcp-server", "github"),
    ("sql", "sql"),
];

const TOPIC_KEYWORDS: &[(&str, &str)] = &[
    ("deploy", "deployment"), ("deploying", "deployment"), ("deployment", "deployment"),
    ("pipeline", "pipelines"), ("build", "build"), ("test", "testing"),
    ("monitor", "monitoring"), ("alert", "alerting"), ("incident", "incidents"),
    ("bug", "bugs"), ("fix", "bugfix"),
    ("pull request", "pull-requests"), ("review", "code-review"),
    ("config", "configuration"), ("configuration", "configuration"),
    ("telemetry", "telemetry"), ("kusto", "kusto"), ("nuget", "nuget"),
    ("connect", "connect"), ("wiki", "wiki"), ("security", "security"),
    ("api", "api"), ("throttl", "throttling"), ("onboard", "onboarding"),
    ("migration", "migration"), ("diagram", "diagrams"),
    ("architecture", "architecture"), ("investigate", "investigation"),
    ("debug", "debugging"), ("error", "errors"),
    ("sqlite", "sql"), ("database", "sql"), ("retry", "retry-logic"),
];

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    tags: Vec<String>,
    #[serde(rename = "indexedAt")]
    indexed_at: u128,
}

pub struct TagIndexer {
    session_state_dir: PathBuf,
    cache_path: PathBuf,
    cache: HashMap<String, CacheEntry>,
}

impl TagIndexer {
    pub fn new(session_state_dir: &Path) -> Self {
        let cache_path = session_state_dir.join(CACHE_FILE);
        let mut indexer = Self {
            session_state_dir: session_state_dir.to_path_buf(),
            cache_path,
            cache: HashMap::new(),
        };
        indexer.load_cache();
        indexer.rebuild_if_stale();
        indexer
    }

    fn load_cache(&mut self) {
        if let Ok(data) = fs::read_to_string(&self.cache_path) {
            if let Ok(cache) = serde_json::from_str(&data) {
                self.cache = cache;
            }
        }
    }

    fn save_cache(&self) {
        if let Ok(json) = serde_json::to_string_pretty(&self.cache) {
            let _ = fs::write(&self.cache_path, json);
        }
    }

    fn rebuild_if_stale(&mut self) {
        let entries = match fs::read_dir(&self.session_state_dir) {
            Ok(e) => e,
            Err(_) => return,
        };

        let current_ids: HashSet<String> = entries
            .flatten()
            .filter(|e| e.file_type().map(|ft| ft.is_dir()).unwrap_or(false))
            .map(|e| e.file_name().to_string_lossy().to_string())
            .collect();

        let mut updated = false;

        // Prune orphaned
        self.cache.retain(|id, _| {
            let keep = current_ids.contains(id);
            if !keep { updated = true; }
            keep
        });

        for session_id in &current_ids {
            let session_dir = self.session_state_dir.join(session_id);

            if let Some(cached) = self.cache.get(session_id) {
                if let Ok(stat) = fs::metadata(&session_dir) {
                    let mtime = stat.modified().ok()
                        .and_then(|t| t.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                        .map(|d| d.as_millis())
                        .unwrap_or(0);
                    if mtime <= cached.indexed_at {
                        continue;
                    }
                }
            }

            let tags = self.extract_tags(&session_dir);
            self.cache.insert(session_id.clone(), CacheEntry {
                tags,
                indexed_at: std::time::SystemTime::now()
                    .duration_since(std::time::SystemTime::UNIX_EPOCH)
                    .map(|d| d.as_millis())
                    .unwrap_or(0),
            });
            updated = true;
        }

        if updated {
            self.save_cache();
        }
    }

    fn extract_tags(&self, session_dir: &Path) -> Vec<String> {
        let events_path = session_dir.join("events.jsonl");
        let file = match fs::File::open(&events_path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let mut tags = HashSet::new();
        let repo_re = Regex::new(REPO_PATTERN).unwrap();

        for line in reader.lines().flatten() {
            if let Ok(event) = serde_json::from_str::<serde_json::Value>(&line) {
                let event_type = event.get("type").and_then(|t| t.as_str()).unwrap_or("");

                // User/assistant messages → repo mentions + topic keywords
                if event_type == "user.message" || event_type == "assistant.message" {
                    if let Some(content) = event.pointer("/data/content").and_then(|c| c.as_str()) {
                        for cap in repo_re.captures_iter(content) {
                            tags.insert(format!("repo:{}", &cap[1]));
                        }
                        if event_type == "user.message" {
                            let lower = content.to_lowercase();
                            for (keyword, tag) in TOPIC_KEYWORDS {
                                if lower.contains(&keyword.to_lowercase()) {
                                    tags.insert(tag.to_string());
                                }
                            }
                        }
                    }
                }

                // Tool calls → tool tags
                if event_type == "tool.call" {
                    if let Some(tool_name) = event.pointer("/data/toolName").and_then(|t| t.as_str()) {
                        for (prefix, tag) in TOOL_TAGS {
                            if tool_name.starts_with(prefix) || tool_name.contains(prefix) {
                                tags.insert(format!("tool:{}", tag));
                            }
                        }
                    }
                }
            }
        }

        tags.into_iter().collect()
    }

    pub fn get_tags_for_session(&self, session_id: &str) -> Vec<String> {
        self.cache
            .get(session_id)
            .map(|e| e.tags.clone())
            .unwrap_or_default()
    }
}
