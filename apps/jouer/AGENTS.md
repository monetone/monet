# AGENTS.md

Project-level instructions for AI agents working in Monet Jouer. Read this before editing.

## What this is

**Monet Jouer** is an open-source, Unity-class **2D game & animation editor** for the
desktop. It pairs the [Monet UI](../../packages/monet-ui) liquid-glass design system (the chrome,
docks, panels, tool rail, timeline) with a **live Phaser 4 game engine**: the centre canvas
is a real running `Phaser.Game`, and the whole project **exports to runnable Phaser 4 code**
so it drops straight into a game. 2D only.

```
┌─────────────────────────────────────────────────────────────┐
│  React + Monet UI  (src/)                                    │
│   App.tsx ▸ tool rail, options bar, menus, dockable panels   │
│   ui/panels/ ▸ scene tree, inspector, assets, timeline, code │
│   state/ ▸ reactive store (clone-on-write undo) + commands   │
│   phaser/ ▸ EditorScene (live viewport) + runtime builders   │
│   model/ ▸ pure document model + queries + anim sampling     │
│   io/ ▸ .jouer (de)serialise + Phaser code export + files    │
└───────────────┬─────────────────────────────────────────────┘
                │  Phaser.Game (one EditorScene), reads the store each frame
┌───────────────▼─────────────────────────────────────────────┐
│  Phaser 4 (npm `phaser`)                                     │
│   draws the active scene, plays the active timeline, handles │
│   pointer select / move / scale / rotate / marquee / place   │
└──────────────────────────────────────────────────────────────┘
```

There is **no Rust/WASM engine** (unlike Monet Vision/Cinema) — the game engine is Phaser,
a normal JS dependency. `src-tauri/` is just the native window shell (same Monet chrome).

## Build & run

```sh
pnpm install
pnpm run build:libs        # build the shared Monet UI packages (monet-core + monet-react)

# run — the native desktop build (Tauri window dressed in Monet chrome)
pnpm tauri dev

# fast iteration / headless verification only (browser on http://127.0.0.1:1423)
pnpm dev
```

**Always run the desktop version** (`pnpm tauri dev`) when asked to run/launch/demo Jouer.
`pnpm dev` (browser) is for fast iteration and headless behavioural verification only.

Verify: `pnpm typecheck` (tsc), `pnpm lint` (eslint), `pnpm test:unit` (vitest), `pnpm build`
(tsc + vite) must all pass. `pnpm verify` runs them in sequence.

## Architecture contracts

- **The model is pure and framework-free** (`src/model/`): `Project → Scene[] → GameObject`
  tree (sprite/image/text/rectangle/ellipse/container) + per-scene `Timeline[]` of keyframed
  `AnimTrack`s, plus project-level `Asset[]`, sprite-sheet `SpriteAnimation[]` and
  `Transition[]`. Keep it plain-JSON serialisable — no class instances, functions, Maps/Sets
  (the store `structuredClone`s it for undo).
- **Editing flows through `store.mutate(label, fn)`** (`src/state/store.ts`), which clones the
  project on write so every structural change is one undo step and React always sees fresh
  references. Non-undoable view changes (selection, tool, playhead, zoom, active scene) just
  set their field and `bump()`. `store.patch(fn)` is a non-undoable project change.
- **Commands are the only editing API** (`src/commands.ts`). UI, menus, shortcuts and the
  Phaser scene call `cmd.*`; never mutate the model directly. Pure structural ops live in
  `src/ops/edits.ts`.
- **The Phaser scene reads the store, never the reverse** (`src/phaser/EditorScene.ts`). Each
  frame it reconciles its display list **only when `snapshot.project` changes** (edits/undo,
  not scrub), advances the playhead while playing, applies the sampled timeline pose on top of
  base transforms, and draws the grid + selection gizmo. Pointer edits commit back through
  `cmd.*` as single undo steps (drag = one `translateSelection`, not one-per-move).
- **Animation has two layers.** *Property timelines* (`Timeline`/`AnimTrack`/`Keyframe`) are
  the keyframe editor — sampled live in `model/sample.ts`, exported as chained Phaser tweens.
  *Sprite animations* (`SpriteAnimation`) are Phaser frame anims from a spritesheet.
