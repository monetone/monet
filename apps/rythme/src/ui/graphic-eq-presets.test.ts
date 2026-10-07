// ─────────────────────────────────────────────────────────────
// ui/graphic-eq-presets.test — the Graphic Equalizer preset curves
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { createAudioData } from "../engine";
import { graphicEQ, GRAPHIC_EQ_FREQS } from "../engine/dsp/eq";
import { GRAPHIC_EQ_PRESETS } from "./commands";

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
const gainAt = (gains: number[], freq: number) => rms(graphicEQ(tone(freq), gains)) / rms(tone(freq));

describe("GRAPHIC_EQ_PRESETS", () => {
  it("every preset has a 10-band curve aligned to the octave centres and a unique id", () => {
    const ids = new Set<string>();
    for (const p of GRAPHIC_EQ_PRESETS) {
      expect(p.gainsDb.length, p.id).toBe(GRAPHIC_EQ_FREQS.length);
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false);
      ids.add(p.id);
    }
  });

  it("Bass Boost lifts the lows more than the highs", () => {
    const bass = GRAPHIC_EQ_PRESETS.find((p) => p.id === "bassBoost")!.gainsDb;
    expect(gainAt(bass, 31)).toBeGreaterThan(1.3);
    expect(gainAt(bass, 8000)).toBeCloseTo(1, 1);
  });

  it("Treble Boost lifts the highs more than the lows", () => {
    const treble = GRAPHIC_EQ_PRESETS.find((p) => p.id === "trebleBoost")!.gainsDb;
    expect(gainAt(treble, 8000)).toBeGreaterThan(1.3);
    expect(gainAt(treble, 31)).toBeCloseTo(1, 1);
  });

  it("Telephone band-limits — it cuts both extremes versus the mids", () => {
    const tel = GRAPHIC_EQ_PRESETS.find((p) => p.id === "telephone")!.gainsDb;
    expect(gainAt(tel, 62)).toBeLessThan(0.7); // low cut
    expect(gainAt(tel, 8000)).toBeLessThan(0.7); // high cut
    expect(gainAt(tel, 1000)).toBeGreaterThan(1.0); // mid presence
  });

  it("Loudness (Smile) lifts both extremes and dips the mids", () => {
    const smile = GRAPHIC_EQ_PRESETS.find((p) => p.id === "loudness")!.gainsDb;
    expect(gainAt(smile, 31)).toBeGreaterThan(1.3); // low shelf up
    expect(gainAt(smile, 8000)).toBeGreaterThan(1.2); // high shelf up
    expect(gainAt(smile, 1000)).toBeLessThan(1.0); // mid dip
  });

  it("Vocal Presence lifts the presence band and trims the lows", () => {
    const vox = GRAPHIC_EQ_PRESETS.find((p) => p.id === "vocalPresence")!.gainsDb;
    expect(gainAt(vox, 1000)).toBeGreaterThan(1.2); // presence up
    expect(gainAt(vox, 31)).toBeLessThan(1.0); // lows trimmed
  });

  it("Mid Scoop cuts the mids and lifts the extremes", () => {
    const scoop = GRAPHIC_EQ_PRESETS.find((p) => p.id === "midScoop")!.gainsDb;
    expect(gainAt(scoop, 1000)).toBeLessThan(0.7); // scooped mids
    expect(gainAt(scoop, 31)).toBeGreaterThan(1.2); // low boost
  });
});
