// Every local import (Liquify mesh, swatches, styles, actions, notes, 3D LUT,
// Scripts ▸ Browse) must read an untrusted file through a bounded reader on
// BOTH the native and the browser path — an oversized file has to be refused
// before anything allocates it.
//
// This drives the real importers. `@tauri-apps/plugin-fs` is replaced by an
// in-memory file whose reported size we control, and its unbounded entry points
// (readFile / readTextFile / stat) throw, so a regression back to them fails
// loudly instead of quietly reading a 4 GiB file into the heap.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));
const nativeFs = vi.hoisted(() => ({
  bytes: new Uint8Array(64),
  reportedSize: 64,
  opened: [] as string[],
  reads: 0,
}));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => nativeFs.opened.at(-1) ?? "/in/file.dat" }));
vi.mock("@tauri-apps/plugin-fs", () => {
  const unbounded = (name: string) => () => { throw new Error(`${name} is an unbounded read`); };
  return {
    SeekMode: { Start: 0, Current: 1, End: 2 },
    readFile: unbounded("readFile"),
    readTextFile: unbounded("readTextFile"),
    stat: unbounded("stat"),
    mkdir: async () => {},
    remove: async () => {},
    open: async (path: string) => {
      nativeFs.opened.push(path);
      let cursor = 0;
      return {
        async stat() { return { isFile: true, size: nativeFs.reportedSize }; },
        async read(buffer: Uint8Array) {
          nativeFs.reads++;
          const n = Math.min(buffer.length, nativeFs.bytes.length - cursor);
          if (n <= 0) return null;
          buffer.set(nativeFs.bytes.subarray(cursor, cursor + n));
          cursor += n;
          return n;
        },
        async seek(offset: number) { cursor = offset; return offset; },
        async close() {},
      };
    },
  };
});

import {
  browseAndRunScript,
  importActionsFile,
  importColorLutFile,
  importLiquifyMeshFile,
  importNotesFromBytes,
  importNotesFile,
  importPresetSetBytes,
  importStylesFromBytes,
  importStylesFile,
  importSwatchesFromBytes,
  importSwatchesFile,
  loadProofSetupFile,
  pickLocalFileBytes,
  setDocumentNoticeSink,
  store,
} from "./app";
import { SHORTCUT_SET_FILTERS, SHORTCUT_SET_LIMIT } from "./shortcutSets";
import { MAX_CUBE_LUT_IMPORT_BYTES, MAX_CUBE_LUT_SIZE, parseCubeLut } from "@monet-ui/monet-photo";
import { buildAco } from "@monet-ui/monet-imageio";
import { buildAsl, DEFAULT_STYLE_PRESETS } from "./stylePresets";
import { buildGrd } from "./presetManager";

/** 1 TiB: past every importer's ceiling, and still a safe integer. */
const TOO_BIG = 1024 ** 4;

let alerts: string[];
let notices: string[];

function installStorage() {
  const cells = new Map<string, string>();
  (globalThis as { localStorage?: Storage }).localStorage = {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  } as Storage;
}

/** A browser File that screams if anything reads it past the size preflight. */
function trapFile(name: string, size: number) {
  const touched: string[] = [];
  const file = {
    name,
    size,
    async arrayBuffer() { touched.push("arrayBuffer"); return new ArrayBuffer(8); },
    async text() { touched.push("text"); return ""; },
    slice() { return file; },
  };
  return { file, touched };
}

/** document.createElement("input") that immediately hands `file` back. */
function installFilePicker(file: unknown) {
  (globalThis as Record<string, unknown>).document = {
    body: { appendChild() {} },
    createElement: () => {
      const inp = {
        type: "", accept: "", style: {},
        files: [file],
        onchange: null as null | (() => void),
        click: () => { inp.onchange?.(); },
        remove() {},
      };
      return inp;
    },
  };
}

function installCancelledFilePicker() {
  let removed = 0;
  (globalThis as Record<string, unknown>).document = {
    body: { appendChild() {} },
    createElement: () => {
      const inp = {
        type: "", accept: "", style: {}, files: [],
        onchange: null as null | (() => void),
        oncancel: null as null | (() => void),
        click: () => { inp.oncancel?.(); },
        remove: () => { removed++; },
      };
      return inp;
    },
  };
  return () => removed;
}

