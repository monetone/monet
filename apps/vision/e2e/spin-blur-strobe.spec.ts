import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Filter ▸ Blur ▸ Spin Blur ▸ Motion Effects ▸ Strobe ────────────
// Adobe's Blur Gallery "Motion Effects" Strobe replaces the continuous spin
// smear with a few discrete flash exposures. Vision's spin blur gained a Strobe
// Flashes count: N widely-spaced samples read as distinct ghost images (each
// 1/N as bright) with gaps between them; 0 keeps the smooth blur.
//   https://helpx.adobe.com/photoshop/using/blur-gallery.html
// pick_color packs 0xRRGGBBAA → red is (v >>> 24) & 255.

const maxRedInBand = (page: Page) =>
  page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    let m = 0;
    for (let y = 4; y < 20; y++) for (let x = 1; x < 14; x++) m = Math.max(m, (E.pick_color(x, y) >>> 24) & 255);
    return m;
  });

async function redDot(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(24, 24, "strobe");
    const E = mv.engine.engine;
    E.select_rect(0, 0, 24, 24, 0); E.fill_selection(0, 0, 0, 255);
    E.select_rect(4, 11, 2, 2, 0); E.fill_selection(255, 0, 0, 255); // small red dot, left of centre
    E.select_none(); mv.engine.commit();
  });
}

test("Strobe concentrates the spin smear into brighter discrete flashes", async ({ page }) => {
  await redDot(page);
  await page.evaluate(() => (window as any).__mv.fil.spinBlur(90, 0)); // smooth
  const smooth = await maxRedInBand(page);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.spinBlur(90, 3)); // 3 discrete flashes
  const strobe = await maxRedInBand(page);
  expect(strobe).toBeGreaterThan(smooth + 10); // each flash keeps more of the dot's brightness
});

test("zero Strobe matches the plain spin blur (back-compat)", async ({ page }) => {
  await redDot(page);
  await page.evaluate(() => (window as any).__mv.fil.spinBlur(90)); // 1-arg legacy call → strobe defaults 0
  const legacy = await maxRedInBand(page);
  await page.evaluate(() => (window as any).__mv.store.undo());
  await page.evaluate(() => (window as any).__mv.fil.spinBlur(90, 0)); // explicit 0
  const zero = await maxRedInBand(page);
  expect(zero).toBe(legacy);
});

test("the Spin Blur dialog exposes a Strobe Flashes control", async ({ page }) => {
  await redDot(page);
  await page.waitForFunction(
    () => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("Spin Blur…")),
    null, { timeout: 5000 },
  );
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("Spin Blur…")).run());
  await expect(page.getByText("Strobe Flashes")).toBeVisible();
});
