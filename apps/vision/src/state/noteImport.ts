import {
  MAX_NOTE_AUTHOR,
  MAX_NOTE_TEXT,
  MAX_PERSISTED_NOTES,
  type Note,
} from "./notes";

export type ImportedNote = Omit<Note, "id">;

export const MAX_NOTE_IMPORT_BYTES = 20 * 1024 * 1024;
const MAX_DICTIONARIES = 50_000;
const MAX_DICTIONARY_BYTES = 1024 * 1024;

interface Span {
  start: number;
  end: number;
}

function byteString(bytes: Uint8Array): string {
  let out = "";
  const chunk = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    out += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return out;
}

function isWhitespace(code: number): boolean {
  return code === 0 || code === 9 || code === 10 || code === 12 || code === 13 || code === 32;
}

function skipComment(source: string, offset: number, end = source.length): number {
  let i = offset + 1;
  while (i < end && source.charCodeAt(i) !== 10 && source.charCodeAt(i) !== 13) i++;
  return i;
}

function skipLiteral(source: string, offset: number, end = source.length): number {
  let depth = 1;
  for (let i = offset + 1; i < end; i++) {
    const c = source.charCodeAt(i);
    if (c === 92) {
      i++;
      if (source.charCodeAt(i) === 13 && source.charCodeAt(i + 1) === 10) i++;
    } else if (c === 40) {
      depth++;
    } else if (c === 41 && --depth === 0) {
      return i + 1;
    }
  }
  return end;
}

function skipHex(source: string, offset: number, end = source.length): number {
  const close = source.indexOf(">", offset + 1);
  return close < 0 || close >= end ? end : close + 1;
}

function dictionarySpans(source: string): Span[] {
  const stack: number[] = [];
  const spans: Span[] = [];
  for (let i = 0; i < source.length;) {
    const c = source.charCodeAt(i);
    if (stack.length === 0 && source.startsWith("stream", i)
      && (i === 0 || isDelimiter(source.charCodeAt(i - 1)))
      && isDelimiter(source.charCodeAt(i + 6))) {
      const close = source.indexOf("endstream", i + 6);
      i = close < 0 ? source.length : close + 9;
    } else if (c === 37) {
      i = skipComment(source, i);
    } else if (c === 40) {
      i = skipLiteral(source, i);
    } else if (c === 60 && source.charCodeAt(i + 1) === 60) {
      stack.push(i);
      i += 2;
    } else if (c === 60) {
      i = skipHex(source, i);
    } else if (c === 62 && source.charCodeAt(i + 1) === 62) {
      const start = stack.pop();
      if (start != null && spans.length < MAX_DICTIONARIES) spans.push({ start, end: i + 2 });
      i += 2;
    } else {
      i++;
    }
  }
  return spans;
}

function isDelimiter(code: number): boolean {
  return isWhitespace(code) || code === 37 || code === 40 || code === 41 || code === 47
    || code === 60 || code === 62 || code === 91 || code === 93 || code === 123 || code === 125;
}

function skipWhitespaceAndComments(source: string, offset: number, end: number): number {
  let i = offset;
  while (i < end) {
    if (isWhitespace(source.charCodeAt(i))) i++;
    else if (source.charCodeAt(i) === 37) i = skipComment(source, i, end);
    else break;
  }
  return i;
}

/** Find a direct dictionary key, ignoring strings and nested dictionaries. */
function directValueOffset(source: string, span: Span, key: string): number | null {
  let depth = 1;
  let arrayDepth = 0;
  for (let i = span.start + 2; i < span.end - 2;) {
    const c = source.charCodeAt(i);
    if (c === 37) {
      i = skipComment(source, i, span.end);
    } else if (c === 40) {
      i = skipLiteral(source, i, span.end);
    } else if (c === 60 && source.charCodeAt(i + 1) === 60) {
      depth++;
      i += 2;
    } else if (c === 60) {
      i = skipHex(source, i, span.end);
    } else if (c === 62 && source.charCodeAt(i + 1) === 62) {
      depth--;
      i += 2;
    } else if (c === 91) {
      arrayDepth++;
      i++;
    } else if (c === 93) {
      arrayDepth = Math.max(0, arrayDepth - 1);
      i++;
    } else if (c === 47) {
      const start = ++i;
      while (i < span.end && !isDelimiter(source.charCodeAt(i))) i++;
      if (depth === 1 && arrayDepth === 0 && source.slice(start, i) === key) {
        return skipWhitespaceAndComments(source, i, span.end);
      }
    } else {
      i++;
    }
  }
  return null;
}

