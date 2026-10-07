import { test, expect } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity "Step" (Game view): advance the playhead exactly one frame
// (1/fps) forward or back, paused, regardless of selection. Specs drive the live
// editor through `window.__mj` and read the store playhead. fps is set to 8 so a
// frame is 0.125s (exact in binary → exact assertions). The default timeline
// duration is 2s, so the playable extent is 2 with no keyframes. Under the
// `desktop` project (shipped bundle + Tauri CSP) this doubles as the CSP smoke.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("stepping forward advances the playhead by one frame", async ({ page }) => {
  const playhead = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.updateProject({ fps: 8 });
    store.setPlayhead(0);
    cmd.stepFrame(1);
    return store.state.playhead;
  });
  expect(playhead).toBe(0.125);
});

test("repeated steps accumulate, and stepping back rewinds a frame", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.updateProject({ fps: 8 });
    store.setPlayhead(0);
    cmd.stepFrame(1);
    cmd.stepFrame(1);
    cmd.stepFrame(1);
    const fwd = store.state.playhead;
    cmd.stepFrame(-1);
    return { fwd, back: store.state.playhead };
  });
  expect(r.fwd).toBe(0.375); // 3 × 0.125
  expect(r.back).toBe(0.25);
});

test("stepping clamps at the timeline ends", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.updateProject({ fps: 8 });
    store.setPlayhead(2); // the extent (timeline duration)
    cmd.stepFrame(1);
    const atEnd = store.state.playhead;
    store.setPlayhead(0);
    cmd.stepFrame(-1);
    return { atEnd, atStart: store.state.playhead };
  });
  expect(r.atEnd).toBe(2);
  expect(r.atStart).toBe(0);
});

test("stepping pauses playback", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.updateProject({ fps: 8 });
    store.setPlayhead(0);
    store.setPlaying(true);
    cmd.stepFrame(1);
    return { playing: store.state.playing, playhead: store.state.playhead };
  });
  expect(r.playing).toBe(false);
  expect(r.playhead).toBe(0.125);
});

test("the , and . shortcuts step the playhead even with an object selected", async ({ page }) => {
  const r = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    cmd.updateProject({ fps: 8 });
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id); // arrows would nudge this; , / . must still step the playhead
    store.setPlayhead(0);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "." }));
    const afterFwd = store.state.playhead;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "." }));
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "," }));
    const x = query.findObject(query.activeScene(store.getProject()), id).transform.x;
    return { afterFwd, afterBack: store.state.playhead, x };
  });
  expect(r.afterFwd).toBe(0.125);
  expect(r.afterBack).toBe(0.125); // +0.125 +0.125 -0.125
  expect(r.x).toBe(100); // the selected object was not nudged
});

test("step frame runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.updateProject({ fps: 8 });
    store.setPlayhead(0);
    cmd.stepFrame(1);
    cmd.stepFrame(-1);
  });
  expect(await cspViolations(page)).toEqual([]);
});
