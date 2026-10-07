# Changelog

All notable changes to **Monet** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## Vendored into monet-core - 2026-06-18

Monet UI was vendored whole into the **monet-core** monorepo at
`packages/monet-ui/`; development moved there and changes no longer land in the
standalone `legoless/monet-ui` repository. This file is frozen here — history after 2026-06-18 lives in
monet-core's git log (`git log -- packages/monet-ui`). The compare/release links
that used to close this file pointed at the standalone repository and were removed.

## [Unreleased]

### Added

#### Universal project format — `@monet-ui/monet-format`

- New package: the **cross-openable `.monet` document format** every Monet NLE
  app reads + writes. One envelope (`{format,schemaVersion,app,document}`) with a
  **self-describing per-sequence `timeBase`** (`frames`+fps | `seconds`) so a
  project saved + reopened by its authoring app never converts (exactly
  lossless), and a **shared clip timing backbone** (matches monet-timeline's
  `TimelineClip`) plus **namespaced `data.<app>` bags** for per-app domain
  payload (video transform/color/effects; audio gain/pan/fades) preserved
  verbatim by non-owning apps → lossless A→B→A round-trips.
- `serialize`/`parse` (envelope validation, schema-version guard, migration
  hook, default-fill), `createFile`, `getData`/`setData`, and
  `convertSequenceTimeBase` / `convertTime` (frames↔seconds via the seconds
  bridge) for cross-open. Depends on `@monet-ui/monet-timeline`; framework-free;
  7 tests. `TimelineSpan` split (below) underpins the shared backbone.

#### Shared timeline engine — `@monet-ui/monet-timeline`

- New **framework-free, unit-agnostic** package: the non-linear timeline engine
  every Monet NLE app re-implemented identically. No React/DOM — runs in the
  browser, workers and node.
- **Model** — generic `TimelineClip` timing backbone (`start`/`duration`/
  `inPoint`/`speed`/`enabled`), `TimelineTrack<C>`, `TimelineSequence<C>`, and a
  shared monotonic id generator (`newId`/`resetIds`). Generic over the app's
  clip type so each app keeps its own payload; ops preserve it via
  `structuredClone`.
- **Ops** — `splitTrackAt`, `overwriteClip`, `insertClip` (ripple), `liftClips`,
  `rippleDeleteClips`, `closeGapAt`, `moveClipToTrack`, `trimClipStart`/`End`,
  `slipClip`, `slideClip`, `rollEdit`, `setClipSpeed`, `cloneClip`,
  `wouldOverlap`.
- **Query** — `clipAt`, `clipCovers`, `findClip`, `overlapping`, `isRangeFree`,
  `clipsByStart`, `contentEnd`, `nextEdge`, `prevEdge`, `snapTime`.
- **Store** — `TimelineStore<P, S>`: observable, clone-on-write undo/redo,
  selection, transport, tool + zoom/scroll; subclass + override `snapshot()` for
  domain UI. React-free (apps bind via `useSyncExternalStore`).
- **Time** — `framesToTimecode`/`timecodeToFrames`/`formatClock`/`sourceFrameAt`/
  `clamp`. Unit-agnostic: Cinema uses frames, Rythme uses seconds.
- Decoupled from `monet-core`/`monet-react` (no build-order coupling); consumed
  via `workspace:*`. Monet Cinema's `src/timeline/*` now build on it.

#### Native OS dialogs

- Integrated the official [`tauri-plugin-dialog`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/dialog)
  (v2) so Monet apps get native file open/save and message/ask/confirm dialogs.
- **Rust** — the `monet-ui` crate exposes `dialog_plugin()`, a thin wrapper
  returning `tauri_plugin_dialog::init()`. Register it with
  `.plugin(monet_ui::dialog_plugin())`. `tauri_plugin_dialog` is also re-exported
  for advanced use.
- **TypeScript** — `@monet-ui/monet-react` adds a typed dialog wrapper:
  `openFile`, `saveFile`, `confirm`, `message`, and `ask` (plus the
  `OpenFileOptions` / `SaveFileOptions` / `ConfirmOptions` / `MessageOptions` /
  `AskOptions` / `DialogFilter` / `DialogKind` types). The plugin is lazily
  imported only inside a Tauri webview; outside Tauri the helpers degrade
  gracefully (`openFile`/`saveFile` → `null`, `confirm`/`ask` → `false`,
  `message` → no-op).
- The `raster` example's File ▸ Open…/Save As… menu items now invoke the native
  dialogs, and `create-monet-app` scaffolds the plugin (Cargo + npm deps, the
  `.plugin(monet_ui::dialog_plugin())` registration, the `"dialog:default"`
  capability, and an open/save demo in the menu bar).

### Changed

- Documentation now marks Windows as a verified native target alongside macOS,
  while keeping Linux documented as Monet's solid-background fallback path.

## [0.1.0]

