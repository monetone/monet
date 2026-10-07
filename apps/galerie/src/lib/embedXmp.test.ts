import { describe, expect, it } from "vitest";

import { embedXmpJpeg, embedXmpPng } from "./embedXmp";

const SOI = [0xff, 0xd8];
const EOI = [0xff, 0xd9];
/** A JFIF APP0 segment: marker + length(16) + 14 payload bytes. */
const APP0 = [0xff, 0xe0, 0x00, 0x10, ...new Array<number>(14).fill(0)];

const decode = (bytes: Uint8Array): string => new TextDecoder().decode(bytes);

describe("embedXmpJpeg", () => {
  it("inserts the APP1 packet right after the SOI when there is no APP0", () => {
    const out = embedXmpJpeg(new Uint8Array([...SOI, ...EOI]), "<x/>");
    expect([out[0], out[1]]).toEqual(SOI);
    expect([out[2], out[3]]).toEqual([0xff, 0xe1]);
    const text = decode(out);
    expect(text).toContain("http://ns.adobe.com/xap/1.0/\0<?xpacket begin=");
    expect(text).toContain('id="W5M0MpCehiHzreSzNTczkc9d"');
    expect(text).toContain("<x/>");
    expect(text).toContain('<?xpacket end="w"?>');
    // Trailer intact.
    expect([out[out.length - 2], out[out.length - 1]]).toEqual(EOI);
  });

  it("drops the XML declaration, which is illegal inside a packet", () => {
    const out = embedXmpJpeg(new Uint8Array([...SOI, ...EOI]), '<?xml version="1.0"?>\n<x/>\n');
    expect(decode(out)).not.toContain("<?xml");
  });

  it("places the packet after a JFIF APP0 rather than before it", () => {
    const out = embedXmpJpeg(new Uint8Array([...SOI, ...APP0, ...EOI]), "<x/>");
    expect(Array.from(out.slice(0, 2 + APP0.length))).toEqual([...SOI, ...APP0]);
    expect([out[2 + APP0.length], out[3 + APP0.length]]).toEqual([0xff, 0xe1]);
  });

  it("writes a segment length that counts itself (the JPEG contract)", () => {
    const xmp = "<x>hello</x>";
    const out = embedXmpJpeg(new Uint8Array([...SOI, ...EOI]), xmp);
    const declared = (out[4] << 8) | out[5];
    // marker(2) + length(2) + payload, inserted into the original 4 bytes.
    expect(out.length).toBe(4 + 4 + (declared - 2));
    expect(decode(out)).toContain(xmp);
  });

  it("rejects non-JPEG input instead of producing a corrupt file", () => {
    expect(() => embedXmpJpeg(new Uint8Array([0x89, 0x50]), "<x/>")).toThrow(/not a JPEG/);
  });

  it("rejects a packet too large for one APP1 rather than truncating it", () => {
    expect(() => embedXmpJpeg(new Uint8Array([...SOI, ...EOI]), "x".repeat(70000))).toThrow(/APP1/);
  });
});

// --- PNG ---------------------------------------------------------------

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** length(4 BE) + type + data + crc(4). The CRC value is irrelevant to the
 *  reader under test (it only walks lengths), so zeros keep the fixture small. */
function rawChunk(type: string, dataLen = 0): number[] {
  const t = [...new TextEncoder().encode(type)];
  return [0, 0, 0, dataLen, ...t, ...new Array<number>(dataLen).fill(0), 0, 0, 0, 0];
}

const minimalPng = (extra: number[] = []): Uint8Array =>
  new Uint8Array([...PNG_SIG, ...rawChunk("IHDR", 13), ...extra, ...rawChunk("IEND")]);

/** Read back the chunk list so assertions describe structure, not offsets. */
function chunkTypes(png: Uint8Array): string[] {
  const out: string[] = [];
  let at = PNG_SIG.length;
  while (at + 8 <= png.length) {
    const len = (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
    out.push(new TextDecoder().decode(png.subarray(at + 4, at + 8)));
    at += 12 + len;
  }
  return out;
}

function crc32Ref(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c ^= bytes[i];
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  }
  return (c ^ 0xffffffff) >>> 0;
}

describe("embedXmpPng", () => {
  it("inserts an iTXt chunk immediately before IEND", () => {
    const out = embedXmpPng(minimalPng(), "<x/>");
    expect(chunkTypes(out)).toEqual(["IHDR", "iTXt", "IEND"]);
  });

  it("keeps the packet after existing chunks rather than displacing them", () => {
    const out = embedXmpPng(minimalPng(rawChunk("IDAT", 4)), "<x/>");
    expect(chunkTypes(out)).toEqual(["IHDR", "IDAT", "iTXt", "IEND"]);
  });

  it("writes the registered XMP keyword, uncompressed, with the packet body", () => {
    const out = embedXmpPng(minimalPng(), "<x>tagged</x>");
    const text = decode(out);
    expect(text).toContain("XML:com.adobe.xmp");
    expect(text).toContain("<?xpacket begin=");
    expect(text).toContain("<x>tagged</x>");
    // keyword \0 then compressionFlag=0 (uncompressed) — a 1 here would mean
    // deflate, and readers scanning for the raw packet would miss it.
    const kw = text.indexOf("XML:com.adobe.xmp");
    expect(out[kw + "XML:com.adobe.xmp".length]).toBe(0);
    expect(out[kw + "XML:com.adobe.xmp".length + 1]).toBe(0);
  });

  it("writes a CRC over type||data that a reader can verify", () => {
    const out = embedXmpPng(minimalPng(), "<x/>");
    // Walk to the iTXt chunk and re-derive its CRC independently.
    let at = PNG_SIG.length;
    for (;;) {
      const len = (out[at] << 24) | (out[at + 1] << 16) | (out[at + 2] << 8) | out[at + 3];
      const type = new TextDecoder().decode(out.subarray(at + 4, at + 8));
      if (type === "iTXt") {
        const stored = ((out[at + 8 + len] << 24) | (out[at + 9 + len] << 16)
          | (out[at + 10 + len] << 8) | out[at + 11 + len]) >>> 0;
        expect(stored).toBe(crc32Ref(out.subarray(at + 4, at + 8 + len)));
        return;
      }
      at += 12 + len;
    }
  });

  it("rejects non-PNG input and a PNG with no IEND", () => {
    expect(() => embedXmpPng(new Uint8Array([0xff, 0xd8]), "<x/>")).toThrow(/not a PNG/);
    const noEnd = new Uint8Array([...PNG_SIG, ...rawChunk("IHDR", 13)]);
    expect(() => embedXmpPng(noEnd, "<x/>")).toThrow(/IEND/);
  });
});
