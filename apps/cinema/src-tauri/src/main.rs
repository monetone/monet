// Monet Cinema — a real Tauri 2 window dressed in the Monet liquid-glass
// chrome. The window is transparent + decorationless with native vibrancy;
// all chrome (title bar, docks, panels) and the non-linear editor itself are
// drawn in the webview by @monet-ui/monet-react + the Rust/WASM compositing
// engine (decode/audio come from the platform: WebCodecs + Web Audio).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        // Durable document saves: write → fsync → rename → fsync(dir).
        .plugin(monet_ui::atomic_save_plugin())
        .plugin(monet_ui::dialog_plugin())
        .plugin(tauri_plugin_fs::init())
        // Local MCP server: exposes Cinema's @mcp commands to MCP clients over
        // http://127.0.0.1:48213/mcp (token in the app config dir's mcp.json).
        .plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet Cinema").port(48213)))
        .setup(|app| {
            monet_ui::install_quit_guard(app.handle())?;
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Monet Cinema")
                .app_name("Cinema")
                .accent(Accent::Motion)
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1080.0, 680.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet Cinema");
}
