// OUT-09: the Book module. These pin the pure half — the trim/cover sheet
// sizes, the Page panel's cell templates (margin, cell padding, full bleed),
// Auto Layout's pagination and its all-blank-preset guard, the spread view's
// grouping and the alternating page numbers.

import { describe, expect, it } from "vitest";

import {
  AUTO_LAYOUT_PRESETS,
  autoLayout,
  BOOK_SIZES,
  coverPageSize,
  pageCells,
  pageNumberAnchor,
  PAGE_TEMPLATES,
  spineWidth,
  spreads,
  type BookPage,
} from "./bookLayout";
import { DPI } from "./printLayout";

const trim = BOOK_SIZES["Standard Portrait"];
const preset = (templates: string[]) => ({ name: "test", templates });

describe("book sizes and covers", () => {
  it("keeps the trim sizes on printLayout's DPI grid", () => {
    expect(trim).toEqual({ w: 8 * DPI, h: 10 * DPI });
    expect(BOOK_SIZES["Large Landscape"]).toEqual({ w: 13 * DPI, h: 11 * DPI });
  });

  it("prints a softcover cover on one trim page and a hardcover as a wrap", () => {
    expect(coverPageSize(trim, "softcover", 40)).toEqual(trim);
    const wrap = coverPageSize(trim, "hardcover-image", 40);
    expect(wrap).toEqual({ w: trim.w * 2 + spineWidth(40), h: trim.h });
    expect(spineWidth(40)).toBe(Math.round(40 * 0.0025 * DPI));
    // A thicker book needs a wider spine; a negative count can't shrink it.
    expect(spineWidth(200)).toBeGreaterThan(spineWidth(40));
    expect(spineWidth(-5)).toBe(0);
  });
});

describe("pageCells", () => {
  const opts = { margin: 150, padding: 0 };

  it("lays a template's cells inside the page margin", () => {
    const cells = pageCells(trim, "four", opts);
    expect(cells).toHaveLength(4);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(150);
      expect(c.y).toBeGreaterThanOrEqual(150);
      expect(c.x + c.w).toBeLessThanOrEqual(trim.w - 150);
      expect(c.y + c.h).toBeLessThanOrEqual(trim.h - 150);
    }
  });

  it("takes cell padding off every side, never eating the cell whole", () => {
    const [plain] = pageCells(trim, "one", opts);
    const [padded] = pageCells(trim, "one", { ...opts, padding: 30 });
    expect(padded.x).toBe(plain.x + 30);
    expect(padded.w).toBe(plain.w - 60);
    // Absurd padding still leaves a drawable cell rather than a negative one.
    expect(pageCells(trim, "one", { ...opts, padding: 99999 })[0].w).toBe(1);
  });

  it("spans the trim for a full-bleed template", () => {
    expect(pageCells(trim, "one-bleed", opts)[0]).toEqual({ x: 0, y: 0, w: trim.w, h: trim.h });
    expect(pageCells(trim, "blank", opts)).toEqual([]);
  });

  it("falls back for a template id this build doesn't know", () => {
    expect(pageCells(trim, "from-a-newer-build", opts)).toEqual(pageCells(trim, "one", opts));
  });
});

describe("autoLayout", () => {
  const ids = [1, 2, 3, 4, 5];

  it("puts the first photo on the cover and flows the rest through the cycle", () => {
    const pages = autoLayout(ids, preset(["two-h"]));
    expect(pages[0]).toEqual({ template: "cover", photos: [1], text: "" });
    expect(pages.slice(1).map((p) => p.photos)).toEqual([[1, 2], [3, 4], [5]]);
  });

  it("cycles a multi-template preset, blanks included", () => {
    const pages = autoLayout([1, 2], preset(["blank", "one"]));
    expect(pages.map((p) => p.template)).toEqual(["cover", "blank", "one", "blank", "one"]);
    expect(pages[2].photos).toEqual([1]);
    expect(pages[4].photos).toEqual([2]);
  });

  it("stops instead of looping forever on a preset with no photo cells", () => {
    const pages = autoLayout(ids, preset(["blank", "blank"]));
    expect(pages.map((p) => p.template)).toEqual(["cover", "blank", "blank"]);
  });

  it("lays out nothing for an empty selection", () => {
    expect(autoLayout([], AUTO_LAYOUT_PRESETS[0])).toEqual([]);
  });

  it("ships presets that all name real templates", () => {
    for (const p of AUTO_LAYOUT_PRESETS) {
      for (const id of p.templates) expect(PAGE_TEMPLATES[id]).toBeDefined();
    }
  });
});

describe("spreads and page numbers", () => {
  const page = (n: number): BookPage => ({ template: "one", photos: [n], text: "" });

  it("opens the book cover-alone, page 1 right-hand, then pairs", () => {
    const pages = [page(0), page(1), page(2), page(3), page(4)];
    expect(spreads(pages)).toEqual([
      [null, pages[0]],
      [null, pages[1]],
      [pages[2], pages[3]],
      [pages[4], null],
    ]);
    expect(spreads([])).toEqual([]);
  });

  it("puts odd page numbers on the right edge and even ones on the left", () => {
    const margin = { top: 100, right: 120, bottom: 140, left: 160 };
    expect(pageNumberAnchor(1, trim, margin)).toEqual({
      x: trim.w - 120,
      y: trim.h - 70,
      align: "right",
    });
    expect(pageNumberAnchor(2, trim, margin)).toMatchObject({ x: 160, align: "left" });
  });
});
