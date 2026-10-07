// Photoshop Raw (#466): headerless samples whose layout the user describes in
// the Photoshop Raw Options dialog. Pure, so the dialog's Guess and the bytes
// hint stay testable without the WASM engine.

/** What Photoshop's Photoshop Raw Options dialog asks when opening a file. */
export interface PhotoshopRawLayout {
  width: number;
  height: number;
  channels: number;
  interleaved: boolean;
  depth: 8 | 16;
  /** Mac byte order; IBM PC (little-endian) when false. Only 16-bit reads it. */
  bigEndian: boolean;
  header: number;
}

/** What Save As ▸ Photoshop Raw asks. */
export interface PhotoshopRawSaveOptions {
  interleaved: boolean;
  bigEndian: boolean;
  header: number;
}

export const DEFAULT_PHOTOSHOP_RAW_SAVE: PhotoshopRawSaveOptions = { interleaved: true, bigEndian: true, header: 0 };

/** The largest header Save As writes: codecs.rs PHOTOSHOP_RAW_MAX_HEADER,
 *  which refuses more rather than allocate it. */
export const PHOTOSHOP_RAW_MAX_HEADER = 1 << 24;

/** `.rawps` is always Photoshop Raw; `.raw` is also a camera-raw suffix, so it
 *  only reaches Photoshop Raw when the camera decoder refuses the file. */
export const PHOTOSHOP_RAW_RE = /\.(raw|rawps)$/i;

/** Bytes the layout reads from the file, header included. */
export function photoshopRawBytesNeeded(l: PhotoshopRawLayout): number {
  return l.header + l.width * l.height * l.channels * (l.depth / 8);
}

/** The most nearly square width × height (width ≥ height) of `pixels`. */
function squarest(pixels: number): [number, number] {
  let h = Math.floor(Math.sqrt(pixels));
  while (pixels % h) h--;
  return [pixels / h, h];
}

/** Photoshop's Guess: with Width and Height set, the header is what the file
 *  holds beyond them; with one set, the other follows from the file size;
 *  with neither, the squarest image that fills the file. Channels, depth and
 *  header size are taken as entered. Null when the file size can't fit. */
export function guessPhotoshopRawLayout(fileSize: number, l: PhotoshopRawLayout): PhotoshopRawLayout | null {
  const perPixel = l.channels * (l.depth / 8);
  if (!(perPixel > 0)) return null;
  if (l.width > 0 && l.height > 0) {
    const header = fileSize - l.width * l.height * perPixel;
    return header >= 0 ? { ...l, header } : null;
  }
  const bytes = fileSize - l.header;
  if (bytes <= 0 || bytes % perPixel) return null;
  const pixels = bytes / perPixel;
  if (l.width > 0) return pixels % l.width ? null : { ...l, height: pixels / l.width };
  if (l.height > 0) return pixels % l.height ? null : { ...l, width: pixels / l.height };
  const [width, height] = squarest(pixels);
  return { ...l, width, height };
}

/** The dialog's starting values: the squarest 8-bit RGB fit of the file,
 *  else 8-bit grey (every byte count fits one channel). */
export function initialPhotoshopRawLayout(fileSize: number): PhotoshopRawLayout {
  const base: PhotoshopRawLayout = { width: 0, height: 0, channels: 3, interleaved: true, depth: 8, bigEndian: true, header: 0 };
  return guessPhotoshopRawLayout(fileSize, base)
    ?? guessPhotoshopRawLayout(fileSize, { ...base, channels: 1 })
    ?? { ...base, width: 1, height: 1, channels: 1 };
}
