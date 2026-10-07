// ─────────────────────────────────────────────────────────────
// engine/dsp/scientific-filter.test — Audition-style Scientific Filter
// ─────────────────────────────────────────────────────────────
// The classic analog-prototype IIR designs are pinned to their textbook
// signatures: Butterworth/Bessel are exactly −3.01 dB at the corner, Chebyshev I
// ripples by `rippleDb` in the passband, Chebyshev II hits `stopAttenDb` at the
// stopband edge, and each response (LP/HP/BP/BS) passes its band and rejects the
// rest both as a magnitude curve and on real tones.

import { describe, expect, it } from "vitest";
import { createAudioData } from "../audio/buffer";
import { frameCount, type AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import {
  designScientificFilter,
  scientificFilter,
  scientificFilterResponseDb,
  type ScientificFilterOptions,
} from "./scientific-filter";

const SR = 44100;

const tone = (freq: number, amp = 0.5) => sine(freq, 0.4, { sampleRate: SR, amplitude: amp });

/** RMS over the settled (second-half) region, past the IIR ramp-up. */
function settledRms(ch: Float32Array): number {
  let sum = 0;
  const start = ch.length >> 1;
  for (let i = start; i < ch.length; i++) sum += ch[i] * ch[i];
  return Math.sqrt(sum / (ch.length - start));
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

/** Settled output/input amplitude ratio for a steady tone through `opts`. */
function passRatio(opts: ScientificFilterOptions, freq: number): number {
  const t = tone(freq);
  const out = scientificFilter(t, opts);
  return settledRms(out.channels[0]) / settledRms(t.channels[0]);
}

const db = (opts: ScientificFilterOptions, f: number) => scientificFilterResponseDb(opts, f, SR);

describe("scientificFilterResponseDb — Butterworth", () => {
  it("is exactly −3.01 dB at the corner for every order (incl. odd)", () => {
    for (const order of [1, 2, 3, 4, 6, 8]) {
      expect(db({ kind: "butterworth", response: "lowpass", order, cutoffHz: 1000 }, 1000)).toBeCloseTo(-3.0103, 1);
    }
  });

  it("is maximally flat (≈0 dB) in the passband and steep in the stop", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 1000 };
    expect(db(o, 100)).toBeGreaterThan(-0.05);
    expect(db(o, 500)).toBeGreaterThan(-0.2);
    expect(db(o, 2000)).toBeLessThan(-30);
    expect(db(o, 4000)).toBeLessThan(-60);
  });

  it("rolls off ~6·order dB/octave (order 8 far steeper than order 2)", () => {
    const at2fc = (order: number) => db({ kind: "butterworth", response: "lowpass", order, cutoffHz: 1000 }, 2000);
    expect(at2fc(8)).toBeLessThan(at2fc(4));
    expect(at2fc(4)).toBeLessThan(at2fc(2));
    expect(at2fc(2)).toBeCloseTo(-12.3, 0); // 2nd order ≈ −12 dB/oct one octave up
  });

  it("high-pass mirrors the low-pass (−3 dB corner, passband above)", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "highpass", order: 4, cutoffHz: 1000 };
    expect(db(o, 1000)).toBeCloseTo(-3.0103, 1);
    expect(db(o, 100)).toBeLessThan(-60);
    expect(db(o, 5000)).toBeGreaterThan(-0.1);
  });
});

describe("scientificFilterResponseDb — Chebyshev I", () => {
  const o: ScientificFilterOptions = { kind: "chebyshev1", response: "lowpass", order: 6, cutoffHz: 1000, rippleDb: 1 };

  it("equals −rippleDb at the band edge", () => {
    expect(db(o, 1000)).toBeCloseTo(-1, 1);
  });

  it("keeps the whole passband within the ripple band [−rippleDb, 0]", () => {
    for (let f = 20; f <= 1000; f += 20) {
      const v = db(o, f);
      expect(v).toBeLessThan(0.02);
      expect(v).toBeGreaterThan(-1.05);
    }
  });

  it("is much steeper than Butterworth of the same order just past the corner", () => {
    const cheb = db(o, 1300);
    const butter = db({ kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 1000 }, 1300);
    expect(cheb).toBeLessThan(butter);
  });
});

describe("scientificFilterResponseDb — Chebyshev II", () => {
  const o: ScientificFilterOptions = { kind: "chebyshev2", response: "lowpass", order: 6, cutoffHz: 1000, stopAttenDb: 40 };

  it("has a maximally flat passband (≈0 dB)", () => {
    expect(db(o, 100)).toBeGreaterThan(-0.05);
    expect(db(o, 500)).toBeGreaterThan(-0.1);
  });

  it("reaches the stopband attenuation at the stop edge and stays below it", () => {
    expect(db(o, 1000)).toBeCloseTo(-40, 0);
    for (let f = 1000; f <= 5000; f += 250) expect(db(o, f)).toBeLessThan(-39.5);
  });

  it("honours a steeper stopAttenDb setting", () => {
    expect(db({ ...o, stopAttenDb: 60 }, 1000)).toBeCloseTo(-60, 0);
  });
});

