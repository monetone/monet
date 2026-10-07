// Unit tests for the Artboard tool geometry/preset/orientation logic. Engine-free
// (node); the tool wiring + engine move/resize are covered by
// e2e/artboard-tool.spec.ts and the Rust #[test]s.
import { describe, it, expect } from "vitest";
import {
  ARTBOARD_PRESETS, MIN_ARTBOARD, orientSize, presetSize, artboardRect,
  artboardDragIsValid, artboardHandles, hitTestArtboard, hitTestArtboardHandle,
  moveArtboardBy, resizeArtboardTo,
} from "./artboardTool";

describe("orientSize", () => {
  it("landscape puts the long side on width", () => {
    expect(orientSize(1080, 1920, "landscape")).toEqual({ w: 1920, h: 1080 });
    expect(orientSize(1920, 1080, "landscape")).toEqual({ w: 1920, h: 1080 });
  });
  it("portrait puts the long side on height", () => {
    expect(orientSize(1920, 1080, "portrait")).toEqual({ w: 1080, h: 1920 });
    expect(orientSize(1080, 1920, "portrait")).toEqual({ w: 1080, h: 1920 });
  });
  it("keeps a square unchanged", () => {
    expect(orientSize(1000, 1000, "portrait")).toEqual({ w: 1000, h: 1000 });
    expect(orientSize(1000, 1000, "landscape")).toEqual({ w: 1000, h: 1000 });
  });
});

describe("presetSize", () => {
  it("resolves a known preset, oriented", () => {
    const p = ARTBOARD_PRESETS.find((q) => q.name.includes("Story"))!; // 1080 × 1920
    expect(presetSize(p.name, "portrait")).toEqual({ w: 1080, h: 1920 });
    expect(presetSize(p.name, "landscape")).toEqual({ w: 1920, h: 1080 });
  });
  it("keeps physical document presets canonical for artboards", () => {
    const p = ARTBOARD_PRESETS.find((q) => q.name.startsWith("A4"))!;
    expect(presetSize(p.name, "portrait")).toEqual({ w: 2480, h: 3508 });
    expect(presetSize(p.name, "landscape")).toEqual({ w: 3508, h: 2480 });
  });
  it("returns undefined for an unknown preset", () => {
    expect(presetSize("Nope", "portrait")).toBeUndefined();
  });
  it("exposes a non-empty preset list", () => {
    expect(ARTBOARD_PRESETS.length).toBeGreaterThan(0);
  });
});

describe("artboardRect", () => {
  it("normalizes a forward drag", () => {
    expect(artboardRect(10, 20, 110, 80, false, false)).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });
  it("normalizes a reversed drag", () => {
    expect(artboardRect(110, 80, 10, 20, false, false)).toEqual({ x: 10, y: 20, w: 100, h: 60 });
  });
  it("Shift constrains to a square", () => {
    const r = artboardRect(0, 0, 100, 40, true, false);
    expect(r.w).toBe(r.h);
  });
  it("Alt grows from the start point", () => {
    expect(artboardRect(50, 50, 70, 60, false, true)).toEqual({ x: 30, y: 40, w: 40, h: 20 });
  });
});

describe("artboardDragIsValid", () => {
  it("rejects a sub-threshold drag (a click)", () => {
    expect(artboardDragIsValid(MIN_ARTBOARD - 1, 100)).toBe(false);
    expect(artboardDragIsValid(100, MIN_ARTBOARD - 1)).toBe(false);
  });
  it("accepts a real rectangle", () => {
    expect(artboardDragIsValid(MIN_ARTBOARD, MIN_ARTBOARD)).toBe(true);
  });
});

describe("select/move/resize geometry (reused slice maths on artboard rects)", () => {
  const abs = [
    { x: 0, y: 0, w: 100, h: 80 },
    { x: 120, y: 0, w: 100, h: 80 },
  ];
  it("hit-tests the artboard body, topmost first", () => {
    expect(hitTestArtboard(abs, 50, 40)).toBe(0);
    expect(hitTestArtboard(abs, 150, 40)).toBe(1);
    expect(hitTestArtboard(abs, 300, 300)).toBe(-1);
  });
  it("yields 8 handles and hit-tests the BR corner", () => {
    const h = artboardHandles(abs[0]);
    expect(h).toHaveLength(8);
    expect(hitTestArtboardHandle(abs[0], 100, 80, 5)).toBe(4); // BR
  });
  it("moves the body keeping its size", () => {
    expect(moveArtboardBy(abs[0], 30, 20)).toEqual({ x: 30, y: 20, w: 100, h: 80 });
  });
  it("resizes by dragging the BR handle", () => {
    expect(resizeArtboardTo(abs[0], 4, 160, 140)).toEqual({ x: 0, y: 0, w: 160, h: 140 });
  });
});
