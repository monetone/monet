// Unit tests for the Filter Gallery model (engine-free, node). These pin the
// pure stack operations (add / toggle / reorder / delete / compose ordering),
// the catalog integrity (the preserved 7 filters + the grouped set), and the
// UI→engine argument conversions that the dialog dispatches to fil/distort.
import { describe, it, expect } from "vitest";
import {
  GALLERY_CATEGORIES, GALLERY_FILTERS, filterDef, filtersInCategory, defaultValues,
  makeEffect, addEffect, removeEffect, toggleEffect, moveEffect, setEffectValues,
  composeOrder, effectArgs, type GalleryEffect,
} from "./filterGallery";

const ids = (s: GalleryEffect[]) => s.map((e) => e.id);

describe("catalog", () => {
  it("has unique ids and valid categories", () => {
    const seen = new Set<string>();
    for (const d of GALLERY_FILTERS) {
      expect(seen.has(d.id)).toBe(false);
      seen.add(d.id);
      expect(GALLERY_CATEGORIES).toContain(d.category);
      expect(d.params.length).toBeGreaterThan(0);
    }
  });

  it("preserves key Filter Gallery filters", () => {
    for (const id of ["posterEdges", "glowingEdges", "photocopy", "notePaper", "tornEdges", "waterPaper", "conteCrayon", "reticulation", "plaster", "crystallize", "stainedGlass", "pointillize", "colorHalftone"]) {
      expect(filterDef(id)).toBeTruthy();
    }
  });

  it("includes every Artistic filter that already has an engine implementation", () => {
    for (const id of ["coloredPencil", "fresco", "paletteKnife", "paintDaubs", "roughPastels", "smudgeStick", "sponge", "underpainting"]) {
      expect(filterDef(id)?.category).toBe("Artistic");
    }
  });

  it("every category has at least one filter and groups partition the catalog", () => {
    let total = 0;
    for (const c of GALLERY_CATEGORIES) {
      const inCat = filtersInCategory(c);
      expect(inCat.length).toBeGreaterThan(0);
      total += inCat.length;
    }
    expect(total).toBe(GALLERY_FILTERS.length);
  });

  it("each def's defaults are in range and args() returns finite numbers", () => {
    for (const d of GALLERY_FILTERS) {
      const vals = defaultValues(d);
      expect(vals.length).toBe(d.params.length);
      d.params.forEach((p, i) => {
        expect(vals[i]).toBeGreaterThanOrEqual(p.min);
        expect(vals[i]).toBeLessThanOrEqual(p.max);
        if (p.options) expect(p.options).toHaveLength(p.max - p.min + 1);
      });
      for (const a of d.args(vals)) expect(Number.isFinite(a)).toBe(true);
    }
  });
});

describe("Sketch conversions", () => {
  it("normalizes Note Paper controls for the engine", () => {
    const d = filterDef("notePaper")!;
    expect(defaultValues(d)).toEqual([25, 10, 11]);
    expect(effectArgs({ id: "notePaper", values: [40, 5, 20], visible: true })).toEqual([0.8, 0.25, 0.8]);
  });
  it("normalizes Torn Edges controls for the engine", () => {
    const d = filterDef("tornEdges")!;
    expect(defaultValues(d)).toEqual([25, 8, 25]);
    expect(effectArgs({ id: "tornEdges", values: [40, 12, 30], visible: true })).toEqual([0.8, 0.8, 0.6]);
  });
  it("normalizes Water Paper controls for the engine", () => {
    const d = filterDef("waterPaper")!;
    expect(defaultValues(d)).toEqual([15, 50, 50]);
    expect(effectArgs({ id: "waterPaper", values: [25, 75, 30], visible: true })).toEqual([0.5, 0.75, 0.3]);
  });
  it("normalizes Conte Crayon controls for the engine", () => {
    const d = filterDef("conteCrayon")!;
    expect(defaultValues(d)).toEqual([11, 7, 0, 100, 10, 0]);
    expect(effectArgs({ id: "conteCrayon", values: [10, 15, 2, 125, 25, 6], visible: true })).toEqual([0.5, 0.75, 2, 0.5, 0.5, 6]);
  });
  it("normalizes Charcoal controls for the engine", () => {
    const d = filterDef("charcoal")!;
    expect(defaultValues(d)).toEqual([1, 5, 50]);
    expect(effectArgs({ id: "charcoal", values: [7, 3, 80], visible: true })).toEqual([7, 3, 0.8]);
  });
  it("normalizes Reticulation controls for the engine", () => {
    const d = filterDef("reticulation")!;
    expect(defaultValues(d)).toEqual([25, 25, 25]);
    expect(effectArgs({ id: "reticulation", values: [40, 10, 30], visible: true })).toEqual([0.8, 0.2, 0.6]);
  });
  it("normalizes Plaster controls for the engine", () => {
    const d = filterDef("plaster")!;
    expect(defaultValues(d)).toEqual([25, 8, 0]);
    expect(effectArgs({ id: "plaster", values: [40, 12, 6], visible: true })).toEqual([0.8, 0.8, 6]);
  });
});

