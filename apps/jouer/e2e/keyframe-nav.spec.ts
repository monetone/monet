import { test, expect, type Page } from "@playwright/test";
import { gotoApp, cspViolations } from "./helpers";

// Unity-parity Animation keyframe navigation (the |◄ / ►| buttons): jump the
// playhead to the previous / next keyframe in the clip (across all tracks of the
// active timeline), pausing playback; no-op past the last / before the first.
// Specs drive the live editor through `window.__mj` + the panel DOM. Under the
// `desktop` project the last test doubles as the CSP smoke.

const playhead = (page: Page) => page.evaluate(() => window.__mj.store.state.playhead);

/** Seed an object with keyframes at t = 0, 0.5, 1 (via Record mode), playhead 0. */
async function seedKeys(page: Page): Promise<string> {
  return page.evaluate(() => {
    const { cmd, store } = window.__mj;
    const id = cmd.addObject("rectangle", { x: 0, y: 0 });
    cmd.setRecording(true);
    store.setPlayhead(0); cmd.updateTransform(id, { x: 0 });
    store.setPlayhead(0.5); cmd.updateTransform(id, { x: 50 });
    store.setPlayhead(1); cmd.updateTransform(id, { x: 100 });
    cmd.setRecording(false);
    store.setPlayhead(0);
    return id;
  });
}

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
});

test("next/prev keyframe walk the playhead across the clip and clamp at the ends", async ({ page }) => {
  await seedKeys(page);

  await page.evaluate(() => window.__mj.cmd.goToNextKeyframe());
  expect(await playhead(page)).toBeCloseTo(0.5, 5);
  await page.evaluate(() => window.__mj.cmd.goToNextKeyframe());
  expect(await playhead(page)).toBeCloseTo(1, 5);
  await page.evaluate(() => window.__mj.cmd.goToNextKeyframe());
  expect(await playhead(page)).toBeCloseTo(1, 5); // no later keyframe → stays

  await page.evaluate(() => window.__mj.cmd.goToPrevKeyframe());
  expect(await playhead(page)).toBeCloseTo(0.5, 5);
  await page.evaluate(() => window.__mj.cmd.goToPrevKeyframe());
  expect(await playhead(page)).toBeCloseTo(0, 5);
  await page.evaluate(() => window.__mj.cmd.goToPrevKeyframe());
  expect(await playhead(page)).toBeCloseTo(0, 5); // no earlier keyframe → stays
});

test("the transport buttons drive the playhead", async ({ page }) => {
  await seedKeys(page);
  await page.getByTestId("next-keyframe").click();
  expect(await playhead(page)).toBeCloseTo(0.5, 5);
  await page.getByTestId("next-keyframe").click();
  expect(await playhead(page)).toBeCloseTo(1, 5);
  await page.getByTestId("prev-keyframe").click();
  expect(await playhead(page)).toBeCloseTo(0.5, 5);
});

test("navigating keyframes pauses playback", async ({ page }) => {
  await seedKeys(page);
  await page.evaluate(() => window.__mj.store.setPlaying(true));
  await page.evaluate(() => window.__mj.cmd.goToNextKeyframe());
  expect(await page.evaluate(() => window.__mj.store.state.playing)).toBe(false);
});

test("navigation is a no-op when the clip has no keyframes", async ({ page }) => {
  await page.evaluate(() => {
    const { cmd, store } = window.__mj;
    cmd.addObject("rectangle", { x: 0, y: 0 });
    store.setPlayhead(0.3);
    cmd.goToNextKeyframe();
    cmd.goToPrevKeyframe();
  });
  expect(await playhead(page)).toBeCloseTo(0.3, 5);
});

test("hasKeyframes (the menu enable-state) reflects the clip", async ({ page }) => {
  expect(await page.evaluate(() => window.__mj.cmd.hasKeyframes())).toBe(false);
  await seedKeys(page);
  expect(await page.evaluate(() => window.__mj.cmd.hasKeyframes())).toBe(true);
});

test("keyframe navigation runs under the desktop CSP with zero security violations (smoke)", async ({ page }) => {
  await seedKeys(page);
  await page.evaluate(() => {
    window.__mj.cmd.goToNextKeyframe();
    window.__mj.cmd.goToNextKeyframe();
    window.__mj.cmd.goToPrevKeyframe();
  });
  expect(await playhead(page)).toBeCloseTo(0.5, 5);
  expect(await cspViolations(page)).toEqual([]);
});
