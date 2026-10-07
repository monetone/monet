import { describe, expect, it } from "vitest";

import { contactSheetCells, fitInCell, fitOnPage, fromPx, gridForCount, type Rect, picturePackageCells, coverCrop, toPx, PICTURE_PACKAGES, DPI } from "./printLayout";

describe("fitOnPage", () => {
  it("fits a landscape image to the width and centers it vertically", () => {
    // 2000×1000 into a 1200×1600 page, margin 100 → avail 1000×1400.
    const r = fitOnPage(2000, 1000, 1200, 1600, 100);
    expect(r.w).toBe(1000); // width-limited
    expect(r.h).toBe(500);
    expect(r.x).toBe(100); // (1200-1000)/2
    expect(r.y).toBe(550); // (1600-500)/2
  });

  it("fits a portrait image to the height", () => {
    const r = fitOnPage(1000, 2000, 1200, 1600, 100);
    expect(r.h).toBe(1400); // height-limited (avail 1400)
    expect(r.w).toBe(700);
    expect(r.x).toBe(250);
    expect(r.y).toBe(100);
  });

  it("stays inside the printable box (respects margins)", () => {
    const r = fitOnPage(9999, 9999, 1000, 1000, 50);
    expect(r.x).toBeGreaterThanOrEqual(50);
    expect(r.y).toBeGreaterThanOrEqual(50);
    expect(r.x + r.w).toBeLessThanOrEqual(950);
    expect(r.y + r.h).toBeLessThanOrEqual(950);
  });
});

describe("contactSheetCells", () => {
  it("returns rows*cols cells in row-major order", () => {
    const cells = contactSheetCells(1000, 1000, { rows: 2, cols: 3, margin: 0, gutter: 0 });
    expect(cells).toHaveLength(6);
    // row-major: cell[3] is row 1, col 0 → below cell[0]
    expect(cells[3].x).toBe(cells[0].x);
    expect(cells[3].y).toBeGreaterThan(cells[0].y);
  });

  it("places cells with margin + gutter (2x2, margin 50, gutter 20)", () => {
    const cells = contactSheetCells(1000, 1000, { rows: 2, cols: 2, margin: 50, gutter: 20 });
    // availW = 1000 - 100 - 20 = 880 → cellW 440
    expect(cells[0]).toEqual({ x: 50, y: 50, w: 440, h: 440 });
    expect(cells[1]).toEqual({ x: 510, y: 50, w: 440, h: 440 }); // 50 + 440 + 20
    expect(cells[2]).toEqual({ x: 50, y: 510, w: 440, h: 440 });
    expect(cells[3]).toEqual({ x: 510, y: 510, w: 440, h: 440 });
  });

  it("tiles exactly with no gutter/margin", () => {
    const cells = contactSheetCells(600, 400, { rows: 2, cols: 3, margin: 0, gutter: 0 });
    expect(cells[0]).toEqual({ x: 0, y: 0, w: 200, h: 200 });
    expect(cells[5]).toEqual({ x: 400, y: 200, w: 200, h: 200 });
  });

  it("keeps every cell inside the page", () => {
    const cells = contactSheetCells(2550, 3300, { rows: 4, cols: 3, margin: 75, gutter: 30 });
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(75);
      expect(c.y).toBeGreaterThanOrEqual(75);
      expect(c.x + c.w).toBeLessThanOrEqual(2550 - 75 + 1); // rounding slack
      expect(c.y + c.h).toBeLessThanOrEqual(3300 - 75 + 1);
    }
  });
});

