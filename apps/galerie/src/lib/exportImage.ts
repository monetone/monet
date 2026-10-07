// exportImage — resize + encode helpers for Output/Export. The dimension math is
// pure (unit-tested); the pixel encode uses OffscreenCanvas (browser/Tauri
// webview). Kept out of export.ts so the sizing logic tests without a canvas.

// Type-only: erased at runtime, so the pure sizing math still tests wasm-free.
import type { ExportColorSpace } from "../engine";
import { chunk, findChunk } from "./embedXmp";
import type { PresetStorage } from "./exportPresets";
import { sharpenParams, unsharpMask, type SharpenSpec } from "./outputSharpen";
import { fontPx, watermarkLayout, type WatermarkSpec } from "./watermark";

export interface Dims {
  width: number;
  height: number;
}

export type ResizeMode = "widthHeight" | "dimensions" | "longEdge" | "shortEdge" | "megapixels" | "percentage";
export type ResizeUnit = "px" | "in" | "cm";

/** LR's Image Sizing ▸ Resize to Fit. `value` is the mode's number (width /
 *  long edge / short edge / megapixels / percent); `value2` is the height for
 *  the two-field modes (defaults to `value`). Edge values are in `unit`
 *  (default px; in/cm scale by the export ppi). */
export interface ResizeSpec {
  mode: ResizeMode;
  value: number;
  value2?: number;
  unit?: ResizeUnit;
  /** LR's Don't Enlarge — cap the scale at 1 so the export never upsamples. */
  dontEnlarge?: boolean;
}

/** Resize `w`×`h` per `spec`, preserving aspect (uniform scale — LR never
 *  distorts). Free numeric entry is a trust boundary: a non-finite or ≤0 value
 *  means full size rather than a 0×0 or Infinity canvas. */
export function fitResize(w: number, h: number, spec: ResizeSpec, ppi = 240): Dims {
  const toPx = (v: number) => (spec.unit === "in" ? v * ppi : spec.unit === "cm" ? (v * ppi) / 2.54 : v);
  const v = spec.value;
  if (!Number.isFinite(v) || v <= 0) return { width: w, height: h };
  const v2 = Number.isFinite(spec.value2) && spec.value2! > 0 ? spec.value2! : v;
  let s: number;
  switch (spec.mode) {
    case "widthHeight":
      // Fit within the W×H box as entered (orientation matters).
      s = Math.min(toPx(v) / w, toPx(v2) / h);
      break;
    case "dimensions":
      // Orientation-free box: long edge fits the larger entry, short the smaller.
      s = Math.min(
        Math.max(toPx(v), toPx(v2)) / Math.max(w, h),
        Math.min(toPx(v), toPx(v2)) / Math.min(w, h),
      );
      break;
    case "longEdge":
      s = toPx(v) / Math.max(w, h);
      break;
    case "shortEdge":
      s = toPx(v) / Math.min(w, h);
      break;
    case "megapixels":
      s = Math.sqrt((v * 1e6) / (w * h));
      break;
    case "percentage":
      s = v / 100;
      break;
  }
  if (spec.dontEnlarge) s = Math.min(s, 1);
  return { width: Math.max(1, Math.round(w * s)), height: Math.max(1, Math.round(h * s)) };
}

/** Fit `w`×`h` within a `longEdge` box, preserving aspect. Never upscales
 *  (the legacy bare-number sizing — web gallery, edit-in); `null`/≤0 longEdge
 *  means full size. */
export function fitLongEdge(w: number, h: number, longEdge: number | null): Dims {
  if (!longEdge || longEdge <= 0) return { width: w, height: h };
  return fitResize(w, h, { mode: "longEdge", value: longEdge, dontEnlarge: true });
}

// --- Resolution (ppi) tagging ------------------------------------------
// Canvas/engine encodes carry no density, so a "1200 px wide, 300 ppi" spec
// sheet export printed at the reader's default. Pure byte surgery, like
// embedXmp. ponytail: JFIF density + pHYs only — EXIF XResolution needs a TIFF
// IFD writer; add one if a reader that ignores JFIF density turns up.

/** Return a copy of `jpeg` whose JFIF APP0 density reads `ppi` (units=1,
 *  dots/inch) — patched in place when a well-formed JFIF header leads, else a
 *  fresh JFIF APP0 inserted right after SOI so it is the one readers honor. */