function nameAt(source: string, offset: number, end: number): string | null {
  if (source.charCodeAt(offset) !== 47) return null;
  let i = offset + 1;
  while (i < end && !isDelimiter(source.charCodeAt(i))) i++;
  return source.slice(offset + 1, i);
}

function numberAt(source: string, offset: number, end: number): { value: number; end: number } | null {
  const match = source.slice(offset, Math.min(end, offset + 64))
    .match(/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i);
  if (!match) return null;
  const value = Number(match[0]);
  return Number.isFinite(value) ? { value, end: offset + match[0].length } : null;
}

function numberArrayAt(source: string, offset: number, end: number): number[] | null {
  if (source.charCodeAt(offset) !== 91) return null;
  const values: number[] = [];
  let i = offset + 1;
  while (i < end) {
    i = skipWhitespaceAndComments(source, i, end);
    if (source.charCodeAt(i) === 93) return values;
    const parsed = numberAt(source, i, end);
    if (!parsed || values.length >= 16) return null;
    values.push(parsed.value);
    i = parsed.end;
  }
  return null;
}

function literalBytesAt(source: string, offset: number, end: number, maxBytes: number): Uint8Array | null {
  if (source.charCodeAt(offset) !== 40) return null;
  const bytes: number[] = [];
  let depth = 1;
  for (let i = offset + 1; i < end; i++) {
    let c = source.charCodeAt(i);
    if (c === 92) {
      if (++i >= end) return null;
      c = source.charCodeAt(i);
      if (c === 10) continue;
      if (c === 13) {
        if (source.charCodeAt(i + 1) === 10) i++;
        continue;
      }
      const escaped = c === 110 ? 10 : c === 114 ? 13 : c === 116 ? 9
        : c === 98 ? 8 : c === 102 ? 12 : null;
      if (escaped != null) c = escaped;
      else if (c >= 48 && c <= 55) {
        let octal = c - 48;
        for (let n = 1; n < 3; n++) {
          const next = source.charCodeAt(i + 1);
          if (next < 48 || next > 55) break;
          octal = octal * 8 + next - 48;
          i++;
        }
        c = octal & 255;
      }
    } else if (c === 40) {
      depth++;
    } else if (c === 41) {
      if (--depth === 0) return Uint8Array.from(bytes);
    } else if (c === 13) {
      if (source.charCodeAt(i + 1) === 10) i++;
      c = 10;
    }
    if (bytes.length < maxBytes) bytes.push(c & 255);
  }
  return null;
}

function hexBytesAt(source: string, offset: number, end: number, maxBytes: number): Uint8Array | null {
  if (source.charCodeAt(offset) !== 60 || source.charCodeAt(offset + 1) === 60) return null;
  const digits: number[] = [];
  for (let i = offset + 1; i < end; i++) {
    const c = source.charCodeAt(i);
    if (c === 62) {
      if (digits.length % 2) digits.push(0);
      const bytes = new Uint8Array(Math.min(digits.length / 2, maxBytes));
      for (let j = 0; j < bytes.length; j++) bytes[j] = digits[j * 2] * 16 + digits[j * 2 + 1];
      return bytes;
    }
    if (isWhitespace(c)) continue;
    const digit = c >= 48 && c <= 57 ? c - 48 : c >= 65 && c <= 70 ? c - 55 : c >= 97 && c <= 102 ? c - 87 : -1;
    if (digit < 0) return null;
    if (digits.length < maxBytes * 2) digits.push(digit);
  }
  return null;
}

function decodeUtf16(bytes: Uint8Array, littleEndian: boolean): string {
  let out = "";
  for (let i = 2; i + 1 < bytes.length; i += 2) {
    const code = littleEndian ? bytes[i] | bytes[i + 1] << 8 : bytes[i] << 8 | bytes[i + 1];
    out += String.fromCharCode(code);
  }
  return out;
}

