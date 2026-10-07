import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BATCH_SAVE_OPS, BATCH_SCAN_RE, BATCH_SERIAL_ERROR, DEFAULT_BATCH_TEMPLATE, batchSummary, collectBatchFolder, dropletName, expandBatchTemplate, findDroplet, formatBatchLog, parseBatchSerial, parseDroplet, type BatchDirEntry } from "./batchIo";

describe("Batch file-naming template", () => {
  const march = new Date(2026, 2, 7); // months are 0-based → 20260307

  it("expands name, serial and date tokens", () => {
    expect(expandBatchTemplate("{name}-{serial}-{date}", "shot", 4, march)).toBe("shot-004-20260307");
  });

  it("makes default output names unique", () => {
    expect([
      expandBatchTemplate(DEFAULT_BATCH_TEMPLATE, "shot", 1, march),
      expandBatchTemplate(DEFAULT_BATCH_TEMPLATE, "shot", 2, march),
    ]).toEqual(["shot_001_processed", "shot_002_processed"]);
  });

  it("never lets a template or document name escape the destination folder", () => {
    expect(expandBatchTemplate("../../{name}", "a/b\\c", 1, march)).toBe(".._.._a_b_c");
    expect(expandBatchTemplate("  ", "x", 12, march)).toBe("Batch 012");
  });
});

describe("Batch Starting serial #", () => {
  it("defaults to 1 and accepts whole numbers of 0 or more", () => {
    const valid: Array<[unknown, number]> = [[undefined, 1], ["", 1], [0, 0], [1, 1], ["7", 7], [" 12 ", 12], [42, 42]];
    for (const [value, serial] of valid) expect(parseBatchSerial(value)).toBe(serial);
  });

  it("rejects negatives, fractions and anything that is not a number", () => {
    for (const bad of [-1, "-1", 2.5, "2.5", "abc", Number.NaN, "1e3", null]) expect(parseBatchSerial(bad)).toBeNull();
    expect(BATCH_SERIAL_ERROR).toBe("Starting serial # must be a whole number of 0 or more — nothing was run.");
  });
});

describe("Batch source-folder scan", () => {
  // In-memory tree, keys are directories.
  const tree = new Map<string, BatchDirEntry[]>([
    ["/src", [
      { name: "b.png", isDirectory: false, isFile: true },
      { name: "a.jpg", isDirectory: false, isFile: true },
      { name: "notes.txt", isDirectory: false, isFile: true },
      { name: ".DS_Store", isDirectory: false, isFile: true },
      { name: "sub", isDirectory: true, isFile: false },
    ]],
    ["/src/sub", [
      { name: "c.tif", isDirectory: false, isFile: true },
      { name: ".hidden", isDirectory: true, isFile: false },
    ]],
  ]);
  const reader = { readDir: async (dir: string) => tree.get(dir) ?? [] };

  it("recurses in name order, keeping only batchable files", async () => {
    expect(await collectBatchFolder("/src", reader, true)).toEqual(["/src/a.jpg", "/src/b.png", "/src/sub/c.tif"]);
  });

  it("stays at the top level without Include All Subfolders", async () => {
    expect(await collectBatchFolder("/src", reader, false)).toEqual(["/src/a.jpg", "/src/b.png"]);
  });

  it("accepts raw and project extensions but not arbitrary files", () => {
    for (const ok of ["x.CR3", "x.dng", "x.psd", "x.mvision", "x.jpeg"]) expect(BATCH_SCAN_RE.test(ok)).toBe(true);
    for (const bad of ["x.txt", "x.mp4", "png", "x.png.exe"]) expect(BATCH_SCAN_RE.test(bad)).toBe(false);
  });

  it("discovers the plug-in formats accepted by File Open", async () => {
    const names = ["JP2", "jpf", "jpx", "j2k", "j2c", "jpc", "cin", "dpx", "sdpx", "iff", "ilbm", "lbm", "dcm", "dc3", "dic", "dicom", "rawps"].map((ext) => `scan.${ext}`);
    const files = await collectBatchFolder("/src", {
      readDir: async () => names.map((name) => ({ name, isFile: true, isDirectory: false })),
    }, false);
    expect(new Set(files)).toEqual(new Set(names.map((name) => `/src/${name}`)));
  });
});

describe("Batch error log", () => {
  it("lists every failed file with its message", () => {
    const log = formatBatchLog([{ name: "a.png", message: "too large" }, { name: "b.raw", message: "bad header" }]);
    expect(log).toContain("2 file(s)");
    expect(log).toContain("a.png: too large");
    expect(log).toContain("b.raw: bad header");
  });
});

