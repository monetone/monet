// ─────────────────────────────────────────────────────────────
// ui/parametric-eq-presets.test — the Parametric Equalizer preset curves
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../engine";
import { parametricEQ } from "../engine/dsp/eq";
import { PARAMETRIC_EQ_PRESETS } from "./commands";

const SR = 48000;

function tone(freq: number) {
  const n = SR; // 1 s
  const d = createAudioData(2, n, SR);
  for (let i = 0; i < n; i++) {
    const v = 0.5 * Math.sin((2 * Math.PI * freq * i) / SR);
    d.channels[0][i] = v;
    d.channels[1][i] = v;
  }
  return d;
}
function rms(d: { channels: Float32Array[] }): number {
  const ch = d.channels[0];
  let sum = 0;
  for (let i = ch.length >> 1; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - (ch.length >> 1)));
}
const bandsOf = (id: string) => PARAMETRIC_EQ_PRESETS.find((p) => p.id === id)!.bands;
const gainAt = (id: string, freq: number) => rms(parametricEQ(tone(freq), bandsOf(id))) / rms(tone(freq));

describe("PARAMETRIC_EQ_PRESETS", () => {
  it("every preset has at least one band, a unique id, and valid band types", () => {
    const ids = new Set<string>();
    const types = new Set(["lowpass", "highpass", "bandpass", "notch", "allpass", "peaking", "lowshelf", "highshelf"]);
    for (const p of PARAMETRIC_EQ_PRESETS) {
      expect(p.bands.length, p.id).toBeGreaterThan(0);
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
      ids.add(p.id);
      for (const b of p.bands) expect(types.has(b.type), `${p.id}: ${b.type}`).toBe(true);
    }
  });

  it("Warm boosts the lows (low shelf) and softens the highs", () => {
    expect(gainAt("warm", 70)).toBeGreaterThan(1.2);
    expect(gainAt("warm", 14000)).toBeLessThan(1.0);
  });

  it("Bright / Air lifts the top end", () => {
    expect(gainAt("bright", 12000)).toBeGreaterThan(1.2);
  });

  it("De-Mud cuts the low mids around 300 Hz", () => {
    expect(gainAt("deMud", 300)).toBeLessThan(0.7);
  });

  it("Lo-Fi band-limits — it cuts the extremes and passes the mids", () => {
    expect(gainAt("lofi", 80)).toBeLessThan(0.7);
    expect(gainAt("lofi", 8000)).toBeLessThan(0.7);
    expect(gainAt("lofi", 1000)).toBeGreaterThan(0.9);
  });

  it("Vocal Clarity high-passes the rumble and lifts presence", () => {
    expect(gainAt("vocalClarity", 40)).toBeLessThan(0.7); // below the 80 Hz high-pass
    expect(gainAt("vocalClarity", 4000)).toBeGreaterThan(1.2); // presence bell
  });
});
