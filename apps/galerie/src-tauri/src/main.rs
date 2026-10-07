// Monet Galerie — a liquid-glass photo catalog & non-destructive RAW develop
// studio (Lightroom Classic-class).
//
// The window itself is transparent + decorationless with a native material
// (macOS vibrancy / Windows acrylic); all chrome (title bar, docks, panels) is
// drawn in the webview by @monet-ui/monet-react. The monet-ui crate builds the
// window and wires its custom window controls. The raster (photo) accent tints
// the otherwise-neutral chrome.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

mod secondary;

use monet_galerie::{c2pa_sign, catalog, develop_job, raw_decode};
use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        // Native OS dialogs (file open/save, message/ask/confirm) — used by the
        // JS side via @monet-ui/monet-react's helpers; the "dialog:default"
        // capability permits them.
        // Durable document saves: write → fsync → rename → fsync(dir).
        .plugin(monet_ui::atomic_save_plugin())
        .plugin(monet_ui::dialog_plugin())
        .plugin(tauri_plugin_fs::init())
        // The SQLite catalog (.galcat): import, paged photo queries, culling,
        // develop-recipe persistence, preview-cache records. See src/catalog.rs.
        .plugin(catalog::init())
        // Camera RAW decode stays native: Core Image renders directly into a
        // bounded checked RGBA16 frame consumed by the shared WASM adapter.
        .plugin(raw_decode::init())
        // Full-resolution pixels stay native through decode, shared develop,
        // RGB16 ICC conversion, validation, and direct exclusive TIFF output.
        .plugin(develop_job::init())
        // Export ▸ Content Credentials (Signed): embed a signed C2PA manifest
        // instead of the unsigned JSON sidecar, once a signer is imported.
        .plugin(c2pa_sign::init())
        // A second webview shares the app-level catalog plugin state/connection.
        .plugin(secondary::init())
        // Local MCP server: exposes Galerie's @mcp commands (src/mcp) to MCP
        // clients on http://127.0.0.1:48217/mcp.
        .plugin(monet_mcp::init(
            monet_mcp::McpOptions::new("Monet Galerie").port(48217),
        ))
        .setup(|app| {
            monet_ui::install_quit_guard(app.handle())?;
            MonetWindow::builder(app.handle(), "main", WebviewUrl::App("index.html".into()))
                .title("Monet Galerie")
                .app_name("Galerie")
                .accent(Accent::Raster)
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1000.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet Galerie");
}
