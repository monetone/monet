//! Unit tests for the crate's pure helpers (no live Tauri app required).
//!
//! Kept in a dedicated file (declared from `lib.rs` as `#[cfg(test)] mod tests;`)
//! so `lib.rs` stays under the 1000-LOC house limit. `use super::*` resolves to
//! the crate root, so private items (`init_script`, `PlatformChrome::resolve`,
//! …) are reachable here.

use super::*;

// ── Accent resolution ────────────────────────────────────────────────────

#[test]
fn accent_css_var_matches_tokens() {
    assert_eq!(Accent::Raster.css_var(), "--accent-raster");
    assert_eq!(Accent::Vector.css_var(), "--accent-vector");
    assert_eq!(Accent::Audio.css_var(), "--accent-audio");
    assert_eq!(Accent::Motion.css_var(), "--accent-motion");
}

#[test]
fn accent_css_ref_wraps_var() {
    assert_eq!(Accent::Raster.css_ref(), "var(--accent-raster)");
    assert_eq!(Accent::Motion.css_ref(), "var(--accent-motion)");
}

#[test]
fn accent_value_is_oklch() {
    assert_eq!(Accent::Raster.value(), "oklch(0.78 0.14 200)");
    assert_eq!(Accent::Vector.value(), "oklch(0.80 0.14 70)");
    assert_eq!(Accent::Audio.value(), "oklch(0.74 0.16 305)");
    assert_eq!(Accent::Motion.value(), "oklch(0.75 0.18 350)");
}

#[test]
fn accent_as_str_is_lowercase_token() {
    assert_eq!(Accent::Raster.as_str(), "raster");
    assert_eq!(Accent::Vector.as_str(), "vector");
    assert_eq!(Accent::Audio.as_str(), "audio");
    assert_eq!(Accent::Motion.as_str(), "motion");
}

#[test]
fn accent_serializes_lowercase() {
    assert_eq!(serde_json::to_string(&Accent::Raster).unwrap(), "\"raster\"");
    assert_eq!(serde_json::to_string(&Accent::Motion).unwrap(), "\"motion\"");
}

// ── Platform chrome resolution ───────────────────────────────────────────

#[test]
fn platform_chrome_default_is_auto() {
    assert_eq!(PlatformChrome::default(), PlatformChrome::Auto);
}

#[test]
fn platform_chrome_explicit_resolves_directly() {
    assert_eq!(PlatformChrome::Mac.resolve(), Platform::Mac);
    assert_eq!(PlatformChrome::Win.resolve(), Platform::Win);
}

#[test]
fn platform_chrome_auto_follows_target_os() {
    let resolved = PlatformChrome::Auto.resolve();
    #[cfg(target_os = "macos")]
    assert_eq!(resolved, Platform::Mac);
    #[cfg(not(target_os = "macos"))]
    assert_eq!(resolved, Platform::Win);
}

#[test]
fn platform_serializes_lowercase() {
    assert_eq!(serde_json::to_string(&Platform::Mac).unwrap(), "\"mac\"");
    assert_eq!(serde_json::to_string(&Platform::Win).unwrap(), "\"win\"");
}

// ── Default-menu id constants ────────────────────────────────────────────

#[test]
fn menu_id_constants_are_stable() {
    // These are the contract the frontend matches against; freeze them.
    assert_eq!(menu_ids::PREFERENCES, "monet:preferences");
    assert_eq!(menu_ids::ABOUT, "monet:about");
}

#[test]
fn bridge_event_names_are_stable() {
    assert_eq!(MENU_EVENT, "monet://menu");
    assert_eq!(WINDOW_EVENT, "monet://window");
}

// ── Config payload serde ─────────────────────────────────────────────────

fn sample_config() -> MonetConfig {
    let vib = Vibrancy::default();
    MonetConfig {
        platform: Platform::Mac,
        accent: Accent::Audio,
        accent_var: Accent::Audio.css_ref(),
        accent_value: Accent::Audio.value().to_string(),
        vibrancy: true,
        appearance: vib.appearance_value(),
        solid_color: vib.solid_color_css(),
        native_popups: true,
    }
}

#[test]
fn config_serializes_camel_case_keys() {
    let json = serde_json::to_string(&sample_config()).unwrap();
    // camelCase wire form the init script + `monet_config` rely on.
    assert!(json.contains("\"platform\":\"mac\""), "got {json}");
    assert!(json.contains("\"accent\":\"audio\""), "got {json}");
    assert!(json.contains("\"accentVar\":\"var(--accent-audio)\""), "got {json}");
    assert!(json.contains("\"accentValue\":"), "got {json}");
    assert!(json.contains("\"vibrancy\":true"), "got {json}");
    assert!(json.contains("\"appearance\":\"dark\""), "got {json}");
    assert!(json.contains("\"solidColor\":"), "got {json}");
    // snake_case keys must NOT leak through.
    assert!(!json.contains("accent_var"), "got {json}");
    assert!(!json.contains("solid_color"), "got {json}");
}

#[test]
fn menu_command_payload_serializes_id() {
    let json = serde_json::to_string(&MenuCommandPayload {
        id: menu_ids::PREFERENCES.to_string(),
    })
    .unwrap();
    assert_eq!(json, "{\"id\":\"monet:preferences\"}");
}

