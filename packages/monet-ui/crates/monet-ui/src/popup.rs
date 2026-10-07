//! Native popup windows for Monet dropdown lists and menus.
//!
//! A webview cannot paint outside its window, so a list opened near a window
//! edge is cut off by the window itself. monet-react instead opens
//! `about:blank#monet-popup-<n>` with `window.open`; the parent window's
//! new-window hook ([`on_new_window`]) answers with a borderless, transparent,
//! non-focusable child window that shares the opener's WebKit configuration,
//! so the page keeps DOM access to it and React portals the list into it.
//! [`place`] then sizes and positions it in screen space — flipping and
//! shifting within the monitor's work area — and shows it.
//!
//! Popup windows are pooled and never closed: every webview that shares the
//! opener's configuration unregisters the shared `ipc` message handler when it
//! is dropped (wry), which would cut the parent page off from Rust.
//!
//! macOS only for now: that is where the shared-configuration contract is
//! verified; other platforms deny the request and monet-react keeps its
//! in-window overlay.

use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::webview::{NewWindowFeatures, NewWindowResponse};
use tauri::{
    AppHandle, LogicalPosition, LogicalSize, Manager, Runtime, Url, WebviewUrl, WebviewWindow,
    WebviewWindowBuilder,
};

/// Label (and `about:blank` fragment) prefix of every popup window.
pub(crate) const PREFIX: &str = "monet-popup-";

/// Popup label → the label of the window whose page opened it.
static OWNERS: Mutex<Vec<(String, String)>> = Mutex::new(Vec::new());

/// Whether `label` names a Monet popup window (for code that lists windows).
pub fn is_popup_label(label: &str) -> bool {
    label.starts_with(PREFIX)
}

/// The popup label a `window.open("about:blank#monet-popup-<id>")` asks for,
/// or `None` for any other URL (those keep the old behaviour: denied). WebKit
/// reports the request as `about:blank%23monet-popup-<id>`, so both spellings
/// of the `#` are accepted.
pub(crate) fn popup_label(url: &Url) -> Option<String> {
    let rest = url.as_str().strip_prefix("about:blank")?;
    let label = rest
        .strip_prefix('#')
        .or_else(|| rest.strip_prefix("%23"))?;
    let id = label.strip_prefix(PREFIX)?;
    let ok = !id.is_empty()
        && label.len() <= 64
        && id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_');
    ok.then(|| label.to_string())
}

/// The new-window hook installed on every Monet window.
pub(crate) fn on_new_window<R: Runtime>(
    app: &AppHandle<R>,
    parent: &str,
    url: Url,
    features: NewWindowFeatures,
) -> NewWindowResponse<R> {
    if !cfg!(target_os = "macos") {
        return NewWindowResponse::Deny;
    }
    let (Some(label), Some(parent)) = (popup_label(&url), app.get_webview_window(parent)) else {
        return NewWindowResponse::Deny;
    };
    if app.get_webview_window(&label).is_some() {
        return NewWindowResponse::Deny;
    }
    // Plain about:blank: any other URL makes Tauri issue a load of its own,
    // which can replace the document the page has already filled.
    let blank = "about:blank".parse().expect("about:blank is a valid URL");
    let builder = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(blank))
        .window_features(features)
        .inner_size(1.0, 1.0)
        .decorations(false)
        .transparent(true)
        // macOS derives the shadow from the content's alpha, so it hugs the
        // rounded surface rather than the square window.
        .shadow(true)
        .resizable(false)
        .focused(false)
        .focusable(false)
        .accept_first_mouse(true)
        .skip_taskbar(true)
        .visible(false);
    match builder.parent(&parent).and_then(|b| b.build()) {
        Ok(window) => {
            // The surfaces' CSS backdrop blur cannot reach the app window
            // behind a separate window; the native material frosts it instead
            // (radius = --radius-panel; always active, as a popup is never key).
            #[cfg(target_os = "macos")]
            let _ = window_vibrancy::apply_vibrancy(
                &window,
                window_vibrancy::NSVisualEffectMaterial::HudWindow,
                Some(window_vibrancy::NSVisualEffectState::Active),
                Some(10.0),
            );
            if let Ok(mut owners) = OWNERS.lock() {
                owners.push((label, parent.label().to_string()));
            }
            NewWindowResponse::Create { window }
        }
        Err(err) => {
            eprintln!("[monet-popup] could not create {label}: {err}");
            NewWindowResponse::Deny
        }
    }
}

