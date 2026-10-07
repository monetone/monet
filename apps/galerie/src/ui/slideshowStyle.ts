// slideshowStyle — the Slideshow module's saved look: LR's Options (Zoom to
// Fill Frame, Stroke Border, Cast Shadow), Layout (margins + guides), Overlays
// (Identity Plate, Watermarking, Rating Stars, a metadata text overlay),
// Backdrop (Background Color, Color Wash, Background Image) and Titles
// (Intro/Ending), plus the Playback values the overlay used to forget on every
// open. One localStorage record, same idiom as gridViewOptions/loupeInfoOptions:
// the overlay is the only writer, the module cache keeps the per-frame reads
// free. Named records of the whole thing are LR's Template Browser.

import type { CSSProperties } from "react";

import type { PhotoRow } from "../catalog/types";
import type { WatermarkSpecEx } from "../lib/exportImage";
import type { PresetStorage } from "../lib/exportPresets";
import { DEFAULT_SLIDESHOW_OPTIONS, type SlideshowOptions } from "../lib/slideshow";
import { metadataRows } from "./MetadataOverlay";
import type { KenBurnsMode, VideoPreset } from "./slideshowExport";

/** Playback (lib/slideshow's playlist contract) + the presentation panels. */
export interface SlideshowSettings extends SlideshowOptions {
  /** Playback ▸ Crossfade, in ms (0 = hard cut). */
  crossfadeMs: number;
  /** Playback ▸ Pan and Zoom. */
  panZoom: KenBurnsMode;
  /** Export Video preset. */
  videoPreset: VideoPreset;
  /** Options ▸ Zoom to Fill Frame — cover-crop instead of letterbox. */
  zoomToFill: boolean;
  /** Options ▸ Stroke Border. */
  strokeBorder: boolean;
  strokeColor: string;
  strokeWidth: number;
  /** Options ▸ Cast Shadow. */
  castShadow: boolean;
  /** Backdrop ▸ Background Color. */
  backdropColor: string;
  /** Backdrop ▸ Color Wash — a radial wash over the background color. */
  colorWash: boolean;
  colorWashColor: string;
  /** Backdrop ▸ Background Image — the current slide, blurred behind itself. */
  backdropImage: boolean;
  /** 0–1 opacity of the background image. */
  backdropImageOpacity: number;
  /** Layout ▸ margins, in px, applied to every edge of the slide cell. */
  margin: number;
  /** Layout ▸ Show Guides — draw the cell rectangle. */
  showGuides: boolean;
  /** Overlays ▸ Identity Plate text ("" = off). */
  identityPlate: string;
  /** Overlays ▸ Rating Stars. */
  ratingStars: boolean;
  /** Overlays ▸ text overlay template, metadata tokens per `overlayText` ("" = off). */
  textOverlay: string;
  /** Text overlay size in px. */
  textOverlaySize: number;
  /** Overlays ▸ Watermarking: the saved watermark's name ("" = none). */
  watermarkName: string;
  /** Titles ▸ Intro Screen text ("" = off). */
  introText: string;
  /** Titles ▸ Ending Screen text ("" = off). */
  endingText: string;
  /** Playback ▸ Fit to Music — derive the slide length from the track. */
  fitToMusic: boolean;
}

export const DEFAULT_SLIDESHOW_SETTINGS: SlideshowSettings = {
  ...DEFAULT_SLIDESHOW_OPTIONS,
  crossfadeMs: 1000,
  panZoom: "off",
  videoPreset: "1080p",
  zoomToFill: false,
  strokeBorder: false,
  strokeColor: "#ffffff",
  strokeWidth: 4,
  castShadow: false,
  backdropColor: "#000000",
  colorWash: false,
  colorWashColor: "#3a3a3a",
  backdropImage: false,
  backdropImageOpacity: 0.3,
  margin: 0,
  showGuides: false,
  identityPlate: "",
  ratingStars: false,
  textOverlay: "",
  textOverlaySize: 14,
  watermarkName: "",
  introText: "",
  endingText: "",
  fitToMusic: false,
};

