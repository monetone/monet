// ─────────────────────────────────────────────────────────────
// ui/declipper-presets.test — the shipped DeClipper presets
// ─────────────────────────────────────────────────────────────
// Exercises the actual DECLIPPER_PRESETS objects through the engine so each named
// preset provably rebuilds a clipped peak, and the lower-threshold Strong preset
// repairs at least as much as Light.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { DECLIPPER_PRESETS } from "./commands";

const SR = 44100;
const CLIP = 0.98; // a near-full-scale clip that sits above every preset's threshold

/** A full-amplitude 220 Hz sine hard-clipped at `level` (a long, detectable plateau). */
function clippedAt(level: number): Float32Array {
  const orig = E.Generate.sine(220, 0.1, { sampleRate: SR, amplitude: 1 }).channels[0];
  const out = new Float32Array(orig.length);
  for (let i = 0; i < orig.length; i++) out[i] = Math.max(-level, Math.min(level, orig[i]));
  return out;
}

const clipped = () => clippedAt(CLIP);

function peak(ch: Float32Array): number {
  let p = 0;
  for (const v of ch) p = Math.max(p, Math.abs(v));
  return p;
}

function changeSum(out: Float32Array, src: Float32Array): number {
  let s = 0;
  for (let i = 0; i < out.length; i++) s += Math.abs(out[i] - src[i]);
  return s;
}

const presetOpts = (id: string) => DECLIPPER_PRESETS.find((p) => p.id === id)!.opts;

describe("DECLIPPER_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(DECLIPPER_PRESETS.map((p) => p.label)).toEqual(["Light", "Medium", "Strong"]);
  });

  for (const p of DECLIPPER_PRESETS) {
    it(`${p.label} rebuilds a clipped peak above the clip level`, () => {
      const src = clipped();
      const out = E.DSP.deClip({ sampleRate: SR, channels: [src] }, p.opts).channels[0];
      expect(peak(out)).toBeGreaterThan(CLIP);
      expect(peak(out)).toBeLessThanOrEqual(1);
    });
  }

  it("the lower-threshold Strong preset catches softer clipping that Light misses", () => {
    // A plateau at 0.90 sits below Light's 0.97 threshold (ignored) but above Strong's 0.88.
    const src = clippedAt(0.9);
    const light = changeSum(E.DSP.deClip({ sampleRate: SR, channels: [src] }, presetOpts("dcLight")).channels[0], src);
    const strong = changeSum(E.DSP.deClip({ sampleRate: SR, channels: [src] }, presetOpts("dcStrong")).channels[0], src);
    expect(light).toBe(0); // 0.90 < 0.97 → Light detects nothing
    expect(strong).toBeGreaterThan(0); // 0.90 ≥ 0.88 → Strong repairs it
  });
});
