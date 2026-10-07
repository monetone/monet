import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity 2D feature: the 2D Pixel Perfect Camera renders pixel-art crisp —
// nearest-neighbour texture filtering + whole-pixel snapping with no blur. Jouer
// models it as a project-level `pixelArt` flag that flows into the played/exported
// game's Phaser config (`pixelArt: true` ⇒ antialias:false + roundPixels:true +
// NEAREST). Export/played-game only, like Camera Zoom/Scroll — the editor design
// surface is unaffected. Specs drive `window.__mj` + the real inspector toggle and
// assert the model + the exported config. The last test doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a fresh project is not pixel-art and exports pixelArt: false", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { store, exporter } = window.__mj;
    const p = store.getProject();
    return { flag: p.pixelArt, js: exporter.exportGameJs(p) };
  });
  expect(r.flag).toBe(false);
  expect(r.js).toContain("pixelArt: false,");
  expect(r.js).not.toContain("pixelArt: true,");
});

test("the inspector Pixel Art toggle flips the project flag and the exported config", async ({ page }) => {
  // Nothing is selected on load, so the SceneInspector (Project section) is shown.
  const toggle = page.locator('[data-testid="pixel-art"]');
  await expect(toggle).toBeVisible();
  await toggle.click();
  const after = await page.evaluate(() => {
    const { store, exporter } = window.__mj;
    const p = store.getProject();
    return { flag: p.pixelArt, js: exporter.exportGameJs(p) };
  });
  expect(after.flag).toBe(true);
  expect(after.js).toContain("pixelArt: true,");

  // toggling again turns it back off (single CheckLine, idempotent both ways)
  await toggle.click();
  const back = await page.evaluate(() => window.__mj.store.getProject().pixelArt);
  expect(back).toBe(false);
});

test("the Pixel Art toggle is a single undoable step", async ({ page }) => {
  await page.locator('[data-testid="pixel-art"]').click();
  expect(await page.evaluate(() => window.__mj.store.getProject().pixelArt)).toBe(true);
  await page.evaluate(() => window.__mj.cmd.undo());
  expect(await page.evaluate(() => window.__mj.store.getProject().pixelArt)).toBe(false);
});

test("the pixelArt flag round-trips through a .jouer save/load", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, jouer } = window.__mj;
    cmd.updateProject({ pixelArt: true });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    return back.pixelArt;
  });
  expect(r).toBe(true);
});

test("the pixel-art project runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ pixelArt: true }));
  expect(await page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()))).toContain("pixelArt: true,");
  expect(await cspViolations(page)).toEqual([]);
});
