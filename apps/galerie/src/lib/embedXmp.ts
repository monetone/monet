// embedXmp — read/write an XMP packet inside an encoded image: JPEG (APP1
// segment) or PNG (iTXt chunk). Canvas-encoded exports carry no metadata at
// all, so a delivered file lost its copyright, creator, caption and keywords
// (LR's Export ▸ Metadata section); Save Metadata to File writes through the
// same pair for formats that can hold a packet. Pure byte surgery — no deps,
// no canvas — so it unit-tests directly.
//
// Embedding REPLACES an existing packet, because Save Metadata to File runs
// against the same master file over and over.
//
// ponytail: the native 16-bit TIFF / linear-DNG route is still metadata-free;
// that writer lives in Rust and is a separate follow-up.

/** APP1's XMP namespace signature, NUL-terminated (per the XMP spec). */
const XMP_NS = "http://ns.adobe.com/xap/1.0/\0";
/** An APP1 payload is length-prefixed by a u16 that counts itself. */
const MAX_APP1_PAYLOAD = 0xffff - 2;
/** The spec's fixed packet id — how readers recognize an XMP packet. */
const PACKET_ID = "W5M0MpCehiHzreSzNTczkc9d";

/** Wrap XMP in the xpacket PI an embedded packet needs. An XML declaration is
 *  legal in a standalone sidecar but not inside a packet, so it is dropped.
 *  Exported so callers can predict the exact text `extractXmp*` reads back
 *  (the metadata-status baseline digests it). */
export function xpacket(xmp: string): string {
  const body = xmp.replace(/^\s*<\?xml[^?]*\?>\s*/, "").trimEnd();
  // The spec marks the packet encoding with a BOM; built from its code point
  // so no invisible character sits in this source file.
  const bom = String.fromCharCode(0xfeff);
  return `<?xpacket begin="${bom}" id="${PACKET_ID}"?>\n${body}\n<?xpacket end="w"?>`;
}

/**
 * Return a copy of `jpeg` carrying `xmp` as an APP1 segment. The segment is
 * placed after the SOI and after any leading APP0/JFIF segments, where readers
 * expect it. Throws if `jpeg` is not a JPEG, or if the packet exceeds a single
 * APP1 (ExtendedXMP is not implemented — the caller counts the failure rather
 * than silently shipping a file with the metadata missing).
 */
export function embedXmpJpeg(source: Uint8Array, xmp: string): Uint8Array {
  if (source.length < 2 || source[0] !== 0xff || source[1] !== 0xd8) {
    throw new Error("not a JPEG (missing SOI)");
  }
  const payload = new TextEncoder().encode(XMP_NS + xpacket(xmp));
  if (payload.length > MAX_APP1_PAYLOAD) {
    throw new Error("XMP packet exceeds one APP1 segment");
  }
  // Saving metadata into the same file twice must REPLACE the packet, not stack
  // a second one (readers take the first, so a stale packet would win).
  const jpeg = stripXmpJpeg(source);

  // Skip the SOI, then any APP0 (JFIF) segments — XMP goes after them.
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff && jpeg[at + 1] === 0xe0) {
    const len = (jpeg[at + 2] << 8) | jpeg[at + 3];
    if (len < 2) break; // malformed length — insert here rather than run off
    at += 2 + len;
  }
  at = Math.min(at, jpeg.length);

  const segment = new Uint8Array(4 + payload.length);
  segment[0] = 0xff;
  segment[1] = 0xe1;
  segment[2] = ((payload.length + 2) >> 8) & 0xff;
  segment[3] = (payload.length + 2) & 0xff;
  segment.set(payload, 4);

  const out = new Uint8Array(jpeg.length + segment.length);
  out.set(jpeg.subarray(0, at), 0);
  out.set(segment, at);
  out.set(jpeg.subarray(at), at + segment.length);
  return out;
}

const XMP_NS_BYTES = new TextEncoder().encode(XMP_NS);

