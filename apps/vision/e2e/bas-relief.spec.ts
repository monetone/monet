import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Bas Relief ───────────────────────────────────
// Adobe: Bas Relief "transforms an image to appear carved in low relief and lit
// to accent the surface variation. Dark areas of the image take on the foreground
// color; light areas use the background color." A 2-tone fg/bg Sketch filter —
// flat areas settle to the neutral fg↔bg mid blend, slopes (edges) carve toward
// fg/bg, and the Light direction flips which colour an edge takes. pick_color
// packs 0xRRGGBBAA (R>>24, G>>16, B>>8, A>>0).
//   https://helpx.adobe.com/photoshop/using/filter-gallery.html

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => {
    const E = (window as any).__mv.engine.engine;
    return ((E.pick_color(x, y) >>> 0) >>> shift) & 255;
  }, { x, y, shift });

async function inkColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red — shadowed slopes
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue — lit slopes
  });
}

// black left half | white right half (the step is at x=20)
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

test("Bas Relief carves the edge into the fg colour, neutralises flats, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await splitDoc(page, "basrelief");
  // the boundary columns carve toward the foreground red; flat interiors go neutral
  const out = await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    mv.fil.basRelief(12, 1, 6); // lit from the Left → the edge carves red
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    const B = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 8) & 255;
    const G = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 16) & 255;
    let edgeR = 0, edgeB = 255;
    for (const x of [18, 19, 20, 21]) { edgeR = Math.max(edgeR, R(x, 20)); edgeB = Math.min(edgeB, B(x, 20)); }
    return { edgeR, edgeB, interiorG: G(4, 20) };
  });
  expect(out.edgeR).toBeGreaterThan(200); // the edge carved toward the foreground red
  expect(out.edgeB).toBeLessThan(80); // the carve is the red ink, not the blue paper
  expect(out.interiorG).toBeLessThan(20); // a flat interior is recoloured to the neutral fg↔bg mid (no green)
  // undo restores the black/white split
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 4, 20, 24)).toBe(0); // black half is black again
  expect(await chan(page, 36, 20, 24)).toBe(255); // white half is white again
});

test("Bas Relief light direction flips which colour the edge takes", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await splitDoc(page, "basrelief-light");
  const leftEdgeR = await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    mv.fil.basRelief(12, 1, 6); // lit from the Left
    let m = 0; for (const x of [18, 19, 20, 21]) m = Math.max(m, ((E.pick_color(x, 20) >>> 0) >>> 24) & 255);
    mv.store.undo();
    return m;
  });
  const rightEdgeB = await page.evaluate(() => {
    const mv = (window as any).__mv; const E = mv.engine.engine;
    mv.fil.basRelief(12, 1, 2); // lit from the Right
    let m = 0; for (const x of [18, 19, 20, 21]) m = Math.max(m, ((E.pick_color(x, 20) >>> 0) >>> 8) & 255);
    return m;
  });
  expect(leftEdgeR).toBeGreaterThan(200); // lit from the Left → the edge carves the foreground red
  expect(rightEdgeB).toBeGreaterThan(200); // lit from the Right → the edge carves the background blue
});

test("the Bas Relief dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await inkColours(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "basrelief-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Bas Relief…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Bas Relief…")).run());
  await expect(page.getByText("Bas Relief", { exact: true })).toBeVisible();
});
