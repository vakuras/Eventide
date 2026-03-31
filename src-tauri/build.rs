fn main() {
    // Ensure frontendDist directory exists so tauri::generate_context!() doesn't panic
    // during `cargo test` or CI builds that skip the frontend build step.
    let frontend_dist = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../dist-tauri");
    if !frontend_dist.exists() {
        std::fs::create_dir_all(&frontend_dist).ok();
        // Create a minimal index.html so Tauri doesn't complain about an empty dist
        std::fs::write(
            frontend_dist.join("index.html"),
            "<html><body>build placeholder</body></html>",
        )
        .ok();
    }
    tauri_build::build()
}
