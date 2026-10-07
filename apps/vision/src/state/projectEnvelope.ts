import { normalizeVariableData, type VariableData } from "./dataVariables";
import type { PersistedSmartLinkInfo } from "./smartLinks";
import { normalizeCustomProfileName } from "@monet-ui/monet-color";
import { cloneNotes, normalizeNotes, type Note } from "./notes";
import { cloneLayerComps, normalizeLayerComps, type LayerComp } from "./layerComps";
import { normalizePixelAspectRatio } from "./pixelAspect";
import { DEFAULT_DOCUMENT_RESOLUTION_PPI, normalizeDocumentResolutionPpi } from "./docPresets";
import { cloneGuides, normalizeGuides, type Guide } from "./newGuide";
import { isDefaultMeasureScale, normalizeMeasureScale, type MeasureScale } from "./measureScale";
import { anchorLoops, hasAnchorForm, hasPath, MAX_CLIP_FLATNESS, MAX_PERSISTED_SAVED_PATHS, MIN_CLIP_FLATNESS, type SavedPath } from "./paths";
import { assertReadableFileSize } from "./boundedRead";
import { parseBrushTips, serializeBrushTips, type BrushTip, type SerializedBrushTip } from "./brushTips";
import {
  MAX_CAMERA_RAW_SOURCE_BYTES,
  type CameraRawSource,
} from "./cameraRaw";
import { normalizeCameraRawSource } from "./cameraRawSource";
import { normalizeDuotoneInkSpec, type DuotoneInks } from "./duotone";
import type { CaptureMetadata } from "../engine/EngineClient";
import { normalizeCameraRawSourceMetadata } from "./cameraRaw";

/** Only bounded capture facts travel with ordinary image documents. */
export function normalizeCaptureMetadata(value: unknown): CaptureMetadata {
  const metadata = normalizeCameraRawSourceMetadata(value);
  return Object.fromEntries(["make", "model", "lens", "focalLengthMm", "aperture", "focalLength35Mm", "subjectDistanceM"]
    .flatMap((key) => metadata[key as keyof typeof metadata] === undefined ? [] : [[key, metadata[key as keyof typeof metadata]]])) as CaptureMetadata;
}

const PROJECT_ENVELOPE_FORMAT = "monet-vision-project";
const PROJECT_ENVELOPE_VERSION = 2;

// Project envelopes are JSON with base64 binary fields, so both the encoded
// file and every decoded allocation need explicit, independent ceilings.
export const MAX_PROJECT_ENVELOPE_BYTES = 512 * 1024 * 1024;
// Base64 expands by 4/3, so 384 MiB is the theoretical root-field ceiling of a
// 512 MiB envelope; JSON overhead and metadata make the effective limit lower.
export const MAX_PROJECT_ENGINE_BYTES = 384 * 1024 * 1024;
export const MAX_PROJECT_ICC_PROFILE_BYTES = 16 * 1024 * 1024;
export const MAX_PROJECT_SMART_EDIT_ENGINE_BYTES = 64 * 1024 * 1024;
export const MAX_PROJECT_SMART_EDIT_ENGINE_TOTAL_BYTES = 128 * 1024 * 1024;
export const MAX_PROJECT_SMART_EDIT_DEPTH = 8;
export const MAX_PROJECT_SMART_EDIT_SOURCES = 64;
export const MAX_PROJECT_DECODED_BINARY_BYTES = 384 * 1024 * 1024;
// Paths panel bounds — a hand-authored document never approaches these; they
// only stop a malformed/hostile envelope from allocating without limit.
const MAX_PERSISTED_PATH_NUMBERS = 1_000_000;

type ProjectEnvelope = {
  format: typeof PROJECT_ENVELOPE_FORMAT;
  version: 1 | typeof PROJECT_ENVELOPE_VERSION;
  engine: string;
  smartLinks?: PersistedSmartLinkInfo[];
  smartEditSources?: ProjectEnvelopeSmartEditSource[];
  document?: ProjectEnvelopeDocumentMeta;
};

