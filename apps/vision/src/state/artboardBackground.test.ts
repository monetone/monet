// Unit tests for the Artboard Options background-colour helpers. Engine-free
// (node); the engine side (compositing + transparent PNG export) is covered by
// the Rust #[test]s in packages/engine/src/raster/mod.rs.
import { describe, it, expect } from "vitest";
import {
  ARTBOARD_BACKGROUNDS, DEFAULT_ARTBOARD_BACKGROUND, artboardBackgroundChoice,
  artboardBackgroundHex, resolveArtboardBackground, toArtboardBackground, type RGBA,
} from "./artboardBackground";

describe("resolveArtboardBackground", () => {
  const white: RGBA = [255, 255, 255, 255];
  it("maps the fixed picks", () => {
    expect(resolveArtboardBackground("white", [0, 0, 0, 255], "#000000")).toEqual([255, 255, 255, 255]);
    expect(resolveArtboardBackground("black", white, "#000000")).toEqual([0, 0, 0, 255]);
  });
  it("transparent only drops alpha, keeping the colour to come back to", () => {
    expect(resolveArtboardBackground("transparent", [18, 52, 86, 255], "#000000")).toEqual([18, 52, 86, 0]);
  });
  it("other takes the swatch colour, opaque", () => {
    expect(resolveArtboardBackground("other", [0, 0, 0, 0], "#123456")).toEqual([18, 52, 86, 255]);
  });
});

describe("artboardBackgroundChoice", () => {
  it("classifies the presets", () => {
    expect(artboardBackgroundChoice([255, 255, 255, 255])).toBe("white");
    expect(artboardBackgroundChoice([0, 0, 0, 255])).toBe("black");
    expect(artboardBackgroundChoice([18, 52, 86, 255])).toBe("other");
  });
  it("alpha 0 reads as transparent whatever colour it kept", () => {
    expect(artboardBackgroundChoice([255, 255, 255, 0])).toBe("transparent");
    expect(artboardBackgroundChoice([18, 52, 86, 0])).toBe("transparent");
  });
  it("round-trips every dropdown entry", () => {
    for (const { value } of ARTBOARD_BACKGROUNDS) {
      const rgba = resolveArtboardBackground(value, [18, 52, 86, 255], "#123456");
      expect(artboardBackgroundChoice(rgba)).toBe(value);
    }
  });
});

describe("artboardBackgroundHex", () => {
  it("pads and clamps to #rrggbb", () => {
    expect(artboardBackgroundHex([0, 0, 0, 255])).toBe("#000000");
    expect(artboardBackgroundHex([18, 52, 86, 0])).toBe("#123456");
    expect(artboardBackgroundHex([300, -5, 255, 255])).toBe("#ff00ff");
  });
});

describe("toArtboardBackground", () => {
  it("falls back to opaque white when the id isn't an artboard", () => {
    expect(toArtboardBackground(null)).toEqual(DEFAULT_ARTBOARD_BACKGROUND);
    expect(toArtboardBackground(new Uint8Array())).toEqual(DEFAULT_ARTBOARD_BACKGROUND);
  });
  it("reads the engine's Uint8Array", () => {
    expect(toArtboardBackground(new Uint8Array([0, 0, 0, 255]))).toEqual([0, 0, 0, 255]);
  });
});
