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
        let spawn_cwd = cwd
            .unwrap_or_else(|| dirs::home_dir().map(|p| p.to_string_lossy().to_string()).unwrap_or_else(|| ".".to_string()).leak());

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows: 40,
                cols: 120,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = if self.use_cmd {
            let mut c = CommandBuilder::new("cmd.exe");
            c.args(["/c", &self.copilot_path, "--resume", session_id, "--yolo"]);
            c
        } else {
            let mut c = CommandBuilder::new(&self.copilot_path);
            c.args(["--resume", session_id, "--yolo"]);
            c
        };
        cmd.cwd(spawn_cwd);

        // Ensure proper environment — mirror the JS version's env setup
        // portable-pty inherits env by default, but we explicitly set TERM
        // and ensure critical Windows vars are present to prevent 0xC0000142
        cmd.env("TERM", "xterm-256color");
        if let Ok(val) = std::env::var("SystemRoot") { cmd.env("SystemRoot", val); }
        if let Ok(val) = std::env::var("PATH") { cmd.env("PATH", val); }
        if let Ok(val) = std::env::var("LOCALAPPDATA") { cmd.env("LOCALAPPDATA", val); }
        if let Ok(val) = std::env::var("USERPROFILE") { cmd.env("USERPROFILE", val); }
        if let Ok(val) = std::env::var("TEMP") { cmd.env("TEMP", val); }
        if let Ok(val) = std::env::var("TMP") { cmd.env("TMP", val); }
        if let Ok(val) = std::env::var("ComSpec") { cmd.env("ComSpec", val); }
        if let Ok(val) = std::env::var("PROGRAMFILES") { cmd.env("PROGRAMFILES", val); }

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn copilot: {}", e))?;

        // Drop slave — we only need the master side
        drop(pair.slave);

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;

        let kill_flag = Arc::new(Mutex::new(false));
        let kill_flag_clone = kill_flag.clone();

        let session_id_owned = session_id.to_string();
        let app_handle = self.app_handle.clone();

        // Data reader thread — reads from PTY and emits to frontend
        let sid_for_reader = session_id_owned.clone();
        let kill_for_reader = kill_flag.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                if *kill_for_reader.lock().unwrap() {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break, // EOF
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit("pty:data", serde_json::json!({
                            "sessionId": sid_for_reader,
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
            let mut child = child;
            let status = child.wait();
            let exit_code = status
                .map(|s| s.exit_code() as i32)
                .unwrap_or(-1);

            // Signal kill so reader thread stops
            *kill_flag_clone.lock().unwrap() = true;

            let _ = app_handle_exit.emit("pty:exit", serde_json::json!({
                "sessionId": sid_for_exit,
                "exitCode": exit_code,
            }));
        });

        let entry = PtySession {
            writer,
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
        // portable-pty resize requires the master handle, which we don't store separately.
        // For now this is a no-op; resize support will be added when we store the master.
        let _ = (session_id, cols, rows);
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
