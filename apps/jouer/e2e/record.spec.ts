import { test, expect, type Page } from "@playwright/test";
import { gotoApp, tick, waitForNode, waitProbe, near, cspViolations } from "./helpers";

// Unity-parity Animation "Record" mode (the red Record button): while recording,
// editing a GameObject's transform — Inspector field, viewport gizmo, or arrow
// nudge (all route through cmd.updateTransform / cmd.translateSelection) —
// auto-creates keyframes for the changed properties at the playhead on the
// active timeline, as one undo step. Specs drive the live editor through
// `window.__mj`; under the `desktop` project the last test doubles as the CSP
// smoke.

/** The active timeline's tracks, simplified for assertions. */
const tracks = (page: Page) =>
  page.evaluate(() => {
    const { query, store } = window.__mj;
    const tl = query.activeTimeline(query.activeScene(store.getProject()));
    return tl.tracks.map((t: any) => ({
      targetId: t.targetId,
      property: t.property,
      keyframes: t.keyframes.map((k: any) => ({ time: k.time, value: k.value })),
    }));
  });

const xOf = (page: Page, id: string) =>
  page.evaluate((id) => window.__mj.query.findObject(window.__mj.query.activeScene(window.__mj.store.getProject()), id).transform.x, id);

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("a transform edit keys a track only while recording", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 0, y: 0 }));
  await waitForNode(page, id);

  // recording OFF: editing does not key
  await page.evaluate((id) => { window.__mj.store.setPlayhead(1); window.__mj.cmd.updateTransform(id, { x: 120 }); }, id);
  expect(await tracks(page)).toEqual([]);

  // recording ON: editing keys the changed prop at the playhead
  await page.evaluate((id) => { window.__mj.cmd.setRecording(true); window.__mj.cmd.updateTransform(id, { x: 200 }); }, id);
  const t = await tracks(page);
  expect(t).toHaveLength(1);
  expect(t[0]).toMatchObject({ targetId: id, property: "x" });
  expect(t[0].keyframes).toEqual([{ time: 1, value: 200 }]);
});

test("only the changed transform properties are keyed", async ({ page }) => {
  const id = await page.evaluate(() => {
    const id = window.__mj.cmd.addObject("rectangle", { x: 0, y: 0 });
    window.__mj.cmd.setRecording(true);
    window.__mj.store.setPlayhead(0.5);
    window.__mj.cmd.updateTransform(id, { x: 80, angle: 30 });
    return id;
  });
  const props = (await tracks(page)).map((t) => t.property).sort();
  expect(props).toEqual(["angle", "x"]);
});

test("auto-keyed transforms animate the live node when scrubbed", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    cmd.setRecording(true);
    store.setPlayhead(0); cmd.updateTransform(id, { x: 0 });
    store.setPlayhead(1); cmd.updateTransform(id, { x: 200 });
    return id;
  });
  await waitForNode(page, id);
  await page.evaluate(() => window.__mj.store.setPlayhead(0));
  await waitProbe(page, id, "x", 0);
  await page.evaluate(() => window.__mj.store.setPlayhead(1));
  await waitProbe(page, id, "x", 200);
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await waitProbe(page, id, "x", 100, 2);
});

test("recording during a viewport move keys x and y", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.selectOne(id);
    cmd.setRecording(true);
    store.setPlayhead(0.5);
    cmd.translateSelection(40, 25); // the gizmo-drag / arrow-nudge path
    return id;
  });
  const t = await tracks(page);
  expect(t.map((x) => x.property).sort()).toEqual(["x", "y"]);
  expect(t.find((x) => x.property === "x")!.keyframes).toEqual([{ time: 0.5, value: 40 }]);
  expect(t.find((x) => x.property === "y")!.keyframes).toEqual([{ time: 0.5, value: 25 }]);
});

test("the auto-keyed edit + keyframes are a single undo step", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    cmd.setRecording(true);
    store.setPlayhead(1);
    cmd.updateTransform(id, { x: 200 });
    return id;
  });
  expect(await tracks(page)).toHaveLength(1);
  near(await xOf(page, id), 200);
  await page.evaluate(() => window.__mj.cmd.undo());
  expect(await tracks(page)).toEqual([]); // the keyframe is gone
  near(await xOf(page, id), 0);           // …and the move reverted, in one undo
  // redo restores both the move and the keyframe atomically
  await page.evaluate(() => window.__mj.cmd.redo());
  expect(await tracks(page)).toHaveLength(1);
  near(await xOf(page, id), 200);
});

test("recording skips locked objects (no move, no key)", async ({ page }) => {
  const id = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    cmd.setLocked(id, true);
    store.selectOne(id);
    cmd.setRecording(true);
    store.setPlayhead(0.5);
    cmd.translateSelection(40, 25);
    return id;
  });
  expect(await tracks(page)).toEqual([]); // locked → not keyed
  near(await xOf(page, id), 0);           // …and not moved
});

test("the Record button toggles recording", async ({ page }) => {
  await page.getByTestId("record-toggle").click();
  expect(await page.evaluate(() => window.__mj.store.state.recording)).toBe(true);
  await page.getByTestId("record-toggle").click();
  expect(await page.evaluate(() => window.__mj.store.state.recording)).toBe(false);
});

test("record mode runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const id = await page.evaluate(() => window.__mj.cmd.addObject("rectangle", { x: 0, y: 0 }));
  await waitForNode(page, id);
  await page.evaluate((id) => {
    const { cmd, store } = window.__mj;
    cmd.setRecording(true);
    store.setPlayhead(0.5);
    cmd.updateTransform(id, { x: 50, angle: 30 });
    cmd.setRecording(false);
  }, id);
  await tick(page);
  expect(await cspViolations(page)).toEqual([]);
});
