// ─────────────────────────────────────────────────────────────
// dng.ts — minimal linear-DNG writer (File ▸ Export ▸ DNG). DNG is a TIFF/EP
// container; the smallest interoperable slice is a *linear* (already-demosaiced)
// DNG: the display composite is linearized out of its working RGB profile,
// stored as 16-bit RGB in a single strip, and tagged PhotometricInterpretation
// = LinearRaw (34892) with
// the DNG-required tags (DNGVersion, UniqueCameraModel, ColorMatrix1,
// AsShotNeutral, CalibrationIlluminant1). ColorMatrix1 maps XYZ(D65) into that
// linear working space, so a raw processor reconstructs the original colours.
// Little-endian ("II").
//
// Pure + unit-testable (no engine/DOM); the app.ts exporter feeds it the
// composite ImageData. ponytail: a bounded linear DNG, not a full mosaiced
// camera-raw — the niche audience wants the pixels, not a CFA re-simulation.
// ─────────────────────────────────────────────────────────────

const CAMERA_MODEL = "Monet Vision";
export type DNGInputProfile = "linear-srgb" | "srgb" | "display-p3" | "adobe-rgb" | "rec2020" | "custom";
type BuiltInDNGInputProfile = Exclude<DNGInputProfile, "custom">;
type DocumentDNGInputProfile = Exclude<BuiltInDNGInputProfile, "linear-srgb">;

const DOCUMENT_DNG_PROFILES: readonly DocumentDNGInputProfile[] = [
  "srgb",
  "display-p3",
  "adobe-rgb",
  "rec2020",
];

/** Resolve an engine document profile without allowing an arbitrary ICC
 * payload to masquerade as a built-in profile based on its display name. */
export function resolveDNGInputProfile(profileId: number, hasCustomIccProfile: boolean): DocumentDNGInputProfile {
  if (hasCustomIccProfile) {
    throw new Error("DNG export does not support arbitrary custom ICC profiles; convert the document to a built-in RGB profile first");
  }
  const profile = DOCUMENT_DNG_PROFILES[profileId];
  if (!profile) throw new Error("DNG export requires a supported RGB working profile");
  return profile;
}

// XYZ(D65) → linear working RGB (row-major), matching the engine matrices.
const COLOR_MATRIX_XYZ_TO_SRGB = [
  3.2404542, -1.5371385, -0.4985314,
  -0.9692660, 1.8760108, 0.0415560,
  0.0556434, -0.2040259, 1.0572252,
];
const COLOR_MATRICES: Record<BuiltInDNGInputProfile, readonly number[]> = {
  "linear-srgb": COLOR_MATRIX_XYZ_TO_SRGB,
  srgb: COLOR_MATRIX_XYZ_TO_SRGB,
  "display-p3": [
    2.4934969, -0.9313836, -0.4027108,
    -0.8294889, 1.7626640, 0.0236247,
    0.0358458, -0.0761724, 0.9568845,
  ],
  "adobe-rgb": [
    2.04159, -0.56501, -0.34473,
    -0.96924, 1.87597, 0.04156,
    0.01344, -0.11836, 1.01517,
  ],
  rec2020: [
    1.7166512, -0.3556708, -0.2533663,
    -0.6666844, 1.6164812, 0.0157685,
    0.0176399, -0.0427706, 0.9421031,
  ],
};

// sRGB 8-bit → linear light, then to 16-bit. Table so the per-pixel loop is a
// lookup, not a pow() call.
const SRGB_TO_LINEAR16 = (() => {
  const t = new Uint16Array(256);
  for (let i = 0; i < 256; i++) {
    const c = i / 255;
    const lin = c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    t[i] = Math.round(lin * 65535);
  }
  return t;
})();

export const MAX_DNG_DIMENSION = 32_767;
export const MAX_DNG_PIXELS = 80_000_000;
// Match the Camera Raw sidecar trust boundary so every valid recipe packet can
// also be embedded in a derived DNG without a second, surprising size ceiling.
export const MAX_DNG_XMP_BYTES = 16 * 1024 * 1024;