/// Destroy every popup `owner` opened once `owner` itself is destroyed. Safe
/// then: the web-content configuration they shared died with the owner.
pub(crate) fn destroy_owned<R: Runtime>(app: &AppHandle<R>, owner: &str) {
    let labels: Vec<String> = match OWNERS.lock() {
        Ok(mut owners) => {
            let (gone, kept): (Vec<_>, Vec<_>) = owners.drain(..).partition(|(_, p)| p == owner);
            *owners = kept;
            gone.into_iter().map(|(l, _)| l).collect()
        }
        Err(_) => return,
    };
    for label in labels {
        if let Some(popup) = app.get_webview_window(&label) {
            let _ = popup.destroy();
        }
    }
}

/// Hide every popup `owner`'s page opened. Run when that page (re)loads: the
/// page that held them is gone, so an open list would otherwise stay on screen.
pub(crate) fn hide_owned<R: Runtime>(app: &AppHandle<R>, owner: &str) {
    let labels: Vec<String> = OWNERS
        .lock()
        .map(|o| {
            o.iter()
                .filter(|(_, p)| p == owner)
                .map(|(l, _)| l.clone())
                .collect()
        })
        .unwrap_or_default();
    for label in labels {
        if let Some(popup) = app.get_webview_window(&label) {
            let _ = park(&popup);
        }
    }
}

/// Let the page open its popup windows ahead of time, outside an input event:
/// creating one while WebKit is dispatching a click stalls — at worst kills —
/// the web content process it shares with the popup. The new-window hook still
/// refuses everything but a Monet popup.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
pub(crate) fn allow_popup_prewarm<R: Runtime>(window: &WebviewWindow<R>) {
    #[cfg(target_os = "macos")]
    let _ = window.with_webview(|webview| {
        // SAFETY: `inner()` is the live WKWebView; with_webview runs on the main thread.
        let view = unsafe { &*(webview.inner() as *const objc2_web_kit::WKWebView) };
        unsafe {
            view.configuration()
                .preferences()
                .setJavaScriptCanOpenWindowsAutomatically(true)
        };
    });
}

/// A rectangle in logical pixels.
#[derive(Debug, Clone, Copy, PartialEq, Deserialize, Serialize)]
pub struct PopupRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Where a popup landed, in the caller's client coordinates (so a submenu can
/// anchor to a row inside it) plus the side actually used after any flip.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct PopupPlacement {
    pub x: f64,
    pub y: f64,
    pub side: String,
}

fn opposite(side: &str) -> &'static str {
    match side {
        "top" => "bottom",
        "left" => "right",
        "right" => "left",
        _ => "top",
    }
}

/// Place a `width`×`height` box beside `anchor` inside `area` (all logical
/// screen pixels): flip to the opposite side when it does not fit, then shift
/// along both axes to stay inside. Mirrors monet-react's `computePosition`, with
/// the monitor's work area standing in for the viewport.
pub(crate) fn compute(
    anchor: PopupRect,
    width: f64,
    height: f64,
    side: &str,
    align: &str,
    offset: f64,
    area: PopupRect,
) -> (f64, f64, String) {
    let fits = |s: &str| match s {
        "top" => anchor.y - offset - height >= area.y,
        "bottom" => anchor.y + anchor.height + offset + height <= area.y + area.height,
        "left" => anchor.x - offset - width >= area.x,
        _ => anchor.x + anchor.width + offset + width <= area.x + area.width,
    };
    let side = match side {
        "top" | "left" | "right" => side,
        _ => "bottom",
    };
    let used = if !fits(side) && fits(opposite(side)) {
        opposite(side)
    } else {
        side
    };
    let vertical = used == "top" || used == "bottom";
    let (mut x, mut y) = match used {
        "top" => (anchor.x, anchor.y - offset - height),
        "bottom" => (anchor.x, anchor.y + anchor.height + offset),
        "left" => (anchor.x - offset - width, anchor.y),
        _ => (anchor.x + anchor.width + offset, anchor.y),
    };
    if vertical {
        x = match align {
            "center" => anchor.x + anchor.width / 2.0 - width / 2.0,
            "end" => anchor.x + anchor.width - width,
            _ => anchor.x,
        };
    } else {
        y = match align {
            "center" => anchor.y + anchor.height / 2.0 - height / 2.0,
            "end" => anchor.y + anchor.height - height,
            _ => anchor.y,
        };
    }
    x = x.min(area.x + area.width - width).max(area.x);
    y = y.min(area.y + area.height - height).max(area.y);
    (x, y, used.to_string())
}

/// The work area (logical screen pixels) of the monitor under `point` (logical
/// screen pixels — on macOS tao tests it against display bounds in points),
/// falling back to the caller's monitor.
fn work_area<R: Runtime>(window: &WebviewWindow<R>, point: (f64, f64)) -> Option<PopupRect> {
    let monitor = window
        .monitor_from_point(point.0, point.1)
        .ok()
        .flatten()
        .or_else(|| window.current_monitor().ok().flatten())?;
    let area = monitor.work_area();
    let s = monitor.scale_factor();
    Some(PopupRect {
        x: area.position.x as f64 / s,
        y: area.position.y as f64 / s,
        width: area.size.width as f64 / s,
        height: area.size.height as f64 / s,
    })
}

