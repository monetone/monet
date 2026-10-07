# Monet Vision

Monet Vision is a desktop raster editor built with Tauri 2, React, the shared
[Monet UI](../../packages/monet-ui) design system, and the merged
[Rust/WASM rendering engine](../../packages/engine). Vector layers use that same
engine and rasterize on demand into the raster compositor.

## What works today

- Layers, groups, masks, clipping, effects, adjustment/fill layers, smart
  objects, editable text and vector layers
- 27 layer blend modes plus group pass-through, opacity and fill opacity
- Pressure-aware brushes, eraser, clone stamp, dodge/burn, bucket and gradients
- Marquee, lasso, magic-wand, quick/object selection and selection-masked edits
- Adjustments and filters with live preview and undo/redo history
- Crop, resize, canvas size, rotation, free transform and warps
- PNG, JPEG, WebP, BMP, TIFF, GIF, PSD and other imports/exports, plus layered
  `.mvision` projects and the shared `.monetgfx` format
- Local ONNX features including style transfer, subject selection, inpainting
  and super-resolution
- A generated MCP surface for controlling the live desktop app

## Development

Run commands from the monorepo root:

```sh
pnpm install
pnpm build:libs
pnpm --filter monet-vision run engine:build:release
pnpm dev:vision
```

`pnpm dev:vision` launches the native Tauri application. The app-local `dev`
script starts only Vite on port 1420 and is intended for browser test iteration.

The engine is generated into `apps/vision/engine/pkg`. Release WASM is currently
6.2 MB uncompressed. `wasm-opt` is deliberately disabled for compatibility with
current rustc output; the verified release web files total about 83.6 MB.

## Checks

```sh
pnpm --filter monet-vision typecheck
pnpm --filter monet-vision lint
pnpm --filter monet-vision test:unit
pnpm --filter monet-vision test:coverage
pnpm --filter monet-vision test:native
pnpm --filter monet-vision test:e2e
pnpm --filter monet-vision mcp:check
cargo test --manifest-path packages/engine/Cargo.toml
```

Install Playwright's version-matched browser once with `pnpm --filter
monet-vision exec playwright install chromium`. Playwright exercises the
browser/WASM build. Its `desktop` project validates the production bundle and
Tauri CSP in Chromium; it is not native WKWebView E2E.
`test:native` runs the native Rust tests and compiles the Tauri application
without building an installer.

## AI models

Seven checksum-pinned model files run on-device from `public/models`. MI-GAN,
DRUNet, Stable Diffusion 1.5, and the experimental Tier-2 models are local-only:
their weights are not shipped without confirmed redistribution terms. The
signed/resumable downloader is not shipped yet. See
[public/models/MODELS.md](public/models/MODELS.md).

Development can serve optional weights from `public/models`, but production
builds never copy paths listed in `public/models/.gitignore`. `build:release`
runs model checksum/licence, ORT byte-integrity, MCP-manifest, and final bundle
gates, so local weights cannot inflate or alter release output.

See [AGENTS.md](AGENTS.md) for architecture and contribution notes.

## License

MIT, matching the [Vision native crate](src-tauri/Cargo.toml) and
[shared rendering engine](../../packages/engine/Cargo.toml) manifests.
