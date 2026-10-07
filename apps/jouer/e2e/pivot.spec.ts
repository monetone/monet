import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Sprite pivot presets (Sprite Editor's pivot dropdown): a 3×3
// picker that snaps a GameObject's origin/pivot to the standard corner/edge/
// centre positions. Specs drive the command + the inspector grid through
// `window.__mj`. Under the `desktop` project the last test doubles as the CSP
// smoke.

const originOf = (page: Page, id: string) =>
  page.evaluate((id) => {
    const t = window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).transform;
    return { x: t.originX, y: t.originY };
  }, id);

const trackProps = (page: Page) =>
  page.evaluate(() => {
    const { query, store } = window.__mj;
    const tl = query.activeTimeline(query.activeScene(store.getProject()));
    return tl.tracks.map((t: any) => t.property).sort();
  });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("setOriginPreset snaps the origin to each preset", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    store.selectOne(id);
    return id;
  });
  await page.evaluate(() => window.__mj.cmd.setOriginPreset("top-left"));
  expect(await originOf(page, id)).toEqual({ x: 0, y: 0 });
  await page.evaluate(() => window.__mj.cmd.setOriginPreset("bottom-right"));
  expect(await originOf(page, id)).toEqual({ x: 1, y: 1 });
  await page.evaluate(() => window.__mj.cmd.setOriginPreset("right"));
  expect(await originOf(page, id)).toEqual({ x: 1, y: 0.5 });
  await page.evaluate(() => window.__mj.cmd.setOriginPreset("center"));
  expect(await originOf(page, id)).toEqual({ x: 0.5, y: 0.5 });
});

test("the inspector pivot grid sets the origin and highlights the active cell", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle"); // default origin 0.5/0.5
    store.selectOne(id);
    return id;
  });
  await expect(page.getByTestId("pivot-center")).toHaveClass(/is-on/); // default = centre
  await page.getByTestId("pivot-top-right").click();
  expect(await originOf(page, id)).toEqual({ x: 1, y: 0 });
  await expect(page.getByTestId("pivot-top-right")).toHaveClass(/is-on/);
  await expect(page.getByTestId("pivot-center")).not.toHaveClass(/is-on/);
});

test("applies to every selected object, skipping locked ones", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const a = cmd.addObject("rectangle");
    const b = cmd.addObject("ellipse");
    const locked = cmd.addObject("rectangle");
    cmd.setLocked(locked, true);
    store.select([a, b, locked]);
    cmd.setOriginPreset("bottom-left");
    return { a, b, locked };
  });
  expect(await originOf(page, ids.a)).toEqual({ x: 0, y: 1 });
  expect(await originOf(page, ids.b)).toEqual({ x: 0, y: 1 });
  expect(await originOf(page, ids.locked)).toEqual({ x: 0.5, y: 0.5 }); // unchanged
});

test("a pivot preset is a single undo step", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    store.selectOne(id);
    cmd.setOriginPreset("top-left");
    return id;
  });
  expect(await originOf(page, id)).toEqual({ x: 0, y: 0 });
  await page.evaluate(() => window.__mj.cmd.undo());
  expect(await originOf(page, id)).toEqual({ x: 0.5, y: 0.5 }); // restored in one undo
});

test("with Record mode on, a pivot preset auto-keys originX/originY", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    store.selectOne(id);
    cmd.setRecording(true);
    store.setPlayhead(0.5);
    cmd.setOriginPreset("top-left");
  });
  expect(await trackProps(page)).toEqual(["originX", "originY"]);
});

test("pivot presets run under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle");
    store.selectOne(id);
    cmd.setOriginPreset("bottom");
    return id;
  });
  expect(await originOf(page, id)).toEqual({ x: 0.5, y: 1 });
  expect(await cspViolations(page)).toEqual([]);
});
