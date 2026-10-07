// Preferences ▸ Units & Rulers + Image Size units — the print-unit path the
// Image Size dialog resolves through. Physical units only mean anything when
// they convert through the document's print resolution, so the round-trips are
// checked at a real 300 ppi document, not the 72 ppi default.
import { describe, expect, it, beforeEach } from "vitest";
import {
  IMAGE_SIZE_UNITS,
  DOCUMENT_SIZE_UNITS,
  imageSizeFromPixels,
  imageSizeToPixels,
  loadRulerUnit,
  saveRulerUnit,
} from "./docPresets";

// Minimal Storage stand-in — the unit suite runs in node, which has none.
function installStorage(): Map<string, string> {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
  return cells;
}

describe("Image Size units", () => {
  it("offers every document unit plus Photoshop's Percent", () => {
    expect(IMAGE_SIZE_UNITS.map((u) => u.value))
      .toEqual([...DOCUMENT_SIZE_UNITS.map((u) => u.value), "percent"]);
  });

  it("resolves physical units through the document's print resolution", () => {
    // 8.5 × 11 in at 300 ppi is US Letter: 2550 × 3300 px.
    expect(imageSizeToPixels(8.5, "in", 2550, 300)).toBe(2550);
    expect(imageSizeToPixels(11, "in", 3300, 300)).toBe(3300);
    // The same length at 72 ppi is a different pixel count — the ppi is load-bearing.
    expect(imageSizeToPixels(8.5, "in", 2550, 72)).toBe(612);
    expect(imageSizeToPixels(210, "mm", 2480, 300)).toBe(2480);
    expect(imageSizeToPixels(1, "cm", 1000, 254)).toBe(100);
  });

  it("round-trips a pixel size through each unit", () => {
    for (const unit of IMAGE_SIZE_UNITS) {
      const shown = imageSizeFromPixels(2550, unit.value, 2550, 300);
      expect(imageSizeToPixels(shown, unit.value, 2550, 300)).toBe(2550);
    }
  });

  it("keeps Percent relative to the dimension the dialog opened on", () => {
    expect(imageSizeFromPixels(1275, "percent", 2550, 300)).toBe(50);
    expect(imageSizeToPixels(50, "percent", 2550, 300)).toBe(1275);
  });

  it("never resolves below one pixel", () => {
    expect(imageSizeToPixels(0, "in", 2550, 300)).toBe(1);
    expect(imageSizeToPixels(-4, "cm", 2550, 300)).toBe(1);
    expect(imageSizeToPixels(0.0001, "percent", 2550, 300)).toBe(1);
  });
});

describe("ruler unit preference", () => {
  beforeEach(() => { installStorage(); });

  it("defaults to pixels and persists a chosen unit", () => {
    expect(loadRulerUnit()).toBe("px");
    expect(saveRulerUnit("cm")).toBe("cm");
    expect(loadRulerUnit()).toBe("cm");
  });

  it("rejects a unit that is not a real document unit", () => {
    saveRulerUnit("cm");
    expect(saveRulerUnit("furlongs")).toBe("px");
    expect(loadRulerUnit()).toBe("px"); // the bad write cleared the stale value
  });

  it("stores nothing for the pixel default", () => {
    const cells = installStorage();
    saveRulerUnit("in");
    expect(cells.size).toBe(1);
    saveRulerUnit("px");
    expect(cells.size).toBe(0);
  });

  it("falls back to pixels when storage is unavailable", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadRulerUnit()).toBe("px");
    expect(() => saveRulerUnit("mm")).not.toThrow();
  });
});