/** JPEG marker segments, SOI-exclusive, stopping at the SOS (past which the
 *  bytes are entropy-coded and marker parsing would read noise). A malformed
 *  length ends the walk rather than running off the end. */
function* jpegSegments(jpeg: Uint8Array): Generator<{ at: number; marker: number; end: number }> {
  let at = 2;
  while (at + 4 <= jpeg.length && jpeg[at] === 0xff) {
    const marker = jpeg[at + 1];
    if (marker === 0xda || marker === 0xd9) return; // SOS / EOI
    const len = (jpeg[at + 2] << 8) | jpeg[at + 3];
    if (len < 2 || at + 2 + len > jpeg.length) return;
    yield { at, marker, end: at + 2 + len };
    at += 2 + len;
  }
}

function isXmpApp1(jpeg: Uint8Array, seg: { at: number; marker: number }): boolean {
  return seg.marker === 0xe1 && XMP_NS_BYTES.every((b, i) => jpeg[seg.at + 4 + i] === b);
}

/** `jpeg` with every XMP APP1 removed; the input itself when it carries none. */
function stripXmpJpeg(jpeg: Uint8Array): Uint8Array {
  const drops = [...jpegSegments(jpeg)].filter((s) => isXmpApp1(jpeg, s));
  if (!drops.length) return jpeg;
  const out = new Uint8Array(jpeg.length - drops.reduce((n, s) => n + (s.end - s.at), 0));
  let cursor = 0;
  let o = 0;
  for (const s of drops) {
    out.set(jpeg.subarray(cursor, s.at), o);
    o += s.at - cursor;
    cursor = s.end;
  }
  out.set(jpeg.subarray(cursor), o);
  return out;
}

/** The XMP packet a JPEG carries (verbatim, xpacket wrapper included), or null
 *  when it has none / isn't a JPEG. */
export function extractXmpJpeg(jpeg: Uint8Array): string | null {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return null;
  for (const seg of jpegSegments(jpeg)) {
    if (!isXmpApp1(jpeg, seg)) continue;
    return new TextDecoder().decode(jpeg.subarray(seg.at + 4 + XMP_NS_BYTES.length, seg.end));
  }
  return null;
}


// --- PNG ---------------------------------------------------------------
// PNG spec: an iTXt chunk is
//   keyword \0 compressionFlag(1) compressionMethod(1) languageTag \0
//   translatedKeyword \0 text
// and XMP's registered keyword is "XML:com.adobe.xmp" (uncompressed, per the
// XMP spec, so readers that scan for the raw packet still find it).

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const XMP_KEYWORD = "XML:com.adobe.xmp";

