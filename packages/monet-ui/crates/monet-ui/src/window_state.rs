//! Per-window geometry persistence for Monet windows.
//!
//! When [`crate::MonetWindowBuilder::remember_state`] is enabled (the default),
//! Monet remembers each window's size, position and maximized flag — keyed by
//! window label — in a single JSON file under the app's config directory
//! (`monet-window-state.json`). The geometry is restored on the next
//! [`crate::MonetWindowBuilder::build`], clamped to a currently-visible monitor
//! so a window saved on a now-disconnected display still appears on-screen.
//!
//! This builds on the Wave-1 window-event forwarder rather than duplicating it:
//! the same `on_window_event` registration that emits `monet://window` also
//! records geometry and writes it back on `Moved` / `Resized` / `CloseRequested`.
//!
//! Storage is std `fs` + `serde_json` only — no extra crates.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::{LogicalPosition, LogicalSize, Manager, PhysicalRect, Runtime, WebviewWindow};

/// The JSON filename, stored in the per-app config dir.
const STATE_FILE: &str = "monet-window-state.json";

/// A single window's persisted geometry, in **logical** pixels (DPI-independent
/// so it restores sensibly across monitors with different scale factors).
#[derive(Debug, Clone, Copy, PartialEq, Serialize, Deserialize)]
pub struct WindowGeometry {
    /// Logical **inner** (content) width — what `set_size` restores (#232).
    pub width: f64,
    /// Logical **inner** (content) height — what `set_size` restores (#232).
    pub height: f64,
    /// Logical x of the window's outer top-left.
    pub x: f64,
    /// Logical y of the window's outer top-left.
    pub y: f64,
    /// Whether the window was maximized when saved.
    pub maximized: bool,
}

/// The whole persisted document: label → geometry.
#[derive(Debug, Default, Clone, Serialize, Deserialize)]
#[serde(transparent)]
pub struct WindowStateDoc {
    windows: HashMap<String, WindowGeometry>,
}

/// In-memory, app-managed cache of the persisted document plus its on-disk path.
/// Self-managed by the builder (like [`crate::MonetState`]) so callers register
/// nothing beyond `invoke_handler()`.
pub(crate) struct WindowStateStore {
    path: PathBuf,
    doc: Mutex<WindowStateDoc>,
}

impl WindowStateStore {
    /// Resolve the store for `manager`, loading any existing file. Returns
    /// `None` if the app config dir can't be resolved (then persistence is a
    /// silent no-op — geometry simply falls back to the builder defaults).
    pub(crate) fn load<R: Runtime, M: Manager<R>>(manager: &M) -> Option<Self> {
        let dir = manager.path().app_config_dir().ok()?;
        let path = dir.join(STATE_FILE);
        Some(Self::load_from_path(path))
    }

    /// Build a store backed by an explicit `path`, loading any existing file.
    /// Factored out of [`Self::load`] so the load/save/no-op logic can be
    /// exercised in unit tests without a live Tauri app.
    fn load_from_path(path: PathBuf) -> Self {
        let doc = std::fs::read(&path)
            .ok()
            .and_then(|bytes| serde_json::from_slice::<WindowStateDoc>(&bytes).ok())
            .unwrap_or_default();
        WindowStateStore {
            path,
            doc: Mutex::new(doc),
        }
    }

    /// The saved geometry for `label`, if any.
    pub(crate) fn get(&self, label: &str) -> Option<WindowGeometry> {
        self.doc.lock().ok()?.windows.get(label).copied()
    }

    /// Record `geometry` for `label` and flush the whole document to disk.
    /// Best-effort: errors (locked mutex, unwritable dir) are swallowed so a
    /// failed save never breaks the window.
    pub(crate) fn save(&self, label: &str, geometry: WindowGeometry) {
        let serialized = {
            let mut doc = match self.doc.lock() {
                Ok(d) => d,
                Err(_) => return,
            };
            // Skip the disk write when nothing actually changed.
            if doc.windows.get(label) == Some(&geometry) {
                return;
            }
            doc.windows.insert(label.to_string(), geometry);
            serde_json::to_vec_pretty(&*doc).ok()
        };
        if let Some(bytes) = serialized {
            if let Some(parent) = self.path.parent() {
                let _ = std::fs::create_dir_all(parent);
            }
            let _ = std::fs::write(&self.path, bytes);
        }
    }
}

