// ─────────────────────────────────────────────────────────────
// model/prepress.test — separations and overprint baseline
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  Query,
  defaultStroke,
  makeDocument,
  makeRect,
  noPaint,
  rgba,
  resolvedPrepressSettings,
  solid,
  spotPaint,
  type AppearanceStack,
} from "../index";

const plate = (preview: Query.SeparationPreview, name: string) => {
  const found = preview.plates.find((p) => p.name === name);
  expect(found).toBeTruthy();
  return found!;
};

describe("prepress separation model", () => {
  it("overrides default process plates by id", () => {
    const prepress = resolvedPrepressSettings({
      overprintPreview: false,
      inks: [{
        id: "process:Cyan",
        name: "Cyan",
        kind: "process",
        color: rgba(0, 174, 239),
        enabled: false,
      }],
    });

    expect(prepress.inks).toHaveLength(4);
    expect(prepress.inks?.find((ink) => ink.id === "process:Cyan")?.enabled).toBe(false);
  });

  it("reports ordinary RGB solids as process CMYK plates", () => {
    const doc = makeDocument("Process");
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: solid(rgba(255, 0, 0)),
      stroke: defaultStroke(noPaint()),
    });
    doc.layers[0].items.push(rect);

    const preview = Query.separationPreview(doc);

    expect(preview.processPlateCount).toBe(4);
    expect(plate(preview, "Cyan").uses).toHaveLength(0);
    expect(plate(preview, "Magenta").uses[0]).toMatchObject({ itemId: rect.id, attribute: "fill", coverage: 100 });
    expect(plate(preview, "Yellow").uses[0]).toMatchObject({ itemId: rect.id, attribute: "fill", coverage: 100 });
    expect(plate(preview, "Black").uses).toHaveLength(0);
  });

  it("keeps spot paints on their own plate instead of converting to process", () => {
    const doc = makeDocument("Spot");
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: spotPaint("PANTONE 185 C", rgba(220, 0, 0), { id: "ink-p185", tint: 40 }),
      stroke: defaultStroke(noPaint()),
    });
    doc.layers[0].items.push(rect);

    const preview = Query.separationPreview(doc);
    const spot = plate(preview, "PANTONE 185 C");

    expect(preview.spotPlateCount).toBe(1);
    expect(spot.kind).toBe("spot");
    expect(spot.uses[0]).toMatchObject({ itemId: rect.id, attribute: "fill", coverage: 40, tint: 40 });
    expect(plate(preview, "Magenta").uses).toHaveLength(0);
    expect(plate(preview, "Yellow").uses).toHaveLength(0);
  });

  it("counts overprint uses from appearance stack entries", () => {
    const doc = makeDocument("Overprint");
    const appearance: AppearanceStack = {
      entries: [
        { id: "black-fill", kind: "fill", paint: solid(rgba(0, 0, 0)), opacity: 0.5, overprint: true },
        { id: "empty-stroke", kind: "stroke", stroke: defaultStroke(noPaint()) },
      ],
    };
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: solid(rgba(255, 255, 255)),
      stroke: defaultStroke(noPaint()),
      appearance,
    });
    doc.layers[0].items.push(rect);

    const preview = Query.separationPreview(doc);
    const black = plate(preview, "Black");

    expect(preview.overprintObjectCount).toBe(1);
    expect(black.overprintUses).toBe(1);
    expect(black.uses[0]).toMatchObject({ itemId: rect.id, attribute: "appearance-fill", overprint: true, coverage: 50 });
  });
});
