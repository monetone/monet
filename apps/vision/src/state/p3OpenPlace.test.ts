// #525 opening a path that is already open focuses that tab.
// #528 a user File ▸ New is not replaced by the next open.
// #532 Save and Save As land on Open Recent.
// #537 a Document Browser drop is a desktop drop target.
// #516 Place and Load Files into Stack use Open's transcoders and profile policy.
// #515 doc.new opens a tab and reports the de-duplicated title.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: true, invoke: vi.fn(async (..._args: unknown[]) => new ArrayBuffer(0)) }));
const decodeAvifMock = vi.hoisted(() => vi.fn());

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", () => ({
  isTauri: () => tauri.enabled,
  invoke: (...args: unknown[]) => tauri.invoke(...args),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({ remove: vi.fn(async () => {}), readDir: vi.fn(async () => []) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message: async () => "Cancel", ask: async () => false, save: async () => null, open: async () => null }));
vi.mock("./nativeBoundedRead", () => ({ readNativeFileBounded: vi.fn(async () => new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0])) }));
vi.mock("./avifDecoder", () => ({ decodeAvif: (...args: unknown[]) => decodeAvifMock(...args) }));

import { engine, openPaths, placeEmbeddedFromBytes, placeImageFile, placeLinkedFromBytes, stackImages, store } from "./app";
import { newDocument } from "../mcp/commands";
import { isVisionFileDropTarget, VISION_FILE_DROP_SELECTOR } from "./fileDropTarget";
import { readNativeFileBounded } from "./nativeBoundedRead";
import { flatLayerProbe } from "./flatLayerProbe";

const placed: Uint8Array[] = [];
const converted: unknown[][] = [];

function installStorage(): void {
  const cells = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    get length() { return cells.size; },
    clear: () => cells.clear(),
    key: (i: number) => [...cells.keys()][i] ?? null,
    getItem: (k: string) => cells.get(k) ?? null,
    setItem: (k: string, v: string) => { cells.set(k, v); },
    removeItem: (k: string) => { cells.delete(k); },
  });
}

function fakeEngine() {
  const target: Record<string, unknown> = {
    ...flatLayerProbe(),
    width: () => 32,
    height: () => 32,
    place_smart_object: (bytes: Uint8Array) => { placed.push(bytes.slice()); return 7; },
    importImage: (bytes: Uint8Array) => { placed.push(bytes.slice()); return 8; },
    convert_layer_profile: (...args: unknown[]) => { converted.push(args); return true; },
  };
  return new Proxy(target, {
    get(t, prop) {
      if (prop in t) return t[prop as string];
      if (typeof prop !== "string") return undefined;
      return () => 0;
    },
  });
}

class TestImageData {
  constructor(public data: Uint8ClampedArray, public width: number, public height: number) {}
}

function pngChunk(type: string, data: Uint8Array): Uint8Array<ArrayBuffer> {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  out.set(Array.from(type, (c) => c.charCodeAt(0)), 4);
  out.set(data, 8);
  return out;
}

/** iCCP whose name matches a built-in profile. The deflate payload is empty, so detection uses the name. */
function pngNamed(name: string): Uint8Array<ArrayBuffer> {
  const named = new TextEncoder().encode(name);
  const data = new Uint8Array(named.length + 2);
  data.set(named, 0);
  const sig = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const body = pngChunk("iCCP", data);
  const out = new Uint8Array(sig.length + body.length);
  out.set(sig, 0);
  out.set(body, sig.length);
  return out;
}

function tgaPixel(): Uint8Array<ArrayBuffer> {
  const bytes = new Uint8Array(21);
  bytes[2] = 2;
  bytes[12] = 1;
  bytes[14] = 1;
  bytes[16] = 24;
  bytes[17] = 0x20;
  bytes[18] = 10;
  bytes[19] = 20;
  bytes[20] = 30;
  return bytes;
}

function installSvgDom(png: Uint8Array): void {
  class Img {
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  }
  vi.stubGlobal("Image", Img);
  vi.stubGlobal("URL", { createObjectURL: () => "blob:svg", revokeObjectURL: () => {} });
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ({ drawImage() {} }),
    toBlob: (cb: (blob: Blob | null) => void) => { cb(new Blob([new Uint8Array(png)])); },
  };
  vi.stubGlobal("document", { createElement: () => canvas, body: { appendChild() {} } });
}

beforeEach(() => {
  installStorage();
  placed.length = 0;
  converted.length = 0;
  tauri.enabled = true;
  tauri.invoke.mockReset();
  decodeAvifMock.mockReset();
  vi.stubGlobal("ImageData", TestImageData);
  vi.stubGlobal("alert", () => {});
  vi.spyOn(engine, "buildNew").mockImplementation(() => fakeEngine() as never);
  vi.spyOn(engine, "buildImage").mockImplementation(() => fakeEngine() as never);
  vi.mocked(readNativeFileBounded).mockResolvedValue(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]));
});