/// Capture a window's current geometry as logical pixels. Returns `None` if any
/// of the underlying queries fail (e.g. the window is already gone).
pub(crate) fn capture_geometry<R: Runtime>(window: &WebviewWindow<R>) -> Option<WindowGeometry> {
    let maximized = window.is_maximized().unwrap_or(false);
    let scale = window.scale_factor().ok()?;
    // INNER size, not outer (#232): `restore_geometry` re-applies this through
    // `WebviewWindow::set_size`, which Tauri dispatches to the runtime's
    // `set_inner_size`. Capturing the frame-inclusive outer size promoted the
    // frame into the content on every launch, so a window with any frame
    // (decorated anywhere, or undecorated-with-shadow on Windows) grew a little
    // each time. Position stays OUTER — that is what `set_position` takes.
    let size = window.inner_size().ok()?.to_logical::<f64>(scale);
    let pos = window.outer_position().ok()?.to_logical::<f64>(scale);
    Some(WindowGeometry {
        width: size.width,
        height: size.height,
        x: pos.x,
        y: pos.y,
        maximized,
    })
}

/// Restore `geometry` onto a freshly-built `window`, clamping the position to a
/// currently-visible monitor so off-screen saves still appear. A maximized save
/// is restored as maximize after the un-maximized geometry is set, so a later
/// restore (un-maximize) returns to the saved bounds.
pub(crate) fn restore_geometry<R: Runtime>(
    window: &WebviewWindow<R>,
    geometry: WindowGeometry,
) {
    let (x, y) = clamp_to_visible_monitor(window, geometry);
    let _ = window.set_size(LogicalSize::new(geometry.width, geometry.height));
    let _ = window.set_position(LogicalPosition::new(x, y));
    if geometry.maximized {
        let _ = window.maximize();
    }
}

/// Clamp a saved logical top-left so the window's title strip stays on a
/// visible monitor. Uses the monitor whose work area contains (or is nearest
/// to) the saved point; falls back to the saved point unchanged when no monitor
/// info is available.
fn clamp_to_visible_monitor<R: Runtime>(
    window: &WebviewWindow<R>,
    geometry: WindowGeometry,
) -> (f64, f64) {
    let monitors = match window.available_monitors() {
        Ok(m) if !m.is_empty() => m,
        _ => return (geometry.x, geometry.y),
    };

    // Logical work-area rects for every monitor.
    let rects: Vec<Rect> = monitors
        .iter()
        .map(|mon| work_area_rect(mon.work_area(), mon.scale_factor()))
        .collect();

    // If the saved rect is sufficiently visible on any monitor, keep it.
    if rects.iter().any(|r| rect_visible_on(geometry, *r)) {
        return (geometry.x, geometry.y);
    }

    // Off-screen: re-home onto the primary monitor (or the first available),
    // clamped inside its work area.
    let primary = window
        .primary_monitor()
        .ok()
        .flatten()
        .map(|mon| work_area_rect(mon.work_area(), mon.scale_factor()));
    let Some(target) = primary.or_else(|| rects.into_iter().next()) else {
        return (geometry.x, geometry.y);
    };
    clamp_point_into(geometry, target)
}

/// A monitor's WORK AREA as a logical rect — the region left after the menu bar
/// / taskbar, which is what these rects always claimed to be (#234). The full
/// `position()`/`size()` bounds are not it: `clamp_point_into` pins a re-homed
/// window to the rect's top-left, so full bounds put the title strip under the
/// macOS menu bar or a top/left-docked Windows taskbar — the exact failure this
/// clamp exists to prevent.
fn work_area_rect(area: &PhysicalRect<i32, u32>, scale: f64) -> Rect {
    let pos = area.position.to_logical::<f64>(scale);
    let size = area.size.to_logical::<f64>(scale);
    Rect {
        x: pos.x,
        y: pos.y,
        w: size.width,
        h: size.height,
    }
}

/// A logical-pixel rectangle (monitor work area).
#[derive(Debug, Clone, Copy, PartialEq)]
struct Rect {
    x: f64,
    y: f64,
    w: f64,
    h: f64,
}

/// The minimum visible overlap (logical px) the saved window must keep on a
/// monitor before it's considered "still on-screen". Picked so the title strip
/// stays grabbable.
const VISIBLE_MARGIN: f64 = 64.0;

/// Whether `geometry` overlaps `monitor` by at least [`VISIBLE_MARGIN`] on both
/// axes — i.e. enough of the window is on this monitor to interact with.
fn rect_visible_on(geometry: WindowGeometry, monitor: Rect) -> bool {
    let (wx0, wy0, wx1, wy1) = (
        geometry.x,
        geometry.y,
        geometry.x + geometry.width,
        geometry.y + geometry.height,
    );
    let (mx0, my0, mx1, my1) = (
        monitor.x,
        monitor.y,
        monitor.x + monitor.w,
        monitor.y + monitor.h,
    );
    let overlap_w = (wx1.min(mx1) - wx0.max(mx0)).max(0.0);
    let overlap_h = (wy1.min(my1) - wy0.max(my0)).max(0.0);
    overlap_w >= VISIBLE_MARGIN && overlap_h >= VISIBLE_MARGIN
}

