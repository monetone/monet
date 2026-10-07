// ─────────────────────────────────────────────────────────────
// container-sniff.test — the format discriminator (FMT-01 / GFX-01)
// ─────────────────────────────────────────────────────────────
// Guards the three ways Artisan used to open the wrong thing:
//   • any leading `{` was called an Artisan document, so a Cinema/Rythme
//     `.monet` died as "not a valid Artisan document" instead of saying what it
//     was;
//   • any `PK\x03\x04` was called a CorelDRAW X4/X5 zip, so a Monet container
//     dropped on Artisan produced a plausible, EMPTY document;
//   • only `.monetgfx` counted as a container, so another app's extension was
//     handed to an importer that could not read it.
// The container itself needs the wasm engine (io/commands routes it there);
// what is testable in node — and what actually broke — is the routing.

import { describe, expect, it } from "vitest";
import { IO } from "../../engine";
import { makeDocument } from "../../engine";
import { detectFormat, importFile, isMonetContainer } from "./index";

const bytes = (s: string): Uint8Array => Uint8Array.from(s, (c) => c.charCodeAt(0) & 0xff);

/** A STORE-only zip local header + one entry, the shape the container writer emits. */
function zipWithFirstEntry(name: string, data = "x"): Uint8Array {
  const head = new Uint8Array(30);
  const dv = new DataView(head.buffer);
  dv.setUint32(0, 0x04034b50, true);
  dv.setUint16(4, 20, true); // version needed
  dv.setUint16(26, name.length, true);
  dv.setUint16(28, 0, true); // extra len
  return Uint8Array.from([...head, ...bytes(name), ...bytes(data)]);
}

describe("isMonetContainer", () => {
  it("accepts a zip whose first entry is manifest.json", () => {
    expect(isMonetContainer(zipWithFirstEntry("manifest.json"))).toBe(true);
  });

  it("rejects a CorelDRAW-style zip and non-zips", () => {
    expect(isMonetContainer(zipWithFirstEntry("drawing.cdr"))).toBe(false);
    expect(isMonetContainer(bytes("PK\x03\x04"))).toBe(false); // truncated
    expect(isMonetContainer(bytes("{}"))).toBe(false);
    expect(isMonetContainer(new Uint8Array(0))).toBe(false);
  });
});

describe("detectFormat", () => {
  it("routes a container ahead of the CorelDRAW zip sniff, whatever it is named", () => {
    expect(detectFormat("shared.mart", zipWithFirstEntry("manifest.json"))).toBe("container");
    // The manifest decides, never the extension — a Cinema file renamed `.mvis`
    // (or given no known extension at all) is still a container.
    expect(detectFormat("renamed.mvis", zipWithFirstEntry("manifest.json"))).toBe("container");
    expect(detectFormat("nameless.txt", zipWithFirstEntry("manifest.json"))).toBe("container");
    expect(detectFormat("drawing.cdr", zipWithFirstEntry("drawing.cdr"))).toBe("zip");
  });

  it("falls back to every registry extension when the bytes could not be sniffed", () => {
    for (const ext of ["mart", "mvis", "mgal", "mcin", "mani", "mryt", "mjou"]) {
      expect(detectFormat(`shared.${ext}`, bytes("\x00\x01\x02"))).toBe("container");
    }
  });

  it("only calls JSON `artisan` when the discriminator says so", () => {
    const doc = IO.serializeDocument(makeDocument("Round trip"));
    expect(detectFormat("a.artisan", bytes(doc))).toBe("artisan");
    // A tagless body is not an Artisan document — every writer stamps `format`.
    expect(detectFormat("a.artisan", bytes('{"layers":[],"artboards":[]}'))).toBe("unknown");
    // Foreign Monet documents must NOT be claimed.
    expect(detectFormat("clip.monet", bytes('{"format":"monet","schemaVersion":1}'))).toBe("unknown");
  });
});

describe("importFile refuses foreign documents by name", () => {
  it("names the foreign format instead of dying as 'not an Artisan document'", async () => {
    await expect(importFile("clip.monet", bytes('{"format":"monet","schemaVersion":1,"document":{}}'))).rejects.toThrow(/"monet" document/);
  });

  it("never lets a container fall through to the CorelDRAW importer", async () => {
    await expect(importFile("shared.mart", zipWithFirstEntry("manifest.json"))).rejects.toThrow(/Monet container/);
  });

  it("fails loudly on a zip with no CorelDRAW payload rather than opening it empty", async () => {
    await expect(importFile("mystery.cdr", zipWithFirstEntry("hello.txt"))).rejects.toThrow(/No CorelDRAW RIFF data/);
  });
});
