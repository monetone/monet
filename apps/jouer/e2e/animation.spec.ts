import { test, expect } from "@playwright/test";
import { gotoApp, near, tick, waitForNode } from "./helpers";

// "Ensure all the animations work" — drives the keyframe timeline and asserts
// the LIVE Phaser nodes (via window.__mj.probe) match the pure sampler for every
// easing, that playback advances / loops / stops, and that every animatable
// property (position, scale, rotation, alpha, origin, size) and nested-object
// animation actually moves on screen.

const EASES = [
  "linear", "hold", "sineIn", "sineOut", "sineInOut",
  "quadIn", "quadOut", "quadInOut", "cubicIn", "cubicOut", "cubicInOut",
  "quartInOut", "expoOut", "backIn", "backOut", "backInOut", "elasticOut", "bounceOut",
];

/** Replace the project with a deterministic, normalised one built from a raw
 *  scene/timeline literal (ids preserved by the .jouer normaliser). */
async function build(page: import("@playwright/test").Page, raw: any): Promise<void> {
  await page.evaluate((raw) => {
    const { jouer, store } = window.__mj;
    const p = jouer.normalizeProject(raw);
    store.replaceProject(p, { dirty: false });
  }, raw);
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("every easing samples to the correct live value at the playhead", async ({ page }) => {
  const objects = EASES.map((e, i) => ({ id: "r" + i, kind: "rectangle", name: "r" + i, width: 20, height: 20, transform: { x: 0, y: 10 + i * 6 } }));
  const tracks = EASES.map((e, i) => ({ id: "t" + i, targetId: "r" + i, property: "x", keyframes: [{ time: 0, value: 0, ease: e }, { time: 1, value: 100, ease: "linear" }] }));
  await build(page, { name: "ease", scenes: [{ id: "s", key: "S", name: "S", objects, timelines: [{ id: "tl", name: "Main", duration: 1, tracks }], activeTimelineId: "tl" }], activeSceneId: "s" });
  await waitForNode(page, "r0");

  // Endpoints: at t=0 every track is 0, at t=1 every track is 100.
  await page.evaluate(() => window.__mj.store.setPlayhead(0));
  await tick(page);
  for (let i = 0; i < EASES.length; i++) near((await probe(page, "r" + i)).x, 0, 0.6);

  await page.evaluate(() => window.__mj.store.setPlayhead(1));
  await tick(page);
  for (let i = 0; i < EASES.length; i++) near((await probe(page, "r" + i)).x, 100, 0.6);

  // Midpoint: the live node must equal the pure sampler for each easing.
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  const expected = await page.evaluate(() => {
    const { sample, store } = window.__mj;
    const tracks = store.getProject().scenes[0].timelines[0].tracks;
    return tracks.map((t: any) => sample.sampleTrack(t, 0.5));
  });
  for (let i = 0; i < EASES.length; i++) {
    near((await probe(page, "r" + i)).x, expected[i], 0.6);
  }

  // Spot-check a few easing curves numerically (independent of the editor).
  const byId = Object.fromEntries(EASES.map((e, i) => [e, expected[i]]));
  near(byId.linear, 50, 0.01);
  near(byId.quadIn, 25, 0.01);
  near(byId.quadOut, 75, 0.01);
  near(byId.hold, 0, 0.01); // step holds the start value until the very end
  near(byId.sineInOut, 50, 0.01);
  expect(byId.bounceOut).toBeGreaterThan(50); // overshoot-free but front-loaded
});

test("playback advances the playhead while playing", async ({ page }) => {
  await build(page, oneTrack("x", 0, 200, "linear", { duration: 1 }));
  await waitForNode(page, "rect");
  await page.evaluate(() => { const s = window.__mj.store; s.setPlayhead(0); s.setPlaying(true); });
  await page.waitForFunction(() => window.__mj.store.state.playhead > 0.25, null, { timeout: 4000 });
  await page.evaluate(() => window.__mj.store.setPlaying(false));
  const ph = await page.evaluate(() => window.__mj.store.state.playhead);
  expect(ph).toBeGreaterThan(0.25);
  expect(ph).toBeLessThanOrEqual(1);
  // and the live node moved with the playhead
  expect((await probe(page, "rect")).x).toBeGreaterThan(40);
});

test("playback loops back to the start", async ({ page }) => {
  await build(page, oneTrack("x", 0, 200, "linear", { duration: 0.25 }));
  await waitForNode(page, "rect");
  await page.evaluate(() => { const s = window.__mj.store; s.setLoopPlayback(true); s.setPlayhead(0); s.setPlaying(true); });
  await page.waitForTimeout(500); // > 0.25s, must have wrapped at least once
  const st = await page.evaluate(() => ({ ph: window.__mj.store.state.playhead, playing: window.__mj.store.state.playing }));
  await page.evaluate(() => window.__mj.store.setPlaying(false));
  expect(st.playing).toBe(true);            // still running
  expect(st.ph).toBeGreaterThanOrEqual(0);
  expect(st.ph).toBeLessThanOrEqual(0.25);  // wrapped back into range
});

test("playback stops at the end when not looping", async ({ page }) => {
  await build(page, oneTrack("x", 0, 200, "linear", { duration: 0.25 }));
  await waitForNode(page, "rect");
  await page.evaluate(() => { const s = window.__mj.store; s.setLoopPlayback(false); s.setPlayhead(0); s.setPlaying(true); });
  await page.waitForFunction(() => window.__mj.store.state.playing === false, null, { timeout: 4000 });
  const ph = await page.evaluate(() => window.__mj.store.state.playhead);
  near(ph, 0.25, 0.05); // parked at the extent
});

test("multiple tracks on one object animate together", async ({ page }) => {
  await build(page, {
    name: "multi",
    scenes: [{ id: "s", key: "S", name: "S", objects: [{ id: "rect", kind: "rectangle", name: "rect", width: 20, height: 20, transform: { x: 0, y: 0, scaleX: 1, alpha: 1, angle: 0 } }],
      timelines: [{ id: "tl", name: "Main", duration: 1, tracks: [
        { id: "tx", targetId: "rect", property: "x", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 100, ease: "linear" }] },
        { id: "ty", targetId: "rect", property: "y", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 200, ease: "linear" }] },
        { id: "ta", targetId: "rect", property: "alpha", keyframes: [{ time: 0, value: 1, ease: "linear" }, { time: 1, value: 0, ease: "linear" }] },
        { id: "tr", targetId: "rect", property: "angle", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 90, ease: "linear" }] },
        { id: "ts", targetId: "rect", property: "scaleX", keyframes: [{ time: 0, value: 1, ease: "linear" }, { time: 1, value: 3, ease: "linear" }] },
      ] }], activeTimelineId: "tl" }],
    activeSceneId: "s",
  });
  await waitForNode(page, "rect");
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  const p = await probe(page, "rect");
  near(p.x, 50); near(p.y, 100); near(p.alpha, 0.5, 0.02); near(p.angle, 45); near(p.scaleX, 2, 0.02);
});

