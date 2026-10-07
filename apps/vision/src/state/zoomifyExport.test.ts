// #465: File ▸ Export ▸ Zoomify writes a tiled pyramid, not one embedded PNG.
// `exportZoomify` runs for real against a recording engine: what is asserted
// is the folder it writes (desktop) or zips (browser), that every tile comes
// from the engine's per-tile encoder in level coordinates, and that each tile
// is written before the next is encoded — the property that keeps peak memory
// at one tile instead of the composite.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const native = vi.hoisted(() => ({ picked: "/out" as string | null, log: [] as string[], mkdirs: [] as string[] }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn(async () => native.picked) }));
vi.mock("@tauri-apps/plugin-fs", () => ({ mkdir: vi.fn(async (dir: string) => { native.mkdirs.push(dir); }) }));
vi.mock("./atomicWrite", () => ({
  atomicWriteBytes: vi.fn(async (path: string) => { native.log.push(`write ${path}`); }),
}));

import { engine, exportZoomify, store } from "./app";
import { atomicWriteBytes } from "./atomicWrite";
import { zoomifyTiles } from "./zoomify";

type TileCall = { x: number; y: number; w: number; h: number; div: number; quality: number; icc: Uint8Array };

/** A 700×300 composite whose tile encoder records every request. */
function recordingEngine(w = 700, h = 300) {
  const tiles: TileCall[] = [];
  const e = {
    width: () => w,
    height: () => h,
    composite: vi.fn(() => { native.log.push("composite"); }),
    export_png: vi.fn(() => new Uint8Array([9])),
    export_pyramid_tile_jpeg: vi.fn((x: number, y: number, tw: number, th: number, div: number, quality: number, icc: Uint8Array) => {
      tiles.push({ x, y, w: tw, h: th, div, quality, icc });
      native.log.push("encode");
      return new Uint8Array([div, x & 255, y & 255]);
    }),
  };
  engine.engine = e as never;
  return { e, tiles };
}

/** The download anchor `saveBytes` needs in node; records what was saved. */
function installDownloadDom() {
  const saved: { name: string; bytes: Uint8Array }[] = [];
  const g = globalThis as Record<string, unknown>;
  let pending: Uint8Array | null = null;
  g.Blob = class { constructor(parts: Uint8Array[]) { pending = parts[0]; } };
  g.URL = { createObjectURL: () => "blob:test", revokeObjectURL: () => {} };
  g.alert = vi.fn();
  g.document = {
    body: { appendChild() {} },
    createElement: () => {
      const a = { href: "", download: "", click: () => saved.push({ name: a.download, bytes: pending! }), remove() {} };
      return a;
    },
  };
  return saved;
}

let onSync: typeof engine.onSync;
let saved: ReturnType<typeof installDownloadDom>;

beforeEach(() => {
  saved = installDownloadDom();
  onSync = engine.onSync;
  engine.onSync = null;
  tauri.enabled = false;
  native.picked = "/out";
  native.log.length = 0;
  native.mkdirs.length = 0;
  vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, colorProfileAssigned: false });
});
afterEach(() => { engine.onSync = onSync; engine.engine = null; vi.restoreAllMocks(); vi.clearAllMocks(); });

const expectedTiles = (w: number, h: number) => [...zoomifyTiles(w, h)];

