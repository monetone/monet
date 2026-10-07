import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Artistic ▸ Neon Glow ──────────────────────────────────
// Adobe: Neon Glow "uses the foreground/background and a glow colour to colorize an
// image while softening its look", tinting by perceived highlights/shadows. Vision
// adds an engine filter (filter_neon_glow): tones map into the glow colour (here the
// foreground) — shadows → dark, midtones → glow, highlights → white. pick_color is
// 0xRRGGBBAA (R>>24, G>>16, B>>8).
//   https://helpx.adobe.com/photoshop-elements/.../artistic-filters.html

async function redGlow(page: Page) {
  await page.evaluate(() => (window as any).__mv.store.setForeground({ h: 0, s: 1, v: 1, a: 1 })); // red glow colour
}
const ch = (page: Page, x: number, y: number, shift: number) =>
  page.evaluate(({ x, y, shift }) => ((((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> shift) & 255), { x, y, shift });

test("Neon Glow keeps shadows dark and highlights light, and is undoable", async ({ page }) => {
  await gotoApp(page);
  await redGlow(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(40, 40, "neon");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 20, 40, 0); E.fill_selection(0, 0, 0, 255); // black left
    E.select_rect(20, 0, 20, 40, 0); E.fill_selection(255, 255, 255, 255); // white right
    E.select_none();
    mv.engine.commit();
    mv.fil.neonGlow(0, 1);
  });
  expect(await ch(page, 10, 20, 24)).toBeLessThan(30); // dark half stays dark
  expect(await ch(page, 30, 20, 24)).toBeGreaterThan(230); // light half stays light
  await page.evaluate(() => (window as any).__mv.store.undo());
  expect(await ch(page, 10, 20, 24)).toBe(0); // undo → black restored
  expect(await ch(page, 30, 20, 24)).toBe(255); // undo → white restored
});

test("Neon Glow recolours midtones toward the glow colour, scaled by Glow Brightness", async ({ page }) => {
  await gotoApp(page);
  await redGlow(page);
  const strong = await page.evaluate(() => {
    const mv = (window as any).__mv; mv.store.newDocument(24, 24, "neon-strong");
    const E = mv.engine.engine; E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none(); mv.engine.commit();
    mv.fil.neonGlow(0, 1);
    const c = E.pick_color(12, 12) >>> 0;
    return { r: (c >>> 24) & 255, g: (c >>> 16) & 255, b: (c >>> 8) & 255 };
  });
  const dimR = await page.evaluate(() => {
    const mv = (window as any).__mv; mv.store.newDocument(24, 24, "neon-dim");
    const E = mv.engine.engine; E.select_all(); E.fill_selection(128, 128, 128, 255); E.select_none(); mv.engine.commit();
    mv.fil.neonGlow(0, 0.3);
    return ((E.pick_color(12, 12) >>> 0) >>> 24) & 255;
  });
  expect(strong.r).toBeGreaterThan(150); expect(strong.g).toBeLessThan(60); expect(strong.b).toBeLessThan(60); // recoloured toward the red glow
  expect(strong.r).toBeGreaterThan(dimR); // a higher Glow Brightness → a stronger glow
});

test("the Neon Glow dialog opens from the Filter menu", async ({ page }) => {
  await gotoApp(page);
  await redGlow(page);
  await page.evaluate(() => (window as any).__mv.store.newDocument(32, 32, "neon-dlg"));
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Neon Glow…")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Neon Glow…")).run());
  await expect(page.getByText("Glow Size")).toBeVisible();
});
