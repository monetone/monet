import { describe, it, expect } from "vitest";
import { FX_DEFS, fxDef, defaultBlendIf, blendIfIsDefault } from "./effects";

describe("blend-if", () => {
  it("default is 4 channels × 8 values = 32 entries", () => {
    expect(defaultBlendIf()).toHaveLength(32);
    expect(defaultBlendIf().slice(0, 8)).toEqual([0, 0, 1, 1, 0, 0, 1, 1]);
  });

  it("recognizes the canonical default vector", () => {
    expect(blendIfIsDefault(defaultBlendIf())).toBe(true);
  });

  it("rejects a perturbed vector", () => {
    const v = defaultBlendIf();
    v[5] = 0.5;
    expect(blendIfIsDefault(v)).toBe(false);
  });

  it("treats an empty vector as default (no blend-if set)", () => {
    expect(blendIfIsDefault([])).toBe(true);
  });

  it("rejects a wrong-length, non-empty vector", () => {
    expect(blendIfIsDefault([0, 0, 1])).toBe(false);
  });
});

describe("FX_DEFS param layout (TS↔Rust contract)", () => {
  it("every field's slot(s) lie within the effect's default param array", () => {
    // A reorder/overflow on either side of the TS↔Rust mirror would break this.
    for (const d of FX_DEFS) {
      for (const f of d.fields) {
        const span = f.k === "color" ? 3 : 1; // color occupies i, i+1, i+2
        expect(f.i).toBeGreaterThanOrEqual(1); // index 0 is the enabled flag
        expect(f.i + span).toBeLessThanOrEqual(d.def.length);
      }
    }
  });

  it("fxDef looks up each effect by id", () => {
    for (const d of FX_DEFS) {
      expect(fxDef(d.id)).toBe(d);
    }
  });

  it("every effect's default has the enabled flag set", () => {
    for (const d of FX_DEFS) expect(d.def[0]).toBe(1);
  });
});