describe("scientificFilterResponseDb — Bessel", () => {
  const o: ScientificFilterOptions = { kind: "bessel", response: "lowpass", order: 6, cutoffHz: 1000 };

  it("is −3 dB at the corner (frequency-normalized)", () => {
    expect(db(o, 1000)).toBeCloseTo(-3.0103, 0);
  });

  it("decreases monotonically through the transition", () => {
    let prev = Infinity;
    for (let f = 100; f <= 6000; f += 100) {
      const v = db(o, f);
      expect(v).toBeLessThanOrEqual(prev + 1e-6);
      prev = v;
    }
  });

  it("rolls off more gently than Butterworth of the same order (flat group delay tradeoff)", () => {
    const bessel = db(o, 2000);
    const butter = db({ kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 1000 }, 2000);
    expect(bessel).toBeGreaterThan(butter);
  });
});

describe("scientificFilterResponseDb — band-pass / band-stop", () => {
  it("band-pass: 0 dB at the geometric centre, −3 dB at both edges, rejects outside", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "bandpass", order: 4, cutoffHz: 300, cutoffHz2: 3400 };
    expect(db(o, Math.sqrt(300 * 3400))).toBeGreaterThan(-0.2);
    expect(db(o, 300)).toBeCloseTo(-3.0103, 0);
    expect(db(o, 3400)).toBeCloseTo(-3.0103, 0);
    expect(db(o, 60)).toBeLessThan(-30);
    expect(db(o, 12000)).toBeLessThan(-25);
  });

  it("band-stop: 0 dB passbands either side, deep rejection in the notch", () => {
    const o: ScientificFilterOptions = { kind: "chebyshev2", response: "bandstop", order: 6, cutoffHz: 800, cutoffHz2: 1200, stopAttenDb: 48 };
    expect(db(o, 200)).toBeGreaterThan(-0.1);
    expect(db(o, 4000)).toBeGreaterThan(-0.1);
    expect(db(o, 1000)).toBeLessThan(-40);
  });
});

describe("scientificFilter — time domain", () => {
  it("low-pass passes a low tone and kills a high tone", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 2000 };
    expect(passRatio(o, 300)).toBeGreaterThan(0.85);
    expect(passRatio(o, 8000)).toBeLessThan(0.05);
  });

  it("high-pass kills a low tone and passes a high tone", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "highpass", order: 6, cutoffHz: 2000 };
    expect(passRatio(o, 300)).toBeLessThan(0.05);
    expect(passRatio(o, 8000)).toBeGreaterThan(0.85);
  });

  it("band-pass passes the in-band tone and rejects out-of-band tones", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "bandpass", order: 4, cutoffHz: 500, cutoffHz2: 2000 };
    expect(passRatio(o, 1000)).toBeGreaterThan(0.8);
    expect(passRatio(o, 100)).toBeLessThan(0.1);
    expect(passRatio(o, 8000)).toBeLessThan(0.1);
  });

  it("band-stop rejects the in-band tone and passes either side", () => {
    const o: ScientificFilterOptions = { kind: "butterworth", response: "bandstop", order: 4, cutoffHz: 500, cutoffHz2: 2000 };
    expect(passRatio(o, 1000)).toBeLessThan(0.1);
    expect(passRatio(o, 100)).toBeGreaterThan(0.85);
    expect(passRatio(o, 8000)).toBeGreaterThan(0.85);
  });

  it("filters every channel of a stereo buffer", () => {
    const left = tone(300).channels[0];
    const right = tone(8000).channels[0];
    const stereo: AudioData = { sampleRate: SR, channels: [Float32Array.from(left), Float32Array.from(right)] };
    const out = scientificFilter(stereo, { kind: "butterworth", response: "lowpass", order: 6, cutoffHz: 2000 });
    expect(settledRms(out.channels[0]) / settledRms(left)).toBeGreaterThan(0.85); // 300 Hz kept
    expect(settledRms(out.channels[1]) / settledRms(right)).toBeLessThan(0.05); // 8 kHz removed
  });
});

