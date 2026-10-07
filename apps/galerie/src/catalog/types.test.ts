// matchesAttributeFilter — the multi-select attribute-filter semantics (GAL-LIB-15):
// any-of flag sets, any-of label sets, Kind (master/virtual), and the non-empty
// set superseding its single-select scalar sibling.

import { describe, expect, it } from "vitest";

import { matchesAttributeFilter, type PhotoFilter } from "./types";

type Attr = Parameters<typeof matchesAttributeFilter>[1];
const photo = (over: Partial<Attr> = {}): Attr => ({
  flag: 0,
  colorLabel: null,
  isVirtualCopy: false,
  ...over,
});
const NONE: Pick<PhotoFilter, "flag" | "flags" | "colorLabel" | "colorLabels" | "kind"> = {
  flag: null,
  colorLabel: null,
};

describe("matchesAttributeFilter", () => {
  it("empty filter passes everything", () => {
    expect(matchesAttributeFilter(NONE, photo())).toBe(true);
    expect(matchesAttributeFilter({ ...NONE, flags: [], colorLabels: [] }, photo({ flag: -1, isVirtualCopy: true }))).toBe(true);
  });

  it("flag set is any-of: picks + unflagged hides rejects (the cull filter)", () => {
    const f = { ...NONE, flags: [1, 0] };
    expect(matchesAttributeFilter(f, photo({ flag: 1 }))).toBe(true);
    expect(matchesAttributeFilter(f, photo({ flag: 0 }))).toBe(true);
    expect(matchesAttributeFilter(f, photo({ flag: -1 }))).toBe(false);
  });

  it("non-empty flag set supersedes the scalar flag", () => {
    expect(matchesAttributeFilter({ ...NONE, flag: -1, flags: [1] }, photo({ flag: 1 }))).toBe(true);
    // Empty set falls back to the scalar.
    expect(matchesAttributeFilter({ ...NONE, flag: -1, flags: [] }, photo({ flag: 1 }))).toBe(false);
  });

  it("label set is any-of and never matches unlabeled photos", () => {
    const f = { ...NONE, colorLabels: ["red", "blue"] };
    expect(matchesAttributeFilter(f, photo({ colorLabel: "blue" }))).toBe(true);
    expect(matchesAttributeFilter(f, photo({ colorLabel: "green" }))).toBe(false);
    expect(matchesAttributeFilter(f, photo({ colorLabel: null }))).toBe(false);
    // Non-empty set supersedes the scalar.
    expect(matchesAttributeFilter({ ...f, colorLabel: "green" }, photo({ colorLabel: "red" }))).toBe(true);
  });

  it("scalar flag/label single-select behavior is unchanged", () => {
    expect(matchesAttributeFilter({ ...NONE, flag: 1 }, photo({ flag: 1 }))).toBe(true);
    expect(matchesAttributeFilter({ ...NONE, flag: 1 }, photo({ flag: 0 }))).toBe(false);
    expect(matchesAttributeFilter({ ...NONE, colorLabel: "red" }, photo({ colorLabel: "red" }))).toBe(true);
    expect(matchesAttributeFilter({ ...NONE, colorLabel: "red" }, photo())).toBe(false);
  });

  it("kind isolates masters vs virtual copies", () => {
    expect(matchesAttributeFilter({ ...NONE, kind: "master" }, photo())).toBe(true);
    expect(matchesAttributeFilter({ ...NONE, kind: "master" }, photo({ isVirtualCopy: true }))).toBe(false);
    expect(matchesAttributeFilter({ ...NONE, kind: "virtual" }, photo({ isVirtualCopy: true }))).toBe(true);
    expect(matchesAttributeFilter({ ...NONE, kind: "virtual" }, photo())).toBe(false);
    expect(matchesAttributeFilter({ ...NONE, kind: null }, photo({ isVirtualCopy: true }))).toBe(true);
  });

  it("dimensions compose (AND across flag set, label set, kind)", () => {
    const f = { ...NONE, flags: [1, 0], colorLabels: ["red"], kind: "master" as const };
    expect(matchesAttributeFilter(f, photo({ flag: 1, colorLabel: "red" }))).toBe(true);
    expect(matchesAttributeFilter(f, photo({ flag: -1, colorLabel: "red" }))).toBe(false);
    expect(matchesAttributeFilter(f, photo({ flag: 1, colorLabel: null }))).toBe(false);
    expect(matchesAttributeFilter(f, photo({ flag: 1, colorLabel: "red", isVirtualCopy: true }))).toBe(false);
  });
});
