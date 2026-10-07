import { typeOutlineScene } from "./outline";
// ─────────────────────────────────────────────────────────────
// rasterizeSpec — the top-level composition entry (cells → layout branch →
// paint → anti-alias → warp → placement). Every other raster test drives a
// helper in isolation, and the two state tests that touch this function stub it
// out entirely, so nothing pinned the wiring: which layout branch a spec picks,
// that effect padding grows the bitmap *without* moving the text in the
// document, that the shadow lands where dx/dy says, that antialias post-
// processes the alpha, or that a warp is applied at all.
//
// The Node unit env has no canvas, so this file installs a fake 2D context that
// paints an opaque box per fillText/strokeText/fillRect (with a 1px partially
// transparent fringe, exactly what a real anti-aliased glyph edge looks like to
// applyAA). Glyph shapes are fake; geometry — where ink lands, and how big the
// bitmap is — is real, and that is what rasterizeSpec is responsible for.
// ─────────────────────────────────────────────────────────────
import { afterAll, describe, expect, it } from "vitest";
import { effectsPad, layoutVertical, rasterizeSpec, type Cell } from "./raster";
import { defaultSpec, type TextSpec } from "./spec";

const paintedText: string[] = [];
const CORE_A = 255; // glyph interior
const EDGE_A = 100; // anti-aliased fringe (0.39 coverage — below the "none" 0.5 cut)

/** Every glyph is a box: width = 0.5em per char, ascent 0.8em, descent 0.2em. */
const fontPx = (font: string) => Number(/(\d*\.?\d+)px/.exec(font)?.[1] ?? 10);

class FakeCtx {
  font = "10px sans-serif";
  fontKerning = "normal";
  direction = "ltr";
  textAlign = "left";
  textBaseline = "alphabetic";
  fillStyle = "";
  strokeStyle = "";
  lineWidth = 1;
  lineJoin = "miter";
  shadowColor = "rgba(0,0,0,0)";
  shadowBlur = 0;
  shadowOffsetX = 0;
  shadowOffsetY = 0;
  private m: number[] = [1, 0, 0, 1, 0, 0];
  private stack: number[][] = [];
  private buf: Uint8ClampedArray | null = null;
  constructor(private el: FakeCanvas) {}
  get canvas() { return this.el; }

  save() { this.stack.push(this.m.slice()); }
  restore() { const p = this.stack.pop(); if (p) this.m = p; }
  translate(x: number, y: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(sx: number, sy: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [a * sx, b * sx, c * sy, d * sy, e, f];
  }
  transform(a2: number, b2: number, c2: number, d2: number, e2: number, f2: number) {
    const [a, b, c, d, e, f] = this.m;
    this.m = [
      a * a2 + c * b2, b * a2 + d * b2,
      a * c2 + c * d2, b * c2 + d * d2,
      a * e2 + c * f2 + e, b * e2 + d * f2 + f,
    ];
  }
  rotate(r: number) { this.transform(Math.cos(r), Math.sin(r), -Math.sin(r), Math.cos(r), 0, 0); }
  private pt(x: number, y: number): [number, number] {
    const [a, b, c, d, e, f] = this.m;
    return [a * x + c * y + e, b * x + d * y + f];
  }

  measureText(t: string) {
    const s = fontPx(this.font);
    return {
      width: t.length * s * 0.5,
      actualBoundingBoxAscent: s * 0.8,
      actualBoundingBoxDescent: s * 0.2,
    };
  }
  clearRect() {}
  fillText(t: string, x: number, y: number) { paintedText.push(t); this.textBox(t, x, y, 0); }
  strokeText(t: string, x: number, y: number) { this.textBox(t, x, y, this.lineWidth / 2); }
  fillRect(x: number, y: number, w: number, h: number) { this.box(x, y, x + w, y + h); }

  private textBox(t: string, x: number, y: number, grow: number) {
    if (!t) return;
    const s = fontPx(this.font);
    const w = t.length * s * 0.5;
    this.box(x - grow, y - s * 0.8 - grow, x + w + grow, y + s * 0.2 + grow);
  }

  /** Paint a local-space rectangle (plus the canvas shadow, if one is armed). */
  private box(x0: number, y0: number, x1: number, y1: number) {
    const cs = [this.pt(x0, y0), this.pt(x1, y0), this.pt(x1, y1), this.pt(x0, y1)];
    const dx0 = Math.min(...cs.map((p) => p[0])), dx1 = Math.max(...cs.map((p) => p[0]));
    const dy0 = Math.min(...cs.map((p) => p[1])), dy1 = Math.max(...cs.map((p) => p[1]));
    // Canvas shadow offsets/blur are in device space, unaffected by the CTM.
    if (!/,\s*0\)\s*$/.test(this.shadowColor)) {
      const b = this.shadowBlur;
      this.fill(dx0 + this.shadowOffsetX - b, dy0 + this.shadowOffsetY - b,
                dx1 + this.shadowOffsetX + b, dy1 + this.shadowOffsetY + b);
    }
    this.fill(dx0, dy0, dx1, dy1);
  }