export type ProjectDocumentMeta = {
  colorProfileAssigned: boolean;
  captureMetadata?: CaptureMetadata;
  iccProfileBytes?: Uint8Array | null;
  iccProfileName?: string | null;
  notes?: Note[];
  layerComps?: LayerComp[];
  resolutionPpi?: number;
  pixelAspect?: number;
  pixelAspectCorrection?: boolean;
  guides?: Guide[];
  measureScale?: MeasureScale;
  /** Paths panel: the document's named paths (Photoshop keeps these in the PSD).
   * ponytail: the unsaved Work Path stays session state, as in Photoshop's own
   * "Work Path is temporary" model — persist it as a reserved entry if asked. */
  savedPaths?: SavedPath[];
  variableData?: VariableData;
  /** Brushes panel: the custom tips defined in this document (Edit ▸ Define
   * Brush Preset). They travel with the file so a tip survives a hand-off. */
  brushTips?: BrushTip[];
  cameraRaw?: CameraRawSource;
  /** Exact Smart Object layer that owns `cameraRaw`; absent on legacy files and
   * on regular pixel opens. Persisting the id avoids binding provenance to an
   * unrelated fid-17 filter when a document contains more than one. */
  cameraRawLayerId?: number;
  /** Image ▸ Mode ▸ Duotone: the inks the "Duotone" gradient-map layer prints
   *  the gray plate through. The layer keeps only their LUT, so without this a
   *  reopened Duotone document could no longer be saved as a Photoshop Duotone. */
  duotone?: DuotoneInks;
};

type ProjectEnvelopeCameraRaw = Omit<CameraRawSource, "originalBytes" | "originalPath"> & { originalBytes: string };

type ProjectEnvelopeDocumentMeta = {
  colorProfileAssigned?: boolean;
  captureMetadata?: CaptureMetadata;
  iccProfile?: string;
  iccProfileName?: string;
  notes?: Note[];
  layerComps?: LayerComp[];
  resolutionPpi?: number;
  pixelAspect?: number;
  pixelAspectCorrection?: boolean;
  guides?: Guide[];
  measureScale?: MeasureScale;
  savedPaths?: SavedPath[];
  variableData?: VariableData;
  brushTips?: SerializedBrushTip[];
  cameraRaw?: ProjectEnvelopeCameraRaw;
  cameraRawLayerId?: number;
  duotone?: DuotoneInks;
};

type ProjectEnvelopeSmartEditSource = {
  parentLayerId: number;
  name: string;
  engine: string;
  document?: ProjectEnvelopeDocumentMeta;
  dirty?: boolean;
  smartEditSources?: ProjectEnvelopeSmartEditSource[];
};

export type PersistedSmartEditSource = {
  parentLayerId: number;
  name: string;
  engineBytes: Uint8Array;
  document: ProjectDocumentMeta;
  dirty: boolean;
  smartEditSources?: PersistedSmartEditSource[];
};

export type DecodedProjectEnvelope = {
  engineBytes: Uint8Array;
  smartLinks: PersistedSmartLinkInfo[];
  smartEditSources: PersistedSmartEditSource[];
  document: ProjectDocumentMeta;
};

type ProjectDecodeBudget = {
  binaryBytes: number;
  smartEditEngineBytes: number;
  smartEditSources: number;
};

type ProjectEncodeBudget = ProjectDecodeBudget;

type InspectedBase64 = {
  encoded: string;
  decodedBytes: number;
};

const decodedEnvelopeHandoffs = new WeakMap<Uint8Array, DecodedProjectEnvelope>();

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function inspectBoundedBase64(encoded: unknown, maxBytes: number, label: string): InspectedBase64 | null {
  if (typeof encoded !== "string" || !encoded.length) return null;
  const maxChars = 4 * Math.ceil(maxBytes / 3);
  if (encoded.length > maxChars) throw new Error(`${label} exceeds the decoded size limit`);
  if (encoded.length % 4 !== 0) return null;
  let padding = 0;
  while (padding < encoded.length && encoded.charCodeAt(encoded.length - 1 - padding) === 0x3d) padding += 1;
  if (padding > 2) return null;
  const contentLength = encoded.length - padding;
  if ((padding === 1 && contentLength % 4 !== 3) || (padding === 2 && contentLength % 4 !== 2)) return null;
  for (let i = 0; i < contentLength; i++) {
    const code = encoded.charCodeAt(i);
    const valid = (code >= 0x41 && code <= 0x5a)
      || (code >= 0x61 && code <= 0x7a)
      || (code >= 0x30 && code <= 0x39)
      || code === 0x2b
      || code === 0x2f;
    if (!valid) return null;
  }
  const decodedBytes = (encoded.length / 4) * 3 - padding;
  if (decodedBytes > maxBytes) throw new Error(`${label} exceeds the decoded size limit`);
  return { encoded, decodedBytes };
}

