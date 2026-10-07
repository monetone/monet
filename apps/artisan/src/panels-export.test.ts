// panels-export.test - Export panel store transactions

import { describe, expect, it } from "vitest";
import {
  ArtisanStore,
  Ops,
  exportForScreensManifestOptions,
  makeArtboard,
  makeDocument,
  resolvedExportForScreensSettings,
} from "./engine";
import { buildExportForScreensManifest } from "./io/compatibility";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Export", 100, 100);
  doc.artboards.push(makeArtboard("Social Card", 120, 0, 200, 160));
  doc.slices = [{ id: "slice-hero", name: "Hero Tile", x: 10, y: 20, width: 30, height: 40 }];
  store.replaceDoc(doc, { markClean: true });
  return { store };
};

describe("Export panel transactions", () => {
  it("updates Export for Screens setup in one undoable transaction", () => {
    const { store } = setup();

    store.transact("Export for Screens", (doc) => {
      Ops.Export.setExportForScreensSettings(doc, {
        target: "artboards",
        formats: ["svg", "pdf", "tiff"],
        scale: 2,
        baseName: "Launch Kit",
      });
    });

    let settings = resolvedExportForScreensSettings(store.getState().doc.exportForScreens);
    expect(settings).toMatchObject({
      target: "artboards",
      formats: ["svg", "pdf", "tiff"],
      scale: 2,
      baseName: "Launch Kit",
    });

    store.undo();
    settings = resolvedExportForScreensSettings(store.getState().doc.exportForScreens);
    expect(settings).toMatchObject({
      target: "artboards-and-slices",
      formats: ["svg", "png"],
      scale: 1,
    });
  });

  it("drives an Export for Screens manifest from document settings", () => {
    const { store } = setup();

    store.transact("Export for Screens", (doc) => {
      Ops.Export.setExportForScreensSettings(doc, {
        target: "artboards-and-slices",
        formats: ["svg", "png", "jpeg"],
        scale: 1.5,
        baseName: "Launch Kit",
      });
    });

    const doc = store.getState().doc;
    const manifest = buildExportForScreensManifest(doc, {
      ...exportForScreensManifestOptions(doc),
      generatedAt: "2026-07-03T00:00:00.000Z",
    });

    expect(manifest.manifestPath).toBe("Launch-Kit-export-for-screens.json");
    expect(manifest.entries.map((entry) => [entry.source, entry.name])).toEqual([
      ["artboard", "Artboard 1"],
      ["artboard", "Social Card"],
      ["slice", "Hero Tile"],
    ]);
    expect(manifest.entries[0].files.map((file) => [file.format, file.supported])).toEqual([
      ["svg", true],
      ["png", true],
      ["jpeg", false],
    ]);
    expect(manifest.entries[0].files[0].filename).toBe("Launch-Kit-artboard-Artboard-1-01@1.5x.svg");
    expect(manifest.issues.map((issue) => issue.code)).toEqual(["jpeg-export-unsupported"]);
  });
});
