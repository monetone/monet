import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Scale Snap (Grid and Snap → Scale increment): the factor the
// Shift-scale gizmo and "Snap Scale of Selection" round each axis to, configurable
// from View ▸ Scale Snap. scaleSnap is an editor session preference; the snap
// command reads it. Specs drive store.setScaleSnap + cmd.snapSelectionScale via
// window.__mj and assert the snapped model scale. Under the `desktop` project the
// last test doubles as the CSP smoke.

const addScaled = (page: Page, s: number): Promise<string> =>
  page.evaluate((s) => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    cmd.updateTransform(id, { scaleX: s, scaleY: s });
    store.selectOne(id);
    return id;
  }, s);

const scaleOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const { store, query } = window.__mj;
    const t = query.findObject(query.activeScene(store.getProject()), id).transform;
    return { x: t.scaleX, y: t.scaleY };
  }, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("the scale-snap increment defaults to 0.25", async ({ page }) => {
  expect(await page.evaluate(() => window.__mj.store.state.scaleSnap)).toBe(0.25);
});

test("the default 0.25× increment snaps a scale of 1.37 to 1.25", async ({ page }) => {
  const id = await addScaled(page, 1.37);
  await page.evaluate(() => window.__mj.cmd.snapSelectionScale());
  expect(await scaleOf(page, id)).toEqual({ x: 1.25, y: 1.25 }); // round(1.37/0.25)=5 → 1.25
});

test("a coarser 0.5× increment snaps 1.37 to 1.5", async ({ page }) => {
  const id = await addScaled(page, 1.37);
  await page.evaluate(() => window.__mj.store.setScaleSnap(0.5));
  await page.evaluate(() => window.__mj.cmd.snapSelectionScale());
  expect(await scaleOf(page, id)).toEqual({ x: 1.5, y: 1.5 }); // round(1.37/0.5)=3 → 1.5
});

test("setScaleSnap clamps to a small positive minimum", async ({ page }) => {
  await page.evaluate(() => window.__mj.store.setScaleSnap(0));
  expect(await page.evaluate(() => window.__mj.store.state.scaleSnap)).toBe(0.01);
});

test("adds no undo step when the scale is already aligned", async ({ page }) => {
  const count = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 50 }); // scale 1 — already a multiple of 0.25
    store.selectOne(id);
    cmd.snapSelectionScale(); // no-op → no undo step
    cmd.undo(); // undoes the ADD, not a phantom snap
    return query.activeScene(store.getProject()).objects.length;
  });
  expect(count).toBe(0); // a single undo removed the object → snap added nothing
});

test("scale snap runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await addScaled(page, 1.37);
  await page.evaluate(() => window.__mj.store.setScaleSnap(0.5));
  await page.evaluate(() => window.__mj.cmd.snapSelectionScale());
  expect((await scaleOf(page, id)).x).toBe(1.5);
  expect(await cspViolations(page)).toEqual([]);
});
