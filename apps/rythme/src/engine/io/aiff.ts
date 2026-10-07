// ─────────────────────────────────────────────────────────────
// engine/io/aiff — AIFF / AIFC decoder & encoder
// ─────────────────────────────────────────────────────────────
// Apple's big-endian Audio Interchange File Format. Decodes uncompressed AIFF
// and the common AIFC variants (NONE/twos = big-endian, sowt = little-endian,
// fl32/fl64 = IEEE float). Encodes big-endian signed PCM. The sample rate is
// stored as an 80-bit IEEE extended float, which we (de)serialise by hand.

import { createAudioData } from "../audio/buffer";
import { clampSample } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { compactMetadata, type AudioMetadata } from "./metadata";

/** A marker embedded in an AIFF file (a MARK entry): a time in seconds + optional name. */
export interface AiffMarker {
  time: number;
  name?: string;
}

export interface AiffEncodeOptions {
  bitDepth?: 16 | 24 | 32;
  /** Markers to embed in a MARK chunk (names inline as Pascal strings). */
  markers?: AiffMarker[];
  /** AIFF text metadata chunks. */
  metadata?: AudioMetadata;
}

/** Encode AudioData as uncompressed big-endian AIFF. */
export function encodeAiff(d: AudioData, opts: AiffEncodeOptions = {}): Uint8Array {
  const bitDepth = opts.bitDepth ?? 16;
  const channels = Math.max(1, channelCount(d));
  const frames = frameCount(d);
  const bytesPerSample = bitDepth / 8;
  const dataSize = frames * channels * bytesPerSample;
  const ssndSize = 8 + dataSize; // offset + blockSize + samples
  const commSize = 18;

  const cues = (opts.markers ?? []).filter((m) => Number.isFinite(m.time) && m.time >= 0);
  const mark = cues.length ? buildMarkChunk(cues, d.sampleRate) : new Uint8Array(0);
  const metadata = buildMetadataChunks(opts.metadata);

  const total = 4 + (8 + commSize) + mark.length + metadata.length + (8 + ssndSize);
  const buffer = new ArrayBuffer(8 + total);
  const view = new DataView(buffer);

  writeStr(view, 0, "FORM");
  view.setUint32(4, total, false);
  writeStr(view, 8, "AIFF");

  let p = 12;
  writeStr(view, p, "COMM");
  view.setUint32(p + 4, commSize, false);
  view.setUint16(p + 8, channels, false);
  view.setUint32(p + 10, frames, false);
  view.setUint16(p + 14, bitDepth, false);
  writeExtended(view, p + 16, d.sampleRate);
  p += 8 + commSize;

  if (mark.length) {
    new Uint8Array(buffer).set(mark, p);
    p += mark.length;
  }
  if (metadata.length) {
    new Uint8Array(buffer).set(metadata, p);
    p += metadata.length;
  }

  writeStr(view, p, "SSND");
  view.setUint32(p + 4, ssndSize, false);
  view.setUint32(p + 8, 0, false); // offset
  view.setUint32(p + 12, 0, false); // blockSize
  let off = p + 16;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      off = writeSampleBE(view, off, d.channels[c][i] ?? 0, bitDepth);
    }
  }
  return new Uint8Array(buffer);
}

/** Read AIFF text metadata chunks; {} if it has none. */
export function decodeAiffMetadata(bytes: Uint8Array | ArrayBuffer): AudioMetadata {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.byteLength < 12 || readStr(view, 0, 4) !== "FORM") return {};
  const formType = readStr(view, 8, 4);
  if (formType !== "AIFF" && formType !== "AIFC") return {};

  const out: AudioMetadata = {};
  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, false);
    const body = p + 8;
    const value = new TextDecoder().decode(u8.subarray(body, body + size)).trim();
    if (id === "NAME") out.title = value;
    else if (id === "AUTH") out.artist = value;
    else if (id === "(c) ") out.copyright = value;
    else if (id === "ANNO") out.comment = value;
    p = body + size + (size % 2);
  }
  return compactMetadata(out);
}

