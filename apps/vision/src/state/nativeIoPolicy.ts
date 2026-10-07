// Pure native file-save policy, plus the pure half of Vision's universal-
// container IO (design doc 11). The Tauri dialog/fs calls and the WASM
// container reader/writer live in app.ts; this module keeps the data-loss
// guards testable without mocking native dialogs or instantiating WASM.

import type { ContainerManifest, MonetContainer } from "@monet-ui/monet-format";
import { LAYER_KIND } from "./engineContracts";

/** Vision's row of the container registry: a v1 container of `graphics.json`
 *  + `pixels/*`. Stamped into every manifest Vision writes ("who wrote it last"). */
export const VISION_CONTAINER_EXT = "mvis";
export const VISION_CONTAINER_APP = { name: "monet-vision", version: "0.1.0" } as const;

/** The entry roles Vision consumes — what the shared engine's graphics
 *  container writer emits. Every other role is couriered, never read. */
/** Vision's own entry: the document metadata that lives outside the engine
 *  (saved paths, notes, layer comps, brush tips, scale, ICC, Camera Raw). The
 *  container format treats an unknown role as data to courier, so another app
 *  round-trips it untouched — and listing it here means Vision REPLACES its own
 *  on save rather than stacking a stale copy beside the fresh one (#493). */
export const VISION_DOCUMENT_ROLE = "vision-document";
export const VISION_DOCUMENT_ENTRY_PATH = "vision/document.json";

export const VISION_CONTAINER_ROLES = new Set(["graphics", "pixels", "masks", "channels", VISION_DOCUMENT_ROLE]);

/**
 * Design doc 11 rule 2 (courier), the save side. `fresh` is the container this
 * document's engine just wrote (graphics + pixel/mask/channel blobs); `source`
 * is the container the document was OPENED from, or null when Vision created it.
 * Every entry and every manifest field Vision did not consume rides through
 * unchanged, so a round trip through Vision never destroys another app's work.
 *
 * A foreign entry whose path collides with one of ours loses the path (a zip
 * with two entries at one path fails closed on the next read) — that can only
 * happen under a role Vision owns, which is by definition ours to rewrite.
 */
export function courierContainerSave(source: MonetContainer | null, fresh: MonetContainer): MonetContainer {
  const app = VISION_CONTAINER_APP;
  if (!source) return { manifest: { ...fresh.manifest, app }, entries: fresh.entries };
  const replaced = new Set(fresh.manifest.entries.map((e) => e.path));
  for (const e of source.manifest.entries) if (VISION_CONTAINER_ROLES.has(e.role)) replaced.add(e.path);
  const keep = (e: { path: string }) => !replaced.has(e.path);
  return {
    manifest: {
      ...source.manifest, // format, schemaVersion, kind + unknown fields, verbatim
      app, // who wrote it last
      entries: [...source.manifest.entries.filter(keep), ...fresh.manifest.entries],
    },
    entries: [...source.entries.filter(keep), ...fresh.entries],
  };
}

/** The entry paths Vision does not open — design doc 11 rule 1's visible report. */
export function ignoredContainerEntries(manifest: ContainerManifest): string[] {
  return manifest.entries.filter((e) => !VISION_CONTAINER_ROLES.has(e.role)).map((e) => e.path);
}

export const IN_PLACE_EXTENSIONS = new Set(["mvision", VISION_CONTAINER_EXT, "png", "jpg", "jpeg", "gif"]);
/** Single-composite formats Save As can write. Everything past the in-place four
 *  is offered as a destination but never overwritten in place: Vision cannot
 *  re-open a .pdf/.exr as the layered document it came from, so ⌘S on one
 *  routes through Save As instead of silently flattening the file it opened.
 *  A .tif written with Save layers does reopen layered, but through the same
 *  PSD layer serializer as .psd/.psb, which does not round-trip every layer
 *  feature — so, like them, a layered .tif stays an export copy. */
export const FLAT_SAVE_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "tif", "tiff", "webp", "hdr", "exr", "tga", "pdf",
  // JPEG 2000 (.jpf is written JP2-compatible, .j2k as a bare codestream) and
  // headerless Photoshop Raw (#466).
  "jp2", "jpf", "j2k", "raw",
]);
export const RAW_EXTENSIONS = new Set([
  "cr2", "cr3", "nef", "arw", "dng", "raf", "rw2", "orf", "pef", "srw", "raw", "nrw", "mrw", "dcr",
]);
export const SUPPORTED_SAVE_EXTENSIONS = new Set([...IN_PLACE_EXTENSIONS, ...FLAT_SAVE_EXTENSIONS, "psd", "psb"]);

export const extOf = (p: string): string => (p.match(/\.([^.\\/]+)$/)?.[1] ?? "").toLowerCase();

/** Strict allow-list for extensions accepted by the Save/Save As encoder. */
export function isSupportedSaveExtension(ext: string): boolean {
  return SUPPORTED_SAVE_EXTENSIONS.has(ext.toLowerCase());
}

