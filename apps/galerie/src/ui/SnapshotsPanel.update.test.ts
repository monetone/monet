// SnapshotsPanel.update.test — GAL-DEV-22: a snapshot updates in place and
// renames, instead of forcing a delete + re-save under the same name. Both ride
// the catalog's (photo, name) upsert, so what's pinned here is the exact bridge
// calls each makes — the panel's own DOM has no environment in vitest's node
// default, and the call sequence is the part that can go wrong.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { normalizeRecipe } from "@monet-ui/monet-photo";

const { addSnapshot, deleteSnapshot } = vi.hoisted(() => ({
  addSnapshot: vi.fn<(...args: unknown[]) => Promise<number>>(async () => 1),
  deleteSnapshot: vi.fn<(...args: unknown[]) => Promise<void>>(async () => {}),
}));

vi.mock("../catalog/catalog", () => ({
  addSnapshot,
  deleteSnapshot,
  catalogAvailable: () => true,
  listSnapshots: vi.fn(async () => []),
}));

import { renameSnapshot, updateSnapshot } from "./SnapshotsPanel";
import type { SnapshotRow } from "../catalog/types";

const row = (over: Partial<SnapshotRow> = {}): SnapshotRow => ({
  id: 1,
  photoId: 42,
  name: "Punchy",
  recipeJson: '{"v":2}',
  processVersion: 6,
  createdAt: 1_700_000_000,
  ...over,
});

beforeEach(() => {
  addSnapshot.mockReset();
  deleteSnapshot.mockReset();
  addSnapshot.mockResolvedValue(1);
  deleteSnapshot.mockResolvedValue(undefined);
});

describe("snapshot update in place", () => {
  it("re-saves the same name with the current recipe and deletes nothing", async () => {
    const recipe = normalizeRecipe({});
    recipe.basic.exposure = 0.5;

    await updateSnapshot(42, "Punchy", recipe);

    expect(addSnapshot.mock.calls).toEqual([
      [42, "Punchy", JSON.stringify(recipe), recipe.processVersion],
    ]);
    expect(deleteSnapshot).not.toHaveBeenCalled();
  });
});

describe("snapshot rename", () => {
  it("writes the recipe under the new name and drops the old row", async () => {
    addSnapshot.mockResolvedValue(9); // a new row: the name was free

    await renameSnapshot(row(), "Punchier");

    expect(addSnapshot.mock.calls).toEqual([[42, "Punchier", '{"v":2}', 6]]);
    expect(deleteSnapshot.mock.calls).toEqual([[1]]);
  });

  it("keeps the row when the upsert lands on it, so a no-op rename can't delete it", async () => {
    addSnapshot.mockResolvedValue(1); // same id back: nothing else to drop

    await renameSnapshot(row(), "Punchy");

    expect(deleteSnapshot).not.toHaveBeenCalled();
  });

  it("leaves the old row alone when the write fails", async () => {
    addSnapshot.mockRejectedValue(new Error("catalog closed"));

    await expect(renameSnapshot(row(), "Punchier")).rejects.toThrow("catalog closed");
    expect(deleteSnapshot).not.toHaveBeenCalled();
  });
});