function decodeInspectedBase64(value: InspectedBase64): Uint8Array | null {
  let binary: string;
  try {
    binary = atob(value.encoded);
  } catch {
    return null;
  }
  if (binary.length !== value.decodedBytes) return null;
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Strict base64 decoding with a decoded-byte preflight. Exported so the
 * boundary behavior can be unit-tested without allocating production limits. */
export function decodeBase64WithinLimit(encoded: unknown, maxBytes: number, label = "Project field"): Uint8Array | null {
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) throw new Error("Invalid base64 byte limit");
  const inspected = inspectBoundedBase64(encoded, maxBytes, label);
  return inspected ? decodeInspectedBase64(inspected) : null;
}

function decodeProjectBinaryField(
  encoded: unknown,
  maxBytes: number,
  label: string,
  budget?: ProjectDecodeBudget,
): Uint8Array | null {
  const inspected = inspectBoundedBase64(encoded, maxBytes, label);
  if (!inspected) return null;
  if (budget && budget.binaryBytes + inspected.decodedBytes > MAX_PROJECT_DECODED_BINARY_BYTES) {
    throw new Error("Monet Vision project exceeds the decoded binary size limit");
  }
  const bytes = decodeInspectedBase64(inspected);
  if (bytes && budget) budget.binaryBytes += bytes.length;
  return bytes;
}

function chargeEncodedBinary(
  byteLength: number,
  maxBytes: number,
  label: string,
  budget: ProjectEncodeBudget,
) {
  if (!Number.isSafeInteger(byteLength) || byteLength <= 0 || byteLength > maxBytes) {
    throw new Error(`${label} exceeds the decoded size limit`);
  }
  if (budget.binaryBytes + byteLength > MAX_PROJECT_DECODED_BINARY_BYTES) {
    throw new Error("Monet Vision project exceeds the decoded binary size limit");
  }
  budget.binaryBytes += byteLength;
}

function encodeCameraRawSource(value: unknown, budget: ProjectEncodeBudget): ProjectEnvelopeCameraRaw | undefined {
  // Encoding is synchronous and read-only; borrowing avoids duplicating a
  // potentially large project-owned source before base64 conversion.
  if (value && typeof value === "object") {
    const originalBytes = (value as { originalBytes?: unknown }).originalBytes;
    if (originalBytes instanceof Uint8Array && originalBytes.length > MAX_CAMERA_RAW_SOURCE_BYTES) {
      throw new Error("Embedded Camera Raw source exceeds the decoded size limit");
    }
  }
  const source = normalizeCameraRawSource(value, { copyBytes: false });
  if (!source) return undefined;
  chargeEncodedBinary(source.originalBytes.length, MAX_CAMERA_RAW_SOURCE_BYTES, "Embedded Camera Raw source", budget);
  const portable = { ...source };
  delete portable.originalPath;
  return { ...portable, originalBytes: bytesToBase64(source.originalBytes) };
}

function decodeCameraRawSource(value: unknown, budget?: ProjectDecodeBudget): CameraRawSource | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const originalBytes = decodeProjectBinaryField(
    raw.originalBytes,
    MAX_CAMERA_RAW_SOURCE_BYTES,
    "Embedded Camera Raw source",
    budget,
  );
  if (!originalBytes) return null;
  // `originalBytes` was freshly allocated by base64 decoding, so ownership can
  // transfer into the document without an immediate second 256 MiB copy.
  return normalizeCameraRawSource({ ...raw, originalBytes }, { copyBytes: false });
}

function normalizeCameraRawLayerId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0 && value <= 0xffff_ffff
    ? value
    : undefined;
}

