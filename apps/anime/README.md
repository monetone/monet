# Monet Anime

A liquid-glass **motion graphics & compositing studio** (After Effects-class),
built on Tauri 2 + Monet UI and the shared `.monet` format.

## What's implemented (MVP)

- **Compositions** — fps / size / duration / background; the active comp drives the viewport + timeline.
- **Layers** — solid, shape (rect/ellipse), text, image, null; stacked front→back, with visibility, lock, blend mode, and in/out points.
- **Transform** — position, anchor, scale, rotation, opacity — all **keyframable**.
- **Keyframe animation** — per-property tracks with 18 easing curves; stopwatch to animate; a timeline with per-property keyframe lanes; drag keyframes to retime.
- **Compositing viewport** — layers rendered with CSS transforms, opacity, blend modes, and effect filters, sampled live at the playhead (WYSIWYG with playback).
- **Effects** — Gaussian blur, glow, drop shadow, brightness, tint (live, parametric).
- **Playback** — wall-clock transport (play/pause/scrub/loop) at the comp fps.
- **Inspector** — Effect-Controls panel with scrubbable values + stopwatches; Layers panel; dockable workspace.
- **Images** — import (Layer ▸ Import Image…, or the Layers panel's `+ Image…`) or **drop** files on the window; each becomes an image layer at its natural size. The image is embedded as a data URL, so it travels inside the saved `.monet` to the other Monet apps. Properties ▸ Source replaces it.
- **Drag & drop** — drop a `.monet` to open it; drop images to place them. A mixed drop resolves to the document (it would replace the layers anyway); anything else is reported instead of silently ignored.
- **Save / open** — universal `.monet` document (`data.anime` payload), cross-openable with the other Monet apps.
- **Undo/redo**, keyboard transport (Space / arrows / Home / K / ⌦), Tauri window chrome (motion accent).

Architecture mirrors the other Monet apps: a framework-free, JSON-serializable
model (`src/model`), a clone-on-write store (`src/state`), pure command verbs
(`src/commands.ts`), a `.monet` adapter (`src/io`), and monet-ui-composed panels
(`src/ui`). The keyframe sampler + easing are shared in spirit with Monet Jouer.

## Run

```bash
pnpm dev:anime           # native desktop (Tauri)
pnpm --filter monet-anime dev   # web dev server (port 1425)
```

Roadmap (not yet): the graph/value editor, masks & track mattes, parenting,
pre-comps/nesting, expressions, 3D, motion blur, and a render queue.
