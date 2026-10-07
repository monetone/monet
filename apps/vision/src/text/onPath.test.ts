// Type ▸ Text on Path Options — the pure arc-length layout behind
// `rasterizeOnPath`: start/end brackets, alignment on the run, flip,
// align-to-path and spacing. No DOM here; the canvas half only draws these.
import { describe, it, expect } from "vitest";
import { defaultSpec, type TextSpec } from "./spec";
import { layoutOnPath, type PathCell } from "./raster";

/** Four 10px-wide glyphs (ascent 8 / descent 2) on a 100px horizontal path. */
const glyph = (n = 4): PathCell[] =>
  Array.from({ length: n }, () => ({ advance: 10, ascent: 8, descent: 2, isSpace: false, isBreak: false }));

const onPath = (patch: Partial<TextSpec> = {}): TextSpec =>
  defaultSpec("abcd", { path: [0, 0, 100, 0], ...patch });

/** Glyph-centre positions, rounded past the lerp's float noise. */
const xs = (spec: TextSpec, cells = glyph()) => layoutOnPath(cells, spec).map((p) => +p.x.toFixed(6));

describe("text on path layout", () => {
  it("walks glyph centres from the start of the path by default", () => {
    expect(xs(onPath())).toEqual([5, 15, 25, 35]);
    expect(layoutOnPath(glyph(), onPath()).every((q) => q.y === 0 && q.angle === 0 && q.offset === 0)).toBe(true);
  });

  it("slides the run to the start bracket", () => {
    expect(xs(onPath({ pathStart: 20 }))).toEqual([25, 35, 45, 55]);
  });

  it("centres and right-aligns the run inside the start/end brackets", () => {
    // 40px of glyphs in a 20..80 window → 20px slack.
    expect(layoutOnPath(glyph(), onPath({ pathStart: 20, pathEnd: 80, align: "center" }))[0].x).toBeCloseTo(35);
    expect(layoutOnPath(glyph(), onPath({ pathStart: 20, pathEnd: 80, align: "right" }))[0].x).toBeCloseTo(45);
  });

  it("clamps the end bracket to the path and never below the start", () => {
    expect(layoutOnPath(glyph(), onPath({ pathStart: 60, pathEnd: 10, align: "right" }))[0].x).toBeCloseTo(65);
    expect(layoutOnPath(glyph(), onPath({ pathEnd: 999, align: "right" }))[0].x).toBeCloseTo(65);
  });

  it("spaces glyphs apart (and pulls them together when negative)", () => {
    expect(xs(onPath({ pathSpacing: 4 }))).toEqual([5, 19, 33, 47]);
    expect(xs(onPath({ pathSpacing: -2 }))).toEqual([5, 13, 21, 29]);
  });

  it("flips the run backwards along the path and turns each glyph 180°", () => {
    expect(xs(onPath({ pathFlip: true }))).toEqual([95, 85, 75, 65]); // mirrored about the window
    expect(layoutOnPath(glyph(), onPath({ pathFlip: true })).every((q) => Math.abs(q.angle - Math.PI) < 1e-9)).toBe(true);
  });

  it("puts the requested glyph edge on the path", () => {
    const off = (pathAlign: TextSpec["pathAlign"]) => layoutOnPath(glyph(1), onPath({ pathAlign }))[0].offset;
    expect(off("baseline")).toBe(0);
    expect(off("ascender")).toBe(8);   // glyph top on the path → baseline below
    expect(off("descender")).toBe(-2); // glyph bottom on the path → baseline above
    expect(off("center")).toBe(3);     // (8 - 2) / 2
  });

  it("rotates glyphs to the local tangent and skips spaces but keeps their advance", () => {
    const cells: PathCell[] = [
      { advance: 10, ascent: 8, descent: 2, isSpace: false, isBreak: false },
      { advance: 10, ascent: 8, descent: 2, isSpace: true, isBreak: false },
      { advance: 10, ascent: 8, descent: 2, isSpace: false, isBreak: false },
    ];
    // Right 100px then down 100px: the third glyph's centre is 25px down.
    const p = layoutOnPath(cells, onPath({ path: [0, 0, 100, 0, 100, 100], pathStart: 90 }));
    expect(p).toHaveLength(2); // the space draws nothing
    expect(p[0].x).toBeCloseTo(95); expect(p[0].angle).toBeCloseTo(0);
    expect(p[1].x).toBeCloseTo(100); expect(p[1].y).toBeCloseTo(15);
    expect(p[1].angle).toBeCloseTo(Math.PI / 2);
  });
});
