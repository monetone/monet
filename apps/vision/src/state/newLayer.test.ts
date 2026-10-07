// Unit tests for the New Layer dialog helpers. Engine-free (node); the dialog +
// menu/shortcut wiring are covered by e2e/new-layer-dialog.spec.ts.
import { describe, it, expect } from "vitest";
import { defaultLayerName, clampLayerOpacity, resolveLayerName } from "./newLayer";

describe("defaultLayerName", () => {
  it("starts at 'Layer 1' with no matching names", () => {
    expect(defaultLayerName([])).toBe("Layer 1");
    expect(defaultLayerName(["Background"])).toBe("Layer 1");
  });

  it("increments past the highest existing 'Layer N'", () => {
    expect(defaultLayerName(["Layer 1"])).toBe("Layer 2");
    expect(defaultLayerName(["Layer 2", "foo"])).toBe("Layer 3");
  });

  it("uses max+1, not count+1, when there are gaps", () => {
    expect(defaultLayerName(["Layer 1", "Layer 3"])).toBe("Layer 4");
  });
});

describe("clampLayerOpacity", () => {
  it("clamps to 0..100 and rounds", () => {
    expect(clampLayerOpacity(150)).toBe(100);
    expect(clampLayerOpacity(-5)).toBe(0);
    expect(clampLayerOpacity(55.6)).toBe(56);
  });

  it("falls back to 100 for non-finite input", () => {
    expect(clampLayerOpacity(NaN)).toBe(100);
  });
});

describe("resolveLayerName", () => {
  it("keeps a non-blank typed name", () => {
    expect(resolveLayerName("Sky", [])).toBe("Sky");
  });

  it("falls back to the auto-numbered default when blank", () => {
    expect(resolveLayerName("  ", [])).toBe("Layer 1");
    expect(resolveLayerName("", ["Layer 1"])).toBe("Layer 2");
  });
});
