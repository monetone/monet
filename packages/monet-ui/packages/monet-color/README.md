# @monet-ui/monet-color

Framework-free **color science**, shared across the Monet photo apps (Vision
raster editor, Galerie catalog + develop). Pure functions over typed arrays — no
React, no DOM — so it runs in the browser, Node, or a worker. Covers ICC/display
color management, soft-proof math, color-space conversions (RGB/HSB/Lab/CMYK),
`.cube`/3DL color lookups, gradient maps, swatches, and color samplers.

```ts
import { rgbToHsb, formatColor, sampleProofLut } from "@monet-ui/monet-color";
```

`pnpm build` (tsup → `dist/`) · `pnpm test` (vitest) · `pnpm typecheck`.