/// Clamp the window's top-left so the window sits inside `monitor` when it
/// fits, otherwise pins to the monitor's top-left.
fn clamp_point_into(geometry: WindowGeometry, monitor: Rect) -> (f64, f64) {
    let max_x = (monitor.x + monitor.w - geometry.width).max(monitor.x);
    let max_y = (monitor.y + monitor.h - geometry.height).max(monitor.y);
    let x = geometry.x.clamp(monitor.x, max_x);
    let y = geometry.y.clamp(monitor.y, max_y);
    (x, y)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn geo(x: f64, y: f64, w: f64, h: f64) -> WindowGeometry {
        WindowGeometry {
            width: w,
            height: h,
            x,
            y,
            maximized: false,
        }
    }

    const SCREEN: Rect = Rect {
        x: 0.0,
        y: 0.0,
        w: 1920.0,
        h: 1080.0,
    };

    #[test]
    fn fully_on_screen_is_visible() {
        assert!(rect_visible_on(geo(100.0, 100.0, 800.0, 600.0), SCREEN));
    }

    #[test]
    fn partly_on_screen_above_margin_is_visible() {
        // Window mostly off the right edge but 200px still showing.
        assert!(rect_visible_on(geo(1720.0, 100.0, 800.0, 600.0), SCREEN));
    }

    #[test]
    fn entirely_off_screen_is_not_visible() {
        assert!(!rect_visible_on(geo(3000.0, 100.0, 800.0, 600.0), SCREEN));
        assert!(!rect_visible_on(geo(-2000.0, 100.0, 800.0, 600.0), SCREEN));
    }

    #[test]
    fn sliver_below_margin_is_not_visible() {
        // Only ~30px of the window peeks onto the screen — below VISIBLE_MARGIN.
        assert!(!rect_visible_on(geo(1890.0, 100.0, 800.0, 600.0), SCREEN));
    }

    #[test]
    fn clamp_brings_offscreen_window_back_inside() {
        let (x, y) = clamp_point_into(geo(5000.0, 5000.0, 800.0, 600.0), SCREEN);
        assert_eq!(x, 1920.0 - 800.0);
        assert_eq!(y, 1080.0 - 600.0);
    }

    #[test]
    fn clamp_pins_oversized_window_to_origin() {
        // Window larger than the monitor pins to the top-left.
        let (x, y) = clamp_point_into(geo(-100.0, -100.0, 3000.0, 2000.0), SCREEN);
        assert_eq!(x, 0.0);
        assert_eq!(y, 0.0);
    }

    /// #234 — the rects fed to the clamp must be the monitor's WORK AREA, not
    /// its full bounds: re-homing pins the window to the rect's top-left, and
    /// the full bounds put that under the menu bar / taskbar.
    #[test]
    fn work_area_rect_excludes_the_menu_bar() {
        use tauri::{PhysicalPosition, PhysicalSize};
        // A 2× display whose top 50 physical px belong to the menu bar.
        let area = PhysicalRect {
            position: PhysicalPosition::new(0, 50),
            size: PhysicalSize::new(3840, 2110),
        };
        let rect = work_area_rect(&area, 2.0);
        assert_eq!(
            rect,
            Rect {
                x: 0.0,
                y: 25.0,
                w: 1920.0,
                h: 1055.0
            }
        );
        // …so a window saved on a now-disconnected display comes back BELOW it.
        let (x, y) = clamp_point_into(geo(-4000.0, -4000.0, 800.0, 600.0), rect);
        assert_eq!((x, y), (0.0, 25.0));

        // What the full monitor bounds (`position()`/`size()`) used to give:
        // the same window pinned at the physical top-left, title strip under the
        // menu bar.
        let full_bounds = Rect {
            x: 0.0,
            y: 0.0,
            w: 1920.0,
            h: 1080.0,
        };
        assert_eq!(
            clamp_point_into(geo(-4000.0, -4000.0, 800.0, 600.0), full_bounds),
            (0.0, 0.0)
        );
    }

    #[test]
    fn clamp_leaves_inside_window_untouched() {
        let (x, y) = clamp_point_into(geo(200.0, 150.0, 800.0, 600.0), SCREEN);
        assert_eq!(x, 200.0);
        assert_eq!(y, 150.0);
    }

    #[test]
    fn geometry_roundtrips_through_json() {
        let g = WindowGeometry {
            width: 1280.5,
            height: 800.0,
            x: 42.0,
            y: -10.0,
            maximized: true,
        };
        let json = serde_json::to_string(&g).unwrap();
        let back: WindowGeometry = serde_json::from_str(&json).unwrap();
        assert_eq!(g, back);
    }

    #[test]
    fn doc_roundtrips_and_is_keyed_by_label() {
        let mut doc = WindowStateDoc::default();
        doc.windows.insert("main".into(), geo(0.0, 0.0, 100.0, 100.0));
        let json = serde_json::to_string(&doc).unwrap();
        // `transparent` => the document is just the label→geometry map.
        assert!(json.contains("\"main\""));
        let back: WindowStateDoc = serde_json::from_str(&json).unwrap();
        assert_eq!(back.windows.get("main").copied(), Some(geo(0.0, 0.0, 100.0, 100.0)));
    }

    // ── Store: load / save / debounce / on-disk persistence ──────────────

    /// A unique temp path for a store file (no extra crates: use std + pid +
    /// a per-test counter so parallel tests never collide).
    fn temp_store_path(tag: &str) -> PathBuf {
        use std::sync::atomic::{AtomicU64, Ordering};
        static COUNTER: AtomicU64 = AtomicU64::new(0);
        let n = COUNTER.fetch_add(1, Ordering::Relaxed);
        let mut p = std::env::temp_dir();
        p.push(format!(
            "monet-window-state-test-{}-{tag}-{n}",
            std::process::id()
        ));
        // Use a subdir so we also exercise create_dir_all on the parent.
        p.push(STATE_FILE);
        p
    }

    #[test]
    fn store_save_then_get_roundtrips() {
        let path = temp_store_path("roundtrip");
        let store = WindowStateStore::load_from_path(path.clone());
        assert_eq!(store.get("main"), None);

        let g = geo(10.0, 20.0, 800.0, 600.0);
        store.save("main", g);
        assert_eq!(store.get("main"), Some(g));

        // A fresh store reading the same file must see the persisted geometry.
        let reloaded = WindowStateStore::load_from_path(path.clone());
        assert_eq!(reloaded.get("main"), Some(g));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn store_save_is_noop_when_unchanged() {
        let path = temp_store_path("noop");
        let store = WindowStateStore::load_from_path(path.clone());

        let g = geo(5.0, 5.0, 400.0, 300.0);
        store.save("main", g);
        let first = std::fs::metadata(&path)
            .expect("file written")
            .modified()
            .expect("mtime");

        // Saving the identical geometry must skip the disk write entirely.
        store.save("main", g);
        let second = std::fs::metadata(&path)
            .expect("file present")
            .modified()
            .expect("mtime");
        assert_eq!(first, second, "no-op save must not rewrite the file");

        // Saving a *changed* geometry must persist (and update the cache).
        let g2 = geo(6.0, 6.0, 400.0, 300.0);
        store.save("main", g2);
        assert_eq!(store.get("main"), Some(g2));

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn store_keeps_independent_entries_per_label() {
        let path = temp_store_path("multi");
        let store = WindowStateStore::load_from_path(path.clone());
        let a = geo(0.0, 0.0, 100.0, 100.0);
        let b = geo(200.0, 200.0, 300.0, 300.0);
        store.save("a", a);
        store.save("b", b);
        assert_eq!(store.get("a"), Some(a));
        assert_eq!(store.get("b"), Some(b));

        let reloaded = WindowStateStore::load_from_path(path.clone());
        assert_eq!(reloaded.get("a"), Some(a));
        assert_eq!(reloaded.get("b"), Some(b));

        let _ = std::fs::remove_file(&path);
    }

    /// Mirrors the maximize branch of `install_window_events::persist`: when a
    /// window is maximized we keep the prior *un-maximized* bounds and only flip
    /// the `maximized` flag, so a later un-maximize returns to those bounds.
    #[test]
    fn maximize_preserves_restore_bounds() {
        let path = temp_store_path("max");
        let store = WindowStateStore::load_from_path(path.clone());

        // 1. Window opens at restored bounds.
        let restored = geo(120.0, 80.0, 1024.0, 768.0);
        store.save("main", restored);

        // 2. User maximizes: keep the prior bounds, flip the flag (this is the
        //    exact transform `persist` applies for the maximized case).
        let mut prev = store.get("main").expect("entry exists");
        prev.maximized = true;
        store.save("main", prev);

        let saved = store.get("main").expect("entry exists");
        assert!(saved.maximized);
        // Restore-bounds (size + position) are preserved through maximize.
        assert_eq!(saved.width, restored.width);
        assert_eq!(saved.height, restored.height);
        assert_eq!(saved.x, restored.x);
        assert_eq!(saved.y, restored.y);

        let _ = std::fs::remove_file(&path);
    }

    #[test]
    fn load_from_missing_path_is_empty() {
        let path = temp_store_path("missing");
        // Never written, so loading must yield an empty doc, not an error.
        let store = WindowStateStore::load_from_path(path);
        assert_eq!(store.get("anything"), None);
    }
}
