# @monet-ui/monet-photo

Framework-free **photographic develop math**, shared across the Monet photo apps
(Vision raster editor, Galerie catalog + develop). Pure functions over typed
arrays — no React, no DOM — so it runs in the browser, Node, or a worker.

## Modules

- **`toneCurve`** — control-point → 256-entry piecewise-linear LUT (`buildLut`),
  per-channel curve LUTs (`buildCurveLuts`), `identityLut`, `CURVE_CHANNELS`.
- **`cubeLut`** — Adobe/IRIDAS `.cube` 3D-LUT parse (`parseCubeLut`), trilinear
  sample (`sampleLut3D`), and RGBA application (`applyCubeLut`).
- **`channelHistogram`** — 256-bin per-channel histograms + bars/options over
  RGBA (`channelCounts`, `channelBars`, `allChannelBars`, `downsampleBins`, …).
- **`histogramStats`** — mean/median/std/count over a 256-bin histogram.
- **`histogramReadout`** — cursor-hover level/count/percentile readout.
- **`rgbLab`** / **`rgbCmyk`** — `rgbToLab` / `rgbToCmyk` color conversions.

## Why a shared package

Vision's Camera-Raw develop stack and Galerie's Develop module run the **same**
develop math — fix it once, both apps benefit. This package is the source of
truth; Vision re-exports these modules from here.

```ts
import { buildLut, channelCounts, rgbToLab } from "@monet-ui/monet-photo";
```

## Scripts

`pnpm build` (tsup → `dist/`) · `pnpm test` (vitest) · `pnpm typecheck`.
