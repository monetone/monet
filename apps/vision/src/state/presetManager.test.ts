import { describe, it, expect } from "vitest";
import { moveItem, renamePresetAt } from "./presetManager";

describe("moveItem", () => {
  it("moves an item up and down (immutably)", () => {
    const a = ["a", "b", "c", "d"];
    expect(moveItem(a, 2, -1)).toEqual(["a", "c", "b", "d"]);
    expect(moveItem(a, 1, 1)).toEqual(["a", "c", "b", "d"]);
    expect(a).toEqual(["a", "b", "c", "d"]); // original untouched
  });

  it("moves by more than one and clamps at the ends", () => {
    expect(moveItem(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
    expect(moveItem(["a", "b", "c"], 0, 99)).toEqual(["b", "c", "a"]); // clamped to last
    expect(moveItem(["a", "b", "c"], 2, -99)).toEqual(["c", "a", "b"]); // clamped to first
  });

  it("returns the same reference for no-ops", () => {
    const a = ["a", "b", "c"];
    expect(moveItem(a, 0, 0)).toBe(a);   // zero delta
    expect(moveItem(a, 0, -1)).toBe(a);  // already at top
    expect(moveItem(a, 2, 1)).toBe(a);   // already at bottom
    expect(moveItem(a, 9, -1)).toBe(a);  // out of range
    expect(moveItem(a, -1, 1)).toBe(a);  // negative index
  });
});

describe("renamePresetAt", () => {
  const list = [{ name: "One" }, { name: "Two" }];
  it("renames the matching item, trimmed, immutably", () => {
    const out = renamePresetAt(list, 1, "  Renamed  ");
    expect(out.map((p) => p.name)).toEqual(["One", "Renamed"]);
    expect(list[1].name).toBe("Two"); // original untouched
  });
  it("returns the same reference for blank, unchanged or out-of-range names", () => {
    expect(renamePresetAt(list, 0, "   ")).toBe(list);   // blank
    expect(renamePresetAt(list, 0, "One")).toBe(list);   // unchanged
    expect(renamePresetAt(list, 0, "  One  ")).toBe(list); // unchanged after trim
    expect(renamePresetAt(list, 5, "x")).toBe(list);     // out of range
  });
});
