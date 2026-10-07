import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { buildAco, parseAco } from "@monet-ui/monet-imageio";

// End-to-end Adobe .aco swatch import/export — Photoshop's Swatches panel
// reads/writes .aco colour libraries. Drives store.importSwatches through the
// live app via the exposed app API (window.__mv.importSwatchesAco). The .aco
// bytes are built in Node with the same pure module the app uses.

const imported = ["#112233", "#445566", "#8899aa", "#ff8800"];

test("imports colours from an .aco file into the swatch library", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAco(imported));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    const added = mv.importSwatchesAco(new Uint8Array(b));
    return { before, added, swatches: mv.store.state.swatches as string[] };
  }, bytes);

  expect(r.added).toBe(imported.length);
  expect(r.swatches.length).toBe(r.before + imported.length);
  for (const hex of imported) expect(r.swatches).toContain(hex);
});

test("de-duplicates a re-imported file (adds nothing the second time)", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAco(imported));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const first = mv.importSwatchesAco(new Uint8Array(b));
    const second = mv.importSwatchesAco(new Uint8Array(b)); // same file again
    return { first, second };
  }, bytes);

  expect(r.first).toBe(imported.length);
  expect(r.second).toBe(0);
});

test("ignores an invalid/corrupt .aco without throwing", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    const added = mv.importSwatchesAco(new Uint8Array([0x3c, 0x21, 0x64, 0x6f, 0x63])); // "<!doc" — HTML, not .aco
    return { before, added, after: mv.store.state.swatches.length };
  });
  expect(r.added).toBe(0);
  expect(r.after).toBe(r.before);
});

test("exports the library to bytes that round-trip back to the same colours", async ({ page }) => {
  await gotoApp(page);
  // Import a known set, then read back the whole live library (defaults + import)
  // and confirm buildAco → parseAco reproduces it exactly, i.e. Export ▸ Import
  // is lossless.
  const library = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    mv.importSwatchesAco(new Uint8Array(b));
    return mv.store.state.swatches as string[];
  }, Array.from(buildAco(imported)));

  expect(library).toEqual(expect.arrayContaining(imported));
  expect(parseAco(buildAco(library))).toEqual(library);
});