const KEY = "galerie.slideshowSettings";

const KEN_BURNS: readonly KenBurnsMode[] = ["off", "low", "high"];
const VIDEO_PRESET_NAMES: readonly VideoPreset[] = ["480p", "720p", "1080p"];
const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;

function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const num = (v: unknown, lo: number, hi: number, fallback: number) =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : fallback;
/** Colours land in inline CSS, so only literal hex is accepted. */
const hex = (v: unknown, fallback: string) => (typeof v === "string" && HEX.test(v) ? v : fallback);
const oneOf = <T extends string>(v: unknown, allowed: readonly T[], fallback: T) =>
  allowed.includes(v as T) ? (v as T) : fallback;
/** Capped so an overgrown record can't paper the slide over. */
const text = (v: unknown, cap: number, fallback: string) =>
  typeof v === "string" ? v.slice(0, cap) : fallback;

/** Clamp/whitelist every field. Storage is user-editable, and these values go
 *  straight into CSS and the video encoder — a bad record yields defaults, not
 *  a broken slideshow. */
export function sanitizeSlideshowSettings(raw: unknown): SlideshowSettings {
  const d = DEFAULT_SLIDESHOW_SETTINGS;
  const r = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  return {
    durationMs: num(r.durationMs, 500, 60_000, d.durationMs),
    random: bool(r.random, d.random),
    repeat: bool(r.repeat, d.repeat),
    manual: bool(r.manual, d.manual),
    crossfadeMs: num(r.crossfadeMs, 0, 10_000, d.crossfadeMs),
    panZoom: oneOf(r.panZoom, KEN_BURNS, d.panZoom),
    videoPreset: oneOf(r.videoPreset, VIDEO_PRESET_NAMES, d.videoPreset),
    zoomToFill: bool(r.zoomToFill, d.zoomToFill),
    strokeBorder: bool(r.strokeBorder, d.strokeBorder),
    strokeColor: hex(r.strokeColor, d.strokeColor),
    strokeWidth: Math.round(num(r.strokeWidth, 0, 40, d.strokeWidth)),
    castShadow: bool(r.castShadow, d.castShadow),
    backdropColor: hex(r.backdropColor, d.backdropColor),
    colorWash: bool(r.colorWash, d.colorWash),
    colorWashColor: hex(r.colorWashColor, d.colorWashColor),
    backdropImage: bool(r.backdropImage, d.backdropImage),
    backdropImageOpacity: num(r.backdropImageOpacity, 0, 1, d.backdropImageOpacity),
    margin: Math.round(num(r.margin, 0, 400, d.margin)),
    showGuides: bool(r.showGuides, d.showGuides),
    identityPlate: text(r.identityPlate, 120, d.identityPlate),
    ratingStars: bool(r.ratingStars, d.ratingStars),
    textOverlay: text(r.textOverlay, 200, d.textOverlay),
    textOverlaySize: Math.round(num(r.textOverlaySize, 8, 72, d.textOverlaySize)),
    watermarkName: text(r.watermarkName, 80, d.watermarkName),
    introText: text(r.introText, 120, d.introText),
    endingText: text(r.endingText, 120, d.endingText),
    fitToMusic: bool(r.fitToMusic, d.fitToMusic),
  };
}

let cache: SlideshowSettings | null = null;

/** The saved slideshow settings (defaults fill gaps; corrupt storage yields
 *  defaults). Cached — the overlay reads them on every slide. */
export function slideshowSettings(storage: PresetStorage | null = defaultStorage()): SlideshowSettings {
  if (cache) return cache;
  let raw: unknown = null;
  try {
    const stored = storage?.getItem(KEY);
    if (stored) raw = JSON.parse(stored);
  } catch {
    raw = null;
  }
  cache = sanitizeSlideshowSettings(raw);
  return cache;
}

/** Persist and refresh the cache. Returns the sanitized record the caller
 *  should hold, so the UI can never drift from what was stored. */
