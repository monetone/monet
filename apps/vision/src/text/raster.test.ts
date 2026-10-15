import { afterAll, describe, expect, it } from "vitest";
import { effectsPad, layoutTypeOutline, rasterizeSpec, type Cell } from "./raster";
import { defaultSpec } from "./spec";

// Canvas OpenType features (#16). WebKit ignores `ctx.font = s` when `s` is the
// string already stored on the context, so the context never re-reads the canvas
// element's computed `font-feature-settings`: a per-glyph alternate never turns
// ON, and a featured cell leaks its tags onto every feature-free cell measured
// or painted after it (the metrics scratch canvas is a module singleton, so that
// leak crosses layers). The fakes below reproduce exactly that setter behaviour:
// features are re-resolved only when the stored font string actually changes.

class FakeHost {
  style = { cssText: "" };
  setAttribute() {}
  appendChild(child: { parentNode: unknown }) { child.parentNode = this; }
}

const paintOps: unknown[][] = [];

class FakeCtx {
  fontKerning = "normal";
  fillStyle = "";
  textBaseline = "";
  private stored = "";
  private drawn = "";
  constructor(private el: FakeCanvas) {}
  get canvas() { return this.el; }
  get font() { return this.stored; }
  set font(value: string) {
    if (value === this.stored) return;      // WebKit's short-circuit …
    this.stored = value;
    this.el.resolved = this.el.feat;        // … the only point features re-resolve
  }
  clearRect() {}
  save() { paintOps.push(["save"]); }
  restore() { paintOps.push(["restore"]); }
  translate(x: number, y: number) { paintOps.push(["translate", x, y]); }
  rotate(angle: number) { paintOps.push(["rotate", angle]); }
  scale(x: number, y: number) { paintOps.push(["scale", x, y]); }
  transform(a: number, b: number, c: number, d: number, e: number, f: number) {
    paintOps.push(["transform", a, b, c, d, e, f]);
  }
  fillRect(x: number, y: number, w: number, h: number) { paintOps.push(["fillRect", x, y, w, h]); }
  strokeText(ch: string, x: number, y: number) { paintOps.push(["strokeText", ch, x, y]); }
  fillText(ch: string) { this.drawn = ch; paintOps.push(["fillText", ch]); }
  measureText(t: string) { return { width: t.length }; }
  getImageData(_x: number, _y: number, w: number, h: number) {
    // The painted glyph is a function of the tags the CONTEXT resolved, not of
    // the ones sitting on the element.
    const data = new Uint8ClampedArray(w * h * 4);
    const key = `${this.el.resolved}|${this.drawn}`;
    for (let i = 0; i < key.length; i++) data[i * 4 + 3] = key.charCodeAt(i) & 255;
    return { data };
  }
}

class FakeCanvas {
  width = 0;
  height = 0;
  feat = "";      // the element's font-feature-settings
  resolved = "";  // what the context last resolved them to
  parentNode: unknown = null;
  offsetWidth = 0;
  style = {
    setProperty: (k: string, v: string) => { if (k === "font-feature-settings") this.feat = v === "normal" ? "" : v; },
  };
  private ctx = new FakeCtx(this);
  getContext() { return this.ctx; }
}

const g = globalThis as unknown as Record<string, unknown>;
g.document = { body: new FakeHost(), createElement: (tag: string) => (tag === "canvas" ? new FakeCanvas() : new FakeHost()) };
g.getComputedStyle = () => ({ getPropertyValue: () => "" });
afterAll(() => { delete g.document; delete g.getComputedStyle; });

describe("glyphAlternates", () => {
  it("re-resolves the feature tags in both directions on one probe canvas", async () => {
    const { glyphAlternates } = await import("./raster");
    // ON: the swash probe repaints "R" with a font string the context already
    // resolved once, feature-free — it has to pick the new tag up anyway.
    expect(glyphAlternates("Zapfino", "R", ["swsh"])).toEqual(["swsh"]);
    // OFF: "S" is probed feature-free first, on the canvas the previous swash
    // probe left mounted. A stale resolution makes its baseline swashed too, so
    // the alternate compares equal and silently disappears.
    expect(glyphAlternates("Zapfino", "S", ["swsh"])).toEqual(["swsh"]);
  });
});

