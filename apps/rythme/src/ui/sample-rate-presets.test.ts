// ─────────────────────────────────────────────────────────────
// ui/sample-rate-presets.test — the shipped Project Sample Rate presets
// ─────────────────────────────────────────────────────────────
// Drives each SAMPLE_RATE_PRESETS rate through the engine resample op, proving a
// project + its clip land on the chosen rate.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { SAMPLE_RATE_PRESETS } from "./commands";

function project(rate: number): E.Project {
  const buf = E.Generate.sine(440, 0.5, { sampleRate: rate, amplitude: 0.4 });
  const p0 = E.emptyProject("t", 1, rate);
  const track = { ...p0.tracks[0], clips: [E.newClip(buf, { trackId: p0.tracks[0].id })] };
  return { ...p0, tracks: [track] };
}

describe("SAMPLE_RATE_PRESETS", () => {
  it("exposes the standard target rates", () => {
    expect(SAMPLE_RATE_PRESETS.map((p) => p.rate)).toEqual([22050, 32000, 44100, 48000, 96000]);
  });

  it("each preset converts the session (and its clip) to that rate", () => {
    const p = project(44100);
    for (const preset of SAMPLE_RATE_PRESETS) {
      const out = E.Ops.resampleProject(p, preset.rate);
      expect(out.sampleRate).toBe(preset.rate);
      expect(out.tracks[0].clips[0].buffer.sampleRate).toBe(preset.rate);
    }
  });
});
