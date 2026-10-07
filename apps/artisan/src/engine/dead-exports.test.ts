import { readFileSync, readdirSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const engineSources = (directory = new URL("./", import.meta.url)): string =>
  readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const url = new URL(entry.name + (entry.isDirectory() ? "/" : ""), directory);
      if (entry.isDirectory()) return engineSources(url);
      return entry.name.endsWith(".ts") && !entry.name.endsWith(".test.ts") ? [readFileSync(url, "utf8")] : [];
    })
    .join("\n");

const exported = (name: string) => new RegExp(`\\bexport\\s+(?:const|function|class|let|var)\\s+${name}\\b|\\bexport\\s*\\{[^}]*\\b${name}\\b`);

const wired = {
  duplicateEntry: "../ui/panels/appearance-panel.tsx",
  duplicateBrush: "../ui/panels/brushes-panel.tsx",
  setDimensionOptions: "../ui/panels/properties-panel.tsx",
  regenerateDimension: "../ui/panels/properties-panel.tsx",
  detachDimension: "../ui/panels/properties-panel.tsx",
  applyEdgeStroke: "../tools/live-paint.ts",
  setGapDetection: "../ui/panels/properties-panel.tsx",
  syncGroup: "../ui/panels/properties-panel.tsx",
  updateMeshPointColor: "../tools/mesh.ts",
  setMeshGrid: "../ui/panels/properties-panel.tsx",
  regenerateMesh: "../ui/panels/properties-panel.tsx",
  detachMesh: "../ui/panels/properties-panel.tsx",
  geometryMultiPolygon: "./ops/offset-path.ts",
  unionRegion: "./ops/offset-path.ts",
  regionToSubpaths: "./ops/offset-path.ts",
  setPerspectivePlane: "../ui/panels/properties-panel.tsx",
  syncPerspectiveSource: "../ui/panels/properties-panel.tsx",
  upsertSpotInk: "../ui/panels/swatches-panel.tsx",
  redefineSymbolFromSelection: "../ui/panels/symbols-panel.tsx",
  swapSymbol: "../ui/panels/symbols-panel.tsx",
  deleteSymbolDefinition: "../ui/panels/symbols-panel.tsx",
  cloneDefinition: "../ui/panels/symbols-panel.tsx",
  setOpenTypeFeatures: "../ui/panels/character-panel.tsx",
  setDataSetValue: "../ui/panels/variables-panel.tsx",
} as const;

const nonPublic = {
  createDimension: "./ops/dimensions.ts",
  createGraph: "./ops/graphs.ts",
  IDENTITY_CORNERS: "./ops/free-distort.ts",
  toSmartPunctuation: "./ops/smart-punctuation.ts",
  addSymbolDefinition: "./ops/symbols.ts",
  syncSymbolInstances: "./ops/symbols.ts",
  setFontStyle: "./ops/text.ts",
  setFontResolution: "./ops/text.ts",
} as const;

const nonPublicModel = {
  shapingRunsForText: "./model/typography.ts",
} as const;

describe("Artisan engine public API census", () => {
  it("keeps all 32 formerly dead ops and the appended model helper wired or non-public", () => {
    expect(Object.keys(wired)).toHaveLength(24);
    expect(Object.keys(nonPublic)).toHaveLength(8);
    expect(Object.keys(nonPublicModel)).toHaveLength(1);

    const engine = engineSources();
    for (const [name, caller] of Object.entries(wired)) {
      expect(exported(name).test(engine), `${name} must remain a public engine operation`).toBe(true);
      expect(new RegExp(`\\b${name}\\b`).test(source(caller)), `${name} must have a production caller in ${caller}`).toBe(true);
    }
    for (const [name, definition] of Object.entries(nonPublic)) {
      expect(exported(name).test(source(definition)), `${name} must not remain exported from ${definition}`).toBe(false);
    }
    for (const [name, definition] of Object.entries(nonPublicModel)) {
      expect(exported(name).test(source(definition)), `${name} must not remain exported from ${definition}`).toBe(false);
    }
  });
});
