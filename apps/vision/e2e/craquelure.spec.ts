import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Texture ▸ Craquelure ──────────────────────────────────
// Adobe: Craquelure "paints an image onto a high-relief plaster surface, producing a
// fine network of cracks." Vision adds an engine filter (filter_craquelure): cracks
// follow a value-noise level-set — dark grooves (Crack Depth) with light ridges
// beside them (Crack Brightness), the rest keeping the image. pick_color is 0xRRGGBBAA.
//   https://helpx.adobe.com/photoshop-elements/using/texture-filters.html

// over a flat field: {min R, max R, kept(~128)} and the count of shaded pixels
const scan = (page: Page, sz: number) =>
  page.evaluate((sz) => {
    const E = (window as any).__mv.engine.engine;
    let lo = 255, hi = 0, kept = 0, shaded = 0;
    for (let y = 0; y < sz; y++) for (let x = 0; x < sz; x++) {
      const v = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      lo = Math.min(lo, v); hi = Math.max(hi, v);
      if (Math.abs(v - 128) <= 6) kept++;
      if (Math.abs(v - 128) > 10) shaded++;
    }
    return { lo, hi, kept, shaded };
  }, sz);

async function grayDoc(page: Page, name: string, sz: number) {
  await page.evaluate(({ name, sz }) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(sz, sz, name);
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
  }, { name, sz });
}

test("Craquelure grows a crack network over a flat field, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await grayDoc(page, "craquelure", 40);
  await page.evaluate(() => (window as any).__mv.fil.craquelure(6, 0.9, 0.6));
  const s = await scan(page, 40);
  expect(s.lo).toBeLessThan(60); // dark crack grooves
  expect(s.hi).toBeGreaterThan(200); // light ridges
  expect(s.kept).toBeGreaterThan(40 * 40 / 2); // most of the field keeps its colour (plaster)
  await page.evaluate(() => (window as any).__mv.store.undo());
  const back = await scan(page, 40);
  expect(back.lo).toBe(128); expect(back.hi).toBe(128); // undo → flat gray again
});

test("Craquelure's Crack Spacing controls crack density", async ({ page }) => {
  await gotoApp(page);
  await grayDoc(page, "craquelure-tight", 40);
  await page.evaluate(() => (window as any).__mv.fil.craquelure(4, 0.9, 0.6));
  const tight = (await scan(page, 40)).shaded;
  await grayDoc(page, "craquelure-loose", 40);
  await page.evaluate(() => (window as any).__mv.fil.craquelure(16, 0.9, 0.6));
  const loose = (await scan(page, 40)).shaded;
  expect(tight).toBeGreaterThan(loose); // a smaller crack spacing yields more cracks
});

test("the Craquelure dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "craquelure-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Craquelure…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Craquelure…")).run());
  await expect(page.getByText("Crack Spacing")).toBeVisible();
});
