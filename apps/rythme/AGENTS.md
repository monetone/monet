# AGENTS.md — Monet Rythme

Project-level instructions for AI agents. Read before editing.

## What this is

**Monet Rythme** is a liquid-glass **digital audio workstation** — an Adobe
Audition / Audacity-class desktop app — built on **Tauri 2 + React +
TypeScript**, with all window chrome supplied by the shared **Monet UI**
design system (`../../packages/monet-ui`). The app is a transparent,
decorationless native-vibrancy window tinted with the **audio** accent; Monet
draws the title bar, docks, panels, rails and status bar in the webview, and
Rythme draws the multitrack timeline inside the workspace canvas.

The Monet audio *example* (`../../packages/monet-ui/examples/audio`) is a visual
**mock** — static SVG waveforms, placeholder panels. Rythme is the **real**
DAW: a genuine project model, a framework-free DSP/analysis engine, real WAV/
AIFF IO, non-destructive multitrack editing, and Web Audio realtime playback.

## Architecture

```
src/
  main.tsx              React entry: MonetProvider + global stylesheets
  App.tsx               Composes the DockableWorkspace chrome + DAW surfaces
  rythme.css           App-only styles (timeline, track headers, mixer, panels)
  engine/               Pure, framework-free core (NO React, NO DOM)
    audio/              AudioData sample-buffer type + buffer ops + dB units
    model/              Project · Track · Clip · Marker · Selection, factory, query
    store/              observable store, undo/redo, actions, high-level edit cmds
    dsp/                gain, fades, normalize, biquad EQ, dynamics, delay, reverb,
                        distortion, modulation, filters, speed — all (AudioData)→AudioData
    analysis/           FFT, levels (peak/RMS), spectrum, LUFS loudness, peaks, detect
    generate/           tone/noise/chirp/DTMF/silence generators (seeded RNG)
    io/                 WAV + AIFF codecs, .rythme project JSON, format sniffing
    ops/                render/mixdown, clip edits, range edits, clipboard, effect baking
  audio/                Web Audio realtime transport (the only Web Audio code)
  render/               timeline canvas + waveform peak cache
  tools/                editor tool registry
  ui/                   tool rail, transport bar, menus, shortcuts, panels, commands
  state/                React store glue + the generated demo session
src-tauri/              Tauri 2 Rust shell (window via monet_ui crate, Accent::Audio)
scripts/                fixtures generator + online fetcher, headless e2e harness
test-assets/            generated WAV fixtures (committed) + online/ (gitignored)
```

**Layering rule:** `engine/` is pure TypeScript — no React, no DOM, no Web
Audio, no Monet imports. It is unit-testable in isolation (vitest, node env).
`audio/`, `render/`, `ui/`, `state/` consume the engine. UI is built from
`@monet-ui/monet-react` primitives; do not hand-roll chrome Monet provides.

The engine barrel namespaces the heavy modules: `DSP`, `Analysis`, `Generate`,
`IO`, `Ops` (e.g. `E.DSP.reverb`, `E.Ops.renderProject`). The model, store,
actions and edit commands are top-level exports.

## Build / run / verify

```sh
pnpm install              # links @monet-ui/* from the root workspace
pnpm typecheck            # tsc --noEmit (strict)
pnpm test                 # vitest — the pure-engine + fixtures suite
pnpm build                # typecheck + vite build
pnpm fixtures             # (re)generate deterministic WAV test fixtures
pnpm e2e                  # headless smoke test against the running app
pnpm tauri dev            # launch the native window (Accent::Audio)
```

**Running the app: always launch the desktop version.** This is a Tauri 2
app — when asked to run/launch Rythme, use `pnpm tauri dev` (the native
window, `Accent::Audio`), never the bare browser dev server. `pnpm dev` exists
only for fast iteration and headless e2e verification, or when the browser is
explicitly requested.

If `@monet-ui/*` is missing, run `pnpm build:libs` from the monorepo root.
Rust lives at `~/.cargo/bin`.

**Verification is two-tier:** the engine has a real vitest unit suite (it is
pure); the UI is verified behaviourally by `scripts/e2e/run-all.mjs`, which
drives the dev server through `window.__rythme` / `window.__engine`.

## Conventions

- **Use Monet for UI blocks.** Panels, controls, menus, dialogs, transport,
  rails come from `@monet-ui/monet-react`. Reach for a Monet component first.
- **Accent via variable.** The app accent is `var(--accent-audio)`; never bake
  colors into chrome.
- **Engine stays pure.** Keep dsp/model/analysis/ops free of React/DOM/Web
  Audio so they stay testable and reusable. Every DSP processor is a pure
  `(AudioData, params) => AudioData` that never mutates its input.
- **Edits are immutable + undoable.** Edit ops produce NEW project/track/clip
  objects (structural sharing); dispatch them through the store so undo/redo and
  coalescing work. Add a DSP effect by adding the function in `engine/dsp/*`,
  exporting it, and adding an entry to `EFFECTS` in `ui/commands.ts`.
- **Strict TypeScript.** `tsconfig` is `strict: true`. Keep it compiling. Note
  TS 5.7+ types `Float32Array` as `Float32Array<ArrayBufferLike>` by default;
  annotate locals when assigning `new Float32Array(...)` results across a typed
  boundary.
- **Surgical changes**, match surrounding banner-comment style, add tests when
  changing shared engine logic.
