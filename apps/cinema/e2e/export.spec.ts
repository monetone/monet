// MP4 export e2e — proves the exporter bakes the timeline audio mix into the
// file (TIME-07 / Rythme → Cinema needs a finished deliverable, not a
// picture-only render). Drives the real exporter through the dev server so the
// whole WebCodecs + mp4-muxer path runs, then decodes the result back.

import { test, expect, type Page } from "@playwright/test";
import { gotoApp, importFixture } from "./helpers";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface ExportResult {
  bytes: number;
  hasMp4aBox: boolean;
  /** Decoded audio of the exported file, when it has any. */
  audio: { seconds: number; rms: number } | null;
}

/**
 * Place the bin's first media, shrink the sequence so the encode is cheap, run
 * the real `exportVideo`, and report what the resulting MP4 actually contains.
 */
async function exportAndInspect(page: Page, frames: number): Promise<ExportResult> {
  return page.evaluate(async (frames: number) => {
    const mc: any = (window as any).__mc;
    mc.cmd.addMediaToTimeline(mc.store.getProject().media[0].id);
    // Trim to a handful of frames so the full-res encode fits the test budget.
    // (Resizing the sequence instead would race the live program monitor, which
    // re-`ensure`s the engine at preview resolution between export frames.)
    mc.store.mutate("E2E Setup", (p: any) => {
      const seq = p.sequences.find((s: any) => s.id === p.activeSequenceId) ?? p.sequences[0];
      for (const t of seq.tracks) for (const c of t.clips) c.duration = Math.min(c.duration, frames);
    });

    // Same module instance the app uses (Vite serves one record per URL), so
    // the exporter sees the store/engine singletons we just mutated.
    const url = "/src/playback/export.ts";
    const { exportVideo } = await import(/* @vite-ignore */ url);
    const blob: Blob = await exportVideo();
    const buf = await blob.arrayBuffer();

    // The 'mp4a' sample-entry fourcc only appears when an audio track is muxed.
    const u8 = new Uint8Array(buf);
    const fourcc = [0x6d, 0x70, 0x34, 0x61]; // "mp4a"
    let hasMp4aBox = false;
    for (let i = 0; i + 4 <= u8.length && !hasMp4aBox; i++) {
      hasMp4aBox = fourcc.every((b, k) => u8[i + k] === b);
    }

    let audio: { seconds: number; rms: number } | null = null;
    try {
      const decoded = await new AudioContext().decodeAudioData(buf.slice(0));
      const ch = decoded.getChannelData(0);
      let sq = 0;
      for (let i = 0; i < ch.length; i++) sq += ch[i] * ch[i];
      audio = { seconds: decoded.duration, rms: Math.sqrt(sq / ch.length) };
    } catch {
      audio = null; // no decodable audio track
    }
    return { bytes: buf.byteLength, hasMp4aBox, audio };
  }, frames);
}

test("export bakes the audio mix into the MP4", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  const media = await importFixture(page, "tone.webm");
  expect(media?.hasAudio).toBe(true);

  const out = await exportAndInspect(page, 24);
  expect(out.bytes).toBeGreaterThan(1000);
  expect(out.hasMp4aBox).toBe(true);
  expect(out.audio).not.toBeNull();
  // The fixture's 440 Hz tone survived the offline mix render + AAC encode.
  expect(out.audio!.rms).toBeGreaterThan(0.01);
  expect(out.audio!.seconds).toBeGreaterThan(0.5);
});

test("export stays video-only when the timeline has no audio", async ({ page }) => {
  test.setTimeout(120_000);
  await gotoApp(page);
  await importFixture(page, "bars.webm");

  // Negative control: declaring an audio track we never fill would produce an
  // MP4 that stalls in players.
  const out = await exportAndInspect(page, 12);
  expect(out.bytes).toBeGreaterThan(1000);
  expect(out.hasMp4aBox).toBe(false);
  expect(out.audio).toBeNull();
});
