// White Balance presets: the menu → recipe mapping, and its XMP round trip.
// Two silent-failure modes to guard: (1) a preset that writes no Temp/Tint (a
// menu entry that renders identically to As Shot — the "dead control" this row
// exists to remove), and (2) the crs:WhiteBalance name losing to the implicit
// "custom" that Incremental{Temperature,Tint} sets, which would make every
// preset read back as Custom.

import { describe, expect, it } from "vitest";

import {
  applyWhiteBalance,
  createDefaultRecipe,
  normalizeRecipe,
  WB_PRESETS,
  whiteBalancePresetOffsets,
  type WhiteBalanceMode,
} from "./developRecipe";
import { parseCameraRawXmp, serializeCameraRawXmp } from "./xmp";

const basicOf = (mode: WhiteBalanceMode) => applyWhiteBalance(createDefaultRecipe().basic, mode);

describe("white balance presets", () => {
  it("every preset writes a distinct, in-domain Temp offset", () => {
    const seen = new Set<number>();
    for (const p of WB_PRESETS) {
      const { temp, tint } = whiteBalancePresetOffsets(p.mode);
      expect(Number.isFinite(temp) && Number.isFinite(tint)).toBe(true);
      expect(temp).toBeGreaterThanOrEqual(-1);
      expect(temp).toBeLessThanOrEqual(1);
      seen.add(Math.round(temp * 1e6));
    }
    // Flash and Daylight share 5500K, so 6 presets collapse to 5 Temp values;
    // anything fewer means a preset is a no-op copy of another.
    expect(seen.size).toBe(5);
  });

  it("warmer Kelvin means a warmer Temp offset", () => {
    const temp = (m: string) => whiteBalancePresetOffsets(m as never).temp;
    expect(temp("tungsten")).toBeLessThan(temp("fluorescent"));
    expect(temp("fluorescent")).toBeLessThan(temp("daylight"));
    expect(temp("daylight")).toBeLessThan(temp("cloudy"));
    expect(temp("cloudy")).toBeLessThan(temp("shade"));
  });

  it("Daylight is the reference, so it is the zero offset", () => {
    expect(whiteBalancePresetOffsets("daylight")).toEqual({ temp: 0, tint: 0 });
  });

  it("As Shot returns to the decoder's neutral; Custom keeps the hand-set values", () => {
    const edited = { ...createDefaultRecipe().basic, temp: 0.42, tint: -0.17 };
    expect(applyWhiteBalance(edited, "asShot")).toMatchObject({ wbMode: "asShot", temp: 0, tint: 0 });
    expect(applyWhiteBalance(edited, "custom")).toMatchObject({ wbMode: "custom", temp: 0.42, tint: -0.17 });
  });

  it("a stored wbMode outside the menu is not trusted", () => {
    expect(normalizeRecipe({ basic: { wbMode: "shade" } }).basic.wbMode).toBe("shade");
    expect(normalizeRecipe({ basic: { wbMode: "<script>" } }).basic.wbMode).toBe("asShot");
    expect(normalizeRecipe({ basic: { wbMode: 7 } }).basic.wbMode).toBe("asShot");
  });
});

describe("white balance ↔ crs:WhiteBalance", () => {
  for (const p of WB_PRESETS) {
    it(`${p.label} survives an XMP round trip with its Temp/Tint`, () => {
      const recipe = { ...createDefaultRecipe(), basic: basicOf(p.mode) };
      const doc = parseCameraRawXmp(serializeCameraRawXmp({ recipe }));
      expect(doc.recipe?.basic?.wbMode).toBe(p.mode);
      expect(doc.recipe?.basic?.temp ?? 0).toBeCloseTo(recipe.basic.temp, 4);
      expect(doc.recipe?.basic?.tint ?? 0).toBeCloseTo(recipe.basic.tint, 4);
      expect(doc.mapped).toContain("crs:WhiteBalance");
    });
  }

  it("a hand-edited WB writes no name and still reads back as Custom", () => {
    const recipe = { ...createDefaultRecipe(), basic: { ...basicOf("custom"), temp: 0.25, wbMode: "custom" as const } };
    const xml = serializeCameraRawXmp({ recipe });
    expect(xml).not.toContain("crs:WhiteBalance");
    expect(parseCameraRawXmp(xml).recipe?.basic?.wbMode).toBe("custom");
  });

  it("As Shot stays out of the document", () => {
    const xml = serializeCameraRawXmp({ recipe: createDefaultRecipe() });
    expect(xml).not.toContain("crs:WhiteBalance");
    expect(parseCameraRawXmp(xml).recipe?.basic?.wbMode ?? "asShot").toBe("asShot");
  });

  it("an ACR name beats the 'custom' the Incremental deltas imply", () => {
    const xml = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
      xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:WhiteBalance="Tungsten" crs:IncrementalTemperature="-84.5"></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const doc = parseCameraRawXmp(xml);
    expect(doc.recipe?.basic?.wbMode).toBe("tungsten");
    expect(doc.recipe?.basic?.temp).toBeCloseTo(-0.845, 3);
  });

  it("an unknown WhiteBalance value is reported, never guessed at", () => {
    const xml = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF
      xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"><rdf:Description rdf:about=""
      xmlns:crs="http://ns.adobe.com/camera-raw-settings/1.0/"
      crs:WhiteBalance="Underwater"></rdf:Description></rdf:RDF></x:xmpmeta>`;
    const doc = parseCameraRawXmp(xml);
    expect(doc.recipe?.basic?.wbMode).toBeUndefined();
    expect(doc.skipped.some((s) => s.startsWith("crs:WhiteBalance"))).toBe(true);
  });
});
