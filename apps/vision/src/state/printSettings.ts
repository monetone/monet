// File ▸ Print… settings (#440): where the image lands on the media, how big it
// prints, and who manages its colours. Pure and engine-free so the layout math
// and persistence unit-test in node. Print One Copy reuses whatever the dialog
// last saved.

import {
  iccProofSimulationMap, lutSizeFor, proofLutSizeFor, sampleDisplayLut, sampleProofLut, ICC_MAX_BYTES,
  RENDERING_INTENTS, type RenderingIntentId,
} from "@monet-ui/monet-color";
import { bool, num } from "./imageDialogPrefs";
import { bytesToBase64, decodeBase64WithinLimit } from "./projectEnvelope";

/** Media sizes in inches, portrait. */
export const PRINT_MEDIA = [
  { id: "letter", label: "US Letter", w: 8.5, h: 11 },
  { id: "legal", label: "US Legal", w: 8.5, h: 14 },
  { id: "tabloid", label: "Tabloid", w: 11, h: 17 },
  { id: "a3", label: "A3", w: 297 / 25.4, h: 420 / 25.4 },
  { id: "a4", label: "A4", w: 210 / 25.4, h: 297 / 25.4 },
  { id: "a5", label: "A5", w: 148 / 25.4, h: 210 / 25.4 },
  { id: "4x6", label: "4 × 6 in", w: 4, h: 6 },
  { id: "5x7", label: "5 × 7 in", w: 5, h: 7 },
  { id: "8x10", label: "8 × 10 in", w: 8, h: 10 },
] as const;
export type PrintMediaId = (typeof PRINT_MEDIA)[number]["id"];

export const PRINT_SCALE_MIN = 1;
export const PRINT_SCALE_MAX = 1000;
/** Top/Left offsets are kept within this many inches of the page. */
const PRINT_OFFSET_MAX = 100;

export interface PrintSettings {
  media: PrintMediaId;
  landscape: boolean;
  /** Center; otherwise `top`/`left` place it, in inches from the page edge. */
  center: boolean;
  top: number;
  left: number;
  /** Scale to Fit Media; otherwise `scale` percent of the document's print size. */
  fit: boolean;
  scale: number;
  /** Photoshop Manages Colors converts through the printer profile before
   *  spooling; Printer Manages Colors sends the document's own tagged pixels. */
  colorHandling: "photoshop" | "printer";
  /** "cmyk": the bundled working press profile; "icc": the loaded one below. */
  profile: "cmyk" | "icc";
  profileName: string;
  /** The loaded printer profile, base64 ("" when none is loaded). */
  profileIcc: string;
  intent: RenderingIntentId;
  bpc: boolean;
  matchPrintColors: boolean;
  showPaperWhite: boolean;
}

// Printer Manages Colors and Scale to Fit Media, so a first print (and Print One
// Copy before the dialog was ever opened) spools the pixels the dialog-less
// print did: the document's own, fit to the media and never clipped by it.
// Not the same page, though: that print fit whatever paper the OS dialog chose
// and only ever shrank; this one lays out for US Letter and also enlarges.
// Whether the default should follow the printer's paper is an open #440 call.
export const PRINT_DEFAULTS: PrintSettings = {
  media: "letter", landscape: false, center: true, top: 0, left: 0, fit: true, scale: 100,
  colorHandling: "printer", profile: "cmyk", profileName: "", profileIcc: "",
  intent: 1, bpc: true, matchPrintColors: false, showPaperWhite: false,
};

export function normalizePrintSettings(raw: unknown): PrintSettings {
  const r = (raw ?? {}) as Record<string, unknown>;
  const d = PRINT_DEFAULTS;
  const icc = typeof r.profileIcc === "string" && decodeProfileIcc(r.profileIcc) ? r.profileIcc : "";
  return {
    media: PRINT_MEDIA.find((m) => m.id === r.media)?.id ?? d.media,
    landscape: bool(r.landscape, d.landscape),
    center: bool(r.center, d.center),
    top: num(r.top, -PRINT_OFFSET_MAX, PRINT_OFFSET_MAX, d.top),
    left: num(r.left, -PRINT_OFFSET_MAX, PRINT_OFFSET_MAX, d.left),
    fit: bool(r.fit, d.fit),
    scale: num(r.scale, PRINT_SCALE_MIN, PRINT_SCALE_MAX, d.scale),
    colorHandling: r.colorHandling === "photoshop" ? "photoshop" : "printer",
    // A loaded profile whose bytes did not survive stays chosen, so printing
    // asks for it again instead of quietly using another profile.
    profile: r.profile === "icc" ? "icc" : "cmyk",
    profileName: typeof r.profileName === "string" ? r.profileName.slice(0, 256) : "",
    profileIcc: icc,
    intent: RENDERING_INTENTS.find((i) => i.id === r.intent)?.id ?? d.intent,
    bpc: bool(r.bpc, d.bpc),
    matchPrintColors: bool(r.matchPrintColors, d.matchPrintColors),
    showPaperWhite: bool(r.showPaperWhite, d.showPaperWhite),
  };
}

export const encodeProfileIcc = bytesToBase64;
/** The loaded printer profile's bytes; null when there are none or they are corrupt. */
export function decodeProfileIcc(encoded: string): Uint8Array | null {
  try {
    const bytes = encoded ? decodeBase64WithinLimit(encoded, ICC_MAX_BYTES, "Printer profile") : null;
    return bytes?.length ? bytes : null;
  } catch { return null; }
}

