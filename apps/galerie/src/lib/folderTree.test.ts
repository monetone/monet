import { describe, expect, it } from "vitest";

import { canDropFolder, folderTreeRows, joinPath, parentDirOf, visibleFolderRows } from "./folderTree";

const f = (path: string, count = 1) => ({ path, count });

describe("folderTreeRows", () => {
  it("derives depth from listed ancestors and marks parents", () => {
    const rows = folderTreeRows([f("/shoot"), f("/shoot/sub"), f("/shoot/sub/deep"), f("/trip")]);
    expect(rows.map((r) => [r.path, r.depth, r.hasChildren])).toEqual([
      ["/shoot", 0, true],
      ["/shoot/sub", 1, true],
      ["/shoot/sub/deep", 2, false],
      ["/trip", 0, false],
    ]);
  });

  it("is prefix-safe: /ab is not a child of /a", () => {
    const rows = folderTreeRows([f("/a"), f("/ab"), f("/a/x")]);
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["/a", 0],
      ["/a/x", 1],
      ["/ab", 0],
    ]);
    expect(rows[0].hasChildren).toBe(true);
    expect(rows[2].hasChildren).toBe(false);
  });

  it("skips unlisted intermediate dirs — depth is nearest LISTED ancestor", () => {
    const rows = folderTreeRows([f("/root"), f("/root/a/b/leaf")]);
    expect(rows.map((r) => r.depth)).toEqual([0, 1]);
  });

  it("keeps children attached when a sibling name sorts between parent and child", () => {
    const rows = folderTreeRows([f("/pics/2024"), f("/pics/2024-01"), f("/pics/2024/jan")]);
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["/pics/2024", 0],
      ["/pics/2024/jan", 1],
      ["/pics/2024-01", 0],
    ]);
    expect(rows[0].hasChildren).toBe(true);
  });

  it("nests backslash-separated paths", () => {
    const rows = folderTreeRows([f("C:\\pics"), f("C:\\pics-x"), f("C:\\pics\\sub")]);
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["C:\\pics", 0],
      ["C:\\pics\\sub", 1],
      ["C:\\pics-x", 0],
    ]);
  });

  it("tolerates unsorted input", () => {
    const rows = folderTreeRows([f("/z/sub"), f("/a"), f("/z")]);
    expect(rows.map((r) => [r.path, r.depth])).toEqual([
      ["/a", 0],
      ["/z", 0],
      ["/z/sub", 1],
    ]);
  });
});

describe("visibleFolderRows", () => {
  it("hides a collapsed subtree but keeps the collapsed row and siblings", () => {
    const rows = folderTreeRows([f("/shoot"), f("/shoot/sub"), f("/shoot/sub/deep"), f("/trip")]);
    const visible = visibleFolderRows(rows, new Set(["/shoot"]));
    expect(visible.map((r) => r.path)).toEqual(["/shoot", "/trip"]);
  });

  it("collapsing a mid-level node keeps its own ancestors", () => {
    const rows = folderTreeRows([f("/shoot"), f("/shoot/sub"), f("/shoot/sub/deep")]);
    const visible = visibleFolderRows(rows, new Set(["/shoot/sub"]));
    expect(visible.map((r) => r.path)).toEqual(["/shoot", "/shoot/sub"]);
  });
});

describe("canDropFolder", () => {
  it("refuses self, descendants, and the current parent; allows the rest", () => {
    expect(canDropFolder("/a/b", "/a/b")).toBe(false);
    expect(canDropFolder("/a", "/a/b")).toBe(false); // into own subtree
    expect(canDropFolder("/a/b", "/a")).toBe(false); // no-op: already there
    expect(canDropFolder("/a/b", "/c")).toBe(true);
    expect(canDropFolder("/a", "/ab")).toBe(true); // prefix sibling is a real target
  });
});

describe("parentDirOf", () => {
  it("returns the dir or empty for roots", () => {
    expect(parentDirOf("/a/b/c")).toBe("/a/b");
    expect(parentDirOf("/a")).toBe("");
  });
});

describe("joinPath", () => {
  it("uses the directory's own separator", () => {
    expect(joinPath("/a/b", "c")).toBe("/a/b/c");
    expect(joinPath("C:\\a", "c")).toBe("C:\\a\\c");
  });
});
