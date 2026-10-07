// ─────────────────────────────────────────────────────────────
// New Document presets — pure preset list + lookups for the New Document dialog.
// Engine-free so it unit-tests in node.
// ─────────────────────────────────────────────────────────────

import type { ColorModeId, RgbProfileId } from "@monet-ui/monet-color";
import { resolveImageSize, toPercent } from "./imageSizeLink";

export const DEFAULT_DOCUMENT_RESOLUTION_PPI = 72;
export const MAX_DOCUMENT_RESOLUTION_PPI = 100_000;
export const MAX_DOCUMENT_DIMENSION_PX = 32_767;
export const MAX_DOCUMENT_PIXELS = 80_000_000;
export const MAX_NEW_DOCUMENT_DIMENSION_PX = 8_192;

export const DOCUMENT_SIZE_UNITS = [
  { value: "px", label: "Pixels", suffix: "px", step: 1 },
  { value: "in", label: "Inches", suffix: "in", step: 0.01 },
  { value: "cm", label: "Centimeters", suffix: "cm", step: 0.01 },
  { value: "mm", label: "Millimeters", suffix: "mm", step: 0.1 },
  { value: "pt", label: "Points", suffix: "pt", step: 0.1 },
  { value: "pc", label: "Picas", suffix: "pc", step: 0.1 },
] as const;

export type DocumentSizeUnit = (typeof DOCUMENT_SIZE_UNITS)[number]["value"];

export interface DocPreset {
  name: string;
  w: number;
  h: number;
  resolutionPpi: number;
  colorMode: ColorModeId;
  colorProfile: RgbProfileId;
  unit: DocumentSizeUnit;
  displayW?: number;
  displayH?: number;
}

/** Sentinel shown in the dropdown when the size matches no preset. */
export const CUSTOM_PRESET = "Custom";

/** Photoshop-like starter presets. */
export const DOC_PRESETS: DocPreset[] = [
  { name: "Default (1280 × 800)", w: 1280, h: 800, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "Web 1920 × 1080", w: 1920, h: 1080, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "Web 1366 × 768", w: 1366, h: 768, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "Square 1080 × 1080", w: 1080, h: 1080, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "Social Portrait 1080 × 1350", w: 1080, h: 1350, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "Social Story 1080 × 1920", w: 1080, h: 1920, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "4K UHD 3840 × 2160", w: 3840, h: 2160, resolutionPpi: 72, colorMode: 0, colorProfile: 0, unit: "px" },
  { name: "A4 CMYK @300 (2480 × 3508)", w: 2480, h: 3508, resolutionPpi: 300, colorMode: 2, colorProfile: 0, unit: "mm", displayW: 210, displayH: 297 },
  { name: "US Letter CMYK @300 (2550 × 3300)", w: 2550, h: 3300, resolutionPpi: 300, colorMode: 2, colorProfile: 0, unit: "in", displayW: 8.5, displayH: 11 },
];

export function normalizeDocumentResolutionPpi(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(MAX_DOCUMENT_RESOLUTION_PPI, Math.max(1, value))
    : DEFAULT_DOCUMENT_RESOLUTION_PPI;
}

export function normalizeDocumentSizeUnit(value: unknown): DocumentSizeUnit {
  return DOCUMENT_SIZE_UNITS.some((unit) => unit.value === value) ? value as DocumentSizeUnit : "px";
}

function pixelsPerUnit(unit: DocumentSizeUnit, resolutionPpi: number): number {
  const ppi = normalizeDocumentResolutionPpi(resolutionPpi);
  switch (unit) {
    case "in": return ppi;
    case "cm": return ppi / 2.54;
    case "mm": return ppi / 25.4;
    case "pt": return ppi / 72;
    case "pc": return ppi / 6;
    default: return 1;
  }
}

/** Convert one signed length without the size/budget clamping used by New Document. */
export function convertDocumentLength(
  value: number,
  from: DocumentSizeUnit,
  to: DocumentSizeUnit,
  resolutionPpi: number,
): number {
  if (!Number.isFinite(value)) return 0;
  return value * pixelsPerUnit(normalizeDocumentSizeUnit(from), resolutionPpi)
    / pixelsPerUnit(normalizeDocumentSizeUnit(to), resolutionPpi);
}

function stepPrecision(step: number): number {
  const decimal = String(step).split(".")[1];
  return decimal?.length ?? 0;
}

/** Decimal places that keep a displayed physical size within half a pixel. */
export function documentSizePrecision(unit: DocumentSizeUnit, resolutionPpi: number): number {
  const normalizedUnit = normalizeDocumentSizeUnit(unit);
  const base = stepPrecision(DOCUMENT_SIZE_UNITS.find((candidate) => candidate.value === normalizedUnit)!.step);
  return Math.max(base, Math.max(0, Math.ceil(Math.log10(pixelsPerUnit(normalizedUnit, resolutionPpi)))));
}