/** Formats that hold the document's full editable state: the `.mvision`
 *  envelope (smart links, Camera Raw provenance) and the `.mvis` container. */
export function isProjectSaveExtension(ext: string): boolean {
  const normalized = ext.toLowerCase();
  return normalized === "mvision" || normalized === VISION_CONTAINER_EXT;
}

export function canSaveInPlace(isNative: boolean, path: string | null | undefined, documentIsFlat: boolean): boolean {
  if (!isNative || !path) return false;
  const ext = extOf(path);
  return IN_PLACE_EXTENSIONS.has(ext) && (isProjectSaveExtension(ext) || documentIsFlat);
}

/** Formats that can be written but cannot currently preserve the document's
 * editable state. Writing one is an export copy, never a successful project
 * save. PSD/PSB remain here until their writer round-trips every supported layer. */
export function saveAsIsCopy(ext: string, documentIsFlat: boolean): boolean {
  const normalized = ext.toLowerCase();
  return normalized === "psd" || normalized === "psb"
    || (!documentIsFlat && FLAT_SAVE_EXTENSIONS.has(normalized));
}

/** The one layer a flat raster format can hold exactly. Collected from the
 *  engine by the save path; this module stays engine-free so the rules test
 *  without WASM. */
export interface FlatLayerFacts {
  kind: number;
  visible: boolean;
  blend: number;
  opacity: number;
  fill: number;
  hasMask: boolean;
  hasVectorMask: boolean;
  hasEffects: boolean;
  smartFilterCount: number;
  /** Any pixel short of fully opaque. JPEG has nowhere to put it. */
  hasTransparency: boolean;
}

export interface FlatDocumentFacts {
  layerCount: number;
  layer: FlatLayerFacts | null;
  /** Engine `doc_mode`: 0 RGB, 1 Grayscale, 2 CMYK, 3 Lab, 4 Multichannel. */
  mode: number;
  /** 8, 16 or 32. */
  depth: number;
  /** Saved alpha channels plus spot channels. */
  extraChannels: number;
  /** Timeline frames. A still document has none. */
  frameCount: number;
}

const OPAQUE_OPACITY = 1 - 1e-4;

function plainPixelLayer(layer: FlatLayerFacts): boolean {
  return layer.kind === LAYER_KIND.pixel
    && layer.visible
    && layer.blend === 0
    && layer.opacity >= OPAQUE_OPACITY
    && layer.fill >= OPAQUE_OPACITY
    && !layer.hasMask
    && !layer.hasVectorMask
    && !layer.hasEffects
    && layer.smartFilterCount === 0;
}

/** True only when `ext` can hold this document exactly: one plain visible pixel
 *  layer, RGB, no extra channels, at a depth the format stores. JPEG also
 *  refuses transparency. Grayscale, CMYK, and Lab are not a fit: the flat
 *  encoders write RGB(A), and an in-place save would replace the source and
 *  clear the dirty flag. Anything else must Save As a project (or be an export
 *  copy) instead. (#520, #546) */
export function documentFitsFlatFormat(facts: FlatDocumentFacts, ext: string): boolean {
  const normalized = ext.toLowerCase();
  if (!FLAT_SAVE_EXTENSIONS.has(normalized)) return false;
  if (facts.frameCount > 1) return false;
  if (facts.layerCount !== 1 || !facts.layer || !plainPixelLayer(facts.layer)) return false;
  if (facts.extraChannels > 0) return false;
  if (facts.mode !== 0) return false;
  if (normalized === "jpg" || normalized === "jpeg" || normalized === "gif") {
    if (facts.depth !== 8) return false;
    if ((normalized === "jpg" || normalized === "jpeg") && facts.layer.hasTransparency) return false;
    return true;
  }
  if (normalized === "png") return facts.depth === 8 || facts.depth === 16;
  // Radiance and OpenEXR are the float destinations. Every other flat format
  // stores 8- or 16-bit samples, so a 32-bit document does not fit.
  if (normalized === "hdr" || normalized === "exr") return true;
  return facts.depth === 8 || facts.depth === 16;
}

function withProjectExtension(name: string): string {
  const slash = Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\"));
  const dot = name.lastIndexOf(".");
  const stem = dot > slash + 1 ? name.slice(0, dot) : name.replace(/\.$/, "");
  return `${stem}.mvision`;
}

export function suggestedSaveName(activeName: string | null | undefined, documentIsFlat: boolean): string {
  const name = activeName || "Untitled.mvision";
  const ext = extOf(name);
  // `.raw` is writable as Photoshop Raw, but a camera original shares the
  // suffix: never offer to write over one by default.
  if (!isSupportedSaveExtension(ext) || RAW_EXTENSIONS.has(ext) || saveAsIsCopy(ext, documentIsFlat)) return withProjectExtension(name);
  return name;
}
