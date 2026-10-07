# Monet Core

Monet is a suite of seven desktop creative apps, built as one codebase. You can edit photos, draw vector illustrations, cut video, mix audio, make motion graphics, build 2D games, and catalog your photo library. Every app shares the same "liquid glass" look: a dark, translucent interface where panels float over your work.

This repository, [`monet`](https://github.com/monetone/monet), holds all seven apps plus everything they share: the design system, the rendering engine, the file format, and the automation layer.

## The apps

Each app targets a well-known professional tool, so you know roughly what to expect:

| App | What it does | Comparable to |
| --- | --- | --- |
| **Vision** | Raster image editor: layers, masks, adjustments | Photoshop |
| **Artisan** | Vector illustration: shapes, paths, typography | Illustrator |
| **Cinema** | Non-linear video editor: clips, tracks, titles | Premiere Pro |
| **Galerie** | Photo catalog and RAW develop: import, rate, adjust | Lightroom Classic |
| **Jouer** | 2D game and animation editor | Unity (2D) |
| **Rythme** | Digital audio workstation: recording, editing, mixing | Audition |
| **Anime** | Motion graphics and compositing | After Effects |

## Shared foundations

The apps are seven faces of one product. They share:

- **One design system.** [Monet UI](packages/monet-ui) is vendored in full inside this repo (no git submodule). Every button, panel and window in every app comes from it.
- **One rendering engine.** Vision, Artisan and Galerie share a single Rust engine, compiled to WebAssembly (a binary format browsers and webviews can run at near-native speed), at [packages/engine](packages/engine). Cinema has its own engine at [apps/cinema/engine](apps/cinema/engine). Anime, Jouer and Rythme need no engine.
- **One file format.** The universal `.monet` project file format, shared by the apps.
- **Built-in automation.** Every app runs a local MCP server (Model Context Protocol, a standard way for AI agents to control software), so an agent can drive the live desktop app.

## Try it

You need:

- **Node.js 20 or newer** (this repo pins 24 via `.nvmrc`) — the JavaScript runtime
- **pnpm 11.1.3** — the package manager; run `corepack enable` to get it
- **Rust stable with `cargo`** — builds the native app shells
- **wasm-pack** — builds the Rust/WebAssembly engines
- **Tauri prerequisites for your platform** — on macOS, the Xcode command-line tools

Then:

```bash
pnpm install        # installs everything and builds the shared UI libraries
pnpm build:libs     # rebuilds the shared Monet UI packages into dist/
pnpm build:engines  # builds the Rust/WASM engines for artisan, cinema, galerie, vision
pnpm dev:vision     # opens Vision as a native desktop window
```

Swap `dev:vision` for `dev:anime`, `dev:artisan`, `dev:cinema`, `dev:galerie`, `dev:jouer` or `dev:rythme` to run a different app.

## For developers

### Developing an app

`pnpm dev:<app>` runs the app's Tauri dev mode: it starts a Vite dev server and opens the native window. Each app gets its own port so two apps can run side by side (every interop feature is a two-app feature):

| App | Port |
| --- | --- |
| vision | 1420 |
| artisan | 1421 |
| cinema | 1422 |
| jouer | 1423 |
| rythme | 1424 |
| anime | 1425 |
| galerie | 1426 |

### Building release bundles

```bash
pnpm tauri:build      # builds release bundles for all seven apps (long Rust release compiles)
# or one app:
pnpm --filter monet-vision run tauri build
```

Bundles land in each app's `src-tauri/target/release/bundle/`.

### Workspace scripts

| Script | Effect |
| --- | --- |
| `pnpm build:libs` | Build all `@monet-ui/*` packages (topological order) |
| `pnpm build:engines` | Build the Rust/WASM engines (artisan, cinema, galerie, vision) |
| `pnpm build:web` | `vite build` every app's frontend |
| `pnpm typecheck` | `tsc --noEmit` across the workspace |
| `pnpm lint` | ESLint across packages that define it |
| `pnpm test` | Every workspace package's `test:unit` suite (7 apps + 10 `@monet-ui` packages), then the docs tests |
| `pnpm mcp:codegen` | Regenerate each app's MCP command manifest |
| `pnpm mcp:check` | Fail if any app's generated MCP manifest has drifted |
| `pnpm tauri:build` | Native release bundle for all seven apps |
| `pnpm collab:server` | Run the realtime collaboration server |

## Repository layout

```
monet/
├── apps/
│   ├── anime/     Monet Anime   — motion graphics & compositing studio (After Effects-class)
│   ├── artisan/   Monet Artisan — vector illustration studio (Illustrator-class)
│   ├── cinema/    Monet Cinema  — non-linear video editor (Premiere-class)
│   ├── galerie/   Monet Galerie — photo catalog & RAW develop studio (Lightroom Classic-class)
│   ├── jouer/     Monet Jouer   — 2D game & animation editor (Unity-class)
│   ├── rythme/    Monet Rythme  — digital audio workstation (Audition-class)
│   └── vision/    Monet Vision  — raster image editor (Photoshop-class)
├── docs/          design notes and how-to guides (see below)
├── packages/
│   ├── engine/    monet-render-engine — the merged raster + vector Rust/WASM engine
│   └── monet-ui/  Shared Monet UI design system (vendored in full — no submodule)
│       └── packages/
│           ├── monet-core/      design tokens, CSS, primitives
│           ├── monet-react/     React components + Tauri integration
│           ├── monet-collab/    Yjs collaboration substrate + presence
│           ├── monet-color/     color management, color spaces, LUTs
│           ├── monet-db/        TS bridge to the shared monet-db SQLite crate
│           ├── monet-format/    the universal .monet project file format
│           ├── monet-imageio/   raster/swatch codecs, PDF & SVG export
│           ├── monet-mcp/       MCP server core, Tauri bridge, codegen
│           ├── monet-photo/     develop math: tone curves, LUTs, histograms
│           ├── monet-scopes/    waveform monitor, vectorscope
│           └── monet-timeline/  timeline data model + editing operations
└── scripts/       repo-level scripts (collaboration server, site build)
```

Every app consumes the Monet UI packages via `workspace:*`. The Rust side of each app (`apps/*/src-tauri`) depends on the shared `monet-ui` crate at `packages/monet-ui/crates/monet-ui` by path.

## Learn more

- [docs/mcp.md](docs/mcp.md) — how the per-app MCP servers work and how to add commands
- [docs/durable-save.md](docs/durable-save.md) — why saves are atomic and how to keep them that way
- [docs/merged-engine-and-format.md](docs/merged-engine-and-format.md) — the shared rendering engine and the `.monet` format
- [docs/c2pa-signing.md](docs/c2pa-signing.md) — content credentials (C2PA) signing
- [docs/realtime-collaboration.md](docs/realtime-collaboration.md) — the collaboration substrate and server

## License

MIT. See [LICENSE](LICENSE) and [NOTICE](NOTICE) for details, including bundled third-party code.