describe("scientificFilter — stability & robustness", () => {
  it("stays bounded and decays for an impulse across kinds at high order", () => {
    const kinds = ["butterworth", "chebyshev1", "chebyshev2", "bessel", "elliptic"] as const;
    const responses = ["lowpass", "highpass", "bandpass", "bandstop"] as const;
    for (const kind of kinds) {
      for (const response of responses) {
        const imp = createAudioData(1, 4096, SR);
        imp.channels[0][0] = 1;
        const out = scientificFilter(imp, { kind, response, order: 8, cutoffHz: 1000, cutoffHz2: 4000 });
        let max = 0;
        for (const v of out.channels[0]) {
          expect(Number.isFinite(v)).toBe(true);
          max = Math.max(max, Math.abs(v));
        }
        expect(max).toBeLessThan(8); // no runaway
        const tailEnergy = settledRms(out.channels[0].subarray(3000));
        expect(tailEnergy).toBeLessThan(1e-3); // settled to ~0
      }
    }
  });

  it("clamps the order to a sane range", () => {
    expect(designScientificFilter({ order: 999, cutoffHz: 1000 }, SR).sections.length).toBeLessThanOrEqual(6);
    expect(designScientificFilter({ order: 0, cutoffHz: 1000 }, SR).sections.length).toBeGreaterThanOrEqual(1);
  });

  it("uses Butterworth low-pass at 1 kHz by default", () => {
    expect(db({}, 1000)).toBeCloseTo(-3.0103, 1);
    expect(db({}, 100)).toBeGreaterThan(-0.05);
  });
});

describe("scientificFilter — purity & determinism", () => {
  const o: ScientificFilterOptions = { kind: "chebyshev1", response: "lowpass", order: 5, cutoffHz: 1500, rippleDb: 0.5 };

  it("does not mutate the input", () => {
    const t = tone(1000);
    const snapshot = Float32Array.from(t.channels[0]);
    scientificFilter(t, o);
    expect(maxAbsDiff(t.channels[0], snapshot)).toBe(0);
  });

  it("preserves frame count and is deterministic", () => {
    const t = tone(1000);
    const a = scientificFilter(t, o);
    const b = scientificFilter(t, o);
    expect(frameCount(a)).toBe(frameCount(t));
    expect(maxAbsDiff(a.channels[0], b.channels[0])).toBe(0);
  });

  it("handles an empty buffer", () => {
    const empty = createAudioData(1, 0, SR);
    const out = scientificFilter(empty, o);
    expect(frameCount(out)).toBe(0);
  });
});

describe("scientificFilterResponseDb — Elliptic (Cauer)", () => {
  const o: ScientificFilterOptions = { kind: "elliptic", response: "lowpass", order: 6, cutoffHz: 1000, rippleDb: 1, stopAttenDb: 50 };

  it("is equiripple in the passband within [−rippleDb, 0] and −rippleDb at the corner", () => {
    for (let f = 20; f <= 1000; f += 20) {
      const v = db(o, f);
      expect(v).toBeLessThan(0.05);
      expect(v).toBeGreaterThan(-1.05);
    }
    expect(db(o, 1000)).toBeCloseTo(-1, 1);
  });

  it("reaches the stopband attenuation just past the corner and stays below it", () => {
    expect(db(o, 1200)).toBeLessThan(-50);
    for (let f = 1200; f <= 5000; f += 200) expect(db(o, f)).toBeLessThan(-49);
  });

  it("is the steepest family: beats Chebyshev I of the same order just past the corner", () => {
    const cheb: ScientificFilterOptions = { kind: "chebyshev1", response: "lowpass", order: 6, cutoffHz: 1000, rippleDb: 1 };
    expect(db(o, 1300)).toBeLessThan(db(cheb, 1300) - 10);
  });

  it("a deeper stopAttenDb lowers the stopband floor (equiripple level)", () => {
    // The least-attenuated point of the stopband tracks the spec; a deeper spec
    // also widens the transition, so compare the floors, not a fixed frequency.
    const stopFloor = (atten: number) => {
      let m = -999;
      for (let f = 2500; f <= 20000; f += 25) m = Math.max(m, db({ ...o, stopAttenDb: atten }, f));
      return m;
    };
    expect(stopFloor(50)).toBeLessThan(-48);
    expect(stopFloor(80)).toBeLessThan(stopFloor(50) - 10);
  });

  it("works for an odd order (real pole)", () => {
    const odd: ScientificFilterOptions = { ...o, order: 5 };
    expect(db(odd, 1000)).toBeCloseTo(-1, 1);
    expect(db(odd, 1500)).toBeLessThan(-45);
  });

  it("passes a low tone and removes a high one (low-pass)", () => {
    const lp: ScientificFilterOptions = { kind: "elliptic", response: "lowpass", order: 6, cutoffHz: 2000, rippleDb: 0.5, stopAttenDb: 60 };
    expect(passRatio(lp, 300)).toBeGreaterThan(0.85);
    expect(passRatio(lp, 8000)).toBeLessThan(0.05);
  });

  it("band-pass passes the in-band tone and rejects out-of-band", () => {
    const bp: ScientificFilterOptions = { kind: "elliptic", response: "bandpass", order: 4, cutoffHz: 500, cutoffHz2: 2000, rippleDb: 1, stopAttenDb: 50 };
    expect(passRatio(bp, 1000)).toBeGreaterThan(0.8);
    expect(passRatio(bp, 100)).toBeLessThan(0.1);
    expect(passRatio(bp, 8000)).toBeLessThan(0.1);
  });
});
