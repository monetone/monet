// Unit tests for the Filter Gallery's "New effect layer" (duplicate) stack op —
// Photoshop duplicates the SELECTED effect directly above itself, so the pair
// applies twice in a row and the copy edits independently.
import { describe, it, expect } from "vitest";
import { addEffect, duplicateEffect, setEffectValues, composeOrder, type GalleryEffect } from "./filterGallery";

const ids = (s: GalleryEffect[]) => s.map((e) => e.id);
const stack3 = ["cutout", "crosshatch", "chrome"].reduce(addEffect, [] as GalleryEffect[]);

describe("duplicateEffect", () => {
  it("inserts the copy directly above the source", () => {
    expect(ids(duplicateEffect(stack3, 0))).toEqual(["cutout", "cutout", "crosshatch", "chrome"]);
    expect(ids(duplicateEffect(stack3, 1))).toEqual(["cutout", "crosshatch", "crosshatch", "chrome"]);
    expect(ids(duplicateEffect(stack3, 2))).toEqual(["cutout", "crosshatch", "chrome", "chrome"]);
  });

  it("copies the current values, not the filter defaults", () => {
    const edited = setEffectValues(stack3, 1, [40, 20, 3]);
    const dup = duplicateEffect(edited, 1);
    expect(dup[2].values).toEqual([40, 20, 3]);
  });

  it("gives the copy its own values array (editing one leaves the other alone)", () => {
    const dup = duplicateEffect(stack3, 0);
    const edited = setEffectValues(dup, 1, [8, 8, 3]);
    expect(edited[0].values).toEqual(stack3[0].values);
    expect(edited[1].values).toEqual([8, 8, 3]);
  });

  it("carries visibility, so a hidden effect duplicates hidden", () => {
    const hidden = stack3.map((e, i) => (i === 1 ? { ...e, visible: false } : e));
    const dup = duplicateEffect(hidden, 1);
    expect(dup[2].visible).toBe(false);
    expect(ids(composeOrder(dup))).toEqual(["cutout", "chrome"]);
  });

  it("ignores out-of-range indices and never mutates the input", () => {
    expect(duplicateEffect(stack3, -1)).toBe(stack3);
    expect(duplicateEffect(stack3, 3)).toBe(stack3);
    expect(duplicateEffect([], 0)).toEqual([]);
    duplicateEffect(stack3, 0);
    expect(ids(stack3)).toEqual(["cutout", "crosshatch", "chrome"]);
  });
});
