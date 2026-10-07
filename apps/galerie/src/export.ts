// export — Output module (Phase 5): develop each selected photo through the
// shared engine at its recipe, resize, encode, and write to disk — either a
// flat folder (Export) or a static HTML gallery (Web). Non-destructive: reads
// the source + catalog recipe and never mutates the original. JPEG/PNG use the
// web route; 8-bit TIFF/PSD encode app-side from the same developed pixels;
// RGB16 TIFF/linear DNG + embedded ICC develop through the native product route
// and take their post-develop finish (crop, sizing, sharpening, watermark, XMP)
// app-side; "Original" copies the source byte-for-byte.

import { CONTAINER_APPS } from "@monet-ui/monet-format";
import { createDefaultRecipe, type CropPanel, type DevelopRecipeV2 } from "@monet-ui/monet-photo";
import { open } from "@tauri-apps/plugin-dialog";
import { exists, mkdir, readFile, remove, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { invoke } from "@tauri-apps/api/core";

import { getDevelopExportIdentity, getRecipe, listKeywords, listPhotoKeywords } from "./catalog/catalog";
import type { PhotoRow } from "./catalog/types";
import { type DecodedImage, type ExportColorSpace, openDevelopSession } from "./engine";
import { applyCrop, type CropSpec, isIdentityCrop } from "./lib/cropTransform";
import { embedXmpJpeg, embedXmpPng, xpacket } from "./lib/embedXmp";
import { filterExportMetadata, type MetadataScope } from "./lib/exportMetadata";
import { compositeMasks, hasActiveMasks } from "./lib/maskComposite";
import { exportKeywords, exportVocab } from "./lib/xmpAutoWrite";
import { buildXmpSidecar } from "./lib/xmpSidecar";
import { type Dims, drawWatermark, encodeImage, extForFormat, fitResize, hasWatermarkContent, tagPpiJpeg, tagPpiPng, uniqueName, type ResizeSpec, type WatermarkSpecEx } from "./lib/exportImage";
import { renderFilenameTemplate, stripExt } from "./lib/filenameTemplate";
import { sharpenParams, type SharpenSpec, unsharpMask } from "./lib/outputSharpen";
import {
  DEFAULT_WEB_GALLERY_OPTIONS,
  galleryExportOpts,
  galleryHtml,
  type GalleryItem,
  type WebGalleryOptions,
} from "./lib/webGallery";
import { basename } from "./ui/GridCell";

/** File Settings ▸ Image Format. JPEG/PNG encode via canvas; tiff8/psd encode
 *  app-side from the same developed pixels; tiff16/linearDng16 take the native
 *  Rust route; "original" copies the source byte-for-byte, no develop.
 *  ponytail: no PSB — the 4-byte-length PSD variant only matters past 30000 px,
 *  which encodePsd refuses; add version-2 lengths there when a file that big
 *  exists. Plain (mosaic) DNG needs a native raw-container writer next to
 *  linearDng16 in src-tauri's develop-job plugin. */
export type ExportFormat = "jpeg" | "png" | "tiff8" | "tiff16" | "psd" | "linearDng16" | "original";

export interface ExportOptions {
  format: ExportFormat;
  /** JPEG quality 0–1 (ignored for PNG). */
  quality: number;
  /** JPEG "Limit File Size To ___ K" — mutually exclusive with Quality: when
   *  set (> 0) the quality slider is ignored and quality is searched for the
   *  largest encode under the cap. */
  limitSizeKB?: number | null;
  /** TIFF compression, 8-bit route only (the native 16-bit writer is
   *  uncompressed). ponytail: None/ZIP only — LZW needs a hand-rolled coder,
   *  add one if a ZIP-less TIFF reader turns up. */
  tiffCompression?: "none" | "zip";
  /** Fit within this long edge (px); null = full resolution. The bare-number
   *  legacy sizing (web gallery, edit-in) — `resize`, when set, wins. */
  longEdge: number | null;
  /** Image Sizing ▸ Resize to Fit (all LR modes, free entry, Don't Enlarge).
   *  Omitted/null = fall back to `longEdge`. */
  resize?: ResizeSpec | null;
  /** Resolution tag written into the file (JFIF density / PNG pHYs) and the
   *  in/cm ruler for `resize`. Omitted/null = untagged, in/cm at 240. */
  ppi?: number | null;
  /** Output color space. JPEG/PNG convert app-side and embed the ICC (sRGB
   *  stays untagged, the universal default); TIFF16 converts natively and
   *  carries sRGB / Display P3 only. */
  profile?: ExportColorSpace;
  /** Output Sharpening for the destination medium; null = off. Rendered
   *  formats only (JPEG/PNG/16-bit TIFF) — LR disables it for DNG. */
  sharpen?: SharpenSpec | null;
  /** Watermark — text or graphic (lib/exportImage); null = off. Rendered
   *  formats only (JPEG/PNG/16-bit TIFF) — LR disables it for DNG. */
  watermark?: WatermarkSpecEx | null;
  /** Filename template + sequence start; null = original stem (+ copy-name). */
  naming?: { template: string; customText: string; startNumber: number } | null;
  /** Which catalog metadata the exported file carries, as XMP (JPEG/PNG and the
   *  native 16-bit TIFF / linear DNG). Omitted = LR's default, everything. */
  metadata?: MetadataScope | null;
  /** LR's Metadata ▸ "Write Keywords as Lightroom Hierarchy". On (LR's default)
   *  writes the root→leaf lr:hierarchicalSubject paths next to dc:subject; off
   *  writes dc:subject only, for readers that choke on the LR extension.
   *  Omitted = on. */
  writeKeywordHierarchy?: boolean;
  /** LR's Export ▸ Content Credentials (Beta): attach the C2PA provenance the
   *  catalog assembles (producer + develop history + AI disclosure) to each
   *  exported file. Signed and embedded into the file itself when a signer is
   *  configured (Preferences ▸ Content Credentials, `c2pa_sign.rs`); otherwise
   *  written unsigned beside it as `<output name>.c2pa.json`. Omitted = off,
   *  as in LR. */
  contentCredentials?: boolean;
}

const DEFAULT_METADATA_SCOPE: MetadataScope = { include: "all", removeLocation: false };

/** Extension for the widened format set — extForFormat covers the legacy four;
 *  "original" keeps the source file's own extension (case included). */
function extForExport(format: ExportFormat, sourcePath: string): string {
  if (format === "tiff8") return "tiff";
  if (format === "psd") return "psd";
  if (format === "original") return basename(sourcePath).match(/\.([^.]+)$/)?.[1] ?? "";
  return extForFormat(format);
}

/** The output filename for photo `index` in the batch, honoring `opts.naming`.
 *  Exported for tests. Collision-free naming is applied by the caller via
 *  uniqueName so distinct sources never silently overwrite. */
export function outputFilename(p: PhotoRow, index: number, opts: ExportOptions): string {
  const ext = extForExport(opts.format, p.path);
  if (!opts.naming) {
    // Same stem + virtual-copy suffix exportFilename derives, over the wide
    // format set (an extension-less original stays extension-less).
    const stem = stripExt(basename(p.path)) + (p.copyName ? `-${p.copyName.replace(/\s+/g, "")}` : "");
    return ext ? `${stem}.${ext}` : stem;
  }
  return renderFilenameTemplate(
    opts.naming.template,
    {
      name: stripExt(basename(p.path)),
      copyName: p.copyName,
      sequence: opts.naming.startNumber + index,
      customText: opts.naming.customText,
    },
    ext,
  );
}

export interface ExportResult {
  written: number;
  committed: number;
  failed: number;
  /** True when the background job's Cancel stopped the run early. */
  cancelled?: boolean;
  /** Files left alone because they already existed (Existing Files = Skip).
   *  Present only when something was actually skipped. */
  skipped?: number;
  durabilityWarnings: string[];
  failureMessages: string[];
}

/** LR's Export Location → Existing Files. `ask` is LR's default: each collision
 *  goes to `onExisting`; with no resolver wired it degrades to `rename`, never
 *  to a silent overwrite. */
export type ExistingFiles = "ask" | "rename" | "overwrite" | "skip";

/** LR's Export Location panel. `runExport` also takes a bare directory string,
 *  which means "this dir, Existing Files = ask".
 *  ponytail: Export To is Hard Drive only — Email/CD-DVD are a different
 *  transport (compose a mail draft / burn session) around this same batch. */
export interface ExportLocation {
  dir: string;
  /** "Put in Subfolder" — a single folder name, created under `dir`. */
  subfolder?: string | null;
  /** Default "ask". */
  existingFiles?: ExistingFiles;
  /** Prompt for `ask`, per colliding path. Anything but skip/overwrite renames. */
  onExisting?: (path: string) => ExistingFiles | Promise<ExistingFiles>;
  /** "Add to This Catalog" — re-import each written file after the batch. */
  addToCatalog?: boolean;
  /** "Add to Stack" — stack each re-imported file with the photo it came from. */
  addToStack?: boolean;
}

interface NativeTiffOutput {
  width: number; height: number; bitsPerSample: number; samplesPerPixel: number; orientation: number;
  profile: "srgb" | "displayP3"; intent: "relativeColorimetric"; blackPointCompensation: false;
  iccDigest: string; outputDigest: string; bytes: number;
}
interface NativeDngOutput {
  width: number; height: number; bitsPerSample: 16; samplesPerPixel: 3; orientation: 1;
  photometric: 34892; outputDigest: string; expectedPixelDigest: string; bytes: number;
}
interface NativeDevelopResultBase {
  jobId: string;
  sourceDigest: string;
  recipeDigest: string;
  output: NativeTiffOutput | NativeDngOutput;
  provenance: unknown;
  timings: { stage: string; milliseconds: number }[];
}

type NativeDevelopResult = NativeDevelopResultBase & (
  | { state: "completed"; durabilityError: null }
  | { state: "committed"; durabilityError: string }
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateNativeDevelopResult(value: unknown): NativeDevelopResult {
  if (!isRecord(value) || !isRecord(value.output) || !Array.isArray(value.timings)) {
    throw new Error("native TIFF export returned a malformed result");
  }
  const output = value.output;
  const commonStrings = [value.jobId, value.sourceDigest, value.recipeDigest, output.outputDigest];
  const commonNumbers = [output.width, output.height, output.bitsPerSample, output.samplesPerPixel, output.orientation, output.bytes];
  const commonValid = commonStrings.every((field) => typeof field === "string" && field.length > 0)
    && [value.sourceDigest, value.recipeDigest, output.outputDigest].every((digest) => typeof digest === "string" && /^[0-9a-f]{64}$/i.test(digest))
    && commonNumbers.every((field) => typeof field === "number" && Number.isSafeInteger(field) && field > 0)
    && output.bitsPerSample === 16 && output.samplesPerPixel === 3 && output.orientation === 1;
  if ("photometric" in output && output.photometric === 34892) {
    if (!commonValid || typeof output.expectedPixelDigest !== "string" || !/^[0-9a-f]{64}$/i.test(output.expectedPixelDigest)) {
      throw new Error("native Linear DNG export returned a malformed result");
    }
  } else {
  const strings = [value.jobId, value.sourceDigest, value.recipeDigest, output.iccDigest, output.outputDigest];
  const numbers = [output.width, output.height, output.bitsPerSample, output.samplesPerPixel, output.orientation, output.bytes];
  const validTimings = value.timings.every((timing) => isRecord(timing)
    && typeof timing.stage === "string"
    && typeof timing.milliseconds === "number"
    && Number.isFinite(timing.milliseconds)
    && timing.milliseconds >= 0);
  if (
    strings.some((field) => typeof field !== "string" || field.length === 0)
    || [value.sourceDigest, value.recipeDigest, output.iccDigest, output.outputDigest]
      .some((digest) => typeof digest !== "string" || !/^[0-9a-f]{64}$/i.test(digest))
    || numbers.some((field) => typeof field !== "number" || !Number.isSafeInteger(field) || field <= 0)
    || output.bitsPerSample !== 16
    || output.samplesPerPixel !== 3
    || output.orientation !== 1
    || (output.profile !== "srgb" && output.profile !== "displayP3")
    || output.intent !== "relativeColorimetric"
    || output.blackPointCompensation !== false
    || !validTimings
  ) {
    throw new Error("native TIFF export returned a malformed result");
  }
  }
  if (value.state === "completed" && value.durabilityError === null) return value as unknown as NativeDevelopResult;
  if (value.state === "committed" && typeof value.durabilityError === "string" && value.durabilityError.trim()) {
    return value as unknown as NativeDevelopResult;
  }
  throw new Error("native TIFF export returned an invalid terminal result");
}

function joinPath(dir: string, name: string): string {
  const sep = dir.includes("\\") && !dir.includes("/") ? "\\" : "/";
  return `${dir}${dir.endsWith(sep) ? "" : sep}${name}`;
}

/** Develop one photo at its catalog recipe → full-resolution RGBA (the rgba is a
 *  copy, valid after the session frees). Shared by Export, Web, and Print. */
export async function developToImage(p: PhotoRow): Promise<DecodedImage> {
  const readPath = p.readPath ?? p.path;
  const bytes = await readFile(readPath);
  const raw = p.format.startsWith("raw:");
  const json = await getRecipe(p.id);
  const recipe = json ? JSON.parse(json) as DevelopRecipeV2 : createDefaultRecipe();
  // maxEdge 0 → develop at full resolution (export, not an interactive preview).
  const session = await openDevelopSession(bytes, raw, readPath, recipe, 0);
  try {
    const img = session.render(recipe);
    // Local (masked) adjustments fold in before crop, in full-image space —
    // the same composite the Develop preview shows.
    const out = compositeMasks((r) => session.render(r), recipe, img);
    const cropped = applyCrop({ rgba: out, width: img.width, height: img.height }, recipe.crop);
    // DecodedImage.rgba is a Uint8Array; a view over the clamped buffer avoids a copy.
    return {
      rgba: new Uint8Array(cropped.rgba.buffer, cropped.rgba.byteOffset, cropped.rgba.byteLength),
      width: cropped.width,
      height: cropped.height,
    };
  } finally {
    session.free();
  }
}

/** Output size per the options — a bare longEdge maps onto the same spec
 *  fitResize serves (never upscales, LR's legacy default), so every format
 *  resizes through one code path. */
function targetDims(opts: ExportOptions, w: number, h: number): Dims {
  const spec = opts.resize
    ?? (opts.longEdge ? { mode: "longEdge", value: opts.longEdge, dontEnlarge: true } satisfies ResizeSpec : null);
  return spec ? fitResize(w, h, spec, opts.ppi || 240) : { width: w, height: h };
}

/** Scale developed RGBA to `target` (the same high-quality canvas resample
 *  encodeImage uses) — for the encoders that take raw pixels, not a canvas. */
function resizeRgba(img: DecodedImage, target: Dims): DecodedImage {
  if (target.width === img.width && target.height === img.height) return img;
  const src = new OffscreenCanvas(img.width, img.height);
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("no 2d context");
  sctx.putImageData(new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height), 0, 0);
  const dst = new OffscreenCanvas(target.width, target.height);
  const dctx = dst.getContext("2d");
  if (!dctx) throw new Error("no 2d context");
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src, 0, 0, target.width, target.height);
  const out = dctx.getImageData(0, 0, target.width, target.height);
  return { rgba: new Uint8Array(out.data.buffer, out.data.byteOffset, out.data.byteLength), width: target.width, height: target.height };
}

