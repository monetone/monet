import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Gradient Tool ▸ Dither ──────────────────────────────
// Adobe: the gradient options bar has a Dither checkbox that adds a small ordered
// dither so smooth ramps don't band when reduced to 8-bit. Vision adds it via the
// engine gradient_fill `dither` flag (a Bayer-4x4 offset of ~±half an 8-bit step).
// The per-pixel dither behavior is covered by a Rust test; this covers the UI→store
// wiring + that the option reaches the engine.
//   https://helpx.adobe.com/photoshop/using/creating-gradients.html

async function gradientTool(page: Page) {
  await gotoApp(page);
  await page.evaluate(() => {
    const mv = (window as any).__mv;
    mv.store.newDocument(64, 4, "grd");
    mv.store.setTool("gradient");
  });
}

test("the Dither checkbox toggles gradientDither", async ({ page }) => {
  await gradientTool(page);
  const cb = page.getByRole("checkbox", { name: "Dither", exact: true });
  await expect(cb).toBeVisible();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientDither)).toBe(false);
  await cb.click();
  expect(await page.evaluate(() => (window as any).__mv.store.state.gradientDither)).toBe(true);
});

test("a dithered gradient differs from an undithered one (within half a level)", async ({ page }) => {
  await gradientTool(page);
  const { plain, dith } = await page.evaluate(() => {
    const E = (window as any).__mv.engine.engine;
    // A shallow black → (40,40,40) ramp where dithering visibly breaks banding.
    const stops = new Float32Array([0, 0, 0, 0, 1, 1, 40 / 255, 40 / 255, 40 / 255, 1]);
    const row = () => { const r: number[] = []; for (let x = 0; x < 64; x++) r.push((E.pick_color(x, 2) >>> 24) & 255); return r; };
    E.gradient_fill(0, 2, 64, 2, 0, false, stops, false, true, 0, 0, 1);
    const plain = row();
    E.undo();
    E.gradient_fill(0, 2, 64, 2, 0, false, stops, true, true, 0, 0, 1);
    const dith = row();
    return { plain, dith };
  });
  expect(dith).not.toEqual(plain); // dither reached the engine and perturbed the output
  for (let i = 0; i < 64; i++) expect(Math.abs(plain[i] - dith[i])).toBeLessThanOrEqual(1); // proper dither, not noise
});