/** CRC-32 (IEEE), the PNG chunk checksum. Table built once on first use. */
let crcTable: Uint32Array | null = null;
function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = crcTable[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function u32(value: number): number[] {
  return [(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff];
}

/** A complete PNG chunk: length + type + data + CRC(type||data). Exported for
 *  the pHYs (export ppi) writer in exportImage. */
export function chunk(type: string, data: Uint8Array): Uint8Array {
  const typeBytes = new TextEncoder().encode(type);
  const body = new Uint8Array(typeBytes.length + data.length);
  body.set(typeBytes, 0);
  body.set(data, typeBytes.length);
  const out = new Uint8Array(4 + body.length + 4);
  out.set(u32(data.length), 0);
  out.set(body, 4);
  out.set(u32(crc32(body)), 4 + body.length);
  return out;
}

/** PNG chunks in file order: `at` is the length field, `data` the payload
 *  start, `end` one past the CRC. A truncated/malformed length ends the walk. */
function* pngChunks(png: Uint8Array): Generator<{ at: number; data: number; end: number }> {
  let at = PNG_SIGNATURE.length;
  while (at + 8 <= png.length) {
    const len = (png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3];
    if (len < 0 || at + 12 + len > png.length) return;
    yield { at, data: at + 8, end: at + 12 + len };
    at += 12 + len;
  }
}

/** Byte offset of the first chunk of `type`, or -1. Walks the chunk list rather
 *  than scanning for the tag, so a matching byte run inside pixel data can't
 *  be mistaken for a chunk header. */
export function findChunk(png: Uint8Array, type: string): number {
  const want = new TextEncoder().encode(type);
  for (const c of pngChunks(png)) if (want.every((byte, i) => png[c.at + 4 + i] === byte)) return c.at;
  return -1;
}

const ITXT_TYPE = new TextEncoder().encode("iTXt");
/** The registered keyword plus its terminating NUL — how an XMP iTXt starts. */
const XMP_KEY_BYTES = new TextEncoder().encode(`${XMP_KEYWORD}\0`);

/** The XMP iTXt chunk: its byte range plus where the text payload begins. */
function findXmpItxt(png: Uint8Array): { at: number; end: number; text: number } | null {
  for (const c of pngChunks(png)) {
    if (!ITXT_TYPE.every((b, i) => png[c.at + 4 + i] === b)) continue;
    if (!XMP_KEY_BYTES.every((b, i) => png[c.data + i] === b)) continue;
    // keyword\0 flag method langTag\0 translated\0 text — the two tags are
    // scanned rather than assumed empty, so a foreign writer's chunk reads too.
    let p = c.data + XMP_KEY_BYTES.length + 2;
    for (let tag = 0; tag < 2; tag++) {
      p = png.indexOf(0, p) + 1;
      if (p <= 0 || p > c.end) return null; // malformed — treat as no packet
    }
    return { at: c.at, end: c.end, text: p };
  }
  return null;
}

/** The XMP packet a PNG carries (verbatim, xpacket wrapper included), or null. */
export function extractXmpPng(png: Uint8Array): string | null {
  if (png.length < 8 || !PNG_SIGNATURE.every((byte, i) => png[i] === byte)) return null;
  const found = findXmpItxt(png);
  // The CRC is the last 4 bytes of the chunk, not part of the text.
  return found ? new TextDecoder().decode(png.subarray(found.text, found.end - 4)) : null;
}

/**
 * Return a copy of `png` carrying `xmp` as an uncompressed iTXt chunk, inserted
 * immediately before IEND. Throws if `png` is not a PNG or has no IEND — the
 * caller counts the failure rather than silently shipping a file with the
 * metadata missing.
 */
export function embedXmpPng(source: Uint8Array, xmp: string): Uint8Array {
  if (source.length < 8 || !PNG_SIGNATURE.every((byte, i) => source[i] === byte)) {
    throw new Error("not a PNG (bad signature)");
  }
  // Re-saving must replace the packet, not stack a second XMP iTXt.
  const old = findXmpItxt(source);
  let png = source;
  if (old) {
    png = new Uint8Array(source.length - (old.end - old.at));
    png.set(source.subarray(0, old.at), 0);
    png.set(source.subarray(old.end), old.at);
  }
  const iend = findChunk(png, "IEND");
  if (iend < 0) throw new Error("PNG has no IEND chunk");

  const keyword = new TextEncoder().encode(XMP_KEYWORD);
  const text = new TextEncoder().encode(xpacket(xmp));
  // keyword \0 flag method langTag \0 translated \0 text — the two empty tags
  // are each just their terminating NUL.
  const data = new Uint8Array(keyword.length + 1 + 1 + 1 + 1 + 1 + text.length);
  let o = 0;
  data.set(keyword, o); o += keyword.length;
  data[o++] = 0; // keyword terminator
  data[o++] = 0; // compression flag: uncompressed
  data[o++] = 0; // compression method (ignored when uncompressed)
  data[o++] = 0; // empty language tag
  data[o++] = 0; // empty translated keyword
  data.set(text, o);

  const itxt = chunk("iTXt", data);
  const out = new Uint8Array(png.length + itxt.length);
  out.set(png.subarray(0, iend), 0);
  out.set(itxt, iend);
  out.set(png.subarray(iend), iend + itxt.length);
  return out;
}
