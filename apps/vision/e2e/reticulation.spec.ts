import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Reticulation ────────────────────────────────
// Foreground/background Sketch filter: Density clusters midtones into film-like
// grain; Foreground/Background Level expand the shadow/highlight colour zones.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function setReticulationColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red shadow emulsion
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue highlight grain
  });
}

test("Reticulation maps shadows to foreground, highlights to background, and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await setReticulationColours(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 16, "reticulation-tones");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
    mv.fil.reticulation(0.5, 1, 1);
    const c = (x: number, y: number, shift: number) => ((E.pick_color(x, y) >>> 0) >>> shift) & 255;
    return { leftR: c(8, 8, 24), leftB: c(8, 8, 8), rightR: c(24, 8, 24), rightB: c(24, 8, 8) };
  });
  expect(result.leftR).toBeGreaterThan(180);
  expect(result.leftB).toBeLessThan(80);
  expect(result.rightB).toBeGreaterThan(180);
  expect(result.rightR).toBeLessThan(80);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 8, 8, 24)).toBe(0);
  expect(await chan(page, 24, 8, 24)).toBe(255);
});

test("Reticulation density breaks a flat midtone into clustered grain", async ({ page }) => {
  await gotoApp(page);
  await setReticulationColours(page);
  const spreads = await page.evaluate(() => {
    const mv = (window as any).__mv;
    const measure = (density: number) => {
      mv.store.newDocument(32, 32, `reticulation-density-${density}`);
      const E = mv.engine.engine;
      E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
      mv.engine.commit();
      mv.fil.reticulation(density, 0.55, 0.55);
      let lo = 255; let hi = 0;
      for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
        const r = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
      return hi - lo;
    };
    return { low: measure(0), high: measure(1) };
  });
  expect(spreads.high).toBeGreaterThan(spreads.low + 40);
});

test("the Reticulation dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "reticulation-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Reticulation…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Reticulation…")).run());
  await expect(page.getByText("Density")).toBeVisible();
  await expect(page.getByText("Foreground Level")).toBeVisible();
});