/** Encode RGBA as a single-strip 8-bit RGB baseline TIFF (little-endian),
 *  Compression = None or ZIP/Deflate (tag 8 — CompressionStream emits exactly
 *  the zlib stream Adobe Deflate expects). `ppi` writes X/YResolution; null
 *  leaves the file untagged, matching the JPEG/PNG routes. Exported for tests. */
export async function encodeTiff8(rgba: Uint8Array, width: number, height: number, compression: "none" | "zip" = "none", ppi?: number | null): Promise<Uint8Array> {
  const rgb = new Uint8Array(width * height * 3);
  for (let i = 0, j = 0; j < rgb.length; i += 4, j += 3) {
    rgb[j] = rgba[i]; rgb[j + 1] = rgba[i + 1]; rgb[j + 2] = rgba[i + 2];
  }
  const strip = compression === "zip"
    ? new Uint8Array(await new Response(new Blob([rgb as BlobPart]).stream().pipeThrough(new CompressionStream("deflate"))).arrayBuffer())
    : rgb;
  return writeTiff([
    { tag: 256, type: 4, count: 1, value: width },                         // ImageWidth
    { tag: 257, type: 4, count: 1, value: height },                        // ImageLength
    { tag: 258, type: 3, count: 3, data: shorts([8, 8, 8]) },              // BitsPerSample
    { tag: 259, type: 3, count: 1, value: compression === "zip" ? 8 : 1 }, // Compression
    { tag: 262, type: 3, count: 1, value: 2 },                             // Photometric: RGB
    { tag: 277, type: 3, count: 1, value: 3 },                             // SamplesPerPixel
    { tag: 278, type: 4, count: 1, value: height },                        // RowsPerStrip: one strip
    ...resolutionEntries(ppi),
  ], strip);
}

