import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity multi-object inspector edit: with several objects selected, each
// transform field shows the value they share (blank "—" when they differ), and
// committing a value sets it on EVERY selected object. Specs drive the real
// fields (fill + Enter) and read the model. Under the `desktop` project the last
// test doubles as the CSP smoke.

/** Two rectangles: same x (10), different y (0 vs 100). */
async function seed(page: Page) {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle", { x: 10, y: 0 });
    const b = cmd.addObject("rectangle", { x: 10, y: 100 });
    store.select([a, b]);
    return { a, b } as Record<string, string>;
  });
}

const xy = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    const t = query.findObject(query.activeScene(store.getProject()), id).transform;
    return { x: t.x, y: t.y };
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a shared field shows the value; a differing field shows blank (mixed)", async ({ page }) => {
  await seed(page);
  await expect(page.getByTestId("multi-x")).toHaveValue("10"); // both share x=10
  await expect(page.getByTestId("multi-y")).toHaveValue("");   // 0 vs 100 → mixed
});

test("entering a value sets it on every selected object", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("multi-x").fill("50");
  await page.getByTestId("multi-x").press("Enter");
  expect((await xy(page, ids.a)).x).toBe(50);
  expect((await xy(page, ids.b)).x).toBe(50);

  // The previously-mixed y becomes uniform after a multi-edit.
  await page.getByTestId("multi-y").fill("20");
  await page.getByTestId("multi-y").press("Enter");
  expect(await xy(page, ids.a)).toEqual({ x: 50, y: 20 });
  expect(await xy(page, ids.b)).toEqual({ x: 50, y: 20 });
  await expect(page.getByTestId("multi-y")).toHaveValue("20"); // now shared
});

test("the multi-edit is a single undo step that reverts all objects", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("multi-x").fill("80");
  await page.getByTestId("multi-x").press("Enter");
  expect((await xy(page, ids.a)).x).toBe(80);
  await page.evaluate(() => window.__mj.cmd.undo());
  expect((await xy(page, ids.a)).x).toBe(10);
  expect((await xy(page, ids.b)).x).toBe(10);
});

test("multi-edit runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const ids = await seed(page);
  await page.getByTestId("multi-scaleX").fill("2");
  await page.getByTestId("multi-scaleX").press("Enter");
  expect(await page.evaluate((id) => {
    const { store, query } = window.__mj;
    return query.findObject(query.activeScene(store.getProject()), id).transform.scaleX;
  }, ids.b)).toBe(2);
  expect(await cspViolations(page)).toEqual([]);
});