  private fill(x0: number, y0: number, x1: number, y1: number) {
    const W = this.el.width, H = this.el.height;
    if (!this.buf) this.buf = new Uint8ClampedArray(W * H * 4);
    const ix0 = Math.max(0, Math.floor(x0)), ix1 = Math.min(W, Math.ceil(x1));
    const iy0 = Math.max(0, Math.floor(y0)), iy1 = Math.min(H, Math.ceil(y1));
    for (let y = iy0; y < iy1; y++) {
      for (let x = ix0; x < ix1; x++) {
        const edge = x === ix0 || x === ix1 - 1 || y === iy0 || y === iy1 - 1;
        const a = edge ? EDGE_A : CORE_A;
        const i = (y * W + x) * 4;
        if (a > this.buf[i + 3]) { this.buf[i] = 255; this.buf[i + 1] = 255; this.buf[i + 2] = 255; this.buf[i + 3] = a; }
      }
    }
  }

  getImageData(_x: number, _y: number, w: number, h: number) {
    if (!this.buf) this.buf = new Uint8ClampedArray(this.el.width * this.el.height * 4);
    return { data: this.buf.slice(0, w * h * 4) };
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  parentNode: unknown = null;
  offsetWidth = 0;
  /** What the typesetter put on the element's style — the only channel by which
   *  canvas text honours font-feature-settings / font-variation-settings. */
  css: Record<string, string> = {};
  style = { setProperty: (k: string, v: string) => { this.css[k] = v; } };
  private ctx: FakeCtx | null = null;
  getContext() { return (this.ctx ??= new FakeCtx(this)); }
}

class FakeHost {
  style = { cssText: "" };
  setAttribute() {}
  appendChild(child: { parentNode: unknown }) { child.parentNode = this; }
  removeChild(child: { parentNode: unknown }) { child.parentNode = null; }
}

const g = globalThis as unknown as Record<string, unknown>;
const canvases: FakeCanvas[] = [];
g.document = {
  body: new FakeHost(),
  createElement: (tag: string) => {
    if (tag !== "canvas") return new FakeHost();
    const c = new FakeCanvas();
    canvases.push(c);
    return c;
  },
};
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
afterAll(() => { delete g.document; delete g.getComputedStyle; });

/** Bounding box of every non-transparent pixel, or null when nothing was painted. */
function inkBox(r: { w: number; h: number; data: Uint8ClampedArray }) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, n = 0;
  for (let y = 0; y < r.h; y++) {
    for (let x = 0; x < r.w; x++) {
      if (r.data[(y * r.w + x) * 4 + 3] === 0) continue;
      n++;
      if (x < x0) x0 = x; if (x > x1) x1 = x;
      if (y < y0) y0 = y; if (y > y1) y1 = y;
    }
  }
  return n ? { x0, y0, x1, y1, n } : null;
}

const spec = (patch: Partial<TextSpec> = {}): TextSpec => defaultSpec("AB", { ax: 100, ay: 50, ...patch });

