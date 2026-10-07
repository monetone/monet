// xmp.snapshots.test — GAL-DEV-22: named snapshots travel in the sidecar, so a
// discarded catalog doesn't take them with it. They ride LR's `crs:Snapshots`
// bag, and — the part that would silently corrupt a photo — a snapshot's crs:
// attributes must never be read back as the photo's own develop settings.

import { describe, expect, it } from "vitest";

import { normalizeRecipe } from "./developRecipe";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./xmp";

const recipe = (over: (r: ReturnType<typeof normalizeRecipe>) => void) => {
  const r = normalizeRecipe({});
  over(r);
  return r;
};

describe("crs:Snapshots round trip", () => {
  it("carries every named snapshot and keeps them out of the photo's own recipe", () => {
    const xml = serializeCameraRawXmp({
      recipe: recipe((r) => {
        r.basic.exposure = 0.25;
      }),
      snapshots: [
        { name: "Punchy", recipe: recipe((r) => (r.basic.contrast = 0.4)) },
        { name: "B&W <bleached>", recipe: recipe((r) => (r.basic.saturation = -1)) },
      ],
    });

    const doc = parseCameraRawXmp(xml);

    // The photo's own settings are exactly what was written — no snapshot value
    // leaked into them, and no snapshot property showed up as "unrecognized".
    expect(doc.recipe?.basic?.exposure).toBe(0.25);
    expect(doc.recipe?.basic?.contrast ?? 0).toBe(0);
    expect(doc.recipe?.basic?.saturation ?? 0).toBe(0);
    expect(doc.skipped.filter((s) => s.includes("Snapshot"))).toEqual([]);

    expect(doc.snapshots.map((s) => s.name)).toEqual(["Punchy", "B&W <bleached>"]);
    expect(doc.snapshots[0].recipe?.basic?.contrast).toBeCloseTo(0.4, 6);
    expect(doc.snapshots[1].recipe?.basic?.saturation).toBeCloseTo(-1, 6);
    // Each snapshot is its own recipe, not a diff against the photo's.
    expect(doc.snapshots[0].recipe?.basic?.exposure ?? 0).toBe(0);
  });

  it("round-trips a snapshot's nested blocks (tone curve), not just flat attributes", () => {
    const xml = serializeCameraRawXmp({
      snapshots: [
        {
          name: "Faded",
          recipe: recipe((r) => {
            r.toneCurve.point = [
              { x: 0, y: 0.1 },
              { x: 1, y: 0.9 },
            ];
          }),
        },
      ],
    });

    const doc = parseCameraRawXmp(xml);
    expect(doc.snapshots).toHaveLength(1);
    expect(doc.snapshots[0].recipe?.toneCurve?.point?.[0].y).toBeCloseTo(0.1, 2);
    // …and the document itself still has no develop block of its own.
    expect(doc.recipe).toBeNull();
  });

  it("has no snapshots block when there are none, and reads documents without one", () => {
    const xml = serializeCameraRawXmp({ metadata: { rating: 3 } });
    expect(xml).not.toContain("crs:Snapshots");
    expect(parseCameraRawXmp(xml).snapshots).toEqual([]);
  });

  it("keeps the document's own crs:Name when snapshots carry names too", () => {
    const xml = serializeCameraRawXmp({
      name: "My Preset",
      recipe: recipe((r) => (r.basic.exposure = 1)),
      snapshots: [{ name: "Snap One", recipe: normalizeRecipe({}) }],
    });
    const doc = parseCameraRawXmp(xml);
    expect(doc.name).toBe("My Preset");
    expect(doc.snapshots.map((s) => s.name)).toEqual(["Snap One"]);
  });
});
