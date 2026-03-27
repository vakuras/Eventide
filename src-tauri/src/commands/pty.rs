use tauri::State;
use crate::services::app_state::AppState;
use crate::services::pty_manager::ActiveSession;

#[tauri::command]
pub fn open_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<String, String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    // Get cwd from session service
    let cwd = {
        let sess_guard = state.sessions.lock().map_err(|e| e.to_string())?;
        let sess = sess_guard.as_ref().ok_or("Session service not initialized")?;
        let c = sess.get_cwd(&session_id).unwrap_or_default();
        if c.is_empty() { None } else { Some(c) }
    };
    mgr.open_session(&session_id, cwd.as_deref())
}

#[tauri::command]
pub fn new_session(
    state: State<'_, AppState>,
    cwd: Option<String>,
) -> Result<String, String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    mgr.new_session(cwd.as_deref())
}

#[tauri::command]
pub fn write_pty(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    mgr.write(&session_id, &data)
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, AppState>,
    session_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    mgr.resize(&session_id, cols, rows)
}

#[tauri::command]
pub fn kill_pty(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    mgr.kill(&session_id)
}

#[tauri::command]
pub fn get_active_sessions(state: State<'_, AppState>) -> Result<Vec<ActiveSession>, String> {
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    Ok(mgr.get_active_sessions())
}

#[tauri::command]
pub fn change_cwd(
    state: State<'_, AppState>,
    session_id: String,
    cwd: String,
) -> Result<String, String> {
    // Save cwd first
    {
        let guard = state.sessions.lock().map_err(|e| e.to_string())?;
        let svc = guard.as_ref().ok_or("Session service not initialized")?;
        svc.save_cwd(&session_id, &cwd)?;
    }
    let guard = state.pty.lock().map_err(|e| e.to_string())?;
    let mgr = guard.as_ref().ok_or("PTY manager not initialized")?;
    mgr.change_cwd(&session_id, &cwd)
}
