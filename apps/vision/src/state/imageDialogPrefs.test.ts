// Guards #442: Indexed Color, Bitmap and Shadows/Highlights reopen with the
// values their last OK used. Each dialog seeds its state from load*() when it
// opens and hands it to save*() on OK, so opening one twice is exactly this
// load → save → load round trip over localStorage.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  BITMAP_DEFAULTS, BITMAP_MAX_OUTPUT_PPI, INDEXED_COLOR_DEFAULTS, SHADOWS_HIGHLIGHTS_DEFAULTS,
  bitmapOutputFor, loadBitmapPrefs, loadIndexedColorPrefs, loadShadowsHighlightsPrefs,
  saveBitmapPrefs, saveIndexedColorPrefs, saveShadowsHighlightsPrefs,
} from "./imageDialogPrefs";

let cells: Map<string, string>;
beforeEach(() => {
  cells = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
});

describe("Indexed Color reopens with the last OK'd values (#442)", () => {
  it("opens on Photoshop's defaults, then on what OK saved", () => {
    expect(loadIndexedColorPrefs()).toEqual(INDEXED_COLOR_DEFAULTS);
    // Palette=Web, Forced=Primaries, Matte=#ff0000 — the audit's repro.
    const ok = { palette: 2, colors: 64, forced: 2, dither: false, transparency: false, matte: "#ff0000", custom: ["#123456"] };
    saveIndexedColorPrefs(ok);
    expect(loadIndexedColorPrefs()).toEqual(ok);
    expect(loadIndexedColorPrefs(), "and again on the next open").toEqual(ok);
  });

  it("falls back per field on a stale or hand-edited blob", () => {
    cells.set("mv.indexedColor", JSON.stringify({ palette: 99, colors: "lots", forced: -1, dither: "yes", matte: "red", custom: ["#00ff00", 7, "nope"] }));
    expect(loadIndexedColorPrefs()).toEqual({
      ...INDEXED_COLOR_DEFAULTS, palette: 8, forced: 0, custom: ["#00ff00"],
    });
    cells.set("mv.indexedColor", "{not json");
    expect(loadIndexedColorPrefs()).toEqual(INDEXED_COLOR_DEFAULTS);
  });
});

describe("Bitmap reopens with the last OK'd values (#442)", () => {
  it("opens on the defaults — Output following the document — then on what OK saved", () => {
    expect(loadBitmapPrefs()).toEqual(BITMAP_DEFAULTS);
    expect(BITMAP_DEFAULTS.output, "0 means the dialog shows the document's own ppi").toBe(0);
    const ok = { method: 3, output: 600, frequency: 85, angle: 22.5, shape: 3 };
    saveBitmapPrefs(ok, 72);
    expect(loadBitmapPrefs()).toEqual(ok);
    expect(loadBitmapPrefs()).toEqual(ok);
  });

  // The verifier's repro: OK on a 72 ppi document without touching Output, then
  // Bitmap on a 300 ppi one. Output must open on 300 — the second document's
  // own — or its OK resamples the image down to 72 ppi.
  it("keeps an untouched Output following each document", () => {
    const docA = 72, docB = 300;
    const openA = bitmapOutputFor(loadBitmapPrefs(), docA);
    expect(openA).toBe(docA);
    saveBitmapPrefs({ ...BITMAP_DEFAULTS, method: 0, output: openA }, docA);
    expect(bitmapOutputFor(loadBitmapPrefs(), docB)).toBe(docB);
    expect(loadBitmapPrefs().method, "the rest still round-trips").toBe(0);
  });

  it("remembers an Output the user picked, for the next document too", () => {
    saveBitmapPrefs({ ...BITMAP_DEFAULTS, output: 1200 }, 72);
    expect(bitmapOutputFor(loadBitmapPrefs(), 300)).toBe(1200);
  });

  it("never hands the dialog a method, shape or resolution it cannot show", () => {
    cells.set("mv.bitmap", JSON.stringify({ method: 7, output: Number.MAX_VALUE, frequency: 0, angle: 900, shape: 2.6 }));
    expect(loadBitmapPrefs()).toEqual({ method: 4, output: BITMAP_MAX_OUTPUT_PPI, frequency: 1, angle: 180, shape: 3 });
    expect(BITMAP_MAX_OUTPUT_PPI, "the engine's own ceiling, so its refusal message names what the field showed").toBe(65_535);
    cells.set("mv.bitmap", JSON.stringify({ output: 0.5 }));
    expect(loadBitmapPrefs().output, "a sub-1 ppi reads as 'follow the document'").toBe(0);
  });
});

describe("Shadows/Highlights reopens with the last OK'd values (#442)", () => {
  it("opens on Photoshop's defaults, then on what OK saved, Radius and clips included", () => {
    expect(loadShadowsHighlightsPrefs()).toEqual(SHADOWS_HIGHLIGHTS_DEFAULTS);
    const ok = {
      shadowsAmount: 60, shadowsWidth: 40, shadowsRadius: 120, highlightsAmount: 15, highlightsWidth: 25,
      highlightsRadius: 8, color: -30, midtone: 45, blackClip: 0.5, whiteClip: 1.25,
    };
    saveShadowsHighlightsPrefs(ok);
    expect(loadShadowsHighlightsPrefs()).toEqual(ok);
    expect(loadShadowsHighlightsPrefs()).toEqual(ok);
  });

  it("clamps into the sliders' ranges and drops what is not a number", () => {
    cells.set("mv.shadowsHighlights", JSON.stringify({ shadowsWidth: 0, highlightsRadius: 1e6, blackClip: null, color: -500 }));
    expect(loadShadowsHighlightsPrefs()).toEqual({
      ...SHADOWS_HIGHLIGHTS_DEFAULTS, shadowsWidth: 1, highlightsRadius: 2500, color: -100,
    });
  });
});

it("opens on the defaults and OK still works when storage is denied", () => {
  vi.stubGlobal("localStorage", {
    getItem: () => { throw new Error("denied"); },
    setItem: () => { throw new Error("denied"); },
  });
  expect(loadIndexedColorPrefs()).toEqual(INDEXED_COLOR_DEFAULTS);
  expect(() => saveBitmapPrefs({ ...BITMAP_DEFAULTS, method: 0 }, 72)).not.toThrow();
});
