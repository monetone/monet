import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Graphic Pen ──────────────────────────────────
// Adobe: Graphic Pen renders fine ink strokes in the FOREGROUND colour over a
// BACKGROUND-colour paper, ink density following the tones. Vision adds a new
// engine filter (filter_graphic_pen) via the established 2-tone recipe (mirrors
// Photocopy). pick_color reads back 8-bit channels (engine is 16-bit internally).
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const px = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => { const p = (window as any).__mv.engine.engine.pick_color(x, y) >>> 0; return { r: (p >>> 24) & 255, g: (p >>> 16) & 255, b: (p >>> 8) & 255 }; }, { x, y });

const sampleR = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    const pts = [[5, 5], [12, 8], [19, 14], [26, 6], [33, 11], [8, 22], [17, 28], [24, 19], [31, 31], [13, 35], [29, 24], [21, 3]];
    return pts.map(([x, y]) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255);
  });

// Set fg=red / bg=blue and fill the layer flat at value v.
async function setup(page: Page, v: number) {
  await page.evaluate((val) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "graphicpen");
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red ink
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue paper
    const E = mv.engine.engine;
    E.select_all();
    E.fill_selection(val, val, val, 255);
    E.select_none();
    mv.engine.commit();
  }, v);
}

test("a dark field inks the foreground colour; it is undoable", async ({ page }) => {
  await gotoApp(page);
  await setup(page, 0); // black
  await page.evaluate(() => (window as any).__mv.fil.graphicPen(0.3, 0.5, 0));
  const c = await px(page, 20, 20);
  expect(c.r).toBeGreaterThan(200); // inked the foreground red
  expect(c.b).toBeLessThan(60);
  await page.evaluate(() => (window as any).__mv.store.undo());
  const back = await px(page, 20, 20);
  expect(back.r).toBe(0); // undo restored the black field
});

test("a light field stays the background paper colour", async ({ page }) => {
  await gotoApp(page);
  await setup(page, 255); // white
  await page.evaluate(() => (window as any).__mv.fil.graphicPen(0.3, 0.5, 0));
  const c = await px(page, 20, 20);
  expect(c.b).toBeGreaterThan(200); // the background blue paper
  expect(c.r).toBeLessThan(60);
});

test("a midtone hatches both tones", async ({ page }) => {
  await gotoApp(page);
  await setup(page, 128); // gray
  await page.evaluate(() => (window as any).__mv.fil.graphicPen(0.3, 0.5, 0));
  const after = await sampleR(page);
  expect(new Set(after).size).toBeGreaterThan(1); // a mix of red ink + blue paper
});

test("the Graphic Pen dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await setup(page, 128);
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Graphic Pen…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Graphic Pen…")).run());
  await expect(page.getByText("Light/Dark Balance")).toBeVisible();
});