describe("makeEffect / defaults", () => {
  it("seeds an effect from a filter's defaults and is visible", () => {
    const e = makeEffect("posterEdges");
    expect(e).toEqual({ id: "posterEdges", values: [4, 1, 4], visible: true });
  });
  it("throws on an unknown id", () => {
    expect(() => makeEffect("nope")).toThrow();
  });
});

describe("addEffect", () => {
  it("appends a seeded, visible effect to the top of the stack", () => {
    let s: GalleryEffect[] = [];
    s = addEffect(s, "cutout");
    s = addEffect(s, "glowingEdges");
    expect(ids(s)).toEqual(["cutout", "glowingEdges"]);
    expect(s[0].values).toEqual([4, 4, 2]);
    expect(s.every((e) => e.visible)).toBe(true);
  });
  it("ignores an unknown id and does not mutate the input", () => {
    const s: GalleryEffect[] = [makeEffect("crystallize")];
    const out = addEffect(s, "bogus");
    expect(out).toBe(s); // unchanged reference
  });
  it("allows the same filter to be stacked multiple times", () => {
    let s: GalleryEffect[] = [];
    s = addEffect(s, "grain");
    s = addEffect(s, "grain");
    expect(ids(s)).toEqual(["grain", "grain"]);
  });
});

describe("toggleEffect", () => {
  it("flips only the targeted effect's visibility", () => {
    let s = addEffect(addEffect([], "cutout"), "grain");
    s = toggleEffect(s, 0);
    expect(s[0].visible).toBe(false);
    expect(s[1].visible).toBe(true);
  });
  it("is a no-op for an out-of-range index", () => {
    const s = addEffect([], "cutout");
    expect(toggleEffect(s, 9)).toBe(s);
  });
});

describe("moveEffect", () => {
  it("moves up (−1) and down (+1), swapping neighbours", () => {
    const s = ["a", "b", "c"].reduce((acc, id) => addEffect(acc, id === "a" ? "cutout" : id === "b" ? "grain" : "crystallize"), [] as GalleryEffect[]);
    expect(ids(moveEffect(s, 2, -1))).toEqual(["cutout", "crystallize", "grain"]);
    expect(ids(moveEffect(s, 0, 1))).toEqual(["grain", "cutout", "crystallize"]);
  });
  it("clamps at the ends (no wrap) and does not mutate the input", () => {
    const s = addEffect(addEffect([], "cutout"), "grain");
    expect(moveEffect(s, 0, -1)).toBe(s); // already at top
    expect(moveEffect(s, 1, 1)).toBe(s); // already at bottom
    expect(ids(s)).toEqual(["cutout", "grain"]);
  });
});

describe("removeEffect", () => {
  it("deletes the targeted effect, preserving order", () => {
    const s = addEffect(addEffect(addEffect([], "cutout"), "grain"), "crystallize");
    expect(ids(removeEffect(s, 1))).toEqual(["cutout", "crystallize"]);
  });
  it("is a no-op for an out-of-range index", () => {
    const s = addEffect([], "cutout");
    expect(removeEffect(s, -1)).toBe(s);
  });
});

describe("setEffectValues", () => {
  it("replaces the targeted effect's values with a copy (no aliasing/mutation)", () => {
    const s = addEffect([], "neonGlow");
    const vals = [10, 40];
    const out = setEffectValues(s, 0, vals);
    expect(out[0].values).toEqual([10, 40]);
    expect(out[0].values).not.toBe(vals); // stored as a copy
    expect(s[0].values).toEqual([0, 25]); // input untouched
  });
});

describe("composeOrder", () => {
  it("returns only visible effects, in array (apply) order", () => {
    let s = addEffect(addEffect(addEffect([], "cutout"), "grain"), "crystallize");
    s = toggleEffect(s, 1); // hide grain
    expect(ids(composeOrder(s))).toEqual(["cutout", "crystallize"]);
  });
  it("reorders the composition when the stack is reordered", () => {
    const s = addEffect(addEffect([], "cutout"), "grain");
    expect(ids(composeOrder(moveEffect(s, 0, 1)))).toEqual(["grain", "cutout"]);
  });
  it("is empty when all effects are hidden", () => {
    let s = addEffect(addEffect([], "cutout"), "grain");
    s = toggleEffect(toggleEffect(s, 0), 1);
    expect(composeOrder(s)).toEqual([]);
  });
});