/** One IFD entry: a scalar `value` (inline) or a `data` block the writer places
 *  past the IFD and points at (inline itself when it fits in the 4 value bytes). */
interface TiffEntry { tag: number; type: number; count: number; value?: number; data?: Uint8Array }

const shorts = (v: number[]): Uint8Array => {
  const out = new Uint8Array(v.length * 2);
  const dv = new DataView(out.buffer);
  v.forEach((n, i) => dv.setUint16(i * 2, n, true));
  return out;
};

/** X/YResolution + ResolutionUnit for a tagged export; nothing when ppi is off
 *  (untagged, matching the JPEG/PNG routes). */
function resolutionEntries(ppi?: number | null): TiffEntry[] {
  const res = ppi && ppi > 0 ? Math.round(ppi) : null;
  if (!res) return [];
  const rational = () => {
    const out = new Uint8Array(8);
    const dv = new DataView(out.buffer);
    dv.setUint32(0, res, true); dv.setUint32(4, 1, true);
    return out;
  };
  return [
    { tag: 282, type: 5, count: 1, data: rational() },
    { tag: 283, type: 5, count: 1, data: rational() },
    { tag: 296, type: 3, count: 1, value: 2 }, // inch
  ];
}

/** Assemble a little-endian, single-strip TIFF: header, one IFD sorted ascending
 *  by tag (the spec requires it), the out-of-line values, then the strip.
 *  StripOffsets/StripByteCounts are the writer's own — only it knows the layout.
 *  Shared by the 8-bit and 16-bit encoders. */
function writeTiff(entries: TiffEntry[], strip: Uint8Array): Uint8Array {
  const all = entries.map((e) => ({ ...e }));
  all.push({ tag: 273, type: 4, count: 1, value: 0 }, { tag: 279, type: 4, count: 1, value: strip.length });
  all.sort((a, b) => a.tag - b.tag);
  let at = 8 + 2 + all.length * 12 + 4;
  for (const e of all) {
    if (e.data && e.data.length > 4) { at += at % 2; e.value = at; at += e.data.length; }
  }
  at += at % 2;
  const head = new Uint8Array(at);
  const dv = new DataView(head.buffer);
  head[0] = 0x49; head[1] = 0x49; // "II"
  dv.setUint16(2, 42, true);
  dv.setUint32(4, 8, true); // first IFD
  dv.setUint16(8, all.length, true);
  all.find((e) => e.tag === 273)!.value = at; // the strip follows the values
  all.forEach((e, i) => {
    const p = 10 + i * 12;
    dv.setUint16(p, e.tag, true); dv.setUint16(p + 2, e.type, true); dv.setUint32(p + 4, e.count, true);
    if (e.data && e.data.length > 4) { dv.setUint32(p + 8, e.value!, true); head.set(e.data, e.value!); }
    else if (e.data) head.set(e.data, p + 8);
    else if (e.type === 3) dv.setUint16(p + 8, e.value!, true);
    else dv.setUint32(p + 8, e.value!, true);
  });
  dv.setUint32(10 + all.length * 12, 0, true); // no next IFD
  const out = new Uint8Array(at + strip.length);
  out.set(head);
  out.set(strip, at);
  return out;
}

/** Encode RGBA as a flattened 8-bit RGB PSD (version 1, raw planar composite,
 *  no layers/resources — the round-trip-to-Vision baseline). Exported for tests. */
export function encodePsd(rgba: Uint8Array, width: number, height: number): Uint8Array {
  // PSD v1 caps at 30000 px per side; refuse rather than write a file readers
  // reject. ponytail: PSB (version 2, 4-byte scanline lengths) lifts this.
  if (width > 30000 || height > 30000) throw new Error("PSD supports up to 30000 px per side — export as TIFF instead");
  const plane = width * height;
  const out = new Uint8Array(40 + plane * 3);
  const dv = new DataView(out.buffer);
  out.set([0x38, 0x42, 0x50, 0x53]); // "8BPS"
  dv.setUint16(4, 1);  // version 1 (big-endian throughout)
  dv.setUint16(12, 3); // channels: RGB
  dv.setUint32(14, height);
  dv.setUint32(18, width);
  dv.setUint16(22, 8); // depth
  dv.setUint16(24, 3); // mode: RGB
  // Color mode data / image resources / layer & mask sections: empty (u32 0 at
  // 26 / 30 / 34), then u16 0 at 38 = raw (uncompressed) image data.
  for (let px = 0; px < plane; px++) {
    out[40 + px] = rgba[px * 4];
    out[40 + plane + px] = rgba[px * 4 + 1];
    out[40 + plane * 2 + px] = rgba[px * 4 + 2];
  }
  return out;
}

/** "Limit File Size To ___ K": bisect quality for the largest encode under the
 *  cap; when even minimum quality exceeds it, return that smallest encode (LR
 *  then warns rather than fails). Exported for tests.
 *  ponytail: the cap is measured pre-XMP/ppi tagging — a packet adds ~1 KB;
 *  re-measure after embedding if byte-exact caps ever matter. */
export async function encodeUnderLimit(encode: (quality: number) => Promise<Blob>, limitKB: number): Promise<Blob> {
  const cap = limitKB * 1024;
  let lo = 0.05;
  let hi = 0.95;
  let best = await encode(lo);
  if (best.size > cap) return best;
  for (let i = 0; i < 7; i++) {
    const mid = (lo + hi) / 2;
    const blob = await encode(mid);
    if (blob.size <= cap) { best = blob; lo = mid; } else hi = mid;
  }
  return best;
}

/** Develop + encode one photo to a blob + its output filename (throws on IO/
 *  decode failure — the caller counts it). */
