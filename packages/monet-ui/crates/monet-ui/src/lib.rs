//! # monet-ui · Monet for Tauri 2
//!
//! Native integration for the **Monet** liquid-glass panel design system.
//! The chrome itself is drawn in the webview (see the `@monet-ui/monet-react`
//! package); this crate makes the *window* behave like real liquid glass:
//!
//! * a transparent window with custom webview chrome by default, with native OS
//!   decorations available for apps that do not want simulated window controls;
//! * a native vibrancy material behind it — macOS `NSVisualEffectView`,
//!   Windows acrylic — via the [`window-vibrancy`] crate (Linux falls back to a
//!   solid background, signalled to the frontend);
//! * the per-app **accent** injected into the page as a CSS variable;
//! * window-control commands (`close` / `minimize` / `toggle_maximize`) the
//!   custom title-bar buttons call, plus a `monet_config` command the
//!   frontend reads to know which platform chrome and accent to render.
//!
//! ```rust,no_run
//! fn configured_builder() -> tauri::Builder<tauri::Wry> {
//!     tauri::Builder::<tauri::Wry>::default()
//!         .invoke_handler(monet_ui::invoke_handler())
//!         .setup(|app| {
//!             monet_ui::MonetWindow::builder(app.handle(), "main", tauri::WebviewUrl::default())
//!                 .title("Raster")
//!                 .accent(monet_ui::Accent::Raster)
//!                 .inner_size(1440.0, 900.0)
//!                 .build()?;
//!             Ok(())
//!         })
//! }
//! ```
//!
//! [`window-vibrancy`]: https://docs.rs/window-vibrancy

use std::collections::HashMap;
use std::marker::PhantomData;
use std::sync::{Arc, Mutex};

use serde::Serialize;
use tauri::{
    Emitter, Manager, Runtime, State, WebviewUrl, WebviewWindow, WebviewWindowBuilder, WindowEvent,
};

#[cfg(desktop)]
use tauri::menu::{AboutMetadataBuilder, Menu, MenuBuilder, SubmenuBuilder};

mod atomic_save;
mod dialog;
mod popup;
pub mod quit_guard;
mod vibrancy;
mod window_state;

pub use atomic_save::atomic_save_plugin;
pub use dialog::dialog_plugin;
pub use popup::{is_popup_label, PopupPlacement, PopupRect};
pub use quit_guard::install as install_quit_guard;
pub use vibrancy::{Rgba, Vibrancy, VibrancyAppearance, VibrancyMaterial};
pub use window_state::{WindowGeometry, WindowStateDoc};

/// Re-export of the official [`tauri-plugin-dialog`] crate for advanced use
/// (custom dialog builders, direct API access). Most apps only need
/// [`dialog_plugin`] on the builder plus the `"dialog:default"` capability.
///
/// [`tauri-plugin-dialog`]: https://docs.rs/tauri-plugin-dialog
pub use tauri_plugin_dialog;

use window_state::WindowStateStore;

// ─────────────────────────────────────────────────────────────
// Accent — the four per-app identities (mirrors monet-core)
// ─────────────────────────────────────────────────────────────

/// A per-app accent. The chrome stays neutral; the accent only ever tints
/// highlights (active indicators, sliders, focus rings, snap zones).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    /// Photo editing · cyan.
    Raster,
    /// Illustration · amber.
    Vector,
    /// Multitrack audio · violet.
    Audio,
    /// Video editing · magenta.
    Motion,
}

impl Accent {
    /// The CSS custom property holding this accent, e.g. `--accent-raster`.
    pub const fn css_var(self) -> &'static str {
        match self {
            Accent::Raster => "--accent-raster",
            Accent::Vector => "--accent-vector",
            Accent::Audio => "--accent-audio",
            Accent::Motion => "--accent-motion",
        }
    }

    /// A `var(--accent-…)` reference suitable for the `--accent` property.
    pub fn css_ref(self) -> String {
        format!("var({})", self.css_var())
    }

    /// The literal `oklch(…)` value, matching `tokens.css`.
    pub const fn value(self) -> &'static str {
        match self {
            Accent::Raster => "oklch(0.78 0.14 200)",
            Accent::Vector => "oklch(0.80 0.14 70)",
            Accent::Audio => "oklch(0.74 0.16 305)",
            Accent::Motion => "oklch(0.75 0.18 350)",
        }
    }

    /// Short lowercase token, e.g. `"raster"`.
    pub const fn as_str(self) -> &'static str {
        match self {
            Accent::Raster => "raster",
            Accent::Vector => "vector",
            Accent::Audio => "audio",
            Accent::Motion => "motion",
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Platform chrome
// ─────────────────────────────────────────────────────────────

/// Which platform chrome Monet should draw in the webview.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlatformChrome {
    /// macOS chrome on macOS, Windows-style chrome everywhere else.
    Auto,
    /// Always draw macOS chrome (traffic lights, app pill).
    Mac,
    /// Always draw Windows chrome (app icon, min/max/close, in-window menus).
    Win,
}