describe("rasterizeSpec", () => {
  it("paints ink into a bitmap sized from the block plus the effects pad", () => {
    const s = spec();
    const r = rasterizeSpec(s);
    // "AB" at 64px: 0.5em advances → blockW 64; auto leading 120% → blockH 76.8.
    expect(effectsPad(s)).toBe(4);
    expect(r.w).toBe(64 + 4 * 2);
    expect(r.h).toBe(Math.ceil(76.8) + 4 * 2);
    const ink = inkBox(r);
    expect(ink).not.toBeNull();
    // Ink starts at the pad, is one em-box tall and spans both glyphs.
    expect(ink!.x0).toBe(4);
    expect(ink!.x1).toBe(4 + 64 - 1);
  });

  it("keeps the document anchor fixed as effect padding grows the bitmap", () => {
    // This is the whole point of placeX/placeY: a stroke must fatten the bitmap
    // outwards, not slide the text across the canvas.
    const plain = spec();
    const stroked = spec({ stroke: { width: 6, color: [255, 0, 0, 255] } });
    expect(effectsPad(stroked)).toBe(6 * 2 + 2);

    const a = rasterizeSpec(plain), b = rasterizeSpec(stroked);
    expect(a.placeX).toBe(100 - effectsPad(plain));
    expect(a.placeY).toBe(50 - effectsPad(plain));
    expect(b.placeX).toBe(100 - effectsPad(stroked));
    expect(b.placeY).toBe(50 - effectsPad(stroked));
    // …and the extra pad really is extra bitmap, on both sides.
    expect(b.w - a.w).toBe(2 * (effectsPad(stroked) - effectsPad(plain)));
    expect(b.h - a.h).toBe(2 * (effectsPad(stroked) - effectsPad(plain)));
  });

  it("draws the stroke outside the glyph advance box", () => {
    const a = inkBox(rasterizeSpec(spec()))!;
    const b = inkBox(rasterizeSpec(spec({ stroke: { width: 6, color: [255, 0, 0, 255] } })))!;
    // Same anchor, so compare widths/heights of the painted ink, not positions.
    expect(b.x1 - b.x0).toBeGreaterThan(a.x1 - a.x0);
    expect(b.y1 - b.y0).toBeGreaterThan(a.y1 - a.y0);
  });

  it("casts the drop shadow in the direction of dx/dy", () => {
    const shadow = (dx: number, dy: number): TextSpec =>
      spec({ shadow: { color: [0, 0, 0, 200], blur: 0, dx, dy } });
    const right = rasterizeSpec(shadow(12, 0));
    const left = rasterizeSpec(shadow(-12, 0));
    const down = rasterizeSpec(shadow(0, 12));
    // |dx| is equal, so the pad — and therefore the bitmap — is identical; only
    // the ink moves. A shadow that ignored dx/dy would make these all equal.
    expect(left.w).toBe(right.w);
    const R = inkBox(right)!, L = inkBox(left)!, D = inkBox(down)!;
    // Ink = glyph ∪ shadow, so a +12 shadow extends the right edge by 12 and a
    // −12 one extends the left edge by 12; the glyph itself never moves.
    expect(R.x1 - L.x1).toBe(12);
    expect(R.x0).toBe(L.x0 + 12);
    expect(D.y1 - R.y1).toBe(12);
    expect(D.x1).toBe(L.x1);
  });

  it("applies the anti-alias mode to the alpha channel", () => {
    const smooth = rasterizeSpec(spec({ antialias: "smooth" }));
    const none = rasterizeSpec(spec({ antialias: "none" }));
    const alphas = (r: { data: Uint8ClampedArray }) => {
      const set = new Set<number>();
      for (let i = 3; i < r.data.length; i += 4) set.add(r.data[i]);
      return set;
    };
    // The fringe survives untouched in "smooth" …
    expect(alphas(smooth).has(EDGE_A)).toBe(true);
    // … and is thresholded away entirely in "none".
    expect([...alphas(none)].sort((x, y) => x - y)).toEqual([0, 255]);
    // "strong" boosts coverage instead of thresholding it.
    const strong = rasterizeSpec(spec({ antialias: "strong" }));
    expect(alphas(strong).has(Math.round(Math.min(1, (EDGE_A / 255) * 1.3) * 255))).toBe(true);
  });

  it("routes a warped spec through warpBitmap", () => {
    const flat = rasterizeSpec(spec());
    const arced = rasterizeSpec(spec({ warp: { style: "arc", bend: 0.6, h: 0, v: 0, orient: "h" } }));
    // The arc envelope bows the block, so the bitmap has to grow to hold it …
    expect(arced.h).toBeGreaterThan(flat.h);
    expect(arced.data.length).toBe(arced.w * arced.h * 4);
    // … and the anchor is recomputed from the warped center, not the flat one.
    expect(arced.placeY).not.toBe(flat.placeY);
    expect(inkBox(arced)).not.toBeNull();
  });

  it("picks the vertical layout branch for spec.vertical", () => {
    const wide = rasterizeSpec(defaultSpec("ABCDEF"));
    const tall = rasterizeSpec(defaultSpec("ABCDEF", { vertical: true }));
    expect(wide.w).toBeGreaterThan(wide.h);   // 6 glyphs on one line
    expect(tall.h).toBeGreaterThan(tall.w);   // 6 glyphs stacked in one column
    expect(tall.h).toBeGreaterThan(wide.h);
  });

  it("picks the on-path branch and anchors the bitmap to the path bounds", () => {
    const s = defaultSpec("AB", { ax: 999, ay: 999, path: [10, 20, 110, 20] });
    const r = rasterizeSpec(s);
    // On-path output is placed from the path's own bbox — ax/ay are ignored.
    const pad = Math.ceil(s.size * 1.5) + effectsPad(s);
    expect(r.placeX).toBe(10 - pad);
    expect(r.placeY).toBe(20 - pad);
    expect(r.w).toBe(110 - (10 - pad) + pad);
    expect(inkBox(r)).not.toBeNull();
  });

  it("ignores a degenerate path (fewer than two points) and lays out normally", () => {
    const onPath = rasterizeSpec(spec({ path: [10, 20, 110, 20] }));
    const stub = rasterizeSpec(spec({ path: [10, 20] }));
    expect(stub.placeX).toBe(rasterizeSpec(spec()).placeX);
    expect(stub.placeX).not.toBe(onPath.placeX);
  });

  // #453: a run's variable-font axes reach canvas text ONLY through the
  // element's computed style — `font-variation-settings` is not part of the
  // `ctx.font` shorthand, exactly like the feature settings above it.
  it("paints a run's variable axes through the canvas element's style", () => {
    const painted = (s: TextSpec) => {
      const before = canvases.length;
      rasterizeSpec(s);
      return canvases.slice(before).map((c) => c.css["font-variation-settings"]);
    };
    expect(painted(spec({ runs: [{ text: "AB", axes: { wdth: 125 } }] }))).toContain('"wdth" 125');
    // wght rides in ctx.font as the CSS weight instead, so it never doubles up.
    expect(painted(spec({ runs: [{ text: "AB", weight: 650 }] }))).toEqual(["normal"]);
  });

  // #455: Type ▸ Language Options ▸ East Asian Features, end to end. Glyphs
  // here are 0.5em, so a 20px CJK glyph is 10px and a 100px box holds 10.
  describe("East Asian Features", () => {
    const cjk = (text: string, patch: Partial<TextSpec> = {}) =>
      defaultSpec(text, { kind: "paragraph", boxW: 100, size: 20, ...patch });

    it("re-wraps a spaceless CJK paragraph into more lines", () => {
      const text = "字".repeat(20);
      expect(rasterizeSpec(cjk(text, { eastAsian: true })).h).toBeGreaterThan(rasterizeSpec(cjk(text)).h);
    });

    it("sets vertical digits across the column and paints them as one string", () => {
      const off = rasterizeSpec(defaultSpec("第12回", { vertical: true }));
      paintedText.length = 0;
      const on = rasterizeSpec(defaultSpec("第12回", { vertical: true, eastAsian: true }));
      expect(paintedText).toEqual(["第", "12", "回"]);
      expect(on.h).toBeLessThan(off.h);
    });

    it("grows the bitmap for a hanging stop so its ink is not clipped", () => {
      const r = rasterizeSpec(cjk("字".repeat(10) + "。字", { eastAsian: true }));
      const pad = (r.w - 100) / 2;
      // line 1 is 10 glyphs + the hung 。: 110px of ink from the pad
      expect(inkBox(r)!.x1).toBe(pad + 110 - 1);
      expect(inkBox(r)!.x1).toBeLessThan(r.w - 1);
    });

    it("paints a compressed 」 on its own, where the native run would re-space it", () => {
      paintedText.length = 0;
      rasterizeSpec(spec({ runs: [{ text: "字」「字" }] }));
      expect(paintedText).toEqual(["字」「字"]);
      paintedText.length = 0;
      rasterizeSpec(spec({ runs: [{ text: "字」「字" }], eastAsian: true }));
      expect(paintedText).toEqual(["字", "」", "「字"]);
    });
  });
});

