import { test, expect, type Page } from "@playwright/test";
import { gotoApp, composite } from "./helpers";

// Filters need continuous texture to act on (edge/texture filters like
// unsharp and oil-paint are near-identity on flat color). Stamp a smooth
// gradient + pseudo-noise so every filter produces a measurable change.
async function richScene(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv, E = () => mv.engine.engine;
    const w = 200, h = 150;
    mv.store.newDocument(w, h, "fil");
    const rgba = new Uint8Array(w * h * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const n = ((x * 37 + y * 17 + x * y) % 41);
      rgba[i] = Math.min(255, Math.round((x * 255) / w) + n);
      rgba[i + 1] = Math.min(255, Math.round((y * 255) / h) + ((x + y) % 23));
      rgba[i + 2] = Math.min(255, Math.round(((x + y) * 180) / (w + h)) + (n >> 1));
      rgba[i + 3] = 255;
    }
    E().stamp_image(0, 0, w, h, rgba);
    mv.engine.commit();
  });
}

// Every filter, driven through `mv.fil`, must change the composite.
const FILTERS: Array<{ name: string; code: string }> = [
  { name: "gaussian blur", code: "mv.fil.gaussian(4)" },
  { name: "box blur", code: "mv.fil.box(4)" },
  { name: "sharpen", code: "mv.fil.sharpen(0.8)" },
  { name: "unsharp mask", code: "mv.fil.unsharp(3, 1.5, 0)" }, // threshold is 0..1
  { name: "add noise", code: "mv.fil.noise(40, false)" },
  { name: "median", code: "mv.fil.median(2)" },
  { name: "find edges", code: "mv.fil.findEdges()" },
  { name: "emboss", code: "mv.fil.emboss(135, 1.0)" },
  { name: "motion blur", code: "mv.fil.motion(45, 16)" },
  { name: "high pass", code: "mv.fil.highPass(6)" },
  { name: "mosaic", code: "mv.fil.mosaic(12)" },
  { name: "vignette", code: "mv.fil.vignette(0.7)" },
  { name: "oil paint (neural)", code: "mv.neural.oilPaint(2.5, 5, 3, 5, 0, 2)" },
];

for (const f of FILTERS) {
  test(`filter: ${f.name}`, async ({ page }) => {
    await gotoApp(page);
    await richScene(page);
    const before = await composite(page);
    await page.evaluate((code) => {
      const mv = (window as any).__mv;
      // eslint-disable-next-line no-new-func
      new Function("mv", code)(mv);
    }, f.code);
    const after = await composite(page);
    expect(after.chk).not.toBe(before.chk);
  });
}
