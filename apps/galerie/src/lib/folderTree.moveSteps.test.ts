// movePhotoSteps (GAL-LIB-11): photo-onto-folder drop → rename steps that
// move the dragged photos' files into the target folder.

import { describe, expect, it } from "vitest";

import { movePhotoSteps } from "./folderTree";

const photos = [
  { id: 1, path: "/shoot/a.cr3" },
  { id: 2, path: "/shoot/sub/b.cr3" },
  { id: 3, path: "/other/c.cr3" },
];

describe("movePhotoSteps", () => {
  it("moves each dragged photo into destDir keeping its filename", () => {
    expect(movePhotoSteps(photos, [2, 3], "/shoot")).toEqual([
      { id: 2, from: "/shoot/sub/b.cr3", to: "/shoot/b.cr3" },
      { id: 3, from: "/other/c.cr3", to: "/shoot/c.cr3" },
    ]);
  });

  it("skips photos already directly inside destDir (no-op move)", () => {
    expect(movePhotoSteps(photos, [1], "/shoot")).toEqual([]);
  });

  it("ignores ids not in the loaded buffer (foreign/stale drag payloads)", () => {
    expect(movePhotoSteps(photos, [99], "/shoot")).toEqual([]);
  });

  it("joins with the destination's own separator style", () => {
    expect(movePhotoSteps([{ id: 4, path: "D:\\in\\d.cr3" }], [4], "C:\\pics")).toEqual([
      { id: 4, from: "D:\\in\\d.cr3", to: "C:\\pics\\d.cr3" },
    ]);
  });
});
