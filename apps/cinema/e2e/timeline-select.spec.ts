// Real-pointer selection tests for the Monet Cinema timeline.
// Each test clicks (and shift-clicks) clip DOM elements and asserts the store
// selection matches what was interacted with.
import { test, expect } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";
import {
  clipInfo,
  placeOnTimeline,
  razorAt,
  setPxPerFrame,
  setSnapping,
} from "./pointer";

test.beforeEach(async ({ page }) => {
  await gotoApp(page);
  await importFixture(page, "bars.webm"); // video on V1 + linked audio on A1
  const media = await page.evaluate(
    () => (window as any).__mc.store.getProject().media[0].id,
  );
  await placeOnTimeline(page, media);
  await setPxPerFrame(page, 4); // keep clips inside the narrow (~436px) e2e lane
  await setSnapping(page, false);
});

/** Get placed clip ids fresh (page reloaded in beforeEach). */
async function placedIds(
  page: import("@playwright/test").Page,
): Promise<{ video: string; audio?: string }> {
  return page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    let video = "",
      audio: string | undefined;
    for (const t of seq.tracks)
      for (const c of t.clips) {
        if (t.kind === "video" && !video) video = c.id;
        if (t.kind === "audio" && !audio) audio = c.id;
      }
    return { video, audio };
  });
}

/** Click the center of the clip body element for `clipId`. */
async function clickClip(
  page: import("@playwright/test").Page,
  clipId: string,
  modifiers: Array<"Shift" | "Meta" | "Alt" | "Control"> = [],
): Promise<void> {
  const loc = page.locator(`[data-clip-id="${clipId}"]`);
  await loc.waitFor({ state: "visible", timeout: 5_000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`clip ${clipId} has no bounding box`);
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2, {
    modifiers,
  });
}

/** Read current selection from the store. */
async function getSelection(
  page: import("@playwright/test").Page,
): Promise<string[]> {
  return page.evaluate(() => (window as any).__mc.store.state.selection);
}

// ---------------------------------------------------------------------------
// Test 1: clicking a clip body selects it (and its linked audio partner)
// ---------------------------------------------------------------------------
test("clicking a clip body selects only that clip", async ({ page }) => {
  const ids = await placedIds(page);

  // First deselect everything by clicking empty timeline area, then click clip
  await clickClip(page, ids.video);

  const sel = await getSelection(page);
  // The product selects the linked V+A pair when you click a video clip;
  // the video clip must be in the selection and no unrelated clips should be.
  expect(sel).toContain(ids.video);
  // selection is exactly the linked pair: [videoId, audioId]
  if (ids.audio) {
    expect(sel).toContain(ids.audio);
    expect(sel).toHaveLength(2);
  } else {
    expect(sel).toHaveLength(1);
  }
});

// ---------------------------------------------------------------------------
// Test 2: razor-split then shift-click both halves selects both
// ---------------------------------------------------------------------------
test("shift-clicking a second clip adds it to the selection", async ({
  page,
}) => {
  const ids = await placedIds(page);

  // razor at frame 20 → two video clips on V1
  await razorAt(page, ids.video, 20);

  // collect the two clips that now exist on the video track
  const videoClips = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const vt = seq.tracks.find((t: any) => t.kind === "video");
    return [...vt.clips]
      .sort((a: any, b: any) => a.start - b.start)
      .map((c: any) => c.id);
  });
  expect(videoClips).toHaveLength(2);
  const [first, second] = videoClips;

  // click the first clip to select it (also selects its linked audio half)
  await clickClip(page, first);
  const selAfterFirst = await getSelection(page);
  expect(selAfterFirst).toContain(first);

  // shift-click the second clip using keyboard.down/up to ensure the modifier
  // is held before the pointer event reaches the app
  const loc2 = page.locator(`[data-clip-id="${second}"]`);
  await loc2.waitFor({ state: "visible", timeout: 5_000 });
  const box2 = await loc2.boundingBox();
  if (!box2) throw new Error(`clip ${second} has no bounding box`);
  await page.keyboard.down("Shift");
  await page.mouse.click(box2.x + box2.width / 2, box2.y + box2.height / 2);
  await page.keyboard.up("Shift");

  const sel = await getSelection(page);
  expect(sel).toContain(first);
  expect(sel).toContain(second);
  // at minimum both video halves are selected
  expect(sel.length).toBeGreaterThanOrEqual(2);
});

// ---------------------------------------------------------------------------
// Test 3: clicking without shift replaces selection
// ---------------------------------------------------------------------------
test("clicking a clip without shift replaces the existing selection", async ({
  page,
}) => {
  const ids = await placedIds(page);

  // razor at frame 20 → two video clips
  await razorAt(page, ids.video, 20);

  const videoClips = await page.evaluate(() => {
    const mc: any = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const vt = seq.tracks.find((t: any) => t.kind === "video");
    return [...vt.clips]
      .sort((a: any, b: any) => a.start - b.start)
      .map((c: any) => c.id);
  });
  expect(videoClips).toHaveLength(2);
  const [first, second] = videoClips;

  // select the first clip (also selects its linked audio half)
  await clickClip(page, first);
  expect(await getSelection(page)).toContain(first);

  // plain click the second — should replace selection
  await clickClip(page, second);

  const sel = await getSelection(page);
  // Plain click replaces selection — second video clip must be selected,
  // first must NOT be (linked audio of second may also be selected, that's fine)
  expect(sel).toContain(second);
  expect(sel).not.toContain(first);
});

// ---------------------------------------------------------------------------
// Test 4: nudgeSelected shifts start; undo restores it
// ---------------------------------------------------------------------------
test("nudgeSelected shifts the clip start and undo restores it", async ({
  page,
}) => {
  const ids = await placedIds(page);

  const before = (await clipInfo(page, ids.video))!;

  // select the video clip and nudge +7 frames
  await page.evaluate(
    (id) => (window as any).__mc.store.select([id]),
    ids.video,
  );
  await page.evaluate(() => (window as any).__mc.cmd.nudgeSelected(7));

  const after = (await clipInfo(page, ids.video))!;
  expect(after.start).toBe(before.start + 7);

  // undo
  await page.evaluate(() => (window as any).__mc.store.undo());

  const restored = (await clipInfo(page, ids.video))!;
  expect(restored.start).toBe(before.start);
});
