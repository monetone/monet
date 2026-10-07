// ─────────────────────────────────────────────────────────────
// engine/io/wav — RIFF/WAVE encoder & decoder
// ─────────────────────────────────────────────────────────────
// Reads & writes uncompressed WAVE: PCM 8/16/24/32-bit integer and 32/64-bit
// IEEE float, any channel count, including WAVE_FORMAT_EXTENSIBLE. Sample data
// is converted to/from the engine's planar Float32 representation.

import { createAudioData } from "../audio/buffer";
import { clampSample } from "../audio/db";
import { channelCount, frameCount, type AudioData } from "../audio/types";
import { compactMetadata, type AudioMetadata } from "./metadata";

export type WavBitDepth = 8 | 16 | 24 | 32;

/** A marker embedded in a WAV file as a cue point: a time in seconds + optional label. */
export interface WavCue {
  time: number;
  name?: string;
}

export interface WavEncodeOptions {
  bitDepth?: WavBitDepth;
  /** Write 32-bit IEEE float (requires bitDepth 32). */
  float?: boolean;
  /** Markers to embed as cue points (a `cue ` chunk, with names in a LIST/adtl). */
  markers?: WavCue[];
  /** RIFF INFO metadata. */
  metadata?: AudioMetadata;
}

const FORMAT_PCM = 1;
const FORMAT_FLOAT = 3;
const FORMAT_EXTENSIBLE = 0xfffe;

/** Encode an AudioData buffer as a WAV file (returns the file bytes). */
export function encodeWav(d: AudioData, opts: WavEncodeOptions = {}): Uint8Array {
  const float = opts.float ?? false;
  const bitDepth = opts.bitDepth ?? (float ? 32 : 16);
  if (float && bitDepth !== 32) throw new Error("encodeWav: float requires bitDepth 32");
  const channels = Math.max(1, channelCount(d));
  const frames = frameCount(d);
  const bytesPerSample = bitDepth / 8;
  const blockAlign = channels * bytesPerSample;
  const dataSize = frames * blockAlign;
  const dataPad = dataSize % 2; // chunks are word-aligned; pad odd data before later chunks

  const cues = (opts.markers ?? []).filter((m) => Number.isFinite(m.time) && m.time >= 0);
  const extra = concatBytes(
    cues.length ? buildCueChunks(cues, d.sampleRate) : new Uint8Array(0),
    buildInfoChunk(opts.metadata),
  );

  const buffer = new ArrayBuffer(44 + dataSize + dataPad + extra.length);
  const view = new DataView(buffer);

  writeStr(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize + dataPad + extra.length, true);
  writeStr(view, 8, "WAVE");
  writeStr(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, float ? FORMAT_FLOAT : FORMAT_PCM, true);
  view.setUint16(22, channels, true);
  view.setUint32(24, d.sampleRate, true);
  view.setUint32(28, d.sampleRate * blockAlign, true);
  view.setUint16(32, blockAlign, true);
  view.setUint16(34, bitDepth, true);
  writeStr(view, 36, "data");
  view.setUint32(40, dataSize, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const s = d.channels[c][i] ?? 0;
      offset = writeSample(view, offset, s, bitDepth, float);
    }
  }
  if (extra.length) new Uint8Array(buffer).set(extra, 44 + dataSize + dataPad);
  return new Uint8Array(buffer);
}

/** Read RIFF INFO metadata from a WAV file; {} if it has none. */
export function decodeWavInfo(bytes: Uint8Array | ArrayBuffer): AudioMetadata {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.byteLength < 12 || readStr(view, 0, 4) !== "RIFF" || readStr(view, 8, 4) !== "WAVE") return {};

  const out: AudioMetadata = {};
  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "LIST" && size >= 4 && readStr(view, body, 4) === "INFO") {
      let q = body + 4;
      const end = body + size;
      while (q + 8 <= end) {
        const tag = readStr(view, q, 4);
        const subSize = view.getUint32(q + 4, true);
        const textStart = q + 8;
        const textEnd = Math.min(textStart + subSize, view.byteLength);
        const value = readInfoText(u8.subarray(textStart, textEnd));
        applyInfoTag(out, tag, value);
        q += 8 + subSize + (subSize % 2);
      }
    }
    p = body + size + (size % 2);
  }
  return compactMetadata(out);
}

