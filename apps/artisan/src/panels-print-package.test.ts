// panels-print-package.test - Print & Package panel store transactions

import { describe, expect, it } from "vitest";
import {
  ArtisanStore,
  Ops,
  Query,
  makeDocument,
  makeImage,
  makePlacedAsset,
  makeText,
  rgba,
} from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Print Package");
  const linked = makeImage("file:///assets/logo.png", 0, 0, 64, 64, 64, 64, {
    asset: makePlacedAsset("file:///assets/logo.png", {
      id: "asset-logo",
      status: "missing",
      linkedAt: "2026-07-03T12:00:00.000Z",
    }),
  });
  const embedded = makeImage("data:image/png;base64,AAAA", 72, 0, 32, 32);
  const type = makeText("Proof", 0, 80, {
    fontFamily: "Acme Sans",
    fontResolution: {
      requestedFamily: "Acme Sans",
      status: "missing",
    },
  });
  doc.layers[0].items.push(linked, embedded, type);
  Ops.Prepress.upsertSpotInk(doc, "Varnish", rgba(120, 180, 255), { id: "ink-varnish" });
  store.replaceDoc(doc, { markClean: true });
  return { store };
};

describe("Print & Package panel transactions", () => {
  it("updates print setup in one undoable transaction", () => {
    const { store } = setup();

    store.transact("Print Setup", (doc) => {
      Ops.Prepress.setPrintSettings(doc, {
        target: "all-artboards",
        pageSize: "letter",
        orientation: "landscape",
        scaleMode: "custom",
        scale: 125,
        bleed: { top: 9, right: 9, bottom: 9, left: 9 },
        marks: { trim: true, colorBars: true },
        pdfPreset: "press-quality",
      });
    });

    let print = Query.packageReport(store.getState().doc).printSettings;
    expect(print).toMatchObject({
      target: "all-artboards",
      pageSize: "letter",
      orientation: "landscape",
      scaleMode: "custom",
      scale: 125,
      pdfPreset: "press-quality",
    });
    expect(print.bleed).toEqual({ top: 9, right: 9, bottom: 9, left: 9 });
    expect(print.marks.trim).toBe(true);
    expect(print.marks.colorBars).toBe(true);
    expect(print.marks.registration).toBe(false);

    store.undo();
    print = Query.packageReport(store.getState().doc).printSettings;
    expect(print).toMatchObject({
      target: "active-artboard",
      pageSize: "artboard",
      scaleMode: "fit",
      scale: 100,
    });
  });

  it("summarizes package risks from links, fonts, and inks", () => {
    const { store } = setup();
    const report = Query.packageReport(store.getState().doc);

    expect(report.linkedAssets).toBe(1);
    expect(report.embeddedAssets).toBe(1);
    expect(report.missingAssets).toBe(1);
    expect(report.fonts).toEqual(["Acme Sans"]);
    expect(report.missingFonts).toEqual(["Acme Sans"]);
    expect(report.processInks).toBe(4);
    expect(report.spotInks).toBe(1);
    expect(report.warnings).toEqual(["1 missing linked asset", "1 missing font"]);
  });
});