/** The source fields that are safe to carry onto an already-rendered linear DNG. */
export interface DNGSourceMetadata {
  make?: string;
  model?: string;
  serialNumber?: string;
}

export interface BuildDNG16Options {
  metadata?: DNGSourceMetadata | null;
  /** UTF-8 XMP packet, normally produced by `serializeCameraRawXmp`. */
  xmp?: string | Uint8Array | null;
  /** Working profile used to encode the engine composite. Defaults to already-linear sRGB. */
  inputProfile?: DNGInputProfile;
}

type IfdEntry = [tag: number, type: number, count: number, value: number[]];

function push32(out: number[], v: number): void {
  out.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255);
}

function checkedPixelCount(width: number, height: number): number {
  if (!Number.isInteger(width) || !Number.isInteger(height)
    || width < 1 || height < 1 || width > MAX_DNG_DIMENSION || height > MAX_DNG_DIMENSION) {
    throw new RangeError("DNG dimensions are out of range");
  }
  const pixels = width * height;
  if (!Number.isSafeInteger(pixels) || pixels > MAX_DNG_PIXELS) {
    throw new RangeError("DNG exceeds the pixel limit");
  }
  return pixels;
}

function cleanAscii(value: unknown, maxLength: number): string | undefined {
  if (typeof value !== "string") return undefined;
  let clean = "";
  for (const character of value.slice(0, maxLength * 4)) {
    const code = character.charCodeAt(0);
    if (code >= 0x20 && code <= 0x7e) clean += character;
    else if (character === "\t" || character === "\n" || character === "\r") clean += " ";
    if (clean.length === maxLength) break;
  }
  clean = clean.replace(/\s+/g, " ").trim();
  return clean || undefined;
}

function normalizeXmp(value: BuildDNG16Options["xmp"]): Uint8Array | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  let bytes: Uint8Array;
  let decoded: string;
  if (typeof value === "string") {
    if (value.length > MAX_DNG_XMP_BYTES || value.includes("\0")) throw new RangeError("DNG XMP is invalid or too large");
    bytes = new TextEncoder().encode(value);
    decoded = value;
  } else if (value instanceof Uint8Array) {
    if (!value.length || value.length > MAX_DNG_XMP_BYTES) throw new RangeError("DNG XMP is invalid or too large");
    try {
      decoded = new TextDecoder("utf-8", { fatal: true }).decode(value);
    } catch {
      throw new TypeError("DNG XMP must be valid UTF-8");
    }
    bytes = value.slice();
  } else {
    throw new TypeError("DNG XMP must be a string or Uint8Array");
  }
  if (!bytes.length || bytes.length > MAX_DNG_XMP_BYTES || decoded.includes("\0")) {
    throw new RangeError("DNG XMP is invalid or too large");
  }
  return bytes;
}

