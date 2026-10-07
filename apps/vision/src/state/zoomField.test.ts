// Unit tests for the status-bar zoom-field parser. Engine-free (node); the field
// component + commit are covered by e2e/zoom-field.spec.ts.
import { describe, it, expect } from "vitest";
import { parseZoomField } from "./zoomField";

describe("parseZoomField", () => {
  it("parses a plain percentage to a zoom fraction", () => {
    expect(parseZoomField("200")).toBe(2);
    expect(parseZoomField("100")).toBe(1);
    expect(parseZoomField("12.5")).toBe(0.125);
  });

  it("accepts a trailing % and surrounding spaces", () => {
    expect(parseZoomField("200%")).toBe(2);
    expect(parseZoomField("50 %")).toBe(0.5);
    expect(parseZoomField("  100  ")).toBe(1);
  });

  it("clamps to the engine zoom range [0.02, 32]", () => {
    expect(parseZoomField("5000")).toBe(32); // 5000% → 32× cap
    expect(parseZoomField("1")).toBe(0.02); // 1% → 2% floor
  });

  it("returns null for invalid input", () => {
    expect(parseZoomField("abc")).toBeNull();
    expect(parseZoomField("")).toBeNull();
    expect(parseZoomField("-50")).toBeNull();
    expect(parseZoomField("12px")).toBeNull();
  });
});
