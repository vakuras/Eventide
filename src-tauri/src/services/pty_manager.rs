use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Instant;

use portable_pty::{native_pty_system, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActiveSession {
    pub id: String,
    pub opened_at: i64,
    pub last_data_at: i64,
}

struct PtySession {
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Arc<Mutex<Box<dyn portable_pty::Child + Send + Sync>>>,
    alive: Arc<AtomicBool>,
    opened_at: Instant,
    last_data_at: Option<Instant>,
}

pub struct PtyManager {
    copilot_path: String,
    app_handle: AppHandle,
    sessions: Mutex<HashMap<String, PtySession>>,
    max_concurrent: Mutex<u32>,
}

/// Kill a process and all of its children.
#[cfg(target_os = "windows")]
fn kill_process_tree(pid: u32) {
    use std::os::windows::process::CommandExt;
    use std::process::Command;
    const CREATE_NO_WINDOW: u32 = 0x08000000;
    let _ = Command::new("taskkill")
        .args(["/F", "/T", "/PID", &pid.to_string()])
        .creation_flags(CREATE_NO_WINDOW)
        .output();
}

#[cfg(not(target_os = "windows"))]
fn kill_process_tree(pid: u32) {
    use std::process::Command;
    let _ = Command::new("pkill").args(["-TERM", "-P", &pid.to_string()]).output();
    let _ = Command::new("kill").args(["-TERM", &pid.to_string()]).output();
}

impl PtyManager {
    pub fn new(copilot_path: String, app_handle: AppHandle) -> Self {
        Self {
            copilot_path,
            app_handle,
            sessions: Mutex::new(HashMap::new()),
            max_concurrent: Mutex::new(5),
        }
    }

    pub fn open_session(&self, session_id: &str, cwd: Option<&str>) -> Result<String, String> {
        // If already alive, just return
        {
            let sessions = self.sessions.lock().unwrap();
            if let Some(entry) = sessions.get(session_id) {
                if entry.alive.load(Ordering::SeqCst) {
                    return Ok(session_id.to_string());
                }
            }
        }

        // Clean dead entry
        {
            let mut sessions = self.sessions.lock().unwrap();
            if sessions
                .get(session_id)
                .map(|e| !e.alive.load(Ordering::SeqCst))
                .unwrap_or(false)
            {
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
        let home = dirs::home_dir()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|| ".".to_string());
        let spawn_cwd = cwd.unwrap_or(&home);

        // Spawn copilot directly via portable-pty (ConPTY on Windows). No
        // helper binary is needed — a GUI-subsystem Tauri process can host
        // ConPTY children directly.
        let cols: u16 = 120;
        let rows: u16 = 40;

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let mut cmd = CommandBuilder::new(&self.copilot_path);
        // When using agency, we need the "copilot" subcommand before the flags
        let binary_name = std::path::Path::new(&self.copilot_path)
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("");
        if binary_name == "agency" || binary_name == "agency.exe" {
            cmd.args(["copilot", "--session-id", session_id, "--yolo"]);
        } else {
            cmd.args(["--session-id", session_id, "--yolo"]);
        }
        cmd.cwd(spawn_cwd);
        cmd.env("TERM", "xterm-256color");
        cmd.env("COLORTERM", "truecolor");
        cmd.env("FORCE_COLOR", "3");

        eprintln!(
            "[eventide] Spawning copilot directly: --session-id {} (cwd: {})",
            session_id, spawn_cwd
        );

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn copilot: {}", e))?;

        // Release the slave handle so the child owns the only reference.
        drop(pair.slave);

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to take PTY writer: {}", e))?;
        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let alive = Arc::new(AtomicBool::new(true));
        let child = Arc::new(Mutex::new(child));

        // Reader thread → emit pty:data
        let sid_for_reader = session_id.to_string();
        let alive_for_reader = alive.clone();
        let app_for_data = self.app_handle.clone();
        thread::spawn(move || {
            let mut buf = [0u8; 16384];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let data = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_for_data.emit(
                            "pty:data",
                            serde_json::json!({
                                "sessionId": sid_for_reader,
                                "data": data,
                            }),
                        );
                    }
                    Err(_) => break,
                }
            }
            alive_for_reader.store(false, Ordering::SeqCst);
        });

        // Exit watcher thread → emit pty:exit
        let sid_for_exit = session_id.to_string();
        let alive_for_exit = alive.clone();
        let child_for_exit = child.clone();
        let app_for_exit = self.app_handle.clone();
        thread::spawn(move || {
            let exit_code = {
                let mut guard = child_for_exit.lock().unwrap();
                match guard.wait() {
                    Ok(status) => status.exit_code() as i32,
                    Err(_) => -1,
                }
            };
            alive_for_exit.store(false, Ordering::SeqCst);
            eprintln!(
                "[eventide] copilot exited: session={} code={}",
                sid_for_exit, exit_code
            );
            let _ = app_for_exit.emit(
                "pty:exit",
                serde_json::json!({
                    "sessionId": sid_for_exit,
                    "exitCode": exit_code,
                }),
            );
        });

        let entry = PtySession {
            master: pair.master,
            writer,
            child,
            alive,
            opened_at: Instant::now(),
            last_data_at: None,
        };

        self.sessions
            .lock()
            .unwrap()
            .insert(session_id.to_string(), entry);
        Ok(session_id.to_string())
    }

    pub fn write(&self, session_id: &str, data: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get_mut(session_id) {
            if entry.alive.load(Ordering::SeqCst) {
                if entry.writer.write_all(data.as_bytes()).is_err() {
                    entry.alive.store(false, Ordering::SeqCst);
                    return Err("Write failed — session may have exited".to_string());
                }
                let _ = entry.writer.flush();
                entry.last_data_at = Some(Instant::now());
            }
        }
        Ok(())
    }

    pub fn resize(&self, session_id: &str, cols: u16, rows: u16) -> Result<(), String> {
        let sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get(session_id) {
            let _ = entry.master.resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            });
        }
        Ok(())
    }

    pub fn kill(&self, session_id: &str) -> Result<(), String> {
        let mut sessions = self.sessions.lock().unwrap();
        if let Some(entry) = sessions.get(session_id) {
            entry.alive.store(false, Ordering::SeqCst);
            if let Ok(mut child) = entry.child.lock() {
                let pid = child.process_id();
                let _ = child.kill();
                if let Some(pid) = pid {
                    kill_process_tree(pid);
                }
            }
        }
        sessions.remove(session_id);
        Ok(())
    }

    pub fn get_active_sessions(&self) -> Vec<ActiveSession> {
        let sessions = self.sessions.lock().unwrap();
        let now = Instant::now();
        sessions
            .iter()
            .filter(|(_, e)| e.alive.load(Ordering::SeqCst))
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
            .filter(|(_, e)| e.alive.load(Ordering::SeqCst))
            .map(|(id, e)| (id.clone(), e.opened_at))
            .collect();

        if alive.len() < max as usize {
            return;
        }

        // Sort oldest first
        alive.sort_by_key(|(_, opened_at)| *opened_at);

        let to_evict = alive.len() - (max as usize) + 1;
        for (id, _) in alive.into_iter().take(to_evict) {
            if let Some(entry) = sessions.get(&id) {
                entry.alive.store(false, Ordering::SeqCst);
                if let Ok(mut child) = entry.child.lock() {
                    let pid = child.process_id();
                    let _ = child.kill();
                    if let Some(pid) = pid {
                        kill_process_tree(pid);
                    }
                }
            }
            sessions.remove(&id);
        }
    }
}