/// Size, position and show popup `label` next to `anchor` (a rect in the
/// calling window's client coordinates). `invoke("monet_popup_place", …)`.
#[allow(clippy::too_many_arguments)]
pub(crate) fn place<R: Runtime>(
    window: &WebviewWindow<R>,
    label: &str,
    anchor: PopupRect,
    width: f64,
    height: f64,
    side: &str,
    align: &str,
    offset: f64,
) -> tauri::Result<PopupPlacement> {
    let popup = popup_window(window, label)?;
    let scale = window.scale_factor()?;
    let origin = window.inner_position()?.to_logical::<f64>(scale);
    let screen_anchor = PopupRect {
        x: origin.x + anchor.x,
        y: origin.y + anchor.y,
        ..anchor
    };
    let area = work_area(window, (screen_anchor.x, screen_anchor.y)).unwrap_or(PopupRect {
        x: f64::MIN / 4.0,
        y: f64::MIN / 4.0,
        width: f64::MAX / 2.0,
        height: f64::MAX / 2.0,
    });
    let (x, y, side) = compute(screen_anchor, width, height, side, align, offset, area);
    popup.set_ignore_cursor_events(false)?;
    popup.set_shadow(true)?;
    popup.set_size(LogicalSize::new(width, height))?;
    popup.set_position(LogicalPosition::new(x, y))?;
    show_without_focus(&popup)?;
    Ok(PopupPlacement {
        x: x - origin.x,
        y: y - origin.y,
        side,
    })
}

/// The cursor in popup `label`'s client coordinates, or `None` when it is
/// outside the popup. A popup never becomes key, and WebKit ignores mouse moves
/// in an inactive page, so monet-react polls this to drive hover itself.
pub(crate) fn cursor<R: Runtime>(
    window: &WebviewWindow<R>,
    label: &str,
) -> tauri::Result<Option<(f64, f64)>> {
    let popup = popup_window(window, label)?;
    let scale = popup.scale_factor()?;
    // tao reports the cursor scaled by the primary monitor, not the popup's.
    let cursor_scale = popup.primary_monitor()?.map_or(scale, |m| m.scale_factor());
    let at = popup.cursor_position()?.to_logical::<f64>(cursor_scale);
    let origin = popup.inner_position()?.to_logical::<f64>(scale);
    let size = popup.inner_size()?.to_logical::<f64>(scale);
    let (x, y) = (at.x - origin.x, at.y - origin.y);
    Ok((x >= 0.0 && y >= 0.0 && x < size.width && y < size.height).then_some((x, y)))
}

/// Order the popup in front without making it key: Tauri's `show` calls
/// `makeKeyAndOrderFront`, which takes key status from the app window for a
/// moment — enough for its page to see a blur and close the list it just opened.
#[cfg(target_os = "macos")]
fn show_without_focus<R: Runtime>(popup: &WebviewWindow<R>) -> tauri::Result<()> {
    let ns_window = popup.ns_window()? as usize;
    popup.run_on_main_thread(move || {
        // SAFETY: popup windows are pooled and never closed, so the NSWindow is
        // alive, and this runs on the main thread.
        let window = unsafe { &*(ns_window as *const objc2_app_kit::NSWindow) };
        window.orderFront(None);
    })
}

#[cfg(not(target_os = "macos"))]
fn show_without_focus<R: Runtime>(popup: &WebviewWindow<R>) -> tauri::Result<()> {
    popup.show()
}

/// Park popup `label` (it stays pooled for the next list or menu).
pub(crate) fn hide<R: Runtime>(window: &WebviewWindow<R>, label: &str) -> tauri::Result<()> {
    park(&popup_window(window, label)?)
}

/// "Hide" without ordering the window out: shrink it to one transparent,
/// click-through pixel. Ordering a webview window in or out flips its page's
/// visibility, and WebKit's UI process waits synchronously on that change,
/// stalling every page it serves — the app window's included.
fn park<R: Runtime>(popup: &WebviewWindow<R>) -> tauri::Result<()> {
    popup.set_ignore_cursor_events(true)?;
    popup.set_shadow(false)?;
    popup.set_size(LogicalSize::new(1.0, 1.0))?;
    // A freshly created popup is ordered in here, parked, so opening it later
    // never changes its visibility.
    show_without_focus(popup)
}

fn popup_window<R: Runtime>(
    window: &WebviewWindow<R>,
    label: &str,
) -> tauri::Result<WebviewWindow<R>> {
    if !label.starts_with(PREFIX) {
        return Err(tauri::Error::WindowNotFound);
    }
    window
        .app_handle()
        .get_webview_window(label)
        .ok_or(tauri::Error::WindowNotFound)
}
