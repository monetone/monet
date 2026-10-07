import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Brush Strokes ▸ Angled Strokes ────────────────────────
// Adobe: Angled Strokes "repaints an image using diagonal strokes, with strokes in
// lighter areas going in the opposite direction of strokes in darker areas." A
// tone-dependent directional blur: light pixels smear along one diagonal, dark
// pixels along the opposite. Vision adds an engine filter (filter_angled_strokes).
// pick_color packs 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop-elements/using/brush-stroke-filters.html

// max / min R over a band [x0,x1) × [0,h)
const bandR = (page: Page, x0: number, x1: number, h: number) =>
  page.evaluate(({ x0, x1, h }) => {
    const E = (window as any).__mv.engine.engine;
    const rs: number[] = [];
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) rs.push(((E.pick_color(x, y) >>> 0) >>> 24) & 255);
    return { max: Math.max(...rs), min: Math.min(...rs), hasGray: rs.some((v) => v > 60 && v < 200) };
  }, { x0, x1, h });

async function splitDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, name);
    const E = mv.engine.engine;
    E.select_rect(0, 0, 12, 24, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(12, 0, 12, 24, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
  }, name);
}

test("Angled Strokes smears the edge diagonally into gray while far regions stay pure, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await splitDoc(page, "angled");
  await page.evaluate(() => (window as any).__mv.fil.angledStrokes(6, 0.5, 0)); // full smear
  expect((await bandR(page, 8, 16, 24)).hasGray).toBe(true); // the boundary smears into intermediate gray
  expect((await bandR(page, 0, 4, 24)).max).toBeLessThan(30); // far black half stays black
  expect((await bandR(page, 20, 24, 24)).min).toBeGreaterThan(230); // far white half stays white
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect((await bandR(page, 0, 12, 24)).max).toBe(0); // undo → black half solid black again
  expect((await bandR(page, 12, 24, 24)).min).toBe(255); // undo → white half solid white again
});

test("Angled Strokes leaves a flat field unchanged", async ({ page }) => {
  await gotoApp(page);
  const ok = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(20, 20, "angled-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(90, 90, 90, 255); E.select_none();
    mv.engine.commit();
    mv.fil.angledStrokes(6, 0.5, 0);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) if ((((E.pick_color(x, y) >>> 0) >>> 24) & 255) !== 90) return false;
    return true;
  });
  expect(ok).toBe(true); // a directional average of a uniform field is the field
});

test("the Angled Strokes dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "angled-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Angled Strokes…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Angled Strokes…")).run());
  await expect(page.getByText("Direction Balance")).toBeVisible();
});
