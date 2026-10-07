// Unit tests for the waveform display geometry. Engine-free (node); the
// cols×rows density grid itself is produced + tested in packages/engine
// (waveform_tests), and the panel toggle is covered by e2e/vectorscope.spec.ts.
// Here we only pin the pure display math (the IRE graticule + parade layout).
import { describe, it, expect } from "vitest";
import { drawWaveform, drawWaveformParade, drawWaveformRgb, ireLines, paradePanel } from "./waveform";

describe("ireLines", () => {
  it("returns the five standard IRE graticule levels", () => {
    expect(ireLines().map((l) => l.ire)).toEqual([0, 25, 50, 75, 100]);
  });

  it("places 100 IRE (white) at the top and 0 IRE (black) at the bottom", () => {
    const byIre = Object.fromEntries(ireLines().map((l) => [l.ire, l.yFrac]));
    expect(byIre[100]).toBeCloseTo(0, 6); // white at the top (yFrac 0)
    expect(byIre[0]).toBeCloseTo(1, 6); // black at the bottom (yFrac 1)
    expect(byIre[50]).toBeCloseTo(0.5, 6);
  });

  it("descends monotonically down the scope as IRE decreases", () => {
    const lines = ireLines();
    for (let i = 1; i < lines.length; i++) {
      expect(lines[i].yFrac).toBeLessThan(lines[i - 1].yFrac);
    }
  });
});

// ── RGB Parade ───────────────────────────────────────────────────────
// Recording 2D context: enough surface for the draw calls, keeping every
// filled rect with the fillStyle in force at the time. ponytail: not a canvas
// polyfill — swap in `canvas`/jsdom only if a test ever needs real pixels.
type Rect = { x: number; w: number; style: string };

function recorder() {
  const rects: Rect[] = [];
  const ctx = {
    fillStyle: "",
    strokeStyle: "",
    lineWidth: 1,
    font: "",
    textBaseline: "",
    globalCompositeOperation: "source-over",
    clearRect: () => {},
    fillRect: (x: number, _y: number, w: number, _h: number) => rects.push({ x, w, style: ctx.fillStyle }),
    beginPath: () => {},
    moveTo: () => {},
    lineTo: () => {},
    stroke: () => {},
    fillText: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, rects };
}

/** Three stacked cols×rows planes where channel `lit` is fully on and the
 *  others are empty (the shape `Engine.waveform_rgb` returns). */
function planes(cols: number, rows: number, lit: number) {
  const g = new Float32Array(cols * rows * 3);
  g.fill(1, lit * cols * rows, (lit + 1) * cols * rows);
  return g;
}

const traceRects = (rects: Rect[]) => rects.filter((r) => r.style.startsWith("rgba("));

// ── IRE graticule (#212) ─────────────────────────────────────────────
/** Recording context that keeps the y of every stroked horizontal line. */
function lineRecorder() {
  const ys: number[] = [];
  const ctx = {
    fillStyle: "", strokeStyle: "", lineWidth: 1, font: "", textBaseline: "",
    globalCompositeOperation: "source-over",
    clearRect: () => {},
    fillRect: () => {},
    beginPath: () => {},
    moveTo: (_x: number, y: number) => ys.push(y),
    lineTo: () => {},
    stroke: () => {},
    fillText: () => {},
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, ys };
}

describe("IRE graticule", () => {
  it("strokes all five lines inside the canvas, 0 IRE included", () => {
    const h = 132;
    for (const draw of [drawWaveform, drawWaveformRgb]) {
      const { ctx, ys } = lineRecorder();
      draw(ctx, new Float32Array(4 * 3), 2, 2, 240, h);
      expect(ys.length).toBe(5);
      for (const y of ys) {
        expect(y).toBeGreaterThanOrEqual(0);
        expect(y).toBeLessThan(h); // 0 IRE used to land at h + 0.5 → never drawn
      }
      // 0 IRE (black) is the bottom-most line and sits on the last row
      expect(Math.max(...ys)).toBeCloseTo(h - 0.5, 6);
    }
  });
});

describe("paradePanel", () => {
  it("tiles the full width in three gap-free panels", () => {
    const w = 241; // deliberately not divisible by 3
    const p = [0, 1, 2].map((c) => paradePanel(c, w));
    expect(p[0].x).toBe(0);
    expect(p[0].x + p[0].width).toBe(p[1].x);
    expect(p[1].x + p[1].width).toBe(p[2].x);
    expect(p[2].x + p[2].width).toBe(w);
    for (const { x, width } of p) {
      expect(Number.isInteger(x)).toBe(true); // whole-pixel dividers
      expect(width).toBeGreaterThan(0);
    }
  });
});

describe("drawWaveformParade", () => {
  it("confines each channel's trace to its own third", () => {
    const cols = 8, rows = 4, w = 240, h = 120;
    for (const c of [0, 1, 2]) {
      const { ctx, rects } = recorder();
      drawWaveformParade(ctx, planes(cols, rows, c), cols, rows, w, h);
      const panel = paradePanel(c, w);
      const drawn = traceRects(rects);
      expect(drawn.length).toBe(cols * rows); // every lit cell painted once
      for (const r of drawn) {
        expect(r.x).toBeGreaterThanOrEqual(panel.x);
        expect(r.x + r.w).toBeLessThanOrEqual(panel.x + panel.width); // never bleeds into the next panel
      }
    }
  });

  it("separates R/G/B by colour into left/middle/right, where the overlay stacks them", () => {
    const cols = 8, rows = 4, w = 240, h = 120;
    const all = new Float32Array(cols * rows * 3).fill(1);
    const parade = recorder();
    drawWaveformParade(parade.ctx, all, cols, rows, w, h);
    // each trace colour occupies exactly its own panel
    for (const [c, hue] of [[0, "255,90,90"], [1, "90,235,120"], [2, "100,150,255"]] as const) {
      const panel = paradePanel(c, w);
      const own = parade.rects.filter((r) => r.style.startsWith(`rgba(${hue}`));
      expect(own.length).toBe(cols * rows);
      expect(Math.min(...own.map((r) => r.x))).toBeGreaterThanOrEqual(panel.x);
      expect(Math.max(...own.map((r) => r.x))).toBeLessThan(panel.x + panel.width);
    }
    // the overlaid RGB waveform, in contrast, paints all three over the full width
    const overlay = recorder();
    drawWaveformRgb(overlay.ctx, all, cols, rows, w, h);
    const red = overlay.rects.filter((r) => r.style.startsWith("rgba(255,90,90"));
    expect(Math.max(...red.map((r) => r.x))).toBeGreaterThan(paradePanel(2, w).x);
  });
});
