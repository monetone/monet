import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Sketch ▸ Torn Edges ───────────────────────────────────
// Foreground/background Sketch filter: Image Balance controls coverage,
// Smoothness washes fine detail, and Contrast hardens ragged paper tears.
// pick_color packs 0xRRGGBBAA (R>>24, G>>16, B>>8).

const chan = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255, { x, y, shift });

async function setPaperColours(page: Page) {
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.setForeground({ h: 0, s: 0, v: 0, a: 1 }); // black torn foreground
    mv.store.setBackground({ h: 0, s: 0, v: 1, a: 1 }); // white paper
  });
}

test("Torn Edges image balance inks a midtone and remains undoable", async ({ page }) => {
  await gotoApp(page);
  await setPaperColours(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "torn-edges-balance");
    const E = mv.engine.engine;
    E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none();
    mv.engine.commit();
    mv.fil.tornEdges(0.8, 1, 1);
  });
  expect(await chan(page, 16, 16, 24)).toBeLessThan(60);
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await chan(page, 16, 16, 24)).toBe(128);
});

test("Torn Edges makes a ragged high-contrast boundary but leaves interiors stable", async ({ page }) => {
  await gotoApp(page);
  await setPaperColours(page);
  const result = await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(32, 32, "torn-edges-boundary");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 16, 32, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(16, 0, 16, 32, 0); E.fill_selection(255, 255, 255, 255);
    E.select_none(); mv.engine.commit();
    mv.fil.tornEdges(0.5, 0, 1);
    const R = (x: number, y: number) => ((E.pick_color(x, y) >>> 0) >>> 24) & 255;
    let paperHole = false; let inkFleck = false; let farDarkOk = true; let farLightOk = true;
    for (let y = 0; y < 32; y++) {
      paperHole ||= R(15, y) > 180;
      inkFleck ||= R(16, y) < 80;
      farDarkOk &&= R(4, y) < 40;
      farLightOk &&= R(27, y) > 215;
    }
    return { paperHole, inkFleck, farDarkOk, farLightOk };
  });
  expect(result.paperHole).toBe(true);
  expect(result.inkFleck).toBe(true);
  expect(result.farDarkOk).toBe(true);
  expect(result.farLightOk).toBe(true);
});

test("the Torn Edges dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "torn-edges-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Torn Edges…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Torn Edges…")).run());
  await expect(page.getByText("Image Balance")).toBeVisible();
});
