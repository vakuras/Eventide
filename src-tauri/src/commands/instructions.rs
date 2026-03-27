use std::path::PathBuf;

#[tauri::command]
pub fn read_instructions() -> Result<String, String> {
    let path = instructions_path();
    match std::fs::read_to_string(&path) {
        Ok(content) => Ok(content),
        Err(_) => Ok(String::new()),
    }
}

#[tauri::command]
pub fn write_instructions(content: String) -> Result<(), String> {
    let path = instructions_path();
    std::fs::write(&path, content).map_err(|e| e.to_string())
}

fn instructions_path() -> PathBuf {
    let home = dirs::home_dir().unwrap_or_else(|| PathBuf::from("."));
    home.join(".copilot").join("copilot-instructions.md")
}
