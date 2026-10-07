# Monet Galerie

Monet Galerie is a desktop photo catalog and non-destructive RAW develop studio
(Lightroom Classic-class), built with Tauri 2, React, the shared
[Monet UI](../../packages/monet-ui) design system, and the merged
[Rust/WASM rendering engine](../../packages/engine) — the same engine Monet
Vision and Monet Artisan use.

## What works today

- Catalog on SQLite (`src-tauri/src/catalog.rs`, schema v16) with transactional,
  cursor-paged queries — the catalog is the source of truth, not an in-memory
  document
- Import (copy / move / add in place), folder sync, auto-import, duplicate
  detection by content fingerprint, previews and stacking
- Library modules — grid, loupe, compare, survey, filmstrip — with ratings,
  flags, color labels, virtual copies, collections and smart collections
- Develop — non-destructive `DevelopRecipeV2` edits (tone, curve, HSL, point
  color, calibration, detail, optics/geometry, masks, heal, red-eye), history,
  snapshots, presets, copy/paste and auto-sync
- Cataloging — keywords and keyword sets, IPTC/EXIF metadata panels and presets,
  XMP sidecar auto-write, geotagging, capture-time edits
- Output — export (JPEG/PNG/TIFF/DNG, watermark, output sharpening, filename
  templates, post-export actions), publish services, web gallery, print, book,
  slideshow
- Secondary display window, C2PA content credentials, catalog backup and
  integrity check
- A generated MCP surface (15 tools) for controlling the live desktop app

## Development

Run commands from the monorepo root:

```sh
pnpm install
pnpm build:libs
pnpm --filter monet-galerie run engine:build:release
pnpm dev:galerie
```

`pnpm dev:galerie` launches the native Tauri application. The app-local `dev`
script starts only Vite on port 1426 and is intended for browser test iteration.

The engine is generated into `apps/galerie/engine/pkg` (gitignored) and aliased
as `@engine` in `vite.config.ts`. `pnpm build` runs `engine:require` first, which
fails if that output is missing or older than `packages/engine`'s sources.

## Checks

```sh
pnpm --filter monet-galerie typecheck
pnpm --filter monet-galerie lint
pnpm --filter monet-galerie test:unit
pnpm --filter monet-galerie mcp:check
cargo test --manifest-path apps/galerie/src-tauri/Cargo.toml
```

Beyond the vitest suite, `package.json` carries a set of `proof:` / `test:`
scripts that verify the real pipeline end to end: native-vs-wasm develop parity
(`test:shared-core-wasm`, `test:shared-core-product`), RAW acquisition and
ColorChecker accuracy (`proof:raw-acquire`, `proof:colorchecker`), orientation,
product export, DNG, the develop IPC route contract, the engine format baseline,
and the secondary window. They need real RAW fixtures and/or a Rust toolchain,
so they are run deliberately rather than as part of `test`.

## Engine wiring

Develop rides the engine's Camera Raw ABI: a `DevelopRecipeV2` is serialized to
the flat 1086-float param array by `recipeToParams` and applied through
`camera_raw_develop` — the exact path Vision's Camera Raw workspace uses. On
desktop, RAW decodes natively into oriented scene-linear RGBA16
(`src-tauri/src/raw_decode.rs`); elsewhere the engine's own byte decoders run
against a bounded proxy. The working space is sRGB, so a wider embedded profile
is converted once in `src/engine.ts`.

Dev port: **1426** (`vite.config.ts` / `src-tauri/tauri.conf.json`).

See [AGENTS.md](AGENTS.md) for architecture and contribution notes.