export function documentSizeToPixels(
  w: number,
  h: number,
  unit: DocumentSizeUnit,
  resolutionPpi: number,
  maxDimension = MAX_DOCUMENT_DIMENSION_PX,
  maxPixels = MAX_DOCUMENT_PIXELS,
): { w: number; h: number } {
  const scale = pixelsPerUnit(normalizeDocumentSizeUnit(unit), resolutionPpi);
  const dimension = (value: number) => {
    const pixels = value * scale;
    return Number.isFinite(pixels) ? Math.min(Number.MAX_SAFE_INTEGER, Math.max(1, Math.round(pixels))) : 1;
  };
  let width = dimension(w);
  let height = dimension(h);
  const dimensionBudget = Number.isFinite(maxDimension) ? Math.max(1, Math.floor(maxDimension)) : MAX_DOCUMENT_DIMENSION_PX;
  const pixelBudget = Number.isFinite(maxPixels) ? Math.max(1, Math.floor(maxPixels)) : MAX_DOCUMENT_PIXELS;
  const fit = Math.min(1, dimensionBudget / width, dimensionBudget / height, Math.sqrt(pixelBudget / (width * height)));
  if (fit < 1) {
    width = Math.max(1, Math.round(width * fit));
    height = Math.max(1, Math.round(height * fit));
    if (width * height > pixelBudget) {
      if (width >= height) width = Math.max(1, Math.floor(pixelBudget / height));
      else height = Math.max(1, Math.floor(pixelBudget / width));
    }
  }
  return { w: width, h: height };
}

export function documentSizeFromPixels(w: number, h: number, unit: DocumentSizeUnit, resolutionPpi: number): { w: number; h: number } {
  const scale = pixelsPerUnit(normalizeDocumentSizeUnit(unit), resolutionPpi);
  const dimension = (value: number) => (Number.isFinite(value) ? Math.max(1, value) : 1) / scale;
  return { w: dimension(w), h: dimension(h) };
}

export function presetDisplaySize(preset: DocPreset): { w: number; h: number } {
  if (preset.displayW !== undefined && preset.displayH !== undefined) return { w: preset.displayW, h: preset.displayH };
  return documentSizeFromPixels(preset.w, preset.h, preset.unit, preset.resolutionPpi);
}

// ── Preferences ▸ Units & Rulers ──────────────────────────────
// The unit the size dialogs (New Document, Image Size, Canvas Size) open in.
// It is an application preference rather than document state, so it persists
// beside the store's other `mv.*` keys instead of in the snapshot.
const RULER_UNIT_KEY = "mv.rulerUnit";

/** The saved default size unit — "px" when unset or storage is unavailable. */
export function loadRulerUnit(): DocumentSizeUnit {
  try {
    return normalizeDocumentSizeUnit(localStorage.getItem(RULER_UNIT_KEY));
  } catch {
    return "px"; // storage may be unavailable (node, private mode)
  }
}

/** Persist the default size unit and echo back the normalized value.
 *  ponytail: localStorage only — lift it into the store snapshot when the
 *  on-canvas rulers and the Info panel need to react to it. */
export function saveRulerUnit(unit: unknown): DocumentSizeUnit {
  const next = normalizeDocumentSizeUnit(unit);
  try {
    if (next === "px") localStorage.removeItem(RULER_UNIT_KEY);
    else localStorage.setItem(RULER_UNIT_KEY, next);
  } catch { /* storage may be unavailable */ }
  return next;
}

// ── Image Size units ──────────────────────────────────────────
// Photoshop's Image Size offers the physical units plus Percent (relative to
// the dimension the dialog opened on), so it gets its own unit list.

export type ImageSizeUnit = DocumentSizeUnit | "percent";

export const IMAGE_SIZE_UNITS: { value: ImageSizeUnit; label: string; suffix: string; step: number }[] = [
  ...DOCUMENT_SIZE_UNITS,
  { value: "percent", label: "Percent", suffix: "%", step: 1 },
];

/** An Image Size field value in `unit` as absolute pixels (>= 1). */
export function imageSizeToPixels(value: number, unit: ImageSizeUnit, originalPx: number, resolutionPpi: number): number {
  if (unit === "percent") return resolveImageSize(value, "percent", originalPx);
  return Math.max(1, Math.round(convertDocumentLength(value, unit, "px", resolutionPpi)));
}

/** A pixel dimension expressed in `unit`, for display in the Image Size fields. */
export function imageSizeFromPixels(px: number, unit: ImageSizeUnit, originalPx: number, resolutionPpi: number): number {
  if (unit === "percent") return toPercent(px, originalPx);
  return convertDocumentLength(px, "px", unit, resolutionPpi);
}

/** The preset with the given name, or undefined. */
export function presetByName(name: string): DocPreset | undefined {
  return DOC_PRESETS.find((p) => p.name === name);
}

/** The preset whose document settings exactly match, or undefined (→ Custom). */
export function presetForSettings(w: number, h: number, resolutionPpi: number, colorMode: number, colorProfile: number, unit: DocumentSizeUnit): DocPreset | undefined {
  return DOC_PRESETS.find((p) => p.w === w && p.h === h && p.resolutionPpi === resolutionPpi && p.colorMode === colorMode && p.colorProfile === colorProfile && p.unit === unit);
}
