// Real-pointer helpers for timeline interaction e2e: they drive actual
// mouse.down/move/up over the rendered clip DOM (data-clip-id / data-trim /
// data-track-id) so the tests exercise TimelinePanel's pointer handlers — not
// just the command layer. Geometry comes from boundingBox() + the store's
// live pxPerFrame, so tests are zoom-agnostic.

import { type Page } from "@playwright/test";

/* eslint-disable @typescript-eslint/no-explicit-any */
type MC = any;

export async function setPxPerFrame(page: Page, pxf: number): Promise<void> {
  await page.evaluate((v) => (window as any).__mc.store.setZoom(v), pxf);
}
export async function setSnapping(page: Page, on: boolean): Promise<void> {
  await page.evaluate((v) => (window as any).__mc.store.setSnapping(v), on);
}
export async function setTool(page: Page, tool: string): Promise<void> {
  await page.evaluate((t) => (window as any).__mc.store.setTool(t), tool);
}
export async function pxPerFrame(page: Page): Promise<number> {
  return page.evaluate(() => (window as any).__mc.store.state.pxPerFrame);
}

/** Place media on the timeline at the playhead; returns the new clip ids/timing. */
export async function placeOnTimeline(page: Page, mediaId: string): Promise<{ video?: string; audio?: string; clips: Array<{ id: string; kind: string; start: number; duration: number }> }> {
  return page.evaluate((id) => {
    const m: MC = (window as any).__mc;
    m.cmd.addMediaToTimeline(id);
    const seq = m.query.activeSequence(m.store.getProject());
    const clips: any[] = [];
    let video: string | undefined, audio: string | undefined;
    for (const t of seq.tracks) for (const c of t.clips) {
      clips.push({ id: c.id, kind: t.kind, start: c.start, duration: c.duration });
      if (t.kind === "video" && !video) video = c.id;
      if (t.kind === "audio" && !audio) audio = c.id;
    }
    return { video, audio, clips };
  }, mediaId);
}

/** Model lookup for a clip: { start, duration, inPoint, trackId, trackKind, trackName } or null. */
export async function clipInfo(page: Page, clipId: string): Promise<{ start: number; duration: number; inPoint: number; trackId: string; trackKind: string; trackName: string } | null> {
  return page.evaluate((id) => {
    const m: MC = (window as any).__mc;
    const seq = m.query.activeSequence(m.store.getProject());
    for (const t of seq.tracks) {
      const c = t.clips.find((x: any) => x.id === id);
      if (c) return { start: c.start, duration: c.duration, inPoint: c.inPoint, trackId: t.id, trackKind: t.kind, trackName: t.name };
    }
    return null;
  }, clipId);
}

/** Ids of the video tracks (bottom→top model order: V1, V2, V3). */
export async function videoTrackIds(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const m: MC = (window as any).__mc;
    const seq = m.query.activeSequence(m.store.getProject());
    return seq.tracks.filter((t: any) => t.kind === "video").map((t: any) => t.id);
  });
}

async function clipBox(page: Page, clipId: string) {
  const loc = page.locator(`[data-clip-id="${clipId}"]`);
  await loc.waitFor({ state: "visible", timeout: 5_000 });
  const box = await loc.boundingBox();
  if (!box) throw new Error(`clip ${clipId} has no bounding box`);
  return box;
}
async function trackBox(page: Page, trackId: string) {
  const box = await page.locator(`[data-track-id="${trackId}"]`).first().boundingBox();
  if (!box) throw new Error(`track ${trackId} has no bounding box`);
  return box;
}

/** Drag a clip body horizontally by `frames` (positive = right), same track. */
export async function dragClipByFrames(page: Page, clipId: string, frames: number): Promise<void> {
  const box = await clipBox(page, clipId);
  const pxf = await pxPerFrame(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + frames * pxf, y, { steps: 12 });
  await page.mouse.up();
}

/** Drag a clip onto `trackId`, landing its start near `toStart` frames. */
export async function dragClipToTrack(page: Page, clipId: string, trackId: string, toStart: number): Promise<void> {
  const box = await clipBox(page, clipId);
  const tbox = await trackBox(page, trackId);
  const pxf = await pxPerFrame(page);
  const info = await clipInfo(page, clipId);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  const dx = (toStart - (info?.start ?? 0)) * pxf;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + dx, tbox.y + tbox.height / 2, { steps: 14 });
  await page.mouse.up();
}

/** Drag a trim handle ("start" | "end") by `frames`, targeting the handle element. */
export async function dragTrim(page: Page, clipId: string, side: "start" | "end", frames: number): Promise<void> {
  const handle = page.locator(`[data-clip-id="${clipId}"] [data-trim="${side}"]`);
  await handle.waitFor({ state: "visible", timeout: 5_000 });
  const box = await handle.boundingBox();
  if (!box) throw new Error(`trim handle ${side} of ${clipId} has no box`);
  const pxf = await pxPerFrame(page);
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + frames * pxf, y, { steps: 12 });
  await page.mouse.up();
}

/** Razor-cut a clip at `atFrame` using the razor tool (real pointer). */
export async function razorAt(page: Page, clipId: string, atFrame: number): Promise<void> {
  await setTool(page, "razor");
  const box = await clipBox(page, clipId);
  const pxf = await pxPerFrame(page);
  const info = await clipInfo(page, clipId);
  const x = box.x + (atFrame - (info?.start ?? 0)) * pxf;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.up();
  await setTool(page, "select");
}