/** Build a `MARK` chunk (8-byte header + body + word-align pad) for a set of markers. */
function buildMarkChunk(markers: AiffMarker[], sampleRate: number): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const entries = markers.map((m, i) => ({ id: i + 1, position: Math.round(m.time * sampleRate), name: m.name ? enc(m.name) : new Uint8Array(0) }));
  // body = numMarkers(2) + Σ [ id(2) + position(4) + pstring(1 + nameLen, padded to even) ].
  let body = 2;
  for (const e of entries) body += 6 + evenUp(1 + e.name.length);
  const pad = body % 2;
  const buf = new ArrayBuffer(8 + body + pad);
  const view = new DataView(buf);

  writeStr(view, 0, "MARK");
  view.setUint32(4, body, false);
  view.setUint16(8, entries.length, false);
  let p = 10;
  for (const e of entries) {
    view.setInt16(p, e.id, false);
    view.setUint32(p + 2, e.position, false);
    view.setUint8(p + 6, e.name.length); // Pascal-string length byte
    new Uint8Array(buf).set(e.name, p + 7);
    p += 6 + evenUp(1 + e.name.length);
  }
  return new Uint8Array(buf);
}

function buildMetadataChunks(metadata: AudioMetadata | undefined): Uint8Array {
  const meta = compactMetadata(metadata ?? {});
  const entries: [string, string | undefined][] = [
    ["NAME", meta.title],
    ["AUTH", meta.artist],
    ["(c) ", meta.copyright],
    ["ANNO", meta.comment ?? meta.description],
  ];
  const chunks = entries.filter((entry): entry is [string, string] => !!entry[1]).map(([id, value]) => buildTextChunk(id, value));
  const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function buildTextChunk(id: string, value: string): Uint8Array {
  const bytes = new TextEncoder().encode(value);
  const pad = bytes.length % 2;
  const buf = new ArrayBuffer(8 + bytes.length + pad);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  writeStr(view, 0, id);
  view.setUint32(4, bytes.length, false);
  out.set(bytes, 8);
  return out;
}

/** Round a Pascal-string length up to an even byte count. */
function evenUp(n: number): number {
  return n + (n % 2);
}

/** Read embedded markers from an AIFF/AIFC MARK chunk; [] if it has none. */
export function decodeAiffMarks(bytes: Uint8Array | ArrayBuffer): AiffMarker[] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.byteLength < 12 || readStr(view, 0, 4) !== "FORM") return [];
  const formType = readStr(view, 8, 4);
  if (formType !== "AIFF" && formType !== "AIFC") return [];

  let sampleRate = 0;
  const raw: { position: number; name: string }[] = [];
  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, false);
    const body = p + 8;
    if (id === "COMM") {
      sampleRate = readExtended(view, body + 8);
    } else if (id === "MARK") {
      const num = view.getUint16(body, false);
      let q = body + 2;
      for (let i = 0; i < num && q + 7 <= body + size; i++) {
        const position = view.getUint32(q + 2, false);
        const nameLen = view.getUint8(q + 6);
        raw.push({ position, name: new TextDecoder().decode(u8.subarray(q + 7, q + 7 + nameLen)) });
        q += 6 + evenUp(1 + nameLen);
      }
    }
    p = body + size + (size % 2);
  }

  const sr = sampleRate > 0 ? Math.round(sampleRate) : 44100;
  return raw.map((m) => {
    const marker: AiffMarker = { time: m.position / sr };
    if (m.name) marker.name = m.name;
    return marker;
  });
}

function writeSampleBE(view: DataView, off: number, s: number, bits: number): number {
  const x = clampSample(s);
  switch (bits) {
    case 16:
      view.setInt16(off, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), false);
      return off + 2;
    case 24: {
      const v = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
      view.setUint8(off, (v >> 16) & 0xff);
      view.setUint8(off + 1, (v >> 8) & 0xff);
      view.setUint8(off + 2, v & 0xff);
      return off + 3;
    }
    case 32:
      view.setInt32(off, Math.round(x < 0 ? x * 0x80000000 : x * 0x7fffffff), false);
      return off + 4;
    default:
      throw new Error(`encodeAiff: unsupported bit depth ${bits}`);
  }
}

