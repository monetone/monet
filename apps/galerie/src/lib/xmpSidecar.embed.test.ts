// LR parity for Save Metadata to File: the XMP packet goes INTO containers
// that can hold one (JPEG/PNG) and beside proprietary raw as a `.xmp` sidecar.
// A JPEG that only ever got a sidecar is metadata nothing else reads back.
import { beforeEach, describe, expect, it, vi } from "vitest";

/** In-memory fs shared by the module mock and the assertions. */
const text = new Map<string, string>();
const bin = new Map<string, Uint8Array>();

vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (p: string) => {
    const f = text.get(p);
    if (f == null) throw new Error(`no such file: ${p}`);
    return f;
  }),
  writeTextFile: vi.fn(async (p: string, c: string) => {
    text.set(p, c);
  }),
  readFile: vi.fn(async (p: string) => {
    const f = bin.get(p);
    if (f == null) throw new Error(`no such file: ${p}`);
    return f;
  }),
  writeFile: vi.fn(async (p: string, c: Uint8Array) => {
    bin.set(p, c);
  }),
  rename: vi.fn(async (from: string, to: string) => {
    const f = bin.get(from);
    if (f == null) throw new Error(`no such file: ${from}`);
    bin.delete(from);
    bin.set(to, f);
  }),
}));

import { extractXmpJpeg, extractXmpPng } from "./embedXmp";
import { readXmpText, writeXmpFor, xmpTargetFor } from "./xmpSidecar";

/** A minimal but structurally valid JPEG: SOI, an APP0/JFIF, SOS, EOI. */
function jpeg(): Uint8Array {
  return new Uint8Array([
    0xff, 0xd8, // SOI
    0xff, 0xe0, 0x00, 0x04, 0x00, 0x00, // APP0, length 4
    0xff, 0xda, 0x00, 0x02, // SOS
    0x11, 0x22, 0x33, // entropy-coded bytes (must survive untouched)
    0xff, 0xd9, // EOI
  ]);
}

/** A minimal PNG: signature + IHDR-shaped chunk + IEND. */
function png(): Uint8Array {
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  const ihdr = [0, 0, 0, 1, 0x49, 0x48, 0x44, 0x52, 0x07, 0, 0, 0, 0];
  const iend = [0, 0, 0, 0, 0x49, 0x45, 0x4e, 0x44, 0xae, 0x42, 0x60, 0x82];
  return new Uint8Array([...sig, ...ihdr, ...iend]);
}

const XML = `<?xml version="1.0"?><x:xmpmeta xmlns:x="adobe:ns:meta/"><rdf:RDF/></x:xmpmeta>`;

beforeEach(() => {
  text.clear();
  bin.clear();
});

describe("xmpTargetFor", () => {
  it("embeds into containers that hold a packet, sidecars raw", () => {
    expect(xmpTargetFor("/p/IMG_1.JPG")).toBe("jpeg");
    expect(xmpTargetFor("/p/IMG_1.jpeg")).toBe("jpeg");
    expect(xmpTargetFor("/p/IMG_1.png")).toBe("png");
    expect(xmpTargetFor("/p/IMG_1.cr3")).toBe("sidecar");
    expect(xmpTargetFor("/p/IMG_1.NEF")).toBe("sidecar");
    // ponytail: TIFF/PSD/DNG could embed but have no writer yet.
    expect(xmpTargetFor("/p/IMG_1.dng")).toBe("sidecar");
    expect(xmpTargetFor("/p/no_extension")).toBe("sidecar");
  });
});

describe("writeXmpFor", () => {
  it("writes a JPEG's metadata into the file, not a stray sidecar", async () => {
    bin.set("/p/IMG_1.jpg", jpeg());
    const { path, onDisk } = await writeXmpFor("/p/IMG_1.jpg", XML);

    expect(path).toBe("/p/IMG_1.jpg"); // the Sidecar Files field stays empty
    expect(text.has("/p/IMG_1.xmp")).toBe(false);
    const out = bin.get("/p/IMG_1.jpg")!;
    expect(extractXmpJpeg(out)).toContain("x:xmpmeta");
    // The baseline digests exactly what a later read sees.
    expect(await readXmpText("/p/IMG_1.jpg")).toBe(onDisk);
    // The image itself is untouched: entropy-coded bytes and EOI survive.
    expect([...out.subarray(out.length - 5)]).toEqual([0x11, 0x22, 0x33, 0xff, 0xd9]);
    expect(bin.has("/p/IMG_1.jpg.monet-tmp")).toBe(false); // temp cleaned by rename
  });

  it("replaces the packet on re-save instead of stacking a second one", async () => {
    bin.set("/p/IMG_1.jpg", jpeg());
    await writeXmpFor("/p/IMG_1.jpg", XML);
    const once = bin.get("/p/IMG_1.jpg")!.length;
    const { onDisk } = await writeXmpFor("/p/IMG_1.jpg", XML.replace("<rdf:RDF/>", "<rdf:RDF />"));

    const twice = bin.get("/p/IMG_1.jpg")!;
    expect(twice.length).toBe(once + 1); // one packet, one byte longer
    expect(await readXmpText("/p/IMG_1.jpg")).toBe(onDisk);
    expect(onDisk).toContain("<rdf:RDF />");
  });

  it("writes a PNG's metadata into an iTXt chunk, replacing on re-save", async () => {
    bin.set("/p/shot.png", png());
    const { path, onDisk } = await writeXmpFor("/p/shot.png", XML);
    expect(path).toBe("/p/shot.png");
    expect(text.has("/p/shot.xmp")).toBe(false);
    expect(extractXmpPng(bin.get("/p/shot.png")!)).toBe(onDisk);

    const first = bin.get("/p/shot.png")!.length;
    await writeXmpFor("/p/shot.png", XML);
    expect(bin.get("/p/shot.png")!.length).toBe(first);
    expect(await readXmpText("/p/shot.png")).toBe(onDisk);
  });

  it("still sidecars proprietary raw, leaving the master untouched", async () => {
    bin.set("/p/IMG_1.cr3", new Uint8Array([1, 2, 3]));
    const { path, onDisk } = await writeXmpFor("/p/IMG_1.cr3", XML);

    expect(path).toBe("/p/IMG_1.xmp");
    expect(text.get("/p/IMG_1.xmp")).toBe(XML);
    expect(onDisk).toBe(XML);
    expect([...bin.get("/p/IMG_1.cr3")!]).toEqual([1, 2, 3]);
    expect(await readXmpText("/p/IMG_1.cr3")).toBe(XML);
  });

  it("leaves the master untouched when the packet cannot be embedded", async () => {
    bin.set("/p/fake.jpg", new Uint8Array([0x00, 0x01, 0x02]));
    await expect(writeXmpFor("/p/fake.jpg", XML)).rejects.toThrow(/not a JPEG/);
    expect([...bin.get("/p/fake.jpg")!]).toEqual([0x00, 0x01, 0x02]);
  });
});

describe("readXmpText", () => {
  it("is null when the file carries no packet and there is no sidecar", async () => {
    bin.set("/p/IMG_2.jpg", jpeg());
    expect(await readXmpText("/p/IMG_2.jpg")).toBeNull();
    expect(await readXmpText("/p/missing.cr3")).toBeNull();
  });
});
