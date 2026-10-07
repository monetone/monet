# __APP_PRODUCT_NAME__

A [Monet](https://github.com/legoless/monet-ui) liquid-glass desktop app built
with **Tauri 2** (React frontend + Rust backend).

The window is transparent and decorationless, using macOS vibrancy or Windows
acrylic as the native material. All chrome — title bar, dock, panels — is drawn
in the webview by `@monet-ui/monet-react`; the `monet-ui` Rust crate builds the
window and wires its custom window controls. Linux uses Monet's solid-background
fallback.

## Prerequisites

- [Node.js](https://nodejs.org) 18+ and a package manager (pnpm recommended)
- The [Rust toolchain](https://www.rust-lang.org/tools/install)
- Tauri 2 system dependencies — see the
  [Tauri prerequisites guide](https://v2.tauri.app/start/prerequisites/)

## Develop

Monet is consumed from a git submodule (not a registry), so set that up first:

```sh
git init   # if this app isn't already a git repo
git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui
pnpm -C vendor/monet-ui install   # builds the Monet packages (monet-core + monet-react)

pnpm install        # links @monet-ui/* from the submodule
pnpm tauri dev      # builds the Rust side, starts Vite, opens the window
```

`pnpm tauri dev` runs Vite on port **1421** (configured in `vite.config.ts`
and referenced from `src-tauri/tauri.conf.json`).

## Build a bundle

```sh
pnpm tauri build
```

## Project layout

```
src/                  React frontend
  main.tsx            mounts <MonetProvider><App/></MonetProvider>
  App.tsx             a DockableWorkspace with a menu, canvas, and panels
src-tauri/            Rust / Tauri backend
  src/main.rs         MonetWindow::builder(...) + invoke_handler()
  tauri.conf.json     macOSPrivateApi (macOS), transparent window, dev/build commands
  capabilities/       window permissions
  icons/              app icons
```

## Customize

- **Accent color** — set in two places: the `Accent::__APP_ACCENT_PASCAL__`
  variant in `src-tauri/src/main.rs` and the `--accent-__APP_ACCENT__` CSS var
  referenced in `src/App.tsx`. Available accents: `raster`, `vector`, `audio`,
  `motion`.
- **Panels & layout** — edit the `panels` map and `initialLayout` in
  `src/App.tsx`.
- **Menus** — edit `appMenus()` in `src/App.tsx`.

## Updating Monet

Both the frontend packages (`@monet-ui/*`, linked from `vendor/monet-ui/packages/*`) and
the Rust crate (`monet-ui`, `path = "../vendor/monet-ui/crates/monet-ui"`) come from the one
`vendor/monet-ui` submodule. Update it with:

```sh
git -C vendor/monet-ui pull            # or: git -C vendor/monet-ui checkout <tag/sha>
pnpm -C vendor/monet-ui install        # rebuild the frontend dist/
```

The submodule pins Monet to a specific commit (recorded in your repo), so builds stay
reproducible.
