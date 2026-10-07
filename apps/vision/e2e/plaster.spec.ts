import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Plaster ────────────────────────────────────
// Foreground/background Sketch filter: dark areas are raised foreground
// plaster, light areas are sunken background plaster, lit from the chosen
// direction. pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function setPlasterColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red raised plaster
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue sunken plaster
  });
}

test("Plaster maps shadows to raised foreground, highlights to sunken background, and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await setPlasterColours(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 16, "plaster-tones");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
    mv.fil.plaster(0.5, 0, 0);
    const c = (x: number, y: number, shift: number) => ((E.pick_color(x, y) >>> 0) >>> shift) & 255;
    return { leftR: c(8, 8, 24), leftB: c(8, 8, 8), rightR: c(24, 8, 24), rightB: c(24, 8, 8) };
  });
  expect(result.leftR).toBeGreaterThan(200);
  expect(result.leftB).toBeLessThan(80);
  expect(result.rightB).toBeGreaterThan(200);
  expect(result.rightR).toBeLessThan(80);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 8, 8, 24)).toBe(0);
  expect(await chan(page, 24, 8, 24)).toBe(255);
});

test("Plaster light direction brightens the raised dark edge facing the light", async ({ page }) => {
  await gotoApp(page);
  await setPlasterColours(page);
  const edge = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const measure = (light: number) => {
      mv.store.newDocument(32, 16, `plaster-light-${light}`);
      const E = mv.engine.engine;
      E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255);
      E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255);
      E.select_none(); mv.engine.commit();
      mv.fil.plaster(0.5, 0, light);
      return ((E.pick_color(15, 8) >>> 0) >>> 16) & 255;
    };
    return { leftLit: measure(2), rightLit: measure(6) };
  });
  expect(edge.rightLit).toBeGreaterThan(edge.leftLit + 80);
});

test("the Plaster dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "plaster-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Plaster…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Plaster…")).run());
  await expect(page.getByText("Image Balance")).toBeVisible();
  await expect(page.getByText("Smoothness")).toBeVisible();
  await expect(page.getByText("Light Direction")).toBeVisible();
});