async function developPhoto(p: PhotoRow, opts: ExportOptions): Promise<Blob> {
  if (opts.format !== "jpeg" && opts.format !== "png") throw new Error("developPhoto encodes the canvas formats (JPEG/PNG) only");
  const img = await developToImage(p);
  const target = targetDims(opts, img.width, img.height);
  const format = opts.format;
  const encode = (quality: number) => encodeImage(img.rgba, img.width, img.height, target, format, quality, opts.sharpen, opts.watermark, opts.profile);
  if (format === "jpeg" && opts.limitSizeKB && opts.limitSizeKB > 0) return encodeUnderLimit(encode, opts.limitSizeKB);
  return encode(opts.quality);
}

// ─────────────────────────────────────────────────────────────
// The native 16-bit routes: Rust develop + an app-side finish pass
// ─────────────────────────────────────────────────────────────
//
// The Rust develop-export writes a FULL-FRAME 16-bit file — monet-photo-core
// develops globals only. Crop/straighten, output sizing, sharpening and the
// watermark are all post-develop viewport steps (exactly what developToImage +
// encodeImage do for the 8-bit routes), so they run here over the 16-bit
// samples the native writer published, and metadata embeds as XMP. Local masks
// are the one step that cannot: they composite BEFORE crop out of extra engine
// passes, which the Rust pipeline has no way to render — still refused.

/** The finish steps `opts` asks for that the native writer cannot do itself. */
interface NativeFinish {
  /** Non-identity crop from the canonical recipe; null = full frame. */
  crop: CropSpec | null;
  /** Output sizing or a resolution tag — either one means a re-encode. */
  resample: boolean;
  sharpen: SharpenSpec | null;
  watermark: WatermarkSpecEx | null;
  xmp: string | null;
}

const finishTouchesPixels = (f: NativeFinish): boolean => !!(f.crop || f.resample || f.sharpen || f.watermark);

type DevelopExportIdentity = Awaited<ReturnType<typeof getDevelopExportIdentity>>;

/** Validate the export, snapshot the catalog identity, and work out what the
 *  finish pass has to do. Throws for everything the native route still cannot
 *  serve, before any pixels are rendered. */
async function planNativeExport(p: PhotoRow, opts: ExportOptions): Promise<{ identity: DevelopExportIdentity; finish: NativeFinish }> {
  if (!p.format.startsWith("raw:")) throw new Error("native 16-bit export currently requires a RAW source");
  // ponytail: the native Rust pipeline carries sRGB / Display P3 only — refuse
  // wider spaces here rather than fail opaquely inside the plugin call; widen
  // src-tauri's develop-job profiles to drop this.
  if (opts.profile === "adobeRGB" || opts.profile === "prophoto") {
    throw new Error("16-bit / linear-DNG export supports sRGB and Display P3 only — pick one of those or export as JPEG / PNG");
  }
  const identity = await getDevelopExportIdentity(p.id);
  let crop: CropPanel | undefined;
  let masked = false;
  try {
    const nativeRecipe = JSON.parse(identity.canonicalRecipeJson) as DevelopRecipeV2;
    crop = nativeRecipe.crop;
    masked = hasActiveMasks(nativeRecipe);
  } catch {
    crop = undefined; // malformed recipe — let the native route surface it
  }
  // Local (masked) adjustments composite app-side out of extra develop passes
  // (developToImage); the Rust engine renders globals only. Refuse rather than
  // silently write an unmasked 16-bit file.
  // ponytail: the ceiling is monet-photo-core, which has no mask compositor —
  // lift it there (the recipe already carries the masks) and this goes away.
  if (masked) {
    throw new Error("16-bit / linear-DNG export does not support local masks yet — disable the masks or export as JPEG / PNG / 8-bit TIFF");
  }
  if (
    identity.photo.id !== p.id ||
    identity.photo.sourceAssetId !== p.sourceAssetId ||
    identity.photo.path !== p.path
  ) {
    throw new Error("selected photo no longer matches the catalog export identity");
  }
  const finish: NativeFinish = {
    crop: crop && !isIdentityCrop(crop) ? crop : null,
    resample: !!(opts.resize || opts.longEdge || opts.ppi),
    sharpen: opts.sharpen ?? null,
    watermark: opts.watermark && hasWatermarkContent(opts.watermark) ? opts.watermark : null,
    xmp: await exportXmpPacket(p, opts),
  };
  // A linear DNG is a scene-referred raw deliverable, not a rendered one: LR
  // disables Image Sizing / Sharpening / Watermarking for it too, and re-writing
  // its pixels would invalidate the writer's own reopen-and-compare proof.
  // Metadata still applies — that embeds without touching a sample.
  if (opts.format === "linearDng16" && finishTouchesPixels(finish)) {
    throw new Error("linear-DNG export is a raw deliverable — crop, resize, sharpening and watermarks apply to rendered formats only; export as 16-bit TIFF / JPEG / PNG for those");
  }
  return { identity, finish };
}

async function runNativeJob(identity: DevelopExportIdentity, path: string, opts: ExportOptions): Promise<NativeDevelopResult> {
  return validateNativeDevelopResult(await invoke("plugin:develop-job|run_develop_export", {
    request: {
      jobId: crypto.randomUUID(),
      source: {
        path: identity.photo.readPath ?? identity.photo.path,
        catalogId: identity.catalogId,
        photoId: identity.photo.id,
        expectedDigest: identity.sourceDigest,
      },
      canonicalRecipeJson: identity.canonicalRecipeJson,
      output: { path, profile: opts.profile ?? "srgb", ...(opts.format === "linearDng16" ? { format: "linearDng16" } : {}) },
      interactive: false,
    },
  }));
}

/** Develop natively and publish the deliverable at `target`, finishing it
 *  app-side when the export asks for anything Rust did not render. */
async function developNative(p: PhotoRow, target: string, opts: ExportOptions): Promise<NativeDevelopResult> {
  const { identity, finish } = await planNativeExport(p, opts);
  const pixels = finishTouchesPixels(finish);
  // Nothing to finish: the native file IS the deliverable, published atomically
  // by the Rust writer with its digests intact. No read-back, no re-encode.
  if (!pixels && !finish.xmp) return runNativeJob(identity, target, opts);
  // Otherwise the writer publishes to a sibling part-file: a finish pass that
  // throws must leave NO file at `target`, because a full-frame uncropped 16-bit
  // file is indistinguishable from a good export once it is sitting there.
  // ponytail: the finished rewrite is a plain write — it does not inherit the
  // native writer's fsync/atomic-publish durability. Move the finish pass into
  // src-tauri's develop-job plugin if a crash-consistent export matters.
  const part = `${target}.monetpart`;
  try {
    const result = await runNativeJob(identity, part, opts);
    const native = await readFile(part);
    await writeFile(target, pixels
      ? await finishNativeTiff(native, finish, opts)
      : insertXmpTiff(native, finish.xmp!));
    return result;
  } finally {
    try {
      await remove(part);
    } catch {
      // Best effort: a leftover part-file is untidy, not a failed export.
    }
  }
}

/** Crop/straighten → resize → sharpen → watermark → re-encode the native RGB16
 *  TIFF, carrying its ICC and the metadata packet. */
async function finishNativeTiff(native: Uint8Array, finish: NativeFinish, opts: ExportOptions): Promise<Uint8Array> {
  const src = readTiffRgb16(native);
  const rect = finish.crop?.rect;
  const framed = rect
    ? { width: cropEdge(rect.left, rect.right, src.width), height: cropEdge(rect.top, rect.bottom, src.height) }
    : { width: src.width, height: src.height };
  const target = targetDims(opts, framed.width, framed.height);
  const rgb = finish.crop || target.width !== src.width || target.height !== src.height
    ? resampleRgb16(src.rgb, src.width, src.height, finish.crop, target)
    : src.rgb;
  if (finish.sharpen) sharpenRgb16(rgb, target.width, target.height, finish.sharpen);
  if (finish.watermark) await watermarkRgb16(rgb, target.width, target.height, finish.watermark);
  return encodeTiff16(rgb, target.width, target.height, src.icc, opts.ppi, finish.xmp);
}

