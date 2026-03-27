use tauri::State;
use crate::services::app_state::AppState;
use crate::services::notification_service::Notification;

#[tauri::command]
pub fn get_notifications(state: State<'_, AppState>) -> Result<Vec<Notification>, String> {
    let guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Notification service not initialized")?;
    Ok(svc.get_all())
}

#[tauri::command]
pub fn get_unread_count(state: State<'_, AppState>) -> Result<u64, String> {
    let guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_ref().ok_or("Notification service not initialized")?;
    Ok(svc.get_unread_count())
}

#[tauri::command]
pub fn mark_notification_read(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    let mut guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_mut().ok_or("Notification service not initialized")?;
    svc.mark_read(id);
    Ok(())
}

#[tauri::command]
pub fn mark_all_notifications_read(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_mut().ok_or("Notification service not initialized")?;
    svc.mark_all_read();
    Ok(())
}

#[tauri::command]
pub fn dismiss_notification(state: State<'_, AppState>, id: u64) -> Result<(), String> {
    let mut guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_mut().ok_or("Notification service not initialized")?;
    svc.dismiss(id);
    Ok(())
}

#[tauri::command]
pub fn clear_all_notifications(state: State<'_, AppState>) -> Result<(), String> {
    let mut guard = state.notifications.lock().map_err(|e| e.to_string())?;
    let svc = guard.as_mut().ok_or("Notification service not initialized")?;
    svc.clear_all();
    Ok(())
}
