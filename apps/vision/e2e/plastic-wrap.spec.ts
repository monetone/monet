import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Plastic Wrap ───────────────────────────────
// Adobe: Plastic Wrap "coats the image in shiny plastic, accentuating surface detail as
// though shrink-wrapped." Vision's engine filter (filter_plastic_wrap) adds a white specular
// highlight along the luma-gradient curvature, additive over the kept image — flats stay
// untouched, only ridges/edges gain a sheen. Distinct from the edge/relief family (Find
// Edges/Emboss/Bas Relief/Accented Edges/Ink Outlines) which replace/carve/redraw.
// pick_color packs 0xRRGGBBAA (R>>24).
//   https://helpx.adobe.com/photoshop/using/filter-effects-reference.html

const R = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255), { x, y });

async function splitDoc(page: Page, name: string) {
  await page.evaluate((name) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 16, name);
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
  }, name);
}

test("Plastic Wrap puts a specular sheen on an edge, keeps the interior, and undoes", async ({ page }) => {
  await gotoApp(page);
  await splitDoc(page, "wrap");
  await page.evaluate(() => (window as any).__mv.fil.plasticWrap(1.0, 0, 0)); // full strength, d=1
  expect(await R(page, 15, 8)).toBeGreaterThan(200); // the black column at the boundary lifts to a sheen
  expect(await R(page, 2, 8)).toBeLessThan(30); // the far black interior stays dark (no curvature)
  expect(await R(page, 20, 8)).toBeGreaterThan(230); // the white side stays light
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await R(page, 15, 8)).toBe(0); expect(await R(page, 2, 8)).toBe(0); // undo → split restored
});

test("Plastic Wrap leaves a flat field untouched (no curvature → no sheen)", async ({ page }) => {
  await gotoApp(page);
  const same = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "wrap-flat");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(120, 120, 120, 255); E.select_none();
    mv.engine.commit();
    mv.fil.plasticWrap(1.0, 0.5, 0.5); // full strength, but a flat field has no gradient
    let allSame = true;
    for (let y = 0; y < 24; y++) for (let x = 0; x < 24; x++) if ((((E.pick_color(x, y) >>> 0) >>> 24) & 255) !== 120) allSame = false;
    return allSame;
  });
  expect(same).toBe(true); // no ridges → no specular highlight anywhere
});

test("the Plastic Wrap dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "wrap-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Plastic Wrap…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Plastic Wrap…")).run());
  await expect(page.getByText("Highlight Strength")).toBeVisible();
});
