import { describe, expect, it } from "vitest";

import { nextCollapsed } from "./SoloStack";

const set = (...xs: number[]) => new Set(xs);

describe("nextCollapsed", () => {
  it("plain click toggles one panel closed and open again", () => {
    expect(nextCollapsed(set(), 2, false, 5)).toEqual(set(2));
    expect(nextCollapsed(set(2), 2, false, 5)).toEqual(set());
    expect(nextCollapsed(set(1), 2, false, 5)).toEqual(set(1, 2));
  });

  it("alt-click solos: collapses every sibling, keeps the target open", () => {
    expect(nextCollapsed(set(), 2, true, 4)).toEqual(set(0, 1, 3));
    // Solo from a partially collapsed state still solos the target.
    expect(nextCollapsed(set(0, 2), 1, true, 4)).toEqual(set(0, 2, 3));
  });

  it("alt-click on the already-soloed panel restores all", () => {
    expect(nextCollapsed(set(0, 1, 3), 2, true, 4)).toEqual(set());
  });

  it("alt-click on a collapsed panel while another is soloed re-solos to it", () => {
    // Panel 0 is soloed (1,2,3 collapsed); alt-click on 1 → 1 becomes the solo.
    expect(nextCollapsed(set(1, 2, 3), 1, true, 4)).toEqual(set(0, 2, 3));
  });
});
