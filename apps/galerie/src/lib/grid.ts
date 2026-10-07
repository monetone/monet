// grid — pure windowing math for the virtualized Library grid. A catalog can
// hold 100k+ photos; we only mount the cells in (and near) the viewport and pad
// the scroll area above/below so the scrollbar stays correct. No dependency —
// ~one function.

export interface GridWindow {
  /** First photo index to render (inclusive). */
  startIndex: number;
  /** Last photo index to render (exclusive). */
  endIndex: number;
  /** Spacer height above the rendered rows (px). */
  padTop: number;
  /** Spacer height below the rendered rows (px). */
  padBottom: number;
  /** Total rows in the full grid (for the scroll area height). */
  totalRows: number;
}

/**
 * Which photo indices to mount for the current scroll position, plus the top/
 * bottom spacer heights. `overscan` rows are rendered beyond the viewport each
 * way so scrolling doesn't flash blank cells.
 */
export function computeGridWindow(
  scrollTop: number,
  viewportHeight: number,
  rowHeight: number,
  cols: number,
  count: number,
  overscan = 2,
): GridWindow {
  const totalRows = cols > 0 ? Math.ceil(count / cols) : 0;
  if (totalRows === 0 || rowHeight <= 0) {
    return { startIndex: 0, endIndex: 0, padTop: 0, padBottom: 0, totalRows };
  }

  const firstVisibleRow = Math.floor(Math.max(0, scrollTop) / rowHeight);
  const lastVisibleRow = Math.floor((Math.max(0, scrollTop) + viewportHeight) / rowHeight);

  const endRow = Math.min(totalRows - 1, lastVisibleRow + overscan);
  // Clamp startRow into the grid too — a scrollTop past the content (defensive)
  // must not produce startRow > endRow / a bogus window.
  const startRow = Math.min(Math.max(0, firstVisibleRow - overscan), endRow);

  const startIndex = startRow * cols;
  const endIndex = Math.min(count, (endRow + 1) * cols);

  return {
    startIndex,
    endIndex,
    padTop: startRow * rowHeight,
    padBottom: (totalRows - 1 - endRow) * rowHeight,
    totalRows,
  };
}

/** How many columns fit `containerWidth` at `cellWidth` (incl. `gap`), min 1. */
export function columnCount(containerWidth: number, cellWidth: number, gap: number): number {
  if (containerWidth <= 0 || cellWidth <= 0) return 1;
  return Math.max(1, Math.floor((containerWidth + gap) / (cellWidth + gap)));
}
