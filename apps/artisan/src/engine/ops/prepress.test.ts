// ─────────────────────────────────────────────────────────────
// ops/prepress.test — editable print metadata
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  Query,
  defaultStroke,
  makeDocument,
  makeGroup,
  makeRect,
  noPaint,
  rgba,
  spotPaint,
  type RectItem,
} from "../index";

describe("prepress operations", () => {
  it("persists process plate visibility overrides", () => {
    const doc = makeDocument("Plate Visibility");

    expect(Ops.Prepress.setInkEnabled(doc, "process:Cyan", false)).toBe(true);
    expect(Ops.Prepress.setInkEnabled(doc, "process:Cyan", false)).toBe(false);
    expect(Query.separationPreview(doc).plates.find((plate) => plate.id === "process:Cyan")?.enabled).toBe(false);
  });

  it("toggles overprint on selected leaves and recurses through groups", () => {
    const doc = makeDocument("Overprint Ops");
    const a = makeRect(0, 0, 20, 20, 0, 0);
    const b = makeRect(30, 0, 20, 20, 0, 0);
    const group = makeGroup([a, b]);
    doc.layers[0].items.push(group);

    expect(Ops.Prepress.setOverprint(doc, [group.id], "fill", true)).toEqual([a.id, b.id]);
    expect((Query.getItem(doc, a.id) as RectItem).overprintFill).toBe(true);
    expect((Query.getItem(doc, b.id) as RectItem).overprintFill).toBe(true);
    expect((Query.getItem(doc, a.id) as RectItem).overprintStroke).toBeUndefined();

    expect(Ops.Prepress.setOverprint(doc, [a.id], "both", false)).toEqual([a.id]);
    expect((Query.getItem(doc, a.id) as RectItem).overprintFill).toBe(false);
    expect((Query.getItem(doc, a.id) as RectItem).overprintStroke).toBe(false);
    expect((Query.getItem(doc, b.id) as RectItem).overprintFill).toBe(true);
  });

  it("round-trips prepress settings, spot paints, and overprint flags through JSON", () => {
    const doc = makeDocument("Roundtrip");
    const rect = makeRect(0, 0, 40, 40, 0, 0, {
      fill: spotPaint("Varnish", rgba(120, 180, 255), { id: "ink-varnish", tint: 75 }),
      stroke: defaultStroke(noPaint()),
    });
    doc.layers[0].items.push(rect);

    Ops.Prepress.setOverprintPreview(doc, true);
    Ops.Prepress.setOverprint(doc, [rect.id], "fill", true);
    Ops.Prepress.upsertSpotInk(doc, "Varnish", rgba(120, 180, 255), { id: "ink-varnish" });

    const back = IO.deserializeDocument(IO.serializeDocument(doc));
    const backItem = Query.getItem(back, rect.id) as RectItem;
    const preview = Query.separationPreview(back);

    expect(back.prepress).toEqual(doc.prepress);
    expect(backItem.fill).toEqual(rect.fill);
    expect(backItem.overprintFill).toBe(true);
    expect(preview.overprintPreview).toBe(true);
    expect(preview.plates.find((p) => p.id === "ink-varnish")?.uses[0]).toMatchObject({
      itemId: rect.id,
      kind: "spot",
      coverage: 75,
      overprint: true,
    });
  });

  it("round-trips print setup through prepress metadata", () => {
    const doc = makeDocument("Print Setup");

    Ops.Prepress.setPrintSettings(doc, {
      target: "selection",
      pageSize: "a4",
      orientation: "portrait",
      scaleMode: "custom",
      scale: 80,
      tileArtwork: true,
      bleed: { top: 3, right: 6, bottom: 3, left: 6 },
      marks: { trim: true, registration: true, pageInfo: true },
      flattenTransparency: true,
      pdfPreset: "press-quality",
    });

    const back = IO.deserializeDocument(IO.serializeDocument(doc));
    const print = Query.packageReport(back).printSettings;

    expect(print).toMatchObject({
      target: "selection",
      pageSize: "a4",
      orientation: "portrait",
      scaleMode: "custom",
      scale: 80,
      tileArtwork: true,
      flattenTransparency: true,
      pdfPreset: "press-quality",
    });
    expect(print.bleed).toEqual({ top: 3, right: 6, bottom: 3, left: 6 });
    expect(print.marks).toMatchObject({ trim: true, registration: true, colorBars: false, pageInfo: true });
  });
});
