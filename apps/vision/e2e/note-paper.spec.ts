import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Note Paper ───────────────────────────────────
// A foreground/background Sketch filter: Image Balance controls ink coverage,
// Graininess adds paper tooth, and Relief shades the paper surface.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function setPaperColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black ink
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white paper
  });
}

test("Note Paper image balance inks a midtone and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await setPaperColours(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "note-paper-balance");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.notePaper(0.8, 0, 0);
  });
  expect(await chan(page, 16, 16, 24)).toBeLessThan(60);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 16, 16, 24)).toBe(128);
});

test("Note Paper graininess textures a flat field", async ({ page }) => {
  await gotoApp(page);
  await setPaperColours(page);
  const spread = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "note-paper-grain");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.notePaper(0.5, 1, 0);
    let lo = 255; let hi = 0;
    for (let y = 0; y < 32; y++) {
      for (let x = 0; x < 32; x++) {
        const r = ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
        lo = Math.min(lo, r); hi = Math.max(hi, r);
      }
    }
    return hi - lo;
  });
  expect(spread).toBeGreaterThan(120);
});

test("the Note Paper dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "note-paper-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Note Paper…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Note Paper…")).run());
  await expect(page.getByText("Image Balance")).toBeVisible();
});