const PRINT_SETTINGS_KEY = "mv.print";

export function loadPrintSettings(): PrintSettings {
  try {
    return normalizePrintSettings(JSON.parse(localStorage.getItem(PRINT_SETTINGS_KEY) ?? "null"));
  } catch { return normalizePrintSettings(null); }
}

export function savePrintSettings(settings: PrintSettings) {
  const next = normalizePrintSettings(settings);
  try {
    localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify(next));
  } catch {
    // A loaded printer profile can outgrow the storage quota; keep everything
    // else, and the next print asks for the profile again.
    try { localStorage.setItem(PRINT_SETTINGS_KEY, JSON.stringify({ ...next, profileIcc: "" })); } catch { /* storage denied */ }
  }
}

/** Everything in inches, on the page's own axes. */
export interface PrintLayout {
  pageWidth: number;
  pageHeight: number;
  left: number;
  top: number;
  width: number;
  height: number;
  /** Percent of the document's print size (its pixels at its ppi). */
  scale: number;
  /** Print Resolution: document pixels per printed inch. */
  ppi: number;
}

export function printLayout(settings: PrintSettings, docWidth: number, docHeight: number, docPpi: number): PrintLayout {
  const media = PRINT_MEDIA.find((m) => m.id === settings.media) ?? PRINT_MEDIA[0];
  const [pageWidth, pageHeight] = settings.landscape ? [media.h, media.w] : [media.w, media.h];
  const naturalWidth = docWidth / docPpi, naturalHeight = docHeight / docPpi;
  const scale = settings.fit ? Math.min(pageWidth / naturalWidth, pageHeight / naturalHeight) * 100 : settings.scale;
  const width = naturalWidth * scale / 100, height = naturalHeight * scale / 100;
  return {
    pageWidth, pageHeight, width, height, scale,
    left: settings.center ? (pageWidth - width) / 2 : settings.left,
    top: settings.center ? (pageHeight - height) / 2 : settings.top,
    ppi: docPpi * 100 / scale,
  };
}

/** Why these settings cannot print, as something the user can fix; null when they can. */
export function printSettingsError(settings: PrintSettings, layout: PrintLayout): string | null {
  if (!settings.fit && !(settings.scale >= PRINT_SCALE_MIN && settings.scale <= PRINT_SCALE_MAX)) {
    return `Scale must be between ${PRINT_SCALE_MIN}% and ${PRINT_SCALE_MAX}%, or check Scale to Fit Media.`;
  }
  if (!settings.center && !(Math.abs(settings.top) <= PRINT_OFFSET_MAX && Math.abs(settings.left) <= PRINT_OFFSET_MAX)) {
    return `Top and Left must be within ${PRINT_OFFSET_MAX} inches of the page edge, or check Center.`;
  }
  if (layout.left >= layout.pageWidth || layout.top >= layout.pageHeight
    || layout.left + layout.width <= 0 || layout.top + layout.height <= 0) {
    return "The image lies entirely off the page. Change Top and Left, or check Center.";
  }
  if (settings.colorHandling === "photoshop" && settings.profile === "icc" && !decodeProfileIcc(settings.profileIcc)) {
    return `Load the printer profile${settings.profileName ? ` “${settings.profileName}”` : ""} again (Printer Profile ▸ Load Profile…), or choose Printer Manages Colors.`;
  }
  return null;
}

/** Whether part of the image falls outside the page and will not print. */
export function printLayoutClips(layout: PrintLayout): boolean {
  const slack = 1e-6;
  return layout.left < -slack || layout.top < -slack
    || layout.left + layout.width > layout.pageWidth + slack || layout.top + layout.height > layout.pageHeight + slack;
}

const inches = (v: number) => `${+v.toFixed(4)}in`;

/** The print document's CSS: the media as the page, the image at its print size and position. */
export function printPageCss(layout: PrintLayout): string {
  return `@page{size:${inches(layout.pageWidth)} ${inches(layout.pageHeight)};margin:0}` +
    "html,body{margin:0;padding:0;background:#fff}" +
    `body{position:relative;overflow:hidden;width:${inches(layout.pageWidth)};height:${inches(layout.pageHeight)}}` +
    `img{position:absolute;display:block;left:${inches(layout.left)};top:${inches(layout.top)};` +
    `width:${inches(layout.width)};height:${inches(layout.height)}}`;
}

/** The preview's pixels through the engine's display LUT (document → screen),
 *  or under Match Print Colors its View ▸ Proof Colors LUT through the printer
 *  profile, with Show Paper White remapped exactly as the canvas soft proof does. */
export function printPreviewPixels(rgba: Uint8ClampedArray, lut: Uint8Array, proof: boolean, paperWhite: boolean): Uint8ClampedArray<ArrayBuffer> {
  const out = new Uint8ClampedArray(rgba);
  const n = (proof ? proofLutSizeFor : lutSizeFor)(lut);
  if (!n) return out;
  const sim = proof ? iccProofSimulationMap([lut[0], lut[1], lut[2]], { simulatePaperColor: paperWhite }) : null;
  for (let i = 0; i < out.length; i += 4) {
    const px = (proof ? sampleProofLut : sampleDisplayLut)(lut, n, rgba[i], rgba[i + 1], rgba[i + 2]);
    for (let c = 0; c < 3; c++) out[i + c] = sim ? px[c] * sim.scale[c] + sim.offset[c] : px[c];
  }
  return out;
}
