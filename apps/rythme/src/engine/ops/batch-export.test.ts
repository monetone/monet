// ─────────────────────────────────────────────────────────────
// ops/batch-export.test — Audition-style batch export deliverables
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { dbToGain } from "../audio/db";
import { channelCount, durationSeconds } from "../audio/types";
import { peakAmplitude } from "../dsp/normalize";
import { decodeAudio, decodeWavCues, sniffFormat } from "../io";
import { emptyProject, newClip, newMarker, newTrack } from "../model/factory";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { encodeBatchExports, processBatchAudio, renderBatchExports } from "./batch-export";

const SR = 8000;

function pulse(seconds: number, amp: number) {
  const frames = Math.round(seconds * SR);
  const ch = new Float32Array(frames);
  for (let i = 0; i < frames; i++) ch[i] = i % 2 === 0 ? amp : -amp;
  return { sampleRate: SR, channels: [ch.slice(), ch.slice()] };
}

function project(): Project {
  let p = emptyProject("Batch/Test", 0, SR);
  const dialog = newTrack(0, { name: "Dialog/VO" });
  const music = newTrack(1, { name: "Music" });
  p = { ...p, tracks: [dialog, music] };
  p = addClip(p, dialog.id, newClip(pulse(0.1, 0.5), { trackId: dialog.id, start: 0, name: "Line 1" }));
  p = addClip(p, music.id, newClip(pulse(0.05, 0.25), { trackId: music.id, start: 0.1, name: "Bed" }));
  return {
    ...p,
    markers: [
      newMarker({ time: 0.025, name: "Cue inside" }),
      newMarker({ time: 0.02, end: 0.07, name: "Take: 1" }),
      newMarker({ time: 0.2, name: "Cue outside" }),
    ],
  };
}

describe("renderBatchExports", () => {
  it("renders track stems as separate session-length items with safe unique names", () => {
    const p = project();
    const items = renderBatchExports(p, { kind: "tracks" });
    expect(items.map((i) => i.kind)).toEqual(["track", "track"]);
    expect(items.map((i) => i.name)).toEqual(["Batch-Test - Dialog-VO", "Batch-Test - Music"]);
    expect(items.every((i) => durationSeconds(i.audio) === durationSeconds(items[0].audio))).toBe(true);
    expect(durationSeconds(items[0].audio)).toBeCloseTo(0.15, 6);
    expect(items.every((i) => channelCount(i.audio) === 2)).toBe(true);
  });

  it("renders only region markers for region batches and rebases embedded cues", () => {
    const p = project();
    const items = renderBatchExports(p, { kind: "regions" });
    expect(items).toHaveLength(1);
    expect(items[0].name).toBe("Batch-Test - Take- 1");
    expect(durationSeconds(items[0].audio)).toBeCloseTo(0.05, 6);
    expect(items[0].markers).toEqual([
      { time: 0.005000000000000001, name: "Cue inside" },
      { time: 0, name: "Take: 1" },
    ]);
  });

  it("renders selected clips in selection order and ignores duplicate or unknown ids", () => {
    const p = project();
    const dialogClip = p.tracks[0].clips[0].id;
    const musicClip = p.tracks[1].clips[0].id;
    const items = renderBatchExports(p, { kind: "clips", clipIds: [musicClip, "missing", musicClip, dialogClip] });
    expect(items.map((i) => i.sourceId)).toEqual([musicClip, dialogClip]);
    expect(items.map((i) => i.name)).toEqual(["Batch-Test - Music - Bed", "Batch-Test - Dialog-VO - Line 1"]);
  });
});

describe("encodeBatchExports", () => {
  it("encodes WAV batch files with marker cues and project-safe filenames", () => {
    const files = encodeBatchExports(project(), { kind: "regions" }, { format: "wav", bitDepth: 16 });
    expect(files).toHaveLength(1);
    expect(files[0].name).toBe("Batch-Test - Take- 1.wav");
    expect(files[0].mime).toBe("audio/wav");
    expect(sniffFormat(files[0].bytes)).toBe("wav");
    expect(durationSeconds(decodeAudio(files[0].bytes, files[0].name))).toBeCloseTo(0.05, 6);
    expect(decodeWavCues(files[0].bytes).map((m) => m.name)).toEqual(["Cue inside", "Take: 1"]);
  });

  it("encodes AIFF stem batches when requested", () => {
    const files = encodeBatchExports(project(), { kind: "tracks" }, { format: "aiff", bitDepth: 24 });
    expect(files).toHaveLength(2);
    expect(files[0].name.endsWith(".aiff")).toBe(true);
    expect(files[0].mime).toBe("audio/aiff");
    expect(sniffFormat(files[0].bytes)).toBe("aiff");
  });

  it("applies a per-file process chain before encoding batch deliverables", () => {
    const files = encodeBatchExports(project(), { kind: "tracks" }, {
      format: "wav",
      bitDepth: 32,
      float: true,
      processing: [
        { kind: "gain", gainDb: 12 },
        { kind: "hardLimiter", ceilingDb: -6, lookAheadMs: 1 },
      ],
    });
    const decoded = decodeAudio(files[0].bytes, files[0].name);
    expect(peakAmplitude(decoded)).toBeLessThanOrEqual(dbToGain(-6) + 1e-5);
    expect(peakAmplitude(decoded)).toBeGreaterThan(0.45);
  });
});

describe("processBatchAudio", () => {
  it("runs normalize and loudness-style steps without mutating the source", () => {
    const source = pulse(0.25, 0.125);
    const processed = processBatchAudio(source, [
      { kind: "normalizePeak", targetDb: -1 },
      { kind: "gain", gainDb: -6 },
    ]);
    expect(peakAmplitude(source)).toBeCloseTo(0.125, 6);
    expect(peakAmplitude(processed)).toBeCloseTo(dbToGain(-7), 3);
  });
});