/** Decode an AIFF/AIFC file into an AudioData buffer. */
export function decodeAiff(bytes: Uint8Array | ArrayBuffer): AudioData {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (readStr(view, 0, 4) !== "FORM") throw new Error("decodeAiff: not a FORM file");
  const formType = readStr(view, 8, 4);
  if (formType !== "AIFF" && formType !== "AIFC") throw new Error(`decodeAiff: unsupported form ${formType}`);

  let channels = 0;
  let frames = 0;
  let bits = 16;
  let sampleRate = 44100;
  let compression = "NONE";
  let ssndOffset = -1;

  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, false);
    const body = p + 8;
    if (id === "COMM") {
      channels = view.getUint16(body, false);
      frames = view.getUint32(body + 2, false);
      bits = view.getUint16(body + 6, false);
      sampleRate = readExtended(view, body + 8);
      if (formType === "AIFC" && size >= 22) compression = readStr(view, body + 18, 4);
    } else if (id === "SSND") {
      const dataOff = view.getUint32(body, false);
      ssndOffset = body + 8 + dataOff;
    }
    p = body + size + (size % 2);
  }

  if (channels === 0 || ssndOffset < 0) throw new Error("decodeAiff: missing COMM/SSND");
  const littleEndian = compression === "sowt";
  const isFloat = compression === "fl32" || compression === "FL32" || compression === "fl64" || compression === "FL64";
  const bytesPerSample = bits / 8;
  const blockAlign = channels * bytesPerSample;
  const out = createAudioData(channels, frames, Math.round(sampleRate));
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const off = ssndOffset + i * blockAlign + c * bytesPerSample;
      out.channels[c][i] = readSample(view, off, bits, littleEndian, isFloat);
    }
  }
  return out;
}

function readSample(view: DataView, off: number, bits: number, le: boolean, isFloat: boolean): number {
  if (isFloat) return bits === 64 ? view.getFloat64(off, le) : view.getFloat32(off, le);
  switch (bits) {
    case 16:
      return view.getInt16(off, le) / 0x8000;
    case 24: {
      const a = view.getUint8(off);
      const b = view.getUint8(off + 1);
      const c = view.getUint8(off + 2);
      let v = le ? a | (b << 8) | (c << 16) : (a << 16) | (b << 8) | c;
      if (v & 0x800000) v |= ~0xffffff;
      return v / 0x800000;
    }
    case 32:
      return view.getInt32(off, le) / 0x80000000;
    case 8:
      return (view.getInt8(off)) / 128;
    default:
      throw new Error(`decodeAiff: unsupported bit depth ${bits}`);
  }
}

// ── 80-bit IEEE extended (long double) ───────────────────────────────────────

function readExtended(view: DataView, offset: number): number {
  const sign = view.getUint8(offset) & 0x80 ? -1 : 1;
  const exponent = ((view.getUint8(offset) & 0x7f) << 8) | view.getUint8(offset + 1);
  const hiMant = view.getUint32(offset + 2, false);
  const loMant = view.getUint32(offset + 6, false);
  if (exponent === 0 && hiMant === 0 && loMant === 0) return 0;
  const mantissa = hiMant * 4294967296 + loMant;
  return sign * mantissa * Math.pow(2, exponent - 16383 - 63);
}

function writeExtended(view: DataView, offset: number, value: number): void {
  let sign = 0;
  let v = value;
  if (v < 0) {
    sign = 0x8000;
    v = -v;
  }
  let exponent = 0;
  let hiMant = 0;
  let loMant = 0;
  if (v !== 0) {
    exponent = Math.floor(Math.log2(v));
    const frac = v / Math.pow(2, exponent); // [1, 2)
    exponent += 16383;
    const mantissa = frac * Math.pow(2, 63); // [2^63, 2^64)
    hiMant = Math.floor(mantissa / 4294967296);
    loMant = Math.floor(mantissa - hiMant * 4294967296);
  }
  view.setUint16(offset, sign | exponent, false);
  view.setUint32(offset + 2, hiMant >>> 0, false);
  view.setUint32(offset + 6, loMant >>> 0, false);
}

function writeStr(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function readStr(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}
