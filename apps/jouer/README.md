# Monet Jouer

A liquid-glass, **Unity-class 2D game & animation editor** for the desktop — open source, built
on [Monet UI](../../packages/monet-ui) and a **live Phaser 4 engine**, with one-click **export to
runnable Phaser code**.

Create scenes, drop in sprites / text / shapes / containers, animate anything on a keyframe
**timeline**, wire **scene transitions**, build sprite-sheet animations, and export the whole
thing to a standalone Phaser 4 game you can run in a browser or drop into a project.

![Monet Jouer](docs/screenshot.png)

## Features

- **Scenes** — multiple scenes, each with its own size, background and gravity.
- **Game objects** — sprites, images, text, rectangles, ellipses and nestable containers,
  with a full transform inspector (position, scale, rotation, origin, alpha, depth, tint).
- **Live Phaser viewport** — the centre canvas is a real `Phaser.Game`. Select, move, scale,
  rotate, marquee-select and place objects directly on the canvas, with a grid + snapping.
- **Animation timeline** — keyframe any numeric property (position, scale, rotation, alpha,
  origin, size) per object, with 18 easing curves, a scrubbable playhead and live playback.
- **Sprite animations** — author Phaser frame animations from spritesheets and play them on
  sprites in the editor.
- **Transitions** — fade / slide / wipe / zoom between scenes, triggered on click, key, timer
  or manually.
- **Arcade physics** — give objects dynamic/static bodies with velocity, gravity, bounce.
- **Multiple Phaser engines** — install additional Phaser builds (e.g. 3.90, 4.0, 4.1) and
  **run your project in any of them** in a live preview, to verify animations behave the same
  (or spot where engine versions differ). The preview uses each engine's own tween system.
- **Export to Phaser** — generate clean, readable Phaser 4 code (scene classes, tweens, anims,
  transitions, bodies) as a standalone HTML (CDN pinned to your selected engine) or a `.js`
  game module, previewed live.
- **`.jouer` projects** — self-contained JSON (images embedded), undo/redo, native save/open.

## Quick start

```sh
pnpm install
pnpm run build:libs        # build the shared Monet UI packages
pnpm tauri dev             # the native desktop app
```

For fast iteration / headless checks, `pnpm dev` serves the browser build on
`http://127.0.0.1:1423`.

## Verify

```sh
pnpm verify                # typecheck + lint + unit tests + build
```

## Stack

React 18 · TypeScript · Vite 6 · Tauri 2 · Monet UI (monet-core + monet-react) · Phaser 4.
No Rust/WASM engine — the game engine is Phaser, a normal npm dependency. `src-tauri/` is just
the native Monet-chrome window shell.

## Layout

```
src/
  model/      pure document model (types, factory, queries, easing, anim sampling)
  ops/        pure structural edits on a draft project
  state/      reactive store (clone-on-write undo) + singletons
  commands.ts undo-wrapped editing verbs (the editing API)
  phaser/     live EditorScene, runtime builders, PhaserStage host
  io/         .jouer (de)serialise, Phaser code export, file dialogs
  ui/         App shell, menus, shortcuts, dockable panels
src-tauri/    native window shell (Tauri 2 + Monet chrome)
../../packages/monet-ui/  shared design system
```
