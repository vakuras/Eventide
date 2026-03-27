use tauri::State;
use crate::services::app_state::AppState;
use crate::services::session_service::{SessionInfo, SearchResult};

#[tauri::command]
pub fn list_sessions(state: State<'_, AppState>) -> Result<Vec<SessionInfo>, String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.list_sessions()
}

#[tauri::command]
pub fn search_sessions(state: State<'_, AppState>, query: String) -> Result<Vec<SearchResult>, String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.search_sessions(&query)
}

#[tauri::command]
pub fn rename_session(state: State<'_, AppState>, session_id: String, title: String) -> Result<(), String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.rename_session(&session_id, &title)
}

#[tauri::command]
pub fn delete_session(state: State<'_, AppState>, session_id: String) -> Result<(), String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.delete_session(&session_id)
}

#[tauri::command]
pub fn get_session_cwd(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.get_cwd(&session_id)
}

#[tauri::command]
pub fn save_session_cwd(state: State<'_, AppState>, session_id: String, cwd: String) -> Result<(), String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.save_cwd(&session_id, &cwd)
}

#[tauri::command]
pub fn get_last_user_prompt(state: State<'_, AppState>, session_id: String) -> Result<String, String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.get_last_user_prompt(&session_id)
}

#[tauri::command]
pub fn clean_empty_sessions(state: State<'_, AppState>) -> Result<u32, String> {
    let guard = state.sessions.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Session service not initialized")?;
    svc.clean_empty_sessions()
}
