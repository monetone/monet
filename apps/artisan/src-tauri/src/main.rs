// Monet Artisan — a liquid-glass vector illustration studio.
//
// The window itself is transparent + decorationless with a native material
// (macOS vibrancy / Windows acrylic); all chrome (title bar, docks, panels) is
// drawn in the webview by @monet-ui/monet-react. The monet-ui crate builds the
// window and wires its custom window controls.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        // Native OS dialog plugin (file open/save, message/ask/confirm), permitted
        // by the "dialog:default" capability, plus the fs plugin that reads/writes
        // the picked paths. Together these back src/io/files.ts, so a document has
        // a real filePath and Save writes in place.
        .plugin(monet_ui::dialog_plugin())
        .plugin(tauri_plugin_fs::init())
        // Durable document saves: write → fsync → rename → fsync(dir), so an
        // interrupted Save can never destroy the user's file.
        .plugin(monet_ui::atomic_save_plugin())
        // Local MCP server: exposes Artisan's @mcp commands to MCP clients over
        // http://127.0.0.1:48212/mcp (token in the app config dir's mcp.json).
        .plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet Artisan").port(48212)))
        .setup(|app| {
            monet_ui::install_quit_guard(app.handle())?;
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Monet Artisan")
                .app_name("Artisan")
                .accent(Accent::Vector)
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1000.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet Artisan");
}
