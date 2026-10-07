// ─────────────────────────────────────────────────────────────
// Histogram statistics — pure stats over a luminance histogram for the Histogram
// panel's Mean / Std Dev / Median / Pixels readout (Photoshop). `counts[level]` is
// the pixel count at each level (index = level). Engine-free so it unit-tests in
// node; EngineClient.channelHistogram() supplies the counts.
// ─────────────────────────────────────────────────────────────

export interface HistStats {
  mean: number;
  median: number;
  stdDev: number;
  pixels: number;
}

/** Mean / median / std-dev / total over a luminance histogram. An all-zero
 *  histogram returns all zeros. */
export function histogramStats(counts: number[]): HistStats {
  let pixels = 0;
  let sum = 0;
  for (let i = 0; i < counts.length; i++) {
    pixels += counts[i];
    sum += i * counts[i];
  }
  if (pixels === 0) return { mean: 0, median: 0, stdDev: 0, pixels: 0 };
  const mean = sum / pixels;
  let varSum = 0;
  for (let i = 0; i < counts.length; i++) varSum += counts[i] * (i - mean) * (i - mean);
  const stdDev = Math.sqrt(varSum / pixels);
  // median: the smallest level whose cumulative count reaches half the pixels.
  const half = pixels / 2;
  let cum = 0;
  let median = 0;
  for (let i = 0; i < counts.length; i++) {
    cum += counts[i];
    if (cum >= half) { median = i; break; }
  }
  return { mean, median, stdDev, pixels };
}
