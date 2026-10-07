// ─────────────────────────────────────────────────────────────
// dsp/eq.test — Graphic / Parametric EQ (Adobe Audition parity)
// ─────────────────────────────────────────────────────────────
// Steady-tone RMS at a band's centre frequency anchors the boost/cut, and the
// drawn response curve peaks where it should.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { eqResponse, graphicEQ, GRAPHIC_EQ_FREQS, parametricEQ } from "./eq";

const SR = 48000;

/** A steady stereo sine (so EQ has something at a known frequency to act on). */
function tone(freq: number, secs = 0.5, amp = 0.5) {
  const n = Math.round(SR * secs);
  const d = createAudioData(2, n, SR);
  for (let i = 0; i < n; i++) {
    const v = amp * Math.sin((2 * Math.PI * freq * i) / SR);
    d.channels[0][i] = v;
    d.channels[1][i] = v;
  }
  return d;
}

/** RMS of the steady tail (skip the filter's start-up transient). */
function rms(d: { channels: Float32Array[] }): number {
  const ch = d.channels[0];
  const from = Math.floor(ch.length / 2);
  let sum = 0;
  for (let i = from; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - from));
}

describe("graphicEQ", () => {
  it("is a transparent pass-through when every band is flat", () => {
    const d = tone(1000);
    expect(graphicEQ(d, new Array(10).fill(0))).toBe(d); // no bands → input returned unchanged
  });

  it("boosts a band's centre frequency", () => {
    const gains = new Array(10).fill(0);
    gains[2] = 12; // +12 dB at 125 Hz
    const d = tone(GRAPHIC_EQ_FREQS[2]);
    expect(rms(graphicEQ(d, gains)) / rms(d)).toBeGreaterThan(1.5);
  });

  it("cuts a band's centre frequency", () => {
    const gains = new Array(10).fill(0);
    gains[5] = -12; // −12 dB at 1 kHz
    const d = tone(GRAPHIC_EQ_FREQS[5]);
    expect(rms(graphicEQ(d, gains)) / rms(d)).toBeLessThan(0.7);
  });

  it("leaves a distant frequency essentially untouched", () => {
    const gains = new Array(10).fill(0);
    gains[2] = 12; // boost 125 Hz only
    const d = tone(8000); // six octaves away
    expect(rms(graphicEQ(d, gains)) / rms(d)).toBeCloseTo(1, 1);
  });
});

describe("parametricEQ", () => {
  it("returns the input unchanged when no bands are enabled", () => {
    const d = tone(440);
    expect(parametricEQ(d, [])).toBe(d);
    expect(rms(parametricEQ(d, [{ type: "peaking", freq: 440, q: 1, gainDb: 9, enabled: false }]))).toBeCloseTo(rms(d), 6);
  });

  it("a low shelf boosts lows and leaves the highs alone", () => {
    const bands = [{ type: "lowshelf" as const, freq: 200, gainDb: 9 }];
    const low = tone(60);
    const high = tone(8000);
    expect(rms(parametricEQ(low, bands)) / rms(low)).toBeGreaterThan(1.5);
    expect(rms(parametricEQ(high, bands)) / rms(high)).toBeCloseTo(1, 1);
  });

  it("cascades multiple bands (a high-pass plus a low-pass band-limit a mid pass-through)", () => {
    const bands = [
      { type: "highpass" as const, freq: 400, q: 0.707 },
      { type: "lowpass" as const, freq: 3000, q: 0.707 },
    ];
    expect(rms(parametricEQ(tone(60), bands)) / rms(tone(60))).toBeLessThan(0.5); // below the pass band
    expect(rms(parametricEQ(tone(1000), bands)) / rms(tone(1000))).toBeCloseTo(1, 1); // in the pass band
    expect(rms(parametricEQ(tone(12000), bands)) / rms(tone(12000))).toBeLessThan(0.5); // above the pass band
  });
});

describe("eqResponse", () => {
  it("peaks near a boosted band's centre frequency", () => {
    const curve = eqResponse([{ type: "peaking", freq: 1000, q: 1.4, gainDb: 9 }], SR);
    const peak = curve.reduce((a, b) => (b.db > a.db ? b : a));
    expect(peak.db).toBeGreaterThan(6);
    expect(peak.f).toBeGreaterThan(600);
    expect(peak.f).toBeLessThan(1600);
  });

  it("is ~flat (0 dB) with no bands", () => {
    for (const pt of eqResponse([], SR)) expect(Math.abs(pt.db)).toBeLessThan(1e-6);
  });
});
