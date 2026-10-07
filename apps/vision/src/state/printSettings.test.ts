// Guards #440: File ▸ Print…'s layout math (where the image lands on the media
// and how big it prints → the print document's page CSS), its settings
// persistence (Print One Copy reuses what the dialog last saved), and the
// Match Print Colors / Show Paper White preview remap.
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  PRINT_DEFAULTS, encodeProfileIcc, loadPrintSettings, normalizePrintSettings, printLayout, printLayoutClips,
  printPageCss, printPreviewPixels, printSettingsError, savePrintSettings, type PrintSettings,
} from "./printSettings";

let cells: Map<string, string>;
beforeEach(() => {
  cells = new Map();
  vi.stubGlobal("localStorage", { getItem: (k: string) => cells.get(k) ?? null, setItem: (k: string, v: string) => cells.set(k, v) });
});

const settings = (patch: Partial<PrintSettings> = {}): PrintSettings => ({ ...PRINT_DEFAULTS, ...patch });
const round = (layout: ReturnType<typeof printLayout>) =>
  Object.fromEntries(Object.entries(layout).map(([k, v]) => [k, Math.round(v * 10000) / 10000]));

describe("File ▸ Print layout (#440)", () => {
  // 3000 × 2000 px at 300 ppi prints 10 × 6.667 in at 100%.
  it("scales to fit the media and centres the image", () => {
    const layout = printLayout(settings(), 3000, 2000, 300);
    expect(round(layout)).toEqual({
      pageWidth: 8.5, pageHeight: 11, width: 8.5, height: 5.6667, left: 0, top: 2.6667, scale: 85, ppi: 352.9412,
    });
    expect(printLayoutClips(layout)).toBe(false);
    expect(printPageCss(layout)).toBe(
      "@page{size:8.5in 11in;margin:0}html,body{margin:0;padding:0;background:#fff}" +
      "body{position:relative;overflow:hidden;width:8.5in;height:11in}" +
      "img{position:absolute;display:block;left:0in;top:2.6667in;width:8.5in;height:5.6667in}",
    );
  });

  it("places an explicit scale at Top/Left on a landscape page", () => {
    const layout = printLayout(settings({ fit: false, scale: 50, center: false, top: 1, left: 0.5, landscape: true }), 3000, 2000, 300);
    expect(round(layout)).toEqual({
      pageWidth: 11, pageHeight: 8.5, width: 5, height: 3.3333, left: 0.5, top: 1, scale: 50, ppi: 600,
    });
    expect(printPageCss(layout)).toContain("@page{size:11in 8.5in;margin:0}");
    expect(printPageCss(layout)).toContain("img{position:absolute;display:block;left:0.5in;top:1in;width:5in;height:3.3333in}");
  });

  it("sizes the page from the media, in inches", () => {
    const a4 = printLayout(settings({ media: "a4" }), 100, 100, 72);
    expect(printPageCss(a4)).toContain("@page{size:8.2677in 11.6929in;margin:0}");
    // The print size follows the document's own ppi: 720 px at 72 ppi is 10 in.
    expect(printLayout(settings({ fit: false, scale: 100 }), 720, 360, 72)).toMatchObject({ width: 10, height: 5, ppi: 72 });
  });

  it("flags a print that runs off the media", () => {
    expect(printLayoutClips(printLayout(settings({ fit: false, scale: 150 }), 2550, 3300, 300))).toBe(true);
    expect(printLayoutClips(printLayout(settings({ fit: false, scale: 100 }), 2550, 3300, 300))).toBe(false);
  });

  it("reports settings it cannot print as something to fix", () => {
    const check = (patch: Partial<PrintSettings>) => {
      const s = settings(patch);
      return printSettingsError(s, printLayout(s, 3000, 2000, 300));
    };
    expect(check({})).toBeNull();
    expect(check({ fit: false, scale: 0 })).toMatch(/Scale must be between 1% and 1000%/);
    expect(check({ fit: false, scale: Number.NaN })).toMatch(/Scale must be between/);
    expect(check({ fit: true, scale: 0 }), "fit ignores the typed scale").toBeNull();
    expect(check({ center: false, top: 0, left: 20 })).toMatch(/entirely off the page/);
    expect(check({ center: false, top: -7, left: 0 })).toMatch(/entirely off the page/);
    expect(check({ center: false, top: 500, left: 0 })).toMatch(/within 100 inches/);
    expect(check({ center: true, top: 500 }), "Center ignores Top/Left").toBeNull();
    expect(check({ colorHandling: "photoshop", profile: "icc", profileName: "Epson Luster", profileIcc: "" }))
      .toBe("Load the printer profile “Epson Luster” again (Printer Profile ▸ Load Profile…), or choose Printer Manages Colors.");
    expect(check({ colorHandling: "printer", profile: "icc", profileIcc: "" }), "only a managed print needs it").toBeNull();
    expect(check({ colorHandling: "photoshop", profile: "icc", profileIcc: encodeProfileIcc(new Uint8Array([1, 2, 3])) })).toBeNull();
  });
});

