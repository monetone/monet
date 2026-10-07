//! Native OS dialogs for Monet apps.
//!
//! Thin wrapper over the official [`tauri-plugin-dialog`] (v2) so Monet apps
//! get native file-open / file-save and message / ask / confirm dialogs. The
//! frontend drives them through `@tauri-apps/plugin-dialog` (see
//! `@monet-ui/monet-react`'s `dialog-api`); this module's only job is to register
//! the plugin on the Tauri builder.
//!
//! Register it alongside Monet's [`invoke_handler`](crate::invoke_handler):
//!
//! ```no_run
//! tauri::Builder::default()
//!     .invoke_handler(monet_ui::invoke_handler())
//!     .plugin(monet_ui::dialog_plugin())
//!     // ...
//! # ;
//! ```
//!
//! Each app must also allow the plugin's commands in its capabilities — add
//! `"dialog:default"` to the window's `permissions` list.
//!
//! For advanced/builder-style use, the underlying plugin is re-exported as
//! [`crate::tauri_plugin_dialog`].
//!
//! [`tauri-plugin-dialog`]: https://docs.rs/tauri-plugin-dialog

use tauri::plugin::TauriPlugin;
use tauri::Runtime;

/// Build the Monet dialog plugin (a thin wrapper around
/// [`tauri_plugin_dialog::init`](crate::tauri_plugin_dialog::init)).
///
/// Install it on the Tauri builder so the frontend's dialog helpers resolve to
/// real native OS dialogs:
///
/// ```no_run
/// tauri::Builder::default()
///     .plugin(monet_ui::dialog_plugin())
/// # ;
/// ```
pub fn dialog_plugin<R: Runtime>() -> TauriPlugin<R> {
    tauri_plugin_dialog::init()
}