/** Output edge for a crop running `lo`→`hi` (0..1) across a `full`-px edge — the
 *  same clamp + rounding lib/cropTransform uses, so a 16-bit export comes out
 *  the same size as the JPEG beside it. */
const cropEdge = (lo: number, hi: number, full: number): number =>
  Math.max(1, Math.round(Math.max(1, (clamp01Span(hi) - clamp01Span(lo)) * full)));
const clamp01Span = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Read the uncompressed RGB16 TIFF the native develop-export writes. Not a
 *  general TIFF reader — it validates that shape and refuses anything else
 *  rather than mis-reading samples into a wrong-looking file. */
function readTiffRgb16(bytes: Uint8Array): { width: number; height: number; rgb: Uint16Array; icc: Uint8Array | null } {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const le = bytes[0] === 0x49 && bytes[1] === 0x49;
  if ((!le && !(bytes[0] === 0x4d && bytes[1] === 0x4d)) || dv.getUint16(2, le) !== 42) {
    throw new Error("native 16-bit output is not a baseline TIFF");
  }
  const ifd = dv.getUint32(4, le);
  const n = dv.getUint16(ifd, le);
  const entries = new Map<number, { type: number; count: number; at: number }>();
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    entries.set(dv.getUint16(at, le), { type: dv.getUint16(at + 2, le), count: dv.getUint32(at + 4, le), at: at + 8 });
  }
  const SIZE: Record<number, number> = { 1: 1, 3: 2, 4: 4, 7: 1 };
  const blockAt = (e: { type: number; count: number; at: number }): number =>
    (SIZE[e.type] ?? 0) * e.count <= 4 ? e.at : dv.getUint32(e.at, le);
  const nums = (tag: number): number[] => {
    const e = entries.get(tag);
    if (!e) return [];
    if (!SIZE[e.type]) throw new Error(`native 16-bit output uses an unsupported TIFF type for tag ${tag}`);
    const base = blockAt(e);
    const out: number[] = [];
    for (let i = 0; i < e.count; i++) {
      out.push(e.type === 3 ? dv.getUint16(base + i * 2, le) : e.type === 4 ? dv.getUint32(base + i * 4, le) : bytes[base + i]);
    }
    return out;
  };
  const one = (tag: number, dflt: number): number => nums(tag)[0] ?? dflt;
  const width = one(256, 0);
  const height = one(257, 0);
  const bps = nums(258);
  if (!width || !height) throw new Error("native 16-bit output has no dimensions");
  if (one(259, 1) !== 1) throw new Error("native 16-bit output is compressed — the finish pass reads uncompressed strips");
  if (one(262, 2) !== 2 || one(277, 3) !== 3 || bps.length !== 3 || bps.some((b) => b !== 16) || one(284, 1) !== 1 || one(339, 1) !== 1) {
    throw new Error("native 16-bit output is not an uncompressed RGB16 TIFF");
  }
  const offsets = nums(273);
  const counts = nums(279);
  if (!offsets.length || offsets.length !== counts.length) throw new Error("native 16-bit output has no readable strips");
  const rows = one(278, height);
  // ponytail: the whole frame lands in one JS buffer (6 bytes/px — ~144 MB at
  // 24 MP), same as every other full-res export route here; stream strip-by-
  // strip through the encoder if a 100 MP file ever has to fit.
  const rgb = new Uint16Array(width * height * 3);
  const platformLe = new Uint8Array(new Uint16Array([1]).buffer)[0] === 1;
  let row = 0;
  for (let s = 0; s < offsets.length && row < height; s++) {
    const stripRows = Math.min(rows, height - row);
    const samples = stripRows * width * 3;
    if (counts[s] !== samples * 2 || offsets[s] + counts[s] > bytes.length) {
      throw new Error("native 16-bit output is truncated or has a strip size mismatch");
    }
    const into = row * width * 3;
    if (le === platformLe && (bytes.byteOffset + offsets[s]) % 2 === 0) {
      rgb.set(new Uint16Array(bytes.buffer, bytes.byteOffset + offsets[s], samples), into);
    } else {
      for (let i = 0; i < samples; i++) rgb[into + i] = dv.getUint16(offsets[s] + i * 2, le);
    }
    row += stripRows;
  }
  if (row !== height) throw new Error("native 16-bit output is truncated");
  const iccEntry = entries.get(34675);
  const icc = iccEntry ? bytes.slice(blockAt(iccEntry), blockAt(iccEntry) + iccEntry.count) : null;
  return { width, height, rgb, icc };
}

/** Crop + straighten + resize the 16-bit frame in ONE bilinear pass — the same
 *  geometry lib/cropTransform applies to the 8-bit routes (inverse-rotate the
 *  sample point about the image centre, edge-clamped).
 *  ponytail: a u16 twin of applyCrop, because that one is RGBA8-only; make it
 *  generic over the sample array if a third depth ever turns up. The point-
 *  sampled downscale also aliases more than the canvas resampler encodeImage
 *  uses — add a box prefilter if big 16-bit downsizes get used in anger. */
function resampleRgb16(src: Uint16Array, W: number, H: number, crop: CropSpec | null, out: Dims): Uint16Array {
  const left = crop ? clamp01Span(crop.rect.left) : 0;
  const top = crop ? clamp01Span(crop.rect.top) : 0;
  const right = crop ? clamp01Span(crop.rect.right) : 1;
  const bottom = crop ? clamp01Span(crop.rect.bottom) : 1;
  const rx0 = left * W;
  const ry0 = top * H;
  const sx = Math.max(1, (right - left) * W) / out.width;
  const sy = Math.max(1, (bottom - top) * H) / out.height;
  const rad = crop ? (-crop.angle * Math.PI) / 180 : 0;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const cx = W / 2;
  const cy = H / 2;
  const clampI = (v: number, n: number): number => (v < 0 ? 0 : v >= n ? n - 1 : v);
  const dst = new Uint16Array(out.width * out.height * 3);
  for (let oy = 0; oy < out.height; oy++) {
    const py = ry0 + (oy + 0.5) * sy;
    for (let ox = 0; ox < out.width; ox++) {
      const px = rx0 + (ox + 0.5) * sx;
      const dx = px - cx;
      const dy = py - cy;
      const fx = cx + dx * cos - dy * sin - 0.5;
      const fy = cy + dx * sin + dy * cos - 0.5;
      const x0 = Math.floor(fx);
      const y0 = Math.floor(fy);
      const tx = fx - x0;
      const ty = fy - y0;
      const ax = clampI(x0, W) * 3;
      const bx = clampI(x0 + 1, W) * 3;
      const ay = clampI(y0, H) * W * 3;
      const by = clampI(y0 + 1, H) * W * 3;
      const o = (oy * out.width + ox) * 3;
      for (let k = 0; k < 3; k++) {
        const a = src[ay + ax + k];
        const b = src[ay + bx + k];
        const c = src[by + ax + k];
        const d = src[by + bx + k];
        const hi = a + (b - a) * tx;
        const lo = c + (d - c) * tx;
        const v = Math.round(hi + (lo - hi) * ty);
        dst[o + k] = v < 0 ? 0 : v > 65535 ? 65535 : v;
      }
    }
  }
  return dst;
}

/** Output sharpening over 16-bit samples, in place: run the shared 8-bit unsharp
 *  mask and transfer its per-channel delta back at 16-bit scale (×257 maps a
 *  0xff step onto 0xffff).
 *  ponytail: the delta is therefore quantized to 8-bit steps — widen
 *  lib/outputSharpen to a float luma field if that ever bands. */
