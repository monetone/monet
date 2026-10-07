import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { ENGINE_STAT_MODES, STAT_MODES, statModeLabel, statModeReady } from "./stackModes";

// VIS-LS-15: Stack Mode offered 7 of Photoshop's 11 statistics, and the menu
// position doubled as the engine's `stack_statistic` argument — so sorting the
// list the way Photoshop sorts it would have silently computed a different
// statistic than the one named. The table now carries explicit engine mode ids,
// and the four the engine cannot compute yet are disabled instead of falling
// through to Mean.
const PHOTOSHOP_ORDER = [
  "Entropy", "Kurtosis", "Maximum", "Mean", "Median", "Minimum",
  "Range", "Skewness", "Standard Deviation", "Summation", "Variance",
];

// The ids `stack_stat` documents: 0 mean, 1 median, 2 maximum, 3 minimum,
// 4 range, 5 summation, 6 standard deviation, 7 entropy, 8 kurtosis,
// 9 skewness, 10 variance.
const ENGINE_IDS: Record<string, number> = {
  Mean: 0, Median: 1, Maximum: 2, Minimum: 3, Range: 4, Summation: 5, "Standard Deviation": 6,
  Entropy: 7, Kurtosis: 8, Skewness: 9, Variance: 10,
};

const engineSource = readFileSync(
  fileURLToPath(new URL("../../../../packages/engine/src/raster/mod.rs", import.meta.url)),
  "utf8",
);

/** The explicit `N =>` match arms of `fn stack_stat`, plus 0 for its `_` default. */
function engineStatModes(): number[] {
  const from = engineSource.indexOf("fn stack_stat(vals: &mut [f32], mode: u8) -> f32 {");
  expect(from, "stack_stat moved — re-anchor this test").toBeGreaterThanOrEqual(0);
  const body = engineSource.slice(from, engineSource.indexOf("\n}\n", from));
  const arms = [...body.matchAll(/^\s{8}(\d+(?:\s*\|\s*\d+)*) =>/gm)]
    .flatMap((m) => m[1].split("|").map((n) => Number(n.trim())));
  expect(body, "stack_stat must keep a default arm").toContain("_ =>");
  return [...new Set([0, ...arms])].sort((a, b) => a - b);
}

describe("stack mode table", () => {
  it("offers all eleven Photoshop statistics in Photoshop's order", () => {
    expect(STAT_MODES.map((m) => m.label)).toEqual(PHOTOSHOP_ORDER);
  });

  it("maps every implemented label to the engine id, not the menu position", () => {
    for (const [label, mode] of Object.entries(ENGINE_IDS)) {
      const entry = STAT_MODES.find((m) => m.label === label);
      expect(entry, `missing ${label}`).toBeDefined();
      expect(entry!.mode, `${label} must dispatch engine mode ${mode}`).toBe(mode);
      expect(statModeLabel(mode)).toBe(label);
    }
    expect(new Set(STAT_MODES.map((m) => m.mode)).size).toBe(STAT_MODES.length);
  });

  it("has no statistic the engine cannot compute", () => {
    const blocked = STAT_MODES.filter((m) => !statModeReady(m.mode)).map((m) => m.label);
    expect(blocked).toEqual([]);
  });

  // The guard that matters: `stack_stat` falls through to Mean for unknown
  // modes, so a listed-but-unimplemented statistic would lie rather than fail.
  it("never enables a mode the engine lacks, and notices when the engine grows one", () => {
    const engine = engineStatModes();
    for (const m of STAT_MODES) {
      expect(statModeReady(m.mode), `${m.label} is enabled but stack_stat has no arm for it`)
        .toBe(engine.includes(m.mode));
    }
    expect(Math.max(...engine) + 1, "stack_stat grew an arm — bump ENGINE_STAT_MODES")
      .toBe(ENGINE_STAT_MODES);
  });
});