First packaged release of Monet — the liquid-glass panel design system ported
from the build-free `reference/` prototype into a real pnpm + Cargo workspace
for [Tauri 2](https://tauri.app). Three publishable artifacts:
`@monet-ui/monet-core` (tokens + CSS), `@monet-ui/monet-react` (React/TS
components), and the `monet-ui` Rust crate (native window integration).

### Added

#### Chrome primitives (`@monet-ui/monet-react`)

- Neutral, translucent chrome primitives: `Workspace`, `Titlebar`, `ToolRail`,
  `Dock`, `Panel`, `TabStrip`, `Float`, `StatusBar`, and the supporting shell /
  graphics primitives. Platform chrome auto-matches the host OS (macOS traffic
  lights vs. Windows min/max/close).
- A geometric monoline icon set ported from the reference prototype.

#### Dockable workspace engine

- `DockableWorkspace` — a data-driven docking engine with drag-to-undock,
  directional snap zones, floating mini-docks, relocatable toolbars, and
  splitters.
- A **controlled / observable layout API**: imperative `DockableWorkspaceHandle`
  plus typed `DockLayout` / `ToolbarLayout` models, so a host can drive and
  observe the layout rather than only rendering it uncontrolled.

#### In-house controls

- Form controls with no third-party UI dependency: `Button`, `IconButton`,
  `Input`, `Textarea`, `NumberField`, `Checkbox`, `Switch`, `Radio` /
  `RadioGroup`, `Select`, and the `Field` / `Label` / `Hint` field furniture.

#### Overlay layer

- A self-contained overlay foundation: `Portal`, layering (`useLayer`), focus
  trapping (`useFocusTrap`), outside/escape dismissal (`useDismiss`), and a
  positioning engine (`computePosition` / `useReposition`), with `Tooltip` and
  `Popover` built on top.
- `Menu`, `MenuBar`, and `ContextMenu` driven by a shared `MenuItemDef` model,
  wiring the chrome menu strips to functional dropdowns.
- `Dialog` (modal) and a `ToastProvider` / `useToast` toast system.

#### Native Tauri integration (`monet-ui` crate)

- `MonetWindow::builder(…)` builds a decorationless, **transparent** window so
  the webview chrome is the only frame.
- **Configurable native vibrancy** via the `Vibrancy` builder
  (`VibrancyMaterial`, `VibrancyAppearance`, macOS corner radius, acrylic tint,
  solid-color fallback). macOS uses `NSVisualEffectView`; Windows uses acrylic;
  Linux falls back to a solid background (signalled to the frontend).
- **Native application menus** (`MenuMode`, `menu_ids`) and **window-event
  forwarding**: menu commands and window-state changes are emitted to the
  webview over the `monet://menu` / `monet://window` events.
- **Window-state persistence**: opt-in `.remember_state()` saves and restores
  window geometry (`WindowGeometry` / `WindowStateDoc`).
- Per-app **accent** injected as the `--accent` CSS variable before page load,
  and the full `MonetConfig` injected as `window.__MONET__`.
- Window-control + `monet_config` commands via `invoke_handler()` (ordinary app
  commands — no ACL permissions required).

#### React ↔ Tauri glue (`@monet-ui/monet-react`)

- `MonetProvider`, `useMonet`, and `windowControls` (close / minimize /
  toggle-maximize / start-drag).
- Receivers for the native bridge: `useMenuCommand`, `useWindowState` /
  `useMonetWindowState`, and `useMonetAppearance`.

#### Theming, density & accessibility

- **Light theme** via `data-theme="light"` and **compact density** via
  `data-density="compact"` (both opt-in on `.monet-window` or `:root`), backed
  by the typed `Theme` / `Density` token vocabulary and `--monet-*` metric
  variables.
- **Custom accents**: `resolveAccent` accepts any CSS color, not just the four
  built-in identities (`raster` / `vector` / `audio` / `motion`); names resolve
  to their `var(--accent-*)`, anything else passes through.
- Accessibility & keyboard-navigation pass across the chrome, controls, menus,
  and overlays.

#### DesignCanvas

- `DesignCanvas` — a Figma-style infinite design canvas (`DCSection`,
  `DCArtboard`, `DCPostIt`, `DCEditable`, `DCFocusOverlay`, `dcExport`, …),
  split across sibling modules to keep every file under 1000 LOC.

#### Tokens & styles (`@monet-ui/monet-core`)

- Framework-free design tokens (`tokens.css`), the full panel-system stylesheet
  (`styles.css`), control/overlay/canvas stylesheets, and a Tauri
  bare-window/vibrancy layer (`tauri.css`), aggregated via `index.css`.
- A typed token module exporting `Accent`, `Theme`, `Density`, `ACCENTS`,
  `ACCENT_NAMES`, `accentVar`, `accentValue`, `resolveAccent`, `METRICS`,
  `METRIC_VARS`, and `RADII`.

#### Examples, tooling & project hygiene

- Six standalone Tauri 2 example apps: `raster`, `vector`, `audio`, `motion`,
  `sandbox`, and `layouts`.
- A zero-dependency test suite (Node's built-in `node:test` for the TS packages,
  Rust's `#[test]` for the crate) and CI.
- `create-monet-app` scaffold for starting a new Monet + Tauri app, plus the
  publish machinery for the three packages.
- `LICENSE` (MIT), `CONTRIBUTING.md`, and this changelog.

### Notes

- **`window-vibrancy` appears twice in `Cargo.lock` (0.6.0 and 0.7.1) — this is
  expected and not a fixable duplicate.** The `monet-ui` crate depends directly
  on `window-vibrancy 0.7`, while `tauri 2.x` itself depends on
  `window-vibrancy ^0.6` for its internal window-effects support. Cargo cannot
  unify them: forcing `0.6.0 → 0.7.1` fails because `0.7.1` does not satisfy
  tauri's `^0.6` requirement. The two coexist until tauri bumps its own pin.
