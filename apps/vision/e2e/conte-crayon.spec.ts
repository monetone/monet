import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Conté Crayon ────────────────────────────────
// Foreground/background Sketch filter: dark tones use the foreground crayon,
// light tones use the background crayon, and Relief embosses the selected paper
// texture. pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function setCrayonColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 }); // red foreground crayon
    mv.store.setBackground({ h: 240, s: 1, v: 1, a: 1 }); // blue background crayon
  });
}

test("Conte Crayon maps shadows to foreground, highlights to background, and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await setCrayonColours(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 16, "conte-crayon-tones");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 16, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(16, 0, 16, 16, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
    mv.fil.conteCrayon(1, 1, 0, 0.5, 0, 0);
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

test("Conte Crayon relief embosses a flat midtone with paper texture", async ({ page }) => {
  await gotoApp(page);
  await setCrayonColours(page);
  const spread = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "conte-crayon-relief");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.conteCrayon(0, 0, 2, 0.5, 1, 0);
    let lo = 255; let hi = 0;
    for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
      const r = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
      lo = Math.min(lo, r); hi = Math.max(hi, r);
    }
    return hi - lo;
  });
  expect(spread).toBeGreaterThan(25);
});

test("the Conte Crayon dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "conte-crayon-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Conté Crayon…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Conté Crayon…")).run());
  await expect(page.getByText("Foreground Level")).toBeVisible();
  await expect(page.getByText("Texture")).toBeVisible();
});