// ── Faux-italic ink overhang in the bitmap padding (#17) ───────────
// Faux italic paints with a fixed shear, so its ink leaves the advance box that
// blockW is measured from. The pad is the only budget for that, and it used to
// be a flat 4px — at 64px roughly 11px of the last glyph's top-right was cut off.
describe("effectsPad", () => {
  const cell = (patch: Partial<Cell>): Cell =>
    ({ fauxItalic: false, ascent: 0, descent: 0, hScale: 1, vScale: 1, ...patch }) as Cell;
  // 64px type: ascent 51.2, descent 12.8 (the metrics fallback in buildCells).
  const italic64 = cell({ fauxItalic: true, ascent: 51.2, descent: 12.8 });

  it("stays at the flat 4px base when nothing shears the ink", () => {
    expect(effectsPad(defaultSpec("Nd"))).toBe(4);
    expect(effectsPad(defaultSpec("Nd"), [cell({ ascent: 51.2, descent: 12.8 })])).toBe(4);
  });

  it("budgets 0.21 x ascent for a faux-italic run", () => {
    expect(effectsPad(defaultSpec("Nd"), [italic64])).toBe(Math.ceil(4 + 0.21 * 51.2)); // 15, was 4
  });

  it("scales the overhang with the cell's horizontal/vertical scale", () => {
    const wide = cell({ fauxItalic: true, ascent: 51.2, descent: 12.8, hScale: 2 });
    expect(effectsPad(defaultSpec("Nd"), [wide])).toBe(Math.ceil(4 + 0.21 * 51.2 * 2));
  });

  it("takes the widest sheared cell and adds it on top of the effect pads", () => {
    const small = cell({ fauxItalic: true, ascent: 12, descent: 3 });
    const spec = defaultSpec("Nd", { stroke: { width: 20, color: [0, 0, 0, 255] } });
    expect(effectsPad(spec, [small, italic64])).toBe(Math.ceil(20 * 2 + 2 + 0.21 * 51.2));
  });
});

describe("type on a path", () => {
  it("centres the glyph before scaling, and the outline keeps the run's scale and baseline shift", () => {
    const spec = defaultSpec("A", {
      path: [0, 0, 400, 0],
      hScale: 2,
      vScale: 3,
      size: 16,
      shadow: { color: [0, 0, 0, 128], blur: 2, dx: 1, dy: 1 },
      stroke: { width: 1, color: [255, 0, 0, 255] },
      runs: [{ text: "A", hScale: 2, vScale: 3, baseline: -40, fauxItalic: true, underline: true, strike: true }],
    });
    const outline = layoutTypeOutline(spec);
    const cell = outline.placements[0].cell;
    expect(outline.onPath).toBe(true);
    expect(cell.hScale).toBe(2);
    expect(cell.vScale).toBe(3);
    expect(cell.fauxItalic).toBe(true);
    expect(cell.baseShift).toBeCloseTo(-40, 5);

    paintOps.length = 0;
    rasterizeSpec(spec);
    const scaleAt = paintOps.findIndex((op) => op[0] === "scale" && op[1] === 2 && op[2] === 3);
    expect(scaleAt).toBeGreaterThan(0);
    const centre = [...paintOps.slice(0, scaleAt)].reverse().find((op) => op[0] === "translate");
    expect(centre?.slice(1)).toEqual([-cell.advance / 2, -cell.baseShift]);
    expect(paintOps[scaleAt + 1]).toEqual(["transform", 1, 0, -0.21, 1, 0, 0]);
    expect(paintOps.some((op) => op[0] === "fillRect")).toBe(true);
  });
});