impl Default for PlatformChrome {
    fn default() -> Self {
        PlatformChrome::Auto
    }
}

/// The resolved chrome variant the frontend should render.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Platform {
    Mac,
    Win,
}

impl PlatformChrome {
    fn resolve(self) -> Platform {
        match self {
            PlatformChrome::Mac => Platform::Mac,
            PlatformChrome::Win => Platform::Win,
            PlatformChrome::Auto => {
                if cfg!(target_os = "macos") {
                    Platform::Mac
                } else {
                    Platform::Win
                }
            }
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Config shared with the frontend
// ─────────────────────────────────────────────────────────────

/// The per-window Monet configuration handed to the webview. Injected as
/// `window.__MONET__` before page load and also returned by the
/// `monet_config` command.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MonetConfig {
    /// Chrome variant to draw (`"mac"` or `"win"`).
    pub platform: Platform,
    /// Accent token (`"raster"` | `"vector"` | `"audio"` | `"motion"`).
    pub accent: Accent,
    /// `var(--accent-…)` reference for the accent.
    pub accent_var: String,
    /// Literal `oklch(…)` value for the accent.
    pub accent_value: String,
    /// Whether a native vibrancy material was applied behind the window. When
    /// `false` the frontend opts into a solid window background.
    pub vibrancy: bool,
    /// The light/dark/auto appearance the vibrancy material adopts. The chrome
    /// reads this to match its theme tokens to the native material.
    pub appearance: VibrancyAppearance,
    /// CSS `rgba(…)` background the frontend should paint when `vibrancy` is
    /// `false` (the solid / Linux fallback colour).
    pub solid_color: String,
    /// Whether dropdown lists and menus may open in native popup windows
    /// (popup.rs): only windows built here, on macOS, have the hook for them.
    pub native_popups: bool,
}

/// Internal state: the resolved config per window label.
#[derive(Default)]
pub(crate) struct MonetState(Mutex<HashMap<String, MonetConfig>>);

/// Marker state proving the global menu-event listener has been installed
/// exactly once for this app (it forwards events for *all* windows, so it must
/// not be re-registered per [`MonetWindowBuilder::build`]).
#[derive(Default)]
pub(crate) struct MonetMenuForwarder;

// ─────────────────────────────────────────────────────────────
// Frontend bridge event names
// ─────────────────────────────────────────────────────────────

/// Tauri event carrying native-menu activations to the webview. Payload:
/// [`MenuCommandPayload`] (`{ "id": "<menu-item-id>" }`). The frontend chrome
/// subscribes via `@tauri-apps/api/event`'s `listen` (see `chrome.tsx`).
pub const MENU_EVENT: &str = "monet://menu";

/// Tauri event carrying native window-state changes to the webview. Payload:
/// [`WindowEventPayload`] (`{ "type": "focused" | "maximized" | "closeRequested", ... }`).
pub const WINDOW_EVENT: &str = "monet://window";

/// Payload emitted on [`MENU_EVENT`]: the activated menu item's id.
#[derive(Debug, Clone, Serialize)]
pub struct MenuCommandPayload {
    /// The menu item id (matches the ids minted by [`menu_ids`] for the default
    /// menu, or whatever a [`MenuMode::Custom`] menu assigned).
    pub id: String,
}

/// Payload emitted on [`WINDOW_EVENT`]. `type` is the discriminator the
/// frontend switches on; the remaining field is populated per variant.
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum WindowEventPayload {
    /// The window gained or lost key focus. Drives dim-on-blur in the chrome.
    Focused {
        /// `true` when the window gained focus.
        focused: bool,
    },
    /// The window's maximized state changed (derived from `Resized`).
    Maximized {
        /// `true` when the window is now maximized.
        maximized: bool,
    },
    /// The OS asked the window to close. Monet **allows** the close by default
    /// (it never calls `prevent_close`); this event is purely advisory so the
    /// frontend chrome can later intercept for unsaved-changes prompts. See the
    /// contract on [`install_window_events`].
    CloseRequested,
}

/// The well-known menu item ids the default menu emits on [`MENU_EVENT`].
/// Exposed so the frontend (and tests) can match against stable strings.
pub mod menu_ids {
    /// Open application preferences. (App / About submenu.)
    pub const PREFERENCES: &str = "monet:preferences";
    /// Quit the application. Wired to the predefined Quit item; this id is the
    /// custom "About <app>" alias only — Quit/Undo/etc. use native predefined
    /// items and are handled by the OS, not forwarded.
    pub const ABOUT: &str = "monet:about";
}

// ─────────────────────────────────────────────────────────────
// Menu mode
// ─────────────────────────────────────────────────────────────

/// How a Monet window populates the native application menu.
///
/// On **macOS** this is the global menu bar at the top of the screen; on
/// **Windows/Linux** the in-webview chrome draws its own menus, so the native
/// menu is mostly invisible — [`MenuMode::Default`] is still safe there (the
/// predefined accelerators just work) and never conflicts with the webview UI.
///
/// Defaults to [`MenuMode::Default`].
#[cfg(desktop)]
pub enum MenuMode<R: Runtime> {
    /// Build and attach Monet's sensible default menu (App/File/Edit/View/Window).
    Default,
    /// Attach no menu at all (the webview chrome is fully responsible).
    None,
    /// Attach a caller-supplied [`Menu`]. The menu-event forwarder still emits
    /// [`MENU_EVENT`] for any non-predefined item the user adds.
    Custom(Menu<R>),
}

#[cfg(desktop)]
impl<R: Runtime> Default for MenuMode<R> {
    fn default() -> Self {
        MenuMode::Default
    }
}

#[cfg(desktop)]
impl<R: Runtime> core::fmt::Debug for MenuMode<R> {
    fn fmt(&self, f: &mut core::fmt::Formatter<'_>) -> core::fmt::Result {
        match self {
            MenuMode::Default => f.write_str("MenuMode::Default"),
            MenuMode::None => f.write_str("MenuMode::None"),
            MenuMode::Custom(_) => f.write_str("MenuMode::Custom(..)"),
        }
    }
}

// ─────────────────────────────────────────────────────────────
// Window builder
// ─────────────────────────────────────────────────────────────

/// Entry point for building a Monet-styled Tauri window.
pub struct MonetWindow;

impl MonetWindow {
    /// Start building a transparent, vibrancy-backed window with custom Monet
    /// chrome. `manager` is any [`Manager`] (typically `app.handle()`).
    pub fn builder<'a, R, M>(
        manager: &'a M,
        label: impl Into<String>,
        url: WebviewUrl,
    ) -> MonetWindowBuilder<'a, R, M>
    where
        R: Runtime,
        M: Manager<R>,
    {
        MonetWindowBuilder {
            manager,
            label: label.into(),
            url,
            title: None,
            app_name: None,
            accent: Accent::Raster,
            chrome: PlatformChrome::Auto,
            width: 1280.0,
            height: 800.0,
            min_width: Some(640.0),
            min_height: Some(420.0),
            resizable: true,
            decorations: false,
            maximized: false,
            vibrancy: Vibrancy::default(),
            remember_state: true,
            visible: true,
            #[cfg(desktop)]
            menu: MenuMode::Default,
            _r: PhantomData,
        }
    }
}

/// Fluent builder produced by [`MonetWindow::builder`].
pub struct MonetWindowBuilder<'a, R: Runtime, M: Manager<R>> {
    manager: &'a M,
    label: String,
    url: WebviewUrl,
    title: Option<String>,
    /// macOS application-menu name. The window title is a separate string.
    app_name: Option<String>,
    accent: Accent,
    chrome: PlatformChrome,
    width: f64,
    height: f64,
    min_width: Option<f64>,
    min_height: Option<f64>,
    resizable: bool,
    decorations: bool,
    maximized: bool,
    vibrancy: Vibrancy,
    remember_state: bool,
    visible: bool,
    #[cfg(desktop)]
    menu: MenuMode<R>,
    _r: PhantomData<R>,
}