function buildLinearDng(
  width: number,
  height: number,
  pixels: number,
  metadata: DNGSourceMetadata | null | undefined,
  xmp: Uint8Array | undefined,
  colorMatrix: readonly number[],
  writeStrip: (view: DataView, offset: number) => void,
): Uint8Array {
  const make = cleanAscii(metadata?.make, 128);
  const model = cleanAscii(metadata?.model, 128);
  const serialNumber = cleanAscii(metadata?.serialNumber, 128);
  const uniqueCameraModel = cleanAscii([make, model].filter(Boolean).join(" "), 255) ?? CAMERA_MODEL;
  const entryCount = 18 + (make ? 1 : 0) + (model ? 1 : 0) + (serialNumber ? 1 : 0) + (xmp ? 1 : 0);
  const ifdEnd = 8 + 2 + entryCount * 12 + 4; // first byte past IFD0

  // Out-of-line value pool (entries whose value doesn't fit the 4-byte field).
  const pool: number[] = [];
  const padEven = () => { if ((ifdEnd + pool.length) % 2) pool.push(0); };
  const le32 = (v: number): number[] => [v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255];
  const short1 = (v: number): number[] => [v & 255, (v >>> 8) & 255, 0, 0];
  const putBytes = (bytes: ArrayLike<number>): number[] => {
    if (bytes.length <= 4) return Array.from({ length: 4 }, (_, i) => bytes[i] ?? 0);
    padEven();
    const off = ifdEnd + pool.length;
    for (let i = 0; i < bytes.length; i++) pool.push(bytes[i] & 255);
    return le32(off);
  };
  const putShorts = (vals: number[]): number => {
    padEven(); const off = ifdEnd + pool.length;
    for (const v of vals) pool.push(v & 255, (v >>> 8) & 255);
    return off;
  };
  const putAscii = (s: string): number[] => putBytes([...Array.from(s, (character) => character.charCodeAt(0)), 0]);
  const putSRationals = (vals: readonly number[], den = 1000000): number => {
    padEven(); const off = ifdEnd + pool.length;
    for (const v of vals) { push32(pool, Math.round(v * den) >>> 0); push32(pool, den); }
    return off;
  };
  const putRationals = (pairs: [number, number][]): number => {
    padEven(); const off = ifdEnd + pool.length;
    for (const [n, d] of pairs) { push32(pool, n >>> 0); push32(pool, d); }
    return off;
  };

  const bitsOff = putShorts([16, 16, 16]);
  const makeValue = make ? putAscii(make) : undefined;
  const modelValue = model ? putAscii(model) : undefined;
  const cameraValue = putAscii(uniqueCameraModel);
  const matrixOff = putSRationals(colorMatrix);
  const neutralOff = putRationals([[1, 1], [1, 1], [1, 1]]);
  const xmpValue = xmp ? putBytes(xmp) : undefined;
  const serialValue = serialNumber ? putAscii(serialNumber) : undefined;
  padEven();
  const imgOff = ifdEnd + pool.length;
  const imgBytes = pixels * 3 * 2;

  // (tag, type, count, value-field[4]) — MUST be in ascending tag order.
  const entries: IfdEntry[] = [
    [254, 4, 1, le32(0)],                       // NewSubfileType = main image
    [256, 4, 1, le32(width)],                   // ImageWidth
    [257, 4, 1, le32(height)],                  // ImageLength
    [258, 3, 3, le32(bitsOff)],                 // BitsPerSample [16,16,16]
    [259, 3, 1, short1(1)],                     // Compression = none
    [262, 3, 1, short1(34892)],                 // PhotometricInterpretation = LinearRaw
  ];
  if (make && makeValue) entries.push([271, 2, make.length + 1, makeValue]); // Make
  if (model && modelValue) entries.push([272, 2, model.length + 1, modelValue]); // Model
  entries.push(
    [273, 4, 1, le32(imgOff)],                  // StripOffsets
    [274, 3, 1, short1(1)],                     // Orientation = top-left (composite is already oriented)
    [277, 3, 1, short1(3)],                     // SamplesPerPixel
    [278, 4, 1, le32(height)],                  // RowsPerStrip (one strip)
    [279, 4, 1, le32(imgBytes)],                // StripByteCounts
    [284, 3, 1, short1(1)],                     // PlanarConfiguration = chunky
  );
  if (xmp && xmpValue) entries.push([700, 1, xmp.length, xmpValue]); // XMP
  entries.push(
    [50706, 1, 4, [1, 4, 0, 0]],               // DNGVersion 1.4.0.0
    [50707, 1, 4, [1, 1, 0, 0]],               // DNGBackwardVersion 1.1.0.0
    [50708, 2, uniqueCameraModel.length + 1, cameraValue], // UniqueCameraModel
    [50721, 10, 9, le32(matrixOff)],            // ColorMatrix1 (XYZ→camera)
    [50728, 5, 3, le32(neutralOff)],            // AsShotNeutral = [1,1,1]
  );
  if (serialNumber && serialValue) entries.push([50735, 2, serialNumber.length + 1, serialValue]); // CameraSerialNumber
  entries.push([50778, 3, 1, short1(21)]);      // CalibrationIlluminant1 = D65

  const out = new Uint8Array(imgOff + imgBytes);
  const dv = new DataView(out.buffer);
  // TIFF header (little-endian).
  out[0] = 0x49; out[1] = 0x49; // "II"
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // IFD0 offset
  // IFD0.
  dv.setUint16(8, entries.length, true);
  let p = 10;
  for (const [tag, type, count, val] of entries) {
    dv.setUint16(p, tag, true);
    dv.setUint16(p + 2, type, true);
    dv.setUint32(p + 4, count, true);
    out[p + 8] = val[0]; out[p + 9] = val[1]; out[p + 10] = val[2]; out[p + 11] = val[3];
    p += 12;
  }
  dv.setUint32(p, 0, true); // next IFD = none
  // Out-of-line pool.
  out.set(pool, ifdEnd);
  writeStrip(dv, imgOff);
  return out;
}

