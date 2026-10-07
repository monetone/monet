import { sampleDisplayLut } from "@monet-ui/monet-color";
import type { BgContents } from "./bgContents";

export type WebExportFormat = "png" | "jpeg" | "gif" | "webp" | "avif";
/** Save for Web's Metadata dropdown, reduced to the scopes Vision's exporters
 *  can honestly honour: "all" hands the document ICC profile to the engine
 *  encoders, "none" forces the canvas encoders, which cannot tag anything. */
export type WebExportMetadata = "none" | "all";
export type WebExportMatte = "transparent" | "white" | "black";
export type Photoshop32BitImport = "auto" | "preserve" | "convert16";
/** Camera Raw's demosaic for mosaic RAWs: "adaptive" is PPG (edge-directed),
 *  "bilinear" the original 3×3 average. Engine codes 1 and 0. */
export type RawDemosaic = "adaptive" | "bilinear";
export const RAW_DEMOSAICS: readonly RawDemosaic[] = ["adaptive", "bilinear"];
/** Bits/channel of the document Camera Raw's Open makes: 32 is float on the Image ▸ Mode ▸ 32 Bits scale,
 *  keeping highlights above white. */
export type RawOpenDepth = 16 | 32;
/** The Demosaic and Depth menus, shared by the Camera Raw workspace and
 *  Preferences ▸ Camera Raw — both edit the same two file-handling prefs. */
export const RAW_DEMOSAIC_OPTIONS = [
  { value: "adaptive", label: "Adaptive (PPG)" },
  { value: "bilinear", label: "Bilinear (fast)" },
];
export const RAW_DEPTH_OPTIONS = [
  { value: "16", label: "16 Bits/Channel" },
  { value: "32", label: "32 Bits/Channel (float)" },
];

export const WEB_EXPORT_FORMATS: readonly WebExportFormat[] = ["png", "jpeg", "gif", "webp", "avif"];

export interface WebExportPrefs {
  format: WebExportFormat;
  quality: number;
  matte: WebExportMatte;
  convertToSRgb: boolean;
  metadata: WebExportMetadata;
}

export interface FileHandlingPrefs {
  openJpegAsLayer: boolean;
  newDocumentBackground: BgContents;
  photoshop32BitImport: Photoshop32BitImport;
  rawDemosaic: RawDemosaic;
  rawDepth: RawOpenDepth;
}

export const DEFAULT_WEB_EXPORT_PREFS: WebExportPrefs = {
  format: "png",
  quality: 85,
  matte: "transparent",
  convertToSRgb: true,
  metadata: "all",
};

export const DEFAULT_FILE_HANDLING_PREFS: FileHandlingPrefs = {
  openJpegAsLayer: false,
  newDocumentBackground: "white",
  photoshop32BitImport: "auto",
  rawDemosaic: "adaptive",
  rawDepth: 16,
};

export function normalizeWebExportPrefs(patch: Partial<WebExportPrefs>, base = DEFAULT_WEB_EXPORT_PREFS): WebExportPrefs {
  const format = WEB_EXPORT_FORMATS.includes(patch.format as WebExportFormat) ? (patch.format as WebExportFormat) : base.format;
  const matte = patch.matte === "white" || patch.matte === "black" || patch.matte === "transparent" ? patch.matte : base.matte;
  const quality = Math.max(1, Math.min(100, Math.round(patch.quality ?? base.quality)));
  return {
    format,
    matte,
    quality,
    convertToSRgb: patch.convertToSRgb ?? base.convertToSRgb,
    metadata: patch.metadata === "none" || patch.metadata === "all" ? patch.metadata : base.metadata,
  };
}

export function normalizeFileHandlingPrefs(patch: Partial<FileHandlingPrefs>, base = DEFAULT_FILE_HANDLING_PREFS): FileHandlingPrefs {
  const bg = patch.newDocumentBackground;
  const photoshop32BitImport = patch.photoshop32BitImport;
  return {
    openJpegAsLayer: patch.openJpegAsLayer ?? base.openJpegAsLayer,
    newDocumentBackground: bg === "white" || bg === "bg" || bg === "transparent" ? bg : base.newDocumentBackground,
    photoshop32BitImport: photoshop32BitImport === "auto" || photoshop32BitImport === "preserve" || photoshop32BitImport === "convert16"
      ? photoshop32BitImport
      : base.photoshop32BitImport,
    rawDemosaic: RAW_DEMOSAICS.includes(patch.rawDemosaic as RawDemosaic) ? patch.rawDemosaic as RawDemosaic : base.rawDemosaic,
    rawDepth: patch.rawDepth === 16 || patch.rawDepth === 32 ? patch.rawDepth : base.rawDepth,
  };
}

/** File ▸ Export As writes the composite through the tagged engine encoders
 *  with the document's own pixels — no matte, no sRGB conversion. Expressed as
 *  a web-export option set so the Export As dialog can preview through the very
 *  encoder that writes the file (`webExportBytes`), which makes its readout the
 *  file size instead of an estimate. Scale is not part of it: the preview and
 *  the size it reports are the 1× encode. */
export function exportAsWebOptions(format: WebExportFormat, quality: number): WebExportPrefs {
  return {
    format,
    // Same clamp `exportAs` applies, so the preview cannot encode at a quality
    // the export would refuse.
    quality: Math.max(1, Math.min(100, Math.round(quality))),
    matte: "transparent",
    convertToSRgb: false,
    metadata: "all",
  };
}

export function webExportFilename(baseName: string, format: WebExportFormat): string {
  const stem = (baseName || "monet-vision").replace(/\.[^.]+$/, "");
  const ext = format === "jpeg" ? "jpg" : format;
  return `${stem}.${ext}`;
}

export function isLayerOpenJpegName(name: string): boolean {
  return /\.(jpe?g)$/i.test(name);
}

/** The grey level Save for Web's Matte composites transparency against, or null
 *  when transparency is kept. */
export function matteLevel(matte: WebExportMatte): number | null {
  return matte === "white" ? 255 : matte === "black" ? 0 : null;
}

/** Save for Web's pixel work, applied in place to straight-alpha RGBA8 (canvas
 *  order). `lut` is the engine's document → sRGB LUT (`display_lut`, n³ RGB u8 —
 *  the same bake the canvas presents with), so "Convert to sRGB" ships pixels
 *  that really are sRGB instead of wide-gamut numbers wearing an sRGB label.
 *  `matte` composites every partially transparent pixel against that grey and
 *  leaves the result opaque, like Photoshop's Matte. Either may be null. */
export function applyWebExportPixels(
  data: Uint8ClampedArray,
  lut: Uint8Array | null,
  lutN: number,
  matte: number | null,
): void {
  if (!lut && matte === null) return;
  for (let i = 0; i < data.length; i += 4) {
    let r = data[i], g = data[i + 1], b = data[i + 2];
    if (lut) [r, g, b] = sampleDisplayLut(lut, lutN, r, g, b);
    if (matte !== null) {
      // Matte is an output-space colour, so it is composited AFTER the sRGB
      // conversion — white must stay exactly white.
      const a = data[i + 3] / 255;
      r = Math.round(r * a + matte * (1 - a));
      g = Math.round(g * a + matte * (1 - a));
      b = Math.round(b * a + matte * (1 - a));
      data[i + 3] = 255;
    }
    data[i] = r; data[i + 1] = g; data[i + 2] = b;
  }
}
