import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Water Paper ─────────────────────────────────
// Source-colour Sketch filter: Fiber Length flows pigment along the paper
// grain, Brightness shifts exposure, and Contrast strengthens blotchy tooth.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

test("Water Paper brightness lifts a flat field and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "water-paper-brightness");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(120, 120, 120, 255); E.select_none();
    mv.engine.commit();
    mv.fil.waterPaper(0.4, 0.9, 0.5);
  });
  expect(await chan(page, 16, 16, 24)).toBeGreaterThan(160);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 16, 16, 24)).toBe(120);
});

test("Water Paper fiber length flows pigment across a high-contrast edge", async ({ page }) => {
  await gotoApp(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const makeSplit = (name: string) => {
      mv.store.newDocument(32, 32, name);
      const E = mv.engine.engine;
      E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255);
      E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255);
      E.select_none(); mv.engine.commit();
      return E;
    };
    let E = makeSplit("water-paper-short");
    mv.fil.waterPaper(0, 0.5, 0.5);
    const shortDarkEdge = ((E.pick_color(14, 16) >>> 0) >>> 24) & 255;
    const shortLightEdge = ((E.pick_color(17, 16) >>> 0) >>> 24) & 255;
    E = makeSplit("water-paper-long");
    mv.fil.waterPaper(1, 0.5, 0.5);
    const longDarkEdge = ((E.pick_color(14, 16) >>> 0) >>> 24) & 255;
    const longLightEdge = ((E.pick_color(17, 16) >>> 0) >>> 24) & 255;
    return { shortDarkEdge, shortLightEdge, longDarkEdge, longLightEdge };
  });
  expect(result.longDarkEdge).toBeGreaterThan(result.shortDarkEdge + 35);
  expect(result.longLightEdge).toBeLessThan(result.shortLightEdge - 35);
});

test("the Water Paper dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "water-paper-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Water Paper…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Water Paper…")).run());
  await expect(page.getByText("Fiber Length")).toBeVisible();
});
