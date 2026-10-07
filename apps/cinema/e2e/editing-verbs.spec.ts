import { test, expect } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";

// Editing verbs that editing.spec leaves uncovered: duplicate, nudge, the
// non-ripple delete (which preserves the gap — the counterpart to the covered
// ripple delete), and select-all. Each drives a real cmd through the live app
// and reads the result back out of the store model — no frame decode involved.

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  // A clip on V1 with its linked audio on A1 (same setup editing.spec uses).
  await importFixture(page, "bars.webm");
  await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    mc.cmd.addMediaToTimeline(mc.store.getProject().media[0].id);
  });
});

test("duplicate places a copy immediately after the original and selects only it", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const v1 = seq.tracks.find((t: any) => t.kind === "video");
    const orig = v1.clips[0];
    mc.store.select([orig.id]);
    mc.cmd.duplicateSelected();
    const fresh = mc.query.activeSequence(mc.store.getProject());
    const vAfter = fresh.tracks.find((t: any) => t.kind === "video");
    const aAfter = fresh.tracks.find((t: any) => t.kind === "audio");
    const sorted = [...vAfter.clips].sort((a: any, b: any) => a.start - b.start);
    return {
      videoCount: vAfter.clips.length,
      audioCount: aAfter.clips.length,
      expectedDupStart: orig.start + orig.duration,
      dupStart: sorted[1].start,
      dupId: sorted[1].id,
      selection: mc.store.selection,
    };
  });
  expect(r.videoCount).toBe(2);
  expect(r.audioCount).toBe(1); // duplicate acts on the selection only, not the linked audio
  expect(r.dupStart).toBe(r.expectedDupStart); // placed end-to-end after the source
  expect(r.selection).toEqual([r.dupId]); // the new clip becomes the selection
});

test("nudge shifts the selected clip by frames and clamps the start at zero", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const id = mc.query.activeSequence(mc.store.getProject()).tracks.find((t: any) => t.kind === "video").clips[0].id;
    const startOf = () => mc.query.findClip(mc.query.activeSequence(mc.store.getProject()), id).clip.start;
    const start0 = startOf();
    mc.store.select([id]);
    mc.cmd.nudgeSelected(30);
    const start1 = startOf();
    mc.cmd.nudgeSelected(-100000); // far past the origin
    const start2 = startOf();
    return { start0, start1, start2 };
  });
  expect(r.start1).toBe(r.start0 + 30);
  expect(r.start2).toBe(0); // clamped, never negative
});

test("non-ripple delete removes the clip but leaves the gap (unlike ripple)", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    mc.store.setPlayhead(12);
    mc.cmd.razorAtPlayhead(true); // V1 now: [0..12] and [12..end]
    const v1 = mc.query.activeSequence(mc.store.getProject()).tracks.find((t: any) => t.kind === "video");
    const sorted = [...v1.clips].sort((a: any, b: any) => a.start - b.start);
    const secondStart = sorted[1].start;
    mc.store.select([sorted[0].id]); // remove the first half
    mc.cmd.deleteSelected();
    const after = mc.query.activeSequence(mc.store.getProject()).tracks.find((t: any) => t.kind === "video");
    return { remaining: after.clips.length, remainStart: after.clips[0].start, secondStart };
  });
  expect(r.remaining).toBe(1);
  expect(r.secondStart).toBe(12);
  expect(r.remainStart).toBe(r.secondStart); // the survivor stays put — the gap is NOT closed
});

test("selectAll selects every clip across tracks", async ({ page }) => {
  const r = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    mc.cmd.selectAll();
    const seq = mc.query.activeSequence(mc.store.getProject());
    const allIds = seq.tracks.flatMap((t: any) => t.clips.map((c: any) => c.id));
    return { total: allIds.length, sel: [...mc.store.selection].sort(), all: allIds.sort() };
  });
  expect(r.total).toBe(2); // video + its linked audio
  expect(r.sel).toEqual(r.all);
});
