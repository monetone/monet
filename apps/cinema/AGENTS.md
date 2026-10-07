# AGENTS.md — Monet Cinema

Project-level instructions for AI agents. Read before editing.

## What this is

**Monet Cinema** is a liquid-glass **non-linear video editor** — an Adobe
Premiere-class desktop app — built on **Tauri 2 + React + TypeScript**, with all
window chrome supplied by the shared **Monet UI** design system
(`../../packages/monet-ui`). It is the real implementation of Monet
UI's `motion` example (the `--accent-motion` magenta app), exactly as
**monet-vision** realizes the `raster` example (Photoshop) and **monet-artisan**
realizes the `vector` example (Illustrator).

Like Monet Vision, the heavy pixel work lives in a **Rust → WebAssembly engine**;
unlike Vision, video *decode/encode* is a platform job (WebCodecs) — the engine
owns the **per-frame compositor**, not the codecs.

```
┌──────────────────────────────────────────────────────────────┐
│  React + Monet UI  (src/)                                     │
│   App.tsx ▸ tool rail, transport, menus, docked panels        │
│   render/ ▸ ProgramMonitor (canvas blit) + TimelinePanel      │
│   state/ ▸ reactive store + commands (undoable edit layer)    │
│   timeline/ ▸ pure model + ops + timecode (framework-free)    │
│   media/ ▸ WebCodecs import / probe / thumbs / waveforms      │
│   playback/ ▸ decode scheduler + compositor + Web Audio       │
└───────────────┬──────────────────────────────────────────────┘
                │  decoded RGBA frames written into wasm memory
┌───────────────▼──────────────────────────────────────────────┐
│  Rust engine  (engine/src/) → engine/pkg (wasm-pack)          │
│   lib.rs ▸ Engine: layer stack, affine compositor, scopes     │
│   blend.rs ▸ W3C blend modes · color.rs ▸ Lumetri grade       │
│   scopes.rs ▸ histogram / waveform / vectorscope              │
└──────────────────────────────────────────────────────────────┘
```

## Build & run

Rust lives at `~/.cargo/bin` (not always on PATH); `pnpm` comes from corepack.

```sh
# 1. one-time: build the shared Monet UI packages (monet-core + monet-react)
pnpm install
pnpm run build:libs

# 2. build the Rust/WASM compositing engine → engine/pkg
pnpm run engine:build            # dev (fast compile)
pnpm run engine:build:release    # optimized

# 3. run the app — ALWAYS the native desktop build
pnpm tauri dev                   # opens the native Tauri window (spawns vite on :1422)
```

