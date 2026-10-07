import { test, expect, type Page } from "@playwright/test";
import { gotoApp } from "./helpers";

// ── Photoshop Image ▸ Adjustments ▸ Shadows/Highlights ─────────────
// PS's "Show More Options" reveals an Adjustments group. Monet shipped only
// Shadows/Highlights Amount + Tonal Width; this adds the two Adjustments
// controls:
//   • Color   — saturation correction of the adjusted (shadow/highlight)
//     regions (chroma scaled about luma, weighted by tonal influence).
//   • Midtone — a midtone-contrast S-curve (fixed at black/mid/white).
//
//   https://helpx.adobe.com/photoshop/using/adjusting-shadow-highlight-detail.html

const D = 32;

async function red(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 24) & 255, { x, y });
}
async function green(page: Page, x: number, y: number): Promise<number> {
  return await page.evaluate(({ x, y }) => (((window as any).__mv.engine.engine.pick_color(x, y) >>> 0) >>> 16) & 255, { x, y });
}

// Left light-midtone (0.70) | right dark-midtone (0.30).
async function twoToneDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "shadows-highlights");
    const E = mv.engine.engine; // capture AFTER newDocument
    E.select_rect(0, 0, d / 2, d, 0); E.fill_selection(179, 179, 179, 255); // 0.70
    E.select_rect(d / 2, 0, d / 2, d, 0); E.fill_selection(76, 76, 76, 255); // 0.30
    E.select_none();
    mv.engine.commit();
  }, D);
}

// A uniform dark muted red — a shadow-band pixel whose chroma the Color
// control can widen.
async function mutedRedDoc(page: Page) {
  await gotoApp(page);
  await page.evaluate((d) => {
    const mv = (window as any).__mv;
    mv.store.newDocument(d, d, "shadows-highlights");
    const E = mv.engine.engine;
    E.select_rect(0, 0, d, d, 0); E.fill_selection(64, 26, 26, 255); // (0.25, 0.10, 0.10)
    E.select_none();
    mv.engine.commit();
  }, D);
}

// ── Midtone raises midtone contrast ────────────────────────────────
test("Midtone raises midtone contrast", async ({ page }) => {
  await twoToneDoc(page);
  const light0 = await red(page, 8, 16);
  const dark0 = await red(page, 24, 16);
  await page.evaluate(() => (window as any).__mv.adj.shadowsHighlights(0, 0, 0, 0, 0, 0.5)); // midtone only
  expect(await red(page, 8, 16)).toBeGreaterThan(light0); // light midtone brightens
  expect(await red(page, 24, 16)).toBeLessThan(dark0);    // dark midtone darkens
});

// ── Color saturates the corrected shadow region ────────────────────
test("Color saturates the corrected shadow region", async ({ page }) => {
  await mutedRedDoc(page);
  const r0 = await red(page, 16, 16);
  const g0 = await green(page, 16, 16);
  await page.evaluate(() => (window as any).__mv.adj.shadowsHighlights(0, 0.5, 0, 0.5, 1, 0)); // color only
  expect(await red(page, 16, 16)).toBeGreaterThan(r0);   // red channel widens from luma
  expect(await green(page, 16, 16)).toBeLessThan(g0);    // green channel narrows toward it
});

// ── UI: the Shadows/Highlights dialog exposes the new controls ─────
test("the Shadows/Highlights dialog exposes Color + Midtone", async ({ page }) => {
  await twoToneDoc(page);
  const opened = await page.evaluate(() => {
    const items = (window as any).__mv.commandPalette.items as Array<{ label: string; run: () => void }>;
    const it = items.find((i) => typeof i.label === "string" && i.label.endsWith("Shadows/Highlights…"));
    if (!it) return false;
    it.run();
    return true;
  });
  expect(opened).toBe(true);
  await page.waitForTimeout(200);
  // Scope to the dialog: bare page-wide getByText("Color") first-matches a
  // hidden blend-mode <option> in the toolbar's brush Mode <select>.
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Midtone", { exact: true }).first()).toBeVisible(); // new control
  await expect(dialog.getByText("Color", { exact: true }).first()).toBeVisible();   // new control
  await page.getByRole("button", { name: "OK", exact: true }).click();
  await page.waitForTimeout(250);
});
