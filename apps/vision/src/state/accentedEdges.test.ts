// Unit tests for the Accented Edges filter. Engine-free (node), single grey-channel model (exact
// for grey R=G=B input). These pin the Sobel luminance gradient, the gain/threshold params, the
// edge = clamp(mag/thresh·gain) strength, and the lerp toward edge_color with truncation (must
// match filters.rs accented_edges), plus cross-implementation goldens captured from the Rust
// engine. sqrt is IEEE-correctly-rounded so these are bit-exact (no tolerance).
import { describe, it, expect } from "vitest";
import {
  accentedEdgesGain,
  accentedEdgesThreshold,
  accentedEdgesPixel,
  accentedEdges2D,
  ACCENTED_EDGES_MAX,
} from "./accentedEdges";

const grid = (h: number, w: number, fn: (x: number, y: number) => number): number[][] =>
  Array.from({ length: h }, (_, y) => Array.from({ length: w }, (_, x) => fn(x, y)));
const flat = (g: number[][]) => g.flat();

describe("accentedEdgesGain / accentedEdgesThreshold", () => {
  it("gain = 1 + 6·clamp(width,0,1) (1..7)", () => {
    expect(accentedEdgesGain(0)).toBe(1);
    expect(accentedEdgesGain(0.5)).toBe(4);
    expect(accentedEdgesGain(1)).toBe(7);
    expect(accentedEdgesGain(2)).toBe(7); // clamped
  });
  it("threshold = 4000 + 30000·clamp(smoothness,0,1) (4000..34000)", () => {
    expect(accentedEdgesThreshold(0)).toBe(4000);
    expect(accentedEdgesThreshold(0.3)).toBe(13000);
    expect(accentedEdgesThreshold(1)).toBe(34000);
    expect(accentedEdgesThreshold(2)).toBe(34000); // clamped
  });
});

describe("accentedEdgesPixel", () => {
  it("leaves a flat neighbourhood unchanged (zero gradient ⇒ edge 0 ⇒ identity)", () => {
    const g = grid(5, 5, () => 30000);
    expect(accentedEdgesPixel(g, 2, 2, 0.5, 1, 0.3)).toBe(30000);
  });

  it("saturates a strong edge to the edge_color (bright accents up, dark accents down)", () => {
    // sharp vertical step: the boundary columns have a huge gradient ⇒ edge=1 ⇒ out=edge_color.
    const step = grid(7, 7, (x) => (x < 3 ? 1000 : 60000));
    expect(accentedEdgesPixel(step, 2, 3, 1, 1, 0)).toBe(ACCENTED_EDGES_MAX); // brightness 1 → white
    expect(accentedEdgesPixel(step, 2, 3, 1, 0, 0)).toBe(0); // brightness 0 → black ink
    expect(accentedEdgesPixel(step, 0, 3, 1, 1, 0)).toBe(1000); // far from edge → identity
  });

  it("clamps brightness to [0,1]: brightness 2 behaves exactly like brightness 1", () => {
    // edge_color = clamp(brightness,0,1)·65535, so any brightness ≥ 1 collapses to white. Pins the
    // brightness clamp (which neither the ramp nor the step goldens exercise above 1).
    const ramp = grid(7, 7, (x, y) => 20000 + x * 250 + y * 180);
    expect(accentedEdges2D(ramp, 0.5, 2, 0.3)).toEqual(accentedEdges2D(ramp, 0.5, 1, 0.3));
  });
});