export function tagPpiJpeg(jpeg: Uint8Array, ppi: number): Uint8Array {
  if (jpeg.length < 2 || jpeg[0] !== 0xff || jpeg[1] !== 0xd8) {
    throw new Error("not a JPEG (missing SOI)");
  }
  const d = Math.min(0xffff, Math.max(1, Math.round(ppi)));
  const len = jpeg.length >= 6 ? (jpeg[4] << 8) | jpeg[5] : 0;
  const isJfif = jpeg.length >= 18 && jpeg[2] === 0xff && jpeg[3] === 0xe0 && len >= 16
    && jpeg[6] === 0x4a && jpeg[7] === 0x46 && jpeg[8] === 0x49 && jpeg[9] === 0x46 && jpeg[10] === 0;
  if (isJfif) {
    // APP0 layout: marker(2) len(2) "JFIF\0"(5) version(2) units(1) Xd(2) Yd(2)…
    const out = jpeg.slice();
    out[13] = 1; // dots per inch
    out[14] = (d >> 8) & 0xff; out[15] = d & 0xff;
    out[16] = (d >> 8) & 0xff; out[17] = d & 0xff;
    return out;
  }
  const seg = new Uint8Array([
    0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, // APP0 len=16 "JFIF\0"
    0x01, 0x02, 0x01, (d >> 8) & 0xff, d & 0xff, (d >> 8) & 0xff, d & 0xff, // v1.02 units=1 Xd Yd
    0x00, 0x00, // no thumbnail
  ]);
  const out = new Uint8Array(jpeg.length + seg.length);
  out.set(jpeg.subarray(0, 2), 0);
  out.set(seg, 2);
  out.set(jpeg.subarray(2), 2 + seg.length);
  return out;
}

/** Return a copy of `png` carrying `ppi` as a pHYs chunk (pixels per metre,
 *  unit=metre), inserted before the first IDAT where the spec requires it —
 *  replacing an existing pHYs if one is present. */
export function tagPpiPng(png: Uint8Array, ppi: number): Uint8Array {
  const ppm = Math.max(1, Math.round(ppi / 0.0254));
  const data = new Uint8Array(9);
  for (let i = 0; i < 4; i++) {
    data[i] = (ppm >>> (24 - i * 8)) & 0xff;
    data[4 + i] = data[i];
  }
  data[8] = 1; // unit: metre
  const phys = chunk("pHYs", data);
  const existing = findChunk(png, "pHYs");
  const at = existing >= 0 ? existing : findChunk(png, "IDAT");
  if (at < 0) throw new Error("PNG has no IDAT chunk");
  // Splice out the old chunk at its declared length (12 = len+type+CRC framing).
  const skip = existing >= 0
    ? 12 + (((png[at] << 24) | (png[at + 1] << 16) | (png[at + 2] << 8) | png[at + 3]) >>> 0)
    : 0;
  const out = new Uint8Array(png.length - skip + phys.length);
  out.set(png.subarray(0, at), 0);
  out.set(phys, at);
  out.set(png.subarray(at + skip), at + phys.length);
  return out;
}

/** File extension for an export format. */
export function extForFormat(format: "jpeg" | "png" | "tiff16" | "linearDng16"): string {
  return format === "png" ? "png" : format === "tiff16" ? "tiff" : format === "linearDng16" ? "dng" : "jpg";
}

/** Reserve a collision-free filename against `seen`: returns `name`, or
 *  `stem-2.ext`, `stem-3.ext`… — and records the result. Prevents an export
 *  batch from silently overwriting two sources that render to the same name. */
export function uniqueName(name: string, seen: Set<string>): string {
  let out = name;
  if (seen.has(out)) {
    const dot = name.lastIndexOf(".");
    const stem = dot >= 0 ? name.slice(0, dot) : name;
    const ext = dot >= 0 ? name.slice(dot) : "";
    let i = 2;
    while (seen.has(`${stem}-${i}${ext}`)) i++;
    out = `${stem}-${i}${ext}`;
  }
  seen.add(out);
  return out;
}

/** Derive the export filename: source stem + optional virtual-copy suffix + ext. */
export function exportFilename(sourcePath: string, copyName: string | null, format: "jpeg" | "png" | "tiff16" | "linearDng16"): string {
  const slash = Math.max(sourcePath.lastIndexOf("/"), sourcePath.lastIndexOf("\\"));
  const name = slash >= 0 ? sourcePath.slice(slash + 1) : sourcePath;
  const stem = name.replace(/\.[^.]+$/, "");
  const suffix = copyName ? `-${copyName.replace(/\s+/g, "")}` : "";
  return `${stem}${suffix}.${extForFormat(format)}`;
}

