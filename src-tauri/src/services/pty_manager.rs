use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

use crate::copilot;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub id: String,
    pub opened_at: i64,
    pub last_data_at: i64,
}

struct PtySession {
    writer: Box<dyn Write + Send>,
    kill_flag: Arc<Mutex<bool>>,
    alive: bool,
    opened_at: Instant,
    last_data_at: Option<Instant>,
    data_bytes_since_idle: usize,
    cwd: String,
}

pub struct PtyManager {
    copilot_path: String,
    use_cmd: bool,
    app_handle: AppHandle,
    sessions: Mutex<HashMap<String, PtySession>>,
    max_concurrent: Mutex<u32>,
}

impl PtyManager {
    pub fn new(copilot_path: String, app_handle: AppHandle) -> Self {
        let use_cmd = copilot::is_cmd_shim(&copilot_path);
        Self {
            copilot_path,
            use_cmd,
            app_handle,
            sessions: Mutex::new(HashMap::new()),
            max_concurrent: Mutex::new(5),
        }
    }

    pub fn set_max_concurrent(&self, max: u32) {
        *self.max_concurrent.lock().unwrap() = max;
    }

    pub fn open_session(&self, session_id: &str, cwd: Option<&str>) -> Result<String, String> {
        // If already alive, just return
        {
            let sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get(session_id) {
                if entry.alive {
                    return Ok(session_id.to_string());
                }
            }
        }

        // Clean dead entry
        {
            let mut sessions = self.sessions.lock().unwrap();
            if sessions.get(session_id).map(|e| !e.alive).unwrap_or(false) {
                sessions.remove(session_id);
            }
        }

        self.evict_if_needed();
        self.spawn_session(session_id, cwd)
    }

    pub fn new_session(&self, cwd: Option<&str>) -> Result<String, String> {
        let session_id = uuid::Uuid::new_v4().to_string();
        self.evict_if_needed();
        self.spawn_session(&session_id, cwd)
    }

    fn spawn_session(&self, session_id: &str, cwd: Option<&str>) -> Result<String, String> {
        let home = dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string());
        let spawn_cwd = cwd.unwrap_or(&home);

        // Spawn via pty_host helper — a console-mode exe that creates ConPTY.
        // Tauri GUI apps can't create ConPTY children directly (0xC0000142).
        use std::process::{Command, Stdio};

        let self_exe = std::env::current_exe().map_err(|e| format!("Can't find self exe: {}", e))?;
        let pty_host = self_exe.parent().unwrap().join("pty_host.exe");

        if !pty_host.exists() {
            return Err(format!("pty_host.exe not found at {:?}", pty_host));
        }

        eprintln!("[eventide] Spawning via pty_host: --resume {} (cwd: {})", session_id, spawn_cwd);

        let mut child = Command::new(&pty_host)
            .args([&self.copilot_path, session_id, spawn_cwd, "120", "40"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| format!("Failed to spawn pty_host: {}", e))?;

        let stdin = child.stdin.take()
            .ok_or("Failed to get stdin")?;
        let stdout = child.stdout.take()
            .ok_or("Failed to get stdout")?;
        let stderr = child.stderr.take()
            .ok_or("Failed to get stderr")?;

        let kill_flag = Arc::new(Mutex::new(false));
        let kill_flag_clone = kill_flag.clone();

        let session_id_owned = session_id.to_string();
        let app_handle = self.app_handle.clone();

        // Stdout reader thread
        let sid_for_reader = session_id_owned.clone();
        let kill_for_reader = kill_flag.clone();
        let app_for_stdout = app_handle.clone();
        thread::spawn(move || {
            use std::io::Read;
            let mut reader = stdout;
            let mut buf = [0u8; 4096];
            loop {
                if *kill_for_reader.lock().unwrap() {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_for_stdout.emit("pty:data", serde_json::json!({
                            "sessionId": sid_for_reader,
                            "data": data,
                        }));
                    }
                    Err(_) => break,
                }
            }
        });

