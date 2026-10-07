// Monet example · Studio
// A real Tauri 2 window dressed in the Monet liquid-glass chrome. The
// window itself is transparent + decorationless with a native vibrancy
// material; all chrome (title bar, docks, panels) is drawn in the webview by
// @monet-ui/monet-react. monet-ui (the Rust crate) builds the window and
// wires its custom window controls.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        .plugin(monet_ui::dialog_plugin())
        .setup(|app| {
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Studio")
                .accent(Accent::Raster)
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet · Studio");
}
