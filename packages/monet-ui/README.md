# Monet UI

> **Vendored.** This workspace lives inside the **monet** monorepo at
> `packages/monet-ui/`. monet is the outer repo and consumes Monet UI from this
> directory in-tree, not as a git submodule. The development paths and commands below are
> relative to this directory; the one exception is
> [Use Monet in your own app](#use-monet-in-your-own-app-git-submodule), which is written
> from an external consumer's repo.

**A liquid-glass panel design system for Tauri 2 desktop apps.**

Monet is a single, neutral, translucent chrome — windows, menu strips, toolbars and
dockable panels — that dresses photo, vector, audio and motion tools without ever changing
shape. Every app is the same primitive set under a different per-app accent tint. The chrome
stays neutral; only the accent moves.

This repository implements Monet as a **real, packaged library for [Tauri 2](https://tauri.app)
and Rust**, with six standalone example apps. The original build-free React prototype lives on
under [`reference/`](reference/) as the canonical visual source the implementation is derived from.

## Layout

```
packages/
  monet-core/      Framework-free design tokens + styles.css + Tauri glass layer
  monet-react/     React + TS port: primitives, the dockable engine, Tauri chrome glue
crates/
  monet-ui/           Rust · Tauri 2 integration (transparent + native-vibrancy windows)
examples/
  raster/ vector/     Four creative apps — photo · illustration · multitrack · video,
  audio/ motion/        each a standalone Tauri 2 app
  sandbox/            Live dockable workspace (drag-to-undock, snap, float) + preset/accent picker
  layouts/            One studio app shown in seven dock arrangements (switcher)
reference/            The original build-free React+Babel prototype (canonical visual source)
```

## What's in the library

| Package | What it provides |
| --- | --- |
| **`@monet-ui/monet-core`** | The design tokens (`tokens.css`), the full panel-system stylesheet (`styles.css`), a Tauri bare-window/vibrancy layer (`tauri.css`), and a typed token module (`Accent`, `ACCENTS`, `accentVar`, metrics, radii). Zero framework deps. |
| **`@monet-ui/monet-react`** | The Monet components as React + TS: the neutral chrome **primitives** (Workspace, Titlebar, ToolRail, Dock, Panel, TabStrip, Float, StatusBar, …), the data-driven **dockable workspace engine** (`DockableWorkspace` — drag-to-undock, directional snap zones, floating mini-docks, relocatable toolbars), the geometric **icon set**, and the **Tauri chrome integration** (`MonetProvider`, `useMonet`, `windowControls`). |
| **`monet-ui`** (crate) | Tauri 2 native integration. `MonetWindow::builder(…)` makes a **decorationless, transparent** window with a **native vibrancy material** (macOS `NSVisualEffectView` · Windows acrylic via [`window-vibrancy`](https://docs.rs/window-vibrancy); Linux falls back to a solid background). Injects the per-app `--accent`, and exposes the window-control + `monet_config` commands the custom title bar calls. See [`crates/monet-ui/README.md`](crates/monet-ui/README.md). |

The chrome is the only frame: each example window is transparent and decorationless, the OS
supplies the blur, and Monet draws the title bar (traffic lights / Windows controls), docks,
panels and status bar in the webview. Platform chrome **auto-matches the host OS** (macOS traffic
lights vs Windows min/max/close); the same primitives work for every app under a different accent.

## Platform support

Monet's native Tauri window path is verified on **macOS** and **Windows**. macOS uses
`NSVisualEffectView`; Windows uses acrylic through `window-vibrancy`. Linux has no system
material in this stack, so Monet keeps the same webview chrome and uses the documented solid
background fallback.

## Component reference

Every `@monet-ui/monet-react` component is documented — props, behavior and usage — in the
**[Monet Component Reference](docs/components/)**, grouped by area (chrome primitives, the dockable
workspace, form controls, overlays, menus, dialog & toast, the design canvas, Tauri integration,
native dialogs, icons and tokens).

## Quick start

Prerequisites: **Node ≥ 18 + pnpm**, the **Rust** toolchain, and the Tauri 2 system
dependencies for your OS (on macOS, Xcode command-line tools).

```sh
pnpm install
pnpm run build:libs          # build monet-core + monet-react

# run any example as a native window:
pnpm --filter monet-example-raster tauri dev
#   monet-example-{raster,vector,audio,motion,sandbox,layouts}
```

To build distributable bundles: `pnpm --filter monet-example-raster tauri build`
(then use the platform-specific artifact under `target/release/bundle/`, such as
the macOS `.app` bundle or the Windows installer bundle).

> **Run examples via `tauri dev` or an OS-specific bundle — not the raw binary.**
> On macOS the embedded frontend is served over the `tauri://localhost` custom
> scheme, which only registers for a real `.app` bundle. Launching the bare
> `target/<profile>/monet_example_*` executable directly therefore loads no
> frontend and shows a blank (transparent) window. Use `tauri dev` for
> development, or `tauri build [--debug]` and open the bundled app.

### Building / checking everything

```sh
pnpm run build               # build libs, typecheck + bundle every example frontend
cargo check --workspace      # the monet-ui crate + all six example Tauri crates
```

## Use Monet in your own app (git submodule)

This section is for an **external** project and its commands run from *your* repo, not from
this directory. (The monet monorepo itself does not use this route — it vendors Monet UI in-tree at
`packages/monet-ui/`.)

Monet is **not published to npm or crates.io** — consume it straight from the standalone
`Legoless/monet-ui` repository by vendoring it as a git submodule. Development happens in
[`monetone/monet`](https://github.com/monetone/monet) (`packages/monet-ui`) and no longer lands in that repository, so a submodule pin
tracks whatever it last carried, not the current monet tree. The frontend packages
compile their `dist/` on install (a package `prepare` hook), so one `pnpm install` inside
the submodule is the only setup.
The Rust crate is consumed by path — no registry, one checkout, one source.

```sh
# 1 · vendor Monet (pins to a commit you control; bump it whenever you like)
git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui

# 2 · build the frontend packages once (prepare → dist for monet-core + monet-react)
pnpm -C vendor/monet-ui install
```

**Frontend** — link the two packages from the submodule (no registry, always live):

```jsonc
// package.json
"dependencies": {
  "@monet-ui/monet-core":  "link:vendor/monet-ui/packages/monet-core",
  "@monet-ui/monet-react": "link:vendor/monet-ui/packages/monet-react"
}
```

```tsx
// src/main.tsx
import "@monet-ui/monet-core/index.css";
import { MonetProvider } from "@monet-ui/monet-react";
```

**Rust** — point the Tauri crate at the submodule by path:

```toml
# src-tauri/Cargo.toml
tauri               = { version = "2", features = ["macos-private-api"] }  # vibrancy window
monet-ui            = { path = "../vendor/monet-ui/crates/monet-ui" }
tauri-plugin-dialog = "2"                                                   # monet_ui::dialog_plugin()
```

Then `pnpm install && pnpm tauri dev`. Update Monet later by bumping the submodule and
rebuilding its frontend:

```sh
git -C vendor/monet-ui pull && pnpm -C vendor/monet-ui install
```

> **Starting from scratch?** `npx create-monet-app my-app` scaffolds an app already wired
> to a Monet submodule exactly like this — see [`create-monet-app/`](create-monet-app/).

## How an example is wired

```rust
// examples/raster/src-tauri/src/main.rs
tauri::Builder::default()
    .invoke_handler(monet_ui::invoke_handler())          // window controls + config
    .setup(|app| {
        monet_ui::MonetWindow::builder(app.handle(), "main", WebviewUrl::default())
            .title("Raster")
            .accent(monet_ui::Accent::Raster)
            .inner_size(1440.0, 900.0)
            .build()?;                                    // transparent + vibrancy + chrome
        Ok(())
    })
    .run(tauri::generate_context!())?;
```

```tsx
// examples/raster/src/main.tsx
import "@monet-ui/monet-core/index.css";
import { MonetProvider } from "@monet-ui/monet-react";

createRoot(root).render(
  <MonetProvider>   {/* platform + accent from the Rust side; bare chrome inside Tauri */}
    <App />            {/* renders <DockableWorkspace …/> with the app's panels & tools */}
  </MonetProvider>,
);
```

## Native file dialogs

Monet wraps the official [`tauri-plugin-dialog`](https://github.com/tauri-apps/plugins-workspace/tree/v2/plugins/dialog)
so apps get real OS file open/save and message/ask/confirm dialogs, with
graceful no-op fallbacks in a plain browser (`vite dev` without Tauri).

**Rust** — register the plugin on the builder and allow the `dialog:default`
capability:

```rust
tauri::Builder::default()
    .invoke_handler(monet_ui::invoke_handler())
    .plugin(monet_ui::dialog_plugin())                   // native dialogs
    .setup(|app| { /* … MonetWindow::builder(…) … */ Ok(()) })
    .run(tauri::generate_context!())?;
```

```jsonc
// src-tauri/capabilities/default.json
{
  "permissions": [
    "core:default",
    "core:window:allow-start-dragging",
    "dialog:default"
  ]
}
```

**TypeScript** — call the typed helpers from `@monet-ui/monet-react`. Each is
async; outside Tauri `openFile`/`saveFile` resolve to `null`, `confirm`/`ask`
resolve to `false`, and `message` is a no-op:

```tsx
import { openFile, saveFile, confirm, message, ask } from "@monet-ui/monet-react";

const path = await openFile({
  multiple: false,
  filters: [{ name: "Images", extensions: ["png", "jpeg"] }],
});               // → string | null   (string[] | null when multiple: true)

const target = await saveFile({ defaultPath: "untitled.png" });  // → string | null

if (await ask("Discard changes?", { kind: "warning" })) { /* … */ }
const ok = await confirm("Overwrite the file?");                 // → boolean
await message("Export complete.", { kind: "info" });             // → void
```

## Theming

The chrome stays neutral; theming moves the accent, the color scheme, and the
density without touching any primitive.

- **Accent** — any CSS color, not just the four built-in identities. Pass an
  accent to `MonetProvider`/the chrome, or resolve one yourself with
  `resolveAccent` from `@monet-ui/monet-core`: a known name (`"raster"` ·
  `"vector"` · `"audio"` · `"motion"`) resolves to its `var(--accent-…)`, and
  anything else (`"oklch(0.7 0.15 30)"`, `"#ff5500"`, `"rebeccapurple"`) passes
  through unchanged onto the `--accent` variable.
- **Light mode** — set `data-theme="light"` on the `.monet-window` (or on
  `:root`, which cascades to every window). Only the glass / stroke / highlight /
  text tokens and desktop tones are redefined; accents and radii are unchanged.
- **Density** — set `data-density="compact"` to tighten every chrome height.
  `default` matches the historical fixed metrics exactly.

```tsx
<div data-theme="light" data-density="compact">
  {/* the Monet window inside renders light + compact */}
</div>
```

Starting a brand-new app? Use **`create-monet-app`** to scaffold a Tauri 2 +
Monet project wired up with the libraries, the crate, and a working example
window.

## The reference prototype

[`reference/`](reference/) is the original self-contained, build-free prototype (React + Babel
from a CDN, no toolchain). It remains the **canonical visual source** for the design system and
its three pages — Showcase, Design System docs, and Sandbox. See [`reference/README` history in
`AGENTS.md`](AGENTS.md). Don't add build tooling there; the Tauri implementation above is where
production work lives. As a frozen snapshot, `reference/` keeps its original `ap-` CSS prefix and
legacy naming; the packaged library uses the `monet-` prefix throughout.

## License

MIT — see [`LICENSE`](LICENSE).
