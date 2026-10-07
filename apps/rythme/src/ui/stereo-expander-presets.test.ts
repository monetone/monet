// ─────────────────────────────────────────────────────────────
// ui/stereo-expander-presets.test — the shipped Stereo Expander presets
// ─────────────────────────────────────────────────────────────
// Drives the actual STEREO_EXPANDER_PRESETS objects through the engine so each
// named preset provably changes the stereo image the way its label promises.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { STEREO_EXPANDER_PRESETS } from "./commands";

const SR = 44100;

function stereoTones(lf: number, rf: number): E.AudioData {
  const l = E.Generate.sine(lf, 0.2, { sampleRate: SR, amplitude: 0.4 }).channels[0];
  const r = E.Generate.sine(rf, 0.2, { sampleRate: SR, amplitude: 0.4 }).channels[0];
  return { sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] };
}

function sideRms(d: E.AudioData): number {
  const [l, r] = d.channels;
  let s = 0;
  for (let i = 0; i < l.length; i++) { const v = (l[i] - r[i]) / 2; s += v * v; }
  return Math.sqrt(s / Math.max(1, l.length));
}

const opts = (id: string) => STEREO_EXPANDER_PRESETS.find((p) => p.id === id)!.opts;

describe("STEREO_EXPANDER_PRESETS", () => {
  it("exposes the six named presets", () => {
    expect(STEREO_EXPANDER_PRESETS.map((p) => p.label)).toEqual([
      "Mono (Collapse)",
      "Narrow",
      "Wide",
      "Extra Wide",
      "Centre Left",
      "Centre Right",
    ]);
  });

  it("Mono collapses the side signal to zero", () => {
    const out = E.DSP.stereoExpander(stereoTones(300, 500), opts("stxMono"));
    expect(sideRms(out)).toBeLessThan(1e-6);
  });

  it("Narrow reduces the stereo width, Wide and Extra Wide increase it", () => {
    const t = stereoTones(300, 500);
    const base = sideRms(t);
    expect(sideRms(E.DSP.stereoExpander(t, opts("stxNarrow")))).toBeLessThan(base);
    expect(sideRms(E.DSP.stereoExpander(t, opts("stxWide")))).toBeGreaterThan(base);
    expect(sideRms(E.DSP.stereoExpander(t, opts("stxExtraWide")))).toBeGreaterThan(
      sideRms(E.DSP.stereoExpander(t, opts("stxWide"))),
    );
  });

  it("Centre Left/Right shift the balance toward that side", () => {
    // A centre-panned (mono) source so the pan moves measurable energy.
    const m = E.Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.5 }).channels[0];
    const d: E.AudioData = { sampleRate: SR, channels: [Float32Array.from(m), Float32Array.from(m)] };
    const rms = (ch: Float32Array) => { let s = 0; for (let i = 0; i < ch.length; i++) s += ch[i] * ch[i]; return Math.sqrt(s / ch.length); };
    const left = E.DSP.stereoExpander(d, opts("stxLeft"));
    const right = E.DSP.stereoExpander(d, opts("stxRight"));
    expect(rms(left.channels[0])).toBeGreaterThan(rms(left.channels[1]));
    expect(rms(right.channels[1])).toBeGreaterThan(rms(right.channels[0]));
  });
});
