use regex::Regex;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};

const CACHE_FILE: &str = "session-resources.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Resource {
    #[serde(rename = "type")]
    pub resource_type: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub repo: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub state: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
struct CacheEntry {
    resources: Vec<Resource>,
    #[serde(default)]
    manual_resources: Option<Vec<Resource>>,
    #[serde(default)]
    removed_keys: Option<Vec<String>>,
    #[serde(rename = "indexedAt")]
    indexed_at: u128,
}

pub struct ResourceIndexer {
    session_state_dir: PathBuf,
    cache_path: PathBuf,
    cache: HashMap<String, CacheEntry>,
}

fn resource_key(r: &Resource) -> String {
    if let Some(ref id) = r.id {
        return format!("{}:{}", r.resource_type, id);
    }
    let url = r.url.as_deref().unwrap_or("");
    format!("{}:{}", r.resource_type, url)
}

impl ResourceIndexer {
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

            let resources = self.extract_resources(&session_dir);
            let existing = self.cache.remove(session_id);
            self.cache.insert(session_id.clone(), CacheEntry {
                resources,
                manual_resources: existing.as_ref().and_then(|e| e.manual_resources.clone()),
                removed_keys: existing.as_ref().and_then(|e| e.removed_keys.clone()),
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

    fn extract_resources(&self, session_dir: &Path) -> Vec<Resource> {
        let events_path = session_dir.join("events.jsonl");
        let file = match fs::File::open(&events_path) {
            Ok(f) => f,
            Err(_) => return Vec::new(),
        };

        let reader = BufReader::new(file);
        let mut prs: HashMap<String, Resource> = HashMap::new();
        let mut work_items: HashMap<String, Resource> = HashMap::new();
        let mut repos: HashSet<String> = HashSet::new();
        let mut wiki_urls: HashSet<String> = HashSet::new();
        let mut pipelines: HashMap<String, Resource> = HashMap::new();

        let pr_url_re = Regex::new(r#"https?://[^\s"\\)]*?/pullrequest/(\d+)"#).unwrap();
        let wi_url_re = Regex::new(r#"https?://[^\s"\\)]*?/_workitems/edit/(\d+)"#).unwrap();
        let git_url_re = Regex::new(r#"https?://(?:microsoft\.visualstudio\.com|dev\.azure\.com/microsoft)/(?:DefaultCollection/)?(\w+)/_git/([^\s"\\);,]+)"#).unwrap();
        let wiki_re = Regex::new(r#"https?://[^\s"\\)]*?/_wiki/[^\s"\\)]+"#).unwrap();
        let pipeline_re = Regex::new(r#"https?://[^\s"\\)]*?/_build/results\?buildId=(\d+)[^\s"\\)]*"#).unwrap();
        let pr_id_re = Regex::new(r#""pullRequestId"\s*:\s*(\d+)"#).unwrap();
        let wi_id_re = Regex::new(r#""workItemId"\s*:\s*(\d+)"#).unwrap();

        for line in reader.lines().flatten() {
            // PR URLs
            for cap in pr_url_re.captures_iter(&line) {
                let pr_id = cap[1].to_string();
                let url = cap[0].trim_end_matches(&['"', ')', '}', ']', '\\'][..]).to_string();
                let repo_match = Regex::new(r"_git/([^/]+)/pullrequest").ok()
                    .and_then(|re| re.captures(&url))
                    .map(|c| c[1].to_string());
                prs.entry(pr_id.clone()).or_insert(Resource {
                    resource_type: "pr".to_string(),
                    id: Some(pr_id),
                    url: Some(url),
                    name: None,
                    repo: repo_match,
                    state: None,
                });
            }

            // PR IDs from tool calls
            for cap in pr_id_re.captures_iter(&line) {
                let pr_id = cap[1].to_string();
                prs.entry(pr_id.clone()).or_insert(Resource {
                    resource_type: "pr".to_string(),
                    id: Some(pr_id),
                    url: None, name: None, repo: None, state: None,
                });
            }

            // Work item URLs
            for cap in wi_url_re.captures_iter(&line) {
                let wi_id = cap[1].to_string();
                let url = cap[0].trim_end_matches(&['"', ')', '}', ']', '\\'][..]).to_string();
                work_items.entry(wi_id.clone()).or_insert(Resource {
                    resource_type: "workitem".to_string(),
                    id: Some(wi_id), url: Some(url),
                    name: None, repo: None, state: None,
                });
            }

            // Work item IDs from tool calls
            for cap in wi_id_re.captures_iter(&line) {
                let wi_id = cap[1].to_string();
                work_items.entry(wi_id.clone()).or_insert(Resource {
                    resource_type: "workitem".to_string(),
                    id: Some(wi_id), url: None,
                    name: None, repo: None, state: None,
                });
            }

            // Git repo URLs (exclude PR URLs)
            for cap in git_url_re.captures_iter(&line) {
                let mut url = cap[0].trim_end_matches(&['"', ')', '}', ']', '\\', ';', ','][..]).to_string();
                if !url.contains("/pullrequest/") {
                    if let Some(git_idx) = url.find("/_git/") {
                        let after = &url[git_idx + 6..];
                        let repo_name = after.split('/').next().unwrap_or(after);
                        url = format!("{}{}", &url[..git_idx + 6], repo_name);
                    }
                    repos.insert(url);
                }
            }

            // Wiki URLs
            for cap in wiki_re.captures_iter(&line) {
                wiki_urls.insert(cap[0].trim_end_matches(&['"', ')', '}', ']', '\\'][..]).to_string());
            }

            // Pipeline URLs
            for cap in pipeline_re.captures_iter(&line) {
                let build_id = cap[1].to_string();
                let url = cap[0].trim_end_matches(&['"', ')', '}', ']', '\\'][..]).to_string();
                pipelines.entry(build_id.clone()).or_insert(Resource {
                    resource_type: "pipeline".to_string(),
                    id: Some(build_id), url: Some(url),
                    name: None, repo: None, state: None,
                });
            }
        }

        let mut resources: Vec<Resource> = Vec::new();
        resources.extend(prs.into_values());
        resources.extend(work_items.into_values());
        for url in repos {
            let name = Regex::new(r"_git/(.+)")
                .ok()
                .and_then(|re| re.captures(&url))
                .map(|c| c[1].to_string())
                .unwrap_or_else(|| url.clone());
            resources.push(Resource {
                resource_type: "repo".to_string(),
                id: None, url: Some(url), name: Some(name),
                repo: None, state: None,
            });
        }
        for url in wiki_urls {
            resources.push(Resource {
                resource_type: "wiki".to_string(),
                id: None, url: Some(url), name: None,
                repo: None, state: None,
            });
        }
        resources.extend(pipelines.into_values());

        resources
    }

    pub fn get_resources_for_session(&self, session_id: &str) -> Vec<serde_json::Value> {
        let entry = match self.cache.get(session_id) {
            Some(e) => e,
            None => return Vec::new(),
        };

        let auto = &entry.resources;
        let manual = entry.manual_resources.as_deref().unwrap_or(&[]);
        let removed: HashSet<String> = entry.removed_keys.as_ref()
            .map(|v| v.iter().cloned().collect())
            .unwrap_or_default();

        let mut seen = HashSet::new();
        let mut merged = Vec::new();

        for r in auto.iter().chain(manual.iter()) {
            let key = resource_key(r);
            if removed.contains(&key) || seen.contains(&key) {
                continue;
            }
            seen.insert(key);
            if let Ok(val) = serde_json::to_value(r) {
                merged.push(val);
            }
        }

        merged
    }
}
