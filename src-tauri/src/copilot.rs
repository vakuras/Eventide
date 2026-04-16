use std::env;
use std::path::PathBuf;
use std::process::Command;

/// Resolve the path to the Copilot CLI binary.
///
/// Prefers `agency` and falls back to `copilot` if not found.
///
/// Search order (repeated for each binary name):
/// 1. PATH lookup (`where` on Windows, `which` on Unix)
/// 2. Known install locations
/// 3. Bare fallback (`copilot-cli`, then `copilot`)
pub fn resolve_copilot_path() -> String {
    // Try agency first, then fall back to copilot
    for bin_name in &["agency", "copilot"] {
        if let Some(path) = find_binary(bin_name) {
            return path;
        }
    }

    // Bare fallback — prefer agency
    "agency".to_string()
}

/// Search for a binary by name across PATH and known install locations.
fn find_binary(name: &str) -> Option<String> {
    // 1. Check PATH via platform-appropriate command
    #[cfg(target_os = "windows")]
    {
        let exe_name = format!("{}.exe", name);
        let cmd_name = format!("{}.cmd", name);
        for bin in &[exe_name.as_str(), cmd_name.as_str()] {
            if let Ok(output) = Command::new("where").arg(bin).output() {
                if output.status.success() {
                    let stdout = String::from_utf8_lossy(&output.stdout);
                    if let Some(first_line) = stdout.lines().next() {
                        let path = first_line.trim();
                        if !path.is_empty() && PathBuf::from(path).exists() {
                            return Some(path.to_string());
                        }
                    }
                }
            }
        }
    }

    #[cfg(not(target_os = "windows"))]
    {
        if let Ok(output) = Command::new("which").arg(name).output() {
            if output.status.success() {
                let stdout = String::from_utf8_lossy(&output.stdout);
                if let Some(first_line) = stdout.lines().next() {
                    let path = first_line.trim();
                    if !path.is_empty() && PathBuf::from(path).exists() {
                        return Some(path.to_string());
                    }
                }
            }
        }
    }

    // 2. Known install locations (Windows)
    #[cfg(target_os = "windows")]
    {
        let exe_name = format!("{}.exe", name);
        let local_app_data = env::var("LOCALAPPDATA").unwrap_or_default();
        let program_files = env::var("PROGRAMFILES").unwrap_or_default();

        let candidates = [
            PathBuf::from(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Links")
                .join(&exe_name),
            PathBuf::from(&local_app_data)
                .join("Microsoft")
                .join("WinGet")
                .join("Packages"),
            PathBuf::from(&local_app_data)
                .join("Programs")
                .join(name)
                .join(&exe_name),
            PathBuf::from(&program_files)
                .join("GitHub Copilot CLI")
                .join(&exe_name),
        ];

        for candidate in &candidates {
            if candidate.is_dir() {
                if let Ok(entries) = std::fs::read_dir(candidate) {
                    for entry in entries.flatten() {
                        let p = entry.path();
                        if p.is_dir() && p.to_string_lossy().contains("GitHub.Copilot") {
                            let exe = p.join(&exe_name);
                            if exe.exists() {
                                return Some(exe.to_string_lossy().to_string());
                            }
                        }
                    }
                }
            } else if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    // 2b. Known install locations (macOS/Linux)
    #[cfg(not(target_os = "windows"))]
    {
        let home = env::var("HOME").unwrap_or_default();
        let candidates = [
            PathBuf::from(&home).join(".local").join("bin").join(name),
            PathBuf::from("/usr/local/bin").join(name),
            PathBuf::from("/opt/homebrew/bin").join(name),
        ];
        for candidate in &candidates {
            if candidate.exists() {
                return Some(candidate.to_string_lossy().to_string());
            }
        }
    }

    None
}

/// Returns true if the copilot path is a .cmd file (needs cmd.exe /c wrapper on Windows).
#[allow(dead_code)]
pub fn is_cmd_shim(path: &str) -> bool {
    path.to_lowercase().ends_with(".cmd")
}