// Wiring check (colorExportWiring.test.ts idiom): the Batch runner in app.ts
// must route every output through the naming template and, with a destination
// folder, through the atomic writer — not the bare download anchor.
describe("Batch wiring in app.ts", () => {
  const source = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
  const runner = source.slice(
    source.indexOf("async function runBatchInputs("),
    source.indexOf("async function writeBatchOutput("),
  );

  it("names outputs via the template and writes via the destination-aware helper", () => {
    expect(runner).toContain("expandBatchTemplate(");
    expect(runner).toContain("writeBatchOutput(");
    expect(runner).not.toMatch(/\bsaveBytes\(/);
    expect(source).toContain("await atomicWriteBytes(`${destDir}/${filename}`");
  });

  // A new recorded exporter must not escape Override Action "Save As" Commands.
  it("skips exactly the recorded save and export commands", () => {
    const writers = [...source.matchAll(/recordedCall\("((?:save|export)\w*)"/g)].map((m) => m[1]);
    expect(new Set(writers)).toEqual(BATCH_SAVE_OPS);
  });

  it("collects errors instead of alerting per file, and logs them", () => {
    expect(runner).toContain("result.errors.push(");
    expect(runner).toContain("formatBatchLog(");
    expect(runner).not.toContain("reportOpen(");
  });
});

describe("Batch summary", () => {
  it("reports n of N, the names it finished, a cancel and the first failure", () => {
    expect(batchSummary({ processed: 2, errors: [], completed: ["a.png", "b.png"], cancelled: false }, 2))
      .toEqual({ status: "Processed 2 of 2: a.png, b.png", error: undefined });
    const many = ["1", "2", "3", "4", "5", "6"];
    expect(batchSummary({ processed: 6, errors: [{ name: "7", message: "boom" }, { name: "8", message: "bust" }], completed: many, cancelled: true }, 9))
      .toEqual({ status: "Processed 6 of 9 — cancelled: 1, 2, 3, 4, 5, …", error: "2 failed — 7: boom" });
  });
});

// Create Droplet's descriptor (#469). src-tauri/src/droplet.rs is_droplet_text
// accepts exactly the same shapes for `monet-vision droplet.json a.jpg …`.
describe("Droplet descriptors", () => {
  const droplet = { actionName: "Invert", format: "png", template: "{name}_{serial}", stopOnError: false };

  it("parses what Create Droplet saves, and only that", () => {
    expect(parseDroplet(JSON.stringify(droplet, null, 2))).toEqual({ ...droplet, actionId: undefined, destDir: undefined });
    expect(parseDroplet(JSON.stringify({ actionId: 3, format: "tiff", template: "", destDir: "/out", stopOnError: true, extra: 1 })))
      .toEqual({ actionId: 3, actionName: undefined, format: "tiff", template: "", destDir: "/out", stopOnError: true });
  });

  // The command line decides in Rust (droplet.rs is_droplet_text) and a drop in
  // TypeScript: the one fixture keeps a file from being a droplet to one and a
  // document to the other.
  it("agrees with the Rust check on every shared shape", () => {
    const shapes = JSON.parse(readFileSync(new URL("../../src-tauri/fixtures/droplet-shapes.json", import.meta.url), "utf8")) as Record<string, string[]>;
    for (const text of shapes.droplets) expect(parseDroplet(text), text).not.toBeNull();
    for (const text of shapes.notDroplets) expect(parseDroplet(text), text).toBeNull();
  });

  it("names a droplet after its app, or its file", () => {
    expect(dropletName("/Users/me/Desktop/Web Export.app/Contents/Resources/droplet.json")).toBe("Web Export");
    expect(dropletName("/Users/me/Resize.JSON")).toBe("Resize");
    expect(dropletName("C:\\drops\\Resize.json")).toBe("Resize");
  });

  it("finds the droplet among dropped items and makes the rest its inputs", async () => {
    const texts: Record<string, string> = { "/d/Resize.json": JSON.stringify(droplet), "/d/package.json": "{}" };
    const reads: string[] = [];
    const read = async (path: string) => { reads.push(path); return texts[path] ?? ""; };
    await expect(findDroplet(["/in/a.jpg", "/d/package.json", "/d/Resize.json", "/in/more"], (p) => p, read)).resolves.toEqual({
      droplet: parseDroplet(texts["/d/Resize.json"]), name: "Resize", inputs: ["/in/a.jpg", "/d/package.json", "/in/more"],
    });
    expect(reads).toEqual(["/d/package.json", "/d/Resize.json"]); // images are never read to check
  });

  it("finds none in plain files, other JSON or an unreadable descriptor, so they open as before", async () => {
    const read = async (path: string) => {
      if (path === "/d/locked.json") throw new Error("denied");
      return "{}";
    };
    await expect(findDroplet(["/in/a.jpg", "/in/b.png"], (p) => p, read)).resolves.toBeNull();
    await expect(findDroplet(["/d/package.json", "/d/locked.json", "/in/a.jpg"], (p) => p, read)).resolves.toBeNull();
  });
});