function sharpenRgb16(rgb: Uint16Array, width: number, height: number, spec: SharpenSpec): void {
  const n = width * height;
  const flat = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    flat[i * 4] = rgb[i * 3] >>> 8;
    flat[i * 4 + 1] = rgb[i * 3 + 1] >>> 8;
    flat[i * 4 + 2] = rgb[i * 3 + 2] >>> 8;
    flat[i * 4 + 3] = 255;
  }
  const sharp = unsharpMask(flat, width, height, sharpenParams(spec));
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 3; k++) {
      const delta = (sharp[i * 4 + k] - flat[i * 4 + k]) * 257;
      if (!delta) continue;
      const v = rgb[i * 3 + k] + delta;
      rgb[i * 3 + k] = v < 0 ? 0 : v > 65535 ? 65535 : v;
    }
  }
}

/** Draw the watermark over the 16-bit frame, in place. The overlay is an 8-bit
 *  canvas render by nature (the one drawWatermark every output route shares);
 *  only the source-over blend runs at 16 bits, so the photo keeps its depth. */
async function watermarkRgb16(rgb: Uint16Array, width: number, height: number, wm: WatermarkSpecEx): Promise<void> {
  const canvas = new OffscreenCanvas(width, height);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("no 2d context");
  await drawWatermark(ctx, width, height, wm);
  const { data } = ctx.getImageData(0, 0, width, height);
  for (let i = 0; i < width * height; i++) {
    const a = data[i * 4 + 3] / 255;
    if (!a) continue;
    for (let k = 0; k < 3; k++) {
      rgb[i * 3 + k] = Math.round(rgb[i * 3 + k] * (1 - a) + data[i * 4 + k] * 257 * a);
    }
  }
}

/** Encode RGB16 samples as a single-strip uncompressed TIFF carrying the source
 *  ICC (the native route's sRGB / Display P3 tag), the resolution tag and the
 *  metadata packet. */
function encodeTiff16(rgb: Uint16Array, width: number, height: number, icc: Uint8Array | null, ppi?: number | null, xmp?: string | null): Uint8Array {
  // Classic TIFF addresses offsets with a u32; refuse rather than emit a file
  // whose strip offset silently wrapped.
  if (width * height * 6 > 0xffff_0000) {
    throw new Error("16-bit TIFF export exceeds the 4 GB TIFF limit — resize the output or export as JPEG / PNG");
  }
  let strip = new Uint8Array(rgb.buffer, rgb.byteOffset, rgb.byteLength);
  if (new Uint8Array(new Uint16Array([1]).buffer)[0] !== 1) {
    const swapped = new Uint8Array(strip.length); // big-endian host: the file stays "II"
    for (let i = 0; i < strip.length; i += 2) { swapped[i] = strip[i + 1]; swapped[i + 1] = strip[i]; }
    strip = swapped;
  }
  const packet = xmp ? new TextEncoder().encode(xpacket(xmp)) : null;
  return writeTiff([
    { tag: 256, type: 4, count: 1, value: width },
    { tag: 257, type: 4, count: 1, value: height },
    { tag: 258, type: 3, count: 3, data: shorts([16, 16, 16]) },
    { tag: 259, type: 3, count: 1, value: 1 }, // uncompressed, like the native writer
    { tag: 262, type: 3, count: 1, value: 2 },
    { tag: 274, type: 3, count: 1, value: 1 }, // Orientation: already baked in
    { tag: 277, type: 3, count: 1, value: 3 },
    { tag: 278, type: 4, count: 1, value: height },
    ...resolutionEntries(ppi),
    ...(packet ? [{ tag: 700, type: 1, count: packet.length, data: packet }] : []),
    ...(icc ? [{ tag: 34675, type: 7, count: icc.length, data: icc }] : []),
  ], strip);
}

/** Return a copy of `tiff` (or DNG — the same container) carrying `xmp` as tag
 *  700. The packet and a rewritten IFD are APPENDED and the header re-pointed at
 *  the new IFD, so every existing value offset stays valid: not one byte the
 *  native writer validated moves.
 *  ponytail: the superseded IFD stays behind as a few hundred dead bytes —
 *  rewrite the container whole if that ever matters. */
function insertXmpTiff(tiff: Uint8Array, xmp: string): Uint8Array {
  const dv = new DataView(tiff.buffer, tiff.byteOffset, tiff.byteLength);
  const le = tiff[0] === 0x49 && tiff[1] === 0x49;
  if ((!le && !(tiff[0] === 0x4d && tiff[1] === 0x4d)) || dv.getUint16(2, le) !== 42) {
    throw new Error("native 16-bit output is not a TIFF — cannot embed metadata");
  }
  const ifd = dv.getUint32(4, le);
  const n = dv.getUint16(ifd, le);
  // Writing metadata must REPLACE any packet already there, not stack a second
  // one readers would have to choose between.
  const kept: number[] = [];
  for (let i = 0; i < n; i++) {
    const at = ifd + 2 + i * 12;
    if (dv.getUint16(at, le) !== 700) kept.push(at);
  }
  const packet = new TextEncoder().encode(xpacket(xmp));
  const xmpAt = tiff.length + (tiff.length % 2);
  const ifdAt = xmpAt + packet.length + ((xmpAt + packet.length) % 2);
  const out = new Uint8Array(ifdAt + 2 + (kept.length + 1) * 12 + 4);
  out.set(tiff);
  out.set(packet, xmpAt);
  const odv = new DataView(out.buffer);
  odv.setUint32(4, ifdAt, le);
  odv.setUint16(ifdAt, kept.length + 1, le);
  let w = ifdAt + 2;
  const writeXmpEntry = (): void => {
    odv.setUint16(w, 700, le); odv.setUint16(w + 2, 1, le);
    odv.setUint32(w + 4, packet.length, le); odv.setUint32(w + 8, xmpAt, le);
    w += 12;
  };
  let written = false;
  for (const at of kept) {
    if (!written && dv.getUint16(at, le) > 700) { writeXmpEntry(); written = true; }
    out.set(tiff.subarray(at, at + 12), w);
    w += 12;
  }
  if (!written) writeXmpEntry();
  odv.setUint32(w, dv.getUint32(ifd + 2 + n * 12, le), le); // keep the IFD chain
  return out;
}

async function blobBytes(blob: Blob): Promise<Uint8Array> {
  return new Uint8Array(await blob.arrayBuffer());
}

/** The photo's catalog metadata as an XMP packet, narrowed to `opts.metadata` —
 *  or null when the scope (or the photo) leaves nothing to write. */
async function exportXmpPacket(p: PhotoRow, opts: ExportOptions): Promise<string | null> {
  const scope = opts.metadata ?? DEFAULT_METADATA_SCOPE;
  // The vocabulary carries LR's Include On Export / Export Containing Keywords /
  // Export Synonyms flags — exportKeywords is the one place they are applied.
  const [kws, vocab] =
    scope.include === "all"
      ? await Promise.all([listPhotoKeywords(p.id), exportVocab()])
      : [[], []];
  const { flat: keywords, hierarchical } = exportKeywords(kws, vocab);
  const meta = filterExportMetadata(
    {
      rating: p.rating,
      label: p.colorLabel,
      title: p.title,
      caption: p.caption,
      creator: p.creator,
      copyright: p.copyright,
      city: p.city,
      stateProvince: p.stateProvince,
      country: p.country,
      jobTitle: p.jobTitle,
      credit: p.credit,
      source: p.source,
      keywords,
      hierarchical: opts.writeKeywordHierarchy === false ? [] : hierarchical,
    },
    scope,
  );
  // No develop block: an export is a rendered file, not a re-editable original.
  return meta ? buildXmpSidecar(meta, null) : null;
}

/** Develop + encode + embed metadata → the bytes to write. Also the renderer
 *  behind "Edit in Monet Vision" (lib/editIn), which needs one photo's baked
 *  pixels at an explicit path rather than a batch into a folder. */
