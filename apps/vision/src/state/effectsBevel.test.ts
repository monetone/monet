import { describe, it, expect } from "vitest";
import { FX, fxDef, type FxField } from "./effects";
import { contourOptions } from "./contours";

// The Bevel & Emboss param vector is mirrored slot-for-slot by
// `bevel()` in packages/engine/src/raster/effects.rs. These tests pin the
// layout so a reorder on the TS side shows up here instead of as garbled
// shading in the canvas.
describe("Bevel & Emboss param layout", () => {
  const bevel = fxDef(FX.BEVEL);
  const field = (i: number): FxField => {
    const f = bevel.fields.find((x) => x.i === i);
    expect(f, `no field at slot ${i}`).toBeDefined();
    return f!;
  };
  const options = (i: number): string[] => {
    const f = field(i);
    if (f.k !== "select") throw new Error(`slot ${i} is ${f.k}, not a select`);
    return f.options;
  };
  // #419: contour slots are their own field kind — the choices are the six
  // built-ins plus the document's custom library, so they are not on the field.
  const contourAt = (i: number): boolean => field(i).k === "contour";

  it("keeps the 17 legacy slots first so persisted vectors still decode", () => {
    expect(bevel.def.slice(0, 17)).toEqual([1, 7, 0.75, 1, 1, 1, 3, 0.75, 0, 0, 0, 120, 30, 1, 8, 0, 0]);
  });

  it("offers all five Photoshop styles, Stroke Emboss last", () => {
    expect(options(16)).toEqual(["Inner Bevel", "Outer Bevel", "Emboss", "Pillow", "Stroke Emboss"]);
  });

  it("offers Technique, Direction and a Gloss Contour", () => {
    expect(options(17)).toEqual(["Smooth", "Chisel Hard", "Chisel Soft"]);
    expect(options(18)).toEqual(["Up", "Down"]);
    expect(contourAt(19)).toBe(true); // Gloss Contour
    expect(contourOptions([])).toHaveLength(6);
    expect(contourOptions([])[0]).toBe("Linear");
  });

  it("carries the Contour and Texture sub-effects, both off by default", () => {
    expect(field(20)).toMatchObject({ k: "toggle", label: "Contour" });
    expect(field(21).k).toBe("contour"); // #419: the sub-effect's own contour
    expect(field(22).k).toBe("unit"); // Range
    expect(field(23)).toMatchObject({ k: "toggle", label: "Texture" });
    // #420: the Texture pattern is a picker slot (procedural kinds + library ids).
    expect(field(24)).toMatchObject({ k: "pattern", label: "Texture Pattern" });
    expect(field(25)).toMatchObject({ k: "num", label: "Texture Scale" });
    expect(field(26)).toMatchObject({ k: "num", label: "Texture Depth" });
    expect(field(27)).toMatchObject({ k: "toggle", label: "Texture Invert" });
    expect(bevel.def[20]).toBe(0);
    expect(bevel.def[23]).toBe(0);
  });

  it("defaults the appended slots so enabling a sub-effect does something", () => {
    expect(bevel.def).toHaveLength(28);
    expect(bevel.def[17]).toBe(0); // Smooth
    expect(bevel.def[18]).toBe(0); // Up
    expect(bevel.def[19]).toBe(0); // Linear gloss — bit-exact with the old render
    expect(bevel.def[22]).toBeGreaterThan(0); // contour range
    expect(bevel.def[25]).toBeGreaterThan(1); // texture scale
    expect(bevel.def[26]).not.toBe(0); // texture depth
  });

  it("every field stays inside the default vector", () => {
    for (const f of bevel.fields) {
      const span = f.k === "color" ? 3 : 1;
      expect(f.i + span).toBeLessThanOrEqual(bevel.def.length);
    }
  });

  it("Texture Depth may be negative (carved into the surface)", () => {
    const f = field(26);
    if (f.k !== "num") throw new Error("Texture Depth must be a num field");
    expect(f.min).toBeLessThan(0);
  });
});
