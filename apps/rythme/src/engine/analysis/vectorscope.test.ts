// ─────────────────────────────────────────────────────────────
// engine/analysis/vectorscope.test — Audition-style Phase Scope / Goniometer
// ─────────────────────────────────────────────────────────────
// Pins the goniometer geometry: a mono signal traces a vertical line (x≈0), a
// polarity-inverted channel a horizontal line (y≈0), a single-channel signal
// behaves like centred mono, and the points are decimated + normalized.

import { describe, expect, it } from "vitest";
import type { AudioData } from "../audio/types";
import { sine } from "../generate/tone";
import { vectorscope } from "./vectorscope";

const SR = 44100;
const tone = () => sine(1000, 0.1, { sampleRate: SR, amplitude: 0.5 }).channels[0];
const stereo = (l: Float32Array, r: Float32Array): AudioData => ({ sampleRate: SR, channels: [Float32Array.from(l), Float32Array.from(r)] });

function maxAbs(a: Float32Array): number {
  let m = 0;
  for (const v of a) m = Math.max(m, Math.abs(v));
  return m;
}
function maxDiff(a: Float32Array, b: Float32Array): number {
  let m = 0;
  for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
  return m;
}

describe("vectorscope — geometry", () => {
  it("a mono signal (L = R) traces a vertical line", () => {
    const m = tone();
    const v = vectorscope(stereo(m, m));
    expect(maxAbs(v.x)).toBeLessThan(1e-6); // no horizontal spread
    expect(maxAbs(v.y)).toBeCloseTo(1, 5); // full vertical extent (normalized)
  });

  it("a polarity-inverted channel traces a horizontal line", () => {
    const m = tone();
    const v = vectorscope(stereo(m, m.map((s) => -s) as Float32Array));
    expect(maxAbs(v.y)).toBeLessThan(1e-6); // no vertical extent
    expect(maxAbs(v.x)).toBeCloseTo(1, 5);
  });

  it("one channel only traces the 45° diagonal (x = y)", () => {
    const m = tone();
    const v = vectorscope(stereo(m, new Float32Array(m.length)));
    expect(maxDiff(v.x, v.y)).toBeLessThan(1e-6);
  });

  it("treats a mono buffer as centred (vertical line)", () => {
    const v = vectorscope({ sampleRate: SR, channels: [tone()] });
    expect(maxAbs(v.x)).toBeLessThan(1e-6);
    expect(v.count).toBeGreaterThan(0);
  });
});

describe("vectorscope — sampling", () => {
  it("decimates to at most maxPoints", () => {
    const m = tone();
    const v = vectorscope(stereo(m, m), { maxPoints: 100 });
    expect(v.count).toBeLessThanOrEqual(100);
    expect(v.x).toHaveLength(v.count);
    expect(v.y).toHaveLength(v.count);
  });

  it("normalizes the peak coordinate to 1 by default, and leaves it raw when disabled", () => {
    const m = sine(1000, 0.1, { sampleRate: SR, amplitude: 0.3 }).channels[0];
    const norm = vectorscope(stereo(m, m));
    expect(Math.max(maxAbs(norm.x), maxAbs(norm.y))).toBeCloseTo(1, 5);
    const raw = vectorscope(stereo(m, m), { normalize: false });
    expect(maxAbs(raw.y)).toBeLessThan(0.9); // ~0.3·√2·... well under 1
  });

  it("is deterministic and handles an empty buffer", () => {
    const m = tone();
    const a = vectorscope(stereo(m, m));
    const b = vectorscope(stereo(m, m));
    expect(maxDiff(a.x, b.x)).toBe(0);
    const empty = vectorscope({ sampleRate: SR, channels: [new Float32Array(0), new Float32Array(0)] });
    expect(empty.count).toBe(0);
    expect(empty.x).toHaveLength(0);
  });
});
