# Monet Artisan

Monet Artisan is a liquid-glass **vector illustration studio** — an Adobe
Illustrator-class desktop app built on **Tauri 2 + React + TypeScript**, with all
window chrome supplied by the shared **Monet UI** design system. It pairs a
pure, framework-free geometry/document engine with a React SVG renderer, a
21-tool editing system, and Illustrator-style commands wired into Monet's title
bar, docks, panels, and rails. The app runs as a transparent, decorationless
native-vibrancy window; Artisan draws its vector editing surface inside Monet's
`Canvas`.

## Prerequisites

- **Node.js 24+**
- **pnpm 10+**
- **Rust toolchain** (stable; `cargo`/`rustc` on `PATH` — `~/.cargo/bin`) for the
  Tauri desktop shell

## Install

```sh
pnpm install
pnpm build:libs
pnpm --filter monet-artisan run engine:build
pnpm dev:artisan
```

Run these commands from the monorepo root.

## Scripts

| Script             | Command                          | What it does |
| ------------------ | -------------------------------- | ------------ |
| `pnpm dev`         | `vite`                           | Headless Vite preview server (browser only — **not** the desktop app) |
| `pnpm build`       | `tsc --noEmit && vite build`     | Typecheck then production Vite build |
| `pnpm typecheck`   | `tsc --noEmit`                   | Strict TypeScript check, no emit |
| `pnpm test`        | `vitest run`                     | Run the Vitest unit/integration suite |
| `pnpm test:watch`  | `vitest`                         | Vitest in watch mode |
| `pnpm e2e`         | `node scripts/e2e/run-all.mjs`   | Headless-Chrome tool e2e suite |
| `pnpm e2e:svg`     | `node scripts/e2e/svg-fixtures.mjs` | SVG import fixtures + screenshots |
| `pnpm e2e:qa`      | `node scripts/e2e/qa.mjs`        | Visual QA harness over the full app surface |
| `pnpm e2e:all`     | runs `run-all` + `svg-fixtures` + `qa` | All e2e suites in sequence |
| `pnpm tauri`       | `tauri`                          | Tauri CLI passthrough (e.g. `pnpm tauri dev`) |

> **Run the desktop app with `pnpm tauri dev`, not `pnpm dev`.** `pnpm dev` only
> starts the headless Vite preview in a browser; the real native-vibrancy window,
> Monet window chrome, and Tauri shell come up only through `pnpm tauri dev`.

## Architecture

```
src/
  main.tsx              React entry: MonetProvider + global stylesheets
  App.tsx               Composes the DockableWorkspace chrome + editor
  commands.ts           Command layer: high-level editor actions (undo-wrapped)
  engine/               Pure, framework-free core (no React / DOM / Monet imports)
    geometry/           vec, matrix, bezier, bbox, path geometry
    model/              Document, Artboard, Layer, Item, Path, Paint, Stroke + factories, query, shapes
    store/              observable store: state, transactions, undo/redo, selection
    ops/                document operations (transform, pathfinder, align, arrange, …)
    io/                 EXPORT + parsing primitives only — SVG export, .artisan JSON, svg-path/transform parsers
  render/               React SVG renderer for the document + overlays (+ rulers)
  tools/                tool system + ~21 individual tools (pointer/keyboard)
  ui/                   Artisan panels + menu wiring built from Monet components
  io/                   FILE OPEN / IMPORT subsystem — dispatcher + svg/pdf/cdr/inflate importers
  state/                React store glue (store-context) + DEV-only e2e dev hook
src-tauri/              Tauri 2 Rust shell (window via the monet_ui crate)
```

Note the two distinct I/O locations:

- **`src/engine/io/`** — *export* and pure parsing primitives only (SVG export,
  `.artisan` JSON serialize/deserialize, `parseSvgPathD`, `parseTransform`).
- **`src/io/`** — the *file open / import* subsystem (the magic-byte
  `detectFormat` dispatcher plus the SVG / PDF / CDR importers and `inflate`).

**Layering rule (convention only):** `engine/` is pure TypeScript — no React, no
DOM, no Monet imports — so it is unit-testable in isolation. `render/`, `tools/`,
`ui/`, and `state/` consume the engine; DOM-touching import code lives in
`src/io/import/`. This rule is enforced by convention and review, **not** by a
lint rule or build check, so keep it in mind when adding code.

## Import / Export support

Artisan opens five input formats. Fidelity varies by format — the tiers below are
sourced from each importer's header comment.

| Format | Extensions | Direction | Fidelity tier | Notes |
| ------ | ---------- | --------- | ------------- | ----- |
| Monet Artisan | `.artisan`, `.json` | Import + Export | **Lossless** | Native round-trippable JSON document (`monet-artisan` v1) |
| SVG / Inkscape SVG | `.svg`, `.svgz` | Import + Export | **Full** | path/rect/circle/ellipse/line/poly\*/text/image/g/use, presentation + style paints with inheritance, transforms, linear/radial gradients, viewBox; Inkscape extensions degrade gracefully (`inkscape:label` → item name) |
| PDF | `.pdf` | Import | **Subset** | Vectors + solid fills/strokes + transforms via the content-stream interpreter; **clipping, text, and images are skipped** |
| Adobe Illustrator / EPS / PS | `.ai`, `.eps`, `.ps` | Import | **Subset** | Modern `.ai` is PDF (routes through the PDF importer); legacy `%!PS` runs the same path-operator interpreter. Same subset limits as PDF |
| CorelDRAW | `.cdr` (RIFF + `PK` zip container) | Import | **Best-effort** | Spec-accurate geometry per the Kaitai `coreldraw_cdr.ksy` (`loda`/`trfd` pairs, point-type state machine); **fills are defaulted** (the fill table is not yet resolved) |

Image export additionally rasterizes the rendered SVG to PNG via the browser
canvas. Importers report degraded conversions through `ImportResult.warnings`.

## Testing

The unit/integration suite runs under Vitest (`pnpm test`). A separate
headless-Chrome end-to-end suite (`scripts/e2e/`, driven by `pnpm e2e*`) exercises
the real app through a **DEV-only dev hook** installed by
`src/state/store-context.tsx`. In `import.meta.env.DEV` builds it attaches to
`window`:

| Global | Type | Purpose |
| ------ | ---- | ------- |
| `window.__artisanStore` | `ArtisanStore` | The live editor store — drive edits, read state, assert undo/selection |
| `window.__engine` | engine barrel | Full `factory` / `Query` / `Shapes` / `Ops` namespaces for building fixtures and asserting geometry |
| `window.__Q` | `Query` | Shortcut to the engine `Query` namespace |
| `window.__doImport(name, data)` | `(string, string \| number[]) => Promise<{ items, types, warnings }>` | Drives the real import dispatcher + `replaceDoc`; returns item count, item types, and importer warnings |

These globals are gated behind `import.meta.env.DEV` and are **not** present in
production builds — the e2e suite depends on running against a dev build.
