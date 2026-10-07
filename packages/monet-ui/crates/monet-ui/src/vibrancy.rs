//! Configurable native vibrancy for Monet windows.
//!
//! The window itself is transparent + decorationless; *vibrancy* is the native
//! blur material the OS composites behind it (macOS `NSVisualEffectView`,
//! Windows acrylic). Wave 1 hard-coded these (macOS `HudWindow`, Windows acrylic
//! tinted `#0b0e14`); this module makes them configurable while keeping those
//! exact defaults so existing examples look identical.
//!
//! Use [`Vibrancy`] on [`crate::MonetWindowBuilder::vibrancy`]:
//!
//! ```no_run
//! use monet_ui::{Vibrancy, VibrancyMaterial, VibrancyAppearance};
//!
//! // Match a light theme with the sidebar material:
//! let v = Vibrancy::material(VibrancyMaterial::Sidebar)
//!     .appearance(VibrancyAppearance::Light);
//!
//! // Or turn vibrancy off and use a solid background instead:
//! let off = Vibrancy::solid((11, 14, 20, 255));
//! ```

use serde::Serialize;

#[cfg(target_os = "macos")]
use window_vibrancy::{NSVisualEffectMaterial, NSVisualEffectState};

// ─────────────────────────────────────────────────────────────
// Material
// ─────────────────────────────────────────────────────────────

/// The macOS `NSVisualEffectView` material applied behind the window.
///
/// Maps 1:1 onto the semantic (non-deprecated) `NSVisualEffectMaterial`
/// variants. On Windows/Linux this is ignored — those platforms use acrylic /
/// a solid background respectively — but the value is still recorded so the
/// frontend can read it back if it wants to mirror the look.
///
/// The default is [`VibrancyMaterial::HudWindow`], matching Wave 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum VibrancyMaterial {
    /// Title-bar material (`Titlebar`).
    Titlebar,
    /// Selection material (`Selection`).
    Selection,
    /// Menu material (`Menu`).
    Menu,
    /// Popover material (`Popover`).
    Popover,
    /// Sidebar material — translucent, reads well under a light theme.
    Sidebar,
    /// Header-view material (`HeaderView`).
    HeaderView,
    /// Sheet material (`Sheet`).
    Sheet,
    /// Opaque-ish window background material (`WindowBackground`).
    WindowBackground,
    /// HUD-window material — a dark, lightly-tinted glass. **Default.**
    HudWindow,
    /// Full-screen UI material (`FullScreenUI`).
    FullScreenUI,
    /// Tooltip material (`Tooltip`).
    Tooltip,
    /// Content-background material (`ContentBackground`).
    ContentBackground,
    /// Material drawn *under* the window background (`UnderWindowBackground`).
    UnderWindowBackground,
    /// Material drawn *under* page content (`UnderPageBackground`).
    UnderPageBackground,
}

impl Default for VibrancyMaterial {
    fn default() -> Self {
        VibrancyMaterial::HudWindow
    }
}

