# monet-ui · Monet for Tauri 2

Native [Tauri 2](https://tauri.app) integration for the **Monet** liquid-glass
panel design system. The chrome itself is drawn in the webview by
[`@monet-ui/monet-react`](../../packages/monet-react); this crate makes the
*window* behave like real liquid glass.

## What it does

- Builds a transparent window with custom Monet chrome by default; apps can opt
  into native OS decorations with `.decorations(true)`.
- Applies a **native vibrancy material** behind it via
  [`window-vibrancy`](https://docs.rs/window-vibrancy) — macOS
  `NSVisualEffectView` (HUD material, 14px corner radius) and Windows acrylic.
  Linux has no system material, so the window falls back to a solid background
  (signalled to the frontend, which opts into `data-monet-solid`).
- Treats macOS and Windows as verified native targets; Linux uses the solid
  fallback path above.
- Injects the per-app **accent** as the `--accent` CSS variable before page load.
- Exposes the window-control + config **commands** the custom title-bar buttons call.

## Usage

```rust
use monet_ui::{Accent, MonetWindow};
use tauri::WebviewUrl;

fn main() {
    tauri::Builder::default()
        // Monet's window-control + config commands (ordinary app commands —
        // no ACL permissions required).
        .invoke_handler(monet_ui::invoke_handler())
        .setup(|app| {
            MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
                .title("Raster")
                .accent(Accent::Raster)
                .inner_size(1440.0, 900.0)
                .min_inner_size(900.0, 600.0)
                .build()?;
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monet");
}
```

The example apps create their window in `setup` (so `tauri.conf.json` declares no
windows). Transparent windows on macOS also require `"macOSPrivateApi": true` in
`tauri.conf.json` and the `tauri` crate's `macos-private-api` feature. Windows
uses acrylic automatically through `window-vibrancy` and does not need those
macOS-only settings — see any `examples/*/src-tauri`.

## API

| Item | Purpose |
| --- | --- |
| `MonetWindow::builder(manager, label, url)` | Fluent builder → transparent + vibrancy window |
| `.title / .accent / .platform_chrome / .inner_size / .min_inner_size / .resizable / .decorations / .maximized` | builder options |
| `Accent` | `Raster` · `Vector` · `Audio` · `Motion` (+ `css_var`, `css_ref`, `value`) |
| `PlatformChrome` | `Auto` (default) · `Mac` · `Win` |
| `MonetConfig` | `{ platform, accent, accent_var, accent_value, vibrancy }`, injected as `window.__MONET__` |
| `invoke_handler()` | install on `tauri::Builder` to expose the commands |

### Commands (invoke from JS)

`window_close`, `window_minimize`, `window_toggle_maximize`, `window_start_drag`,
`monet_config`. These are application commands, so the frontend calls them as
`invoke("window_close")` — no capability/permission entries needed.

## License

MIT