describe("fitInCell", () => {
  const cell: Rect = { x: 100, y: 200, w: 440, h: 440 };
  it("fits a landscape image and centers it vertically in the cell", () => {
    const r = fitInCell(200, 100, cell); // 2:1 in a square cell → full width
    expect(r.w).toBe(440);
    expect(r.h).toBe(220);
    expect(r.x).toBe(100); // full width, no horizontal offset
    expect(r.y).toBe(200 + (440 - 220) / 2); // centered vertically
  });
  it("fits a portrait image and centers it horizontally", () => {
    const r = fitInCell(100, 200, cell);
    expect(r.h).toBe(440);
    expect(r.w).toBe(220);
    expect(r.y).toBe(200);
    expect(r.x).toBe(100 + (440 - 220) / 2);
  });
  it("never exceeds the cell bounds", () => {
    const r = fitInCell(4000, 3000, cell);
    expect(r.x).toBeGreaterThanOrEqual(cell.x);
    expect(r.y).toBeGreaterThanOrEqual(cell.y);
    expect(r.x + r.w).toBeLessThanOrEqual(cell.x + cell.w);
    expect(r.y + r.h).toBeLessThanOrEqual(cell.y + cell.h);
  });
});

describe("gridForCount", () => {
  it("is near-square on a square page (aspect 1)", () => {
    expect(gridForCount(1)).toEqual({ rows: 1, cols: 1 });
    expect(gridForCount(4)).toEqual({ rows: 2, cols: 2 });
    expect(gridForCount(9)).toEqual({ rows: 3, cols: 3 });
    expect(gridForCount(3)).toEqual({ rows: 2, cols: 2 }); // 4 cells hold 3
  });

  it("is row-dominant on a portrait page (aspect < 1)", () => {
    // 6 photos on portrait Letter → 3 rows × 2 cols (wider cells for landscapes)
    expect(gridForCount(6, 2550 / 3300)).toEqual({ rows: 3, cols: 2 });
    // the pathological n=2 case: stacked, not side-by-side
    expect(gridForCount(2, 2550 / 3300)).toEqual({ rows: 2, cols: 1 });
  });

  it("is column-dominant on a landscape page (aspect > 1)", () => {
    expect(gridForCount(6, 3300 / 2550)).toEqual({ rows: 2, cols: 3 });
    expect(gridForCount(2, 2.0)).toEqual({ rows: 1, cols: 2 });
  });

  it("clamps a non-positive count / bad aspect", () => {
    expect(gridForCount(0)).toEqual({ rows: 1, cols: 1 });
    expect(gridForCount(2, -1)).toEqual({ rows: 2, cols: 1 }); // aspect≤0 → treated as 1
    expect(gridForCount(5.9)).toEqual(gridForCount(5)); // floors the count
  });
});

describe("contactSheetCells / fitInCell edge cases", () => {
  it("1×1 grid is a single full-margin cell", () => {
    expect(contactSheetCells(1000, 800, { rows: 1, cols: 1, margin: 40, gutter: 10 })).toEqual([
      { x: 40, y: 40, w: 920, h: 720 },
    ]);
  });

  it("clamps cell size to ≥1 when margin+gutter exceed the page (degenerate input)", () => {
    // ponytail: absurd input (margins bigger than the page) — cells don't crash;
    // size floors to 1. No in-page guarantee is made for invalid input.
    const cells = contactSheetCells(100, 100, { rows: 2, cols: 2, margin: 200, gutter: 50 });
    expect(cells).toHaveLength(4);
    for (const c of cells) {
      expect(c.w).toBeGreaterThanOrEqual(1);
      expect(c.h).toBeGreaterThanOrEqual(1);
    }
  });

  it("fitInCell with an exactly-matching aspect fills the cell with zero offset", () => {
    const r = fitInCell(200, 200, { x: 10, y: 20, w: 100, h: 100 });
    expect(r).toEqual({ x: 10, y: 20, w: 100, h: 100 });
  });
});

const LETTER = { w: 2550, h: 3300 }; // 300 DPI