impl<'a, R: Runtime, M: Manager<R>> MonetWindowBuilder<'a, R, M> {
    /// Window title. The macOS application menu uses [`Self::app_name`] when
    /// that is set, and this title otherwise.
    pub fn title(mut self, title: impl Into<String>) -> Self {
        self.title = Some(title.into());
        self
    }

    /// Name shown in the macOS menu bar, About, and Quit. Leave unset to use
    /// the window title. An unpackaged dev build also needs the Cargo bin
    /// to use this name, because the Dock and Force Quit read the executable.
    pub fn app_name(mut self, name: impl Into<String>) -> Self {
        self.app_name = Some(name.into());
        self
    }

    /// The per-app accent.
    pub fn accent(mut self, accent: Accent) -> Self {
        self.accent = accent;
        self
    }

    /// Which platform chrome to draw (default [`PlatformChrome::Auto`]).
    pub fn platform_chrome(mut self, chrome: PlatformChrome) -> Self {
        self.chrome = chrome;
        self
    }

    /// Initial inner size in logical pixels.
    pub fn inner_size(mut self, width: f64, height: f64) -> Self {
        self.width = width;
        self.height = height;
        self
    }

    /// Minimum inner size in logical pixels.
    pub fn min_inner_size(mut self, width: f64, height: f64) -> Self {
        self.min_width = Some(width);
        self.min_height = Some(height);
        self
    }

