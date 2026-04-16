//! PTY Host — a small console-mode helper that bridges ConPTY ↔ stdio.
//!
//! Tauri apps run as GUI subsystem (no console), which breaks ConPTY child
//! process creation (0xC0000142). This helper runs as a console app and
//! proxies between the Tauri parent (via piped stdin/stdout) and the ConPTY
//! child process.
//!
//! Protocol:
//!   stdin  → raw bytes forwarded to PTY
//!   stdout → raw bytes from PTY
//!   stderr → JSON control messages (exit code, errors)
//!
//! Special stdin sequences:
//!   \x1b]666;resize;<cols>;<rows>\x07  → resize PTY
//!
//! Usage: pty_host.exe <copilot_path> <session_id> <cwd> [cols] [rows]

use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::io::{self, Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;

fn main() {
    let args: Vec<String> = std::env::args().collect();
    if args.len() < 4 {
        eprintln!(r#"{{"error":"Usage: pty_host <copilot_path> <session_id> <cwd> [cols] [rows]"}}"#);
        std::process::exit(1);
    }

    let copilot_path = &args[1];
    let session_id = &args[2];
    let cwd = &args[3];
    let cols: u16 = args.get(4).and_then(|s| s.parse().ok()).unwrap_or(120);
    let rows: u16 = args.get(5).and_then(|s| s.parse().ok()).unwrap_or(40);

    let pty_system = native_pty_system();
    let pair = match pty_system.openpty(PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    }) {
        Ok(p) => p,
        Err(e) => {
            eprintln!(r#"{{"error":"Failed to open PTY: {}"}}"#, e);
            std::process::exit(1);
        }
    };

    let mut cmd = CommandBuilder::new(copilot_path);
    // When using agency, we need the "copilot" subcommand before the flags
    let binary_name = std::path::Path::new(copilot_path)
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("");
    if binary_name == "agency" || binary_name == "agency.exe" {
        cmd.args(["copilot", "--resume", session_id, "--yolo"]);
    } else {
        cmd.args(["--resume", session_id, "--yolo"]);
    }
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");

    let mut child = match pair.slave.spawn_command(cmd) {
        Ok(c) => c,
        Err(e) => {
            eprintln!(r#"{{"error":"Failed to spawn: {}"}}"#, e);
            std::process::exit(1);
        }
    };

    drop(pair.slave);

    let master = Arc::new(Mutex::new(pair.master));
    let mut reader = master.lock().unwrap().try_clone_reader()
        .expect("Failed to clone PTY reader");
    let mut writer = master.lock().unwrap().take_writer()
        .expect("Failed to take PTY writer");

    // PTY → stdout
    let master_for_resize = master.clone();
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut stdout = stdout.lock();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let _ = stdout.write_all(&buf[..n]);
                    let _ = stdout.flush();
                }
                Err(_) => break,
            }
        }
    });

    // stdin → PTY (with resize detection)
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut stdin = stdin.lock();
        let mut buf = [0u8; 4096];

        loop {
            match stdin.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = &buf[..n];
                    // Check for resize escape: \x1b]666;resize;<cols>;<rows>\x07
                    if let Some(esc_start) = data.iter().position(|&b| b == 0x1b) {
                        let rest = &data[esc_start..];
                        if let Some(end) = rest.iter().position(|&b| b == 0x07) {
                            // Send bytes before the escape
                            if esc_start > 0 {
                                let _ = writer.write_all(&data[..esc_start]);
                                let _ = writer.flush();
                            }
                            // Parse resize
                            let seq = String::from_utf8_lossy(&rest[..end]);
                            if seq.starts_with("\x1b]666;resize;") {
                                let parts: Vec<&str> = seq.trim_start_matches("\x1b]666;resize;").split(';').collect();
                                if parts.len() == 2 {
                                    if let (Ok(c), Ok(r)) = (parts[0].parse::<u16>(), parts[1].parse::<u16>()) {
                                        let _ = master_for_resize.lock().unwrap().resize(PtySize {
                                            rows: r, cols: c, pixel_width: 0, pixel_height: 0,
                                        });
                                    }
                                }
                            }
                            // Send bytes after the escape sequence
                            let after = esc_start + end + 1;
                            if after < n {
                                let _ = writer.write_all(&data[after..]);
                                let _ = writer.flush();
                            }
                        } else {
                            // No terminator found — not our sequence, forward everything
                            let _ = writer.write_all(data);
                            let _ = writer.flush();
                        }
                    } else {
                        // No escape, forward all
                        let _ = writer.write_all(data);
                        let _ = writer.flush();
                    }
                }
                Err(_) => break,
            }
        }
    });

    // Wait for child exit
    let status = child.wait();
    let exit_code = status.map(|s| s.exit_code() as i32).unwrap_or(-1);
    eprintln!(r#"{{"exit":{}}}"#, exit_code);
    std::process::exit(exit_code);
}
