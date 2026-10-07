# AGENTS.md — Monet Artisan

Project-level instructions for AI agents. Read before editing.

## What this is

**Monet Artisan** is a liquid-glass **vector illustration studio** — an Adobe
Illustrator-class desktop app — built on **Tauri 2 + React + TypeScript**, with
all window chrome supplied by the shared **Monet UI** design system
(`../../packages/monet-ui`). The app is a transparent, decorationless
native-vibrancy window; Monet draws the title bar, docks, panels, rails and
status bar in the webview, and Artisan draws the vector editing surface inside
Monet's `Canvas`.

The Monet vector *example* (`../../packages/monet-ui/examples/vector`) is a visual
**mock** — static SVG, placeholder panels. Artisan is the **real** editor: a
genuine vector document model, geometry engine, renderer, tool system, and
Illustrator-style commands wired into Monet's chrome.

## Architecture

```
src/
  main.tsx              React entry: MonetProvider + global stylesheets
  App.tsx               Composes the DockableWorkspace chrome + editor
  commands.ts           Command layer: high-level editor actions (undo-wrapped)
  artisan.css           App-only styles (canvas surface, rulers, handles)
  engine/               Pure, framework-free core (no React imports)
    geometry/           vec, matrix, bezier, bbox, path geometry
    model/              document model: Document, Artboard, Layer, Item, Path,
                        Anchor, Paint (solid/gradient), Stroke, types + factories
    store/              observable store: state, undo/redo, selection, dispatch
    ops/                document operations (transform, pathfinder, align, …)
    io/                 EXPORT + parsing primitives only (SVG export,
                        json/.artisan, svg-path/transform parsers)
  render/               SVG renderer + overlays; raster-document.tsx is the
                        Rust/WASM-rendered <canvas> surface (raster-flag gates it)
  engine-rs/            TS bridge to the Rust/WASM engine (EngineClient: blit)
  tools/                tool system + individual tools (pointer/keyboard)
  ui/                   Artisan panels + menu wiring built from Monet components
  io/                   File OPEN / IMPORT subsystem: detectFormat dispatcher +
                        svg/pdf/cdr/inflate importers
  state/                React store glue (store-context) + DEV-only e2e dev hook
engine/                 Generated WASM output (`pkg/`); source is ../../packages/engine
src-tauri/              Tauri 2 Rust shell (window via monet_ui crate)
```

Two distinct I/O locations: `engine/io/` is **export + parsing primitives only**,
while format **import** lives in `src/io/import/`. Importable formats:
SVG (`.svg`/`.svgz`), `.artisan` (native JSON), PDF, AI/EPS/PS, and CDR.

**Layering rule:** `engine/` is pure TypeScript — no React, no DOM, no Monet
imports. It is unit-testable in isolation. `render/`, `tools/`, `ui/` consume the
engine. UI is built from `@monet-ui/monet-react` primitives; do not hand-roll
chrome that Monet already provides.

## Build / run / verify

```sh
pnpm install
pnpm build:libs
pnpm --filter monet-artisan run engine:build
pnpm --filter monet-artisan typecheck
pnpm --filter monet-artisan build
pnpm dev:artisan
```

Run these commands from the monorepo root. `@monet-ui/*` resolves through pnpm
workspace links; rebuild shared packages with `pnpm build:libs` after changing
Monet UI.

## Rust/WASM rendering engine (`../../packages/engine`)

The monorepo shares the `monet-render-engine` crate. Artisan's engine build
scripts compile it into `engine/pkg` (generated and gitignored); never edit that
output by hand. Vector source lives under `../../packages/engine/src/vector`.
Run `cargo test --manifest-path packages/engine/Cargo.toml` from the monorepo root.

`src/engine-rs/EngineClient.ts` loads the generated `@engine` module and blits
from WASM memory. Rebuild typed views from `memory.buffer` per blit because WASM
memory can relocate. `src/render/raster-document.tsx` drives the engine behind
the current renderer flag.

## Conventions

- **Use Monet for UI blocks.** Panels, controls, menus, dialogs, layers, color,
  gradient editor, align/pathfinder, rulers/zoom/navigator come from
  `@monet-ui/monet-react`. Reach for a Monet component before writing a new one.
- **Accent via variable.** The app accent is `var(--accent-vector)`; never bake
  colors into chrome.
- **Engine stays pure.** Keep geometry/model/ops free of React/DOM so they can
  be tested and reused.
- **Strict TypeScript.** `tsconfig` is `strict: true`. Keep it compiling.
- **Surgical changes**, match surrounding style, add tests when changing shared
  engine logic.
