// Monet Anime — a liquid-glass motion graphics & compositing studio.
//
// The window itself is transparent + decorationless with a native material
// (macOS vibrancy / Windows acrylic); all chrome (title bar, docks, panels) is
// drawn in the webview by @monet-ui/monet-react. The monet-ui crate builds the
// window and wires its custom window controls. The motion accent tints the
// otherwise-neutral chrome.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        // Native OS dialogs (file open/save, message/ask/confirm). The JS side
        // calls them through @monet-ui/monet-react's openFile/saveFile/confirm/
        // message/ask helpers; the "dialog:default" capability permits them.
        // Durable document saves: write → fsync → rename → fsync(dir).
        .plugin(monet_ui::atomic_save_plugin())
        .plugin(monet_ui::dialog_plugin())
        .plugin(tauri_plugin_fs::init())
        // Local MCP server: exposes Anime's @mcp commands to MCP clients over
        // http://127.0.0.1:48216/mcp (token in the app config dir's mcp.json).
        .plugin(monet_mcp::init(monet_mcp::McpOptions::new("Monet Anime").port(48216)))
        .setup(|app| {
            monet_ui::install_quit_guard(app.handle())?;
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Monet Anime")
                .app_name("Anime")
                .accent(Accent::Motion)
                .inner_size(1600.0, 1000.0)
                .min_inner_size(1000.0, 640.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet Anime");
}