/** Build the `cue ` chunk (+ a LIST/adtl with `labl` names) for a set of markers. */
function buildCueChunks(cues: WavCue[], sampleRate: number): Uint8Array {
  const enc = (s: string) => new TextEncoder().encode(s);
  const labels = cues.map((c, i) => ({ id: i + 1, offset: Math.round(c.time * sampleRate), text: c.name ? enc(c.name) : null }));

  // cue chunk: 4 (count) + 24 bytes per cue point.
  const cueBody = 4 + labels.length * 24;
  // LIST/adtl with one labl per named cue: 'adtl' + Σ(8 + (4 + textLen + 1) + pad).
  const named = labels.filter((l) => l.text);
  let listBody = named.length ? 4 : 0; // 'adtl'
  for (const l of named) {
    const lablSize = 4 + l.text!.length + 1; // dwName + null-terminated text
    listBody += 8 + lablSize + (lablSize % 2);
  }

  const total = 8 + cueBody + (named.length ? 8 + listBody : 0);
  const buf = new ArrayBuffer(total);
  const view = new DataView(buf);
  const u8 = new Uint8Array(buf);

  let p = 0;
  writeStr(view, p, "cue ");
  view.setUint32(p + 4, cueBody, true);
  view.setUint32(p + 8, labels.length, true);
  p += 12;
  for (const l of labels) {
    view.setUint32(p, l.id, true); // dwName
    view.setUint32(p + 4, l.offset, true); // dwPosition (sample frame, PCM playlist order)
    writeStr(view, p + 8, "data"); // fccChunk
    view.setUint32(p + 12, 0, true); // dwChunkStart
    view.setUint32(p + 16, 0, true); // dwBlockStart
    view.setUint32(p + 20, l.offset, true); // dwSampleOffset (sample frame in data)
    p += 24;
  }

  if (named.length) {
    writeStr(view, p, "LIST");
    view.setUint32(p + 4, listBody, true);
    writeStr(view, p + 8, "adtl");
    p += 12;
    for (const l of named) {
      const lablSize = 4 + l.text!.length + 1;
      writeStr(view, p, "labl");
      view.setUint32(p + 4, lablSize, true);
      view.setUint32(p + 8, l.id, true); // dwName matches the cue id
      u8.set(l.text!, p + 12);
      // text is null-terminated (the buffer is zero-filled); skip the trailing word-align pad
      p += 8 + lablSize + (lablSize % 2);
    }
  }
  return u8;
}

function writeSample(view: DataView, offset: number, s: number, bitDepth: number, float: boolean): number {
  if (float) {
    view.setFloat32(offset, s, true);
    return offset + 4;
  }
  const x = clampSample(s);
  switch (bitDepth) {
    case 8: {
      view.setUint8(offset, Math.round((x * 0.5 + 0.5) * 255));
      return offset + 1;
    }
    case 16: {
      view.setInt16(offset, Math.round(x < 0 ? x * 0x8000 : x * 0x7fff), true);
      return offset + 2;
    }
    case 24: {
      const v = Math.round(x < 0 ? x * 0x800000 : x * 0x7fffff);
      view.setUint8(offset, v & 0xff);
      view.setUint8(offset + 1, (v >> 8) & 0xff);
      view.setUint8(offset + 2, (v >> 16) & 0xff);
      return offset + 3;
    }
    case 32: {
      view.setInt32(offset, Math.round(x < 0 ? x * 0x80000000 : x * 0x7fffffff), true);
      return offset + 4;
    }
    default:
      throw new Error(`encodeWav: unsupported bit depth ${bitDepth}`);
  }
}

function buildInfoChunk(metadata: AudioMetadata | undefined): Uint8Array {
  const entries = infoEntries(metadata);
  if (entries.length === 0) return new Uint8Array(0);
  const enc = new TextEncoder();
  const encoded = entries.map(([tag, value]) => {
    const bytes = enc.encode(value);
    return { tag, bytes, size: bytes.length + 1 };
  });
  const listSize = 4 + encoded.reduce((sum, entry) => sum + 8 + entry.size + (entry.size % 2), 0);
  const buf = new ArrayBuffer(8 + listSize);
  const view = new DataView(buf);
  const out = new Uint8Array(buf);
  writeStr(view, 0, "LIST");
  view.setUint32(4, listSize, true);
  writeStr(view, 8, "INFO");
  let p = 12;
  for (const entry of encoded) {
    writeStr(view, p, entry.tag);
    view.setUint32(p + 4, entry.size, true);
    out.set(entry.bytes, p + 8);
    p += 8 + entry.size + (entry.size % 2);
  }
  return out;
}

function infoEntries(metadata: AudioMetadata | undefined): [string, string][] {
  const meta = compactMetadata(metadata ?? {});
  return [
    ["INAM", meta.title],
    ["IART", meta.artist],
    ["IPRD", meta.album],
    ["IGNR", meta.genre],
    ["ICMT", meta.comment ?? meta.description],
    ["ICOP", meta.copyright],
    ["ICRD", meta.date],
    ["ISFT", meta.software],
    ["IKEY", meta.keywords],
  ].filter((entry): entry is [string, string] => !!entry[1]);
}

function applyInfoTag(out: AudioMetadata, tag: string, value: string): void {
  if (!value) return;
  if (tag === "INAM") out.title = value;
  else if (tag === "IART") out.artist = value;
  else if (tag === "IPRD") out.album = value;
  else if (tag === "IGNR") out.genre = value;
  else if (tag === "ICMT") out.comment = value;
  else if (tag === "ICOP") out.copyright = value;
  else if (tag === "ICRD") out.date = value;
  else if (tag === "ISFT") out.software = value;
  else if (tag === "IKEY") out.keywords = value;
}

function readInfoText(bytes: Uint8Array): string {
  let end = bytes.length;
  while (end > 0 && bytes[end - 1] === 0) end--;
  return new TextDecoder().decode(bytes.subarray(0, end)).trim();
}

