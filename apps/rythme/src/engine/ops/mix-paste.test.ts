// ─────────────────────────────────────────────────────────────
// ops/mix-paste.test — Mix Paste (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────
// Paste's gain/invert options: an inverted overlay nulls the original, and a
// gain trim is added to the pasted clips.

import { describe, expect, it } from "vitest";
import { peakAmplitude } from "../dsp/normalize";
import { sine } from "../generate/tone";
import { emptyProject, newClip } from "../model/factory";
import type { Project } from "../model/types";
import { addClip } from "./clip";
import { copyRange, pasteAt } from "./clipboard";
import { renderProject, renderTrack } from "./render";

const SR = 48000;

/** One track with a 1 s, 0.5-amplitude tone clip at t=0. */
function project(): { project: Project; trackId: string } {
  const p = emptyProject("T", 1, SR);
  const trackId = p.tracks[0].id;
  const clip = newClip(sine(440, 1, { sampleRate: SR, amplitude: 0.5, channels: 2 }), { trackId, start: 0, name: "A" });
  return { project: addClip(p, trackId, clip), trackId };
}

describe("pasteAt — Mix Paste options", () => {
  it("phase-inverts the pasted material, nulling the original when overlaid", () => {
    const { project: p, trackId } = project();
    const clip = copyRange(p, 0, 1, [trackId]); // capture the tone
    const before = peakAmplitude(renderTrack(p.tracks[0], SR, 2));
    expect(before).toBeGreaterThan(0.4);

    const out = pasteAt(p, 0, clip, { invert: true }); // overlay an inverted copy at t=0
    const after = peakAmplitude(renderTrack(out.tracks[0], SR, 2));
    expect(after).toBeLessThan(before * 0.02); // ≈ silence (A + −A)
  });

  it("a non-inverted overlay roughly doubles the level (it sums)", () => {
    const { project: p, trackId } = project();
    const clip = copyRange(p, 0, 1, [trackId]);
    const before = peakAmplitude(renderTrack(p.tracks[0], SR, 2));
    const out = pasteAt(p, 0, clip, {}); // plain mix overlay
    const after = peakAmplitude(renderTrack(out.tracks[0], SR, 2));
    expect(after).toBeGreaterThan(before * 1.8);
  });

  it("adds the gain trim to the pasted clips", () => {
    const { project: p, trackId } = project();
    const clip = copyRange(p, 0, 1, [trackId]);
    const out = pasteAt(p, 0, clip, { gainDb: -6 });
    const pasted = out.tracks[0].clips.find((c) => c.id !== p.tracks[0].clips[0].id)!;
    expect(pasted.gainDb).toBeCloseTo(-6, 6); // clipboard clip gain (0) + (−6)
  });

  it("default paste (no options) keeps the clip's gain and the same buffer reference (no re-allocation)", () => {
    const { project: p, trackId } = project();
    const clip = copyRange(p, 0, 1, [trackId]);
    const out = pasteAt(p, 0, clip, {});
    const pasted = out.tracks[0].clips.find((c) => c.id !== p.tracks[0].clips[0].id)!;
    expect(pasted.gainDb).toBe(clip.tracks[0].clips[0].gainDb);
    expect(pasted.buffer).toBe(clip.tracks[0].clips[0].buffer); // not re-allocated when not inverting
  });

  it("inverted mix paste leaves a project-wide null (renderProject ≈ silence)", () => {
    const { project: p, trackId } = project();
    const clip = copyRange(p, 0, 1, [trackId]);
    const out = pasteAt(p, 0, clip, { invert: true });
    expect(peakAmplitude(renderProject(out))).toBeLessThan(0.02);
  });
});