export async function exportBytes(p: PhotoRow, opts: ExportOptions): Promise<Uint8Array> {
  // "Original" is a byte-for-byte copy of the source — no develop, no re-encode,
  // no metadata rewrite; the catalog recipe stays in the catalog.
  if (opts.format === "original") return await readFile(p.readPath ?? p.path);
  if (opts.format === "tiff8" || opts.format === "psd") {
    // App-side pixel encoders carry sRGB only; refuse a wider ask rather than
    // silently strip the profile (the 16-bit native route carries Display P3).
    if (opts.profile && opts.profile !== "srgb") {
      throw new Error("8-bit TIFF / PSD export is sRGB only — pick sRGB, or export as JPEG / PNG / 16-bit TIFF");
    }
    const img = await developToImage(p);
    const scaled = resizeRgba(img, targetDims(opts, img.width, img.height));
    // ponytail: composite pixels only — no XMP/ICC blocks; extend embedXmp with
    // a TIFF-IFD / PSD-resource writer when metadata in these formats matters.
    return opts.format === "psd"
      ? encodePsd(scaled.rgba, scaled.width, scaled.height)
      : encodeTiff8(scaled.rgba, scaled.width, scaled.height, opts.tiffCompression ?? "none", opts.ppi);
  }
  let bytes = await blobBytes(await developPhoto(p, opts));
  // The native 16-bit routes never reach here — they write straight to disk in
  // Rust and take their finish pass (crop, sizing, sharpen, watermark, XMP) in
  // developNative.
  if (opts.format !== "jpeg" && opts.format !== "png") return bytes;
  // Resolution tag first: the JPEG path patches/leads with APP0, which the XMP
  // embed below expects to skip past.
  if (opts.ppi && opts.ppi > 0) {
    bytes = opts.format === "jpeg" ? tagPpiJpeg(bytes, opts.ppi) : tagPpiPng(bytes, opts.ppi);
  }
  const xmp = await exportXmpPacket(p, opts);
  if (!xmp) return bytes;
  return opts.format === "jpeg" ? embedXmpJpeg(bytes, xmp) : embedXmpPng(bytes, xmp);
}

/** Where a written file may land: `dir/name`, or a free `stem-2`, `stem-3`… when
 *  it is taken and the policy says rename — or null when the policy says skip.
 *  `seen` de-duplicates within this batch; `probe` asks the filesystem, so a
 *  second export into the same folder can no longer destroy the first one. */
async function resolveTarget(
  dir: string,
  name: string,
  seen: Set<string>,
  loc: ExportLocation,
  probe: (path: string) => Promise<boolean>,
): Promise<string | null> {
  const first = uniqueName(name, seen);
  const path = joinPath(dir, first);
  if (!(await probe(path))) return path;
  const policy = loc.existingFiles ?? "ask";
  const action = policy === "ask" ? await loc.onExisting?.(path) : policy;
  if (action === "skip") return null;
  // ponytail: the native 16-bit writer creates its destination exclusively, so
  // Overwrite on a file it publishes directly (nothing to finish app-side)
  // surfaces as a visible "File exists" failure rather than a replaced file;
  // unlink-then-write in Rust if that becomes worth it.
  if (action === "overwrite") return path;
  // "Choose a new name", and the fallback whenever nobody answered the prompt.
  const dot = first.lastIndexOf(".");
  const stem = dot >= 0 ? first.slice(0, dot) : first;
  const ext = dot >= 0 ? first.slice(dot) : "";
  for (let i = 2; i <= 9999; i++) {
    const candidate = `${stem}-${i}${ext}`;
    if (seen.has(candidate)) continue;
    const free = joinPath(dir, candidate);
    if (!(await probe(free))) {
      seen.add(candidate);
      return free;
    }
  }
  throw new Error(`no free filename for ${first} in ${dir}`);
}

/** "Add to This Catalog" (+ Add to Stack) — re-import what the batch wrote.
 *  Imported on demand: the import graph is heavy and an export that doesn't
 *  re-import never needs it. */
async function addExportsToCatalog(written: { photo: PhotoRow; path: string }[], addToStack: boolean): Promise<void> {
  const { importPathsWithIds } = await import("./import");
  // skipDuplicates:false — an export IS a derivative of a cataloged master; LR
  // adds it regardless.
  const ids = await importPathsWithIds(written.map((w) => w.path), { skipDuplicates: false });
  if (!addToStack) return;
  const { stackPhotos } = await import("./catalog/catalog");
  for (let i = 0; i < ids.length && i < written.length; i++) {
    await stackPhotos([written[i].photo.id, ids[i]]);
  }
}

/** Containers c2pa-rs can embed a manifest store into — mirrors Vision's
 *  `SIGNABLE_MIMES` (`apps/vision/src-tauri/src/c2pa_sign.rs`) and Galerie's
 *  own (`apps/galerie/src-tauri/src/c2pa_sign.rs`). PSD and Linear DNG have no
 *  such container, so they keep the unsigned sidecar even with a signer
 *  configured — there is nothing to embed into. */
function signableMime(format: ExportFormat): string | null {
  switch (format) {
    case "jpeg": return "image/jpeg";
    case "png": return "image/png";
    case "tiff8":
    case "tiff16": return "image/tiff";
    default: return null; // psd, linearDng16, original
  }
}

/** Export ▸ Content Credentials (Beta): the C2PA manifest the catalog assembles
 *  for this photo (`catalog_content_credentials` — producer rights, the develop
 *  history as `c2pa.actions`, model use disclosed).
 *
 *  With a signer configured (Preferences ▸ Content Credentials, imported via
 *  `plugin:c2pa|c2pa_import_signer`) and an embeddable container
 *  (`signableMime`), the manifest is signed and embedded into the file
 *  itself, replacing the bytes already written at `target`. Otherwise — no
 *  signer imported, or a container c2pa-rs cannot carry a manifest store in
 *  (PSD, Linear DNG) — it is written unsigned beside it as
 *  `<output name>.c2pa.json`, exactly as before signing existed. The full
 *  output name, not the stem, so a JPEG and a TIFF of the same photo in one
 *  folder keep their own manifests.
 *
 *  Never fatal: the image is already on disk, and losing or downgrading
 *  credentials must not read as a lost export — it is reported the way "add
 *  to catalog" failures are. */
async function applyContentCredentials(
  p: PhotoRow,
  target: string,
  opts: ExportOptions,
  hasSigner: boolean,
  failureMessages: string[],
): Promise<void> {
  // "Original" is a byte-for-byte copy: whatever credentials the source carries
  // are its own, and claiming an edit over an untouched file is a false claim.
  if (!opts.contentCredentials || opts.format === "original") return;
  const mime = hasSigner ? signableMime(opts.format) : null;
  if (mime) {
    try {
      const bytes = await readFile(target);
      const embedded = await invoke<ArrayBuffer>("plugin:c2pa|sign_content_credentials", bytes, {
        headers: { "x-c2pa-mime": mime, "x-c2pa-photo-id": String(p.id) },
      });
      await writeFile(target, new Uint8Array(embedded));
      return;
    } catch (e) {
      console.error("galerie export: signing failed, writing unsigned sidecar instead", target, e);
      failureMessages.push(`${target}: content credentials: signing failed (${String(e)})`);
      // Fall through to the sidecar below — some provenance beats none.
    }
  }
  try {
    const creds = await invoke<{ manifestJson: string }>("plugin:catalog|catalog_content_credentials", { id: p.id });
    await writeTextFile(`${target}.c2pa.json`, creds.manifestJson);
  } catch (e) {
    console.error("galerie export: content credentials failed", target, e);
    failureMessages.push(`${target}: content credentials: ${String(e)}`);
  }
}

