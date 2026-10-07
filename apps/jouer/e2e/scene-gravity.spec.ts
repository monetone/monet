import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity 2D gravity vector (Physics2D.gravity is a Vector2 — X + Y). Jouer
// already had scene gravityY; this adds gravityX so games can use sideways gravity
// / wind / zero-G. Like camera scroll + zoom it is game/export only — the editor
// never simulates physics — so specs assert the model, the .jouer round-trip and
// the exported Phaser code. Under the `desktop` project the last test is the CSP smoke.

const setGravity = (page: Page, x: number, y: number) =>
  page.evaluate(({ x, y }) => {
    const { cmd, store } = window.__mj;
    cmd.updateScene(store.getProject().activeSceneId, { gravityX: x, gravityY: y });
  }, { x, y });

const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the gravity vector is preserved in the model and round-trips through .jouer", async ({ page }) => {
  await setGravity(page, 300, -120);
  const r = await page.evaluate(() => {
    const { store, jouer } = window.__mj;
    const live = store.getProject().scenes.find((s: any) => s.id === store.getProject().activeSceneId);
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const bs = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return { live: { x: live.gravityX, y: live.gravityY }, back: { x: bs.gravityX, y: bs.gravityY } };
  });
  expect(r).toEqual({ live: { x: 300, y: -120 }, back: { x: 300, y: -120 } });
});

test("the exported game sets the arcade world gravity x and y", async ({ page }) => {
  await setGravity(page, 300, 980);
  const js = await exportJs(page);
  expect(js).toContain("this.physics.world.gravity.x = 300;");
  expect(js).toContain("this.physics.world.gravity.y = 980;");
});

test("a default (0,0) scene emits no world gravity setup", async ({ page }) => {
  // Fresh project: gravityX/gravityY default to 0 → no world.gravity lines.
  const js = await exportJs(page);
  expect(js).not.toContain("world.gravity.x");
  expect(js).not.toContain("world.gravity.y");
});

test("sideways-only gravity emits just the x component", async ({ page }) => {
  await setGravity(page, 250, 0);
  const js = await exportJs(page);
  expect(js).toContain("this.physics.world.gravity.x = 250;");
  expect(js).not.toContain("world.gravity.y");
});

test("scene gravity runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await setGravity(page, 60, 30);
  expect(await page.evaluate(() => {
    const s = window.__mj.store.getProject().scenes[0];
    return { x: s.gravityX, y: s.gravityY };
  })).toEqual({ x: 60, y: 30 });
  expect(await cspViolations(page)).toEqual([]);
});
