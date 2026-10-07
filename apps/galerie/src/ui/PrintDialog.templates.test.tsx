// OUT-16: the Print dialog gained a live page preview, a Template Browser
// (built-in + user templates that survive the session) and Create Saved Print.
// Pins the three pure pieces those rest on — the previewed pagination matching
// what print.ts composes, template storage, and config → PrintRun — plus that
// the preview really draws a cell per placed photo.

import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/plugin-dialog", () => ({ save: vi.fn() }));
vi.mock("@tauri-apps/plugin-fs", () => ({ writeFile: vi.fn() }));
vi.mock("../export", () => ({ developToImage: vi.fn() }));
// The preview's thumbnails pull the whole catalog/decode pipeline; the geometry
// under test is the wrapper cell, not the <img>.
vi.mock("./PreviewImg", () => ({ PreviewImg: () => null }));

import type { PhotoRow } from "../catalog/types";
import { DPI, PAGE_SIZES, printableBox } from "../lib/printLayout";
import {
  configToRun,
  deletePrintTemplate,
  DEFAULT_PRINT_CONFIG,
  listPrintTemplates,
  PrintPreview,
  previewPages,
  savePrintTemplate,
  type PrintConfig,
  type TemplateStorage,
} from "./PrintDialog";

const cfg = (over: Partial<PrintConfig> = {}): PrintConfig => ({ ...DEFAULT_PRINT_CONFIG, ...over });
const photos = (n: number): PhotoRow[] =>
  Array.from({ length: n }, (_, i) => ({ id: i + 1, path: `/photos/${i}.cr3`, format: "raw:CR3" }) as PhotoRow);

/** In-memory Web Storage stand-in (the templates never touch a real DOM). */
function fakeStorage(): TemplateStorage {
  const map = new Map<string, string>();
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
  };
}