describe("accentedEdges2D", () => {
  it("leaves a flat field unchanged", () => {
    const g = grid(8, 8, () => 44444);
    expect(accentedEdges2D(g, 0.5, 1, 0.3)).toEqual(g);
  });

  it("keeps every output an integer within [0, 65535]", () => {
    const g = grid(11, 13, (x, y) => (x * 6151 + y * 3079) % ACCENTED_EDGES_MAX);
    for (const [wd, br, sm] of [
      [0.5, 1, 0.3],
      [1, 0, 0.6],
      [0.2, 0.5, 0.9],
    ]) {
      for (const v of flat(accentedEdges2D(g, wd, br, sm))) {
        expect(Number.isInteger(v)).toBe(true);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(ACCENTED_EDGES_MAX);
      }
    }
  });

  it("handles empty / 1×1 images and is deterministic", () => {
    expect(accentedEdges2D([], 0.5, 1, 0.3)).toEqual([]);
    expect(accentedEdges2D([[], []], 0.5, 1, 0.3)).toEqual([[], []]);
    expect(accentedEdges2D([[42]], 0.5, 1, 0.3)).toEqual([[42]]); // lone pixel: no gradient → identity
    const g = grid(7, 7, (x, y) => 20000 + x * 250 + y * 180);
    expect(accentedEdges2D(g, 0.5, 1, 0.3)).toEqual(accentedEdges2D(g, 0.5, 1, 0.3));
  });

  it("does not mutate the input", () => {
    const g = grid(9, 9, (x, y) => (x * 5000 + y * 4000) % ACCENTED_EDGES_MAX);
    const snapshot = g.map((r) => [...r]);
    accentedEdges2D(g, 0.5, 1, 0.3);
    expect(g).toEqual(snapshot);
  });

  it("is shape-preserving on a non-square image", () => {
    const g = grid(5, 13, (x, y) => 20000 + x * 200 + y * 150);
    const out = accentedEdges2D(g, 0.5, 1, 0.3);
    expect(out.length).toBe(5);
    expect(out.every((r) => r.length === 13)).toBe(true);
  });
});

