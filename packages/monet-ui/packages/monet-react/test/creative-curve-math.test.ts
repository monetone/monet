// Unit tests for the pure curve math (creative-curve-math.ts).
// Run from the repo root with:  node --test packages/monet-react/test/
// Node strips the TS types; the module under test is imported with an explicit
// .ts extension (the runner rejects .tsx). Zero-dep tooling only (node:test +
// node:assert). This covers the geometry behind the SVG bezier curve editors:
// value ⇄ fraction mapping (linear + log), the path builders, the easing
// sampler, and the preset table.

import { test } from "node:test";
import assert from "node:assert/strict";

import {
  fracToValue,
  valueToFrac,
  formatAxisValue,
  pointToSvg,
  sortByX,
  buildCurvePath,
  closeFillPath,
  easingPath,
  matchPreset,
  EASING_PRESETS,
  type CurvePoint,
} from "../src/creative-curve-math.ts";

// ── fracToValue / valueToFrac (linear) ──────────────────────────
test("fracToValue maps a linear fraction onto a range", () => {
  assert.equal(fracToValue(0, 0, 100), 0);
  assert.equal(fracToValue(1, 0, 100), 100);
  assert.equal(fracToValue(0.5, 0, 100), 50);
  assert.equal(fracToValue(0.5, -12, 12), 0);
});

test("fracToValue clamps out-of-range fractions", () => {
  assert.equal(fracToValue(-1, 0, 10), 0);
  assert.equal(fracToValue(2, 0, 10), 10);
});

test("valueToFrac inverts fracToValue (linear)", () => {
  assert.equal(valueToFrac(50, 0, 100), 0.5);
  assert.equal(valueToFrac(0, -12, 12), 0.5);
  // round trip
  const f = 0.3;
  assert.ok(Math.abs(valueToFrac(fracToValue(f, 5, 9), 5, 9) - f) < 1e-9);
});

// ── log scale ───────────────────────────────────────────────────
test("fracToValue spaces a log axis geometrically", () => {
  // 20 Hz .. 20 kHz: endpoints exact, midpoint is the geometric mean
  assert.ok(Math.abs(fracToValue(0, 20, 20000, "log") - 20) < 1e-6);
  assert.ok(Math.abs(fracToValue(1, 20, 20000, "log") - 20000) < 1e-6);
  const mid = fracToValue(0.5, 20, 20000, "log");
  assert.ok(Math.abs(mid - Math.sqrt(20 * 20000)) < 1e-6);
});

test("log fracToValue round-trips through valueToFrac", () => {
  const f = 0.42;
  const v = fracToValue(f, 20, 20000, "log");
  assert.ok(Math.abs(valueToFrac(v, 20, 20000, "log") - f) < 1e-9);
});

test("log scale falls back to linear when a bound is <= 0", () => {
  assert.equal(fracToValue(0.5, 0, 100, "log"), 50);
});

// ── formatAxisValue ─────────────────────────────────────────────
test("formatAxisValue keeps integers integral and scales decimals", () => {
  assert.equal(formatAxisValue(50), "50");
  assert.equal(formatAxisValue(-12), "-12");
  assert.equal(formatAxisValue(240.6), "241");
  assert.equal(formatAxisValue(3.25), "3.3"); // (3.25).toFixed(1) rounds half-up
  assert.equal(formatAxisValue(0.5), "0.50");
  // log-mapping float dust still reads as a clean integer
  assert.equal(formatAxisValue(20.000000000000004), "20");
});

// ── pointToSvg ──────────────────────────────────────────────────
test("pointToSvg flips Y and scales to pixels", () => {
  assert.deepEqual(pointToSvg({ x: 0, y: 1 }, 200, 100), { x: 0, y: 0 });
  assert.deepEqual(pointToSvg({ x: 1, y: 0 }, 200, 100), { x: 200, y: 100 });
  assert.deepEqual(pointToSvg({ x: 0.5, y: 0.5 }, 200, 100), { x: 100, y: 50 });
});

test("pointToSvg clamps out-of-range coordinates", () => {
  assert.deepEqual(pointToSvg({ x: -1, y: 2 }, 100, 100), { x: 0, y: 0 });
});

// ── sortByX ─────────────────────────────────────────────────────
test("sortByX returns a new sorted array without mutating the input", () => {
  const input: CurvePoint[] = [
    { id: "c", x: 1, y: 0 },
    { id: "a", x: 0, y: 0 },
    { id: "b", x: 0.5, y: 0 },
  ];
  const out = sortByX(input);
  assert.deepEqual(out.map((p) => p.id), ["a", "b", "c"]);
  // input untouched
  assert.deepEqual(input.map((p) => p.id), ["c", "a", "b"]);
});

// ── buildCurvePath ──────────────────────────────────────────────
test("buildCurvePath starts with a Move to the first (sorted) point", () => {
  const d = buildCurvePath(
    [
      { id: "b", x: 1, y: 1 },
      { id: "a", x: 0, y: 0 },
    ],
    100,
    100,
  );
  // sorted: a (0,0)→svg (0,100), b (1,1)→svg (100,0)
  assert.ok(d.startsWith("M 0 100"));
  assert.ok(d.includes("C")); // cubic segment
  assert.ok(d.includes("100 0")); // ends at the last point
});