// ── layoutVertical ────────────────────────────────────────────────
// Vertical (CJK) type: one column per paragraph, glyphs stacked down it and
// centered on the column. Nothing asserted any of this geometry before.
const cell = (glyph: string, advance: number, patch: Partial<Cell> = {}): Cell => ({
  glyph, baseGlyph: glyph, markGlyph: "", bidi: "ltr", diacriticX: 0, diacriticY: 0,
  font: "16px sans-serif", drawSize: 16, baseShift: 0, advance, wRaw: advance,
  ascent: 12.8, descent: 3.2, nominalSize: 16, isSpace: false, isBreak: false,
  color: [0, 0, 0, 255], underline: false, strike: false, kerning: "none", tracking: 0,
  hScale: 1, vScale: 1, fauxBold: false, fauxItalic: false, features: "", noBreak: false,
  ...patch,
});
const brk = (): Cell => cell("", 0, { isBreak: true, isSpace: true });
const vspec = (patch: Partial<TextSpec> = {}): TextSpec =>
  defaultSpec("", { size: 16, vertical: true, ...patch });

describe("layoutVertical", () => {
  const COL_W = 16 * 1.1;      // max(size, advance, nominalSize) × 1.1
  const AUTO_LH = 16 * 1.2;    // autoLeading 120%

  it("stacks one paragraph down a single column, centered on it", () => {
    const { placements, blockW, blockH } = layoutVertical([cell("A", 10), cell("B", 10)], vspec());
    expect(placements.map((p) => p.x)).toEqual([(COL_W - 10) / 2, (COL_W - 10) / 2]);
    expect(placements.map((p) => p.y)).toEqual([12.8, AUTO_LH + 12.8]);
    expect(blockW).toBeCloseTo(COL_W, 6);
    expect(blockH).toBeCloseTo(2 * AUTO_LH, 6);
  });

  // Vertical CJK sets columns right to left: the first paragraph owns the
  // RIGHTMOST column and each following one steps left.
  it("starts a new column for each paragraph, running right to left", () => {
    const cells = [cell("A", 10), brk(), cell("B", 10), cell("C", 10)];
    const { placements, blockW, blockH } = layoutVertical(cells, vspec());
    expect(placements).toHaveLength(3);
    expect(placements[0].x).toBeCloseTo(COL_W + (COL_W - 10) / 2, 6);
    expect(placements[1].x).toBeCloseTo((COL_W - 10) / 2, 6);
    expect(placements[2].x).toBeCloseTo((COL_W - 10) / 2, 6);
    // Each column restarts at the top; the block is as tall as the longest one.
    expect(placements[1].y).toBe(placements[0].y);
    expect(placements[2].y).toBeCloseTo(AUTO_LH + 12.8, 6);
    expect(blockW).toBeCloseTo(2 * COL_W, 6);
    expect(blockH).toBeCloseTo(2 * AUTO_LH, 6);
  });

  it("lets an explicit leading override the auto-leading fraction", () => {
    const cells = [cell("A", 10), cell("B", 10)];
    const auto = layoutVertical(cells, vspec());
    const fixed = layoutVertical(cells, vspec({ leading: 40 }));
    expect(fixed.placements[1].y - fixed.placements[0].y).toBe(40);
    expect(auto.placements[1].y - auto.placements[0].y).toBeCloseTo(AUTO_LH, 6);
    expect(fixed.blockH).toBeCloseTo(80, 6);
  });

  it("widens the column to fit the widest advance", () => {
    const wide = layoutVertical([cell("W", 40)], vspec());
    expect(wide.blockW).toBeCloseTo(40 * 1.1, 6);
    expect(wide.placements[0].x).toBeCloseTo((40 * 1.1 - 40) / 2, 6);
  });

  it("keeps every placement inside the reported block", () => {
    const cells = [cell("A", 10), cell("B", 24), brk(), cell("C", 10)];
    const { placements, blockW, blockH } = layoutVertical(cells, vspec());
    for (const p of placements) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x + p.cell.advance).toBeLessThanOrEqual(blockW + 1e-9);
      expect(p.y - p.cell.ascent).toBeGreaterThanOrEqual(-1e-9);
      expect(p.y + p.cell.descent).toBeLessThanOrEqual(blockH + 1e-9);
    }
  });

  // ── paragraph vertical type: box wrap + paragraph attributes ──
  // A vertical paragraph frame wraps at the box HEIGHT (a column holds as many
  // glyphs as the leading fits) and the next column starts to its left.
  const para = (patch: Partial<TextSpec> = {}) => vspec({ kind: "paragraph", ...patch });

  it("wraps a paragraph column at the box height and steps left", () => {
    const cells = Array.from({ length: 5 }, () => cell("A", 10));
    const { placements, blockW, blockH } = layoutVertical(cells, para({ boxH: 40 }));
    expect(blockH).toBe(40);            // the frame, not the natural run
    const xs = [...new Set(placements.map((p) => Math.round(p.x * 1e6) / 1e6))];
    expect(xs).toHaveLength(3);          // floor(40 / 19.2) = 2 glyphs per column
    expect(xs[0]).toBeCloseTo(blockW - COL_W + (COL_W - 10) / 2, 6);
    expect(xs[1]).toBeCloseTo(blockW - 2 * COL_W + (COL_W - 10) / 2, 6);
    expect(placements.map((p) => p.y)).toEqual(
      [12.8, AUTO_LH + 12.8, 12.8, AUTO_LH + 12.8, 12.8],
    );
  });

  it("breaks a column after a space rather than mid-word", () => {
    const cells = [cell("A", 10), cell(" ", 6, { isSpace: true }), cell("B", 10), cell("C", 10)];
    // boxH 60 fits 3 glyphs; the break still lands after the space, so "BC" holds.
    const { placements } = layoutVertical(cells, para({ boxH: 60 }));
    // every cell is centred on its column, so the column is its ink midpoint
    const col = (i: number) => placements[i].x + placements[i].cell.advance / 2;
    expect(col(1)).toBeCloseTo(col(0), 6);   // the space stays with "A"
    expect(col(3)).toBeCloseTo(col(2), 6);   // "BC" is not split
    expect(col(2)).toBeLessThan(col(0));     // …in the next column to the left
  });

  it("keeps a No Break run in one column even when it exceeds the height", () => {
    const cells = [
      cell("A", 10, { noBreak: true }),
      cell("B", 10, { noBreak: true }),
      cell("C", 10, { noBreak: true }),
      cell("D", 10),
    ];
    const { placements } = layoutVertical(cells, para({ boxH: 40 }));
    const col = (i: number) => placements[i].x + placements[i].cell.advance / 2;
    expect(col(1)).toBeCloseTo(col(0), 6);
    expect(col(2)).toBeCloseTo(col(0), 6);
    expect(col(3)).toBeLessThan(col(0));
  });

  it("keeps a fixed paragraph width when wrapped columns overflow it", () => {
    const cells = Array.from({ length: 5 }, () => cell("A", 10));
    expect(layoutVertical(cells, para({ boxW: 20, boxH: 40 })).blockW).toBe(20);
  });

  it("aligns the glyph run down the column (left = top, right = bottom)", () => {
    const cells = [cell("A", 10), cell("B", 10), cell("C", 10), brk(), cell("D", 10)];
    const top = layoutVertical(cells, vspec());
    const mid = layoutVertical(cells, vspec({ align: "center" }));
    const bot = layoutVertical(cells, vspec({ align: "right" }));
    expect(top.placements[3].y).toBeCloseTo(12.8, 6);
    expect(mid.placements[3].y).toBeCloseTo(AUTO_LH + 12.8, 6);
    expect(bot.placements[3].y).toBeCloseTo(2 * AUTO_LH + 12.8, 6);
    // the three-glyph column fills the block either way, so it never moves
    expect(mid.placements[0].y).toBeCloseTo(top.placements[0].y, 6);
    expect(bot.placements[0].y).toBeCloseTo(top.placements[0].y, 6);
  });

  it("spreads a justified column's slack between its glyphs", () => {
    const cells = [cell("A", 10), cell("B", 10), cell("C", 10)];
    const { placements } = layoutVertical(cells, para({ boxH: 100, align: "justifyAll" }));
    const step = (100 - 3 * AUTO_LH) / 2 + AUTO_LH;
    expect(placements[1].y - placements[0].y).toBeCloseTo(step, 6);
    expect(placements[2].y - placements[1].y).toBeCloseTo(step, 6);
  });

  it("indents inset the top of the column, firstIndent only its first one", () => {
    const cells = Array.from({ length: 3 }, () => cell("A", 10));
    const { placements } = layoutVertical(cells, para({ boxH: 60, leftIndent: 5, firstIndent: 20 }));
    // capFirst = floor((60-5-20)/19.2) = 1, capRest = floor(55/19.2) = 2
    expect(placements[0].y).toBeCloseTo(25 + 12.8, 6);
    expect(placements[1].y).toBeCloseTo(5 + 12.8, 6);
    expect(placements[1].x).toBeLessThan(placements[0].x);
  });

  it("includes vertical indents in an auto-height paragraph frame", () => {
    const cells = [cell("A", 10), cell("B", 10)];
    const { placements, blockH } = layoutVertical(cells, para({ boxH: 0, leftIndent: 5, rightIndent: 7, firstIndent: 10 }));
    expect(blockH).toBeCloseTo(5 + 10 + 2 * AUTO_LH + 7, 6);
    expect(placements.at(-1)!.y + placements.at(-1)!.cell.descent).toBeLessThanOrEqual(blockH);
  });

  it("spaceBefore opens a gap between one paragraph's columns and the next", () => {
    const cells = [cell("A", 10), brk(), cell("B", 10)];
    const tight = layoutVertical(cells, vspec());
    const spaced = layoutVertical(cells, vspec({ spaceBefore: 10 }));
    expect(spaced.blockW).toBeCloseTo(tight.blockW + 10, 6);
    expect(spaced.placements[0].x - spaced.placements[1].x).toBeCloseTo(COL_W + 10, 6);
    expect(tight.placements[0].x - tight.placements[1].x).toBeCloseTo(COL_W, 6);
  });
});


