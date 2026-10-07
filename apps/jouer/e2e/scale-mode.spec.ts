import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Game Scale Mode (Resolution & Presentation / Game View aspect):
// a project setting that drives the Phaser Scale Manager in the played/exported
// game. "fit" letterboxes the base resolution to the window, "fixed" renders at
// the exact base resolution, "resize" fills the window. Default "fit". Specs drive
// cmd.updateProject + assert the exported config + the model.
// Under the `desktop` project the last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const scaleMode = (page: Page) => page.evaluate(() => window.__mj.store.getProject().scaleMode);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("scaleMode defaults to 'fit' and the export fits the window", async ({ page }) => {
  expect(await scaleMode(page)).toBe("fit");
  expect(await exportJs(page)).toContain("scale: { mode: Phaser.Scale.FIT, autoCenter: Phaser.Scale.CENTER_BOTH },");
});

test("'resize' fills the window with no autoCenter", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ scaleMode: "resize" }));
  expect(await scaleMode(page)).toBe("resize");
  const js = await exportJs(page);
  expect(js).toContain("scale: { mode: Phaser.Scale.RESIZE },");
  expect(js).not.toContain("CENTER_BOTH");
});

test("'fixed' renders at the exact base resolution", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ scaleMode: "fixed" }));
  expect(await exportJs(page)).toContain("scale: { mode: Phaser.Scale.NONE, autoCenter: Phaser.Scale.CENTER_BOTH },");
});

test("scaleMode round-trips through .jouer", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ scaleMode: "resize" }));
  const back = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    return jouer.projectFromJson(jouer.projectToJson(store.getProject())).scaleMode;
  });
  expect(back).toBe("resize");
});

test("scale mode runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ scaleMode: "resize" }));
  expect(await exportJs(page)).toContain("scale: { mode: Phaser.Scale.RESIZE },");
  expect(await cspViolations(page)).toEqual([]);
});