function overlaps(a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe("picturePackageCells", () => {
  const px = (sizes: { w: number; h: number }[]) =>
    sizes.map((s) => ({ w: Math.round(s.w * DPI), h: Math.round(s.h * DPI) }));

  it("places the classic 5×7 + 4 wallets with no overlap, all inside the margins", () => {
    const { cells, dropped } = picturePackageCells(
      LETTER.w,
      LETTER.h,
      75,
      30,
      px(PICTURE_PACKAGES["(1) 5×7 + (4) 2.5×3.5"]),
    );
    expect(dropped).toBe(0);
    expect(cells).toHaveLength(5);
    expect(cells[0]).toMatchObject({ w: 2100, h: 1500 }); // the 7×5 leads
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(75);
      expect(c.y).toBeGreaterThanOrEqual(75);
      expect(c.x + c.w).toBeLessThanOrEqual(LETTER.w - 75);
      expect(c.y + c.h).toBeLessThanOrEqual(LETTER.h - 75);
    }
    for (let i = 0; i < cells.length; i++)
      for (let j = i + 1; j < cells.length; j++) expect(overlaps(cells[i], cells[j])).toBe(false);
  });

  it("fits every preset on Letter without drops", () => {
    for (const [name, sizes] of Object.entries(PICTURE_PACKAGES)) {
      const { cells, dropped } = picturePackageCells(LETTER.w, LETTER.h, 75, 30, px(sizes));
      expect(dropped, name).toBe(0);
      expect(cells, name).toHaveLength(sizes.length);
    }
  });

  it("centers the block vertically and each row horizontally", () => {
    const { cells } = picturePackageCells(LETTER.w, LETTER.h, 75, 30, px(PICTURE_PACKAGES["(2) 5×7"]));
    const top = cells[0].y;
    const bottom = LETTER.h - (cells[1].y + cells[1].h);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
    const left = cells[0].x;
    const right = LETTER.w - (cells[0].x + cells[0].w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
  });

  it("drops cells that cannot fit and reports the count", () => {
    const { cells, dropped } = picturePackageCells(1000, 1000, 50, 20, [
      { w: 2000, h: 500 }, // wider than printable
      { w: 500, h: 500 },
      { w: 500, h: 500 }, // no second shelf room after first + gutters? fits: 500+20+500=1020 > 900 avail... second shelf 500+20+500=1020 > 900 → dropped
    ]);
    expect(cells).toHaveLength(1);
    expect(dropped).toBe(2);
  });

  it("later smaller cells can still join the current shelf after a drop", () => {
    const { cells, dropped } = picturePackageCells(1000, 700, 50, 20, [
      { w: 400, h: 400 },
      { w: 600, h: 600 }, // taller than remaining page — dropped
      { w: 400, h: 400 }, // joins the first shelf
    ]);
    expect(cells).toHaveLength(2);
    expect(dropped).toBe(1);
    expect(cells[0].y).toBe(cells[1].y);
  });
});

describe("coverCrop (Zoom to Fill)", () => {
  it("crops width for a wider image, height for a taller one, centered", () => {
    const a = coverCrop(6000, 4000, 1050, 1500); // cell aspect 0.7
    expect(a.h).toBe(4000);
    expect(a.w).toBe(2800);
    expect(a.x).toBe(1600);
    const b = coverCrop(4000, 6000, 2100, 1500); // cell aspect 1.4
    expect(b.w).toBe(4000);
    expect(b.h).toBe(Math.round(4000 / 1.4));
    expect(b.y).toBe(Math.round((6000 - b.h) / 2));
  });

  it("matching aspect is a no-op crop", () => {
    expect(coverCrop(2100, 1500, 2100, 1500)).toEqual({ x: 0, y: 0, w: 2100, h: 1500 });
  });
});

describe("per-side margins", () => {
  it("fitOnPage centers in the printable box, not the page", () => {
    // 1000×1000 page, 100 left / 300 right → box x=100 w=600; a square image
    // fills it and sits at the box centre, i.e. left of the page centre.
    const r = fitOnPage(1000, 1000, 1000, 1000, { top: 100, right: 300, bottom: 100, left: 100 });
    expect(r).toEqual({ x: 100, y: 200, w: 600, h: 600 });
  });

  it("a scalar margin still matches the per-side form", () => {
    expect(fitOnPage(2000, 1000, 1200, 1600, 100)).toEqual(
      fitOnPage(2000, 1000, 1200, 1600, { top: 100, right: 100, bottom: 100, left: 100 }),
    );
  });

  it("contactSheetCells gives asymmetric origins and stays in the box", () => {
    const m = { top: 20, right: 200, bottom: 100, left: 40 };
    const cells = contactSheetCells(1000, 1000, { rows: 2, cols: 2, margin: m, gutter: 0 });
    expect(cells[0]).toEqual({ x: 40, y: 20, w: 380, h: 440 }); // box 760×880
    expect(cells[3]).toEqual({ x: 420, y: 460, w: 380, h: 440 });
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(m.left);
      expect(c.y).toBeGreaterThanOrEqual(m.top);
      expect(c.x + c.w).toBeLessThanOrEqual(1000 - m.right + 1);
      expect(c.y + c.h).toBeLessThanOrEqual(1000 - m.bottom + 1);
    }
  });

  it("picturePackageCells honors per-side margins", () => {
    const { cells, dropped } = picturePackageCells(
      1000,
      1000,
      { top: 400, right: 50, bottom: 50, left: 50 },
      0,
      [{ w: 900, h: 500 }, { w: 200, h: 200 }],
    );
    // box is 900×550 at (50,400): the first cell fits, the second has no shelf left
    expect(dropped).toBe(1);
    expect(cells[0].y).toBeGreaterThanOrEqual(400);
    expect(cells[0].x).toBe(50);
  });
});