function validSmartLink(value: unknown): value is PersistedSmartLinkInfo {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<PersistedSmartLinkInfo>;
  return typeof item.layerId === "number"
    && Number.isFinite(item.layerId)
    && typeof item.name === "string"
    && (!("path" in item) || item.path === undefined || typeof item.path === "string")
    && (!("relativePath" in item) || item.relativePath === undefined || typeof item.relativePath === "string")
    && typeof item.missing === "boolean"
    && typeof item.linkedAt === "number"
    && Number.isFinite(item.linkedAt)
    && typeof item.updatedAt === "number"
    && Number.isFinite(item.updatedAt);
}

/** Bounded finite-number geometry, or null when the field is unusable. */
function normalizePathNumbers(value: unknown): number[] | null {
  if (!Array.isArray(value) || value.length > MAX_PERSISTED_PATH_NUMBERS) return null;
  for (const n of value) if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return value as number[];
}

/** Normalize persisted Paths-panel entries. Doubles as the runtime clone (same
 *  idiom as cloneGuides): envelope JSON is untrusted, so every entry revalidates. */
export function normalizeSavedPaths(value: unknown): SavedPath[] {
  if (!Array.isArray(value)) return [];
  const paths: SavedPath[] = [];
  let clipped = false;
  for (const item of value.slice(0, MAX_PERSISTED_SAVED_PATHS)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<SavedPath>;
    if (typeof raw.name !== "string" || !raw.name) continue;
    const flat = normalizePathNumbers(raw.path);
    if (!flat) continue;
    const path = flat.length % 2 ? flat.slice(0, -1) : [...flat]; // flat x,y pairs
    if (!hasPath(path)) continue; // fewer than 3 vertices encloses nothing
    const rawAnchors = raw.anchors === undefined ? null : normalizePathNumbers(raw.anchors);
    // Keep the bezier form only when it is a whole number of anchors; the flat
    // path stays authoritative either way.
    const anchors = rawAnchors && hasAnchorForm(rawAnchors) ? rawAnchors : null;
    // Loop counts only mean something when they split those anchors into
    // several valid loops (#452); a legacy entry has none.
    const contours = anchors && Array.isArray(raw.contours) && anchorLoops(anchors, raw.contours).length > 1
      ? raw.contours
      : null;
    // One clipping path, with a flatness Photoshop can store (NaN fails both tests).
    const clip = raw.clipFlatness;
    const keepClip = !clipped && typeof clip === "number" && clip >= MIN_CLIP_FLATNESS && clip <= MAX_CLIP_FLATNESS;
    if (keepClip) clipped = true;
    paths.push({
      name: raw.name.slice(0, 200),
      path,
      ...(anchors ? { anchors: [...anchors] } : {}),
      ...(contours ? { contours: [...contours] } : {}),
      ...(keepClip ? { clipFlatness: clip } : {}),
    });
  }
  return paths;
}

