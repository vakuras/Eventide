use tauri::State;
use crate::services::app_state::AppState;
use crate::services::status_service::SessionStatus;

#[tauri::command]
pub fn get_session_status(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<SessionStatus, String> {
    let guard = state.status.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Status service not initialized")?;
    Ok(svc.get_session_status(&session_id))
}
