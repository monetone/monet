import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

// End-to-end import of a REAL Indexed-colour Photoshop document (ag-psd's
// MIT-licensed test/read/indexed/src.psd; see packages/monet-ui/crates/monet-format/test-assets/fixtures/ag-psd-MIT.txt). The 256-colour
// palette lives in the Color Mode Data section. monet-format previously skipped
// it, so the image rendered as grayscale index values. This drives the real wasm
// engine and asserts a genuinely-coloured palette pixel reaches the composite.

const here = dirname(fileURLToPath(import.meta.url));
const fixture = (name: string) =>
  Array.from(readFileSync(join(here, "../../../packages/monet-ui/crates/monet-format/test-assets/fixtures", name)));
const MODE_RGB = 0;

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("imports a real Indexed PSD with its palette colours (not grayscale)", async ({ page }) => {
  const r = await page.evaluate(async (arr) => {
    const mv = (window as any).__mv;
    const E = () => mv.engine.engine;
    mv.store.openFormat(new Uint8Array(arr), "real-indexed");

    // Render the composite and read the palette-mapped pixel at (8,8).
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
    const d = cx.getImageData(8, 8, 1, 1).data;
    URL.revokeObjectURL(url);
    return {
      w: E().width(),
      h: E().height(),
      count: E().layer_count(),
      px: [d[0], d[1], d[2], d[3]],
      mode: E().doc_mode(),
      depth: E().doc_depth(),
      importedPhotoshop: E().imported_photoshop_read_only(),
    };
  }, fixture("real-indexed.psd"));

  expect(r.w).toBe(32);
  expect(r.h).toBe(32);
  expect(r.count).toBe(1);
  // Opening is an import: Vision owns an editable RGB document, not the PSD.
  expect(r.mode).toBe(MODE_RGB);
  expect(r.depth).toBe(8);
  expect(r.importedPhotoshop).toBe(false);
  // (8,8) is palette index 6 → [15,110,165] (a blue). Under the palette-skip bug
  // it was a near-black gray (~[6,6,6]). Assert the real colour, and that it is
  // genuinely NOT gray (channels differ) so the test can't pass on grayscale.
  expect(r.px[0]).toBeLessThan(60);
  expect(r.px[1]).toBeGreaterThan(80);
  expect(r.px[2]).toBeGreaterThan(130);
  expect(Math.abs(r.px[1] - r.px[0])).toBeGreaterThan(30); // not grayscale
});
