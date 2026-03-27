use std::env;
use std::path::PathBuf;
use std::process::Command;

/// Resolve the path to the Copilot CLI binary.
///
/// Search order:
/// 1. PATH lookup for copilot.exe / copilot.cmd
/// 2. Known Windows install locations
/// 3. Bare "copilot" fallback
pub fn resolve_copilot_path() -> String {
    // 1. Check PATH via `where`
    for bin in &["copilot.exe", "copilot.cmd"] {
        if let Ok(output) = Command::new("where").arg(bin).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let path = first_line.trim();
                    if !path.is_empty() && PathBuf::from(path).exists() {
                        return path.to_string();
                    }
                }
            }
        }
    }

    // 2. Known install locations
    let local_app_data = env::var("LOCALAPPDATA").unwrap_or_default();
    let program_files = env::var("PROGRAMFILES").unwrap_or_default();

    let candidates = [
        PathBuf::from(&local_app_data)
            .join("Microsoft")
            .join("WinGet")
            .join("Links")
            .join("copilot.exe"),
        PathBuf::from(&local_app_data)
            .join("Programs")
            .join("copilot-cli")
            .join("copilot.exe"),
        PathBuf::from(&program_files)
            .join("GitHub Copilot CLI")
            .join("copilot.exe"),
    ];

    for candidate in &candidates {
        if candidate.exists() {
            return candidate.to_string_lossy().to_string();
        }
    }

    // 3. Bare fallback
    "copilot".to_string()
}

/// Returns true if the copilot path is a .cmd file (needs cmd.exe /c wrapper on Windows).
pub fn is_cmd_shim(path: &str) -> bool {
    path.to_lowercase().ends_with(".cmd")
}