// ── Cross-implementation goldens captured from the Rust engine's accented_edges. The smooth ramp
//    v = 20000 + x·250 + y·180 keeps 0 < edge < 1 everywhere (continuous lerp); the sharp step
//    exercises edge=1 (saturate to edge_color) AND edge=0 (identity) in one image. sqrt is
//    correctly-rounded so these are bit-exact. ──
describe("engine golden (accented_edges, 7×7 grey)", () => {
  const ramp = grid(7, 7, (x, y) => 20000 + x * 250 + y * 180);
  const asRows = (vals: number[]): number[][] => Array.from({ length: 7 }, (_, y) => vals.slice(y * 7, y * 7 + 7));

  it("matches the engine bit-exactly — ramp, width 0.5, brightness 1, smoothness 0.3", () => {
    expect(accentedEdges2D(ramp, 0.5, 1, 0.3)).toEqual(
      asRows([
        37264, 49868, 49955, 50041, 50127, 50214, 38195, 44646, 54633, 54693, 54753, 54814, 54874, 45336, 44729, 54676,
        54737, 54797, 54857, 54918, 45419, 44811, 54720, 54780, 54840, 54901, 54961, 45502, 44894, 54763, 54823, 54884,
        54944, 55005, 45585, 44977, 54807, 54867, 54927, 54988, 55048, 45668, 37935, 50242, 50328, 50415, 50501, 50588,
        38866,
      ]),
    );
  });

  it("matches the engine bit-exactly — ramp, width 1, brightness 0.8, smoothness 0.6", () => {
    expect(accentedEdges2D(ramp, 1, 0.8, 0.6)).toEqual(
      asRows([
        32714, 42013, 42094, 42175, 42256, 42337, 33626, 38168, 45521, 45575, 45629, 45683, 45737, 38832, 38248, 45560,
        45614, 45668, 45721, 45775, 38911, 38327, 45598, 45652, 45706, 45760, 45814, 38991, 38407, 45637, 45691, 45745,
        45799, 45853, 39070, 38487, 45676, 45730, 45784, 45838, 45892, 39150, 33370, 42362, 42443, 42524, 42605, 42686,
        34282,
      ]),
    );
  });

  it("matches the engine bit-exactly — sharp step, width 1, brightness 1, smoothness 0 (edge=1/edge=0)", () => {
    const step = grid(7, 7, (x) => (x < 3 ? 1000 : 60000));
    expect(accentedEdges2D(step, 1, 1, 0)).toEqual(
      asRows([
        1000, 1000, 65535, 65535, 60000, 60000, 60000, 1000, 1000, 65535, 65535, 60000, 60000, 60000, 1000, 1000, 65535,
        65535, 60000, 60000, 60000, 1000, 1000, 65535, 65535, 60000, 60000, 60000, 1000, 1000, 65535, 65535, 60000,
        60000, 60000, 1000, 1000, 65535, 65535, 60000, 60000, 60000, 1000, 1000, 65535, 65535, 60000, 60000, 60000,
      ]),
    );
  });

  it("matches the engine bit-exactly — MID brightness 0.5 step (pins the upper clamp on `edge`)", () => {
    // edge saturates to 1 at the boundary but edge_color = 32767.5, so out = 32767 (truncated) —
    // a mirror that dropped the upper clamp on `edge` would overshoot and the output clamp would
    // render 65535 / 0 instead, so this pins the `edge`-clamp independently of the output clamp.
    const step = grid(7, 7, (x) => (x < 3 ? 1000 : 60000));
    expect(accentedEdges2D(step, 1, 0.5, 0)).toEqual(
      asRows([
        1000, 1000, 32767, 32767, 60000, 60000, 60000, 1000, 1000, 32767, 32767, 60000, 60000, 60000, 1000, 1000, 32767,
        32767, 60000, 60000, 60000, 1000, 1000, 32767, 32767, 60000, 60000, 60000, 1000, 1000, 32767, 32767, 60000,
        60000, 60000, 1000, 1000, 32767, 32767, 60000, 60000, 60000, 1000, 1000, 32767, 32767, 60000, 60000, 60000,
      ]),
    );
  });

  it("matches the engine bit-exactly — 9×9 bilinear SADDLE (pins the Sobel perpendicular (1,2,1) taps)", () => {
    // v = 20000 + x·y·180 is non-linear and non-axis-aligned, so the perpendicular smoothing taps
    // do NOT cancel (they do on the linear ramps). Wrong dy-offsets or collapsing the (1,2,1)
    // weights all diverge here, so this golden pins the full Sobel stencil.
    const saddle = grid(9, 9, (x, y) => 20000 + x * y * 180);
    const rows9 = (vals: number[]): number[][] => Array.from({ length: 9 }, (_, y) => vals.slice(y * 9, y * 9 + 9));
    expect(accentedEdges2D(saddle, 0.5, 1, 0.3)).toEqual(
      rows9([
        23566, 31278, 40796, 50680, 60665, 65535, 65535, 65535, 65535, 31278, 48599, 65117, 65535, 65535, 65535, 65535,
        65535, 65535, 40796, 65117, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 50680, 65535, 65535, 65535, 65535,
        65535, 65535, 65535, 65535, 60665, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535,
        65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535,
        65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535, 65535,
        65535,
      ]),
    );
  });
});

// ── Several param fixtures swept for in-range, shape, flat-invariance ──
const FIXTURES: { name: string; wd: number; br: number; sm: number }[] = [
  { name: "fine bright", wd: 0.2, br: 1, sm: 0.1 },
  { name: "wide dark", wd: 1, br: 0, sm: 0.8 },
  { name: "mid", wd: 0.5, br: 0.5, sm: 0.5 },
];

describe.each(FIXTURES)("fixture: $name", ({ wd, br, sm }) => {
  it("stays in range, keeps shape, and leaves a flat field untouched", () => {
    const g = grid(13, 13, (x, y) => 15000 + x * 300 + y * 220);
    const out = accentedEdges2D(g, wd, br, sm);
    expect(out.length).toBe(13);
    expect(out.every((row) => row.length === 13)).toBe(true);
    for (const v of flat(out)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(ACCENTED_EDGES_MAX);
    }
    expect(accentedEdges2D(grid(13, 13, () => 33333), wd, br, sm)).toEqual(grid(13, 13, () => 33333));
  });
});
