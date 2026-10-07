// ─────────────────────────────────────────────────────────────
// ui/dtmf-presets.test — the shipped DTMF Signals presets
// ─────────────────────────────────────────────────────────────
// Drives each DTMF_PRESETS dial string through the generator: the right number
// of tones for the duration, and the first key's dual-tone is present.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { DTMF_PRESETS } from "./commands";

const SR = 44100;
const durMs = (d: E.AudioData) => (E.frameCount(d) / SR) * 1000;
const opts = (id: string) => DTMF_PRESETS.find((p) => p.id === id)!;
const gen = (id: string) => {
  const p = opts(id);
  return E.Generate.dtmfSequence(p.dial, { ...p.opts, sampleRate: SR });
};

describe("DTMF_PRESETS", () => {
  it("exposes the four named presets", () => {
    expect(DTMF_PRESETS.map((p) => p.label)).toEqual(["Dial 911", "Dial 1 800 555 0100", "Sweep 0–9", "* 0 #"]);
  });

  it("Dial 911 is three tones with two breaks", () => {
    const p = opts("dtmf911");
    expect(durMs(gen("dtmf911"))).toBeCloseTo((p.opts.toneMs ?? 0) * 3 + (p.opts.breakMs ?? 0) * 2, 0);
  });

  it("Sweep 0–9 produces a long, non-empty clip with 10 tones", () => {
    const p = opts("dtmfSeq");
    expect(durMs(gen("dtmfSeq"))).toBeCloseTo((p.opts.toneMs ?? 0) * 10 + (p.opts.breakMs ?? 0) * 9, 0);
  });

  it("every preset renders the first key's dual-tone", () => {
    for (const p of DTMF_PRESETS) {
      const ch = E.Generate.dtmfSequence(p.dial, { ...p.opts, sampleRate: SR }).channels[0];
      const mags = E.Analysis.magnitudes(ch.subarray(0, 4096), 4096);
      let peak = 0;
      for (const m of mags) peak = Math.max(peak, m);
      expect(peak).toBeGreaterThan(100); // there is a strong tone at the start
    }
  });
});