    /// Whether the window is resizable (default `true`).
    pub fn resizable(mut self, resizable: bool) -> Self {
        self.resizable = resizable;
        self
    }

    /// Whether the OS draws the native window frame and controls. Defaults to
    /// `false` so existing Monet apps keep their custom webview chrome.
    pub fn decorations(mut self, decorations: bool) -> Self {
        self.decorations = decorations;
        self
    }

    /// Start maximized.
    pub fn maximized(mut self, maximized: bool) -> Self {
        self.maximized = maximized;
        self
    }

    /// Whether the window is shown when built (default `true`). `false` keeps
    /// the webview running with no visible window, e.g. a headless command-line
    /// job.
    pub fn visible(mut self, visible: bool) -> Self {
        self.visible = visible;
        self
    }

    /// Configure the native vibrancy material (or disable it for a solid
    /// background). Defaults to [`Vibrancy::default`], which reproduces Wave 1
    /// exactly (macOS `HudWindow`, Windows acrylic tinted `#0b0e14`).
    ///
    /// ```no_run
    /// use monet_ui::{Vibrancy, VibrancyMaterial, VibrancyAppearance};
    /// # let v: Vibrancy =
    /// Vibrancy::material(VibrancyMaterial::Sidebar)
    ///     .appearance(VibrancyAppearance::Light)
    /// # ;
    /// ```
    pub fn vibrancy(mut self, vibrancy: Vibrancy) -> Self {
        self.vibrancy = vibrancy;
        self
    }

    /// Whether this window's geometry (size / position / maximized) is
    /// persisted per label and restored on the next launch. Default `true`.
    /// Set `false` to opt a window out of state persistence entirely.
    pub fn remember_state(mut self, remember: bool) -> Self {
        self.remember_state = remember;
        self
    }

    /// Choose how the native application menu is populated
    /// (default [`MenuMode::Default`]). Desktop only.
    #[cfg(desktop)]
    pub fn menu(mut self, menu: MenuMode<R>) -> Self {
        self.menu = menu;
        self
    }

