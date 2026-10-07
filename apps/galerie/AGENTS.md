# AGENTS.md — Monet Galerie

Project-level instructions for AI agents. Read before editing.

## What this is

**Monet Galerie** is a liquid-glass **photo catalog + non-destructive RAW
develop studio** — a Lightroom Classic-class desktop app — built on **Tauri 2 +
React + TypeScript**, with the window chrome from the shared **Monet UI** design
system (`../../packages/monet-ui`) and the pixel work in the merged
**Rust/WASM render engine** (`../../packages/engine`, the same crate Vision and
Artisan build).

```
src/
  App.tsx            DockableWorkspace shell, menus, module switching
  catalog/           typed bridge to the native SQLite plugin + its wire types
  state/store.ts     view/session state over the catalog (NOT the document)
  lib/               the pure leaves: layouts, plans, templates, math, policies
  ui/                panels, views (Grid/Loupe/Compare/Survey/Develop), dialogs
  engine.ts          WASM engine sessions (decode + the develop pipeline)
  developWorker.ts   the off-UI-thread develop render session
  import.ts export.ts print.ts book.ts rawDecode.ts autoImport.ts
  mcp/               @mcp-annotated command wrappers + generated manifest
src-tauri/src/       catalog.rs (SQLite), raw_decode.rs, develop_job.rs +
                     develop_scheduler.rs, dng.rs, linear_dng.rs, tiff_export.rs,
                     c2pa_sign.rs, secondary.rs, atomic_publish.rs, proof.rs
```

## The one thing that differs from the sibling apps

**The catalog is the source of truth, not an in-memory document.** Cinema,
Jouer and Anime hold a JSON project in a clone-on-write store with undo; Vision
keeps its document and its history inside the Rust/WASM engine. Galerie has
neither. `state/store.ts` holds only *view* state over transactional,
cursor-paged SQLite queries: the open catalog, the loaded page buffer, the
filter, the selection and the active module. Edits go straight to the DB through
`catalog/catalog.ts`; per-photo Develop history/snapshots are catalog rows, not a
store undo stack. Never load "the whole catalog" into the store.

- `catalog/types.ts` is the hand-written TS mirror of the serde types in
  `src-tauri/src/catalog.rs`. **Change one, change the other** — camelCase on the
  TS side, snake_case in Rust, Tauri maps them.
- The catalog file carries `SCHEMA_VERSION` (currently 16, `catalog.rs`). A file
  with any other stamp is refused, not migrated — bump it deliberately.
- Outside a Tauri window (browser dev, vitest) `invoke` is unavailable. Guard
  with `catalogAvailable()` and degrade; the tests rely on this.

## Develop pipeline

- A `DevelopRecipeV2` (from `@monet-ui/monet-photo`, shared with Vision) is
  serialized by `recipeToParams` into the flat 1086-float Camera Raw param array
  and applied via the engine's `camera_raw_develop` — the exact path Vision's
  Camera Raw workspace uses. Do not fork a Galerie-only develop path.
- Interactive develop runs in `developWorker.ts`, which hosts its **own** engine
  instance so slider drags never block the UI thread.
  `engine.ts::openDevelopWorkerSession` owns the main-thread half of the
  protocol. A worker cannot use Tauri IPC — native RAW decodes on the main
  thread and the scene-linear RGBA16 is transferred in.
- RAW on desktop decodes natively (`src-tauri/src/raw_decode.rs`) to oriented
  scene-linear RGBA16, already proxied to `maxEdge`; elsewhere the engine's byte
  decoders run against a bounded proxy. `proxyScale` (≤ 1) lets proxy-dependent
  effects (grain, sharpen) scale back to full resolution.
- **The working space is sRGB.** Every downstream consumer treats the RGBA8 it
  gets as sRGB, so a wider embedded profile is converted once in `engine.ts` at
  decode. Wide-gamut output happens only at export
  (`encodeRgbaInProfile` / `prophotoIcc`).

## Build & run

```sh
pnpm install
pnpm build:libs                                       # from the repo root
pnpm --filter monet-galerie run engine:build:release   # → engine/pkg (gitignored)
pnpm dev:galerie                                       # native Tauri window
```

Always run the **native desktop** build. `pnpm --filter monet-galerie dev` is
only Vite on **:1426**, for browser iteration; the catalog, RAW decode and
export all live behind Tauri IPC and are absent there.

`pnpm build` runs `engine:require` first — it fails if `engine/pkg` is missing or
older than `packages/engine`'s sources, so you never ship against a stale wasm.

## Verify

```sh
pnpm --filter monet-galerie typecheck
pnpm --filter monet-galerie lint
pnpm --filter monet-galerie test:unit     # vitest, ~165 spec files
pnpm --filter monet-galerie mcp:check     # fails on a stale MCP manifest
cargo test --manifest-path apps/galerie/src-tauri/Cargo.toml
```

`package.json` also carries `proof:` / `test:` scripts that check the real
pipeline rather than a mock: native-vs-wasm develop parity
(`test:shared-core-wasm`, `test:shared-core-product`), RAW acquisition and
ColorChecker accuracy, orientation, product export, DNG, the develop IPC route
contract, the engine format baseline and the secondary window. They need real
RAW fixtures and/or cargo, so run them deliberately when you touch that surface —
they are not part of `pnpm test`.

## Conventions

- **Put logic in `lib/` as a pure function with a test beside it.** Almost every
  `lib/*.ts` has a `*.test.ts` sibling; that is where the coverage lives. UI
  components stay thin.
- **Use Monet UI for chrome.** Panels, dialogs, rails, sliders come from
  `@monet-ui/monet-react`. Keep anything generic in monet-ui, not here.
- New features get MCP support: add an `@mcp`-tagged wrapper to
  `src/mcp/commands.ts`, run `pnpm mcp:codegen`, commit the generated files.
- `engine/pkg`, `dist` and the `mcp/` generated files are build output. Don't
  hand-edit them.
- Never write user data with a bare `writeFile` — see the root `AGENTS.md`.
