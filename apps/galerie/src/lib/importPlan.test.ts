// Dated destinations format capture times in local time, so pin the zone —
// otherwise the expected folder names would drift with the machine's TZ.
process.env.TZ = "UTC";

import { describe, expect, it } from "vitest";

import { planImport, type ImportPlanOptions } from "./importPlan";

const opts = (o: Partial<ImportPlanOptions>): ImportPlanOptions => ({
  handling: "add",
  destDir: "/dest",
  rename: false,
  template: "{name}",
  startNumber: 1,
  ...o,
});

describe("planImport", () => {
  it("add handling imports in place (dest === src)", () => {
    expect(planImport(["/a/x.cr3", "/b/y.jpg"], opts({ handling: "add" }))).toEqual([
      { src: "/a/x.cr3", dest: "/a/x.cr3", second: null },
      { src: "/b/y.jpg", dest: "/b/y.jpg", second: null },
    ]);
  });

  it("copy without rename keeps the basename in the dest folder", () => {
    const items = planImport(["/a/x.cr3", "/b/y.jpg"], opts({ handling: "copy" }));
    expect(items.map((i) => i.dest)).toEqual(["/dest/x.cr3", "/dest/y.jpg"]);
  });

  it("copy with rename applies the sequence template", () => {
    const items = planImport(
      ["/a/x.cr3", "/b/y.cr3"],
      opts({ handling: "copy", rename: true, template: "shoot-{sequence:3}", startNumber: 5 }),
    );
    expect(items.map((i) => i.dest)).toEqual(["/dest/shoot-005.cr3", "/dest/shoot-006.cr3"]);
  });

  it("falls back to add when copy has no destination", () => {
    expect(planImport(["/a/x.cr3"], opts({ handling: "copy", destDir: null }))[0].dest).toBe("/a/x.cr3");
  });

  it("suffixes within-batch collisions so nothing is overwritten", () => {
    const items = planImport(["/a/x.cr3", "/b/x.cr3"], opts({ handling: "copy" }));
    expect(items.map((i) => i.dest)).toEqual(["/dest/x.cr3", "/dest/x-1.cr3"]);
  });

  it("strips a trailing slash on destDir", () => {
    expect(planImport(["/a/x.cr3"], opts({ handling: "copy", destDir: "/dest/" }))[0].dest).toBe("/dest/x.cr3");
  });

  // 1455540829 = 2016-02-15T12:53:49Z; 1700000000 = 2023-11-14T22:13:20Z (TZ=UTC).
  const dates = new Map<string, number | null>([
    ["/a/x.cr3", 1455540829],
    ["/b/y.cr3", 1700000000],
    ["/c/z.cr3", null],
  ]);

  it("organizes copies into YYYY/YYYY-MM-DD subfolders by capture date", () => {
    const items = planImport(
      ["/a/x.cr3", "/b/y.cr3"],
      opts({ handling: "copy", organizeByDate: true }),
      dates,
    );
    expect(items.map((i) => i.dest)).toEqual([
      "/dest/2016/2016-02-15/x.cr3",
      "/dest/2023/2023-11-14/y.cr3",
    ]);
  });

  it("puts a file with no known capture date straight in destDir", () => {
    const items = planImport(["/c/z.cr3"], opts({ handling: "copy", organizeByDate: true }), dates);
    expect(items[0].dest).toBe("/dest/z.cr3");
  });

  it("does not date-organize when the option is off", () => {
    const items = planImport(["/a/x.cr3"], opts({ handling: "copy" }), dates);
    expect(items[0].dest).toBe("/dest/x.cr3");
  });

  it("same-name files on different dates no longer collide", () => {
    const items = planImport(
      ["/a/x.cr3", "/b/x.cr3"],
      opts({ handling: "copy", organizeByDate: true }),
      new Map([["/a/x.cr3", 1455540829], ["/b/x.cr3", 1700000000]]),
    );
    expect(items.map((i) => i.dest)).toEqual([
      "/dest/2016/2016-02-15/x.cr3",
      "/dest/2023/2023-11-14/x.cr3",
    ]);
  });

  it("plans a second copy of the untouched original, ignoring rename and date folders", () => {
    const items = planImport(
      ["/a/x.cr3"],
      opts({
        handling: "copy",
        rename: true,
        template: "shoot-{sequence:3}",
        organizeByDate: true,
        secondCopyDir: "/backup/",
      }),
      dates,
    );
    expect(items).toEqual([
      { src: "/a/x.cr3", dest: "/dest/2016/2016-02-15/shoot-001.cr3", second: "/backup/x.cr3" },
    ]);
  });

  it("suffixes second-copy collisions independently of the destination", () => {
    const items = planImport(
      ["/a/x.cr3", "/b/x.cr3"],
      opts({ handling: "copy", secondCopyDir: "/backup" }),
    );
    expect(items.map((i) => i.second)).toEqual(["/backup/x.cr3", "/backup/x-1.cr3"]);
    expect(items.map((i) => i.dest)).toEqual(["/dest/x.cr3", "/dest/x-1.cr3"]);
  });

  it("makes no second copy for an in-place add (Lightroom's Copy-only option)", () => {
    const items = planImport(["/a/x.cr3"], opts({ handling: "add", secondCopyDir: "/backup" }));
    expect(items[0].second).toBeNull();
  });
});