describe("File ▸ Print settings persist for Print One Copy (#440)", () => {
  it("opens on the defaults, then on what Done or Print saved", () => {
    expect(loadPrintSettings()).toEqual(PRINT_DEFAULTS);
    const saved = settings({
      media: "a4", landscape: true, center: false, top: 1.25, left: 0.5, fit: false, scale: 42,
      colorHandling: "photoshop", profile: "icc", profileName: "Press", profileIcc: encodeProfileIcc(new Uint8Array([7, 8, 9])),
      intent: 3, bpc: false, matchPrintColors: true, showPaperWhite: true,
    });
    savePrintSettings(saved);
    expect(loadPrintSettings()).toEqual(saved);
  });

  it("falls back per field on a stale or hand-edited blob", () => {
    cells.set("mv.print", JSON.stringify({
      media: "poster", landscape: "yes", scale: 5000, top: "1", colorHandling: "photoshop", intent: 9, profileIcc: "@@@",
    }));
    expect(loadPrintSettings()).toEqual({ ...PRINT_DEFAULTS, scale: 1000, colorHandling: "photoshop" });
    cells.set("mv.print", "{not json");
    expect(loadPrintSettings()).toEqual(PRINT_DEFAULTS);
    expect(normalizePrintSettings(null)).toEqual(PRINT_DEFAULTS);
  });

  it("keeps the rest when a loaded profile outgrows storage, and then asks for the profile", () => {
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => cells.get(k) ?? null,
      setItem: (k: string, v: string) => {
        if (v.length > 400) throw new DOMException("quota", "QuotaExceededError");
        cells.set(k, v);
      },
    });
    const big = settings({
      colorHandling: "photoshop", profile: "icc", profileName: "Big Printer", profileIcc: encodeProfileIcc(new Uint8Array(1000)), scale: 60, fit: false,
    });
    savePrintSettings(big);
    const reloaded = loadPrintSettings();
    expect(reloaded).toMatchObject({ scale: 60, fit: false, profile: "icc", profileName: "Big Printer", profileIcc: "" });
    expect(printSettingsError(reloaded, printLayout(reloaded, 100, 100, 72))).toMatch(/Load the printer profile “Big Printer” again/);
  });
});

describe("File ▸ Print preview (#440)", () => {
  // n = 2 lattices, R fastest. The proof LUT renders black as ink black (40).
  const corner = (r: number, g: number, b: number) => [r * 255, g * 255, b * 255] as const;
  const lattice = (fn: (r: number, g: number, b: number) => number[]) => {
    const out: number[] = [];
    for (let b = 0; b < 2; b++) for (let g = 0; g < 2; g++) for (let r = 0; r < 2; r++) out.push(...fn(r, g, b));
    return new Uint8Array(out);
  };
  const proofLut = lattice((r, g, b) => (r || g || b ? [...corner(r, g, b), 0] : [40, 40, 40, 0]));
  const pixels = new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 128]);

  it("Match Print Colors shows the proof with the ink black mapped to the screen's", () => {
    expect(Array.from(printPreviewPixels(pixels, proofLut, true, false))).toEqual([0, 0, 0, 255, 255, 255, 255, 128]);
  });

  it("Show Paper White tints the paper and shows the true ink black", () => {
    const paper = Array.from(printPreviewPixels(pixels, proofLut, true, true));
    expect(paper.slice(0, 3).every((v) => v > 30 && v < 40), `ink black ${paper}`).toBe(true);
    expect(paper.slice(4, 7).some((v) => v < 250), `paper white ${paper}`).toBe(true);
    expect([paper[3], paper[7]]).toEqual([255, 128]);
  });

  it("without Match Print Colors shows the document through the display LUT", () => {
    const swap = lattice((r, g, b) => [...corner(b, g, r)]);
    expect(Array.from(printPreviewPixels(new Uint8ClampedArray([255, 0, 0, 255]), swap, false, false))).toEqual([0, 0, 255, 255]);
    expect(Array.from(printPreviewPixels(pixels, new Uint8Array(), false, false)), "sRGB: no LUT").toEqual(Array.from(pixels));
  });
});
