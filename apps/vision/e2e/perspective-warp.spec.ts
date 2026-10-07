import { test, expect, type Page } from "@playwright/test";
import { gotoApp, newScene, composite } from "./helpers";

// ── Photoshop Edit ▸ Perspective Warp ──────────────────────────────
// Adobe: Perspective Warp moves each of the layer's four corners independently
// (an arbitrary quad), unlike the symmetric keystone. Vision wires per-corner
// offsets to the engine's general homography (perspective_transform).
//   https://helpx.adobe.com/photoshop/using/perspective-warp.html

type Offset = { dx: number; dy: number };
const warp = (page: Page, offsets: Offset[]) =>
  page.evaluate((o) => (window as any).__mv.perspectiveWarp(o), offsets);

test.beforeEach(async ({ page }) => { await gotoApp(page); await newScene(page, 240, 180); });

test("Edit ▸ Transform ▸ Distort opens Perspective Warp (the real arbitrary-corner distort)", async ({ page }) => {
  // Free Transform only scales/rotates/moves; PS "Distort" moves corners freely.
  // The menu item now routes to the Perspective Warp dialog (was Free Transform).
  await page.waitForFunction(() => (window as any).__mv.commandPalette?.items?.some((i: any) => i.label.endsWith("▸ Distort")), null, { timeout: 5000 });
  await page.evaluate(() => (window as any).__mv.commandPalette.items.find((i: any) => i.label.endsWith("▸ Distort")).run());
  await expect(page.getByText(/Move each corner independently/i)).toBeVisible();
});

test("moving corners independently changes the composite and preserves dimensions", async ({ page }) => {
  const before = await composite(page);
  // Pull the two top corners inward + down — a trapezoid the symmetric keystone
  // could make, but with independent corners.
  await warp(page, [{ dx: 15, dy: 10 }, { dx: -15, dy: 10 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }]);
  const after = await composite(page);
  expect(after.chk).not.toBe(before.chk);          // pixels moved
  expect(after.w).toBe(240); expect(after.h).toBe(180); // dims unchanged
});

test("an asymmetric single-corner warp differs from its mirror (true arbitrary quad)", async ({ page }) => {
  await warp(page, [{ dx: 30, dy: 20 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }]); // only TL
  const tlOnly = (await composite(page)).chk;
  await page.evaluate(() => (window as any).__mv.engine.engine.undo());
  await page.evaluate(() => (window as any).__mv.engine.commit());
  await warp(page, [{ dx: 0, dy: 0 }, { dx: -30, dy: 20 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }]); // only TR
  const trOnly = (await composite(page)).chk;
  expect(tlOnly).not.toBe(trOnly); // corners really are independent (not a symmetric keystone)
});

test("successive warps each change the composite and never change the dimensions (soak)", async ({ page }) => {
  let prev = (await composite(page)).chk;
  const sequence: Offset[][] = [
    [{ dx: 20, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }],
    [{ dx: 0, dy: 0 }, { dx: -18, dy: 6 }, { dx: 0, dy: 0 }, { dx: 0, dy: 0 }],
    [{ dx: 8, dy: 8 }, { dx: -8, dy: 8 }, { dx: -8, dy: -8 }, { dx: 8, dy: -8 }],
  ];
  for (const offsets of sequence) {
    await warp(page, offsets);
    const c = await composite(page);
    expect(c.w).toBe(240); expect(c.h).toBe(180);
    expect(c.chk).not.toBe(prev);
    prev = c.chk;
  }
});