function normalizeDocumentMeta(value: unknown, budget?: ProjectDecodeBudget): ProjectDocumentMeta {
  const raw = typeof value === "object" && value
    ? value as Partial<Omit<ProjectEnvelopeDocumentMeta & ProjectDocumentMeta, "cameraRaw" | "brushTips">>
      & { cameraRaw?: unknown; brushTips?: unknown }
    : {};
  const runtimeBytes = raw.iccProfileBytes instanceof Uint8Array && raw.iccProfileBytes.length
    ? raw.iccProfileBytes.slice()
    : null;
  const iccProfileBytes = runtimeBytes ?? decodeProjectBinaryField(
    raw.iccProfile,
    MAX_PROJECT_ICC_PROFILE_BYTES,
    "Embedded ICC profile",
    budget,
  );
  const iccProfileName = normalizeCustomProfileName(raw.iccProfileName);
  const notes = normalizeNotes(raw.notes);
  const layerComps = normalizeLayerComps(raw.layerComps);
  const resolutionPpi = normalizeDocumentResolutionPpi(raw.resolutionPpi);
  const pixelAspect = normalizePixelAspectRatio(raw.pixelAspect ?? 1);
  const pixelAspectCorrection = raw.pixelAspectCorrection !== false;
  const guides = normalizeGuides(raw.guides);
  const measureScale = normalizeMeasureScale(raw.measureScale);
  const savedPaths = normalizeSavedPaths(raw.savedPaths);
  const variableData = normalizeVariableData(raw.variableData);
  const brushTips = parseBrushTips(raw.brushTips) ?? [];
  const cameraRaw = normalizeCameraRawSource(raw.cameraRaw) ?? decodeCameraRawSource(raw.cameraRaw, budget);
  const cameraRawLayerId = cameraRaw ? normalizeCameraRawLayerId(raw.cameraRawLayerId) : undefined;
  const duotone = normalizeDuotoneInkSpec(raw.duotone);
  const captureMetadata = normalizeCaptureMetadata(raw.captureMetadata);
  return {
    colorProfileAssigned: raw.colorProfileAssigned !== false,
    ...(Object.keys(captureMetadata).length ? { captureMetadata } : {}),
    ...(iccProfileBytes ? { iccProfileBytes } : {}),
    ...(iccProfileName ? { iccProfileName } : {}),
    ...(notes.length ? { notes } : {}),
    ...(layerComps.length ? { layerComps } : {}),
    ...(resolutionPpi !== DEFAULT_DOCUMENT_RESOLUTION_PPI ? { resolutionPpi } : {}),
    ...(pixelAspect !== 1 ? { pixelAspect } : {}),
    ...(pixelAspectCorrection ? {} : { pixelAspectCorrection: false }),
    ...(guides.length ? { guides } : {}),
    ...(isDefaultMeasureScale(measureScale) ? {} : { measureScale }),
    ...(savedPaths.length ? { savedPaths } : {}),
    ...(variableData.variables.length || variableData.dataSets.length ? { variableData } : {}),
    ...(brushTips.length ? { brushTips } : {}),
    ...(cameraRaw ? { cameraRaw } : {}),
    ...(cameraRawLayerId !== undefined ? { cameraRawLayerId } : {}),
    ...(duotone ? { duotone } : {}),
  };
}

function hasCustomDocumentMeta(document: ProjectDocumentMeta): boolean {
  return !document.colorProfileAssigned
    || !!Object.keys(document.captureMetadata ?? {}).length
    || !!document.iccProfileBytes?.length
    || !!normalizeCustomProfileName(document.iccProfileName)
    || !!document.notes?.length
    || !!document.layerComps?.length
    || (document.resolutionPpi ?? DEFAULT_DOCUMENT_RESOLUTION_PPI) !== DEFAULT_DOCUMENT_RESOLUTION_PPI
    || (document.pixelAspect ?? 1) !== 1
    || document.pixelAspectCorrection === false
    || !!document.guides?.length
    || !!document.savedPaths?.length
    || !!document.variableData
    || !!document.brushTips?.length
    || !!document.cameraRaw
    || !!document.duotone
    || !isDefaultMeasureScale(normalizeMeasureScale(document.measureScale));
}

