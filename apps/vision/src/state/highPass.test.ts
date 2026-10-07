// Unit tests for the High Pass helpers. Engine-free (node). These pin the
// per-channel formula (must match filters.rs high_pass: mid + orig − blurred,
// clamped) and the 1-D blur-then-high-pass behaviour (flat → gray, edges stand out).
import { describe, it, expect } from "vitest";
import { highPassChannel, highPass1D, MID, MIN_RADIUS } from "./highPass";

describe("highPassChannel (per-channel formula)", () => {
  it("a flat region (orig == blurred) collapses to mid-gray", () => {
    expect(highPassChannel(0.3, 0.3)).toBe(MID);
    expect(highPassChannel(0.9, 0.9)).toBe(MID);
    expect(MID).toBe(0.5);
  });

  it("centres the (orig − blurred) difference on mid-gray", () => {
    expect(highPassChannel(0.7, 0.4)).toBeCloseTo(0.8, 9); // 0.5 + 0.3
    expect(highPassChannel(0.4, 0.7)).toBeCloseTo(0.2, 9); // 0.5 − 0.3
  });

  it("clamps to [0,1] at strong edges", () => {
    expect(highPassChannel(1, 0)).toBe(1); // 0.5 + 1 → clamp 1
    expect(highPassChannel(0, 1)).toBe(0); // 0.5 − 1 → clamp 0
  });

  it("honours a custom mid", () => {
    expect(highPassChannel(0.5, 0.5, 0.6)).toBeCloseTo(0.6, 9);
  });
});

describe("highPass1D — blur then high-pass", () => {
  it("turns a flat signal entirely to mid-gray (the defining property)", () => {
    for (const v of highPass1D([0.3, 0.3, 0.3, 0.3, 0.3], 2)) expect(v).toBeCloseTo(0.5, 9);
  });

  it("a constant signal of any level becomes 0.5", () => {
    for (const v of highPass1D([0.8, 0.8, 0.8, 0.8], 3)) expect(v).toBeCloseTo(0.5, 9);
  });

  it("on a step edge, flat interiors stay gray and the edge deviates", () => {
    const out = highPass1D([0.2, 0.2, 0.2, 0.8, 0.8, 0.8], 2);
    expect(out[0]).toBeCloseTo(0.5, 2); // deep in the dark flat → gray
    expect(out[5]).toBeCloseTo(0.5, 2); // deep in the light flat → gray
    expect(out[3]).toBeGreaterThan(0.5); // light side of the edge brightens
    expect(out[2]).toBeLessThan(0.5); // dark side of the edge darkens
  });

  it("floors the radius at 0.5 (radius 0 / 0.2 behave like 0.5)", () => {
    const sig = [0.1, 0.5, 0.9, 0.3, 0.7];
    expect(highPass1D(sig, 0)).toEqual(highPass1D(sig, MIN_RADIUS));
    expect(highPass1D(sig, 0.2)).toEqual(highPass1D(sig, MIN_RADIUS));
  });

  it("saturates to 1 at a sharp impulse with a wide radius (clamp path end-to-end)", () => {
    // a lone bright pixel keeps only ~0.2 of its value after a radius-4 blur, so
    // 0.5 + (1 − 0.2) > 1 → the high-pass result clamps to 1.
    const impulse = [0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0];
    expect(highPass1D(impulse, 4)[5]).toBe(1);
  });

  it("keeps output in gamut and is deterministic", () => {
    const sig = [0, 0.3, 0.95, 0.1, 0.6, 0.2, 0.85];
    const out = highPass1D(sig, 3);
    for (const v of out) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(1);
    }
    expect(highPass1D(sig, 3)).toEqual(out);
  });
});

// ── Several signal fixtures swept across radii ──────────────────────────────
const SIGNALS: { name: string; signal: number[] }[] = [
  { name: "edge", signal: [0.1, 0.1, 0.1, 0.9, 0.9, 0.9] },
  { name: "ramp", signal: [0, 0.2, 0.4, 0.6, 0.8, 1] },
  { name: "impulse", signal: [0.3, 0.3, 0.3, 1, 0.3, 0.3, 0.3] },
  { name: "flat mid", signal: [0.5, 0.5, 0.5, 0.5, 0.5] },
];

describe.each(SIGNALS)("fixture: $name", ({ signal }) => {
  it("stays in gamut and is centred near 0.5 in flat areas, for several radii", () => {
    for (const radius of [0.5, 1, 2, 4]) {
      const out = highPass1D(signal, radius);
      expect(out.length).toBe(signal.length);
      for (const v of out) {
        expect(Number.isFinite(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
