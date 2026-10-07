// ─────────────────────────────────────────────────────────────
// engine/ops/sample-rate.test — Audition-style Convert Sample Type ▸ Sample Rate
// ─────────────────────────────────────────────────────────────
// Pins the session resample: the project's rate and every clip's buffer change,
// the seconds-domain timeline (start / duration / in-point) is untouched, the
// rendered duration in seconds is preserved, and the input is never mutated.

import { describe, expect, it } from "vitest";
import { frameCount, type AudioData } from "../audio/types";
import { emptyProject, newClip } from "../model/factory";
import type { Project } from "../model/types";
import { sine } from "../generate/tone";
import { renderProject } from "./render";
import { resampleProject } from "./sample-rate";

function project(rate: number, seconds = 1, start = 0.5): Project {
  const buf = sine(440, seconds, { sampleRate: rate, amplitude: 0.5 });
  const p0 = emptyProject("t", 1, rate);
  const track = { ...p0.tracks[0], clips: [newClip(buf, { trackId: p0.tracks[0].id, start, duration: seconds })] };
  return { ...p0, tracks: [track] };
}

describe("resampleProject", () => {
  it("updates the project rate and every clip's buffer", () => {
    const out = resampleProject(project(44100), 48000);
    const clip = out.tracks[0].clips[0];
    expect(out.sampleRate).toBe(48000);
    expect(clip.buffer.sampleRate).toBe(48000);
    expect(frameCount(clip.buffer)).toBe(48000); // 1 s at 48 kHz
  });

  it("leaves the seconds-domain timeline untouched", () => {
    const out = resampleProject(project(44100, 1, 0.5), 48000);
    const clip = out.tracks[0].clips[0];
    expect(clip.start).toBe(0.5);
    expect(clip.duration).toBe(1);
    expect(clip.inPoint).toBe(0);
  });

  it("preserves the rendered duration in seconds", () => {
    const p = project(44100);
    const up = resampleProject(p, 48000);
    const orig = frameCount(renderProject(p)) / p.sampleRate;
    const conv = frameCount(renderProject(up)) / up.sampleRate;
    expect(conv).toBeCloseTo(orig, 3);
  });

  it("downsampling halves the frame count", () => {
    const out = resampleProject(project(44100), 22050);
    expect(out.sampleRate).toBe(22050);
    expect(frameCount(out.tracks[0].clips[0].buffer)).toBe(22050); // 1 s at 22.05 kHz
  });

  it("resamples every clip across all tracks", () => {
    const buf = (r: number): AudioData => sine(440, 0.5, { sampleRate: r, amplitude: 0.4 });
    const p0 = emptyProject("multi", 2, 44100);
    const t0 = { ...p0.tracks[0], clips: [newClip(buf(44100), { trackId: p0.tracks[0].id })] };
    const t1 = { ...p0.tracks[1], clips: [newClip(buf(44100), { trackId: p0.tracks[1].id, start: 1 })] };
    const out = resampleProject({ ...p0, tracks: [t0, t1] }, 48000);
    for (const t of out.tracks) for (const c of t.clips) expect(c.buffer.sampleRate).toBe(48000);
  });

  it("is a no-op (same reference) when the rate is unchanged", () => {
    const p = project(44100);
    expect(resampleProject(p, 44100)).toBe(p);
  });

  it("handles a project with no clips", () => {
    const out = resampleProject(emptyProject("e", 3, 44100), 96000);
    expect(out.sampleRate).toBe(96000);
    expect(out.tracks).toHaveLength(3);
  });

  it("throws on a non-positive rate", () => {
    expect(() => resampleProject(project(44100), 0)).toThrow();
    expect(() => resampleProject(project(44100), -1)).toThrow();
  });

  it("does not mutate the input project or its clips", () => {
    const p = project(44100);
    const beforeRate = p.sampleRate;
    const beforeFrames = frameCount(p.tracks[0].clips[0].buffer);
    resampleProject(p, 48000);
    expect(p.sampleRate).toBe(beforeRate);
    expect(frameCount(p.tracks[0].clips[0].buffer)).toBe(beforeFrames);
  });
});
