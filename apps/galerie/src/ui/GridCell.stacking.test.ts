// GridCell.stacking.test — the GAL-LIB-10 stack-curation seams: the expanded
// member's "n of N" badge and the [ / ] reorder keys. Stack SQL semantics live
// in the Rust tests (catalog.rs).

import { describe, expect, it } from "vitest";

import { resolveShortcut } from "../lib/keymap";
import { stackPosition } from "./GridCell";

describe("stackPosition", () => {
  it("labels expanded members with their 1-based position", () => {
    expect(stackPosition({ stackId: 7, stackOrder: 1, stackCount: 5 })).toBe("2 of 5");
    expect(stackPosition({ stackId: 7, stackOrder: 4, stackCount: 5 })).toBe("5 of 5");
  });

  it("skips unstacked photos and the cover (it carries the expand badge)", () => {
    expect(stackPosition({ stackId: null, stackOrder: null, stackCount: 0 })).toBeNull();
    expect(stackPosition({ stackId: 7, stackOrder: 0, stackCount: 5 })).toBeNull();
    // A dissolving 1-member remnant never shows a position.
    expect(stackPosition({ stackId: 7, stackOrder: 0, stackCount: 1 })).toBeNull();
  });
});

describe("[ / ] stack reorder keys", () => {
  it("resolve to stackMove up/down", () => {
    expect(resolveShortcut("[")).toEqual({ kind: "stackMove", delta: -1 });
    expect(resolveShortcut("]")).toEqual({ kind: "stackMove", delta: 1 });
  });
});
