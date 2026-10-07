import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Physics Debug Draw (Unity Physics 2D Debugger / collider gizmos):
// a project toggle that flips Phaser's arcade GameConfig `debug`, drawing every
// body's outline + velocity vector in the played/exported game. Default off.
// Specs drive cmd.updateProject + assert the exported config + the model.
// Under the `desktop` project the last test doubles as the CSP smoke.

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));
const physicsDebug = (page: Page) => page.evaluate(() => window.__mj.store.getProject().physicsDebug);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("physicsDebug defaults to false and the export draws nothing", async ({ page }) => {
  expect(await physicsDebug(page)).toBe(false);
  expect(await exportJs(page)).toContain("debug: false }");
});

test("toggling physicsDebug on emits the arcade debug flag", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ physicsDebug: true }));
  expect(await physicsDebug(page)).toBe(true);
  const js = await exportJs(page);
  expect(js).toContain("debug: true }");
  expect(js).not.toContain("debug: false");
});

test("physicsDebug round-trips through .jouer", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ physicsDebug: true }));
  const back = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    return jouer.projectFromJson(jouer.projectToJson(store.getProject())).physicsDebug;
  });
  expect(back).toBe(true);
});

test("physics debug runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => window.__mj.cmd.updateProject({ physicsDebug: true }));
  expect(await exportJs(page)).toContain("debug: true }");
  expect(await cspViolations(page)).toEqual([]);
});
