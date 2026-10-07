# @monet-ui/monet-scopes

Framework-free **scope displays**, shared across the Monet apps. Pure functions
over typed arrays — no React, no DOM globals — so they run in the browser, Node,
or a worker. Covers the waveform monitor and vectorscope (both rendering a shared
engine density grid onto a canvas context), plus the U²-Net salient-object
pre/post-processing tensor math for subject masking.

```ts
import { drawWaveform, drawVectorscope, preprocessU2Net } from "@monet-ui/monet-scopes";
```

`pnpm build` (tsup → `dist/`) · `pnpm test` (vitest) · `pnpm typecheck`.
