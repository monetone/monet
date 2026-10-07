import { test, expect } from "@playwright/test";
import { gotoApp } from "./helpers";
import { buildAse } from "@monet-ui/monet-imageio";
import { buildAco } from "@monet-ui/monet-imageio";

// End-to-end Adobe Swatch Exchange (.ase) import — Photoshop/Illustrator's
// grouped, named swatch interchange. Drives store.importSwatches through the
// live app via window.__mv.importSwatchesFromBytes, which auto-detects .ase
// (ASEF signature) vs .aco. Bytes are built in Node with the same pure module.

const imported = ["#0a141e", "#28323c", "#8899aa", "#ff8800"];

test("imports colours from an .ase file into the swatch library", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAse(imported));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    const added = mv.importSwatchesFromBytes(new Uint8Array(b));
    return { before, added, swatches: mv.store.state.swatches as string[] };
  }, bytes);

  expect(r.added).toBe(imported.length);
  expect(r.swatches.length).toBe(r.before + imported.length);
  for (const hex of imported) expect(r.swatches).toContain(hex);
});

test("the same entry point still auto-detects and imports .aco", async ({ page }) => {
  await gotoApp(page);
  const acoColours = ["#010203", "#040506"];
  const bytes = Array.from(buildAco(acoColours));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const added = mv.importSwatchesFromBytes(new Uint8Array(b));
    return { added, swatches: mv.store.state.swatches as string[] };
  }, bytes);

  expect(r.added).toBe(acoColours.length);
  for (const hex of acoColours) expect(r.swatches).toContain(hex);
});

test("de-duplicates a re-imported .ase (adds nothing the second time)", async ({ page }) => {
  await gotoApp(page);
  const bytes = Array.from(buildAse(imported));

  const r = await page.evaluate((b) => {
    const mv = (window as any).__mv;
    const first = mv.importSwatchesFromBytes(new Uint8Array(b));
    const second = mv.importSwatchesFromBytes(new Uint8Array(b));
    return { first, second };
  }, bytes);

  expect(r.first).toBe(imported.length);
  expect(r.second).toBe(0);
});

test("ignores an invalid/corrupt swatch file without throwing", async ({ page }) => {
  await gotoApp(page);
  const r = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const before = mv.store.state.swatches.length;
    // "ASEF" signature but the rest is garbage → parses to nothing, no throw.
    const added = mv.importSwatchesFromBytes(new Uint8Array([0x41, 0x53, 0x45, 0x46, 0, 1, 0, 0, 0, 0, 0, 9, 0xff, 0xff]));
    return { before, added, after: mv.store.state.swatches.length };
  });
  expect(r.added).toBe(0);
  expect(r.after).toBe(r.before);
});