#[test]
fn window_event_payload_is_tagged() {
    // The frontend switches on the `type` discriminator.
    assert_eq!(
        serde_json::to_string(&WindowEventPayload::Focused { focused: true }).unwrap(),
        "{\"type\":\"focused\",\"focused\":true}"
    );
    assert_eq!(
        serde_json::to_string(&WindowEventPayload::Maximized { maximized: false }).unwrap(),
        "{\"type\":\"maximized\",\"maximized\":false}"
    );
    assert_eq!(
        serde_json::to_string(&WindowEventPayload::CloseRequested).unwrap(),
        "{\"type\":\"closeRequested\"}"
    );
}

#[test]
fn init_script_embeds_config_and_sets_accent() {
    let script = init_script(&sample_config());
    assert!(script.contains("window.__MONET__"));
    assert!(script.contains("data-monet-tauri"));
    assert!(script.contains("var(--accent-audio)"));
    // Vibrancy on => no solid-background opt-in attribute literal.
    assert!(script.contains("data-monet-appearance"));
}

/// #233 — when a requested material fails to apply, the fallback must patch the
/// ALREADY-INJECTED config, not just the attribute: monet-react's chrome reads
/// `window.__MONET__` and its first effect strips `data-monet-solid` whenever
/// `cfg.vibrancy` is true, undoing a bare `setAttribute`.
#[test]
fn vibrancy_failure_patches_the_injected_config_not_only_the_attribute() {
    assert!(VIBRANCY_FAILED_SCRIPT.contains("window.__MONET__.vibrancy = false"));
    assert!(VIBRANCY_FAILED_SCRIPT.contains("setAttribute('data-monet-solid','')"));
    // The injected object may be absent (a window built without the builder).
    assert!(VIBRANCY_FAILED_SCRIPT.contains("if (window.__MONET__)"));
}

#[test]
fn init_script_marks_solid_when_vibrancy_off() {
    let mut cfg = sample_config();
    cfg.vibrancy = false;
    let script = init_script(&cfg);
    assert!(script.contains("data-monet-solid"));
    assert!(script.contains("--monet-solid-bg"));
}

// ── Dialog plugin ────────────────────────────────────────────────────────

#[test]
fn dialog_plugin_constructs_with_expected_name() {
    use tauri::plugin::Plugin;
    // Constructing the plugin must succeed and carry the official plugin name,
    // which the `"dialog:default"` capability scopes its commands under.
    let plugin = dialog_plugin::<tauri::Wry>();
    assert_eq!(Plugin::name(&plugin), "dialog");
}

// ── Native popup windows ─────────────────────────────────────────────────

#[test]
fn popup_label_accepts_only_monet_popup_blanks() {
    let label = |u: &str| popup::popup_label(&tauri::Url::parse(u).unwrap());
    assert_eq!(
        label("about:blank#monet-popup-ab12-3").as_deref(),
        Some("monet-popup-ab12-3")
    );
    // WebKit percent-encodes the `#` when it reports the request.
    assert_eq!(
        label("about:blank%23monet-popup-ab12-3").as_deref(),
        Some("monet-popup-ab12-3")
    );
    assert_eq!(label("about:blank"), None);
    assert_eq!(label("about:blank#other"), None);
    assert_eq!(label("about:blank#monet-popup-"), None);
    assert_eq!(label("about:blank#monet-popup-a/b"), None);
    assert_eq!(label("https://example.com/#monet-popup-1"), None);
}

fn rect(x: f64, y: f64, width: f64, height: f64) -> PopupRect {
    PopupRect {
        x,
        y,
        width,
        height,
    }
}

#[test]
fn popup_opens_below_its_anchor_past_the_window_when_the_screen_has_room() {
    // Anchor near the bottom of a small window; the screen extends well below it.
    let area = rect(0.0, 30.0, 1742.0, 1269.0);
    let (x, y, side) = popup::compute(
        rect(1100.0, 690.0, 90.0, 22.0),
        120.0,
        200.0,
        "bottom",
        "start",
        4.0,
        area,
    );
    assert_eq!((x, y, side.as_str()), (1100.0, 716.0, "bottom"));
}

#[test]
fn popup_flips_and_shifts_inside_the_work_area() {
    let area = rect(0.0, 30.0, 1742.0, 1269.0);
    // No room below the anchor: it flips above.
    let (_, y, side) = popup::compute(
        rect(100.0, 1200.0, 90.0, 22.0),
        120.0,
        200.0,
        "bottom",
        "start",
        4.0,
        area,
    );
    assert_eq!((y, side.as_str()), (996.0, "top"));
    // Past the right edge: shifted back inside.
    let (x, _, _) = popup::compute(
        rect(1700.0, 400.0, 30.0, 22.0),
        120.0,
        100.0,
        "bottom",
        "start",
        4.0,
        area,
    );
    assert_eq!(x, 1622.0);
    // A submenu with no room on the right opens to the left.
    let (x, _, side) = popup::compute(
        rect(1600.0, 400.0, 120.0, 26.0),
        200.0,
        100.0,
        "right",
        "start",
        2.0,
        area,
    );
    assert_eq!((x, side.as_str()), (1398.0, "left"));
}
