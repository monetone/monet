import { describe, it, expect } from "vitest";
import { defaultSnapshotName, addSnapshot, removeSnapshot, renameSnapshot, type DocSnapshot } from "./snapshots";

const snap = (id: number, name: string): DocSnapshot => ({ id, name, bytes: new Uint8Array([id]) });

describe("defaultSnapshotName", () => {
  it("starts at Snapshot 1 for an empty list", () => {
    expect(defaultSnapshotName([])).toBe("Snapshot 1");
  });
  it("is one past the highest existing N (not just count)", () => {
    expect(defaultSnapshotName(["Snapshot 1", "Snapshot 3"])).toBe("Snapshot 4");
  });
  it("ignores names that don't match the pattern", () => {
    expect(defaultSnapshotName(["backup", "Snapshot 2", "before edit"])).toBe("Snapshot 3");
  });
});

describe("addSnapshot", () => {
  it("appends immutably", () => {
    const a = [snap(1, "Snapshot 1")];
    const b = addSnapshot(a, snap(2, "Snapshot 2"));
    expect(b.map((s) => s.id)).toEqual([1, 2]);
    expect(a).toHaveLength(1); // original untouched
  });
});

describe("removeSnapshot", () => {
  it("removes by id, immutably", () => {
    const a = [snap(1, "a"), snap(2, "b"), snap(3, "c")];
    const b = removeSnapshot(a, 2);
    expect(b.map((s) => s.id)).toEqual([1, 3]);
    expect(a).toHaveLength(3);
  });
  it("returns an equal list when the id is absent", () => {
    const a = [snap(1, "a")];
    expect(removeSnapshot(a, 99).map((s) => s.id)).toEqual([1]);
  });
});

describe("renameSnapshot", () => {
  it("renames the matching id only", () => {
    const a = [snap(1, "a"), snap(2, "b")];
    const b = renameSnapshot(a, 2, "  renamed  ");
    expect(b.map((s) => s.name)).toEqual(["a", "renamed"]); // trimmed
    expect(a[1].name).toBe("b"); // original untouched
  });
  it("ignores a blank name", () => {
    const a = [snap(1, "keep")];
    expect(renameSnapshot(a, 1, "   ")).toBe(a); // unchanged reference
  });
});
