import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Texture ▸ Grain ───────────────────────────────────────
// Adobe: Grain "adds texture to an image by simulating different kinds of film grain"
// via a Grain Type menu (Regular/Soft/Sprinkles/Clumped/Contrasty/Enlarged/Stippled/
// Horizontal/Vertical/Speckle) with Intensity + Contrast. Vision's engine filter
// (filter_texture_grain) adds one monochromatic delta per pixel for the additive modes
// (a gray field stays neutral, R==G==B) and bg-coloured specks for Sprinkles/Stippled —
// the last unshipped member of the Texture group, distinct from Artistic ▸ Film Grain.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function grayDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(16, 16, name);
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  }, name);
}

test("Regular grain varies a flat field while staying neutral, and undoes", async ({ page }) => {
  await gotoApp(page);
  await grayDoc(page, "grain-regular");
  const stats = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.fil.grain(0.8, 0, 0); // Regular, high intensity, no contrast
    const E = mv.engine.engine;
    let lo = 255, hi = 0, neutral = true;
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) {
      const p = E.pick_color(x, y) >>> 0;
      const r = (p >>> 24) & 255, g = (p >>> 16) & 255, b = (p >>> 8) & 255;
      if (r !== g || g !== b) neutral = false; // monochromatic grain
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    return { lo, hi, neutral };
  });
  expect(stats.neutral).toBe(true); // a gray field stays neutral (R==G==B)
  expect(stats.hi - stats.lo).toBeGreaterThan(20); // the flat field is grained
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 8, 8, 24)).toBe(128); // undo → flat gray restored
});

test("Horizontal grain is row-constant", async ({ page }) => {
  await gotoApp(page);
  await grayDoc(page, "grain-horizontal");
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.fil.grain(0.8, 0, 7); // Horizontal
    const E = mv.engine.engine;
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    let rowsUniform = true, rowsDiffer = false;
    const first = R(0, 0);
    for (let y = 0; y < 16; y++) {
      const v0 = R(0, y);
      for (let x = 0; x < 16; x++) if (R(x, y) !== v0) rowsUniform = false;
      if (v0 !== first) rowsDiffer = true;
    }
    return { rowsUniform, rowsDiffer };
  });
  expect(out.rowsUniform).toBe(true); // every pixel in a row shares the grain delta
  expect(out.rowsDiffer).toBe(true); // rows carry different grain
});

test("the Grain dialog opens from the Filter menu with the Grain Type dropdown", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "grain-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Grain…") && !i.label.includes("Film")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Grain…") && !i.label.includes("Film")).run());
  await expect(page.getByText("Grain Type")).toBeVisible();
  await expect(page.getByText("Intensity")).toBeVisible();
});
