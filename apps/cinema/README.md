# Monet Cinema

A liquid-glass **non-linear video editor** (Adobe Premiere-class) for the
desktop — built on **Tauri 2 + React + TypeScript**, dressed entirely in the
[Monet UI](../../packages/monet-ui) design system, with a **Rust → WebAssembly
compositing engine**.

Monet Cinema is the real implementation of Monet UI's `motion` example, and a
sibling to [Monet Vision](../vision) (Photoshop-class raster) and
[Monet Artisan](../artisan) (Illustrator-class vector). It shares their
scaffolding (transparent native-vibrancy window, shared Monet UI packages,
Rust/WASM engine + a pure-Rust format crate) and differs in domain: a
timeline NLE where decode/encode come from **WebCodecs** and the engine owns the
**per-frame compositor**.

## Features

- **Timeline editing** — multi-track video/audio, selection / razor / ripple /
  roll / slip / slide / rate tools, insert & overwrite, lift & extract,
  trim, snapping, undoable everywhere.
- **Compositing engine (Rust/WASM)** — affine transform (position / scale /
  rotation / anchor), opacity, 14 blend modes, per-clip **Lumetri** primary
  color grade, crop, and wipe/iris transitions, blitted zero-copy to the
  program monitor.
- **Transitions** — cross dissolve, dip to black/white, wipe, push, slide, iris.
- **Color** — Lumetri panel (exposure / contrast / highlights / shadows /
  whites / blacks / temperature / tint / saturation / vibrance / hue) plus
  histogram / waveform / vectorscope scopes.
- **Audio** — per-track mixer (fader, mute, solo), clip gain + fades.
- **Project I/O** — the universal `.monet` document (via `@monet-ui/monet-format`,
  cross-openable by every Monet app; legacy `.cinema`/`.json` still open) and
  CMX3600 **EDL** export for round-tripping to Premiere / Resolve.
- **Media** — WebCodecs import / probe / thumbnails / waveforms; synthetic
  color-matte and title sources.

## Quick start

```sh
pnpm install               # also builds the shared Monet UI packages
pnpm setup                 # one-time: build:libs + the Rust/WASM engine
pnpm tauri dev             # launch the native desktop app
```

### Tests (local)

```sh
pnpm test:unit   # vitest — pure model / ops / timecode / transition specs
pnpm test:e2e    # Playwright — import/edit/play the test-assets video fixtures
pnpm test        # both, back to back
pnpm verify      # full gate: typecheck + lint + unit + build + e2e
pnpm fixtures    # regenerate the WebM fixtures (uses system Chrome, no ffmpeg)
```

`pnpm test:e2e` drives the real app through `window.__mc` in headless Chrome and
self-builds any missing wasm/UI artifacts.

See [AGENTS.md](AGENTS.md) for architecture, the engine ↔ TS contracts, and
conventions.

## Layout

| Path | What |
| --- | --- |
| `src/timeline/` | Pure model + editing ops + timecode math (unit-tested) |
| `src/state/` | Reactive store + `effects.ts` engine param bridge |
| `src/commands.ts` | Undoable editor command layer |
| `src/engine/` | `EngineClient` — the TS bridge / blit path to wasm |
| `src/playback/` | Decode scheduler, frame cache, the program compositor |
| `src/media/` | WebCodecs import / probe / thumbnails / waveforms |
| `src/render/` | Program monitor + timeline surface |
| `src/ui/` | Panels, menus, shortcuts |
| `engine/` | Rust/WASM compositing engine (`wasm-pack` → `engine/pkg`) |
| `src/timeline/io/` | Project I/O — universal `.monet` adapter + CMX3600 EDL (pure TS) |
| `src-tauri/` | Tauri 2 Rust shell (Monet window, `Accent::Motion`) |

## License

MIT.