**Always run the desktop version** (`pnpm tauri dev`). `pnpm dev` (browser on
http://127.0.0.1:1422) is only for fast iteration / headless verification.

Verify: `pnpm typecheck` (tsc strict), `pnpm test:unit` (vitest), `pnpm lint`,
and `pnpm build` must pass. The pure leaves (timecode, model queries, edit ops,
transition specs, the universal `.monet` adapter + EDL exporter) carry the unit
coverage. Program/playback + editing are covered by a Playwright e2e suite
(`e2e/`) that drives the real app through `window.__mc`:

```sh
pnpm fixtures      # (re)generate test-assets/*.webm via system Chrome (no ffmpeg)
pnpm test:e2e      # import / edit / play the fixtures in headless Chrome
```

The fixtures are small committed WebM clips (`bars.webm`, `tone.webm`) recorded
from a canvas + tone via MediaRecorder, so they decode through the same
HTMLVideoElement path the app uses. `window.__mc` (DEV-only, tree-shaken from a
normal build) exposes `{ store, engine, cmd, media, registry, decoder, playback,
query }` for scripted verification.

Local test entry points (no CI):

```sh
pnpm install        # also builds the Monet UI libs (their prepare scripts)
pnpm setup          # one-time: build:libs + the wasm engine (engine/pkg)
pnpm test           # unit (vitest) + e2e (Playwright) together
pnpm verify         # the full local gate: typecheck + lint + unit + build + e2e
```

`pnpm test:e2e` is self-contained — a Playwright `globalSetup` builds the wasm
engine / Monet UI libs if a fresh checkout is missing them, and the config's
`webServer` starts (or reuses) the vite dev server on :1422. It uses system
Chrome (`channel: "chrome"`), so no Playwright browser download is needed.

## How the pieces talk

- **The engine is the pixel pipeline, not the codec.** Each displayed frame, the
  playback compositor (`playback/compositor.ts`) asks `frame-source` for the
  decoded RGBA of every visible clip, writes it into a layer's source buffer via
  `engine.alloc_source(idx,w,h)` (zero-copy pointer into wasm memory), sets the
  layer transform/opacity/blend/crop/color/wipe, then `composite()`. JS blits
  `output_ptr()` onto the program `<canvas>` (the Monet Vision blit pattern).
  **WASM memory can relocate on growth** — rebuild the `Uint8Array` view from
  `mem.buffer` after every `alloc_source`; never cache it.
- **Frames are decoupled from compositing.** Async WebCodecs decoders populate
  `playback/frame-source.ts`; the synchronous compositor pulls the nearest ready
  frame. Color-matte clips synthesize a solid frame in-process (no decode).
- **The model is pure and framework-free** (`timeline/`). Editing never mutates
  it directly: commands call `store.mutate(label, fn)`, which clones-on-write so
  React selectors see fresh refs and every structural change is one undo step.
  Pure timeline geometry (insert/overwrite, ripple, razor, trim, slip/slide/roll)
  lives in `timeline/ops/edits.ts` and is unit-tested.
- **Engine ↔ TS contracts to keep in lockstep:**
  - blend-mode kebab id → `BlendMode` index: `playback/compositor.ts`
    `BLEND_INDEX` ↔ `engine/src/blend.rs`.
  - Lumetri grade f32 block: `state/effects.ts` `P_*` slots ↔
    `engine/src/color.rs` `P_*` (length `COLOR_PARAMS_LEN = 16`).
  - `.monet` document backbone: `timeline/model/types.ts` ↔ the universal schema
    in `@monet-ui/monet-format`, bridged by `timeline/io/monet-adapter.ts`
    (Cinema domain fields ride in the `data.cinema` bag, so new per-clip params
    don't break cross-app round-trips or the EDL exporter).

## Conventions

- **Use Monet for UI blocks.** Panels, controls, menus, the timeline track/clip
  chrome (`monet-track` / `monet-clip`), `Waveform`, `Slider`, `Timeline`,
  `Playhead` come from `@monet-ui/monet-react`. Reach for a Monet component first.
- **Accent via variable.** The app accent is `var(--accent-motion)`; never bake
  the magenta in.
- **Engine stays pure pixels; the store stays pure state.** `timeline/` has no
  React/DOM imports. Rebuild the wasm after any `engine/` edit
  (`pnpm engine:build`) or the frontend runs against stale bindings.
- **Strict TypeScript** (`strict`, `noUnusedLocals/Parameters`,
  `noImplicitOverride`). Keep it compiling. Add/extend tests when changing shared
  timeline logic.
- `engine/pkg` is generated (gitignored). Don't hand-edit it.

## Security & accepted risks

Local desktop app (no server, no network egress). CSP (`tauri.conf.json`) allows
`'wasm-unsafe-eval'` (the engine), `blob:`/`data:` media + workers (WebCodecs /
Web Audio decode off the main thread), and nothing else. `fs:scope` allows `**`
for Open/Save on user-picked volumes but denies the crown-jewel secret dirs
(`~/.ssh`, `~/.aws`, `~/.gnupg`, `~/.config`, `~/.docker`, `~/.kube`,
`~/Library/Keychains`) as defense-in-depth. `window.__mc` exposes the app API
for e2e/scripting; it is DEV-only (`import.meta.env.DEV || __MC_EXPOSE__`) and
tree-shaken out of a normal `pnpm build`.
