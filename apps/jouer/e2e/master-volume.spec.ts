import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Master Volume (AudioListener.volume / audio master): a project-level
// global volume (0..1) that scales every sound the exported game plays. The exported
// game sets the Phaser global sound manager volume; the editor preview runs noAudio
// (silent), so this is export-only. Specs drive cmd.updateProject + assert the
// exported config + the model. Under the `desktop` project the last test is the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const masterVolume = (page: Page) => page.evaluate(() => window.__mj.store.getProject().masterVolume);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("masterVolume defaults to 1 and the export sets no global volume", async ({ page }) => {
  expect(await masterVolume(page)).toBe(1);
  expect(await exportJs(page)).not.toContain("this.sound.volume");
});

test("a lowered master volume sets the global sound volume", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ masterVolume: 0.3 }));
  expect(await masterVolume(page)).toBe(0.3);
  expect(await exportJs(page)).toContain("this.sound.volume = 0.3;");
});

test("masterVolume round-trips through .jouer", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ masterVolume: 0.6 }));
  const back = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    return jouer.projectFromJson(jouer.projectToJson(store.getProject())).masterVolume;
  });
  expect(back).toBe(0.6);
});

test("master volume runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ masterVolume: 0.3 }));
  expect(await exportJs(page)).toContain("this.sound.volume = 0.3;");
  expect(await cspViolations(page)).toEqual([]);
});
