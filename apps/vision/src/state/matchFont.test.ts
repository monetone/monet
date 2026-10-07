import { describe, expect, it } from "vitest";
import { fontFamilyClass, fontTokens, rankFontCandidates, rankFontMatches } from "./matchFont";
import { FONTS } from "../text/spec";

describe("Match Font candidate ranking", () => {
  it("classifies generic and distinctive font stacks", () => {
    expect(fontFamilyClass("Georgia, serif")).toBe("serif");
    expect(fontFamilyClass("'Courier New', Courier, monospace")).toBe("mono");
    expect(fontFamilyClass("Impact, Haettenschweiler, sans-serif")).toBe("display");
    expect(fontFamilyClass("Helvetica, Arial, sans-serif")).toBe("sans");
  });

  it("extracts stable useful tokens from a CSS font stack", () => {
    expect(fontTokens("'Times New Roman', Times, serif")).toEqual(["times", "roman"]);
  });

  it("keeps an exact editable match first", () => {
    const ranked = rankFontCandidates("Arial, sans-serif", FONTS);
    expect(ranked[0]).toBe("Arial, sans-serif");
  });

  it("reports exact editable matches as high-confidence 100 percent", () => {
    const [match] = rankFontMatches("Arial, sans-serif", FONTS);
    expect(match).toMatchObject({
      font: "Arial, sans-serif",
      display: "Arial",
      confidence: 100,
      confidenceLabel: "High",
    });
  });

  it("uses family tokens to match external font stacks to editable fonts", () => {
    const ranked = rankFontCandidates("Futura, Helvetica, Arial, sans-serif", FONTS);
    expect(ranked[0]).toBe("Helvetica, Arial, sans-serif");
    expect(ranked[1]).toBe("Arial, sans-serif");
  });

  it("grades external-stack matches by score instead of showing every fallback as exact", () => {
    const ranked = rankFontMatches("Futura, Helvetica, Arial, sans-serif", FONTS);
    expect(ranked[0]).toMatchObject({
      font: "Helvetica, Arial, sans-serif",
      confidence: 76,
      confidenceLabel: "High",
    });
    expect(ranked[1]).toMatchObject({
      font: "Arial, sans-serif",
      confidence: 62,
      confidenceLabel: "Medium",
    });
  });

  it("marks class-only fallback guesses as low confidence", () => {
    const ranked = rankFontMatches("Mystery Sans, sans-serif", ["Alpha Sans, sans-serif", "Beta Sans, sans-serif"]);
    expect(ranked.map((m) => m.font)).toEqual(["Alpha Sans, sans-serif", "Beta Sans, sans-serif"]);
    expect(ranked[0]).toMatchObject({ confidence: 48, confidenceLabel: "Low" });
  });

  it("prefers matching mono and serif fallbacks over unrelated faces", () => {
    expect(rankFontCandidates("Courier, monospace", FONTS)[0]).toBe("'Courier New', Courier, monospace");
    expect(rankFontCandidates("Bodoni, Times, serif", FONTS)[0]).toBe("'Times New Roman', Times, serif");
  });

  it("preserves source order when scores tie", () => {
    const candidates = ["Alpha Sans, sans-serif", "Beta Sans, sans-serif"];
    expect(rankFontCandidates("Unknown Sans, sans-serif", candidates)).toEqual(candidates);
  });
});
