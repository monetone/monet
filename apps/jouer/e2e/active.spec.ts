import { test, expect, type Page } from "@playwright/test";
import { gotoApp, tick, waitForNode, cspViolations } from "./helpers";

// Unity-parity GameObject active state (GameObject.SetActive / the inspector +
// hierarchy checkbox). An inactive object — and its whole subtree
// (activeInHierarchy cascade) — is hidden in the editor and excluded from the
// exported game (no physics body). Distinct from `visible` (the Scene-Visibility
// eye), which still simulates and does not cascade. Specs drive the live editor
// through `window.__mj` + the panel DOM. Under the `desktop` project the last
// test doubles as the CSP smoke.

const activeOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { query, store } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).active;
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("deactivating hides the live node; reactivating shows it; independent of visible", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 100, y: 100, patch: { name: "Foe" } }));
  await waitForNode(page, id);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(true);

  await page.evaluate((id) => window.__mj.cmd.setActive(id, false), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(false);

  await page.evaluate((id) => window.__mj.cmd.setActive(id, true), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(true);

  // visible (Scene-Visibility eye) and active are independent flags
  await page.evaluate((id) => window.__mj.cmd.setVisible(id, false), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(false);
  expect(await activeOf(page, id)).toBe(true); // still active, just hidden
  await page.evaluate((id) => window.__mj.cmd.setVisible(id, true), id);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), id))!.visible).toBe(true);
});

test("deactivating a container cascades to its children (activeInHierarchy)", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd } = window.__mj;
    const group = cmd.addObject("container", { patch: { name: "Grp" } });
    const child = cmd.addObject("rectangle", { parentId: group, patch: { name: "Kid" } });
    return { group, child };
  });
  await waitForNode(page, ids.child);
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.child))!.visible).toBe(true);

  await page.evaluate((id) => window.__mj.cmd.setActive(id, false), ids.group);
  await tick(page);
  // the child's own active is still true, but it's inactive *in hierarchy*
  expect(await activeOf(page, ids.child)).toBe(true);
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.child))!.visible).toBe(false);
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.group))!.visible).toBe(false);

  await page.evaluate((id) => window.__mj.cmd.setActive(id, true), ids.group);
  await tick(page);
  expect((await page.evaluate((id) => window.__mj.probe(id), ids.child))!.visible).toBe(true);
});

test("an inactive object exports with setActive(false); an active one does not", async ({ page }) => {
  const js = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("rectangle", { patch: { name: "Hero" } });
    cmd.addObject("rectangle", { patch: { name: "Foe", active: false } });
    return window.__mj.exporter.exportGameJs(store.getProject());
  });
  expect(js).toContain("setActive(false)");
  // exactly one object is inactive → exactly one setActive(false)
  expect((js.match(/setActive\(false\)/g) || []).length).toBe(1);
});

test("the active flag survives a .jouer round-trip", async ({ page }) => {
  const active = await page.evaluate(() => {
    const { cmd, store, jouer, query } = window.__mj;
    const id = cmd.addObject("rectangle", { patch: { name: "R", active: false } });
    const back = jouer.projectFromJson(jouer.projectToJson(store.getProject()));
    const scene = back.scenes.find((s: any) => s.id === back.activeSceneId);
    return query.findObject(scene, id).active;
  });
  expect(active).toBe(false);
});

test("the inspector + hierarchy active checkboxes toggle the model", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { patch: { name: "Toggle" } }));
  await waitForNode(page, id);
  // inspector checkbox (the object is selected on add)
  await page.getByTestId("inspector-active").uncheck();
  expect(await activeOf(page, id)).toBe(false);
  // the hierarchy row's own active checkbox flips it back on
  await page.locator(`[data-obj-id="${id}"] [data-testid="row-active"]`).check();
  expect(await activeOf(page, id)).toBe(true);
});

test("active state runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 120, y: 90, patch: { name: "S" } }));
  await waitForNode(page, id);
  await page.evaluate((id) => window.__mj.cmd.setActive(id, false), id);
  await tick(page);
  await page.evaluate((id) => window.__mj.cmd.setActive(id, true), id);
  await tick(page);
  expect(await cspViolations(page)).toEqual([]);
});