describe("File ▸ Export ▸ Zoomify on the desktop (#465)", () => {
  it("writes ImageProperties.xml, TileGroup*/z-x-y.jpg tiles and the viewer into a folder", async () => {
    tauri.enabled = true;
    const { e, tiles } = recordingEngine();
    await exportZoomify("poster");

    const written = vi.mocked(atomicWriteBytes).mock.calls.map(([path]) => path);
    const expected = expectedTiles(700, 300);
    expect(written).toEqual([
      ...expected.map((t) => `/out/poster/${t.path}`),
      "/out/poster/ImageProperties.xml",
      "/out/poster/poster.html",
    ]);
    expect(native.mkdirs).toEqual(["/out/poster/TileGroup0/", "/out/poster/"]);

    // Every tile came from the per-tile encoder, in level coordinates.
    expect(tiles.map(({ x, y, w, h, div }) => ({ x, y, w, h, div })))
      .toEqual(expected.map(({ x, y, w, h, div }) => ({ x, y, w, h, div })));
    expect(e.export_png).not.toHaveBeenCalled();

    // The descriptor counts the tiles that were written; the viewer names them.
    const text = (name: string) => new TextDecoder().decode(
      vi.mocked(atomicWriteBytes).mock.calls.find(([path]) => path.endsWith(name))![1],
    );
    expect(text("ImageProperties.xml")).toBe(
      `<IMAGE_PROPERTIES WIDTH="700" HEIGHT="300" NUMTILES="${expected.length}" NUMIMAGES="1" VERSION="1.8" TILESIZE="256" />`,
    );
    expect(text("poster.html")).toContain("TileGroup");
    expect(text("poster.html")).not.toContain("data:image");
  });

  it("composites once, then writes each tile before encoding the next, so memory is one tile deep", async () => {
    tauri.enabled = true;
    const { e } = recordingEngine();
    await exportZoomify("poster");
    // One composite, ahead of every tile — not one per tile.
    expect(e.composite).toHaveBeenCalledTimes(1);
    expect(native.log[0]).toBe("composite");
    const tileOps = native.log.filter((op) => op === "encode" || op.includes("/TileGroup"));
    expect(tileOps.length).toBe(2 * expectedTiles(700, 300).length);
    for (let i = 0; i < tileOps.length; i += 2) {
      expect(tileOps[i]).toBe("encode");
      expect(tileOps[i + 1]).toMatch(/^write \/out\/poster\/TileGroup\d+\/\d+-\d+-\d+\.jpg$/);
    }
  });

  it("carries the document's assigned profile on every tile", async () => {
    tauri.enabled = true;
    const icc = new Uint8Array([1, 2, 3, 4]);
    vi.spyOn(store, "state", "get").mockReturnValue({ ...store.state, colorProfileAssigned: true, iccProfileBytes: icc });
    const { tiles } = recordingEngine();
    await exportZoomify("poster");
    expect(tiles.every((t) => t.icc === icc)).toBe(true);
  });

  it("writes nothing when the folder picker is cancelled", async () => {
    tauri.enabled = true;
    native.picked = null;
    const { e } = recordingEngine();
    await exportZoomify("poster");
    expect(e.export_pyramid_tile_jpeg).not.toHaveBeenCalled();
    expect(atomicWriteBytes).not.toHaveBeenCalled();
  });

  it("reports a tile the engine could not encode instead of writing a broken pyramid", async () => {
    tauri.enabled = true;
    const { e } = recordingEngine();
    e.export_pyramid_tile_jpeg.mockReturnValueOnce(new Uint8Array());
    await exportZoomify("poster");
    expect(alert).toHaveBeenCalledWith(expect.stringContaining("Could not encode tile TileGroup0/0-0-0.jpg"));
    expect(atomicWriteBytes).not.toHaveBeenCalled();
  });
});

describe("File ▸ Export ▸ Zoomify in the browser (#465)", () => {
  it("downloads the same folder as one zip", async () => {
    const { tiles } = recordingEngine();
    await exportZoomify("poster");
    expect(saved.map((s) => s.name)).toEqual(["poster.zip"]);
    expect(tiles).toHaveLength(expectedTiles(700, 300).length);

    const names: string[] = [];
    const zip = saved[0].bytes, dv = new DataView(zip.buffer, zip.byteOffset);
    for (let at = 0; dv.getUint32(at, true) === 0x04034b50;) {
      const size = dv.getUint32(at + 18, true), nameLen = dv.getUint16(at + 26, true);
      names.push(new TextDecoder().decode(zip.subarray(at + 30, at + 30 + nameLen)));
      at += 30 + nameLen + size;
    }
    expect(names).toEqual([
      ...expectedTiles(700, 300).map((t) => `poster/${t.path}`),
      "poster/ImageProperties.xml",
      "poster/poster.html",
    ]);
  });
});