impl VibrancyMaterial {
    /// Map to the `window-vibrancy` enum. macOS only.
    #[cfg(target_os = "macos")]
    pub(crate) fn to_ns(self) -> NSVisualEffectMaterial {
        match self {
            VibrancyMaterial::Titlebar => NSVisualEffectMaterial::Titlebar,
            VibrancyMaterial::Selection => NSVisualEffectMaterial::Selection,
            VibrancyMaterial::Menu => NSVisualEffectMaterial::Menu,
            VibrancyMaterial::Popover => NSVisualEffectMaterial::Popover,
            VibrancyMaterial::Sidebar => NSVisualEffectMaterial::Sidebar,
            VibrancyMaterial::HeaderView => NSVisualEffectMaterial::HeaderView,
            VibrancyMaterial::Sheet => NSVisualEffectMaterial::Sheet,
            VibrancyMaterial::WindowBackground => NSVisualEffectMaterial::WindowBackground,
            VibrancyMaterial::HudWindow => NSVisualEffectMaterial::HudWindow,
            VibrancyMaterial::FullScreenUI => NSVisualEffectMaterial::FullScreenUI,
            VibrancyMaterial::Tooltip => NSVisualEffectMaterial::Tooltip,
            VibrancyMaterial::ContentBackground => NSVisualEffectMaterial::ContentBackground,
            VibrancyMaterial::UnderWindowBackground => {
                NSVisualEffectMaterial::UnderWindowBackground
            }
            VibrancyMaterial::UnderPageBackground => NSVisualEffectMaterial::UnderPageBackground,
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Appearance
// ─────────────────────────────────────────────────────────────

/// The colour scheme the vibrancy material should adopt.
///
/// macOS picks the light/dark tint of the material from the view's
/// `effectiveAppearance`; selecting [`VibrancyAppearance::Light`] lets a Monet
/// window match a light theme. The frontend reads the resolved value back (see
/// [`crate::MonetConfig::appearance`]) so the webview chrome can switch tokens
/// to match. The default is [`VibrancyAppearance::Dark`], matching Wave 1.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum VibrancyAppearance {
    /// Follow the OS / system appearance.
    Auto,
    /// Force a light appearance.
    Light,
    /// Force a dark appearance.
    Dark,
}

impl Default for VibrancyAppearance {
    fn default() -> Self {
        VibrancyAppearance::Dark
    }
}

// ─────────────────────────────────────────────────────────────
// Vibrancy config
// ─────────────────────────────────────────────────────────────

/// An RGBA tint, 0–255 per channel. Used for the Windows acrylic tint and the
/// solid-background fallback colour.
pub type Rgba = (u8, u8, u8, u8);

/// Wave-1 Windows acrylic tint: the deepest desktop tone (`#0b0e14`) at ~70%.
pub(crate) const DEFAULT_ACRYLIC_TINT: Rgba = (11, 14, 20, 180);
/// Wave-1 macOS vibrancy corner radius.
pub(crate) const DEFAULT_MACOS_RADIUS: f64 = 14.0;
/// Solid-background fallback colour when vibrancy is disabled (`#0b0e14`).
pub(crate) const DEFAULT_SOLID_COLOR: Rgba = (11, 14, 20, 255);

/// How a Monet window is backed: a native vibrancy material, or a solid colour.
///
/// Construct with [`Vibrancy::material`] / [`Vibrancy::solid`] /
/// [`Vibrancy::default`] and refine with the builder-style setters. Defaults
/// reproduce Wave 1 exactly (macOS `HudWindow` @ radius 14, dark appearance;
/// Windows acrylic tinted `#0b0e14`).
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Vibrancy {
    /// Whether a native material should be applied at all. `false` = solid.
    pub(crate) enabled: bool,
    /// macOS material to use when `enabled`.
    pub(crate) material: VibrancyMaterial,
    /// Light/dark/auto appearance for the material (and reported to the FE).
    pub(crate) appearance: VibrancyAppearance,
    /// macOS corner radius for the effect view.
    pub(crate) macos_radius: Option<f64>,
    /// Windows acrylic tint (RGBA).
    pub(crate) acrylic_tint: Rgba,
    /// Solid background colour used when `!enabled` (or on the Linux fallback).
    pub(crate) solid_color: Rgba,
}

impl Default for Vibrancy {
    fn default() -> Self {
        Vibrancy {
            enabled: true,
            material: VibrancyMaterial::default(),
            appearance: VibrancyAppearance::default(),
            macos_radius: Some(DEFAULT_MACOS_RADIUS),
            acrylic_tint: DEFAULT_ACRYLIC_TINT,
            solid_color: DEFAULT_SOLID_COLOR,
        }
    }
}

impl Vibrancy {
    /// Enabled vibrancy with the given macOS [`VibrancyMaterial`]; all other
    /// fields keep their defaults.
    pub fn material(material: VibrancyMaterial) -> Self {
        Vibrancy {
            material,
            ..Vibrancy::default()
        }
    }

    /// Disable vibrancy: the window is painted with a solid `color` instead.
    /// This is also the recommended setting for Linux / opt-out paths. The
    /// frontend is signalled to drop its translucent background.
    pub fn solid(color: Rgba) -> Self {
        Vibrancy {
            enabled: false,
            solid_color: color,
            ..Vibrancy::default()
        }
    }

    /// Set the light/dark/auto appearance the material adopts (and that the
    /// frontend reads back to match its theme).
    pub fn appearance(mut self, appearance: VibrancyAppearance) -> Self {
        self.appearance = appearance;
        self
    }

    /// Set the macOS effect-view corner radius. `None` leaves it square.
    pub fn macos_radius(mut self, radius: Option<f64>) -> Self {
        self.macos_radius = radius;
        self
    }

    /// Set the Windows acrylic tint colour (RGBA, 0–255).
    pub fn acrylic_tint(mut self, tint: Rgba) -> Self {
        self.acrylic_tint = tint;
        self
    }

    /// Set the solid fallback colour used when vibrancy is disabled.
    pub fn solid_color(mut self, color: Rgba) -> Self {
        self.solid_color = color;
        self
    }

    /// Whether a native material would be requested (before the apply attempt).
    pub fn is_enabled(self) -> bool {
        self.enabled
    }

    /// The appearance, for reporting to the frontend.
    pub fn appearance_value(self) -> VibrancyAppearance {
        self.appearance
    }

    /// Format the solid fallback colour as an `rgba(r, g, b, a)` CSS string,
    /// alpha normalised to 0–1. Handed to the frontend so it can paint the
    /// matching opaque background when vibrancy is off.
    pub fn solid_color_css(self) -> String {
        let (r, g, b, a) = self.solid_color;
        format!("rgba({}, {}, {}, {})", r, g, b, (a as f64) / 255.0)
    }

    /// Apply this vibrancy to a freshly-built window. Returns `true` when a
    /// native material was actually applied (always `false` when disabled, or
    /// on a platform without a material).
    pub(crate) fn apply<R: tauri::Runtime>(self, window: &tauri::WebviewWindow<R>) -> bool {
        if !self.enabled {
            return false;
        }
        #[cfg(target_os = "macos")]
        {
            use window_vibrancy::apply_vibrancy;
            let state = match self.appearance {
                // A forced appearance reads best as an always-active effect;
                // Auto follows the window's active state like AppKit defaults.
                VibrancyAppearance::Auto => NSVisualEffectState::FollowsWindowActiveState,
                _ => NSVisualEffectState::Active,
            };
            return apply_vibrancy(window, self.material.to_ns(), Some(state), self.macos_radius)
                .is_ok();
        }
        #[cfg(target_os = "windows")]
        {
            use window_vibrancy::apply_acrylic;
            return apply_acrylic(window, Some(self.acrylic_tint)).is_ok();
        }
        #[cfg(not(any(target_os = "macos", target_os = "windows")))]
        {
            let _ = window;
            false
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_wave1() {
        let v = Vibrancy::default();
        assert!(v.is_enabled());
        assert_eq!(v.material, VibrancyMaterial::HudWindow);
        assert_eq!(v.appearance, VibrancyAppearance::Dark);
        assert_eq!(v.macos_radius, Some(DEFAULT_MACOS_RADIUS));
        assert_eq!(v.acrylic_tint, DEFAULT_ACRYLIC_TINT);
    }

    #[test]
    fn solid_disables_and_sets_color() {
        let v = Vibrancy::solid((20, 30, 40, 255));
        assert!(!v.is_enabled());
        assert_eq!(v.solid_color, (20, 30, 40, 255));
    }

    #[test]
    fn builder_setters_compose() {
        let v = Vibrancy::material(VibrancyMaterial::Sidebar)
            .appearance(VibrancyAppearance::Light)
            .macos_radius(None)
            .acrylic_tint((1, 2, 3, 4));
        assert!(v.is_enabled());
        assert_eq!(v.material, VibrancyMaterial::Sidebar);
        assert_eq!(v.appearance_value(), VibrancyAppearance::Light);
        assert_eq!(v.macos_radius, None);
        assert_eq!(v.acrylic_tint, (1, 2, 3, 4));
    }

    #[test]
    fn solid_color_css_normalizes_alpha() {
        assert_eq!(
            Vibrancy::default().solid_color_css(),
            "rgba(11, 14, 20, 1)"
        );
        assert_eq!(
            Vibrancy::solid((255, 0, 0, 0)).solid_color_css(),
            "rgba(255, 0, 0, 0)"
        );
        // 128/255 ≈ 0.50196…
        let css = Vibrancy::solid((0, 0, 0, 128)).solid_color_css();
        assert!(css.starts_with("rgba(0, 0, 0, 0.50"), "got {css}");
    }

    #[test]
    fn appearance_serializes_lowercase() {
        assert_eq!(
            serde_json::to_string(&VibrancyAppearance::Light).unwrap(),
            "\"light\""
        );
        assert_eq!(
            serde_json::to_string(&VibrancyAppearance::Auto).unwrap(),
            "\"auto\""
        );
    }

    #[test]
    fn material_default_is_hud_window() {
        assert_eq!(VibrancyMaterial::default(), VibrancyMaterial::HudWindow);
    }

    #[test]
    fn appearance_default_is_dark() {
        assert_eq!(VibrancyAppearance::default(), VibrancyAppearance::Dark);
    }

    #[test]
    fn material_serializes_camel_case() {
        // The frontend reads the material back, so the JSON wire form matters.
        assert_eq!(
            serde_json::to_string(&VibrancyMaterial::HudWindow).unwrap(),
            "\"hudWindow\""
        );
        assert_eq!(
            serde_json::to_string(&VibrancyMaterial::UnderWindowBackground).unwrap(),
            "\"underWindowBackground\""
        );
        assert_eq!(
            serde_json::to_string(&VibrancyMaterial::Sidebar).unwrap(),
            "\"sidebar\""
        );
    }

    #[test]
    fn solid_keeps_material_default_but_disabled() {
        // `solid` flips `enabled` off but leaves the material at its default,
        // so the FE still gets a sensible value to mirror if it wants to.
        let v = Vibrancy::solid((1, 2, 3, 4));
        assert!(!v.is_enabled());
        assert_eq!(v.material, VibrancyMaterial::default());
        assert_eq!(v.solid_color, (1, 2, 3, 4));
    }

    /// Every [`VibrancyMaterial`] maps onto its 1:1 `NSVisualEffectMaterial`
    /// counterpart. macOS-only (the mapping helper is gated to macOS); runs on a
    /// dev mac and the optional macOS CI job.
    #[cfg(target_os = "macos")]
    #[test]
    fn material_maps_one_to_one_to_ns() {
        use window_vibrancy::NSVisualEffectMaterial as M;
        let pairs = [
            (VibrancyMaterial::Titlebar, M::Titlebar),
            (VibrancyMaterial::Selection, M::Selection),
            (VibrancyMaterial::Menu, M::Menu),
            (VibrancyMaterial::Popover, M::Popover),
            (VibrancyMaterial::Sidebar, M::Sidebar),
            (VibrancyMaterial::HeaderView, M::HeaderView),
            (VibrancyMaterial::Sheet, M::Sheet),
            (VibrancyMaterial::WindowBackground, M::WindowBackground),
            (VibrancyMaterial::HudWindow, M::HudWindow),
            (VibrancyMaterial::FullScreenUI, M::FullScreenUI),
            (VibrancyMaterial::Tooltip, M::Tooltip),
            (VibrancyMaterial::ContentBackground, M::ContentBackground),
            (
                VibrancyMaterial::UnderWindowBackground,
                M::UnderWindowBackground,
            ),
            (VibrancyMaterial::UnderPageBackground, M::UnderPageBackground),
        ];
        for (mat, ns) in pairs {
            assert_eq!(mat.to_ns(), ns, "mismatch for {mat:?}");
        }
    }
}