export function saveSlideshowSettings(
  next: SlideshowSettings,
  storage: PresetStorage | null = defaultStorage(),
): SlideshowSettings {
  const clean = sanitizeSlideshowSettings(next);
  try {
    storage?.setItem(KEY, JSON.stringify(clean));
  } catch {
    // Storage blocked or full — the session keeps the value, it just won't survive.
  }
  cache = clean;
  return clean;
}

/** Test seam: drop the module cache so the next read hits storage. */
export function resetSlideshowSettingsCache(): void {
  cache = null;
}

// ─── Presentation ────────────────────────────────────────────────────

/** Backdrop panel → the fullscreen layer's background. Color Wash is LR's
 *  radial gradient sitting over the background colour. */
export function backdropCss(s: SlideshowSettings): CSSProperties {
  return {
    background: s.colorWash
      ? `radial-gradient(circle at 50% 35%, ${s.colorWashColor}, ${s.backdropColor} 70%)`
      : s.backdropColor,
  };
}

/** Options panel → the slide image. Zoom to Fill claims the whole frame and
 *  crops; otherwise the image keeps LR's letterboxed contain fit. */
export function slideImageCss(s: SlideshowSettings): CSSProperties {
  const css: CSSProperties = s.zoomToFill
    ? { height: "100%", objectFit: "cover", width: "100%" }
    : { objectFit: "contain" };
  if (s.strokeBorder && s.strokeWidth > 0) {
    css.border = `${s.strokeWidth}px solid ${s.strokeColor}`;
    css.boxSizing = "border-box"; // keep the stroke inside the 100% frame
  }
  // ponytail: fixed drop shadow — LR's Cast Shadow has opacity/offset/radius/
  // angle; grow these into fields if anyone asks for the full control set.
  if (s.castShadow) css.boxShadow = "0 12px 32px rgba(0, 0, 0, 0.65)";
  return css;
}

/** Overlays ▸ Rating Stars, LR-style: filled stars only, nothing at 0. */
export const ratingStars = (rating: number): string =>
  "★".repeat(Math.max(0, Math.min(5, Math.round(rating || 0))));

/** Layout panel → the slide cell. LR gives each edge its own margin; one value
 *  drives all four here. ponytail: split into four fields when someone needs an
 *  off-centre cell — every consumer already goes through this helper. */
export const slideFrameCss = (s: SlideshowSettings): CSSProperties => ({ inset: s.margin });

/** Layout ▸ Show Guides — the cell rectangle, drawn over the backdrop and under
 *  the slide so a margin change is visible while it is being dragged. */
export const guideCss = (s: SlideshowSettings): CSSProperties => ({
  border: "1px dashed rgba(255, 255, 255, 0.35)",
  inset: s.margin,
  pointerEvents: "none",
  position: "absolute",
});

/** Backdrop ▸ Background Image. ponytail: the image is the current slide,
 *  blurred behind itself — LR lets you drag a specific photo onto the panel.
 *  Take a PhotoRow id here (and render that preview) if anyone asks. */
export const backdropImageCss = (s: SlideshowSettings): CSSProperties => ({
  filter: "blur(32px)",
  height: "100%",
  objectFit: "cover",
  opacity: s.backdropImageOpacity,
  transform: "scale(1.1)", // hide the blur's transparent edges
  width: "100%",
});

/** Overlays ▸ text overlay: metadata tokens are the Loupe Info field names,
 *  lowercased and spaceless — `{file}` `{camera}` `{aperture}` `{shutter}`
 *  `{iso}` `{captured}` `{gps}` `{dimensions}` `{focal}` `{lens}`, plus
 *  `{rating}`. Absent values render empty; unknown tokens stay literal so a
 *  typo is visible (same contract as renderFilenameTemplate). */
export function overlayText(photo: PhotoRow, template: string): string {
  const values = new Map(
    metadataRows(photo).map(([label, value]) => [label.toLowerCase().replace(/\s+/g, ""), value]),
  );
  values.set("rating", ratingStars(photo.rating));
  return template.replace(/\{(\w+)\}/g, (whole, token: string) => {
    const hit = values.get(token.toLowerCase());
    return hit === undefined ? whole : (hit ?? "");
  });
}

