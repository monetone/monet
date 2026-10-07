# Monet Vision — agent notes

Read the repository-root `AGENTS.md` first. These notes cover Vision-specific
architecture and checks.

## What this is

Monet Vision is a Tauri 2 + React desktop raster editor. The UI consumes the
shared Monet design system from `../../packages/monet-ui`; pixel and vector work
runs in the merged Rust/WASM engine at `../../packages/engine`.

```text
React + Monet UI (`src/`)
  App/UI ─ state/app.ts + state/store.ts ─ engine/EngineClient.ts
                                                   │ wasm-bindgen
Merged engine (`../../packages/engine/src/`)
  raster/ compositor, layers, adjustments, filters, selection, file formats
  vector/ editable vector scenes rasterized into kind-3 compositor layers
```

`engine/pkg/` is generated, gitignored output. Vite aliases `@engine` to
`engine/pkg/monet_render_engine`; never edit generated bindings by hand.

## Build and run

Run from the monorepo root:

```sh
pnpm install
pnpm build:libs
pnpm --filter monet-vision run engine:build          # development WASM
pnpm --filter monet-vision run engine:build:release  # release WASM
pnpm dev:vision                                      # native Tauri app
```

Use the native app when asked to run, launch, or demo Vision. `pnpm --filter
monet-vision dev` starts only Vite on port 1420 and is for browser-based test
iteration. Tauri's production build already runs Vision's `build:release`.

The release WASM is currently 6.2 MB before compression, and the verified
release web files total about 83.6 MB. `packages/engine/Cargo.toml` deliberately
disables `wasm-opt` because its bundled version cannot validate current rustc
output.

## Verification

Use targeted checks first, then the broader suites warranted by the change:

```sh
pnpm --filter monet-vision typecheck
pnpm --filter monet-vision lint
pnpm --filter monet-vision test:unit
pnpm --filter monet-vision test:coverage
pnpm --filter monet-vision test:native
pnpm --filter monet-vision mcp:check
cargo test --manifest-path packages/engine/Cargo.toml
```

`pnpm --filter monet-vision test:e2e` runs the browser/WASM suite. Its `desktop`
project serves the production Vite bundle with the Tauri CSP in Playwright's
version-matched Chromium; it does not drive Tauri's WKWebView or native IPC. Do
not describe it as native E2E. Install that browser once with `pnpm --filter
monet-vision exec playwright install chromium`.
`test:native` runs the native Rust tests and compiles the Tauri application
without producing an installer; it still does not automate the WKWebView UI.
Tests must pass or fail—never add skips.

## Engine boundary

- The engine owns straight-alpha RGBA layer buffers and a composited output
  buffer. WASM memory can move on growth, so `EngineClient` creates a fresh
  `Uint8Array` view for every blit.
- A brush stroke changes a layer, not the output. Composite its dirty rectangle
  before blitting; `EngineClient.paintRegion` performs both steps.
- Numeric wire contracts live in `src/state/engineContracts.ts` and are pinned
  to the Rust declarations by `engineContracts.test.ts`. Layer kinds are: `0`
  pixel, `1` adjustment, `2` text, `3` vector, `4` fill, `6` group header, and
  `7` smart object. Blend indices are serialized, so never reorder them.
- Several methods return positional arrays: `move_layer_offset` and `stroke_to`
  return `[x, y, width, height]` dirty rectangles; `selection_bounds` returns the
  same shape for the selection. Zero width or height means no repaint.
- New/Open replaces the active engine. Read it through `engine.e` in handlers;
  do not retain a long-lived reference or use the raw field except for readiness
  checks.
- `state/store.ts` contains reactive state and engine mutations. `state/app.ts`
  contains higher-level actions wrapped by `rec()` for macro recording. Only
  those wrapped actions are macro-recordable.

## Conventions

- Keep shared components generic in `packages/monet-ui`; Vision-specific logic
  belongs under this app.
- Keep pointer geometry in `canvas/CanvasView.tsx`; the Rust engine owns pixels.
- Add raster adjustments and filters under
  `packages/engine/src/raster/{adjust,filters}.rs`, expose the WASM method, then
  connect `state/app.ts`, the dialog, the menu, MCP command, and tests.
- Rebuild Vision's WASM after any `packages/engine` change or the frontend will
  run against stale bindings.
- MCP commands are typed wrappers in `src/mcp/commands.ts`. Run `mcp:codegen`
  after changing them and commit the generated manifest.
- Make surgical changes; preserve the existing banner-comment and test style.

## Model files and bundle size

Local development can serve gitignored weights placed under `public/models`,
but production builds do not copy the literal paths listed in
`public/models/.gitignore`. `build:release` also runs `check:models`, so release
output contains only checksum-pinned, licensed model files and does not depend
on a builder's optional multi-gigabyte weights.

Seven checksum-pinned model files run locally through onnxruntime-web. MI-GAN,
DRUNet, the real ~2.1 GB SD 1.5 set, the tiny unlicensed SD test artifact, and
Tier-2 weights are optional and gitignored. They must be installed manually
under `public/models` as documented in `public/models/MODELS.md`; none is copied
into a release. The app does not yet ship the planned signed/resumable model
downloader.

## Security boundaries

- Scripting Console code runs in a fresh Worker. The worker masks ambient
  network, nested-worker, and result-channel globals; the main thread accepts
  only allowlisted `vision` operations, and terminates a run after two seconds.
  Keep the sandbox E2E cases current when changing this path.
- The CSP needs `'unsafe-eval'` for the scripting worker and
  `'wasm-unsafe-eval'` for the engine/onnxruntime. The production-CSP smoke test
  must remain green.
- Filesystem scope permits user-selected files broadly but denies common secret
  directories in `src-tauri/capabilities/default.json`.
- `window.__mv` is a dev/E2E hook gated by build flags. A normal release must
  remove it; run `pnpm --filter monet-vision verify:release` after changing its
  exposure or bundling.
- C2PA timestamping is opt-in and native-side. There is no telemetry or automatic
  model download.
