import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// A transform BAKES pixels, but a type layer re-renders from its spec — so a
// transform applied without rasterizing first silently vanishes the next time
// anything touches the type (a Character-panel edit, or Type ▸ Update All Text
// Layers, which does it to every text layer at once).
//
// The rasterize-first prelude existed, but only inside transformLayer and
// skewLayer. flip/rotate/perspective went straight to the engine and lost the
// edit. They now all route through one `bakeTransform` helper; this test fails
// if a transform is added that bypasses it.
//
// The rasterization itself now happens inside the engine, so the bake and the
// transform are ONE undo step and a refused or identity transform leaves the
// type editable — proven by `every_layer_transform_bakes_type_atomically` and
// `identity_and_refused_type_transforms_preserve_editability` in raster/mod.rs.
// What is left to guard here is the routing: every baking call goes through
// the one helper that commits.
const appSource = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");

/** Engine transform calls that bake pixels and therefore need the prelude. */
const BAKING_CALLS = [
  "flip_layer_h",
  "flip_layer_v",
  "rotate_layer_180",
  "rotate_layer_90",
  "transform_layer",
  "skew_layer",
  "perspective_transform",
];

describe("baking transforms rasterize a type layer first", () => {
  it("defines a single prelude helper", () => {
    expect(appSource).toContain("function bakeTransform");
  });

  for (const call of BAKING_CALLS) {
    it(`routes ${call} through bakeTransform`, () => {
      // Every occurrence of the engine call must sit inside a bakeTransform(...)
      // arrow. Checking the enclosing text rather than counting call sites, so
      // a newly added caller cannot slip past.
      const re = new RegExp(`E\\(\\)\\.${call}\\(`, "g");
      const hits = [...appSource.matchAll(re)];
      expect(hits.length, `${call} should be called at least once`).toBeGreaterThan(0);
      for (const m of hits) {
        const before = appSource.slice(Math.max(0, m.index! - 220), m.index!);
        expect(
          before,
          `${call} is invoked without the bakeTransform prelude — a transform on a type layer will silently revert`,
        ).toContain("bakeTransform(");
      }
    });
  }
});