/** Whether a signer is currently configured (Preferences ▸ Content
 *  Credentials) — checked once per batch, not per photo, since resolving it
 *  Rust-side trial-signs a fixture. `null`/an error both mean "no signer": the
 *  export must degrade to the unsigned sidecar rather than throw. */
async function signerConfigured(): Promise<boolean> {
  try {
    return (await invoke("plugin:c2pa|c2pa_signer_info")) != null;
  } catch {
    return false;
  }
}

/** Develop + encode + write each photo into the export location. Per-photo
 *  failures are logged and counted, never aborting the batch (LR's
 *  deterministic batch recovery). A plain `dir` string means Existing Files =
 *  ask, which without a resolver renames — an export never overwrites silently. */
export async function runExport(
  photos: PhotoRow[],
  dest: string | ExportLocation,
  opts: ExportOptions,
  // `onWritten` reports each file as it lands, which is what Post-Processing ▸
  // After Export needs. It's a hook rather than a field on ExportResult so the
  // result shape the batch tests pin stays exactly as it is.
  // `onUnsignedCredentials` fires at most once when Content Credentials was
  // requested but no signer is configured — the caller's cue to tell the user
  // the batch is carrying the unsigned sidecar, not a silent downgrade.
  hooks?: { onTick?: () => void; isCancelled?: () => boolean; onWritten?: (path: string) => void; onUnsignedCredentials?: () => void },
): Promise<ExportResult> {
  const loc: ExportLocation = typeof dest === "string" ? { dir: dest } : dest;
  const sub = loc.subfolder?.trim() ?? "";
  // A subfolder is one folder NAME, not a path — reject separators and traversal
  // rather than write outside the folder the user picked.
  if (sub && /[/\\]|^\.\.?$/.test(sub)) throw new Error(`invalid export subfolder: ${sub}`);
  const dir = sub ? joinPath(loc.dir, sub) : loc.dir;
  if (sub) await mkdir(dir, { recursive: true });

  // Resolved once for the whole batch — not per photo, since checking Rust-side
  // trial-signs a fixture (cheap once, wasteful ×N).
  const hasSigner = opts.contentCredentials ? await signerConfigured() : false;
  if (opts.contentCredentials && !hasSigner) hooks?.onUnsignedCredentials?.();

  let written = 0;
  let committed = 0;
  let failed = 0;
  let skipped = 0;
  let cancelled = false;
  const durabilityWarnings: string[] = [];
  const failureMessages: string[] = [];
  const seen = new Set<string>();
  const added: { photo: PhotoRow; path: string }[] = [];
  for (let i = 0; i < photos.length; i++) {
    // Background-export Cancel stops before the next photo; finished files stay.
    if (hooks?.isCancelled?.()) {
      cancelled = true;
      break;
    }
    const p = photos[i];
    try {
      const target = await resolveTarget(dir, outputFilename(p, i, opts), seen, loc, exists);
      if (target === null) {
        skipped++;
        continue;
      }
      if (opts.format === "tiff16" || opts.format === "linearDng16") {
        const result = await developNative(p, target, opts);
        if (result.state === "completed") written++;
        else {
          committed++;
          durabilityWarnings.push(result.durabilityError);
        }
        await applyContentCredentials(p, target, opts, hasSigner, failureMessages);
        added.push({ photo: p, path: target });
        hooks?.onWritten?.(target);
        continue;
      }
      await writeFile(target, await exportBytes(p, opts));
      written++;
      await applyContentCredentials(p, target, opts, hasSigner, failureMessages);
      added.push({ photo: p, path: target });
      hooks?.onWritten?.(target);
    } catch (e) {
      console.error("galerie export: failed", p.path, e);
      failed++;
      failureMessages.push(`${p.path}: ${String(e)}`);
    } finally {
      hooks?.onTick?.();
    }
  }
  if (loc.addToCatalog && added.length) {
    // A failed re-import must not lose the export itself — the files are on
    // disk; report it like any other per-photo failure.
    try {
      await addExportsToCatalog(added, loc.addToStack ?? false);
    } catch (e) {
      console.error("galerie export: add to catalog failed", e);
      failureMessages.push(`add to catalog: ${String(e)}`);
    }
  }
  // `cancelled` / `skipped` appear only when they actually happened, keeping the
  // result shape stable for every normal export (the contract the tests pin).
  const res: ExportResult = { written, committed, failed, durabilityWarnings, failureMessages };
  if (cancelled) res.cancelled = true;
  if (skipped) res.skipped = skipped;
  return res;
}

// ─────────────────────────────────────────────────────────────
// The universal container — `.mgal` (docs/plans/11-universal-container.md)
// ─────────────────────────────────────────────────────────────
//
// The container work itself is native (src-tauri/src/catalog.rs → monet-db's
// `open_from_container` / `snapshot_to_container`): SQLite cannot be operated
// inside a zip, and the only connection lives in Rust. The bridge to those two
// commands sits in state/store.ts, next to the state they change; what lives
// here is the naming — what the file picker offers and what it defaults to.

/** Galerie's own extension. `.galcat` stays the LIVE catalog; `.mgal` is the
 *  portable container around a snapshot of it. */
export const CONTAINER_EXT = "mgal";

/** Every Monet extension, for the Open Container picker — dispatch is on the
 *  manifest, so a `.mcin` renamed `.mgal` opens exactly the same. */
export const CONTAINER_EXTENSIONS = CONTAINER_APPS.map((row) => row.ext.slice(1));

/** `/photos/Main.galcat` → `Main.mgal` — the Save As default. */
export function defaultContainerName(catalogPath: string | null): string {
  const name = catalogPath ? basename(catalogPath) : "catalog";
  return `${stripExt(name) || "catalog"}.${CONTAINER_EXT}`;
}

/** Pick the export output folder. Returns null if the picker was cancelled. */
export async function pickExportDir(): Promise<string | null> {
  const dir = await open({ directory: true, multiple: false, title: "Export to Folder" });
  return typeof dir === "string" ? dir : null;
}

/** Pick a folder and write a static HTML gallery: `images/` of resized JPEGs +
 *  an `index.html` linking them. Returns null if the folder pick was cancelled. */
export async function exportWebGallery(
  photos: PhotoRow[],
  options: WebGalleryOptions = DEFAULT_WEB_GALLERY_OPTIONS,
): Promise<ExportResult | null> {
  if (photos.length === 0) return { written: 0, committed: 0, failed: 0, durabilityWarnings: [], failureMessages: [] };
  const dir = await open({ directory: true, multiple: false, title: "Export Web Gallery" });
  if (typeof dir !== "string") return null;

  const opts: ExportOptions = galleryExportOpts(options);
  const imagesDir = joinPath(dir, "images");
  await mkdir(imagesDir, { recursive: true });

  const items: GalleryItem[] = [];
  const seen = new Set<string>();
  let written = 0;
  let failed = 0;
  const failureMessages: string[] = [];
  for (const p of photos) {
    try {
      const bytes = await exportBytes(p, opts);
      // Disambiguate filename collisions so index.html links stay unique. A
      // re-export into the same folder deliberately replaces the gallery it
      // wrote before — index.html and images/ are one generated site, not
      // individual user files, so Existing Files does not apply here.
      const file = uniqueName(outputFilename(p, 0, opts), seen);
      await writeFile(joinPath(imagesDir, file), bytes);
      items.push({ file, title: p.title ?? basename(p.path), caption: p.caption ?? undefined });
      written++;
    } catch (e) {
      console.error("galerie web export: failed", p.path, e);
      failed++;
      failureMessages.push(`${p.path}: ${String(e)}`);
    }
  }
  await writeTextFile(joinPath(dir, "index.html"), galleryHtml("Gallery", items, options));
  return { written, committed: 0, failed, durabilityWarnings: [], failureMessages };
}