function encodeDocumentMeta(
  document: ProjectDocumentMeta,
  budget: ProjectEncodeBudget,
): ProjectEnvelopeDocumentMeta | undefined {
  if (document.iccProfileBytes && document.iccProfileBytes.length > MAX_PROJECT_ICC_PROFILE_BYTES) {
    throw new Error("Embedded ICC profile exceeds the decoded size limit");
  }
  // Normalize/clone a potentially large RAW source only once on the encode path.
  const cameraRaw = encodeCameraRawSource(document.cameraRaw, budget);
  const cameraRawLayerId = cameraRaw ? normalizeCameraRawLayerId(document.cameraRawLayerId) : undefined;
  const normalized = normalizeDocumentMeta({
    colorProfileAssigned: document.colorProfileAssigned,
    captureMetadata: document.captureMetadata,
    iccProfileBytes: document.iccProfileBytes,
    iccProfileName: document.iccProfileName ?? undefined,
    notes: document.notes ? cloneNotes(document.notes) : undefined,
    layerComps: document.layerComps ? cloneLayerComps(document.layerComps) : undefined,
    resolutionPpi: document.resolutionPpi,
    pixelAspect: document.pixelAspect,
    pixelAspectCorrection: document.pixelAspectCorrection,
    guides: document.guides ? cloneGuides(document.guides) : undefined,
    measureScale: document.measureScale,
    savedPaths: document.savedPaths,
    variableData: document.variableData,
    brushTips: document.brushTips,
    duotone: document.duotone,
  });
  if (normalized.iccProfileBytes?.length) {
    chargeEncodedBinary(
      normalized.iccProfileBytes.length,
      MAX_PROJECT_ICC_PROFILE_BYTES,
      "Embedded ICC profile",
      budget,
    );
  }
  if (!cameraRaw && !hasCustomDocumentMeta(normalized)) return undefined;
  return {
    colorProfileAssigned: normalized.colorProfileAssigned ? undefined : false,
    captureMetadata: normalized.captureMetadata,
    iccProfile: normalized.iccProfileBytes?.length ? bytesToBase64(normalized.iccProfileBytes) : undefined,
    iccProfileName: normalizeCustomProfileName(normalized.iccProfileName) ?? undefined,
    notes: normalized.notes?.length ? cloneNotes(normalized.notes) : undefined,
    layerComps: normalized.layerComps?.length ? cloneLayerComps(normalized.layerComps) : undefined,
    resolutionPpi: normalized.resolutionPpi !== DEFAULT_DOCUMENT_RESOLUTION_PPI ? normalized.resolutionPpi : undefined,
    pixelAspect: normalized.pixelAspect !== 1 ? normalized.pixelAspect : undefined,
    pixelAspectCorrection: normalized.pixelAspectCorrection === false ? false : undefined,
    guides: normalized.guides?.length ? cloneGuides(normalized.guides) : undefined,
    measureScale: normalized.measureScale,
    savedPaths: normalized.savedPaths?.length ? normalizeSavedPaths(normalized.savedPaths) : undefined,
    variableData: normalized.variableData,
    brushTips: normalized.brushTips?.length ? serializeBrushTips(normalized.brushTips) : undefined,
    cameraRaw,
    cameraRawLayerId,
    duotone: normalized.duotone,
  };
}

function validSmartEditSource(value: unknown): value is ProjectEnvelopeSmartEditSource {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<ProjectEnvelopeSmartEditSource>;
  return typeof item.parentLayerId === "number"
    && Number.isFinite(item.parentLayerId)
    && typeof item.name === "string"
    && typeof item.engine === "string"
    && (!("dirty" in item) || item.dirty === undefined || typeof item.dirty === "boolean")
    && (!("smartEditSources" in item) || item.smartEditSources === undefined || Array.isArray(item.smartEditSources));
}

function encodeSmartEditSource(
  source: PersistedSmartEditSource,
  budget: ProjectEncodeBudget,
  depth: number,
): ProjectEnvelopeSmartEditSource | null {
  if (depth > MAX_PROJECT_SMART_EDIT_DEPTH) {
    throw new Error("Monet Vision project exceeds the Smart Object nesting limit");
  }
  budget.smartEditSources += 1;
  if (budget.smartEditSources > MAX_PROJECT_SMART_EDIT_SOURCES) {
    throw new Error("Monet Vision project exceeds the Smart Object source limit");
  }
  if (!Number.isFinite(source.parentLayerId) || !source.name || !source.engineBytes.length) return null;
  if (source.engineBytes.length > MAX_PROJECT_SMART_EDIT_ENGINE_BYTES) {
    throw new Error("Smart Object engine exceeds the decoded size limit");
  }
  if (budget.smartEditEngineBytes + source.engineBytes.length > MAX_PROJECT_SMART_EDIT_ENGINE_TOTAL_BYTES) {
    throw new Error("Monet Vision project exceeds the Smart Object engine total limit");
  }
  chargeEncodedBinary(
    source.engineBytes.length,
    MAX_PROJECT_SMART_EDIT_ENGINE_BYTES,
    "Smart Object engine",
    budget,
  );
  budget.smartEditEngineBytes += source.engineBytes.length;
  const nested: ProjectEnvelopeSmartEditSource[] = [];
  if (source.smartEditSources?.length) {
    if (depth === MAX_PROJECT_SMART_EDIT_DEPTH) {
      throw new Error("Monet Vision project exceeds the Smart Object nesting limit");
    }
    for (const child of source.smartEditSources) {
      const encoded = encodeSmartEditSource(child, budget, depth + 1);
      if (encoded) nested.push(encoded);
    }
  }
  return {
    parentLayerId: Math.trunc(source.parentLayerId),
    name: source.name,
    engine: bytesToBase64(source.engineBytes),
    document: encodeDocumentMeta(source.document, budget),
    dirty: source.dirty || undefined,
    smartEditSources: nested.length ? nested : undefined,
  };
}

