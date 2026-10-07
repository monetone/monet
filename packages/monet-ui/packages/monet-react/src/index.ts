// ─────────────────────────────────────────────────────────────
// @monet-ui/monet-react — public API
// ─────────────────────────────────────────────────────────────
// The Monet liquid-glass panel system as React components: neutral chrome
// primitives, a data-driven dockable workspace engine, and the Tauri window
// integration. All visuals come from @monet-ui/monet-core's stylesheet —
// import it once in your app entry:
//
//   import "@monet-ui/monet-core/index.css";

// Geometric monoline icon set.
export * from "./icons";

// Static chrome primitives (Workspace, Titlebar, Dock, Panel, ToolRail, …).
export * from "./primitives";

// Interactive data-driven docking engine (DockableWorkspace, Toolbar, …).
// Also surfaces the controlled/observable layout API types
// (DockableWorkspaceHandle, DockLayout, ToolbarLayout, …).
export * from "./dockable";

// Tauri window integration (useMonet, windowControls, MonetProvider, …),
// plus native menu/window-event receivers (useMenuCommand, useWindowState, …).
export * from "./chrome";

// In-house form controls (Button, Input, NumberField, Checkbox, Switch,
// Radio/RadioGroup, Select, Autocomplete, Field/Label/Hint). Select and
// Autocomplete (+ types) are re-exported from ./controls — do NOT also export
// ./controls-select or ./controls-autocomplete.
export * from "./controls";

// Overlay layer: Portal + positioning/focus hooks, Tooltip, Popover.
export * from "./overlay-core";
export { isEditableTarget } from "./internal";
// Dropdown lists and menus open in native popup windows on macOS desktop.
export { isDropdownOpen } from "./native-popup";

// Menus: Menu, MenuBar, ContextMenu (+ MenuItemDef model).
export * from "./menu";

// Dialog + Toast system (Dialog, ToastProvider, useToast).
export * from "./dialog";
export * from "./slider-row";

// DesignCanvas — Figma-ish infinite design canvas (DesignCanvas, DCSection,
// DCArtboard, DCPostIt, DCEditable, DCFocusOverlay, dcExport, …). canvas.tsx
// re-exports the whole public surface from its sibling modules, so this single
// line covers canvas-items/canvas-focus/canvas-export/canvas-context too.
export * from "./canvas";

// Creative components — Wave 1: numeric/transform scrubbers (ScrubbyNumber,
// Stepper, RangeSlider, AngleDial, Knob, TransformFields, PropertyRow) and
// inspector/layout surfaces (Section, SegmentedControl, ToggleGroup,
// ToolbarGroup, Breadcrumb, TreeView, SearchField, Badge, ProgressBar, Spinner).
export * from "./creative-numeric";
export * from "./creative-inspector";
// Creative components — Wave 2 (layers): the Photoshop/Figma layer, channel,
// artboard and nested-layer-tree inspectors (LayerRow, LayerList, LayerTree,
// VisibilityToggle, LockToggle, BlendModeSelect + BLEND_MODES, OpacityControl,
// ChannelRow, ChannelList, ArtboardList).
export * from "./creative-layers";
// Creative components — Wave 2 (color): the Photoshop/Figma color tooling
// (ColorField, HueSlider, AlphaSlider, ColorWheel, EyedropperReadout,
// GradientEditor, ColorPicker, Swatch/SwatchGrid, GlyphGrid, HexInput) plus the
// HSV/ColorValue color-space math + paint helpers. creative-color.tsx re-exports
// its graphics + palette siblings, so this single line covers the whole surface.
export * from "./creative-color";
// Creative components — Wave 3 (timeline): the transport / ruler / playhead /
// keyframe / composite-timeline surface (TimeDisplay, Transport, TimelineRuler,
// Playhead, KeyframeTrack, Timeline) plus the pure timecode math in
// creative-time.ts (re-exported from creative-timeline.tsx).
export * from "./creative-timeline";
// Creative components — Wave 3 (curve): SVG bezier curve editors (CurveEditor,
// EasingCurve + presets) plus the pure curve-sampling math in creative-curve.ts.
export * from "./creative-curve";
// Creative components — Wave 4 (viewport): canvas ruler / zoom / navigator /
// marquee / grid-guides surface (CanvasRuler, ZoomControl, Navigator, Marquee,
// GridGuides). Behaviour lives in creative-viewport.tsx.
export * from "./creative-viewport";
// Creative components — Wave 4 (meters): data-viz / measurement widgets
// (Histogram, LevelMeter, ChannelStrip, Spectrum) in creative-meters.tsx.
export * from "./creative-meters";
// Creative components — Wave 4 (vector): Pathfinder + AlignBar tool groups
// (shape-mode / compound-path ops, align / distribute) in creative-vector.tsx.
export * from "./creative-vector";

// Native OS dialogs (Tauri plugin-dialog wrapper): openFile, saveFile,
// confirm, message, ask (+ option interfaces). Degrades gracefully outside a
// Tauri webview. Pair with `monet_ui::dialog_plugin()` + the "dialog:default"
// capability on the Rust side.
export * from "./dialog-api";

// Native macOS global menu bridge (syncMacMenu). On macOS the chrome draws no
// menu bar — menus belong in the system bar — so an app without this has no
// reachable menus at all.
export * from "./mac-menu";

// Shared quit guard (#506): routes ⌘Q / App menu ▸ Quit / Dock ▸ Quit / logout
// through the app's unsaved-work check before the process exits.
export * from "./quit-guard";

// Durable document writes (atomicWriteBytes): write a fully-synced sibling and
// rename it over the destination, so an interrupted save can never destroy the
// user's file. Pair with `monet_ui::atomic_save_plugin()` on the Rust side.
export * from "./atomic-write";

// OS file drag-and-drop (useFileDrop): one hook covering the native Tauri
// drop (absolute paths) and the browser HTML5 drop (File objects), so every
// app gets the same drop behaviour for cross-app .monetgfx/.monet handoff.
export * from "./file-drop";

// Re-export the shared token vocabulary for convenience.
export {
  ACCENTS,
  ACCENT_NAMES,
  accentVar,
  accentValue,
  resolveAccent,
  METRICS,
  RADII,
} from "@monet-ui/monet-core";
export type { Accent, Platform, AccentDef } from "@monet-ui/monet-core";