describe("Type glyph-outline layout", () => {
  it("preserves numeric weights and run-local axes in horizontal, vertical and path outlines", () => {
    const s = defaultSpec("", { font: "Variable", runs: [
      { text: "A", weight: 500, bold: true, axes: { wght: 999, wdth: 87.5, slnt: -8.25 } },
      { text: "B", weight: 900, axes: { wdth: 110, slnt: -2 } },
      { text: "C", weight: 900, axes: { wdth: 75, slnt: 0 } },
    ] });
    for (const patch of [{}, { vertical: true }, { path: [10, 20, 510, 20] }]) {
      let items: any[] = [];
      typeOutlineScene({ ...s, ...patch }, (json) => { items = JSON.parse(json).layers[0].items; return json; });
      expect(items.map((i) => [i.text, i.fontWeight, i.fontVariationSettings])).toEqual([
        ["A", 500, '"wght" 500, "slnt" -8.25, "wdth" 87.5'],
        ["B", 900, '"wght" 900, "slnt" -2, "wdth" 110'],
        ["C", 900, '"wght" 900, "slnt" 0, "wdth" 75'],
      ]);
    }
  });

  it("preserves mixed run faces, sizes, colors and vertical/path positions", () => {
    const s = defaultSpec("", { ax: 10, ay: 20, runs: [
      { text: "A", font: "One", size: 20, color: [200, 0, 0, 255] },
      { text: "B", font: "Two", size: 40, bold: true, italic: true, color: [0, 0, 200, 128] },
    ] });
    const capture = (value: TextSpec) => {
      let scene: any;
      typeOutlineScene(value, (json) => { scene = JSON.parse(json); return json; });
      return scene.layers[0].items;
    };
    const horizontal = capture(s);
    expect(horizontal.map((i: any) => [i.fontFamily, i.fontSize, i.fontWeight, i.fontStyle]))
      .toEqual([["One", 20, 400, "normal"], ["Two", 40, 700, "italic"]]);
    expect(horizontal[1].fill.color).toEqual({ r: 0, g: 0, b: 200, a: 128 / 255 });
    expect(horizontal[1].transform.e).toBeGreaterThan(horizontal[0].transform.e);
    const vertical = capture({ ...s, vertical: true });
    expect(vertical[1].transform.f).toBeGreaterThan(vertical[0].transform.f);
    const path = capture({ ...s, path: [10, 20, 10, 220] });
    expect(path[0].transform.a).toBeCloseTo(0);
    expect(path[0].transform.b).toBeCloseTo(1);
    expect(path[1].transform.f).toBeGreaterThan(path[0].transform.f);
  });

  it("outlines the same contextual runs painted by the platform, including RTL", () => {
    for (const direction of ["ltr", "rtl"] as const) {
      const s = defaultSpec(direction === "rtl" ? "مرحبا" : "office", { direction });
      paintedText.length = 0;
      rasterizeSpec(s);
      let items: any[] = [];
      typeOutlineScene(s, (json) => { items = JSON.parse(json).layers[0].items; return json; });
      expect(items.map((i) => i.text)).toEqual(paintedText);
      expect(items).toHaveLength(1);
      expect(items[0].direction).toBe(direction);
    }
  });

  it("places adjusted Arabic diacritics exactly like drawCellText", () => {
    const s = defaultSpec("بَ", { diacriticX: 3, diacriticY: -4, hScale: 2, vScale: 0.5 });
    let items: any[] = [];
    typeOutlineScene(s, (json) => { items = JSON.parse(json).layers[0].items; return json; });
    expect(items.map((i) => i.text)).toEqual(["ب", "َ"]);
    expect(items[1].transform.e - items[0].transform.e).toBe(6);
    expect(items[1].transform.f - items[0].transform.f).toBe(-2);
  });

  it("warps actual cubic handles through the same envelope map", () => {
    const s = defaultSpec("C", { size: 40, ax: 10, ay: 20 });
    const curve = JSON.stringify({ layers: [{ items: [{ subpaths: [{ closed: true, anchors: [
      { point: { x: 10, y: 20 }, handleOut: { x: 20, y: -10 } },
      { point: { x: 30, y: 60 }, handleIn: { x: 20, y: -10 } },
      { point: { x: 10, y: 60 } },
    ] }] }] }] });
    expect(typeOutlineScene(s, () => curve)).toBe(curve);
    for (const orient of ["h", "v"] as const) {
      const result = JSON.parse(typeOutlineScene({ ...s, warp: { style: "arc", bend: 0.6, h: 0, v: 0, orient } }, () => curve));
      const anchors = result.layers[0].items[0].subpaths[0].anchors;
      expect(anchors.length).toBeGreaterThan(3);
      expect(anchors[0].point).not.toEqual({ x: 10, y: 20 });
      expect(anchors.some((a: any) => a.handleOut?.x && a.handleOut?.y)).toBe(true);
      expect(JSON.stringify(anchors)).not.toMatch(/null/);
    }
  });
});
