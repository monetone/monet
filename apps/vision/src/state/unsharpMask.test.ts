// Unit tests for the Unsharp Mask helpers. Engine-free (node). These pin the
// per-channel sharpening formula (must match filters.rs unsharp_mask) and the
// 1-D blur-then-sharpen behaviour (edge enhancement, threshold gating, clamping).
import { describe, it, expect } from "vitest";
import { unsharpChannel, unsharpMask1D, MIN_RADIUS } from "./unsharpMask";

describe("unsharpChannel (per-channel formula)", () => {
  it("amount 0 leaves the original untouched", () => {
    expect(unsharpChannel(0.8, 0.5, 0, 0)).toBeCloseTo(0.8, 9);
  });

  it("adds `amount` of the (orig − blurred) difference", () => {
    expect(unsharpChannel(0.6, 0.4, 1.5, 0.1)).toBeCloseTo(0.9, 9); // 0.6 + 0.2·1.5
    expect(unsharpChannel(0.5, 0.45, 2, 0)).toBeCloseTo(0.6, 9); // 0.5 + 0.05·2
  });

  it("gates on the threshold (small differences pass through unchanged)", () => {
    expect(unsharpChannel(0.51, 0.5, 2, 0.05)).toBe(0.51); // |0.01| < 0.05 → unchanged
    expect(unsharpChannel(0.51, 0.5, 2, 0.005)).toBeCloseTo(0.53, 9); // 0.01 ≥ 0.005 → sharpened
  });

  it("sharpens at exactly |diff| == threshold (the engine's >= boundary)", () => {
    // dyadic values so |0.5 − 0.25| is exactly 0.25 == threshold → the `>=` branch fires.
    expect(unsharpChannel(0.5, 0.25, 1, 0.25)).toBeCloseTo(0.75, 9); // sharpened, not skipped
    expect(unsharpChannel(0.5, 0.25, 1, 0.2501)).toBe(0.5); // just above threshold → unchanged
  });

  it("a negative amount softens (the shared formula is sign-agnostic; UI amount is ≥ 0)", () => {
    expect(unsharpChannel(0.8, 0.5, -1, 0)).toBeCloseTo(0.5, 9); // 0.8 + 0.3·(−1)
  });

  it("a flat region (orig == blurred) is never changed", () => {
    expect(unsharpChannel(0.5, 0.5, 5, 0.01)).toBe(0.5);
    expect(unsharpChannel(0.5, 0.5, 5, 0)).toBe(0.5); // diff 0 < threshold 0 is false, but +0 → 0.5
  });

  it("brightens the light side and overshoots/clamps", () => {
    expect(unsharpChannel(0.8, 0.5, 1, 0)).toBe(1); // 0.8 + 0.3 → clamp 1
    expect(unsharpChannel(0.8, 0.5, 0.5, 0)).toBeCloseTo(0.95, 9);
  });

  it("darkens the dark side and undershoots/clamps to 0", () => {
    expect(unsharpChannel(0.2, 0.5, 1, 0)).toBe(0); // 0.2 − 0.3 → clamp 0
    expect(unsharpChannel(0.2, 0.5, 0.5, 0)).toBeCloseTo(0.05, 9);
  });
});

describe("unsharpMask1D — blur then sharpen", () => {
  it("leaves a flat signal unchanged (no differences to sharpen)", () => {
    const flat = [0.5, 0.5, 0.5, 0.5, 0.5];
    expect(unsharpMask1D(flat, 2, 3, 0.05)).toEqual(flat);
  });

  it("amount 0 is a no-op for an in-gamut signal", () => {
    const sig = [0.1, 0.4, 0.7, 0.3, 0.9];
    unsharpMask1D(sig, 2, 0, 0).forEach((v, i) => expect(v).toBeCloseTo(sig[i], 9));
  });

  it("a high threshold passes everything through unchanged", () => {
    const sig = [0.1, 0.4, 0.7, 0.3, 0.9];
    unsharpMask1D(sig, 2, 2, 1).forEach((v, i) => expect(v).toBeCloseTo(sig[i], 9));
  });

  it("enhances a step edge (light side brighter, dark side darker)", () => {
    const step = [0.2, 0.2, 0.2, 0.8, 0.8, 0.8];
    const out = unsharpMask1D(step, 2, 1, 0);
    expect(out[3]).toBeGreaterThan(0.8); // first light pixel overshoots up
    expect(out[2]).toBeLessThan(0.2); // last dark pixel undershoots down
    // the interiors (far from the edge) are barely touched
    expect(out[0]).toBeCloseTo(0.2, 2);
    expect(out[5]).toBeCloseTo(0.8, 2);
  });

  it("floors the radius at 0.3 (radius 0 / 0.1 behave like 0.3)", () => {
    const sig = [0.1, 0.5, 0.9, 0.3, 0.7];
    expect(unsharpMask1D(sig, 0, 1.5, 0)).toEqual(unsharpMask1D(sig, MIN_RADIUS, 1.5, 0));
    expect(unsharpMask1D(sig, 0.1, 1.5, 0)).toEqual(unsharpMask1D(sig, MIN_RADIUS, 1.5, 0));
  });

  it("keeps output in gamut and is deterministic", () => {
    const sig = [0, 0.3, 0.95, 0.1, 0.6, 0.2, 0.85];
    const out = unsharpMask1D(sig, 3, 2.5, 0.02);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(unsharpMask1D(sig, 3, 2.5, 0.02)).toEqual(out);
  });
});

// ── Several signal fixtures swept across amounts/thresholds ──────────────────
const SIGNALS: { name: string; signal: number[] }[] = [
  { name: "edge", signal: [0.1, 0.1, 0.1, 0.9, 0.9, 0.9] },
  { name: "ramp", signal: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  { name: "impulse", signal: [0.3, 0.3, 0.3, 1, 0.3, 0.3, 0.3] },
  { name: "noisy-ish", signal: [0.5, 0.52, 0.48, 0.51, 0.49, 0.5] },
];

describe.each(SIGNALS)("fixture: $name", ({ signal }) => {
  it("stays in gamut across a range of amount/threshold", () => {
    for (const amount of [0.5, 1, 2]) {
      for (const threshold of [0, 0.05, 0.2]) {
        const out = unsharpMask1D(signal, 2, amount, threshold);
        expect(out.length).toBe(signal.length);
        for (const v of out) {
          expect(Number.isFinite(v)).toBe(true);
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});