test("buildCurvePath honours explicit out/in handles", () => {
  const d = buildCurvePath(
    [
      { id: "a", x: 0, y: 0, hOut: { x: 0.5, y: 0 } },
      { id: "b", x: 1, y: 1, hIn: { x: -0.5, y: 0 } },
    ],
    100,
    100,
  );
  // a.hOut → (0.5,0) → svg (50,100); b.hIn → (0.5,1) → svg (50,0)
  assert.ok(d.includes("C 50 100, 50 0, 100 0"));
});

test("buildCurvePath returns a bare Move for a single point and '' for none", () => {
  assert.equal(buildCurvePath([{ id: "a", x: 0.5, y: 0.5 }], 100, 100), "M 50 50");
  assert.equal(buildCurvePath([], 100, 100), "");
});

test("closeFillPath drops to the baseline and closes", () => {
  const fill = closeFillPath("M 0 50 C 1 1, 2 2, 100 50", 100, 100);
  assert.ok(fill.endsWith("L 100 100 L 0 100 Z"));
  assert.equal(closeFillPath("", 100, 100), "");
});

// ── easingPath ──────────────────────────────────────────────────
test("easingPath samples the bezier from origin to the end corner", () => {
  const d = easingPath([0.42, 0, 0.58, 1], 100, 100, 8);
  // t=0 → (0,0)→svg (0,100); t=1 → (1,1)→svg (100,0)
  assert.ok(d.startsWith("M 0 100"));
  assert.ok(d.trim().endsWith("L 100 0"));
});

test("easingPath of linear is the diagonal at the midpoint", () => {
  const d = easingPath([0, 0, 1, 1], 100, 100, 2);
  // midpoint t=0.5 of linear → (0.5,0.5) → svg (50,50)
  assert.ok(d.includes("L 50 50"));
});

// ── presets ─────────────────────────────────────────────────────
test("EASING_PRESETS contains the common CSS easings", () => {
  assert.deepEqual(EASING_PRESETS["ease-in"], [0.42, 0, 1, 1]);
  assert.deepEqual(EASING_PRESETS["ease-out"], [0, 0, 0.58, 1]);
  assert.deepEqual(EASING_PRESETS["ease-in-out"], [0.42, 0, 0.58, 1]);
  assert.deepEqual(EASING_PRESETS.linear, [0, 0, 1, 1]);
});

test("matchPreset finds a known curve and rejects an unknown one", () => {
  assert.equal(matchPreset([0.42, 0, 0.58, 1]), "ease-in-out");
  assert.equal(matchPreset([0.42, 0, 1, 1]), "ease-in");
  assert.equal(matchPreset([0.11, 0.22, 0.33, 0.44]), undefined);
});

test("matchPreset tolerates tiny float drift within eps", () => {
  assert.equal(matchPreset([0.4200004, 0, 0.5799998, 1]), "ease-in-out");
});

// ── Catmull-Rom smoothing actually curves ───────────────────────
// The synthesised control points must take their direction from the NEIGHBOUR
// chord (prev→next), not from the segment's own chord. Derive them from the
// segment and both controls land ON that segment, every cubic degenerates to a
// straight line, and a "smooth curve" renders as a polyline.
test("buildCurvePath synthesises control points off the segment chord", () => {
  // A zigzag: the middle point is nowhere near the line between its neighbours.
  const d = buildCurvePath(
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 1 },
      { x: 1, y: 0 },
    ],
    100,
    100,
    0.2,
  );
  const seg = /C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/.exec(d);
  assert.ok(seg, `expected a cubic segment in ${d}`);
  const [c1x, c1y, c2x, c2y, ex, ey] = seg.slice(1).map(Number);
  // Start of the first segment is the first point mapped into SVG space.
  const s = pointToSvg({ x: 0, y: 0 }, 100, 100);
  const cross = (px: number, py: number) =>
    (ex - s.x) * (py - s.y) - (ey - s.y) * (px - s.x);
  assert.ok(
    Math.abs(cross(c1x, c1y)) + Math.abs(cross(c2x, c2y)) > 1e-6,
    `control points are collinear with the chord — the curve is a straight line: ${d}`,
  );
});

test("buildCurvePath keeps a genuinely straight run straight", () => {
  const d = buildCurvePath(
    [
      { x: 0, y: 0 },
      { x: 0.5, y: 0.5 },
      { x: 1, y: 1 },
    ],
    100,
    100,
    0.2,
  );
  const seg = /C ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+), ([-\d.]+) ([-\d.]+)/.exec(d);
  assert.ok(seg);
  const [c1x, c1y, c2x, c2y, ex, ey] = seg.slice(1).map(Number);
  const s = pointToSvg({ x: 0, y: 0 }, 100, 100);
  const cross = (px: number, py: number) =>
    (ex - s.x) * (py - s.y) - (ey - s.y) * (px - s.x);
  assert.ok(Math.abs(cross(c1x, c1y)) < 1e-6 && Math.abs(cross(c2x, c2y)) < 1e-6, d);
});
