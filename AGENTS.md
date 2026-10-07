# Monet Core — agent notes

This is a **pnpm + Cargo monorepo** consolidating the seven Monet apps and the
shared Monet UI design system. It replaces the previous layout where each app was
its own repo with `monet-ui` vendored as a git submodule under `vendor/`.

## Layout

- `apps/<name>/` — one Tauri 2 + Vite + React app each. Each `src-tauri` is its
  own **standalone Cargo workspace** (note the trailing `[workspace]` in its
  `Cargo.toml`); it is *not* part of the monet-ui Cargo workspace.
- `packages/monet-ui/` — the full Monet UI repo, vendored (no submodule). Its
  `packages/*` are pnpm workspace members; its `examples/*` and `create-monet-app`
  are kept for reference but are not workspace members.

## How things wire together

- **JS/TS:** apps depend on `@monet-ui/monet-*` via `workspace:*`. pnpm links them
  from `packages/monet-ui/packages/*`. The packages build to `dist/` via `tsup`, so
  run `pnpm build:libs` before building/typechecking an app from a clean tree.
- **Rust:** each `apps/*/src-tauri/Cargo.toml` depends on the `monet-ui` crate via
  `path = "../../../packages/monet-ui/crates/monet-ui"`. `packages/monet-ui/crates/
  monet-format` holds the shared document IR + unified `.monetgfx` format and is
  linked by the merged engine.
- **WASM engines:** **Vision (raster), Artisan (vector) and Galerie (catalog +
  develop) share ONE merged engine crate, `packages/engine`
  (`monet-render-engine`)** — see `docs/merged-engine-and-format.md`. Each app's
  `engine:build[:release]` runs `wasm-pack` on `packages/engine` into its own
  `apps/<app>/engine/pkg/` (gitignored) and aliases it as `@engine`
  (`monet_render_engine.js`); a vector layer is a `kind`-3 layer rasterized on
  demand into the raster compositor. **Cinema** still has its own standalone
  `apps/cinema/engine/` crate (not yet merged). cinema and vision build their
  engine inside `tauri build` via `beforeBuildCommand: pnpm run build:release`,
  and galerie via `beforeBuildCommand: pnpm engine:build:release && pnpm build`;
  artisan's `beforeBuildCommand` is just `pnpm vite build`, so build its engine
  first. anime, jouer and rythme have no engine.

## MCP (Model Context Protocol)

Every app runs a local MCP server so an MCP client (Claude) can drive the live
app. It's a shared system: the `monet-mcp` Rust plugin
(`packages/monet-ui/crates/monet-mcp`) hosts a localhost HTTP endpoint and bridges
to the webview over Tauri events; the `@monet-ui/monet-mcp` TS package
(`packages/monet-ui/packages/monet-mcp`) owns the MCP protocol and a build-time
codegen. **New features get MCP support automatically**: add a typed,
`@mcp`-annotated wrapper to the app's `src/mcp/commands.ts`, run
`pnpm mcp:codegen`, and commit. `pnpm mcp:check` (per app or at the root) fails if
the generated manifest drifts. Full details: [docs/mcp.md](docs/mcp.md).

## Durable saves

Never write user data with a bare `writeFile` — it truncates the destination, so
an interrupted save destroys the old document as well as the new. Every app uses
`atomicWriteBytes` from `@monet-ui/monet-react` plus
`monet_ui::atomic_save_plugin()` on the Rust side. Full details:
[docs/durable-save.md](docs/durable-save.md).

## Dropdowns and menus

Use the Monet `Select`, `Autocomplete`, `Menu`, `ContextMenu` and `MenuBar` —
never a native `<select>`/`<datalist>`. In the macOS desktop apps their lists
and menus open in native borderless popup windows so they can extend past the
app window; elsewhere (browsers, Playwright, other platforms) they portal into
`#monet-overlay-root`. The native path lives in
`packages/monet-ui/packages/monet-react/src/native-popup.tsx` and
`packages/monet-ui/crates/monet-ui/src/popup.rs`; its header comments list the
WebKit constraints it works around (never focus into a popup, never close or
order out a popup window). In e2e, open a `Select` by clicking its trigger and
pick `.monet-listbox [role=option][data-value=…]` (Vision: `chooseOption` in
`apps/vision/e2e/helpers.ts`); read its value from the trigger's `data-value`.

## Conventions

- Use `AGENTS.md`, not `CLAUDE.md`, for instructions.
- Keep `monet-ui` generic and reusable — it is shared by every app. Do not couple it
  to a single app.
- Tauri apps: run the **native desktop** build (`pnpm dev:<app>` /
  `pnpm --filter monet-<app> run tauri dev`), not the bare Vite server, unless doing
  headless/e2e work.
- Dev ports — one per app, so two apps can run side by side (every interop
  feature is a two-app feature): vision `1420`, artisan `1421`, cinema `1422`,
  jouer `1423`, rythme `1424`, anime `1425`, galerie `1426`. A port lives in
  three places per app — `vite.config.ts` `server.port`, and `src-tauri/
  tauri.conf.json`'s `devUrl` + `beforeDevCommand` (+ the dev `ws://`/`http://
  localhost` entries in its CSP). `apps/cinema/src/dev-ports.test.ts` enforces
  uniqueness and that the three agree.
- `specs/` is legacy. The 30 machine-generated per-issue `PRODUCT.md` stubs were
  deleted; what remains is four hand-written `TECH.md` files (gh-434, gh-445,
  gh-462, gh-483) plus `gh-445/PRODUCT.md`, kept for their design rationale. The
  per-issue spec convention is no longer followed — do not add new `specs/gh-*/`.