        // Stderr reader thread — merge into same data stream
        let sid_for_stderr = session_id_owned.clone();
        let kill_for_stderr = kill_flag.clone();
        let app_for_stderr = app_handle.clone();
        thread::spawn(move || {
            use std::io::Read;
            let mut reader = stderr;
            let mut buf = [0u8; 4096];
            loop {
                if *kill_for_stderr.lock().unwrap() {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_for_stderr.emit("pty:data", serde_json::json!({
                            "sessionId": sid_for_stderr,
                            "data": data,
                        }));
                    }
                    Err(_) => break,
                }
            }
        });

        // Exit watcher thread
        let sid_for_exit = session_id_owned.clone();
        let app_handle_exit = self.app_handle.clone();
        thread::spawn(move || {
            let status = child.wait();
            let exit_code = status
                .map(|s| s.code().unwrap_or(-1))
                .unwrap_or(-1);

            eprintln!("[eventide] Process exited: session={} code={}", sid_for_exit, exit_code);

            *kill_flag_clone.lock().unwrap() = true;

            let _ = app_handle_exit.emit("pty:exit", serde_json::json!({
                "sessionId": sid_for_exit,
                "exitCode": exit_code,
            }));
        });

        let entry = PtySession {
            writer: Box::new(stdin),
            kill_flag: kill_flag.clone(),
            alive: true,
            opened_at: Instant::now(),
            last_data_at: None,
            data_bytes_since_idle: 0,
            cwd: spawn_cwd.to_string(),
        };

        self.sessions.lock().unwrap().insert(session_id.to_string(), entry);
        Ok(session_id.to_string())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get_mut(session_id) {
            if entry.alive {
                entry
                    .writer
                    .write_all(data.as_bytes())
                    .map_err(|e| e.to_string())?;
                entry.writer.flush().map_err(|e| e.to_string())?;
            }
        }
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        // Send resize escape sequence to pty_host: \x1b]666;resize;<cols>;<rows>\x07
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get_mut(session_id) {
            let seq = format!("\x1b]666;resize;{};{}\x07", cols, rows);
            let _ = entry.writer.write_all(seq.as_bytes());
            let _ = entry.writer.flush();
        }
        Ok(())
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get_mut(session_id) {
            if entry.alive {
                *entry.kill_flag.lock().unwrap() = true;
                entry.alive = false;
            }
        }
        sessions.remove(session_id);
        Ok(())
    }

    pub fn kill_all(&self) {
        let mut sessions = self.sessions.lock().unwrap();
        for (_, entry) in sessions.iter_mut() {
            if entry.alive {
                *entry.kill_flag.lock().unwrap() = true;
                entry.alive = false;
            }
        }
        sessions.clear();
    }

    pub fn get_active_sessions(&self) -> Vec<ActiveSession> {
        let sessions = self.sessions.lock().unwrap();
        let now = Instant::now();
        sessions
            .iter()
            .filter(|(_, e)| e.alive)
            .map(|(id, e)| ActiveSession {
                id: id.clone(),
                opened_at: e.opened_at.elapsed().as_millis() as i64,
                last_data_at: e
                    .last_data_at
                    .map(|t| (now - t).as_millis() as i64)
                    .unwrap_or(0),
            })
            .collect()
    }

    pub fn change_cwd(&self, session_id: &str, cwd: &str) -> Result<String, String> {
        self.kill(session_id)?;
        self.open_session(session_id, Some(cwd))
    }

    fn evict_if_needed(&self) {
        let max = *self.max_concurrent.lock().unwrap();
        let mut sessions = self.sessions.lock().unwrap();

        let mut alive: Vec<(String, Instant)> = sessions
            .iter()
            .filter(|(_, e)| e.alive)
            .map(|(id, e)| (id.clone(), e.opened_at))
            .collect();

        if alive.len() < max as usize {
            return;
        }

        // Sort oldest first
        alive.sort_by_key(|(_, opened_at)| *opened_at);

        let to_evict = alive.len() - (max as usize) + 1;
        for (id, _) in alive.into_iter().take(to_evict) {
            if let Some(entry) = sessions.get_mut(&id) {
                *entry.kill_flag.lock().unwrap() = true;
                entry.alive = false;
            }
            sessions.remove(&id);
        }
    }
}
