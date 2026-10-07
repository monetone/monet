// ─────────────────────────────────────────────────────────────
// gradientInterop.test — Vision ramp ⇄ the shared cross-app gradient model
// ─────────────────────────────────────────────────────────────
// One gradient model (`GradientValue`, @monet-ui/monet-react) is shared with
// Artisan, whose vector gradient is strictly richer (radial centre/radius, focal
// point, spread, per-stop midpoints). Vision has no UI for that richness, so it
// must act as a lossless courier: an Artisan gradient dropped into Vision and
// handed back has to come out byte-identical, otherwise a gradient can only cross
// apps as flattened artwork.

import { describe, it, expect } from "vitest";
import type { GradientValue } from "@monet-ui/monet-react";
import { gradientForeignOf, stopFromHex, stopHex, toGradientValue } from "./gradientPresets";
import type { GradientStop } from "./store";

const stop = (pos: number, r: number, g: number, b: number, a = 255, midpoint?: number): GradientStop =>
  midpoint == null ? { pos, r, g, b, a } : { pos, r, g, b, a, midpoint };

// A gradient only Artisan can author: radial, off-centre, focal point, repeating,
// with a shifted midpoint on the first gap.
const ARTISAN: GradientValue = {
  type: "radial",
  angle: 45,
  stops: [
    { id: "s0", offset: 0, color: "#ff0000ff", midpoint: 0.25 },
    { id: "s1", offset: 0.5, color: "#00ff0080" },
    { id: "s2", offset: 1, color: "#0000ffff" },
  ],
  cx: 0.3,
  cy: 0.7,
  r: 0.9,
  fx: 0.2,
  fy: 0.6,
  spread: "repeat",
};

describe("stop hex codec", () => {
  it("round-trips rgba through #rrggbbaa", () => {
    const s = stop(0.25, 18, 200, 7, 128);
    expect(stopHex(s)).toBe("#12c80780");
    expect(stopFromHex(0.25, stopHex(s))).toEqual(s);
  });

  it("expands short form and defaults a missing alpha to opaque", () => {
    expect(stopFromHex(0, "#f00")).toEqual({ pos: 0, r: 255, g: 0, b: 0, a: 255 });
    expect(stopFromHex(1, "#1e3a5f")).toEqual({ pos: 1, r: 30, g: 58, b: 95, a: 255 });
  });

  it("reads malformed components as 0 instead of throwing", () => {
    expect(stopFromHex(0, "#zzzzzz")).toEqual({ pos: 0, r: 0, g: 0, b: 0, a: 255 });
  });
});

describe("toGradientValue", () => {
  it("emits hex stops and re-emits the parked foreign geometry", () => {
    const gv = toGradientValue([stop(0, 0, 0, 0), stop(1, 255, 255, 255)], "radial", false, { angle: 45, cx: 0.3, spread: "reflect" });
    expect(gv.type).toBe("radial");
    expect(gv.angle).toBe(45);
    expect(gv.cx).toBe(0.3);
    expect(gv.spread).toBe("reflect");
    expect(gv.stops.map((s) => s.color)).toEqual(["#000000ff", "#ffffffff"]);
  });

  it("bakes Reverse into the stop order, mirroring positions and midpoints", () => {
    const gv = toGradientValue([stop(0, 255, 0, 0, 255, 0.3), stop(0.25, 0, 255, 0)], "linear", true);
    expect(gv.stops.map((s) => s.offset)).toEqual([0.75, 1]);
    expect(gv.stops.map((s) => s.color)).toEqual(["#00ff00ff", "#ff0000ff"]);
    // 0.3 from the left of the gap is 0.7 from the right, and it now hangs off the
    // stop that became the gap's left edge.
    expect(gv.stops[0].midpoint).toBeCloseTo(0.7, 6);
    expect(gv.stops[1].midpoint).toBeUndefined();
  });

  it("leaves the ramp alone when Reverse is off", () => {
    const stops = [stop(0, 1, 2, 3, 4, 0.3), stop(1, 5, 6, 7, 8)];
    const gv = toGradientValue(stops, "linear");
    expect(gv.stops.map((s) => s.offset)).toEqual([0, 1]);
    expect(gv.stops[0].midpoint).toBe(0.3);
  });
});

describe("gradientForeignOf", () => {
  it("keeps only what Vision cannot edit, and only when present", () => {
    expect(gradientForeignOf(ARTISAN)).toEqual({ angle: 45, cx: 0.3, cy: 0.7, r: 0.9, fx: 0.2, fy: 0.6, spread: "repeat" });
    expect(gradientForeignOf({ type: "linear", angle: 0, stops: [] })).toEqual({ angle: 0 });
  });
});

describe("Artisan → Vision → Artisan courier round trip", () => {
  // What Store.setGradientValue does to the ramp (kept in step with it; the store
  // itself pulls in the WASM engine, so the pure halves are exercised here).
  const ingest = (gv: GradientValue) =>
    [...gv.stops].sort((a, b) => a.offset - b.offset).map((s) => {
      const st = stopFromHex(s.offset, s.color as string);
      return s.midpoint == null ? st : { ...st, midpoint: s.midpoint };
    });

  it("returns every stop and every unmodelled knob unchanged", () => {
    const stops = ingest(ARTISAN);
    const out = toGradientValue(stops, ARTISAN.type, false, gradientForeignOf(ARTISAN));
    expect(out.stops.map((s) => ({ offset: s.offset, color: s.color, midpoint: s.midpoint }))).toEqual(
      ARTISAN.stops.map((s) => ({ offset: s.offset, color: s.color, midpoint: s.midpoint })),
    );
    expect({ ...out, stops: undefined }).toEqual({ ...ARTISAN, stops: undefined });
  });

  it("survives a Vision edit — recolouring a stop keeps the foreign geometry", () => {
    const stops = ingest(ARTISAN).map((s, i) => (i === 1 ? { ...s, r: 12, g: 34, b: 56 } : s));
    const out = toGradientValue(stops, ARTISAN.type, false, gradientForeignOf(ARTISAN));
    expect(out.stops[1].color).toBe("#0c223880");
    expect({ cx: out.cx, cy: out.cy, r: out.r, fx: out.fx, fy: out.fy, spread: out.spread, angle: out.angle })
      .toEqual({ cx: 0.3, cy: 0.7, r: 0.9, fx: 0.2, fy: 0.6, spread: "repeat", angle: 45 });
  });
});