function decodePdfText(bytes: Uint8Array): string {
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) return decodeUtf16(bytes, false);
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) return decodeUtf16(bytes, true);
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}

function directText(source: string, span: Span, key: string, maxChars: number): string {
  const offset = directValueOffset(source, span, key);
  if (offset == null) return "";
  const bytes = literalBytesAt(source, offset, span.end, maxChars * 4)
    ?? hexBytesAt(source, offset, span.end, maxChars * 4);
  return bytes ? decodePdfText(bytes).slice(0, maxChars) : "";
}

function directNumbers(source: string, span: Span, key: string): number[] | null {
  const offset = directValueOffset(source, span, key);
  return offset == null ? null : numberArrayAt(source, offset, span.end);
}

/**
 * Import inline Text annotations from FDF files and ordinary, uncompressed PDF
 * objects. PDF coordinates are bottom-left based; Vision notes are top-left
 * based, so the first MediaBox is used to scale into the active document.
 * Compressed PDF object streams deliberately return no annotations rather than
 * attempting a partial decompressor in the UI bundle.
 */
export function parseImportedNotes(bytes: Uint8Array, documentWidth: number, documentHeight: number): ImportedNote[] {
  if (!(bytes instanceof Uint8Array) || bytes.length === 0 || bytes.length > MAX_NOTE_IMPORT_BYTES) return [];
  if (!Number.isFinite(documentWidth) || !Number.isFinite(documentHeight) || documentWidth <= 0 || documentHeight <= 0) return [];

  const source = byteString(bytes);
  if (!/%(?:PDF|FDF)-\d(?:\.\d)?/.test(source.slice(0, 1024))) return [];

  const spans = dictionarySpans(source).filter((span) => span.end - span.start <= MAX_DICTIONARY_BYTES);
  const BUDGET = Math.max(4 * source.length, MAX_DICTIONARY_BYTES);

  // (#156) The page box has to come from the FIRST page in DOCUMENT order, as
  // documented. The annotation walk below visits dictionaries smallest-first (so
  // the byte budget covers as many as possible), and taking the MediaBox from
  // that order picked whichever page dictionary happened to be the most compact —
  // an A4 second page could scale notes lifted off a US Letter first page.
  let mediaBox: number[] | null = null;
  let budget = BUDGET;
  for (const span of [...spans].sort((a, b) => a.start - b.start)) {
    const size = span.end - span.start;
    if (size > budget) break;
    budget -= size;
    const box = directNumbers(source, span, "MediaBox");
    if (box?.length === 4 && box.every(Number.isFinite) && box[2] !== box[0] && box[3] !== box[1]) {
      mediaBox = box;
      break;
    }
  }

  const annotations: Span[] = [];
  budget = BUDGET;
  for (const span of spans.sort((a, b) => (a.end - a.start) - (b.end - b.start))) {
    const size = span.end - span.start;
    if (size > budget) break;
    budget -= size;
    const subtype = directValueOffset(source, span, "Subtype");
    if (subtype != null && nameAt(source, subtype, span.end) === "Text") annotations.push(span);
  }

  const box = mediaBox ?? [0, 0, documentWidth, documentHeight];
  const minX = Math.min(box[0], box[2]);
  const maxX = Math.max(box[0], box[2]);
  const minY = Math.min(box[1], box[3]);
  const maxY = Math.max(box[1], box[3]);
  const sourceWidth = maxX - minX;
  const sourceHeight = maxY - minY;
  if (!(sourceWidth > 0) || !(sourceHeight > 0)) return [];

  const out: ImportedNote[] = [];
  for (const span of annotations.sort((a, b) => a.start - b.start)) {
    const rect = directNumbers(source, span, "Rect");
    if (!rect || rect.length !== 4 || !rect.every(Number.isFinite)) continue;
    const left = Math.min(rect[0], rect[2]);
    const top = Math.max(rect[1], rect[3]);
    const x = (left - minX) / sourceWidth * documentWidth;
    const y = (maxY - top) / sourceHeight * documentHeight;
    if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
    out.push({
      x,
      y,
      text: directText(source, span, "Contents", MAX_NOTE_TEXT),
      author: directText(source, span, "T", MAX_NOTE_AUTHOR),
    });
    if (out.length >= MAX_PERSISTED_NOTES) break;
  }
  return out;
}
