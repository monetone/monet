import { describe, expect, it } from "vitest";

import { createDefaultRecipe } from "@monet-ui/monet-photo";

import { historyLabel } from "./historyLabel";

describe("historyLabel", () => {
  it("returns 'Edit' when no tracked panel changed", () => {
    const a = createDefaultRecipe();
    const b = createDefaultRecipe();
    b.masks = { masks: [] }; // mask-graph edits are not a tracked panel
    expect(historyLabel(a, b)).toBe("Edit");
  });

  it("names the changed panel", () => {
    const a = createDefaultRecipe();
    const b = createDefaultRecipe();
    b.detail.sharpenAmount = 0.5;
    expect(historyLabel(a, b)).toBe("Detail");
  });

  it("names the tone curve when its points move", () => {
    const a = createDefaultRecipe();
    const b = createDefaultRecipe();
    b.toneCurve.point = [{ x: 0, y: 0 }, { x: 0.5, y: 0.6 }, { x: 1, y: 1 }];
    expect(historyLabel(a, b)).toBe("Tone Curve");
  });

  it("reports the first differing panel in Basic-first order", () => {
    const a = createDefaultRecipe();
    const b = createDefaultRecipe();
    b.basic.exposure = 0.4; // Basic precedes Effects in the panel order
    b.effects.grainAmount = 0.3;
    expect(historyLabel(a, b)).toBe("Basic");
  });

  it("labels a process-version-only change as Process Version", () => {
    const a = createDefaultRecipe();
    const b = createDefaultRecipe();
    a.processVersion = 5;
    expect(historyLabel(a, b)).toBe("Process Version");
    // A panel edit still wins over the PV stamp.
    b.basic.contrast = 0.2;
    expect(historyLabel(a, b)).toBe("Basic");
  });
});
