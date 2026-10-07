# @monet-ui/monet-imageio

Framework-free **image & swatch codecs**, shared across the Monet photo apps
(Vision raster editor, Galerie catalog + develop). Pure functions over typed
arrays — no DOM — so they run in the browser, Node, or a worker. Covers TGA /
PNM (PBM, PGM, PPM) / PCX raster read-write, ACO / ASE / ACT color-swatch
exchange, and PDF / SVG export builders.

```ts
import { decodeTga, parseAco, buildPDF } from "@monet-ui/monet-imageio";
```

`pnpm build` (tsup → `dist/`) · `pnpm test` (vitest) · `pnpm typecheck`.
