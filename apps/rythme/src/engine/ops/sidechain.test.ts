// ─────────────────────────────────────────────────────────────
// engine/ops/sidechain.test — timeline-aligned keyed effects (duck + compress)
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { durationSeconds } from "../audio/types";
import { sine } from "../generate/tone";
import { emptyProject, newClip, newTrack } from "../model/factory";
import { resetIds } from "../model/ids";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { renderClip } from "./render";
import { duckTrack, sidechainCompressTrack, sidechainGateTrack } from "./sidechain";

const SR = 48000;

/** RMS of channel 0 over [t0, t1) seconds of a rendered buffer. */
function rmsAt(d: { channels: Float32Array[] }, t0: number, t1: number): number {
  const ch = d.channels[0];
  const a = Math.round(t0 * SR);
  const b = Math.round(t1 * SR);
  let sum = 0;
  for (let i = a; i < b; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / Math.max(1, b - a));
}

/** Target = 1.6 s tone; key = a 0.4 s tone positioned at 0.4 s on its own track. */
function twoTrackProject(): { project: Project; targetId: string; keyId: string } {
  resetIds();
  let project = emptyProject("Duck", 0, SR);
  const target = newTrack(0, { name: "Music" });
  const key = newTrack(1, { name: "Voice" });
  project = { ...project, tracks: [target, key] };
  project = addClip(project, target.id, newClip(sine(440, 1.6, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId: target.id, start: 0 }));
  project = addClip(project, key.id, newClip(sine(200, 0.4, { sampleRate: SR, amplitude: 0.6, channels: 2 }), { trackId: key.id, start: 0.4 }));
  return { project, targetId: target.id, keyId: key.id };
}

describe("duckTrack", () => {
  it("replaces the target track with one ducked clip that dips under the key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const out = duckTrack(project, targetId, keyId, { amountDb: -12, attackMs: 30, releaseMs: 150, holdMs: 50 });
    const targetTrack = out.tracks.find((t) => t.id === targetId)!;
    expect(targetTrack.clips).toHaveLength(1);
    expect(targetTrack.clips[0].start).toBe(0);
    expect(durationSeconds(targetTrack.clips[0].buffer)).toBeCloseTo(1.6, 1);

    const render = renderClip(targetTrack.clips[0]);
    const before = rmsAt(render, 0.0, 0.3); // key silent → unity
    const ducked = rmsAt(render, 0.7, 0.79); // key at 0.4–0.8 → pulled down
    const after = rmsAt(render, 1.4, 1.6); // released → unity
    expect(ducked).toBeLessThan(before * 0.5);
    expect(after).toBeGreaterThan(before * 0.85);
  });

  it("leaves the key track untouched and does not mutate the input project", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const before = project.tracks.find((t) => t.id === targetId)!.clips[0];
    const out = duckTrack(project, targetId, keyId, { amountDb: -12 });
    // key track unchanged
    expect(out.tracks.find((t) => t.id === keyId)!.clips[0].start).toBe(0.4);
    // original project object untouched (immutable)
    expect(project.tracks.find((t) => t.id === targetId)!.clips[0]).toBe(before);
    expect(out).not.toBe(project);
  });

  it("returns the project unchanged for a missing or self-referential key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    expect(duckTrack(project, targetId, "nope", {})).toBe(project);
    expect(duckTrack(project, targetId, targetId, {})).toBe(project);
    expect(duckTrack(project, "nope", keyId, {})).toBe(project);
  });
});

describe("sidechainCompressTrack", () => {
  it("replaces the target with one compressed clip that dips under the key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const out = sidechainCompressTrack(project, targetId, keyId, { thresholdDb: -30, ratio: 6, attackMs: 10 });
    const targetTrack = out.tracks.find((t) => t.id === targetId)!;
    expect(targetTrack.clips).toHaveLength(1);
    expect(targetTrack.clips[0].name).toBe("Compressed");

    const render = renderClip(targetTrack.clips[0]);
    const before = rmsAt(render, 0.0, 0.3);
    const compressed = rmsAt(render, 0.65, 0.78); // key at 0.4–0.8 → pumped down
    const after = rmsAt(render, 1.4, 1.6);
    expect(compressed).toBeLessThan(before * 0.7);
    expect(after).toBeGreaterThan(before * 0.85);
  });

  it("is immutable and a no-op for a self-referential key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const before = project.tracks.find((t) => t.id === targetId)!.clips[0];
    const out = sidechainCompressTrack(project, targetId, keyId, { ratio: 4 });
    expect(project.tracks.find((t) => t.id === targetId)!.clips[0]).toBe(before);
    expect(out).not.toBe(project);
    expect(sidechainCompressTrack(project, targetId, targetId, {})).toBe(project);
  });
});

describe("sidechainGateTrack", () => {
  it("replaces the target with one gated clip audible only under the key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const out = sidechainGateTrack(project, targetId, keyId, { thresholdDb: -30, rangeDb: -40, attackMs: 5, holdMs: 30 });
    const targetTrack = out.tracks.find((t) => t.id === targetId)!;
    expect(targetTrack.clips).toHaveLength(1);
    expect(targetTrack.clips[0].name).toBe("Gated");

    const render = renderClip(targetTrack.clips[0]);
    const opened = rmsAt(render, 0.55, 0.78); // key at 0.4–0.8 → open
    const gated = rmsAt(render, 1.4, 1.6); // after the key → gated
    expect(gated).toBeLessThan(opened * 0.2);
  });

  it("is immutable and a no-op for a self-referential key", () => {
    const { project, targetId, keyId } = twoTrackProject();
    const before = project.tracks.find((t) => t.id === targetId)!.clips[0];
    const out = sidechainGateTrack(project, targetId, keyId, { rangeDb: -40 });
    expect(project.tracks.find((t) => t.id === targetId)!.clips[0]).toBe(before);
    expect(out).not.toBe(project);
    expect(sidechainGateTrack(project, targetId, targetId, {})).toBe(project);
  });
});
