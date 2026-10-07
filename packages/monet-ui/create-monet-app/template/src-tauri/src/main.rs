// __APP_PRODUCT_NAME__ — a Monet liquid-glass desktop app.
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
        // Native OS dialogs (file open/save, message/ask/confirm). The JS side
        // calls them through @monet-ui/monet-react's openFile/saveFile/confirm/
        // message/ask helpers; the "dialog:default" capability permits them.
        .plugin(monet_ui::dialog_plugin())
        .setup(|app| {
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("__APP_PRODUCT_NAME__")
                .accent(Accent::__APP_ACCENT_PASCAL__)
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running __APP_PRODUCT_NAME__");
}
