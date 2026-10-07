// Unit tests for the New Group default-name helpers. Engine-free (node); the dialog
// + menu wiring are covered by e2e/new-group-dialog.spec.ts.
import { describe, it, expect } from "vitest";
import { defaultGroupName, resolveGroupName } from "./newGroup";

describe("defaultGroupName", () => {
  it("starts at 'Group 1' when there are no groups", () => {
    expect(defaultGroupName([])).toBe("Group 1");
    expect(defaultGroupName(["Sky", "Layer 2"])).toBe("Group 1");
  });

  it("returns one past the highest existing 'Group N' (not gap-filling)", () => {
    expect(defaultGroupName(["Group 1"])).toBe("Group 2");
    expect(defaultGroupName(["Group 1", "Group 3"])).toBe("Group 4");
  });

  it("ignores names that aren't exactly 'Group <int>'", () => {
    expect(defaultGroupName(["Group", "Group 2x", "my Group 5"])).toBe("Group 1");
  });
});

describe("resolveGroupName", () => {
  it("falls back to the default when blank", () => {
    expect(resolveGroupName("   ", ["Group 1"])).toBe("Group 2");
  });

  it("trims and keeps a typed name", () => {
    expect(resolveGroupName(" Hero ", [])).toBe("Hero");
  });
});