/** Build a minimal linear DNG (little-endian) from a display-sRGB composite. */
export function buildDNG(image: ImageData): Uint8Array {
  if (!image || !image.data) throw new TypeError("DNG image data is required");
  const pixels = checkedPixelCount(image.width, image.height);
  const src = image.data;
  if (src.length !== pixels * 4) throw new RangeError("DNG RGBA8 buffer size does not match its dimensions");
  return buildLinearDng(image.width, image.height, pixels, undefined, undefined, COLOR_MATRICES.srgb, (view, offset) => {
    let dest = offset;
    for (let i = 0; i < pixels; i++) {
      view.setUint16(dest, SRGB_TO_LINEAR16[src[i * 4]], true);
      view.setUint16(dest + 2, SRGB_TO_LINEAR16[src[i * 4 + 1]], true);
      view.setUint16(dest + 4, SRGB_TO_LINEAR16[src[i * 4 + 2]], true);
      dest += 6;
    }
  });
}

/** Build a source-aware linear DNG from RGBA16 samples in a known working RGB
 * profile. Alpha is intentionally omitted from the three-channel DNG. */
export function buildDNG16(
  rgba16: Uint16Array,
  width: number,
  height: number,
  options: BuildDNG16Options = {},
): Uint8Array {
  const pixels = checkedPixelCount(width, height);
  if (!(rgba16 instanceof Uint16Array)) throw new TypeError("DNG RGBA16 data must be a Uint16Array");
  if (rgba16.length !== pixels * 4) throw new RangeError("DNG RGBA16 buffer size does not match its dimensions");
  const xmp = normalizeXmp(options?.xmp);
  const inputProfile = options?.inputProfile ?? "linear-srgb";
  if (inputProfile === "custom") {
    throw new Error("DNG export does not support arbitrary custom ICC profiles; convert the document to a built-in RGB profile first");
  }
  const linear = inputProfile === "linear-srgb"
    ? (value: number) => value
    : (value: number) => {
      const encoded = value / 65535;
      const decoded = inputProfile === "adobe-rgb" ? encoded ** 2.19921875
        : inputProfile === "rec2020" ? encoded ** 2.4
          : encoded <= 0.04045 ? encoded / 12.92 : ((encoded + 0.055) / 1.055) ** 2.4;
      return Math.round(decoded * 65535);
    };
  return buildLinearDng(width, height, pixels, options?.metadata, xmp, COLOR_MATRICES[inputProfile], (view, offset) => {
    let dest = offset;
    for (let i = 0; i < pixels; i++) {
      view.setUint16(dest, linear(rgba16[i * 4]), true);
      view.setUint16(dest + 2, linear(rgba16[i * 4 + 1]), true);
      view.setUint16(dest + 4, linear(rgba16[i * 4 + 2]), true);
      dest += 6;
    }
  });
}
