import { describe, it, expect } from "vitest";
import { FX, fxDef, type FxDef, type FxField } from "./effects";
import { contourOptions } from "./contours";

// VIS-LS-13 appended slots to five effects: Noise + a knockout toggle on the
// shadows, Technique/Noise/Range/Jitter/gradient fill on the glows, a contour
// on Satin and Color/Gradient/Pattern fill types on Stroke. Each vector is
// decoded slot-for-slot by packages/engine/src/raster/effects.rs, so these
// tests pin the layout — a reorder shows up here, not as a garbled canvas.

const field = (d: FxDef, i: number): FxField => {
  const f = d.fields.find((x) => x.i === i);
  expect(f, `${d.name}: no field at slot ${i}`).toBeDefined();
  return f!;
};

const options = (d: FxDef, i: number): string[] => {
  const f = field(d, i);
  if (f.k !== "select") throw new Error(`${d.name} slot ${i} is ${f.k}, not a select`);
  return f.options;
};
// #419: contour slots became their own field kind, since their choices include
// the document's custom curve library and so cannot live on the field.
const isContour = (d: FxDef, i: number): boolean => field(d, i).k === "contour";

describe("Drop Shadow knockout + noise", () => {
  const ds = fxDef(FX.DROP_SHADOW);

  it("keeps the 11 legacy slots first so persisted vectors still decode", () => {
    expect(ds.def.slice(0, 11)).toEqual([1, 3, 0.75, 0, 0, 0, 120, 10, 0, 10, 0]);
  });

  it("exposes the knockout as a toggle, defaulted ON like Photoshop", () => {
    expect(field(ds, 11).k).toBe("toggle");
    expect(ds.def[11]).toBe(1); // effects.rs reads a *missing* slot as 1 too
  });

  it("exposes Noise, off by default", () => {
    expect(field(ds, 12)).toMatchObject({ k: "unit", label: "Noise" });
    expect(ds.def[12]).toBe(0);
    expect(ds.def).toHaveLength(13);
  });
});

describe("Inner Shadow and Satin", () => {
  it("Inner Shadow gained Noise past its 11 legacy slots", () => {
    const is = fxDef(FX.INNER_SHADOW);
    expect(is.def.slice(0, 11)).toEqual([1, 3, 0.75, 0, 0, 0, 120, 8, 0, 8, 0]);
    expect(field(is, 11)).toMatchObject({ k: "unit", label: "Noise" });
    expect(is.def[11]).toBe(0);
  });

  it("Satin gained a Contour — Photoshop puts one there too", () => {
    const sat = fxDef(FX.SATIN);
    expect(sat.def.slice(0, 10)).toEqual([1, 3, 0.5, 0.4, 0.2, 0.5, 19, 11, 14, 1]);
    expect(isContour(sat, 10)).toBe(true);
    expect(sat.def[10]).toBe(0); // Linear — bit-exact with the old render
  });
});

describe("Glow Technique / Noise / Range / Jitter / Fill Type", () => {
  // Both glows share one 8-slot tail; effects.rs' `finish_glow` decodes it
  // relative to the Technique slot, which is the only thing that differs.
  const cases: Array<[string, FxDef, number]> = [
    ["Outer Glow", fxDef(FX.OUTER_GLOW), 9],
    ["Inner Glow", fxDef(FX.INNER_GLOW), 10],
  ];

  it.each(cases)("%s carries the tail at its own base", (_name, d, base) => {
    expect(options(d, base)).toEqual(["Softer", "Precise"]);
    expect(field(d, base + 1)).toMatchObject({ k: "unit", label: "Noise" });
    expect(field(d, base + 2)).toMatchObject({ k: "unit", label: "Range" });
    expect(field(d, base + 3)).toMatchObject({ k: "unit", label: "Jitter" });
    expect(options(d, base + 4)).toEqual(["Color", "Gradient"]);
    expect(field(d, base + 5)).toMatchObject({ k: "color", label: "Gradient End" });
    expect(d.def).toHaveLength(base + 8); // + the 3 gradient-end slots
  });

  it.each(cases)("%s defaults leave the legacy render untouched", (_name, d, base) => {
    expect(d.def[base]).toBe(0); // Softer
    expect(d.def[base + 1]).toBe(0); // no noise
    expect(d.def[base + 2]).toBe(1); // full range = identity ramp
    expect(d.def[base + 3]).toBe(0); // no jitter
    expect(d.def[base + 4]).toBe(0); // Color fill
  });

  it("keeps the Contour immediately before the Technique slot", () => {
    // effects.rs reads the contour as `base - 1`; this is that contract.
    for (const [, d, base] of cases) {
      expect(isContour(d, base - 1)).toBe(true);
    }
    expect(contourOptions([])).toHaveLength(6);
    expect(contourOptions([])[0]).toBe("Linear");
  });

  it("keeps each glow's legacy prefix intact", () => {
    expect(fxDef(FX.OUTER_GLOW).def.slice(0, 9)).toEqual([1, 7, 0.75, 1, 1, 0.6, 0, 14, 0]);
    expect(fxDef(FX.INNER_GLOW).def.slice(0, 10)).toEqual([1, 7, 0.75, 1, 1, 0.6, 0, 12, 0, 0]);
  });
});

describe("Stroke fill types", () => {
  const st = fxDef(FX.STROKE);

  it("keeps the 8 legacy slots first", () => {
    expect(st.def.slice(0, 8)).toEqual([1, 0, 1, 1, 0.1, 0.1, 3, 1]);
  });

  it("offers Color, Gradient and Pattern — Color first so old vectors decode", () => {
    expect(options(st, 8)).toEqual(["Color", "Gradient", "Pattern"]);
    expect(st.def[8]).toBe(0);
  });

  it("gives the gradient an angle and an end stop (Color is the start stop)", () => {
    expect(field(st, 9)).toMatchObject({ k: "num", label: "Gradient Angle" });
    expect(field(st, 10)).toMatchObject({ k: "color", label: "Gradient End" });
  });

  it("does not steal Global Light: the gradient angle is not an `angle` field", () => {
    // Layer ▸ Global Light rewrites the first `angle` field of every effect.
    expect(st.fields.some((f) => f.k === "angle")).toBe(false);
  });

  it("gives the pattern fill a kind and a scale", () => {
    // #420: a picker slot, not a plain select — the pick is a library tile id.
    expect(field(st, 13)).toMatchObject({ k: "pattern", label: "Pattern" });
    expect(field(st, 14)).toMatchObject({ k: "num", label: "Pattern Scale" });
    expect(st.def[14]).toBeGreaterThan(1);
    expect(st.def).toHaveLength(15);
  });
});

describe("every appended field stays inside its default vector", () => {
  it.each([FX.DROP_SHADOW, FX.INNER_SHADOW, FX.OUTER_GLOW, FX.INNER_GLOW, FX.SATIN, FX.STROKE])(
    "effect %i",
    (id) => {
      const d = fxDef(id);
      for (const f of d.fields) {
        const span = f.k === "color" ? 3 : 1;
        expect(f.i).toBeGreaterThanOrEqual(1); // slot 0 is the enabled flag
        expect(f.i + span).toBeLessThanOrEqual(d.def.length);
      }
    },
  );
});
