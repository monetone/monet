import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Start Scene (Scenes In Build first entry / Set as Start Scene): the
// EXPORTED game boots the designated start scene, decoupled from the edited active
// scene; unset ⇒ it falls back to the active scene. Export-only — the editor still
// previews the active scene. Specs drive window.__mj and the scene-panel ▶ toggle.
// Under the `desktop` project the last test doubles as the CSP smoke.

const firstClass = (js: string) => js.match(/scene: \[(\w+)/)?.[1];
const order = (js: string) => js.match(/scene: \[([^\]]+)\]/)?.[1].split(", ");
const exportJs = (page: Page) => page.evaluate(() => window.__mj.exporter.exportGameJs(window.__mj.store.getProject()));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the exported game boots the chosen start scene; clearing falls back to the active scene", async ({ page }) => {
  // Two scenes; adding the 2nd makes it the active scene.
  const first = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const f = store.getProject().scenes[0].id;
    cmd.addScene(); // a 2nd scene, now active
    return f;
  });
  const def = await exportJs(page); // no start scene → the active (2nd) scene boots first
  await page.evaluate((first) => window.__mj.cmd.setStartScene(first), first);
  expect(await page.evaluate(() => window.__mj.store.getProject().startSceneId)).toBe(first);
  const withStart = await exportJs(page);
  expect(firstClass(withStart)).not.toBe(firstClass(def)); // boot scene changed
  expect(firstClass(withStart)).toBe(order(def)?.[1]); // the 1st scene led the array, was 2nd by default

  await page.evaluate(() => window.__mj.cmd.setStartScene(null)); // clear → fall back to active
  expect(await page.evaluate(() => window.__mj.store.getProject().startSceneId)).toBeNull();
  expect(firstClass(await exportJs(page))).toBe(firstClass(def)); // back to the active scene
});

test("the scene-panel start toggle sets the start scene in the model", async ({ page }) => {
  const first = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const f = store.getProject().scenes[0].id;
    cmd.addScene(); // a 2nd scene so the first is a non-active candidate
    return f;
  });
  await page.locator(`[data-scene-id="${first}"]`).getByTestId("set-start-scene").click();
  expect(await page.evaluate(() => window.__mj.store.getProject().startSceneId)).toBe(first);
});

test("deleting the start scene clears it (falls back to the active scene)", async ({ page }) => {
  const cleared = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const first = store.getProject().scenes[0].id;
    cmd.addScene(); // a 2nd scene so the first can be deleted (always keep one)
    cmd.setStartScene(first);
    cmd.deleteScene(first); // deleting the start scene clears startSceneId
    return store.getProject().startSceneId;
  });
  expect(cleared).toBeNull();
});

test("start scene runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const first = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const f = store.getProject().scenes[0].id;
    cmd.addScene();
    cmd.setStartScene(f);
    return f;
  });
  expect(await page.evaluate(() => window.__mj.store.getProject().startSceneId)).toBe(first);
  expect(await cspViolations(page)).toEqual([]);
});