/** Every importer under test, with the value it returns when nothing imported. */
const IMPORTERS: ReadonlyArray<readonly [string, () => Promise<unknown>, unknown]> = [
  ["Liquify mesh", importLiquifyMeshFile, false],
  ["swatches", importSwatchesFile, 0],
  ["styles", importStylesFile, 0],
  ["actions", importActionsFile, { imported: 0, rejected: [] }],
  ["notes", importNotesFile, 0],
  ["3D LUT", importColorLutFile, false],
  ["shortcut set", () => pickLocalFileBytes(SHORTCUT_SET_FILTERS, SHORTCUT_SET_LIMIT), null],
];

beforeEach(() => {
  installStorage();
  alerts = [];
  notices = [];
  vi.stubGlobal("alert", (m: string) => { alerts.push(m); });
  vi.spyOn(console, "error").mockImplementation(() => {});
  setDocumentNoticeSink((m) => notices.push(m));
  nativeFs.bytes = new Uint8Array(64);
  nativeFs.reportedSize = 64;
  nativeFs.opened.length = 0;
  nativeFs.reads = 0;
});
afterEach(() => {
  setDocumentNoticeSink(null);
  tauri.enabled = false;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("native local imports go through the bounded file handle", () => {
  beforeEach(() => { tauri.enabled = true; });

  it.each(IMPORTERS)("reads %s through one opened handle, never an unbounded API", async (_label, run) => {
    await run();
    // The unbounded plugin-fs entry points throw; getting here without one of
    // their messages means the import really used the bounded reader.
    expect(nativeFs.opened).toHaveLength(1);
    expect(nativeFs.reads).toBeGreaterThan(1); // signature prefix + the payload
    expect(alerts.join("\n")).not.toContain("unbounded read");
  });

  it.each(IMPORTERS)("refuses an oversized %s before allocating it", async (label, run, nothing) => {
    nativeFs.reportedSize = TOO_BIG;

    expect(await run()).toEqual(nothing);
    expect(nativeFs.reads).toBe(1); // only the signature prefix was ever read
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toContain(label);
    expect(alerts[0]).toMatch(/size limit/);
  });

  it("reads a browsed script through the bounded handle and refuses an oversized one", async () => {
    await browseAndRunScript();
    expect(nativeFs.opened).toHaveLength(1);
    expect(nativeFs.reads).toBeGreaterThan(1);

    nativeFs.opened.length = 0;
    nativeFs.reads = 0;
    nativeFs.reportedSize = TOO_BIG;
    await browseAndRunScript();
    expect(nativeFs.reads).toBe(1);
    expect(notices.at(-1)).toMatch(/size limit/);
  });
});

describe("browser local imports refuse an oversized File before reading it", () => {
  it("settles and removes the shared browser picker on cancel", async () => {
    const removed = installCancelledFilePicker();

    await expect(loadProofSetupFile()).resolves.toBe(false);
    expect(removed()).toBe(1);
  });

  it.each(IMPORTERS)("never asks an oversized %s File for its contents", async (label, run, nothing) => {
    const { file, touched } = trapFile(`huge.${label}`, TOO_BIG);
    installFilePicker(file);

    expect(await run()).toEqual(nothing);
    expect(touched).toEqual([]); // arrayBuffer()/text() would have allocated it
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/size limit/);
  });

  it("never asks an oversized script File for its text", async () => {
    const { file, touched } = trapFile("huge.js", TOO_BIG);
    installFilePicker(file);

    await browseAndRunScript();

    expect(touched).toEqual([]);
    expect(notices.at(-1)).toMatch(/size limit/);
  });

  it("does read a File that is within the limit", async () => {
    const { file, touched } = trapFile("small.aco", 16);
    installFilePicker(file);

    await importSwatchesFile();

    expect(touched).toEqual(["arrayBuffer"]);
  });
});

describe("local import feedback", () => {
  it("reports a selected LUT that cannot be parsed", async () => {
    tauri.enabled = true;
    nativeFs.bytes = new TextEncoder().encode("this is not a LUT");
    nativeFs.reportedSize = nativeFs.bytes.length;

    await expect(importColorLutFile()).resolves.toBe(false);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatch(/supported 3D LUT/);
  });

  it("distinguishes malformed, imported and duplicate swatch libraries", () => {
    expect(importSwatchesFromBytes(new Uint8Array([1, 2, 3]))).toBe(0);
    expect(notices.at(-1)).toMatch(/No colours found/);

    const merge = vi.spyOn(store, "importSwatches").mockReturnValueOnce(1).mockReturnValueOnce(0);
    const bytes = buildAco(["#123456"]);
    expect(importSwatchesFromBytes(bytes)).toBe(1);
    expect(notices.at(-1)).toBe("Imported 1 of 1 colours.");
    expect(importSwatchesFromBytes(bytes)).toBe(0);
    expect(notices.at(-1)).toMatch(/already a swatch/);
    merge.mockRestore();
  });

  it("reports empty and successful style libraries", () => {
    expect(importStylesFromBytes(buildAsl([]))).toBe(0);
    expect(notices.at(-1)).toMatch(/No styles found/);
    expect(importStylesFromBytes(buildAsl([DEFAULT_STYLE_PRESETS[0]]))).toBe(1);
    expect(notices.at(-1)).toBe("Imported 1 style.");
  });

  it("reports partial libraries and wrong-category Preset Manager swatches", () => {
    const merge = vi.spyOn(store, "importSwatches").mockReturnValue(4096);
    expect(importSwatchesFromBytes(buildAco(Array(4097).fill("#123456")))).toBe(4096);
    expect(notices.at(-1)).toMatch(/1 colour was not imported/);
    const grd = buildGrd([{ name: "Wrong category", stops: [
      { pos: 0, r: 0, g: 0, b: 0, a: 255 },
      { pos: 1, r: 255, g: 255, b: 255, a: 255 },
    ] }]);
    expect(() => importPresetSetBytes("swatches", grd)).toThrow(/supported swatch file/);
    merge.mockRestore();
  });

  it("reports malformed and successful Notes imports", () => {
    const current = store.state;
    const state = vi.spyOn(store, "state", "get").mockReturnValue({
      ...current,
      doc: { ...current.doc, width: 100, height: 100 },
    });
    expect(importNotesFromBytes(new TextEncoder().encode("not a PDF"))).toBe(0);
    expect(notices.at(-1)).toMatch(/No notes found/);

    const add = vi.spyOn(store, "importNotes").mockReturnValue(1);
    const fdf = new TextEncoder().encode("%FDF-1.2\n<< /FDF << /Annots [ << /Subtype /Text /Rect [1 2 3 4] /Contents (Hello) >> ] >> >>");
    expect(importNotesFromBytes(fdf)).toBe(1);
    expect(notices.at(-1)).toBe("Imported 1 note.");
    add.mockRestore();
    state.mockRestore();
  });
});

// The .cube parser moved to the shared @monet-ui/monet-photo package (Phase 1);
// its own ceiling has to bite before split() duplicates the text and before the
// value array can grow without bound.
describe("Cube LUT import is bounded on its own", () => {
  it("rejects text past the import ceiling without splitting it", () => {
    const oversized = `LUT_3D_SIZE 2\n${"0 0 0\n".repeat(8)}`.padEnd(MAX_CUBE_LUT_IMPORT_BYTES + 1, " ");
    expect(oversized.length).toBeGreaterThan(MAX_CUBE_LUT_IMPORT_BYTES);
    expect(parseCubeLut(oversized)).toBeNull();
  });

  it("rejects a lattice larger than the supported grid instead of accumulating it", () => {
    const size = MAX_CUBE_LUT_SIZE + 1;
    expect(parseCubeLut(`LUT_3D_SIZE ${size}\n0 0 0\n`)).toBeNull();
  });

  it("refuses a body with more triplets than any declared lattice can hold", () => {
    // No LUT_3D_SIZE at all: the value accumulator is what has to stop this.
    const body = "0.5 0.5 0.5\n".repeat(MAX_CUBE_LUT_SIZE ** 3 + 8);
    expect(parseCubeLut(body)).toBeNull();
  });

  it("still parses a well-formed LUT", () => {
    const lut = parseCubeLut(`LUT_3D_SIZE 2\n${"0 0 0\n".repeat(8)}`);
    expect(lut?.size).toBe(2);
    expect(lut?.data).toHaveLength(24);
  });
});
