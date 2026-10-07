// Shared helpers for the Monet Cinema e2e suite. Tests drive the app through
// `window.__mc` (DEV-only hook) and the committed video fixtures in
// test-assets/. All editing assertions read the model back out of the store.

import { type Page, expect } from "@playwright/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ASSETS = join(dirname(fileURLToPath(import.meta.url)), "..", "test-assets");

/* eslint-disable @typescript-eslint/no-explicit-any */
type MC = any;

export interface MediaSummary {
  id: string;
  name: string;
  width: number;
  height: number;
  durationFrames: number;
  hasAudio: boolean;
  kind: string;
}

/** Load the app and wait until the store reports ready. */
export async function gotoApp(page: Page): Promise<void> {
  await page.goto("/");
  await page.waitForFunction(() => Boolean((window as any).__mc?.store?.state?.ready), null, { timeout: 30_000 });
}

/** Import a committed fixture by filename; returns its MediaItem summary. */
export async function importFixture(page: Page, file: string, mime = "video/webm"): Promise<MediaSummary | null> {
  const b64 = readFileSync(join(ASSETS, file)).toString("base64");
  return page.evaluate(
    async ({ b64, file, mime }: { b64: string; file: string; mime: string }) => {
      const mc: MC = (window as any).__mc;
      const bin = atob(b64);
      const u8 = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
      const media = await mc.media.importFromBytes(file, u8, mime);
      if (!media) return null;
      return {
        id: media.id,
        name: media.name,
        width: media.width,
        height: media.height,
        durationFrames: media.durationFrames,
        hasAudio: media.hasAudio,
        kind: media.kind,
      };
    },
    { b64, file, mime },
  );
}

/** Read clip counts per track of the active sequence. */
export async function trackClipCounts(page: Page): Promise<{ video: number[]; audio: number[] }> {
  return page.evaluate(() => {
    const mc: MC = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const video: number[] = [];
    const audio: number[] = [];
    for (const t of seq.tracks) (t.kind === "video" ? video : audio).push(t.clips.length);
    return { video, audio };
  });
}

/** All clips on the active sequence (flat), with timing + ids. */
export async function allClips(page: Page): Promise<Array<{ id: string; trackKind: string; start: number; duration: number; inPoint: number }>> {
  return page.evaluate(() => {
    const mc: MC = (window as any).__mc;
    const seq = mc.query.activeSequence(mc.store.getProject());
    const out: any[] = [];
    for (const t of seq.tracks) for (const c of t.clips) out.push({ id: c.id, trackKind: t.kind, start: c.start, duration: c.duration, inPoint: c.inPoint });
    return out;
  });
}

export interface Signature {
  mean: number;
  variance: number;
  w: number;
  h: number;
}

/** Decode every source frame needed at `playhead`, composite at full res, and
 *  return a luma signature of the program output (mean + variance). */
export async function decodeAndSignature(page: Page, playhead: number): Promise<Signature> {
  return page.evaluate(async (ph: number) => {
    const mc: MC = (window as any).__mc;
    const project = mc.store.getProject();
    const seq = mc.query.activeSequence(project);
    mc.store.setPlayhead(ph);
    const specs = mc.playback.collectVideoSpecs(seq, ph);
    await Promise.all(
      specs
        .filter((s: any) => s.clip.kind === "video")
        .map((s: any) => {
          const m = mc.query.findMedia(project, s.clip.mediaId);
          return m ? mc.decoder.ensureFrameDecoded(m, s.sampleFrame) : Promise.resolve();
        }),
    );
    mc.engine.ensure(seq.width, seq.height);
    mc.playback.renderProgramFrame(seq, ph, 1);
    const out = mc.engine.readOutput();
    let sum = 0;
    let sumsq = 0;
    const n = out.length / 4;
    for (let i = 0; i < out.length; i += 4) {
      const l = out[i] * 0.299 + out[i + 1] * 0.587 + out[i + 2] * 0.114;
      sum += l;
      sumsq += l * l;
    }
    const mean = sum / n;
    return { mean, variance: sumsq / n - mean * mean, w: mc.engine.width, h: mc.engine.height };
  }, playhead);
}

export { expect };