describe("fixed grid / cell-size mode", () => {
  it("a user-fixed grid returns exactly rows*cols cells inside the printable box", () => {
    const cells = contactSheetCells(LETTER.w, LETTER.h, { rows: 5, cols: 4, margin: 75, gutter: 30 });
    expect(cells).toHaveLength(20);
    for (const c of cells) {
      expect(c.x).toBeGreaterThanOrEqual(75);
      expect(c.y).toBeGreaterThanOrEqual(75);
      expect(c.x + c.w).toBeLessThanOrEqual(LETTER.w - 75 + 1);
      expect(c.y + c.h).toBeLessThanOrEqual(LETTER.h - 75 + 1);
    }
  });

  it("an explicit cell size is used verbatim and the block is centered", () => {
    const cell = { w: 3.5 * DPI, h: 2.5 * DPI }; // 1050 × 750
    const cells = contactSheetCells(LETTER.w, LETTER.h, { rows: 2, cols: 2, margin: 75, gutter: 30, cell });
    expect(cells).toHaveLength(4);
    for (const c of cells) expect({ w: c.w, h: c.h }).toEqual({ w: 1050, h: 750 });
    // block 2130×1530 centered in the 2400×3150 printable box
    const left = cells[0].x - 75;
    const right = LETTER.w - 75 - (cells[3].x + cells[3].w);
    expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    const top = cells[0].y - 75;
    const bottom = LETTER.h - 75 - (cells[3].y + cells[3].h);
    expect(Math.abs(top - bottom)).toBeLessThanOrEqual(1);
  });

  it("cell-size mode respects per-side margins when centering", () => {
    const a = contactSheetCells(1000, 1000, { rows: 1, cols: 1, margin: 100, gutter: 0, cell: { w: 200, h: 200 } });
    const b = contactSheetCells(1000, 1000, {
      rows: 1,
      cols: 1,
      margin: { top: 100, right: 300, bottom: 100, left: 100 },
      gutter: 0,
      cell: { w: 200, h: 200 },
    });
    expect(a[0]).toEqual({ x: 400, y: 400, w: 200, h: 200 });
    expect(b[0]).toEqual({ x: 300, y: 400, w: 200, h: 200 }); // box 100..700 → centre 400
  });
});

describe("ruler units", () => {
  it("converts inches / centimeters / pixels at the page DPI", () => {
    expect(toPx(8.5, "in")).toBe(2550); // Letter width
    expect(toPx(1, "cm")).toBe(118); // 300/2.54
    expect(toPx(42, "px")).toBe(42);
    expect(fromPx(2550, "in")).toBe(8.5);
    expect(fromPx(75, "in")).toBe(0.25);
    expect(fromPx(1181, "cm")).toBe(10);
  });
});
