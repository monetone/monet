import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(), isTauri: () => true }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: vi.fn(async () => false),
  writeFile: vi.fn(),
  writeTextFile: vi.fn(),
}));
vi.mock("../catalog/catalog", () => ({
  getRecipe: vi.fn(async () => null),
  listPhotoKeywords: vi.fn(async () => []),
  listStack: vi.fn(async () => []),
  stackPhotos: vi.fn(async () => 42),
}));
vi.mock("../export", () => ({ exportBytes: vi.fn(async () => new Uint8Array([1, 2, 3])) }));
vi.mock("../import", () => ({ importPathsWithIds: vi.fn(async () => [77]) }));

import { invoke } from "@tauri-apps/api/core";
import { exists, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";

import { getRecipe, listPhotoKeywords, listStack, stackPhotos } from "../catalog/catalog";
import type { PhotoRow } from "../catalog/types";
import { exportBytes } from "../export";
import { importPathsWithIds } from "../import";
import { editInVision, freeDerivativePath } from "./editIn";

const master = {
  id: 7,
  path: "/photos/IMG_0001.cr3",
  format: "raw:CR3",
  rating: 4,
  colorLabel: "Red",
  title: "Harbour",
  caption: null,
  creator: null,
  copyright: null,
  city: null,
  stateProvince: null,
  country: null,
  jobTitle: null,
  credit: null,
  source: null,
  stackId: null,
} as PhotoRow;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(exists).mockResolvedValue(false);
  vi.mocked(getRecipe).mockResolvedValue(null);
  vi.mocked(listPhotoKeywords).mockResolvedValue([]);
  vi.mocked(listStack).mockResolvedValue([]);
  vi.mocked(stackPhotos).mockResolvedValue(42);
  vi.mocked(exportBytes).mockResolvedValue(new Uint8Array([1, 2, 3]));
  vi.mocked(importPathsWithIds).mockResolvedValue([77]);
  vi.mocked(invoke).mockResolvedValue(undefined);
});

describe("freeDerivativePath", () => {
  it("names the first derivative -Edit and skips taken names (image or sidecar)", async () => {
    const used = new Set(["/photos/IMG_0001-Edit.png", "/photos/IMG_0001-Edit-2.xmp"]);
    expect(await freeDerivativePath("/photos/IMG_0001.cr3", async (p) => used.has(p)))
      .toBe("/photos/IMG_0001-Edit-3.png");
    expect(await freeDerivativePath("/photos/IMG_0001.cr3", async () => false))
      .toBe("/photos/IMG_0001-Edit.png");
  });
});

describe("editInVision", () => {
  it("renders, sidecars, launches Vision, imports and stacks — in that order", async () => {
    const order: string[] = [];
    vi.mocked(writeFile).mockImplementation(async () => void order.push("image"));
    vi.mocked(writeTextFile).mockImplementation(async () => void order.push("xmp"));
    vi.mocked(invoke).mockImplementation(async () => void order.push("launch"));
    vi.mocked(importPathsWithIds).mockImplementation(async () => {
      order.push("import");
      return [77];
    });
    vi.mocked(stackPhotos).mockImplementation(async () => {
      order.push("stack");
      return 42;
    });
    vi.mocked(getRecipe).mockResolvedValue(JSON.stringify({ basic: { exposure: 1.5 } }));
    vi.mocked(listPhotoKeywords).mockResolvedValue([{ id: 1, name: "Harbour" }] as never);

    const res = await editInVision(master);

    expect(order).toEqual(["image", "xmp", "launch", "import", "stack"]);
    expect(res).toEqual({
      path: "/photos/IMG_0001-Edit.png",
      photoId: 77,
      stackId: 42,
      launchError: null,
    });

    // The derivative is the master baked at its recipe, written to the -Edit path.
    expect(vi.mocked(exportBytes).mock.calls[0][0]).toBe(master);
    expect(vi.mocked(writeFile).mock.calls[0][0]).toBe("/photos/IMG_0001-Edit.png");

    // The sidecar sits beside it and carries the recipe + catalog metadata in the
    // one shared Camera Raw dialect.
    const [xmpPath, xml] = vi.mocked(writeTextFile).mock.calls[0] as [string, string];
    expect(xmpPath).toBe("/photos/IMG_0001-Edit.xmp");
    expect(xml).toContain('crs:Exposure2012="1.5"');
    expect(xml).toContain('xmp:Rating="4"');
    expect(xml).toContain("<rdf:li>Harbour</rdf:li>");

    // Vision gets the derivative path, not the master's.
    expect(invoke).toHaveBeenCalledWith("plugin:catalog|catalog_open_in_app", {
      app: "Monet Vision",
      path: "/photos/IMG_0001-Edit.png",
    });

    // The import is explicit, so the duplicate heuristic never swallows it.
    expect(importPathsWithIds).toHaveBeenCalledWith(["/photos/IMG_0001-Edit.png"], {
      skipDuplicates: false,
    });
    expect(stackPhotos).toHaveBeenCalledWith([7, 77]);
  });

  it("keeps the master's existing stack members instead of tearing it out", async () => {
    vi.mocked(listStack).mockResolvedValue([{ id: 7 }, { id: 8 }] as never);
    await editInVision({ ...master, stackId: 5 });
    expect(listStack).toHaveBeenCalledWith(5);
    expect(stackPhotos).toHaveBeenCalledWith([7, 8, 77]);
  });

  it("still catalogs and stacks the derivative when Vision cannot be launched", async () => {
    vi.mocked(invoke).mockRejectedValue("Monet Vision could not be launched");
    const res = await editInVision(master);
    expect(res.launchError).toBe("Monet Vision could not be launched");
    expect(res.photoId).toBe(77);
    expect(res.stackId).toBe(42);
  });

  it("does not stack when the import produced no photo", async () => {
    vi.mocked(importPathsWithIds).mockResolvedValue([]);
    const res = await editInVision(master);
    expect(res).toMatchObject({ photoId: null, stackId: null });
    expect(stackPhotos).not.toHaveBeenCalled();
  });
});