function decodeSmartEditSource(
  value: unknown,
  budget: ProjectDecodeBudget,
  depth: number,
): PersistedSmartEditSource | null {
  if (depth > MAX_PROJECT_SMART_EDIT_DEPTH) {
    throw new Error("Monet Vision project exceeds the Smart Object nesting limit");
  }
  budget.smartEditSources += 1;
  if (budget.smartEditSources > MAX_PROJECT_SMART_EDIT_SOURCES) {
    throw new Error("Monet Vision project exceeds the Smart Object source limit");
  }
  if (!validSmartEditSource(value)) return null;

  const inspected = inspectBoundedBase64(value.engine, MAX_PROJECT_SMART_EDIT_ENGINE_BYTES, "Smart Object engine");
  if (!inspected) return null;
  if (budget.smartEditEngineBytes + inspected.decodedBytes > MAX_PROJECT_SMART_EDIT_ENGINE_TOTAL_BYTES) {
    throw new Error("Monet Vision project exceeds the Smart Object engine total limit");
  }
  if (budget.binaryBytes + inspected.decodedBytes > MAX_PROJECT_DECODED_BINARY_BYTES) {
    throw new Error("Monet Vision project exceeds the decoded binary size limit");
  }
  const engineBytes = decodeInspectedBase64(inspected);
  if (!engineBytes?.length) return null;
  budget.smartEditEngineBytes += engineBytes.length;
  budget.binaryBytes += engineBytes.length;

  const nested: PersistedSmartEditSource[] = [];
  if (value.smartEditSources?.length) {
    if (depth === MAX_PROJECT_SMART_EDIT_DEPTH) {
      throw new Error("Monet Vision project exceeds the Smart Object nesting limit");
    }
    for (const child of value.smartEditSources) {
      const decoded = decodeSmartEditSource(child, budget, depth + 1);
      if (decoded) nested.push(decoded);
    }
  }
  return {
    parentLayerId: Math.trunc(value.parentLayerId),
    name: value.name,
    engineBytes,
    document: normalizeDocumentMeta(value.document, budget),
    dirty: value.dirty === true,
    smartEditSources: nested.length ? nested : undefined,
  };
}

export function encodeProjectEnvelope(
  engineBytes: Uint8Array,
  smartLinks: PersistedSmartLinkInfo[],
  document: ProjectDocumentMeta = { colorProfileAssigned: true },
  smartEditSources: PersistedSmartEditSource[] = [],
): Uint8Array {
  const budget: ProjectEncodeBudget = { binaryBytes: 0, smartEditEngineBytes: 0, smartEditSources: 0 };
  chargeEncodedBinary(engineBytes.length, MAX_PROJECT_ENGINE_BYTES, "Monet Vision project engine", budget);
  const sources: ProjectEnvelopeSmartEditSource[] = [];
  for (const source of smartEditSources) {
    const encoded = encodeSmartEditSource(source, budget, 1);
    if (encoded) sources.push(encoded);
  }
  const payload: ProjectEnvelope = {
    format: PROJECT_ENVELOPE_FORMAT,
    version: PROJECT_ENVELOPE_VERSION,
    engine: bytesToBase64(engineBytes),
    smartLinks: smartLinks.length ? smartLinks : undefined,
    smartEditSources: sources.length ? sources : undefined,
    document: encodeDocumentMeta(document, budget),
  };
  const encoded = new TextEncoder().encode(`${JSON.stringify(payload)}\n`);
  assertProjectEnvelopeSize(encoded.length);
  return encoded;
}

/** The `.mvis` container's document-metadata entry. */
const DOCUMENT_META_FORMAT = "monet-vision-document";

