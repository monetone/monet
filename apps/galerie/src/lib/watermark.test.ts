// watermark spec — the pure placement math behind the Simple text watermark.

import { describe, expect, it } from "vitest";

import { fontPx, watermarkLayout, type WatermarkAnchor } from "./watermark";

// 200×100 canvas, 40×10 text box, inset 5% of the shorter side (100) = 5px.
const CW = 200;
const CH = 100;
const TW = 40;
const TH = 10;
const layout = (anchor: WatermarkAnchor, insetPct = 5) => watermarkLayout(CW, CH, TW, TH, { anchor, insetPct });

describe("watermarkLayout", () => {
  it("anchors each corner with the inset", () => {
    expect(layout("top-left")).toEqual({ x: 5, y: 5 });
    expect(layout("top-right")).toEqual({ x: CW - TW - 5, y: 5 }); // 155,5
    expect(layout("bottom-left")).toEqual({ x: 5, y: CH - TH - 5 }); // 5,85
    expect(layout("bottom-right")).toEqual({ x: CW - TW - 5, y: CH - TH - 5 }); // 155,85
  });

  it("centers on the center anchors", () => {
    expect(layout("center")).toEqual({ x: (CW - TW) / 2, y: (CH - TH) / 2 }); // 80,45
    expect(layout("top-center")).toEqual({ x: (CW - TW) / 2, y: 5 }); // 80,5
    expect(layout("center-left")).toEqual({ x: 5, y: (CH - TH) / 2 }); // 5,45
    expect(layout("bottom-center")).toEqual({ x: (CW - TW) / 2, y: CH - TH - 5 }); // 80,85
    expect(layout("center-right")).toEqual({ x: CW - TW - 5, y: (CH - TH) / 2 }); // 155,45
  });

  it("scales the inset with insetPct (shorter side)", () => {
    // Pins the single-axis basis: on this 200×100 canvas a per-axis split would
    // make x 20 (10% of cw), not 10. See the ponytail note in watermark.ts.
    expect(layout("top-left", 10)).toEqual({ x: 10, y: 10 }); // 10% of 100
    expect(layout("top-left", 0)).toEqual({ x: 0, y: 0 });
  });

  it("clamps a box larger than the canvas to on-canvas (never negative)", () => {
    const big = watermarkLayout(50, 50, 200, 200, { anchor: "bottom-right", insetPct: 5 });
    expect(big.x).toBe(0);
    expect(big.y).toBe(0);
  });

  it("clamps so a corner box never overflows past the far edge", () => {
    // Wide text, right anchor, big inset would push x negative → clamp to 0.
    const wide = watermarkLayout(100, 100, 95, 10, { anchor: "top-right", insetPct: 20 });
    expect(wide.x).toBeGreaterThanOrEqual(0);
    expect(wide.x).toBeLessThanOrEqual(100 - 95);
  });

  it("pulls a start anchor back to the far edge when the inset exceeds the free gap", () => {
    // X-axis reducing clamp: wide box, top-left, inset 20 > free gap 5 → x=5 (not 20).
    expect(watermarkLayout(100, 100, 95, 10, { anchor: "top-left", insetPct: 20 })).toEqual({ x: 5, y: 20 });
    // Y-axis reducing clamp: tall box, top-left, inset 20 > free gap 5 → y=5 (not 20).
    expect(watermarkLayout(100, 100, 10, 95, { anchor: "top-left", insetPct: 20 })).toEqual({ x: 20, y: 5 });
  });
});

describe("fontPx", () => {
  it("scales with output height", () => {
    expect(fontPx(1000, 5)).toBe(50);
    expect(fontPx(2000, 5)).toBe(100);
  });
  it("never drops below the 8px floor", () => {
    expect(fontPx(100, 1)).toBe(8); // 1px rounded up to floor
  });
});