test("origin and size tracks animate the live node", async ({ page }) => {
  await build(page, {
    name: "os",
    scenes: [{ id: "s", key: "S", name: "S", objects: [{ id: "rect", kind: "rectangle", name: "rect", width: 50, height: 50, transform: { originX: 0, originY: 0 } }],
      timelines: [{ id: "tl", name: "Main", duration: 1, tracks: [
        { id: "to", targetId: "rect", property: "originX", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 1, ease: "linear" }] },
        { id: "tw", targetId: "rect", property: "width", keyframes: [{ time: 0, value: 50, ease: "linear" }, { time: 1, value: 150, ease: "linear" }] },
      ] }], activeTimelineId: "tl" }],
    activeSceneId: "s",
  });
  await waitForNode(page, "rect");
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  const p = await probe(page, "rect");
  near(p.originX!, 0.5, 0.02);
  near(p.width!, 100, 1);
});

test("width/height tracks animate a hexagon's live Polygon (applyEffective branch)", async ({ page }) => {
  // The hexagon's animated-size path (EditorScene.applyEffective → Polygon#setTo)
  // is separate from the build/reconcile path the resize spec covers, so exercise
  // it here: at mid-tween the Polygon's AABB-derived size + pivot must track it.
  await build(page, {
    name: "hexsize",
    scenes: [{ id: "s", key: "S", name: "S", objects: [{ id: "hex", kind: "hexagon", name: "hex", width: 50, height: 50, transform: { x: 100, y: 100 } }],
      timelines: [{ id: "tl", name: "Main", duration: 1, tracks: [
        { id: "tw", targetId: "hex", property: "width", keyframes: [{ time: 0, value: 50, ease: "linear" }, { time: 1, value: 150, ease: "linear" }] },
        { id: "th", targetId: "hex", property: "height", keyframes: [{ time: 0, value: 50, ease: "linear" }, { time: 1, value: 90, ease: "linear" }] },
      ] }], activeTimelineId: "tl" }],
    activeSceneId: "s",
  });
  await waitForNode(page, "hex");
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  const p = await probe(page, "hex");
  // mid-tween: width 50→150 ⇒ 100, height 50→90 ⇒ 70 (origin 0.5 ⇒ pivot 50/35)
  near(p.width!, 100, 1);
  near(p.height!, 70, 1);
  near(p.displayOriginX!, 50, 1);
  near(p.displayOriginY!, 35, 1);
});

