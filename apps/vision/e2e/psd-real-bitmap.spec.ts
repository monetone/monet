import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end import of a real 1-bit Bitmap-mode Photoshop document (ag-psd's
// MIT-licensed test/read/bitmap/src.psd; see packages/monet-ui/crates/monet-format/test-assets/fixtures/ag-psd-MIT.txt). Bitmap data is
// packed 8 pixels/byte; monet-format used to read depth-1 as 1 byte/pixel, underrun
// the merged composite, and import ZERO layers — the image was lost. This drives
// the real wasm engine and asserts the recovered black/white composite.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));
const MODE_RGB = 0;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

for (const scenario of [
  {
    compression: "raw",
    file: "real-bitmap.psd",
    first: [0, 0, 0, 255],
    second: [255, 255, 255, 255],
  },
  {
    compression: "RLE",
    file: "real-bitmap-rle.psd",
    first: [255, 255, 255, 255],
    second: [0, 0, 0, 255],
  },
] as const) {
  test(`imports a real ${scenario.compression} 1-bit Bitmap PSD through the app`, async ({ page }) => {
    const r = await page.evaluate(async ({ arr, name }) => {
      const mv = (window as any).__mv;
      const E = () => mv.engine.engine;
      mv.store.openFormat(new Uint8Array(arr), name);

      const png = E().export_png();
      const blob = new Blob([png], { type: "image/png" });
      const url = URL.createObjectURL(blob);
      const img: HTMLImageElement = await new Promise((res, rej) => {
        const i = new Image();
        i.onload = () => res(i);
        i.onerror = rej;
        i.src = url;
      });
      const c = document.createElement("canvas");
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      const cx = c.getContext("2d")!;
      cx.drawImage(img, 0, 0);
      const at = (x: number, y: number) => Array.from(cx.getImageData(x, y, 1, 1).data);
      URL.revokeObjectURL(url);
      return {
        w: E().width(),
        h: E().height(),
        count: E().layer_count(),
        first: at(0, 0),
        second: at(75, 50),
        center: at(150, 100),
        last: at(299, 199),
        mode: E().doc_mode(),
        depth: E().doc_depth(),
        importedPhotoshop: E().imported_photoshop_read_only(),
      };
    }, { arr: fixture(scenario.file), name: `real-bitmap-${scenario.compression.toLowerCase()}` });

    expect(r.w).toBe(300);
    expect(r.h).toBe(200);
    expect(r.count).toBe(1);
    // Opening is an import: Vision owns an editable RGB document, not the PSD.
    expect(r.mode).toBe(MODE_RGB);
    expect(r.depth).toBe(8);
    expect(r.importedPhotoshop).toBe(false);
    expect(r.first).toEqual(scenario.first);
    expect(r.second).toEqual(scenario.second);
    expect(r.center).toEqual([0, 0, 0, 255]);
    expect(r.last).toEqual([0, 0, 0, 255]);
  });
}