describe("effectArgs conversions", () => {
  it("Poster Edges rounds levels/thickness and passes intensity through", () => {
    expect(effectArgs({ id: "posterEdges", values: [4.6, 2.4, 5], visible: true })).toEqual([5, 2, 5]);
  });
  it("Neon Glow normalises size/−24..24 and brightness/0..50", () => {
    expect(effectArgs({ id: "neonGlow", values: [24, 25], visible: true })).toEqual([1, 0.5]);
  });
  it("Dry Brush rounds brush size/detail/texture for the engine", () => {
    expect(effectArgs({ id: "dryBrush", values: [6.4, 4.6, 1.2], visible: true })).toEqual([6, 5, 1]);
  });
  it("Watercolor rounds brush detail/shadow intensity/texture for the engine", () => {
    expect(effectArgs({ id: "watercolor", values: [6.4, 4.6, 1.2], visible: true })).toEqual([6, 5, 1]);
  });
  it("Paint Daubs exposes named brush types and rounds all engine arguments", () => {
    const d = filterDef("paintDaubs")!;
    expect(defaultValues(d)).toEqual([8, 7, 0]);
    expect(d.params[2].options).toEqual(["Simple", "Light Rough", "Dark Rough", "Wide Sharp", "Wide Blurry", "Sparkle"]);
    expect(effectArgs({ id: "paintDaubs", values: [12.4, 8.6, 4], visible: true })).toEqual([12, 9, 4]);
  });
  it("Sponge matches Photoshop's defaults, ranges, and integer engine arguments", () => {
    const d = filterDef("sponge")!;
    expect(defaultValues(d)).toEqual([2, 12, 5]);
    expect(d.params.map(({ min, max }) => [min, max])).toEqual([[0, 10], [0, 25], [1, 15]]);
    expect(effectArgs({ id: "sponge", values: [4.4, 18.6, 7.5], visible: true })).toEqual([4, 19, 8]);
  });
  it("converts the textured Artistic filters like their standalone dialogs", () => {
    expect(defaultValues(filterDef("roughPastels")!)).toEqual([20, 0, 100, 25, 1]);
    expect(effectArgs({ id: "roughPastels", values: [31, 2, 125, 20, 6], visible: true })).toEqual([31, 2, 0.5, 0.4, 6]);
    expect(defaultValues(filterDef("underpainting")!)).toEqual([6, 16, 0, 100, 20, 1]);
    expect(effectArgs({ id: "underpainting", values: [8, 24, 3, 200, 40, 7], visible: true })).toEqual([8, 24, 3, 1, 0.8, 7]);
  });
  it("Glass remaps scaling 50..200% → −0..1 and selects the texture index", () => {
    expect(effectArgs({ id: "glass", values: [1, 10, 3, 200], visible: true })).toEqual([1, 0.5, 0.2, 1]);
  });
  it("Diffuse Glow passes the standalone dialog's grain/glow/clear values through", () => {
    expect(effectArgs({ id: "diffuseGlow", values: [2, 14, 8], visible: true })).toEqual([2, 14, 8]);
  });
  it("Texturizer thresholds the invert flag to 0/1", () => {
    expect(effectArgs({ id: "texturizer", values: [0, 100, 25, 0, 1], visible: true })[4]).toBe(1);
    expect(effectArgs({ id: "texturizer", values: [0, 100, 25, 0, 0], visible: true })[4]).toBe(0);
  });
  it("Dark Strokes normalises balance/black/white 0..10 → 0..1", () => {
    const d = filterDef("darkStrokes")!;
    expect(defaultValues(d)).toEqual([5, 5, 3]);
    expect(effectArgs({ id: "darkStrokes", values: [10, 8, 2], visible: true })).toEqual([1, 0.8, 0.2]);
  });
  it("Sprayed Strokes passes length/radius px through and rounds the direction", () => {
    const d = filterDef("sprayedStrokes")!;
    expect(defaultValues(d)).toEqual([12, 7, 0]);
    expect(effectArgs({ id: "sprayedStrokes", values: [20, 25, 2.4], visible: true })).toEqual([20, 25, 2]);
  });
  it("Sumi-e normalises width/pressure 0..15 and contrast 0..40 → 0..1", () => {
    const d = filterDef("sumiE")!;
    expect(defaultValues(d)).toEqual([10, 2, 16]);
    expect(effectArgs({ id: "sumiE", values: [15, 15, 40], visible: true })).toEqual([1, 1, 1]);
  });
  it("Crystallize clamps the cell size to >= 2 and rounds", () => {
    expect(effectArgs({ id: "crystallize", values: [1.2], visible: true })).toEqual([2]);
    expect(effectArgs({ id: "crystallize", values: [12.7], visible: true })).toEqual([13]);
  });
});