    /// Create the transparent window with the requested decorations, injected
    /// accent/platform config, window-control bridge, and native vibrancy where
    /// supported.
    pub fn build(self) -> tauri::Result<WebviewWindow<R>> {
        let platform = self.chrome.resolve();
        // Whether a native material *would* be requested: the caller enabled
        // vibrancy AND the platform has one. The actual apply result is
        // reconciled after the window exists (see below).
        let vibrancy_expected = self.vibrancy.is_enabled()
            && (cfg!(target_os = "macos") || cfg!(target_os = "windows"));

        let config = MonetConfig {
            platform,
            accent: self.accent,
            accent_var: self.accent.css_ref(),
            accent_value: self.accent.value().to_string(),
            vibrancy: vibrancy_expected,
            appearance: self.vibrancy.appearance_value(),
            solid_color: self.vibrancy.solid_color_css(),
            native_popups: cfg!(target_os = "macos"),
        };

        let init = init_script(&config);

        // Restore persisted geometry (size + maximized) *before* build so the
        // window opens at the right size; position is re-applied post-build
        // (clamped to a visible monitor). Falls back to the builder defaults
        // when there's no saved state or persistence is off.
        let store = if self.remember_state {
            WindowStateStore::load(self.manager).map(Arc::new)
        } else {
            None
        };
        let saved = store.as_ref().and_then(|s| s.get(&self.label));

        // Open at the saved *inner* size when we have one (so there's no resize
        // flash); position + maximize are applied post-build by restore_geometry,
        // which clamps the position to a visible monitor. The builder, the saved
        // geometry and restore_geometry all speak inner (content) size — the one
        // system `set_size` restores, so a launch cannot inflate it (#232).
        let (open_w, open_h) = match saved {
            Some(g) if !g.maximized => (g.width, g.height),
            _ => (self.width, self.height),
        };

        let mut builder = WebviewWindowBuilder::new(self.manager, &self.label, self.url)
            .title(self.title.as_deref().unwrap_or("Monet"))
            .inner_size(open_w, open_h)
            .resizable(self.resizable)
            .decorations(self.decorations)
            .transparent(true)
            .shadow(true)
            .visible(self.visible)
            .initialization_script(&init);

        // Dropdown lists and menus open in native popup windows (see popup.rs)
        // so the window edge never cuts them off.
        let app = self.manager.app_handle().clone();
        let parent = self.label.clone();
        builder = builder
            .on_new_window(move |url, features| popup::on_new_window(&app, &parent, url, features))
            .on_page_load(|window, payload| {
                if payload.event() == tauri::webview::PageLoadEvent::Started {
                    popup::hide_owned(window.app_handle(), window.label());
                }
            });

        if let (Some(w), Some(h)) = (self.min_width, self.min_height) {
            builder = builder.min_inner_size(w, h);
        }
        // Builder-level maximize only for an explicit `.maximized(true)`; a saved
        // maximized window is restored *after* its un-maximized bounds are set
        // (see restore_geometry) so a later un-maximize returns to those bounds.
        if self.maximized {
            builder = builder.maximized(true);
        }

        let window = builder.build()?;
        popup::allow_popup_prewarm(&window);
        // A window's popups go with it: they keep Tauri's window list non-empty
        // (the app would not quit), and a reused label must not re-adopt them.
        {
            let app = self.manager.app_handle().clone();
            let owner = self.label.clone();
            window.on_window_event(move |event| {
                if let WindowEvent::Destroyed = event {
                    popup::destroy_owned(&app, &owner);
                }
            });
        }

        // Reposition / resize from saved geometry now that the window exists.
        if let Some(geometry) = saved {
            window_state::restore_geometry(&window, geometry);
        }

        // Apply the native vibrancy material now that we have a real window
        // handle; reconcile the config with the actual result.
        let applied = self.vibrancy.apply(&window);
        if vibrancy_expected && !applied {
            let _ = window.eval(VIBRANCY_FAILED_SCRIPT);
        }

        let final_config = MonetConfig {
            vibrancy: applied,
            ..config
        };

        // Stash the resolved config so `monet_config` can return it per window.
        // Self-manage the state map so callers don't have to register anything
        // beyond `invoke_handler()`.
        if self.manager.try_state::<MonetState>().is_none() {
            self.manager.manage(MonetState::default());
        }
        let state = self.manager.state::<MonetState>();
        if let Ok(mut map) = state.0.lock() {
            map.insert(self.label.clone(), final_config);
        }

        // Forward native window events (focus / maximize / close request) to the
        // webview so the custom chrome can stay in sync — and, when persistence
        // is on, record geometry on Moved / Resized / CloseRequested.
        install_window_events(&window, store);

        // Populate + attach the native application menu, and (once per app)
        // install the global menu-event forwarder.
        #[cfg(desktop)]
        {
            let app = self.manager.app_handle();
            match self.menu {
                MenuMode::None => {}
                MenuMode::Default => {
                    let menu_name = self.app_name.as_deref().or(self.title.as_deref());
                    if let Ok(menu) = build_default_menu(app, menu_name) {
                        let _ = app.set_menu(menu);
                    }
                }
                MenuMode::Custom(menu) => {
                    let _ = app.set_menu(menu);
                }
            }
            install_menu_forwarder(app);
        }

        Ok(window)
    }
}

// ─────────────────────────────────────────────────────────────
// Window events  →  webview  (event: "monet://window")  +  state persistence
// ─────────────────────────────────────────────────────────────