// --- Watermark Editor (LR's Text/Graphic watermarks) -------------------
// lib/watermark holds the frozen text core + placement math shared with
// print.ts; the editor's extras (graphic, font/style/colour/shadow, rotation)
// are optional fields here so every existing caller and saved spec keeps
// working unchanged. ponytail: spec + saved-watermark store belong in
// lib/watermark.ts beside the layout math — fold them in when that file is
// free to change (the print/web/slideshow wiring pass).

export interface WatermarkSpecEx extends WatermarkSpec {
  /** Text (default) or a PNG/JPEG graphic. */
  mode?: "text" | "graphic";
  /** Text colour; default white. */
  color?: string;
  /** CSS font family stack; default sans-serif. */
  font?: string;
  bold?: boolean;
  italic?: boolean;
  /** Drop shadow behind the text; default on (the pre-editor look). */
  shadow?: boolean;
  /** Clockwise quarter turns (LR's rotate buttons): 0–3. */
  rotateQuarter?: 0 | 1 | 2 | 3;
  /** Graphic image as a data URL — serializes into saved watermarks. */
  graphicDataUrl?: string;
}

/** True when the spec has something to draw (text, or a chosen graphic). */
export function hasWatermarkContent(wm: WatermarkSpecEx): boolean {
  return wm.mode === "graphic" ? !!wm.graphicDataUrl : wm.text.trim() !== "";
}

/** CSS font shorthand for the text watermark at `px`. */
export function watermarkFont(wm: WatermarkSpecEx, px: number): string {
  return `${wm.italic ? "italic " : ""}${wm.bold ? "bold " : ""}${px}px ${wm.font || "sans-serif"}`;
}

/** Bounding box of a `w`×`h` box rotated by `quarter` quarter turns. */
export function rotatedBox(w: number, h: number, quarter: number): { w: number; h: number } {
  return quarter % 2 ? { w: h, h: w } : { w, h };
}

/** Graphic watermark size: width = sizePct% of the canvas width, aspect kept,
 *  clamped so it always fits the canvas. */
export function graphicBox(cw: number, ch: number, iw: number, ih: number, sizePct: number): Dims {
  if (!(iw > 0) || !(ih > 0)) return { width: 1, height: 1 }; // undecodable graphic — draw nothing visible
  const s = Math.min(((sizePct / 100) * cw) / iw, cw / iw, ch / ih);
  return { width: Math.max(1, Math.round(iw * s)), height: Math.max(1, Math.round(ih * s)) };
}

/** Draw `wm` onto a `cw`×`ch` canvas context — the one watermark renderer for
 *  every output route (Export encodes through it; Print/Web/Slideshow reuse). */
export async function drawWatermark(
  ctx: OffscreenCanvasRenderingContext2D,
  cw: number,
  ch: number,
  wm: WatermarkSpecEx,
): Promise<void> {
  if (!hasWatermarkContent(wm)) return;
  const q = (wm.rotateQuarter ?? 0) % 4;
  ctx.save(); // font/shadow/alpha/transform all revert on restore
  try {
    let w: number;
    let h: number;
    let draw: () => void;
    if (wm.mode === "graphic" && wm.graphicDataUrl) {
      // A broken graphic throws here (surfaced by the caller) rather than
      // silently shipping an unwatermarked file.
      const bmp = await createImageBitmap(await (await fetch(wm.graphicDataUrl)).blob());
      ({ width: w, height: h } = graphicBox(cw, ch, bmp.width, bmp.height, wm.sizePct));
      draw = () => ctx.drawImage(bmp, -w / 2, -h / 2, w, h);
    } else {
      const px = fontPx(ch, wm.sizePct);
      ctx.font = watermarkFont(wm, px); // set before measureText so the width matches
      ctx.textBaseline = "top";
      w = ctx.measureText(wm.text).width;
      h = px;
      draw = () => {
        if (wm.shadow ?? true) {
          ctx.shadowColor = "rgba(0,0,0,0.55)";
          ctx.shadowBlur = Math.max(1, px * 0.06);
        }
        ctx.fillStyle = wm.color || "#ffffff";
        ctx.fillText(wm.text, -w / 2, -h / 2);
      };
    }
    // Place the rotated bounding box, then draw rotated about its center.
    const box = rotatedBox(w, h, q);
    const { x, y } = watermarkLayout(cw, ch, box.w, box.h, wm);
    ctx.globalAlpha = Math.min(1, Math.max(0, wm.opacity));
    ctx.translate(x + box.w / 2, y + box.h / 2);
    ctx.rotate((q * Math.PI) / 2);
    draw();
  } finally {
    ctx.restore();
  }
}

