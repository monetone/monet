// Photoshop's Histogram hover readout: the Level under the cursor, that level's
// pixel Count, and the cumulative Percentile (share of pixels at or below it).
// Pure / engine-free — operates on the same 256-bin channel counts the curve and
// stats use, so it unit-tests in node.

export interface HistReadout {
  level: number;
  count: number;
  percentile: number;
}

// Map a 0..1 horizontal fraction across the histogram to a 0..(n-1) level.
export function levelFromFraction(fraction: number, n = 256): number {
  const f = Math.max(0, Math.min(1, fraction));
  return Math.min(n - 1, Math.floor(f * n));
}

// The readout at `level`: its pixel count and the cumulative percentile (0..100).
export function histogramReadout(counts: ArrayLike<number>, level: number): HistReadout {
  const n = counts.length;
  const lv = Math.max(0, Math.min(n - 1, Math.round(level)));
  let total = 0;
  let cum = 0;
  for (let i = 0; i < n; i++) {
    total += counts[i];
    if (i <= lv) cum += counts[i];
  }
  return { level: lv, count: counts[lv], percentile: total > 0 ? (cum / total) * 100 : 0 };
}