describe("previewPages", () => {
  it("previews a single image as the printable box", () => {
    const c = cfg({ layout: "single" });
    const { page, pages } = previewPages(c, 1);
    expect(page).toEqual(PAGE_SIZES.Letter);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toEqual([{ rect: printableBox(page.w, page.h, c.margin), photo: 0 }]);
  });

  it("paginates a contact sheet the way print.ts does, last page partly filled", () => {
    const { pages } = previewPages(cfg({ layout: "contact", gridMode: "fixed", rows: 2, cols: 2 }), 10);
    expect(pages.map((p) => p.length)).toEqual([4, 4, 2]);
    // Photos flow row-major across the pages, in selection order.
    expect(pages.flat().map((c) => c.photo)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it("Repeat One Photo per Page gives each photo its own full page", () => {
    const { pages } = previewPages(
      cfg({ layout: "contact", gridMode: "fixed", rows: 2, cols: 2, repeatOne: true }),
      3,
    );
    expect(pages).toHaveLength(3);
    expect(pages[1].map((c) => c.photo)).toEqual([1, 1, 1, 1]);
  });

  it("landscape swaps the page and an auto grid follows the selection", () => {
    const { page, pages } = previewPages(cfg({ layout: "contact", orientation: "landscape" }), 9);
    expect(page).toEqual({ w: PAGE_SIZES.Letter.h, h: PAGE_SIZES.Letter.w });
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(9);
  });

  it("a picture package repeats one photo across the packed cells", () => {
    const { pages } = previewPages(cfg({ layout: "package", pkg: "(2) 5×7" }), 4);
    expect(pages).toHaveLength(1);
    expect(pages[0]).toHaveLength(2);
    expect(pages[0].every((c) => c.photo === 0)).toBe(true);
  });

  it("still previews one page with nothing selected", () => {
    expect(previewPages(cfg({ layout: "contact" }), 0).pages).toHaveLength(1);
  });
});

describe("template browser", () => {
  let storage: TemplateStorage;
  beforeEach(() => {
    storage = fakeStorage();
  });

  it("lists the built-ins before anything is saved", () => {
    const list = listPrintTemplates(storage);
    expect(list.length).toBeGreaterThan(0);
    expect(list.every((t) => t.builtIn)).toBe(true);
    expect(list.map((t) => t.name)).toContain("4×5 Contact Sheet");
  });

  it("a saved template survives a fresh read and restores the layout", () => {
    savePrintTemplate("  Studio Proofs  ", cfg({ layout: "contact", rows: 4, cols: 3, gridMode: "fixed" }), storage);
    const found = listPrintTemplates(storage).find((t) => t.name === "Studio Proofs");
    expect(found?.builtIn).toBeUndefined();
    expect(found?.config.rows).toBe(4);
    expect(found?.config.cols).toBe(3);
  });

  it("a user template shadows the built-in it is named after, and deleting restores it", () => {
    savePrintTemplate("2×2 Cells", cfg({ layout: "contact", gridMode: "fixed", rows: 7, cols: 7 }), storage);
    const shadowed = listPrintTemplates(storage).filter((t) => t.name === "2×2 Cells");
    expect(shadowed).toHaveLength(1);
    expect(shadowed[0].builtIn).toBeUndefined();
    expect(shadowed[0].config.rows).toBe(7);

    const after = deletePrintTemplate("2×2 Cells", storage).filter((t) => t.name === "2×2 Cells");
    expect(after[0].builtIn).toBe(true);
    expect(after[0].config.rows).toBe(2);
  });

  it("a template written by an older build gets today's defaults filled in", () => {
    storage.setItem("galerie.printTemplates", JSON.stringify([{ name: "Legacy", config: { layout: "contact" } }]));
    const legacy = listPrintTemplates(storage).find((t) => t.name === "Legacy");
    expect(legacy?.config.layout).toBe("contact");
    expect(legacy?.config.bg).toBe(DEFAULT_PRINT_CONFIG.bg);
  });

  it("corrupt storage reads as no user templates rather than throwing", () => {
    storage.setItem("galerie.printTemplates", "{not json");
    expect(listPrintTemplates(storage).every((t) => t.builtIn)).toBe(true);
  });

  it("a blank name is not saved", () => {
    expect(savePrintTemplate("   ", cfg(), storage).every((t) => t.builtIn)).toBe(true);
  });
});

describe("configToRun", () => {
  it("maps a contact-sheet config onto what print.ts takes", () => {
    const run = configToRun(cfg({ layout: "contact", gridMode: "fixed", rows: 2, cols: 5, quality: 80 }));
    expect(run).toMatchObject({ layout: "contact", grid: { rows: 2, cols: 5 }, quality: 0.8, cell: undefined });
    expect(run.sizes).toBeUndefined();
  });

  it("an auto grid leaves the shape to print.ts", () => {
    expect(configToRun(cfg({ layout: "contact", gridMode: "auto" })).grid).toBeUndefined();
  });

  it("converts the stroke from points to layout px and drops a blank watermark", () => {
    const run = configToRun(cfg({ strokeOn: true, strokePt: 6, strokeColor: "#ff0000", wmText: "   " }));
    expect(run.image?.stroke).toEqual({ width: Math.round((6 / 72) * DPI), color: "#ff0000" });
    expect(run.decor?.watermark).toBeNull();
  });

  it("a picture package carries its cell sizes in layout px", () => {
    const run = configToRun(cfg({ layout: "package", pkg: "(2) 5×7" }));
    expect(run.sizes).toEqual([
      { w: 7 * DPI, h: 5 * DPI },
      { w: 7 * DPI, h: 5 * DPI },
    ]);
    // Repeat One is a contact-sheet-only checkbox.
    expect(run.image?.repeatOne).toBe(false);
  });

  it("an unknown page name from an old template falls back instead of throwing", () => {
    expect(configToRun(cfg({ pageName: "Tabloid" })).page).toEqual(PAGE_SIZES.Letter);
  });
});

describe("PrintPreview", () => {
  it("draws one cell per placed photo and labels the page it is showing", () => {
    const html = renderToStaticMarkup(
      <PrintPreview photos={photos(10)} cfg={cfg({ layout: "contact", gridMode: "fixed", rows: 2, cols: 2 })} />,
    );
    expect(html.split("data-print-cell").length - 1).toBe(4);
    expect(html).toContain('aria-label="Print preview, page 1 of 3"');
    expect(html).toContain("Page 1 of 3");
  });

  it("shows the page background and no pager for a one-page layout", () => {
    const html = renderToStaticMarkup(<PrintPreview photos={photos(1)} cfg={cfg({ layout: "single", bg: "#112233" })} />);
    expect(html.split("data-print-cell").length - 1).toBe(1);
    expect(html).toContain("background:#112233");
    expect(html).not.toContain("Page 1 of");
  });
});