function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

interface FmtChunk {
  format: number;
  channels: number;
  sampleRate: number;
  bitsPerSample: number;
}

/** Decode a WAV file (Uint8Array / ArrayBuffer) into an AudioData buffer. */
export function decodeWav(bytes: Uint8Array | ArrayBuffer): AudioData {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (readStr(view, 0, 4) !== "RIFF" || readStr(view, 8, 4) !== "WAVE") {
    throw new Error("decodeWav: not a RIFF/WAVE file");
  }

  let fmt: FmtChunk | null = null;
  let dataOffset = -1;
  let dataLength = 0;

  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      let format = view.getUint16(body, true);
      const channels = view.getUint16(body + 2, true);
      const sampleRate = view.getUint32(body + 4, true);
      const bitsPerSample = view.getUint16(body + 14, true);
      if (format === FORMAT_EXTENSIBLE && size >= 40) {
        // sub-format GUID's first 2 bytes carry the real format code
        format = view.getUint16(body + 24, true);
      }
      fmt = { format, channels, sampleRate, bitsPerSample };
    } else if (id === "data") {
      dataOffset = body;
      dataLength = size;
    }
    p = body + size + (size % 2); // chunks are word-aligned
  }

  if (!fmt) throw new Error("decodeWav: missing fmt chunk");
  if (dataOffset < 0) throw new Error("decodeWav: missing data chunk");

  const { format, channels, sampleRate, bitsPerSample } = fmt;
  const bytesPerSample = bitsPerSample / 8;
  const blockAlign = channels * bytesPerSample;
  const frames = Math.floor(Math.min(dataLength, view.byteLength - dataOffset) / blockAlign);
  const out = createAudioData(channels, frames, sampleRate);
  const isFloat = format === FORMAT_FLOAT;

  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < channels; c++) {
      const off = dataOffset + i * blockAlign + c * bytesPerSample;
      out.channels[c][i] = readSample(view, off, bitsPerSample, isFloat);
    }
  }
  return out;
}

/** Read embedded cue points (markers) from a WAV file; [] if it has none. */
export function decodeWavCues(bytes: Uint8Array | ArrayBuffer): WavCue[] {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  if (view.byteLength < 12 || readStr(view, 0, 4) !== "RIFF" || readStr(view, 8, 4) !== "WAVE") return [];

  let sampleRate = 0;
  const order: number[] = []; // cue ids in file order
  const offsets = new Map<number, number>(); // cue id → sample offset
  const names = new Map<number, string>(); // cue id → label

  let p = 12;
  while (p + 8 <= view.byteLength) {
    const id = readStr(view, p, 4);
    const size = view.getUint32(p + 4, true);
    const body = p + 8;
    if (id === "fmt ") {
      sampleRate = view.getUint32(body + 4, true);
    } else if (id === "cue ") {
      const count = view.getUint32(body, true);
      let q = body + 4;
      for (let i = 0; i < count && q + 24 <= view.byteLength; i++) {
        order.push(view.getUint32(q, true));
        offsets.set(view.getUint32(q, true), view.getUint32(q + 20, true)); // dwName → dwSampleOffset
        q += 24;
      }
    } else if (id === "LIST" && size >= 4 && readStr(view, body, 4) === "adtl") {
      let q = body + 4;
      const end = body + size;
      while (q + 8 <= end) {
        const subId = readStr(view, q, 4);
        const subSize = view.getUint32(q + 4, true);
        if (subId === "labl" && subSize >= 4) {
          const cueId = view.getUint32(q + 8, true);
          let nul = q + 12;
          const textEnd = q + 8 + subSize;
          while (nul < textEnd && view.getUint8(nul) !== 0) nul++;
          names.set(cueId, new TextDecoder().decode(u8.subarray(q + 12, nul)));
        }
        q += 8 + subSize + (subSize % 2);
      }
    }
    p = body + size + (size % 2);
  }

  if (sampleRate <= 0) sampleRate = 44100;
  return order.map((id) => {
    const cue: WavCue = { time: (offsets.get(id) ?? 0) / sampleRate };
    const name = names.get(id);
    if (name) cue.name = name;
    return cue;
  });
}

function readSample(view: DataView, off: number, bits: number, isFloat: boolean): number {
  if (isFloat) {
    return bits === 64 ? view.getFloat64(off, true) : view.getFloat32(off, true);
  }
  switch (bits) {
    case 8:
      return (view.getUint8(off) - 128) / 128;
    case 16:
      return view.getInt16(off, true) / 0x8000;
    case 24: {
      const b0 = view.getUint8(off);
      const b1 = view.getUint8(off + 1);
      const b2 = view.getUint8(off + 2);
      let v = b0 | (b1 << 8) | (b2 << 16);
      if (v & 0x800000) v |= ~0xffffff; // sign-extend
      return v / 0x800000;
    }
    case 32:
      return view.getInt32(off, true) / 0x80000000;
    default:
      throw new Error(`decodeWav: unsupported bit depth ${bits}`);
  }
}

function writeStr(view: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) view.setUint8(offset + i, s.charCodeAt(i));
}

function readStr(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}