/** A named Watermark Editor preset — one list shared by Export, Print, Web and
 *  Slideshow (LR's saved watermarks). Same injectable-storage pattern as
 *  exportPresets: UI-workflow convenience, not catalog data. */
export interface SavedWatermark {
  name: string;
  spec: WatermarkSpecEx;
}

const WM_KEY = "galerie.watermarks";

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function wmStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** All saved watermarks, sorted by name. Missing/malformed storage → []. */
export function listWatermarks(storage: PresetStorage | null = wmStorage()): SavedWatermark[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(WM_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedWatermark[])
      .filter((p) => p && typeof p.name === "string" && p.spec != null)
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // corrupt JSON — behave as if there are no saved watermarks
  }
}

/** Upsert a saved watermark by name (trimmed); returns the updated list. Blank
 *  name or unavailable storage is a no-op that returns the current list. */
export function saveWatermark(
  name: string,
  spec: WatermarkSpecEx,
  storage: PresetStorage | null = wmStorage(),
): SavedWatermark[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listWatermarks(storage);
  const next = listWatermarks(storage).filter((p) => p.name !== trimmed);
  next.push({ name: trimmed, spec });
  next.sort((a, b) => a.name.localeCompare(b.name));
  try {
    storage.setItem(WM_KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
  return next;
}

/** Remove a saved watermark by name; returns the updated list. */
export function deleteWatermark(
  name: string,
  storage: PresetStorage | null = wmStorage(),
): SavedWatermark[] {
  if (!storage) return [];
  const next = listWatermarks(storage).filter((p) => p.name !== name);
  try {
    storage.setItem(WM_KEY, JSON.stringify(next));
  } catch {
    // ignore write failure — next read just returns the prior contents
  }
  return next;
}

/** Encode developed RGBA to a JPEG/PNG blob, scaled to `target`. Output
 *  Sharpening and the watermark (if given) are applied at the final output
 *  size, LR-style — sharpen first, then the watermark on top. `profile` picks
 *  the output color space: sRGB encodes natively (untagged, the universal
 *  default); wider spaces convert + tag through the engine. */
export async function encodeImage(
  rgba: Uint8Array,
  srcW: number,
  srcH: number,
  target: Dims,
  format: "jpeg" | "png",
  quality: number,
  sharpen?: SharpenSpec | null,
  watermark?: WatermarkSpecEx | null,
  profile: ExportColorSpace = "srgb",
): Promise<Blob> {
  const src = new OffscreenCanvas(srcW, srcH);
  const sctx = src.getContext("2d");
  if (!sctx) throw new Error("no 2d context");
  sctx.putImageData(new ImageData(new Uint8ClampedArray(rgba), srcW, srcH), 0, 0);

  let canvas: OffscreenCanvas = src;
  if (target.width !== srcW || target.height !== srcH) {
    const dst = new OffscreenCanvas(target.width, target.height);
    const dctx = dst.getContext("2d");
    if (!dctx) throw new Error("no 2d context");
    dctx.imageSmoothingQuality = "high";
    dctx.drawImage(src, 0, 0, target.width, target.height);
    canvas = dst;
  }

  if (sharpen) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const id = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const sharpened = unsharpMask(id.data, canvas.width, canvas.height, sharpenParams(sharpen));
    ctx.putImageData(new ImageData(new Uint8ClampedArray(sharpened), canvas.width, canvas.height), 0, 0);
  }

  if (watermark && hasWatermarkContent(watermark)) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    await drawWatermark(ctx, canvas.width, canvas.height, watermark);
  }

  // Wide-gamut output leaves the canvas (whose 2d surface is sRGB) and encodes
  // through the engine, which converts sRGB → profile and embeds the profile's
  // ICC — convertToBlob can do neither. Imported dynamically so this module's
  // pure sizing math keeps testing without the wasm engine.
  if (profile !== "srgb") {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    const out = ctx.getImageData(0, 0, canvas.width, canvas.height);
    const { encodeRgbaInProfile } = await import("../engine");
    const bytes = await encodeRgbaInProfile(out.data, canvas.width, canvas.height, profile, format, quality);
    return new Blob([bytes as BlobPart], { type: format === "png" ? "image/png" : "image/jpeg" });
  }
  return canvas.convertToBlob({
    type: format === "png" ? "image/png" : "image/jpeg",
    quality, // ignored by PNG
  });
}