/** Overlays ▸ Watermarking: the saved watermark from the shared store, placed
 *  live. The export path draws the same spec into the pixels; here sizePct /
 *  insetPct are percentages of the frame, which map straight onto vh/vmin.
 *  Returns the anchoring layer's style. */
export function watermarkBoxCss(spec: WatermarkSpecEx): CSSProperties {
  const pick = (lo: string, hi: string) =>
    spec.anchor.includes(lo) ? "flex-start" : spec.anchor.includes(hi) ? "flex-end" : "center";
  return {
    alignItems: pick("top", "bottom"),
    display: "flex",
    inset: 0,
    justifyContent: pick("left", "right"),
    padding: `${Math.max(0, spec.insetPct)}vmin`,
    pointerEvents: "none",
    position: "absolute",
  };
}

/** The watermark's own text style. Colour/font come from the saved spec and are
 *  assigned as style properties, so an invalid value is dropped by the CSSOM
 *  rather than reaching the stylesheet. */
export function watermarkTextCss(spec: WatermarkSpecEx): CSSProperties {
  const quarter = spec.rotateQuarter ?? 0;
  return {
    color: spec.color || "#ffffff",
    fontFamily: spec.font || "sans-serif",
    fontSize: `${Math.max(0.5, spec.sizePct)}vh`,
    fontStyle: spec.italic ? "italic" : undefined,
    fontWeight: spec.bold ? 700 : undefined,
    opacity: Math.min(1, Math.max(0, spec.opacity)),
    textShadow: spec.shadow === false ? undefined : "0 1px 3px rgba(0, 0, 0, 0.8)",
    transform: quarter ? `rotate(${quarter * 90}deg)` : undefined,
    whiteSpace: "pre",
  };
}

// ─── Template Browser ────────────────────────────────────────────────

/** A named settings record — LR's Slideshow templates. Same injectable-storage
 *  idiom as exportPresets/saved watermarks: UI workflow, not catalog data. */
export interface SlideshowTemplate {
  name: string;
  settings: SlideshowSettings;
}

const TEMPLATE_KEY = "galerie.slideshowTemplates";

/** All saved templates, sorted by name; every record sanitised on the way out
 *  (they land in inline CSS exactly like the live settings). */
export function listSlideshowTemplates(
  storage: PresetStorage | null = defaultStorage(),
): SlideshowTemplate[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(TEMPLATE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as { name?: unknown; settings?: unknown }[])
      .filter((t) => t && typeof t.name === "string" && t.name !== "")
      .map((t) => ({ name: t.name as string, settings: sanitizeSlideshowSettings(t.settings) }))
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return []; // corrupt JSON — behave as if there are no templates
  }
}

function writeTemplates(list: SlideshowTemplate[], storage: PresetStorage | null): SlideshowTemplate[] {
  try {
    storage?.setItem(TEMPLATE_KEY, JSON.stringify(list));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
  return list;
}

/** Upsert a template by name (trimmed). Blank name or no storage is a no-op. */
export function saveSlideshowTemplate(
  name: string,
  settings: SlideshowSettings,
  storage: PresetStorage | null = defaultStorage(),
): SlideshowTemplate[] {
  const trimmed = name.trim().slice(0, 80);
  if (!trimmed || !storage) return listSlideshowTemplates(storage);
  const next = listSlideshowTemplates(storage).filter((t) => t.name !== trimmed);
  next.push({ name: trimmed, settings: sanitizeSlideshowSettings(settings) });
  next.sort((a, b) => a.name.localeCompare(b.name));
  return writeTemplates(next, storage);
}

/** Remove a template by name; returns the updated list. */
export function deleteSlideshowTemplate(
  name: string,
  storage: PresetStorage | null = defaultStorage(),
): SlideshowTemplate[] {
  if (!storage) return [];
  return writeTemplates(
    listSlideshowTemplates(storage).filter((t) => t.name !== name),
    storage,
  );
}
