// ─────────────────────────────────────────────────────────────
// ui/delete-silence-presets.test — the shipped Delete Silence presets
// ─────────────────────────────────────────────────────────────
// Drives the actual DELETE_SILENCE_PRESETS through the engine on a
// tone·silence·tone clip, proving each preset shortens the gap by its amount.

import { describe, expect, it } from "vitest";
import * as E from "../engine";
import { DELETE_SILENCE_PRESETS } from "./commands";

const SR = 44100;

function clip(): E.AudioData {
  const a = E.Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
  const sil = { sampleRate: SR, channels: [new Float32Array(Math.round(0.5 * SR))] };
  const b = E.Generate.sine(440, 0.2, { sampleRate: SR, amplitude: 0.6 });
  return E.concat(a, sil, b);
}

const durMs = (d: E.AudioData) => (E.frameCount(d) / SR) * 1000;
const opts = (id: string) => DELETE_SILENCE_PRESETS.find((p) => p.id === id)!.opts;

describe("DELETE_SILENCE_PRESETS", () => {
  it("exposes the three named presets", () => {
    expect(DELETE_SILENCE_PRESETS.map((p) => p.label)).toEqual(["Tighten Gaps", "Remove Gaps", "Strip Silence"]);
  });

  it("every preset shortens the 500 ms gap", () => {
    const c = clip();
    for (const p of DELETE_SILENCE_PRESETS) {
      const out = E.DSP.deleteSilence(c, p.opts);
      expect(durMs(out)).toBeLessThan(durMs(c));
    }
  });

  it("Strip Silence trims the gap further than Tighten Gaps", () => {
    const c = clip();
    expect(durMs(E.DSP.deleteSilence(c, opts("dsStrip")))).toBeLessThan(durMs(E.DSP.deleteSilence(c, opts("dsTighten"))));
  });

  it("Strip Silence removes the gap to ~the two tones (400 ms)", () => {
    expect(durMs(E.DSP.deleteSilence(clip(), opts("dsStrip")))).toBeCloseTo(400, 0);
  });
});
