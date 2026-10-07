import { describe, expect, it } from "vitest";

import { planFolderSync, sourceDirs } from "./folderSync";

const EXT = new Set(["jpg", "dng"]);

describe("sourceDirs", () => {
  it("collects distinct parent directories, sorted", () => {
    expect(sourceDirs(["/a/1.jpg", "/a/2.jpg", "/b/x/3.dng"])).toEqual(["/a", "/b/x"]);
  });

  it("ignores bare filenames without a directory", () => {
    expect(sourceDirs(["1.jpg"])).toEqual([]);
  });
});

describe("planFolderSync", () => {
  it("returns only extension-matched files the catalog doesn't know", () => {
    const out = planFolderSync(
      ["/a/known.jpg"],
      [{ dir: "/a", files: ["/a/known.jpg", "/a/new.jpg", "/a/skip.txt", "/a/NEW2.DNG"] }],
      EXT,
    );
    expect(out).toEqual(["/a/NEW2.DNG", "/a/new.jpg"]);
  });

  it("de-duplicates across listings and sorts", () => {
    const out = planFolderSync(
      [],
      [
        { dir: "/a", files: ["/a/b.jpg", "/a/a.jpg"] },
        { dir: "/a", files: ["/a/b.jpg"] },
      ],
      EXT,
    );
    expect(out).toEqual(["/a/a.jpg", "/a/b.jpg"]);
  });

  it("finds nothing when every file is cataloged", () => {
    expect(planFolderSync(["/a/1.jpg"], [{ dir: "/a", files: ["/a/1.jpg"] }], EXT)).toEqual([]);
  });
});
