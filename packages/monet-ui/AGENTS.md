# AGENTS.md

> **Vendored.** This workspace lives inside the **monet** monorepo at
> `packages/monet-ui/`. monet is the outer repo and carries its own `AGENTS.md`;
> every path and command below is relative to this directory.

Project-level instructions for AI agents working in this repo. Read this before editing.

## What this is

`monet-ui` is the **Monet** liquid-glass panel design system. The repo has two parts:

1. **The Tauri 2 implementation** (production) — a pnpm + Cargo workspace:
   - `packages/monet-core` (framework-free tokens + CSS), `packages/monet-react`
     (React/TS components + dockable engine + Tauri chrome glue), `crates/monet-ui`
     (Rust Tauri integration: transparent + native-vibrancy windows, window controls), and
     six standalone Tauri example apps under `examples/`. See the root `README.md`.
   - Build/verify: `pnpm install && pnpm run build:libs`; `cargo check --workspace`;
     `pnpm --filter monet-example-<id> tauri dev`. On this machine Rust lives at
     `~/.cargo/bin` (not always on PATH). The frontend is loosely typed on purpose (a
     faithful port of dynamic JS) — `strict` is relaxed in those tsconfigs.

2. **The reference prototype** under [`reference/`](reference/) — the canonical *visual*
   source: a **build-free, dependency-free** React+Babel-from-CDN prototype where every
   component is a `.jsx` file compiled in the browser. **The rules below apply to `reference/`.**
   As a frozen snapshot it keeps the original `ap-` CSS prefix and legacy `Aperture` naming; the
   production packages above were rebranded to the `monet-` prefix / `Monet` naming.

There is **no toolchain inside `reference/`**: no `package.json`, no bundler, no `node_modules`,
no `import`/`export`. Do not add one there. (The Tauri implementation above is the place for
build tooling; derive production changes from `reference/` rather than rewriting it.)

## Running & verifying

Pages fetch `.jsx` over HTTP and transpile in-browser, so they **must be served over HTTP**.
`file://` fails on CORS.

```sh
cd reference
python3 -m http.server 8000   # or: npx serve, php -S localhost:8000
```

Then load `http://localhost:8000/index.html` (Showcase), `Design%20System.html`, or
`Sandbox.html`. There is no automated test suite — **verification is visual**: serve the
page, open it, and confirm the change renders and behaves correctly with no console errors.
When you change shared primitives (`panels.jsx`, `dockable.jsx`, `styles.css`), check all
three pages, since they all depend on them. If you add behavior worth guarding, propose a
verification approach rather than silently leaving it unchecked.

## Hard rules (specific to this codebase)

1. **One global scope.** Every `<script type="text/babel">` runs in the same global scope —
   there are no modules. A top-level `const`/`function` in one file is visible to (and
   collides with) all others. Keep every new top-level identifier globally unique.
2. **Alias React hooks per file.** Because of rule 1, destructuring `const { useState } =
   React` can happen in only one file (`panels.jsx`). Other files alias: `dockable.jsx` →
   `dUseState`, `ds-foundations.jsx` → `fUseState`, `ds-components.jsx` → `cUseState`,
   `Design System.jsx` → `dsUseState`, `Sandbox.jsx` → `sbUseState`. Follow the existing
   prefix when adding hooks to a file.
3. **Visuals in CSS, behavior in JS.** Styling belongs in the stylesheets, not inline. JS
   handles only interaction (drag, resize, tab activation, etc.).
4. **Neutral chrome, accent via variable.** Never bake an app's color into the chrome. Pass
   it through the `--accent` CSS variable on `.ap-window`. The same primitives must work for
   every app skin.
5. **Respect CSS prefixes.** `ap-` = panel system (`styles.css`), `dsx-` = Design System docs
   (`ds.css`), `sbx-` = Sandbox (`sandbox.css`), `dc-` = design canvas (injected by
   `design-canvas.jsx`). Put new classes under the right prefix and file.
6. **Original icons only.** Icons are geometric 16px monoline glyphs in the `I` map in
   `panels.jsx`. Add new glyphs there in the same style; do not pull in icon libraries.
7. **CDN scripts use SRI.** The `<script>` tags in the HTML files carry `integrity` hashes.
   If you bump a CDN version, update the matching hash or the script will be blocked.

## Where things live

- **Primitives** (windows, menus, tool rails, docks, panels, tabs, floats, status bar, snap
  overlay, icons): `panels.jsx`.
- **Interactive docking engine** (drag-to-undock, snap zones, floating mini-docks,
  splitters): `dockable.jsx`. State shape is documented at the top of the file.
- **Design canvas** (sections, artboards, post-its, reorder, fullscreen focus, sidecar
  persistence): `design-canvas.jsx`.
- **Sample apps**: `app-raster.jsx`, `app-vector.jsx`, `app-audio.jsx`, `app-motion.jsx`;
  anatomy/interaction demos in `apps-anatomy.jsx`; the seven-layout studio in
  `app-layouts.jsx`.
- **Design System docs**: `ds-foundations.jsx`, `ds-components.jsx`, composed by
  `Design System.jsx`.
- **Page wiring**: each `*.html` lists, in order, the `.jsx` files it loads. If you add a
  file, add a matching `<script type="text/babel" src="…">` tag to every page that needs it,
  in dependency order (primitives first).

## Canvas persistence

The Showcase canvas persists artboard order / titles / labels / hidden state to a
`.design-canvas.state.json` sidecar. Reads use `fetch()`; **writes** require the host's
`window.omelette` bridge. Without that runtime the canvas is read-only — don't treat missing
writes as a bug. The sidecar is generated state and is not checked in.

## Conventions

- Match the surrounding file's style: banner comments (`// ───`), the existing naming, and the
  documented component contracts at the top of `panels.jsx` / `dockable.jsx`.
- Make surgical changes. This is a design reference — prefer the smallest edit that achieves
  the goal over refactors or new abstractions.
- Do not introduce build tooling, npm dependencies, or module syntax.
