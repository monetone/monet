// Monet example · Sandbox (Component Gallery)
// A real Tauri 2 window dressed in the Monet liquid-glass chrome. The window is
// transparent + decorationless with a native vibrancy material; all chrome is
// drawn in the webview by @monet-ui/monet-react. This example attaches a rich
// custom NATIVE menu (the macOS global menu bar) wired to the in-webview
// gallery: items emit monet://menu and the frontend's useMenuCommand acts on
// them (open/close panels, theme/density/accent/vibrancy).
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use monet_ui::{Accent, MenuMode, MonetWindow};
use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};
use tauri::{Manager, Runtime, WebviewUrl};

/// Build the sandbox's native menu bar. Custom `.text(id, label)` items emit
/// `monet://menu` with their id (handled by the frontend `useMenuCommand`);
/// predefined items (Quit/Undo/Minimize/…) are handled natively by the OS.
fn build_menu<R: Runtime, M: Manager<R>>(m: &M, name: &str) -> tauri::Result<Menu<R>> {
    let about = AboutMetadataBuilder::new().name(Some(name.to_string())).build();

    // App menu (first submenu = the macOS app menu).
    let app_menu = SubmenuBuilder::new(m, name)
        .about_with_text(format!("About {name}"), Some(about))
        .separator()
        .text("monet:preferences", "Preferences…")
        .separator()
        .quit()
        .build()?;

    let edit_menu = SubmenuBuilder::new(m, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    // Panels — global gallery actions (per-component opening lives in the
    // in-webview menus; these are the quick bulk actions).
    let panels_menu = SubmenuBuilder::new(m, "Panels")
        .text("gallery:open-all", "Open Every Panel")
        .text("gallery:close-all", "Close All Panels")
        .separator()
        .text("gallery:reset", "Reset Layout")
        .build()?;

    let theme_menu = SubmenuBuilder::new(m, "Theme")
        .text("view:theme:dark", "Dark")
        .text("view:theme:light", "Light")
        .build()?;
    let density_menu = SubmenuBuilder::new(m, "Density")
        .text("view:density:default", "Default")
        .text("view:density:compact", "Compact")
        .build()?;
    let accent_menu = SubmenuBuilder::new(m, "Accent")
        .text("view:accent:raster", "Cyan · raster")
        .text("view:accent:vector", "Amber · vector")
        .text("view:accent:audio", "Violet · audio")
        .text("view:accent:motion", "Magenta · motion")
        .text("view:accent:green", "Green")
        .text("view:accent:coral", "Coral")
        .build()?;
    let view_menu = SubmenuBuilder::new(m, "View")
        .item(&theme_menu)
        .item(&density_menu)
        .item(&accent_menu)
        .separator()
        .text("view:vibrancy", "Toggle Vibrancy Material")
        .separator()
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(m, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    let help_menu = SubmenuBuilder::new(m, "Help")
        .text("help:github", "Monet on GitHub")
        .build()?;

    MenuBuilder::new(m)
        .item(&app_menu)
        .item(&edit_menu)
        .item(&panels_menu)
        .item(&view_menu)
        .item(&window_menu)
        .item(&help_menu)
        .build()
}

fn main() {
    tauri::Builder::default()
        .invoke_handler(monet_ui::invoke_handler())
        .plugin(monet_ui::dialog_plugin())
        .setup(|app| {
            let handle = app.handle();
            let menu = build_menu(handle, "Sandbox")?;
            MonetWindow::builder(handle, "main", WebviewUrl::default())
                .title("Sandbox")
                .accent(Accent::Raster)
                .menu(MenuMode::Custom(menu))
                .inner_size(1320.0, 860.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet · Sandbox");
}
