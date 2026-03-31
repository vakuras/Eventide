use tauri::State;
use crate::services::app_state::AppState;

/// Manually add a resource (by URL) to the resource panel for a session.
#[tauri::command]
pub fn resource_add(state: State<AppState>, session_id: String, url: String) -> bool {
    let mut guard = state.resources.lock().unwrap();
    if let Some(ref mut indexer) = *guard {
        indexer.add_manual_resource(&session_id, &url)
    } else {
        false
    }
}

/// Hide/remove a resource from the resource panel for a session.
#[tauri::command]
pub fn resource_remove(state: State<AppState>, session_id: String, key: String) {
    let mut guard = state.resources.lock().unwrap();
    if let Some(ref mut indexer) = *guard {
        indexer.remove_resource(&session_id, &key);
    }
}
