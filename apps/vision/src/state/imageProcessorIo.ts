// ─────────────────────────────────────────────────────────────
// imageProcessorIo.ts — pure helpers for File ▸ Scripts ▸ Image Processor:
// the option shapes, the fit-within scale, and the copyright embedding
// (JPEG COM marker / PNG iTXt chunk). IO stays in app.ts; everything here
// is synchronous so it unit-tests without the engine. Mirrors batchIo.ts.
// ─────────────────────────────────────────────────────────────

export type ImageProcessorFormat = "jpeg" | "png" | "psd" | "tiff";

/** One simultaneous output pass (Photoshop's "Save as JPEG/PSD/TIFF" rows). */
export interface ImageProcessorSave { format: ImageProcessorFormat; quality?: number }

export interface ImageProcessorOptions {
  saves: ImageProcessorSave[]; // one output per entry, all from the same open
  actionId?: number;           // saved action to run on each file; undefined = none
  destDir?: string;            // Tauri destination folder; undefined = downloads
  copyright?: string;          // embedded as JPEG COM / PNG iTXt "Copyright"
  maxW?: number;               // fit-within resize; 0/undefined = no resize
  maxH?: number;
  /** Files already chosen (a test, or a caller that picked them). Omit to open the picker. */
  files?: File[];
  onProgress?: (index: number, total: number, name: string) => void;
  signal?: AbortSignal;
}

export const IMAGE_PROCESSOR_EXT: Record<ImageProcessorFormat, string> = { jpeg: "jpg", png: "png", psd: "psd", tiff: "tif" };
/** Per-format folder under the destination. An existing file in that folder is left untouched. */
export const IMAGE_PROCESSOR_DIR: Record<ImageProcessorFormat, string> = { jpeg: "JPEG", png: "PNG", psd: "PSD", tiff: "TIFF" };

/** Where each input would be written for one format. A name already in `existing`
 *  (bare filename or `Folder/filename`) is refused — the file on disk stays as it is. */
export function imageProcessorTargets(
  names: readonly string[],
  format: ImageProcessorFormat,
  existing: ReadonlySet<string>,
): { write: string[]; refused: string[] } {
  const folder = IMAGE_PROCESSOR_DIR[format];
  const ext = IMAGE_PROCESSOR_EXT[format];
  const write: string[] = [];
  const refused: string[] = [];
  const taken = new Set(existing);
  for (const name of names) {
    const base = name.replace(/\.[^.]+$/, "");
    const file = `${base}.${ext}`;
    const rel = `${folder}/${file}`;
    if (taken.has(file) || taken.has(rel)) {
      refused.push(rel);
      continue;
    }
    taken.add(file);
    taken.add(rel);
    write.push(rel);
  }
  return { write, refused };
}
export const IMAGE_PROCESSOR_MIME: Record<ImageProcessorFormat, string> = {
  jpeg: "image/jpeg", png: "image/png", psd: "image/vnd.adobe.photoshop", tiff: "image/tiff",
};

/** Scale that fits w×h within maxW×maxH without upscaling; 1 = leave alone
 *  (also for a disabled resize, signalled by a non-positive max). */
export function fitWithinScale(w: number, h: number, maxW: number, maxH: number): number {
  if (maxW <= 0 || maxH <= 0 || w <= 0 || h <= 0) return 1;
  return Math.min(maxW / w, maxH / h, 1);
}

/** Insert a JPEG COM (comment) segment right after SOI — readers skip or
 *  surface it. Returns the input unchanged when it is not a JPEG, the text is
 *  empty, or the text overflows the 16-bit segment length. */
export function jpegWithComment(jpeg: Uint8Array, text: string): Uint8Array {
  if (!text || jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) return jpeg;
  const payload = new TextEncoder().encode(text);
  if (payload.length + 2 > 0xffff) return jpeg;
  const seg = new Uint8Array(4 + payload.length);
  seg[0] = 0xff; seg[1] = 0xfe; // COM marker
  seg[2] = (payload.length + 2) >> 8; seg[3] = (payload.length + 2) & 0xff;
  seg.set(payload, 4);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

const PNG_SIG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();

/** CRC-32 (PNG/zlib polynomial) — needed to author a chunk. */
export function crc32(bytes: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** Insert an iTXt chunk (keyword "Copyright", UTF-8, uncompressed) right after
 *  IHDR. Returns the input unchanged when it is not a PNG or the text is
 *  empty. iTXt over tEXt because copyright strings are not always Latin-1. */
export function pngWithCopyright(png: Uint8Array, text: string): Uint8Array {
  if (!text || png.length < 33 || !PNG_SIG.every((b, i) => png[i] === b)) return png;
  const ihdrLen = ((png[8] << 24) | (png[9] << 16) | (png[10] << 8) | png[11]) >>> 0;
  const at = 8 + 12 + ihdrLen; // after IHDR's length+type+data+crc
  if (at > png.length) return png;
  // keyword, null sep, compression flag 0, method 0, empty lang + translated keyword
  const body = new TextEncoder().encode(`Copyright\0\0\0\0\0${text}`);
  const chunk = new Uint8Array(12 + body.length);
  const dv = new DataView(chunk.buffer);
  dv.setUint32(0, body.length);
  chunk.set([0x69, 0x54, 0x58, 0x74], 4); // "iTXt"
  chunk.set(body, 8);
  dv.setUint32(8 + body.length, crc32(chunk.subarray(4, 8 + body.length)));
  const out = new Uint8Array(png.length + chunk.length);
  out.set(png.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(png.subarray(at), at + chunk.length);
  return out;
}
