// ─────────────────────────────────────────────────────────────
// model/brushes.test — Brushes panel metadata normalization
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS,
  brushApplication,
  makeCalligraphicBrushDefinition,
  normalizeCalligraphicBrushSettings,
} from "../index";

describe("Brush model", () => {
  it("normalizes calligraphic brush settings without losing explicit paint source", () => {
    expect(normalizeCalligraphicBrushSettings({
      size: Number.POSITIVE_INFINITY,
      angle: Number.NaN,
      roundness: 12,
      paintSource: "fill",
    })).toEqual({
      ...DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS,
      roundness: 1,
      paintSource: "fill",
    });
  });

  it("creates brush application metadata from a definition", () => {
    const brush = makeCalligraphicBrushDefinition("br_test", "Marker", {
      size: 18,
      angle: 15,
      roundness: 0.75,
    });

    expect(brushApplication(brush, { expanded: false, appliedAt: "2026-06-01T00:00:00.000Z" })).toEqual({
      brushId: "br_test",
      brushName: "Marker",
      kind: "calligraphic",
      expanded: false,
      appliedAt: "2026-06-01T00:00:00.000Z",
      settings: {
        size: 18,
        angle: 15,
        roundness: 0.75,
        paintSource: "stroke",
      },
    });
  });
});
