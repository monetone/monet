// ─────────────────────────────────────────────────────────────
// ui/stroke-dash.test — dashPattern (Stroke panel dash/gap pairs)
// ─────────────────────────────────────────────────────────────

import { describe, it, expect } from "vitest";
import { dashPattern } from "./stroke-dash";

describe("ui.dashPattern", () => {
  it("keeps a single pair when the second pair is 0/0", () => {
    expect(dashPattern(6, 4, 0, 0)).toEqual([6, 4]);
  });

  it("emits both pairs for a long/short pattern", () => {
    expect(dashPattern(10, 2, 4, 2)).toEqual([10, 2, 4, 2]);
  });

  it("keeps the second pair when only its gap is 0 (dash non-zero)", () => {
    expect(dashPattern(6, 4, 3, 0)).toEqual([6, 4, 3, 0]);
  });

  it("keeps the second pair when only its dash is 0 (gap non-zero)", () => {
    expect(dashPattern(6, 4, 0, 5)).toEqual([6, 4, 0, 5]);
  });
});
