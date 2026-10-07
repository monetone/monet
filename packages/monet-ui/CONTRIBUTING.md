# Contributing to Monet

Thanks for working on **Monet**. This guide covers setup, the build/verify
commands, the workspace layout, and the conventions every change is expected to
follow. Please read it (and [`AGENTS.md`](AGENTS.md)) before opening a change.

> **Vendored.** monet-core no longer consumes Monet UI as a git submodule — it is vendored
> whole inside the **monet-core** monorepo at `packages/monet-ui/`. (An external project can
> still consume it as a submodule; see the README.) Contributions go through monet-core: branch,
> review and merge there. Unless stated otherwise, the paths and commands below are relative to
> this directory, and "this repo" below means this vendored workspace, not monet-core's root.

## Setup

Prerequisites: **Node ≥ 18 + [pnpm](https://pnpm.io)**, the **Rust** toolchain,
and the [Tauri 2 system dependencies](https://v2.tauri.app/start/prerequisites/)
for your OS (on macOS, the Xcode command-line tools).

Native Tauri windows are verified on **macOS** and **Windows**. Linux uses
Monet's solid-background fallback because this stack has no Linux system
vibrancy material.

```sh
pnpm install
pnpm run build:libs    # build @monet-ui/monet-core, then @monet-ui/monet-react
```

`build:libs` must run before the examples (and before `typecheck` /
`build:examples`), because the examples consume the libraries via
`workspace:*` and import their built `dist/`.

## Build & verify

Run these from this directory (the Monet UI workspace root). A change should leave **all**
of them green:

```sh
pnpm run build              # build:libs + typecheck + bundle every example frontend
pnpm run typecheck          # tsc --noEmit across every package/example
pnpm run build:examples     # bundle the six example frontends
cargo check --workspace     # the monet-ui crate + all six example Tauri crates
pnpm test                   # the zero-dependency unit test suite
```

> On some machines Rust lives at `~/.cargo/bin` and isn't on `PATH` by default:
> `export PATH="$HOME/.cargo/bin:$PATH"`.

## Workspace layout

This repo is a single pnpm + Cargo workspace:

```
packages/
  monet-core/    Framework-free design tokens + stylesheets + typed token module
  monet-react/   React + TS port: primitives, the dockable engine, controls,
                 overlays, menus, dialogs, DesignCanvas, the Tauri chrome glue
crates/
  monet-ui/      Rust · Tauri 2 integration (transparent + native-vibrancy
                 windows, native menus, window-state, window controls)
examples/
  raster/ vector/ audio/ motion/   Four creative apps, each a standalone Tauri 2 app
  sandbox/                         Live dockable workspace + preset/accent picker
  layouts/                         One studio app in seven dock arrangements
reference/       The original build-free React+Babel prototype
```

[`reference/`](reference/) is the **frozen, canonical visual source** the
packaged library is derived from. Do not add build tooling there or treat it as
production code — derive production changes from it instead of rewriting it. It
deliberately keeps the legacy `ap-` CSS prefix and `Aperture` naming; the
packages use the `monet-` prefix throughout.

## Running an example

Examples run as native windows via the Tauri CLI (build the libs first):

```sh
pnpm --filter monet-example-raster tauri dev
#   monet-example-{raster,vector,audio,motion,sandbox,layouts}
```

To produce a bundle: `pnpm --filter monet-example-raster tauri build`, then open
the platform-specific artifact under `target/release/bundle/` (for example, the
macOS `.app` bundle or the Windows installer bundle).

> **Run examples via `tauri dev` or an OS-specific bundle — not the raw binary.**
> On macOS the embedded frontend is served over the `tauri://localhost` custom
> scheme, which only registers for a real `.app` bundle; launching the bare
> executable shows a blank (transparent) window.

## Conventions

These are hard rules for the packaged library:

- **Zero new runtime dependencies.** Do not add npm or Cargo runtime deps. For
  tests, use only zero-dependency tooling — Node's built-in `node:test` +
  `node:assert/strict` for the TS packages, and Rust's built-in
  `#[test]` / `#[cfg(test)]` for the crate. Do not add devDependencies for
  testing.
- **Keep every file under 1000 LOC.** Split a module (as `dockable` / `canvas` /
  `controls` already are) rather than letting a file grow past the limit.
- **`monet-` CSS prefix.** Every class and custom property in the packaged
  stylesheets uses the `monet-` prefix. Put new classes under it. (The frozen
  `reference/` keeps its original `ap-` / `dsx-` / `sbx-` / `dc-` prefixes.)
- **Neutral chrome, accent via variable.** Never bake an app's color into the
  chrome; pass it through the `--accent` CSS variable. The same primitives must
  work for every app under a different accent.
- **Visuals in CSS, behavior in JS.** Styling belongs in the stylesheets;
  TypeScript handles only interaction.
- **Accessibility.** Keep the keyboard-navigation and ARIA behavior intact for
  chrome, controls, menus, and overlays; add coverage when you change it.
- **Backward compatibility.** The six examples must keep building and the public
  component API must keep working. Removing genuinely-internal helper exports is
  fine as long as no example or module imports them.

## Tests

- Add or update tests when fixing a bug, changing behavior, or touching shared
  logic.
- **Skipped tests are not acceptable** — every test must pass or fail, never
  skip. Do not use `test.skip()` or conditional skips.
- TS unit tests live outside the `src` tsconfig `include` so `typecheck` never
  compiles them; run them with the workspace `pnpm test` script.

## Commits & pull requests

- Match the surrounding code style. Make surgical changes — touch only the files
  and lines the task needs; mention unrelated cleanup rather than doing it.
- Before opening a PR, confirm `pnpm run build`, `pnpm run typecheck`,
  `cargo check --workspace`, and `pnpm test` are all green.

By contributing you agree that your contributions are licensed under the
project's [MIT License](LICENSE).