- **Multiple engines** (`src/phaser/engines.ts` + `player.ts`, Engines panel). The editor
  authors on the statically-bundled Phaser ("the editor engine"); additional builds come from
  three sources: **bundled** (always installed), **local** (UMD files in `public/engines/`,
  offline one-click), and **cdn** (any version *downloaded from jsDelivr on demand* and cached
  in IndexedDB so the install persists + works offline). A downloaded build loads as a
  same-origin `blob:` script — the cross-origin code never executes directly. `installEngine()`
  resolves/loads a namespace from memory → IndexedDB cache → local file → CDN; it captures the
  build's `window.Phaser` and restores the global, so versions stay isolated. `removeEngine()`
  evicts a cached build. `createPlayerGame(ns, host, project)` runs the project in any engine
  using that engine's *own* tween/anim systems (the same construction the exporter emits as
  code), so the panel preview faithfully tests a version. `player.ts` and `export-phaser.ts`
  deliberately mirror each other (share via `exportTweenProp`). The standalone-HTML export pins
  its CDN `<script>` to the engine version you selected.
  - **CSP cost** (`src-tauri/tauri.conf.json`): the engine downloader needs `connect-src …
    https://cdn.jsdelivr.net https://data.jsdelivr.com` (fetch the build + the version list) and
    `script-src 'self' blob:` (run the cached build). The desktop e2e asserts these are present
    and that nothing else trips a violation. To add an offline engine instead: drop its
    `phaser-X.min.js` in `public/engines/` and add it to `LOCAL`.
- **Export is pure** (`src/io/export-phaser.ts`): `Project → Phaser 4 JS`. Tween `ease` is the
  ease of the keyframe a segment *leaves*. Origin/size tracks animate in-editor but are
  editor-only in export (Phaser can't tween them faithfully) — they emit a note. Keep the
  export deterministic and unit-tested (`io/io.test.ts`).

## Conventions

- Keep visuals in Monet CSS/components; `model/` is pure data, the store is pure state,
  `EditorScene` is the only place that touches Phaser pointer geometry.
- **Adding a tool**: extend `ToolId` (`state/store.ts`), add to `TOOLS` + a hotkey in
  `ui/use-shortcuts.ts`, and handle it in `EditorScene.onPointerDown`.
- **Adding an object kind**: extend `GameObjectKind`, give it defaults in
  `model/factory.ts`, build/apply it in `phaser/runtime.ts`, emit it in
  `io/export-phaser.ts`, normalise it in `io/jouer.ts`, and add inspector fields.
- **Adding an animatable property**: extend `TrackProperty`, handle it in `model/query.ts`
  `readProperty`, the `EditorScene` overlay, and (if Phaser can tween it) `TWEENABLE` in
  the exporter.
- Surgical changes; match the surrounding banner-comment style.

## Monet UI (shared library)

`../../packages/monet-ui` is the generic design system reused across all Monet apps.
Keep shared changes generic and verify affected consumers. Jouer's "play" green accent
stays app-side (`src/styles.css` `--accent` + the `DockableWorkspace` accent prop).

## Testing

- **Unit** (`pnpm test:unit`, vitest, node): the pure leaves — model factory/queries,
  easing curves (every easing's endpoints + that `elasticOut` matches Phaser's
  `Elastic.easeOut` exactly), timeline sampling, `.jouer` (de)serialise, and Phaser code
  export. Add a `.test.ts` next to any pure module you change.
- **E2E / desktop** (`pnpm test:e2e`, Playwright + the installed Chrome channel) drives the
  *real* live Phaser editor through the dev-only `window.__mj` hook (`{ store, cmd, query,
  sample, jouer, exporter, probe }`). `probe(id)` returns the live Phaser node's transform +
  size + sprite-anim state, so specs assert the on-screen result, not just the model. Two
  projects (see `playwright.config.ts`):
  - **chromium** — the dev build on `:1423`. Runs the whole feature suite, including
    `export-run.spec.ts`, which loads a generated game into a blank page with a real local
    Phaser and watches the exported tween actually move a property.
  - **desktop** — the *production* bundle served by `vite preview` with the shipped Tauri
    **CSP** applied (`:1430`, the macOS desktop build's real environment). Runs every feature
    spec under the CSP plus `desktop-smoke.spec.ts`, which records `securitypolicyviolation`
    events and asserts the live editor + animations boot under `script-src 'self'` with zero
    violations. (Playwright can't drive the native WKWebView, so this is the faithful proxy.)
  - Animation timing: never assert a pose after a wall-clock wait — use `tick(page)` (waits
    real `requestAnimationFrame` frames) or `waitProbe(...)`, so the frame loop isn't raced
    under parallel load. Don't re-add forced SwiftShader GL flags — Chrome's default renderer
    (WebGL or Canvas) is enough (probe reads geometry, not pixels) and avoids a slow GPU
    teardown.
- `window.__mj` is gated by `import.meta.env.DEV || __MJ_EXPOSE__` (the `build:e2e` script sets
  `MJ_EXPOSE=1`); a normal `pnpm build` tree-shakes it out — that artifact must never ship.

## Format

Projects save as self-contained `.jouer` JSON (schema `monet-jouer/v1`), images embedded as
data URLs. The parser (`io/jouer.ts`) is defensive — it fills every missing field so partial
files load.
