import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Constrain Proportions (Transform scale aspect-lock): with the lock
// on, editing one scale axis scales the other to keep the ratio. Specs drive the
// command + the inspector toggle through window.__mj and read the model transform.
// Under the `desktop` project the last test doubles as the CSP smoke.

const scaleOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    const t = query.findObject(query.activeScene(store.getProject()), id).transform;
    return { x: t.scaleX, y: t.scaleY };
  }, id);

const addRect = (page: Page) => page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 100, y: 100 }));

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("with constrain on, scaling one axis scales the other proportionally", async ({ page }) => {
  const id = await addRect(page);
  await page.evaluate((id) => {
    window.__mj.store.setConstrainProportions(true);
    window.__mj.cmd.constrainedScale(id, { scaleX: 2 }); // from 1,1
  }, id);
  expect(await scaleOf(page, id)).toEqual({ x: 2, y: 2 });
});

test("constrain preserves a non-1 starting ratio", async ({ page }) => {
  const id = await addRect(page);
  await page.evaluate((id) => {
    const { store, cmd } = window.__mj;
    cmd.updateTransform(id, { scaleX: 1, scaleY: 2 }); // set ratio with constrain OFF
    store.setConstrainProportions(true);
    cmd.constrainedScale(id, { scaleX: 2 }); // ratio 2 → Y becomes 4
  }, id);
  expect(await scaleOf(page, id)).toEqual({ x: 2, y: 4 });
});

test("with constrain off, scaling one axis leaves the other untouched", async ({ page }) => {
  const id = await addRect(page);
  await page.evaluate((id) => {
    window.__mj.store.setConstrainProportions(false);
    window.__mj.cmd.constrainedScale(id, { scaleX: 3 });
  }, id);
  expect(await scaleOf(page, id)).toEqual({ x: 3, y: 1 });
});

test("the inspector Constrain Proportions toggle flips the store flag", async ({ page }) => {
  const id = await addRect(page);
  await page.evaluate((id) => window.__mj.store.selectOne(id), id); // show the ObjectInspector
  expect(await page.evaluate(() => window.__mj.store.state.constrainProportions)).toBe(false);
  await page.getByTestId("constrain-proportions").click();
  expect(await page.evaluate(() => window.__mj.store.state.constrainProportions)).toBe(true);
  await page.getByTestId("constrain-proportions").click();
  expect(await page.evaluate(() => window.__mj.store.state.constrainProportions)).toBe(false);
});

test("constrain proportions runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addRect(page);
  await page.evaluate((id) => {
    window.__mj.store.setConstrainProportions(true);
    window.__mj.cmd.constrainedScale(id, { scaleY: 1.5 });
  }, id);
  expect(await scaleOf(page, id)).toEqual({ x: 1.5, y: 1.5 });
  expect(await cspViolations(page)).toEqual([]);
});
