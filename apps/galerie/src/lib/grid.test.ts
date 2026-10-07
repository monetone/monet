import { describe, expect, it } from "vitest";

import { columnCount, computeGridWindow } from "./grid";

describe("computeGridWindow", () => {
  const rowH = 200;
  const cols = 4;
  const count = 100; // 25 rows

  it("at the top renders from row 0 (overscan only below)", () => {
    const w = computeGridWindow(0, 600, rowH, cols, count, 2);
    expect(w.totalRows).toBe(25);
    expect(w.startIndex).toBe(0);
    expect(w.padTop).toBe(0);
    // visible rows 0..3 (600/200=3) + 2 overscan below = rows 0..5 → 6 rows.
    expect(w.endIndex).toBe(6 * cols); // 24
    expect(w.padBottom).toBe((25 - 6) * rowH); // rows 6..24 below
  });

  it("mid-scroll windows around the viewport with overscan both ways", () => {
    // scrollTop 2000 → firstVisibleRow 10; viewport 600 → lastVisibleRow 13.
    const w = computeGridWindow(2000, 600, rowH, cols, count, 2);
    expect(w.startIndex).toBe(8 * cols); // (10-2)=8
    expect(w.endIndex).toBe((13 + 2 + 1) * cols); // through row 15 → 64
    expect(w.padTop).toBe(8 * rowH);
    // Invariant: padTop + rendered + padBottom fills the full scroll area.
    const renderedRows = (w.endIndex - w.startIndex) / cols; // 8
    expect(w.padTop + renderedRows * rowH + w.padBottom).toBe(25 * rowH);
  });

  it("clamps at the bottom", () => {
    const w = computeGridWindow(1_000_000, 600, rowH, cols, count, 2);
    expect(w.endIndex).toBe(count);
    expect(w.padBottom).toBe(0);
  });

  it("empty catalog renders nothing", () => {
    const w = computeGridWindow(0, 600, rowH, cols, 0, 2);
    expect(w).toEqual({ startIndex: 0, endIndex: 0, padTop: 0, padBottom: 0, totalRows: 0 });
  });

  it("a partial last row is fully covered by count clamp", () => {
    const w = computeGridWindow(1_000_000, 600, rowH, cols, 98, 2); // 25 rows, last has 2
    expect(w.totalRows).toBe(25);
    expect(w.endIndex).toBe(98);
  });
});

describe("columnCount", () => {
  it("fits whole cells including inter-cell gaps", () => {
    // 1000 wide, 240 cell, 16 gap → floor((1000+16)/256) = 3.
    expect(columnCount(1000, 240, 16)).toBe(3);
  });
  it("never returns less than 1", () => {
    expect(columnCount(100, 240, 16)).toBe(1);
    expect(columnCount(0, 240, 16)).toBe(1);
  });
});
