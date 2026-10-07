// ─────────────────────────────────────────────────────────────
// ui/color-convert.test — Gradient ⇄ Monet conversion (Gradient panel)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator Gradient panel — a gradient has a TYPE
// (linear/radial), an ANGLE, and an ordered list of color STOPS. The panel binds
// the engine gradient to Monet's GradientEditor via these converters, so the
// angle field, type, and stops must round-trip.

import { describe, it, expect } from "vitest";
import { gradientToMonet, monetToGradient, hsvToRgba, colorValueToRgba } from "./color-convert";
import { rgba, type Gradient } from "../engine";
import type { GradientValue, HSV } from "@monet-ui/monet-react";

const rgb = (c: { r: number; g: number; b: number }) => ({ r: Math.round(c.r), g: Math.round(c.g), b: Math.round(c.b) });

describe("hsvToRgba (Color panel)", () => {
  it("converts primary HSV colors to RGB", () => {
    expect(rgb(hsvToRgba({ h: 0, s: 1, v: 1 } as HSV))).toEqual({ r: 255, g: 0, b: 0 }); // red
    expect(rgb(hsvToRgba({ h: 120, s: 1, v: 1 } as HSV))).toEqual({ r: 0, g: 255, b: 0 }); // green
    expect(rgb(hsvToRgba({ h: 240, s: 1, v: 1 } as HSV))).toEqual({ r: 0, g: 0, b: 255 }); // blue
    expect(rgb(hsvToRgba({ h: 0, s: 0, v: 1 } as HSV))).toEqual({ r: 255, g: 255, b: 255 }); // white
    expect(rgb(hsvToRgba({ h: 0, s: 0, v: 0 } as HSV))).toEqual({ r: 0, g: 0, b: 0 }); // black
  });

  it("carries alpha (default 1)", () => {
    expect(hsvToRgba({ h: 0, s: 1, v: 1 } as HSV).a).toBe(1);
    expect(hsvToRgba({ h: 0, s: 1, v: 1, a: 0.5 } as HSV).a).toBe(0.5);
  });
});

describe("colorValueToRgba", () => {
  it("parses a hex string", () => {
    expect(rgb(colorValueToRgba("#00ff00"))).toEqual({ r: 0, g: 255, b: 0 });
    expect(rgb(colorValueToRgba("#1e3a5f"))).toEqual({ r: 30, g: 58, b: 95 });
  });

  it("converts an HSV object", () => {
    expect(rgb(colorValueToRgba({ h: 240, s: 1, v: 1 }))).toEqual({ r: 0, g: 0, b: 255 });
  });
});

const mkGrad = (over: Partial<Gradient> = {}): Gradient => ({
  type: "linear",
  stops: [{ offset: 0, color: rgba(255, 0, 0) }, { offset: 1, color: rgba(0, 0, 255) }],
  x1: 0, y1: 0.5, x2: 1, y2: 0.5, cx: 0.5, cy: 0.5, r: 0.5,
  ...over,
});
const mkMonet = (over: Partial<GradientValue> = {}): GradientValue => ({
  type: "linear",
  angle: 0,
  stops: [{ id: "a", offset: 0, color: "#ff0000" }, { id: "b", offset: 1, color: "#0000ff" }],
  ...over,
});

describe("gradientToMonet", () => {
  it("maps type, a horizontal axis → angle 0, and the stops", () => {
    const m = gradientToMonet(mkGrad());
    expect(m.type).toBe("linear");
    expect(m.angle).toBe(0); // (0,0.5)→(1,0.5) is horizontal
    expect(m.stops).toHaveLength(2);
    expect(m.stops[0].offset).toBe(0);
    expect(m.stops[1].offset).toBe(1);
  });

  it("maps a vertical axis → angle 90", () => {
    expect(gradientToMonet(mkGrad({ x1: 0.5, y1: 0, x2: 0.5, y2: 1 })).angle).toBe(90);
  });
});

describe("monetToGradient", () => {
  it("angle 0 → horizontal axis; angle 90 → vertical axis", () => {
    const g0 = monetToGradient(mkMonet());
    expect(g0.x1).toBeCloseTo(0, 6);
    expect(g0.y1).toBeCloseTo(0.5, 6);
    expect(g0.x2).toBeCloseTo(1, 6);
    expect(g0.y2).toBeCloseTo(0.5, 6);
    const g90 = monetToGradient(mkMonet({ angle: 90 }));
    expect(g90.x1).toBeCloseTo(0.5, 6);
    expect(g90.y1).toBeCloseTo(0, 6);
    expect(g90.x2).toBeCloseTo(0.5, 6);
    expect(g90.y2).toBeCloseTo(1, 6);
  });

  it("sorts stops by offset and converts hex → rgba", () => {
    const g = monetToGradient(mkMonet({ stops: [{ id: "a", offset: 1, color: "#0000ff" }, { id: "b", offset: 0, color: "#ff0000" }] }));
    expect(g.stops.map((s) => s.offset)).toEqual([0, 1]); // re-sorted
    expect(g.stops[0].color.r).toBe(255); // red first
    expect(g.stops[1].color.b).toBe(255); // blue last
  });
});

describe("gradient conversion round-trip", () => {
  it("preserves type, stops (offset + color) and angle", () => {
    const g = mkGrad({
      type: "radial",
      stops: [
        { offset: 0, color: rgba(255, 0, 0) },
        { offset: 0.5, color: rgba(0, 255, 0) },
        { offset: 1, color: rgba(0, 0, 255) },
      ],
    });
    const g2 = monetToGradient(gradientToMonet(g));
    expect(g2.type).toBe("radial");
    expect(g2.stops).toHaveLength(3);
    g.stops.forEach((s, i) => {
      expect(g2.stops[i].offset).toBeCloseTo(s.offset, 6);
      expect(g2.stops[i].color.r).toBe(s.color.r);
      expect(g2.stops[i].color.g).toBe(s.color.g);
      expect(g2.stops[i].color.b).toBe(s.color.b);
    });
    const angle = Math.round((Math.atan2(g2.y2 - g2.y1, g2.x2 - g2.x1) * 180) / Math.PI);
    expect(angle).toBe(0); // horizontal preserved
  });
});
