// Folder-ops helpers (GAL-LIB-13): the folder-only filter's client-side
// mirror and the session-created empty-folder merge for the Folders panel.

import { describe, expect, it } from "vitest";

import { isDirectChild, mergeExtraFolders } from "./folderTree";

describe("isDirectChild", () => {
  it("accepts a direct child, rejects deeper descendants", () => {
    expect(isDirectChild("/shoot/a.cr3", "/shoot")).toBe(true);
    expect(isDirectChild("/shoot/sub/b.cr3", "/shoot")).toBe(false);
  });

  it("is prefix-safe: /shootout is not under /shoot", () => {
    expect(isDirectChild("/shootout/c.cr3", "/shoot")).toBe(false);
  });

  it("handles backslash separators", () => {
    expect(isDirectChild("C:\\pics\\a.cr3", "C:\\pics")).toBe(true);
    expect(isDirectChild("C:\\pics\\sub\\a.cr3", "C:\\pics")).toBe(false);
  });

  it("rejects the folder itself", () => {
    expect(isDirectChild("/shoot", "/shoot")).toBe(false);
  });
});

describe("mergeExtraFolders", () => {
  it("appends extras as count-0 rows", () => {
    expect(mergeExtraFolders([{ path: "/a", count: 2 }], ["/b"])).toEqual([
      { path: "/a", count: 2 },
      { path: "/b", count: 0 },
    ]);
  });

  it("drops extras the catalog now lists itself", () => {
    expect(mergeExtraFolders([{ path: "/a", count: 2 }], ["/a", "/b"])).toEqual([
      { path: "/a", count: 2 },
      { path: "/b", count: 0 },
    ]);
  });

  it("passes through with no extras", () => {
    expect(mergeExtraFolders([{ path: "/a", count: 1 }], [])).toEqual([{ path: "/a", count: 1 }]);
  });
});