/// Install the native window-event → webview forwarder on `window`.
///
/// Emits [`WINDOW_EVENT`] (`"monet://window"`) with a [`WindowEventPayload`]
/// for the events the custom chrome cares about:
///
/// * **Focused(bool)** — drives dim-on-blur.
/// * **Resized** — recomputed into a `maximized: bool` (`window.is_maximized()`)
///   so the chrome's maximize/restore button stays in sync. Only emitted when
///   the derived state actually changes, to avoid a storm during live resize.
/// * **CloseRequested** — forwarded as advisory only.
///
/// When `store` is `Some`, the same handler also persists geometry: it records
/// the latest size/position/maximized on every `Moved`/`Resized` and flushes to
/// disk on `CloseRequested` (and opportunistically on the move/resize, since the
/// store no-ops when nothing changed). This reuses the single Wave-1 event
/// registration rather than installing a second listener.
///
/// ## Close contract
///
/// Monet **never** calls `CloseRequestApi::prevent_close`; the default
/// behaviour is to *allow* the close. The event is forwarded so a future
/// frontend can intercept for unsaved-changes prompts (it would then drive the
/// close itself via the `window_close` command). Because the close proceeds,
/// the frontend must treat the event as fire-and-forget for now.
fn install_window_events<R: Runtime>(
    window: &WebviewWindow<R>,
    store: Option<Arc<WindowStateStore>>,
) {
    let emitter = window.clone();
    let label = window.label().to_string();
    // Last known maximized state, so we only emit `Maximized` on a real change.
    let last_maximized = Mutex::new(emitter.is_maximized().unwrap_or(false));

    // Persist the window's current geometry, if persistence is enabled. A
    // maximized window keeps its *previous* (restored) bounds so un-maximizing
    // later returns to a sensible size rather than the full-screen rect.
    let persist = move |window: &WebviewWindow<R>| {
        let Some(store) = store.as_ref() else { return };
        if window.is_maximized().unwrap_or(false) {
            // Maximized: keep the prior *un-maximized* bounds as restore-bounds
            // and just flip the maximized flag. With no prior entry (window
            // opened maximized and never restored), fall back to the current
            // (maximized) rect so at least `maximized: true` persists.
            match store.get(&label) {
                Some(mut prev) => {
                    prev.maximized = true;
                    store.save(&label, prev);
                }
                None => {
                    if let Some(mut geometry) = window_state::capture_geometry(window) {
                        geometry.maximized = true;
                        store.save(&label, geometry);
                    }
                }
            }
            return;
        }
        if let Some(geometry) = window_state::capture_geometry(window) {
            store.save(&label, geometry);
        }
    };

    window.on_window_event(move |event| match event {
        WindowEvent::Focused(focused) => {
            let _ = emitter.emit(WINDOW_EVENT, WindowEventPayload::Focused { focused: *focused });
        }
        WindowEvent::Moved(_) => {
            persist(&emitter);
        }
        WindowEvent::Resized(_) => {
            let maximized = emitter.is_maximized().unwrap_or(false);
            let changed = match last_maximized.lock() {
                Ok(mut prev) => {
                    let changed = *prev != maximized;
                    *prev = maximized;
                    changed
                }
                Err(_) => true,
            };
            if changed {
                let _ = emitter.emit(WINDOW_EVENT, WindowEventPayload::Maximized { maximized });
            }
            persist(&emitter);
        }
        WindowEvent::CloseRequested { .. } => {
            // Advisory only — we do NOT call `api.prevent_close()`, so the
            // window still closes. See the doc comment's close contract. Flush
            // geometry here so the final size/position survives the close.
            persist(&emitter);
            let _ = emitter.emit(WINDOW_EVENT, WindowEventPayload::CloseRequested);
        }
        _ => {}
    });
}

// ─────────────────────────────────────────────────────────────
// Native application menu  →  webview  (event: "monet://menu")
// ─────────────────────────────────────────────────────────────

/// Install the global menu-event forwarder exactly once per app. Subsequent
/// calls (one per window) are no-ops, guarded by the [`MonetMenuForwarder`]
/// marker in state.
///
/// Predefined items (Quit/Undo/Cut/…) are handled natively by the OS and have
/// no stable custom id, so only *custom* items (e.g. Preferences…) produce a
/// meaningful [`MENU_EVENT`]; the forwarder still emits the raw id for any item
/// it sees, which is harmless for predefined ones.
#[cfg(desktop)]
fn install_menu_forwarder<R: Runtime, M: Manager<R>>(manager: &M) {
    if manager.try_state::<MonetMenuForwarder>().is_some() {
        return;
    }
    manager.manage(MonetMenuForwarder);

    let app = manager.app_handle().clone();
    app.on_menu_event(move |app, event| {
        let _ = app.emit(
            MENU_EVENT,
            MenuCommandPayload {
                id: event.id().as_ref().to_string(),
            },
        );
    });
}