afterEach(() => {
  for (const id of [...store.openDocIds()]) store.closeDoc(id);
  engine.engine = null;
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("open, recent files, and doc.new (#525, #528, #532, #515)", () => {
  it("focuses the tab that already has the path instead of opening a second one", async () => {
    await openPaths(["/docs/twice.png"]);
    const first = store.state.activeDocId;
    store.newDocument(16, 16, "Other");
    expect(store.state.activeDocId).not.toBe(first);

    await openPaths(["/docs/twice.png"]);

    expect(store.state.activeDocId).toBe(first);
    expect(store.openDocIds()).toHaveLength(2);
    expect(store.docIdForSavedPath("/docs/twice.png")).toBe(first);
  });

  it("keeps an untouched user New document when a file opens", async () => {
    store.newDocument(16, 16, "Mine");
    const mine = store.state.activeDocId;

    await openPaths(["/docs/photo.png"]);

    expect(store.openDocIds()).toContain(mine);
    expect(store.openDocIds()).toHaveLength(2);
  });

  it("adds Save As and a later in-place save to Open Recent", () => {
    store.newDocument(16, 16, "Draft");
    const id = store.state.activeDocId;
    const revision = store.docContentRevision(id);
    expect(revision).not.toBeNull();

    expect(store.setDocPathAfterSave(id, "/docs/as.png", revision!)).toBe(true);
    expect(store.state.recentFiles.map((r) => r.path)).toContain("/docs/as.png");

    store.clearRecentFiles();
    store.markDirty();
    const saved = store.docContentRevision(id);
    expect(store.markDocSavedAtRevision(id, saved!)).toBe(true);
    expect(store.state.recentFiles.map((r) => r.path)).toContain("/docs/as.png");
  });

  it("opens a new tab and reports the de-duplicated title", () => {
    store.newDocument(32, 32, "Poster");
    expect(newDocument(32, 32, "Poster")).toBe('Created 32×32 document "Poster-2"');
    expect(store.state.documents.map((d) => d.name)).toEqual(["Poster", "Poster-2"]);
  });
});

describe("Document Browser is a desktop drop target (#537)", () => {
  it("accepts a hit on the browser and rejects a hit elsewhere", () => {
    const browser = { closest: (selector: string) => selector === VISION_FILE_DROP_SELECTOR ? {} : null } as unknown as Element;
    const elsewhere = { closest: () => null } as unknown as Element;
    expect(VISION_FILE_DROP_SELECTOR).toContain(".mv-docbrowser");
    expect(isVisionFileDropTarget(browser)).toBe(true);
    expect(isVisionFileDropTarget(elsewhere)).toBe(false);
  });
});

describe("Place and stack decode through Open and convert the embedded profile (#516)", () => {
  it("converts an Adobe RGB PNG into an sRGB document instead of copying the numbers", async () => {
    store.newDocument(16, 16, "Canvas");
    store.setColorPolicyPrefs({ embeddedProfilePolicy: "convert" });

    await placeEmbeddedFromBytes(pngNamed("Adobe RGB (1998)"), "wide.png");

    expect(converted).toHaveLength(1);
    expect(converted[0][0]).toBe(7);
    expect(converted[0][1]).toBe(2);
    expect(converted[0][3]).toBe(0);
    expect(converted[0][5]).toBe(1);
    expect(converted[0][6]).toBe(true);
  });

  it("leaves an sRGB PNG's numbers alone in an sRGB document", async () => {
    store.newDocument(16, 16, "Canvas");
    store.setColorPolicyPrefs({ embeddedProfilePolicy: "convert" });

    await placeLinkedFromBytes(pngNamed("sRGB IEC61966-2.1"), "plain.png", "/pics/plain.png");

    expect(converted).toEqual([]);
    expect(placed[0]?.[0]).toBe(0x89);
  });

  it("hands Place Embedded decodable PNG for TGA, SVG, AVIF, and HEIC", async () => {
    store.newDocument(16, 16, "Canvas");
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    installSvgDom(png);
    decodeAvifMock.mockResolvedValue(new TestImageData(new Uint8ClampedArray([1, 2, 3, 255]), 1, 1));
    const packed = new Uint8Array(12);
    new DataView(packed.buffer).setUint32(0, 1, true);
    new DataView(packed.buffer).setUint32(4, 1, true);
    packed.set([9, 8, 7, 255], 8);
    tauri.invoke.mockResolvedValue(packed.buffer);

    await placeImageFile(new File([tgaPixel()], "dot.tga"));
    await placeImageFile(new File([new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"></svg>')], "mark.svg"));
    await placeImageFile(new File([new Uint8Array([1, 2, 3, 4])], "pic.avif"));
    await placeEmbeddedFromBytes(new Uint8Array([1, 2, 3, 4]), "shot.heic");

    expect(placed).toHaveLength(4);
    expect(placed.every((bytes) => bytes[0] === 0x89 && bytes[1] === 0x50)).toBe(true);
    expect(decodeAvifMock).toHaveBeenCalledOnce();
    expect(tauri.invoke).toHaveBeenCalledWith("plugin:heic|decode_heic", expect.any(Uint8Array));
  });

  it("decodes a later stack file through the same transcoder", async () => {
    store.newDocument(16, 16, "Canvas");
    const landed = await stackImages([
      { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0, 0]), name: "first.png" },
      { bytes: tgaPixel(), name: "second.tga" },
    ]);

    expect(landed).toBe(2);
    expect(placed).toHaveLength(1);
    expect(placed[0][0]).toBe(0x89);
    expect(placed[0][1]).toBe(0x50);
  });
});