test("a nested container child animates", async ({ page }) => {
  await build(page, {
    name: "nest",
    scenes: [{ id: "s", key: "S", name: "S", objects: [
      { id: "grp", kind: "container", name: "grp", transform: { x: 300, y: 300 }, children: [{ id: "kid", kind: "rectangle", name: "kid", width: 20, height: 20, transform: { x: 0, y: 0 } }] },
    ], timelines: [{ id: "tl", name: "Main", duration: 1, tracks: [
      { id: "tk", targetId: "kid", property: "x", keyframes: [{ time: 0, value: 0, ease: "linear" }, { time: 1, value: 80, ease: "linear" }] },
    ] }], activeTimelineId: "tl" }],
    activeSceneId: "s",
  });
  await waitForNode(page, "kid");
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  near((await probe(page, "kid")).x, 40); // local position inside the container
});

test("Key All creates six transform tracks that play back", async ({ page }) => {
  const rect = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 100, y: 100 });
    store.selectOne(id);
    store.setPlayhead(0);
    cmd.keyAllTransform(id);
    store.setPlayhead(1);
    cmd.updateTransform(id, { x: 500, y: 300, angle: 180 });
    cmd.keyAllTransform(id);
    cmd.updateTimeline(store.getProject().scenes[0].timelines[0].id, { duration: 1 });
    return id;
  });
  const trackCount = await page.evaluate(() => window.__mj.store.getProject().scenes[0].timelines[0].tracks.length);
  expect(trackCount).toBe(6); // x,y,scaleX,scaleY,angle,alpha
  await page.evaluate(() => window.__mj.store.setPlayhead(0.5));
  await tick(page);
  const p = await probe(page, rect);
  near(p.x, 300); near(p.y, 200); near(p.angle, 90);
});

test("keyframe edit / delete / move commands update the model", async ({ page }) => {
  const ids = await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const rect = cmd.addObject("rectangle", { x: 0, y: 0 });
    store.selectOne(rect);
    store.setPlayhead(0);
    const trackId = cmd.addTrack(rect, "x"); // key x=0 @ t0
    store.setPlayhead(1);
    cmd.updateTransform(rect, { x: 100 });
    cmd.keyframeAtPlayhead(trackId); // key x=100 @ t1
    const track = cmd.findTrack(rect, "x");
    return { rect, trackId, kf0: track.keyframes[0].id, kf1: track.keyframes[1].id };
  });
  // edit value + ease
  await page.evaluate((ids) => window.__mj.cmd.updateKeyframe(ids.trackId, ids.kf1, { value: 250, ease: "bounceOut" }), ids);
  let track = await page.evaluate((ids) => window.__mj.cmd.findTrack(ids.rect, "x"), ids);
  expect(track.keyframes[1].value).toBe(250);
  expect(track.keyframes[1].ease).toBe("bounceOut");
  // move (retime) keyframe 0 past keyframe 1 -> stays sorted
  await page.evaluate((ids) => window.__mj.cmd.updateKeyframe(ids.trackId, ids.kf0, { time: 2 }), ids);
  track = await page.evaluate((ids) => window.__mj.cmd.findTrack(ids.rect, "x"), ids);
  expect(track.keyframes.map((k: any) => k.time)).toEqual([1, 2]);
  // delete
  await page.evaluate((ids) => window.__mj.cmd.deleteKeyframe(ids.trackId, ids.kf1), ids);
  track = await page.evaluate((ids) => window.__mj.cmd.findTrack(ids.rect, "x"), ids);
  expect(track.keyframes).toHaveLength(1);
});

// ── local helpers ─────────────────────────────────────────────
function oneTrack(property: string, from: number, to: number, ease: string, opts: { duration?: number } = {}) {
  return {
    name: "one",
    scenes: [{ id: "s", key: "S", name: "S", objects: [{ id: "rect", kind: "rectangle", name: "rect", width: 20, height: 20, transform: { x: 0, y: 0 } }],
      timelines: [{ id: "tl", name: "Main", duration: opts.duration ?? 1, tracks: [{ id: "t", targetId: "rect", property, keyframes: [{ time: 0, value: from, ease }, { time: opts.duration ?? 1, value: to, ease: "linear" }] }] }], activeTimelineId: "tl" }],
    activeSceneId: "s",
  };
}

async function probe(page: import("@playwright/test").Page, id: string) {
  const p = await page.evaluate((id) => window.__mj.probe(id), id);
  expect(p, `probe(${id}) should exist`).not.toBeNull();
  return p!;
}
