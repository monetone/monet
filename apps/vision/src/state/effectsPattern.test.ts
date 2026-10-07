import { describe, it, expect } from "vitest";
import { FX, PATTERNS, fxDef, type FxField } from "./effects";

// Every pattern select writes its option INDEX into the param vector, and the
// engine (`pattern_color` / `pattern_height` in packages/engine/src/raster/
// effects.rs) matches on that index — 0 checker, 1 grid, 2 dots, 3 the
// Edit ▸ Define Pattern tile. These tests pin the mapping so a reorder here
// shows up as a failure instead of the wrong pattern in the canvas.
describe("layer-style pattern picks", () => {
  const patternSlot = (id: number, i: number): FxField => {
    const f: FxField | undefined = fxDef(id).fields.find((x) => x.i === i);
    if (!f || f.k !== "pattern") throw new Error(`slot ${i} of fx ${id} is not a pattern slot`);
    return f;
  };

  it("puts the defined tile last, at engine kind 3", () => {
    expect(PATTERNS).toEqual(["Checker", "Grid", "Dots", "Defined"]);
    expect(PATTERNS.indexOf("Defined")).toBe(3);
  });

  it("gives Pattern Overlay, Stroke's pattern fill and Bevel's Texture their own picker slot", () => {
    // A pattern pick is a tile ID, not an option index (#420), so these are a
    // field kind of their own rather than a plain select.
    expect(patternSlot(FX.PATTERN_OVERLAY, 4).label).toBe("Pattern");
    expect(patternSlot(FX.STROKE, 13).label).toBe("Pattern");
    expect(patternSlot(FX.BEVEL, 24).label).toBe("Texture Pattern");
  });

  it("defaults every pattern scale to 16 — the defined tile's 1:1 zoom", () => {
    expect(fxDef(FX.PATTERN_OVERLAY).def[3]).toBe(16);
    expect(fxDef(FX.STROKE).def[14]).toBe(16);
    expect(fxDef(FX.BEVEL).def[25]).toBe(16);
  });
});