/// Build Monet's sensible default application menu.
///
/// Layout (macOS reads the first submenu as the *app* menu):
///
/// * **App** — About <app>, Preferences… (`monet:preferences`), Quit.
/// * **File** — Close Window.
/// * **Edit** — Undo / Redo / Cut / Copy / Paste / Select All (all predefined,
///   so the standard accelerators work natively).
/// * **View** — Toggle Fullscreen.
/// * **Window** — Minimize / Maximize / Close Window.
///
/// `app_name` is used for the macOS "About <name>" / app-menu label.
#[cfg(desktop)]
fn build_default_menu<R: Runtime, M: Manager<R>>(
    manager: &M,
    app_name: Option<&str>,
) -> tauri::Result<Menu<R>> {
    let name = app_name.unwrap_or("Monet");

    let about_meta = AboutMetadataBuilder::new()
        .name(Some(name.to_string()))
        .build();

    // App / About submenu (becomes the macOS app menu — the first submenu).
    let app_menu = SubmenuBuilder::new(manager, name)
        .about_with_text(format!("About {name}"), Some(about_meta))
        .separator()
        .text(menu_ids::PREFERENCES, "Preferences…")
        .separator()
        .quit()
        .build()?;

    let file_menu = SubmenuBuilder::new(manager, "File")
        .close_window()
        .build()?;

    let edit_menu = SubmenuBuilder::new(manager, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;

    let view_menu = SubmenuBuilder::new(manager, "View")
        .fullscreen()
        .build()?;

    let window_menu = SubmenuBuilder::new(manager, "Window")
        .minimize()
        .maximize()
        .separator()
        .close_window()
        .build()?;

    MenuBuilder::new(manager)
        .item(&app_menu)
        .item(&file_menu)
        .item(&edit_menu)
        .item(&view_menu)
        .item(&window_menu)
        .build()
}

// ─────────────────────────────────────────────────────────────
// Init script
// ─────────────────────────────────────────────────────────────

/// Compensation for a native material that was requested but did NOT apply.
///
/// The init script has already injected `window.__MONET__` with the *expected*
/// vibrancy flag (the real result is only known once the window exists), so
/// patching the attribute alone was not enough (#233): the chrome initialises
/// from that object and its first effect removes `data-monet-solid` whenever
/// `cfg.vibrancy` is true — undoing this compensation and leaving the window
/// with neither a material nor a solid background until the async `monet_config`
/// round trip lands (permanently, for an app that forgot `invoke_handler()`).
const VIBRANCY_FAILED_SCRIPT: &str = "if (window.__MONET__) window.__MONET__.vibrancy = false; \
     document.documentElement.setAttribute('data-monet-solid','')";

fn init_script(config: &MonetConfig) -> String {
    let json = serde_json::to_string(config).unwrap_or_else(|_| "{}".to_string());
    format!(
        r#"(function(){{
  try {{
    var cfg = {json};
    window.__MONET__ = cfg;
    var de = document.documentElement;
    de.setAttribute('data-monet-tauri', '');
    if (cfg.appearance) de.setAttribute('data-monet-appearance', cfg.appearance);
    if (!cfg.vibrancy) {{
      de.setAttribute('data-monet-solid', '');
      if (cfg.solidColor) de.style.setProperty('--monet-solid-bg', cfg.solidColor);
    }}
    if (cfg.accentVar) de.style.setProperty('--accent', cfg.accentVar);
  }} catch (e) {{ /* no-op */ }}
}})();"#
    )
}

// ─────────────────────────────────────────────────────────────
// Commands
// ─────────────────────────────────────────────────────────────
//
// Defined in a submodule so `invoke_handler`'s `generate_handler!` can refer to
// them by path. Referencing `#[command]` fns from the same module they're
// declared in makes the macro re-import its per-command helper macros and
// collide with the originals (rustc E0255).

