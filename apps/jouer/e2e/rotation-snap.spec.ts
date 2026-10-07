import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Rotation Snap (Grid and Snap → Rotate increment): the degree step the
// Shift-rotate gizmo and "Snap Rotation of Selection" round to, configurable from
// View ▸ Rotation Snap. rotationSnap is an editor session preference; the snap command
// reads it. Specs drive store.setRotationSnap + cmd.snapSelectionRotation via
// window.__mj and assert the snapped model angle. Under the `desktop` project the last
// test doubles as the CSP smoke.

const addRotated = (page: Page, deg: number): Promise<string> =>
  page.evaluate((deg) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateTransform(id, { angle: deg });
    store.selectOne(id);
    return id;
  }, deg);

const angleOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).transform.angle;
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the rotation-snap increment defaults to 15", async ({ page }) => {
  expect(await page.evaluate(() => window.__mj.store.state.rotationSnap)).toBe(15);
});

test("the default 15° increment snaps an angle of 100 to 105", async ({ page }) => {
  const id = await addRotated(page, 100);
  await page.evaluate(() => window.__mj.cmd.snapSelectionRotation());
  expect(await angleOf(page, id)).toBe(105); // round(100/15)=7 → 105
});

test("a coarser 90° increment snaps an angle of 100 to 90", async ({ page }) => {
  const id = await addRotated(page, 100);
  await page.evaluate(() => window.__mj.store.setRotationSnap(90));
  await page.evaluate(() => window.__mj.cmd.snapSelectionRotation());
  expect(await angleOf(page, id)).toBe(90); // round(100/90)=1 → 90
});

test("setRotationSnap clamps to a minimum of 1", async ({ page }) => {
  await page.evaluate(() => window.__mj.store.setRotationSnap(0));
  expect(await page.evaluate(() => window.__mj.store.state.rotationSnap)).toBe(1);
});

test("rotation snap runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addRotated(page, 100);
  await page.evaluate(() => window.__mj.store.setRotationSnap(45));
  await page.evaluate(() => window.__mj.cmd.snapSelectionRotation());
  expect(await angleOf(page, id)).toBe(90); // round(100/45)=2 → 90
  expect(await cspViolations(page)).toEqual([]);
});
