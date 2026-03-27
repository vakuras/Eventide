use std::fs;
use std::path::PathBuf;

#[tauri::command]
pub fn get_app_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}

#[tauri::command]
pub fn get_app_changelog() -> String {
    // Look for CHANGELOG.md relative to the executable
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|p| p.to_path_buf()));

    let candidates = [
        exe_dir.as_ref().map(|d| d.join("CHANGELOG.md")),
        exe_dir.as_ref().map(|d| d.join("..").join("CHANGELOG.md")),
        Some(PathBuf::from("CHANGELOG.md")),
    ];

    for candidate in candidates.iter().flatten() {
        if let Ok(content) = fs::read_to_string(candidate) {
            return content;
        }
    }

    String::new()
}
