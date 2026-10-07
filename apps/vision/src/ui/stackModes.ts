// Layer ▸ Smart Objects ▸ Stack Mode and File ▸ Scripts ▸ Statistics share one
// vocabulary: Photoshop's eleven per-pixel stack statistics, listed in its own
// alphabetical menu order. `mode` is the engine's `stack_statistic` argument,
// NOT the menu position — the two stopped agreeing the moment the list was
// sorted the way Photoshop sorts it, and passing an index would have quietly
// computed the wrong statistic.

export interface StatMode {
  label: string;
  /** Engine `stack_statistic` mode id. */
  mode: number;
}

export const STAT_MODES: readonly StatMode[] = [
  { label: "Entropy", mode: 7 },
  { label: "Kurtosis", mode: 8 },
  { label: "Maximum", mode: 2 },
  { label: "Mean", mode: 0 },
  { label: "Median", mode: 1 },
  { label: "Minimum", mode: 3 },
  { label: "Range", mode: 4 },
  { label: "Skewness", mode: 9 },
  { label: "Standard Deviation", mode: 6 },
  { label: "Summation", mode: 5 },
  { label: "Variance", mode: 10 },
];

// ponytail: the engine's `stack_stat` (packages/engine/src/raster/mod.rs)
// implements modes 0..6 and falls through to Mean for anything above, so
// Entropy/Kurtosis/Skewness/Variance are offered but disabled rather than
// silently producing a Mean layer under another name. Ceiling: this constant.
// Upgrade path: add arms 7 entropy / 8 kurtosis / 9 skewness / 10 variance to
// `stack_stat` and bump this to 11 — stackModes.test.ts fails until you do.
export const ENGINE_STAT_MODES = 11;

/** Can the engine actually compute this statistic yet? */
export function statModeReady(mode: number): boolean {
  return mode >= 0 && mode < ENGINE_STAT_MODES;
}

/** Menu label for an engine mode id — names the layer a stack produces. */
export function statModeLabel(mode: number): string {
  return STAT_MODES.find((m) => m.mode === mode)?.label ?? "Mean";
}