/** The document metadata alone, as JSON bytes.
 *
 *  `.mvis` carries the engine's own graphics container, but every field in
 *  ProjectDocumentMeta lives in JS — saved paths, notes, layer comps, brush
 *  tips, the measurement scale, the ICC assignment, Camera Raw provenance — and
 *  the container had nowhere to put any of it, so saving there destroyed the lot
 *  and still marked the tab clean (#493). This is the same encoding as the
 *  project envelope's `document` field, so there is one serializer, not two. */
export function encodeDocumentMetaBytes(document: ProjectDocumentMeta): Uint8Array {
  const budget: ProjectEncodeBudget = { binaryBytes: 0, smartEditEngineBytes: 0, smartEditSources: 0 };
  const encoded = new TextEncoder().encode(JSON.stringify({
    format: DOCUMENT_META_FORMAT,
    version: PROJECT_ENVELOPE_VERSION,
    document: encodeDocumentMeta(document, budget) ?? {},
  }));
  assertProjectEnvelopeSize(encoded.length);
  return encoded;
}

/** Null for anything that is not one of ours — an entry written by a future
 *  version, or a foreign app's file that happens to use the same path. */
export function decodeDocumentMetaBytes(bytes: Uint8Array): ProjectDocumentMeta | null {
  assertProjectEnvelopeSize(bytes.length);
  let payload: unknown;
  try { payload = JSON.parse(new TextDecoder().decode(bytes)); } catch { return null; }
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as { format?: unknown; document?: unknown };
  if (obj.format !== DOCUMENT_META_FORMAT) return null;
  const budget: ProjectDecodeBudget = { binaryBytes: 0, smartEditEngineBytes: 0, smartEditSources: 0 };
  return normalizeDocumentMeta(obj.document, budget);
}

export function assertProjectEnvelopeSize(size: number) {
  assertReadableFileSize(size, MAX_PROJECT_ENVELOPE_BYTES, "Monet Vision project");
}

/** Hand a decoded native envelope to the immediately following Store open.
 * The entry is consumed once, avoiding a second JSON/base64 decode while
 * preserving decodeProjectEnvelope's normal fresh-object behavior elsewhere. */
export function handoffDecodedProjectEnvelope(
  bytes: Uint8Array,
  envelope: DecodedProjectEnvelope,
): Uint8Array {
  assertProjectEnvelopeSize(bytes.length);
  decodedEnvelopeHandoffs.set(bytes, envelope);
  return bytes;
}

export function decodeProjectEnvelope(bytes: Uint8Array): DecodedProjectEnvelope | null {
  assertProjectEnvelopeSize(bytes.length);
  const handedOff = decodedEnvelopeHandoffs.get(bytes);
  if (handedOff) {
    decodedEnvelopeHandoffs.delete(bytes);
    return handedOff;
  }
  if (bytes[0] !== 0x7b) return null; // not a JSON object; let legacy MVSN handling try it.
  let payload: unknown;
  try {
    payload = JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    throw new Error("Malformed Monet Vision project envelope");
  }
  if (!payload || typeof payload !== "object") return null;
  const obj = payload as Partial<ProjectEnvelope>;
  if (obj.format !== PROJECT_ENVELOPE_FORMAT) return null;
  if ((obj.version !== 1 && obj.version !== PROJECT_ENVELOPE_VERSION) || typeof obj.engine !== "string") {
    throw new Error("Unsupported Monet Vision project envelope");
  }
  const budget: ProjectDecodeBudget = { binaryBytes: 0, smartEditEngineBytes: 0, smartEditSources: 0 };
  const engineBytes = decodeProjectBinaryField(obj.engine, MAX_PROJECT_ENGINE_BYTES, "Monet Vision project engine", budget);
  if (!engineBytes?.length) throw new Error("Malformed Monet Vision project engine");
  const smartLinks = Array.isArray(obj.smartLinks) ? obj.smartLinks.filter(validSmartLink) : [];
  const smartEditSources: PersistedSmartEditSource[] = [];
  if (Array.isArray(obj.smartEditSources)) {
    for (const source of obj.smartEditSources) {
      const decoded = decodeSmartEditSource(source, budget, 1);
      if (decoded) smartEditSources.push(decoded);
    }
  }
  return { engineBytes, smartLinks, smartEditSources, document: normalizeDocumentMeta(obj.document, budget) };
}
