import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation Copy/Paste Keys: copy a keyframe's value + easing, then
// paste it at the playhead on a track (overwriting any keyframe already at that
// time). Distinct from "Key at playhead" (which captures the object's CURRENT
// value with a default ease). Specs drive the commands through `window.__mj`.
// Under the `desktop` project the last test doubles as the CSP smoke.

const trackKeyframes = (page: Page, trackId: string) =>
  page.evaluate((trackId) => {
    const { query, store } = window.__mj;
    const tl = query.activeTimeline(query.activeScene(store.getProject()));
    const t = tl.tracks.find((x: any) => x.id === trackId);
    return t.keyframes.map((k: any) => ({ time: k.time, value: k.value, ease: k.ease }));
  }, trackId);

/** Add a rectangle with an x-track keyframe at t=0, returning {trackId, kfId}. */
const seedTrack = (page: Page) =>
  page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.setPlayhead(0);
    const trackId = cmd.addTrack(id, "x");
    const kfId = query.activeTimeline(query.activeScene(store.getProject())).tracks.find((t: any) => t.id === trackId).keyframes[0].id;
    return { trackId, kfId };
  });

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("copy a keyframe and paste it at the playhead with its value + ease", async ({ page }) => {
  const { trackId } = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.setPlayhead(0);
    const trackId = cmd.addTrack(id, "x");
    const kfId = query.activeTimeline(query.activeScene(store.getProject())).tracks.find((t: any) => t.id === trackId).keyframes[0].id;
    cmd.updateKeyframe(trackId, kfId, { value: 50, ease: "bounceOut" });
    cmd.copyKeyframe(trackId, kfId);
    store.setPlayhead(1);
    cmd.pasteKeyframe(trackId);
    return { trackId };
  });
  const kfs = await trackKeyframes(page, trackId);
  expect(kfs).toContainEqual({ time: 1, value: 50, ease: "bounceOut" }); // pasted with copied value+ease
  expect(kfs.find((k) => k.time === 0)).toBeTruthy(); // original keyframe remains
});

test("pasting at an existing keyframe's time overwrites it", async ({ page }) => {
  const trackId = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.setPlayhead(0);
    const trackId = cmd.addTrack(id, "x");
    const kf0 = query.activeTimeline(query.activeScene(store.getProject())).tracks.find((t: any) => t.id === trackId).keyframes[0].id;
    cmd.updateKeyframe(trackId, kf0, { value: 99, ease: "linear" });
    store.setPlayhead(1);
    cmd.keyframeAtPlayhead(trackId, 5); // a different keyframe at t=1
    cmd.copyKeyframe(trackId, kf0); // copy the value-99 keyframe
    cmd.pasteKeyframe(trackId); // playhead is 1 → overwrite the t=1 keyframe
    return trackId;
  });
  const at1 = (await trackKeyframes(page, trackId)).filter((k) => k.time === 1);
  expect(at1).toHaveLength(1);
  expect(at1[0].value).toBe(99);
});

test("canPasteKeyframe is false before a copy and true after", async ({ page }) => {
  const { trackId, kfId } = await seedTrack(page);
  const r = await page.evaluate(({ trackId, kfId }) => {
    const { cmd } = window.__mj;
    const before = cmd.canPasteKeyframe();
    cmd.copyKeyframe(trackId, kfId);
    return { before, after: cmd.canPasteKeyframe() };
  }, { trackId, kfId });
  expect(r.before).toBe(false);
  expect(r.after).toBe(true);
});

test("paste is a single undo step", async ({ page }) => {
  const { trackId } = await page.evaluate(() => {
    const { cmd, store, query } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.setPlayhead(0);
    const trackId = cmd.addTrack(id, "x");
    const kfId = query.activeTimeline(query.activeScene(store.getProject())).tracks.find((t: any) => t.id === trackId).keyframes[0].id;
    cmd.copyKeyframe(trackId, kfId);
    store.setPlayhead(1);
    cmd.pasteKeyframe(trackId);
    return { trackId };
  });
  expect((await trackKeyframes(page, trackId)).some((k) => k.time === 1)).toBe(true);
  await page.evaluate(() => window.__mj.cmd.undo());
  expect((await trackKeyframes(page, trackId)).some((k) => k.time === 1)).toBe(false); // one undo removes the paste
});

test("copy/paste keys runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  const { trackId, kfId } = await seedTrack(page);
  await page.evaluate(({ trackId, kfId }) => {
    const { cmd, store } = window.__mj;
    cmd.copyKeyframe(trackId, kfId);
    store.setPlayhead(1);
    cmd.pasteKeyframe(trackId);
  }, { trackId, kfId });
  expect((await trackKeyframes(page, trackId)).some((k) => k.time === 1)).toBe(true);
  expect(await cspViolations(page)).toEqual([]);
});
