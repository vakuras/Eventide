use tauri::State;
use crate::services::app_state::AppState;
use crate::services::settings_service::Settings;

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Result<Settings, String> {
    let guard = state.settings.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Settings not initialized")?;
    Ok(svc.get())
}

#[tauri::command]
pub fn update_settings(
    state: State<'_, AppState>,
    partial: serde_json::Value,
) -> Result<Settings, String> {
    let mut guard = state.settings.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_mut().ok_or("Settings not initialized")?;
    Ok(svc.update(partial))
}
