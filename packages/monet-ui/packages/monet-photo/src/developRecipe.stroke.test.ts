// healStrokeSpots — the Remove tool's brush-drag stroke (REM-04): a free-form
// polyline resampled into a chain of overlapping heal stamps that share one
// perpendicular source offset, riding the frozen 8-float heal ABI unchanged.

import { describe, expect, it } from "vitest";

import {
  createDefaultRecipe,
  healStrokeSpots,
  MAX_HEAL_SPOTS,
  normalizeRecipe,
  type HealSpot,
} from "./developRecipe";

const R = 0.02;
const SPACING = R * 0.75;

describe("healStrokeSpots", () => {
  it("degrades a click (single point) to one classic spot", () => {
    const spots = healStrokeSpots([{ x: 0.3, y: 0.4 }], R, 1);
    expect(spots).toHaveLength(1);
    const s = spots[0];
    expect(s.mode).toBe("heal");
    expect(s.radius).toBe(R);
    expect(s.feather).toBe(0.5);
    expect(s.opacity).toBe(1);
    // No stroke direction → horizontal offset, toward the frame centre.
    expect(s.sourceX).toBeCloseTo(0.3 + Math.max(R * 3, 0.06), 6);
    expect(s.sourceY).toBeCloseTo(0.4, 6);
  });

  it("resamples a straight stroke into evenly spaced stamps covering both ends", () => {
    const stroke = [
      { x: 0.2, y: 0.4 },
      { x: 0.6, y: 0.4 },
    ];
    const spots = healStrokeSpots(stroke, R, 1);
    // 0.4 of arc at 0.015 spacing → a dense chain, not a couple of dots.
    expect(spots.length).toBeGreaterThan(20);
    expect(spots[0].x).toBeCloseTo(0.2, 6);
    // Tail covered: the last stamp lands within one spacing of the stroke end.
    expect(Math.abs(spots[spots.length - 1].x - 0.6)).toBeLessThan(SPACING);
    for (let i = 1; i < spots.length; i++) {
      const d = Math.hypot(spots[i].x - spots[i - 1].x, spots[i].y - spots[i - 1].y);
      expect(d).toBeGreaterThan(0);
      expect(d).toBeLessThanOrEqual(SPACING + 1e-6);
    }
  });

  it("gives every stamp the SAME perpendicular source offset, biased toward the centre", () => {
    const spots = healStrokeSpots(
      [
        { x: 0.2, y: 0.4 },
        { x: 0.6, y: 0.4 },
      ],
      R,
      1,
    );
    const off = Math.max(R * 3, 0.06);
    for (const s of spots) {
      // Horizontal stroke → vertical offset; y=0.4 → biased down toward 0.5.
      expect(s.sourceX - s.x).toBeCloseTo(0, 6);
      expect(s.sourceY - s.y).toBeCloseTo(off, 6);
    }
  });

  it("measures spacing in min-dimension units (aspect-aware)", () => {
    const wide = healStrokeSpots(
      [
        { x: 0.2, y: 0.5 },
        { x: 0.6, y: 0.5 },
      ],
      R,
      2, // landscape 2:1 — normalized x distances count double
    );
    const square = healStrokeSpots(
      [
        { x: 0.2, y: 0.5 },
        { x: 0.6, y: 0.5 },
      ],
      R,
      1,
    );
    // Same normalized stroke is twice as long in min-dim units → ~2× stamps.
    expect(wide.length).toBeGreaterThan(square.length * 1.5);
  });

  it("caps a long stroke at MAX_HEAL_SPOTS and clamps all coords to 0..1", () => {
    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i <= 100; i++) pts.push({ x: i / 100, y: 0.02 }); // full-width edge stroke
    const spots = healStrokeSpots(pts, R, 1);
    expect(spots.length).toBeLessThanOrEqual(MAX_HEAL_SPOTS);
    for (const s of spots) {
      for (const v of [s.x, s.y, s.sourceX, s.sourceY]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
      // y=0.02 → sources biased down into the frame, never off the top edge.
      expect(s.sourceY).toBeGreaterThan(s.y);
    }
  });

  it("produces plain HealSpots that survive normalizeRecipe untouched (persistable)", () => {
    const stamps: HealSpot[] = healStrokeSpots(
      [
        { x: 0.3, y: 0.3 },
        { x: 0.4, y: 0.45 },
        { x: 0.55, y: 0.5 },
      ],
      R,
      1.5,
    );
    const recipe = { ...createDefaultRecipe(), heal: { spots: stamps } };
    const normalized = normalizeRecipe(JSON.parse(JSON.stringify(recipe)));
    expect(normalized.heal.spots).toEqual(stamps);
  });
});
