import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Distort ▸ Glass ───────────────────────────────────────
// Adobe: Glass "makes an image appear as if it were being viewed through different
// types of glass", with Distortion / Smoothness / Texture / Scaling. Vision adds an
// engine filter (Engine::glass): it refracts the image by the GRADIENT of a procedural
// surface texture (Frosted/Blocks/Canvas) — distinct from Ocean Ripple's noise-value
// field. pick_color packs 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

// min R over a full column
const colMinR = (page: Page, x: number, h: number) =>
  page.evaluate(({ x, h }) => {
    const E = (window as any).__mv.engine.engine;
    let m = 255;
    for (let y = 0; y < h; y++) m = Math.min(m, ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return m;
  }, { x, h });

async function splitDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, name);
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
  }, name);
}

test("Glass refracts a black/white edge so the boundary column warps, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await splitDoc(page, "glass");
  expect(await colMinR(page, 20, 40)).toBe(255); // before: the boundary column (x=20) is solid white
  await page.evaluate(() => (window as any).__mv.distort.glass(0, 0.8, 0.2, 0.5)); // strong, sharp
  expect(await colMinR(page, 20, 40)).toBeLessThan(128); // after: refraction pulls dark pixels across the boundary
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await colMinR(page, 20, 40)).toBe(255); // undo → solid white again
});

test("Glass leaves a flat field's interior unchanged", async ({ page }) => {
  await gotoApp(page);
  const ok = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "glass-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(90, 90, 90, 255); E.select_none();
    mv.engine.commit();
    mv.distort.glass(0, 0.3, 0.5, 0.5);
    for (let y = 12; y < 20; y++) for (let x = 12; x < 20; x++) if ((((E.pick_color(x, y) >>> 0) >>> 24) & 255) !== 90) return false;
    return true;
  });
  expect(ok).toBe(true); // a uniform field's interior resamples to itself
});

test("the Glass dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "glass-dlg"));
  // NB: must exclude "Stained Glass…" which also ends with "Glass…"
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Glass…") && !i.label.includes("Stained")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Glass…") && !i.label.includes("Stained")).run());
  await expect(page.getByText("Glass", { exact: true })).toBeVisible();
});
