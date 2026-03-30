#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_app_changelog() -> String {
    // Embedded at compile time from the project root
    include_str!("../../../CHANGELOG.md").to_string()
}
