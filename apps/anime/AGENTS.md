# AGENTS.md — Monet Anime

Project-level instructions for AI agents. Read before editing.

## What this is

**Monet Anime** is a liquid-glass **motion graphics & compositing studio**
(After Effects-class) on **Tauri 2 + React + TypeScript**, with the window chrome
from the shared **Monet UI** design system (`../../packages/monet-ui`).

It is the **smallest app in the repo — about 3,000 lines — and an MVP.** Read
`README.md` for the honest feature list. There is no graph editor, no masks or
track mattes, no parenting, no pre-comps, no expressions, no 3D, no render
queue. Do not write docs, types or abstractions for those; add them when the
feature lands.

```
src/
  App.tsx             DockableWorkspace shell + menus; drives the transport
  model/              pure, framework-free: types, factory, query, sample, ease
  state/store.ts      observable store, clone-on-write undo, transport/UI state
  commands.ts         the editing API — every verb the UI and MCP call
  ops/edits.ts        pure structural edits the commands build on
  render/viewport.tsx the composition viewport (DOM + CSS transforms)
  playback/player.ts  wall-clock rAF transport
  io/                 .mani container + the `.monet` adapter + file dialogs
  ui/panels/          layers, properties, timeline
  mcp/                @mcp-annotated wrappers + the generated manifest
```

## What an agent should know before editing

- **There is no Rust/WASM engine and no canvas compositor.** The viewport
  renders each layer as a DOM element with CSS `transform`, `opacity`,
  `mix-blend-mode` and `filter` (`render/viewport.tsx`). That caps fidelity:
  a blend mode or effect that CSS cannot express does not exist here — `add`
  falls back to `screen`. Reach for the real compositor only if the app grows
  one; do not fake it.
- **The viewport and playback share one evaluator** (`model/sample.ts`), so the
  preview is WYSIWYG with playback. Keep new animated properties flowing through
  `effectiveTransform` / `layerLive` rather than special-casing the renderer.
- **The model is pure JSON** (`model/types.ts`): no class instances, functions,
  Maps or Sets — the store `structuredClone`s it for undo.
- **Edit only through `commands.ts`.** UI, shortcuts and MCP call `cmd.*`;
  `store.mutate(label, fn)` clones and pushes one undo step (drags collapse via
  `coalesceKey`), `store.patch()` handles non-undoable UI (playhead, playing,
  selection, zoom).
- **File IO is container-first, dispatched on role, never on extension.**
  `io/anime.ts` owns exactly one container entry — `timeline.json`, role
  `"time"` — and carries every other app's entries through byte-for-byte, so a
  Cinema or Vision document survives an Anime save. A `.mcin` renamed `.mvis`
  opens identically. If you touch the adapter, keep that pass-through intact.
- **MCP resolves the *selected* layer.** Anime has no window global and most
  edits target a layer id, so the `src/mcp/commands.ts` wrappers take scalar
  params and read the current selection from the store, throwing a clear "select
  a layer first" when there is none. Keep new wrappers to that shape.

## Build & run

```sh
pnpm install
pnpm build:libs        # from the repo root
pnpm dev:anime         # native Tauri window — the way to run it
```

`pnpm --filter monet-anime dev` is only Vite on **:1425**, for browser
iteration. `beforeBuildCommand` is just `vite build` — there is no engine step.

## Verify

```sh
pnpm --filter monet-anime typecheck
pnpm --filter monet-anime lint
pnpm --filter monet-anime test:unit     # vitest, node env
pnpm --filter monet-anime mcp:check     # fails on a stale MCP manifest
```

There is **no e2e suite**, and the vitest config only includes
`src/**/*.{test,spec}.ts` in a node environment — today that is the three
`io/` specs (container, `.monet` adapter, image import). `src/test-setup.ts`
initializes the monet-format WASM from disk first. The model leaves
(`sample.ts`, `ease.ts`, `query.ts`) are pure and untested; **if you change
one, add its `.test.ts`** — that is the cheapest coverage this app can gain.

## Conventions

- The accent is `var(--accent-motion)` — the same magenta as Cinema; never bake
  the color in.
- Chrome comes from `@monet-ui/monet-react`. Anything generic belongs in
  monet-ui, not here.
- Match the surrounding banner-comment style; keep changes surgical.