pub mod commands {
    use super::*;

/// Close the calling window. Invoke from JS as `invoke("window_close")`.
#[tauri::command]
pub(crate) fn window_close<R: Runtime>(window: WebviewWindow<R>) -> tauri::Result<()> {
    window.close()
}

/// Minimize the calling window. Invoke from JS as `invoke("window_minimize")`.
#[tauri::command]
pub(crate) fn window_minimize<R: Runtime>(window: WebviewWindow<R>) -> tauri::Result<()> {
    window.minimize()
}

/// Maximize / restore the calling window. `invoke("window_toggle_maximize")`.
#[tauri::command]
pub(crate) fn window_toggle_maximize<R: Runtime>(window: WebviewWindow<R>) -> tauri::Result<()> {
    if window.is_maximized()? {
        window.unmaximize()
    } else {
        window.maximize()
    }
}

/// Begin an OS window drag from a pointerdown on custom chrome. Usually you
/// won't need this — mark draggable chrome with `data-tauri-drag-region` — but
/// it's here for fully manual drag handling. `invoke("window_start_drag")`.
#[tauri::command]
pub(crate) fn window_start_drag<R: Runtime>(window: WebviewWindow<R>) -> tauri::Result<()> {
    window.start_dragging()
}

/// Return the [`MonetConfig`] for the calling window (platform chrome,
/// accent, vibrancy). `invoke("monet_config")`.
#[tauri::command]
pub(crate) fn monet_config<R: Runtime>(
    window: WebviewWindow<R>,
    state: State<'_, MonetState>,
) -> MonetConfig {
    let label = window.label().to_string();
    if let Ok(map) = state.0.lock() {
        if let Some(cfg) = map.get(&label) {
            return cfg.clone();
        }
    }
    // Fallback when the window was created without the builder.
    let platform = PlatformChrome::Auto.resolve();
    let vib = Vibrancy::default();
    MonetConfig {
        platform,
        accent: Accent::Raster,
        accent_var: Accent::Raster.css_ref(),
        accent_value: Accent::Raster.value().to_string(),
        vibrancy: cfg!(target_os = "macos") || cfg!(target_os = "windows"),
        appearance: vib.appearance_value(),
        solid_color: vib.solid_color_css(),
        native_popups: false,
    }
}

/// Size, position and show a native popup window next to `anchor` (client
/// coordinates of the calling window). `invoke("monet_popup_place", …)`.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub(crate) fn monet_popup_place<R: Runtime>(
    window: WebviewWindow<R>,
    label: String,
    anchor: PopupRect,
    width: f64,
    height: f64,
    side: String,
    align: String,
    offset: f64,
) -> tauri::Result<PopupPlacement> {
    popup::place(&window, &label, anchor, width, height, &side, &align, offset)
}

/// Cursor position inside a native popup window (`[x, y]`, or `null` outside).
/// `invoke("monet_popup_cursor", { label })`.
#[tauri::command]
pub(crate) fn monet_popup_cursor<R: Runtime>(window: WebviewWindow<R>, label: String) -> tauri::Result<Option<(f64, f64)>> {
    popup::cursor(&window, &label)
}

/// Park (hide) a native popup window. `invoke("monet_popup_hide", { label })`.
#[tauri::command]
pub(crate) fn monet_popup_hide<R: Runtime>(window: WebviewWindow<R>, label: String) -> tauri::Result<()> {
    popup::hide(&window, &label)
}

} // mod commands

// ─────────────────────────────────────────────────────────────
// Invoke handler
// ─────────────────────────────────────────────────────────────

/// The Monet command handler. These are registered as ordinary *application*
/// commands (not a gated plugin), so no ACL permissions are required — install
/// it on your builder:
///
/// ```no_run
/// tauri::Builder::default()
///     .invoke_handler(monet_ui::invoke_handler())
///     // ...
/// # ;
/// ```
///
/// Exposes `window_close`, `window_minimize`, `window_toggle_maximize`,
/// `window_start_drag` and `monet_config`. The [`MonetWindow`] builder
/// manages the state these commands read, so nothing else is needed.
pub fn invoke_handler<R: Runtime>(
) -> impl Fn(tauri::ipc::Invoke<R>) -> bool + Send + Sync + 'static {
    tauri::generate_handler![
        commands::window_close,
        commands::window_minimize,
        commands::window_toggle_maximize,
        commands::window_start_drag,
        commands::monet_config,
        commands::monet_popup_place,
        commands::monet_popup_hide,
        commands::monet_popup_cursor,
        quit_guard::monet_quit_guard_ready,
        quit_guard::monet_quit_exit,
        quit_guard::monet_quit_cancel,
    ]
}

// ─────────────────────────────────────────────────────────────
// Tests — pure helpers (no live Tauri app); kept in tests.rs so this
// file stays under the 1000-LOC house limit.
// ─────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests;
