// Vision's Camera Raw sidecar. The XMP *document* (both its `crs:` block and
// Vision's lossless `mvcr:Payload`) is owned by @monet-ui/monet-photo's `xmp`
// module — the ONE dialect every Monet photo app reads and writes. This file
// only owns the payload's shape: what Vision puts inside `mvcr:Payload` and how
// it validates identity before applying it.
import {
  MAX_CAMERA_RAW_XMP_BYTES,
  serializeCameraRawXmp as serializeXmpDocument,
  tryParseCameraRawXmp,
} from "@monet-ui/monet-photo";
import {
  MAX_CAMERA_RAW_SOURCE_BYTES,
  normalizeCameraRawSourceMetadata,
  type CameraRawSnapshotEntry,
  type CameraRawSource,
  type CameraRawSourceMetadata,
} from "./cameraRaw";
import { normalizeCameraRawSnapshots, normalizeCameraRawSource } from "./cameraRawSource";
import { normalizeWorkingRecipe, type VisionDevelopRecipe } from "./visionDevelopRecipe";

export const CAMERA_RAW_XMP_VERSION = 1;
export { MAX_CAMERA_RAW_XMP_BYTES };

export interface CameraRawXmpSourceIdentity {
  originalName: string;
  originalByteLength: number;
  mimeType?: string;
  sha256?: string;
  lastModified?: number;
  metadata: CameraRawSourceMetadata;
}

export interface CameraRawXmpSidecar {
  version: typeof CAMERA_RAW_XMP_VERSION;
  source: CameraRawXmpSourceIdentity;
  recipe: VisionDevelopRecipe;
  /** Named develop snapshots — optional and version-tolerant (absent = none). */
  snapshots?: CameraRawSnapshotEntry[];
}

/** Small editor/sidecar view of a RAW source. It deliberately carries the
 * source byte length instead of the project-owned byte buffer, so a dialog can
 * validate XMP identity without cloning, retaining, or mutating camera bytes. */
export interface CameraRawSidecarSourceSnapshot extends CameraRawXmpSourceIdentity {
  originalPath?: string;
  recipe: VisionDevelopRecipe;
  snapshots?: CameraRawSnapshotEntry[];
}

type UnknownRecord = Record<string, unknown>;
const asRecord = (value: unknown): UnknownRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value) ? value as UnknownRecord : null;
const cleanString = (value: unknown, max: number): string => {
  if (typeof value !== "string") return "";
  const clean: string[] = [];
  let inspected = 0;
  let outputLength = 0;
  for (const character of value) {
    if (inspected++ >= max * 4 || outputLength + character.length > max) break;
    const code = character.charCodeAt(0);
    if (code >= 0x20 && code !== 0x7f) {
      clean.push(character);
      outputLength += character.length;
    }
  }
  return clean.join("").trim();
};

function normalizeSidecar(value: unknown): CameraRawXmpSidecar | null {
  const raw = asRecord(value);
  const source = asRecord(raw?.source);
  if (!raw || raw.version !== CAMERA_RAW_XMP_VERSION || !source) return null;
  const originalName = cleanString(source.originalName, 1024);
  const originalByteLength = typeof source.originalByteLength === "number" && Number.isSafeInteger(source.originalByteLength)
    ? source.originalByteLength : 0;
  if (!originalName || originalByteLength < 1 || originalByteLength > MAX_CAMERA_RAW_SOURCE_BYTES) return null;
  // Working V2 recipe; accepts old Canonical schema-2 (migrated) and new V2 payloads.
  const recipe = normalizeWorkingRecipe(raw.recipe);
  const snapshots = normalizeCameraRawSnapshots(raw.snapshots);
  const mimeType = cleanString(source.mimeType, 256);
  const sha256 = cleanString(source.sha256, 64).toLowerCase();
  const lastModified = typeof source.lastModified === "number" && Number.isSafeInteger(source.lastModified)
    && source.lastModified > 0 ? source.lastModified : 0;
  return {
    version: CAMERA_RAW_XMP_VERSION,
    source: {
      originalName,
      originalByteLength,
      ...(mimeType ? { mimeType } : {}),
      ...(/^[0-9a-f]{64}$/.test(sha256) ? { sha256 } : {}),
      ...(lastModified ? { lastModified } : {}),
      metadata: normalizeCameraRawSourceMetadata(source.metadata),
    },
    recipe,
    ...(snapshots.length ? { snapshots } : {}),
  };
}

function normalizeSourceSnapshot(value: unknown): CameraRawSidecarSourceSnapshot | null {
  const raw = asRecord(value);
  if (!raw) return null;
  const normalized = normalizeSidecar({
    version: CAMERA_RAW_XMP_VERSION,
    source: raw,
    recipe: raw.recipe,
    snapshots: raw.snapshots,
  });
  if (!normalized) return null;
  const originalPath = cleanString(raw.originalPath, 4096);
  return {
    ...normalized.source,
    ...(originalPath ? { originalPath } : {}),
    recipe: normalized.recipe,
    ...(normalized.snapshots ? { snapshots: normalized.snapshots } : {}),
  };
}

/** Derive the bounded sidecar/editor view without copying originalBytes. */
export function cameraRawSidecarSourceSnapshot(value: CameraRawSource): CameraRawSidecarSourceSnapshot {
  const source = normalizeCameraRawSource(value, { copyBytes: false });
  if (!source) throw new Error("Invalid Camera Raw source");
  const snapshot = normalizeSourceSnapshot({
    originalName: source.originalName,
    originalPath: source.originalPath,
    originalByteLength: source.originalBytes.length,
    mimeType: source.mimeType,
    sha256: source.sha256,
    lastModified: source.lastModified,
    metadata: source.metadata,
    recipe: source.recipe,
    snapshots: source.snapshots,
  });
  if (!snapshot) throw new Error("Invalid Camera Raw source");
  return snapshot;
}

/** Export editable Camera Raw settings as a self-contained XMP packet. Original
 * image bytes and local filesystem paths are deliberately never placed in XMP. */
export function serializeCameraRawXmp(value: CameraRawSource | CameraRawSidecarSourceSnapshot): string {
  const source = "originalBytes" in value
    ? cameraRawSidecarSourceSnapshot(value)
    : normalizeSourceSnapshot(value);
  if (!source) throw new Error("Invalid Camera Raw source");
  const payload = normalizeSidecar({
    version: CAMERA_RAW_XMP_VERSION,
    source: {
      originalName: source.originalName,
      originalByteLength: source.originalByteLength,
      mimeType: source.mimeType,
      sha256: source.sha256,
      lastModified: source.lastModified,
      metadata: source.metadata,
    },
    recipe: source.recipe,
    ...(source.snapshots?.length ? { snapshots: source.snapshots } : {}),
  });
  if (!payload) throw new Error("Invalid Camera Raw source");
  // The shared dialect writes BOTH blocks from one recipe: `crs:` so Galerie and
  // Lightroom/ACR can read the look, and `mvcr:Payload` so Vision reloads the
  // full recipe (crop, masks, heal, curve authoring) losslessly.
  return serializeXmpDocument({ recipe: payload.recipe, monet: payload });
}

/** Parse Vision's lossless payload out of a Camera Raw XMP. Null when the
 * document carries no Monet payload (a foreign `crs:`-only sidecar or preset —
 * see `parseCameraRawLookXmp`) or when it isn't a usable XMP at all. */
export function parseCameraRawXmp(input: string | Uint8Array): CameraRawXmpSidecar | null {
  const doc = tryParseCameraRawXmp(input);
  return doc?.monet == null ? null : normalizeSidecar(doc.monet);
}

/** Whether `existing` is a sidecar Vision wrote in full — its Monet payload
 * serializes back to exactly these bytes — so writing over it loses nothing.
 * A Lightroom/ACR or Galerie .xmp, or a Vision one another app has since added
 * fields to (keywords, a rating, crs: settings Vision doesn't map), is not. */
export function isOwnCameraRawXmp(existing: string | Uint8Array): boolean {
  const sidecar = parseCameraRawXmp(existing);
  if (!sidecar) return false;
  const text = typeof existing === "string" ? existing : new TextDecoder().decode(existing);
  try {
    return serializeCameraRawXmp({ ...sidecar.source, recipe: sidecar.recipe, ...(sidecar.snapshots ? { snapshots: sidecar.snapshots } : {}) }) === text;
  } catch {
    return false;
  }
}

/** A develop look with no identity claim: applies to whatever image you point it
 *  at, unlike a sidecar (which `applyCameraRawXmp` pins to its source). */
export interface CameraRawXmpLook {
  /** `crs:Name` / `crs:PresetName`, when the document names the look. */
  name: string | null;
  recipe: VisionDevelopRecipe;
}

/** Read ANY Camera Raw XMP as an applicable look — a Galerie sidecar, a
 * Lightroom/ACR preset, or Vision's own packet. */
export function parseCameraRawLookXmp(input: string | Uint8Array): CameraRawXmpLook | null {
  const doc = tryParseCameraRawXmp(input);
  if (!doc) return null;
  // `crs:` wins: it is the block every Monet photo app REWRITES when it edits,
  // whereas the mvcr payload may be an older copy a non-owner couriered through.
  if (doc.recipe) return { name: doc.name, recipe: normalizeWorkingRecipe(doc.recipe) };
  if (doc.monet != null) {
    // A Monet payload we can't read is a corrupt/newer file, not an empty look.
    const sidecar = normalizeSidecar(doc.monet);
    return sidecar ? { name: doc.name, recipe: sidecar.recipe } : null;
  }
  // A valid Camera Raw XMP with no non-default parameter left to record — the
  // serializer omits zeros, so a "reset everything" look reads back as defaults.
  return { name: doc.name, recipe: normalizeWorkingRecipe({}) };
}

/** Apply a parsed sidecar only when it still identifies the selected RAW. */
export function applyCameraRawXmp(
  sourceValue: CameraRawSidecarSourceSnapshot,
  sidecarValue: CameraRawXmpSidecar,
): CameraRawSidecarSourceSnapshot | null {
  const source = normalizeSourceSnapshot(sourceValue);
  const sidecar = normalizeSidecar(sidecarValue);
  if (!source || !sidecar || sidecar.source.originalByteLength !== source.originalByteLength) return null;
  if (source.sha256) {
    if (sidecar.source.sha256 !== source.sha256) return null;
  } else if (sidecar.source.originalName !== source.originalName) return null;
  return {
    ...source,
    metadata: normalizeCameraRawSourceMetadata({
      ...source.metadata,
      ...sidecar.source.metadata,
      extra: { ...source.metadata.extra, ...sidecar.source.metadata.extra },
    }),
    recipe: sidecar.recipe,
    ...(sidecar.snapshots ? { snapshots: sidecar.snapshots } : {}),
  };
}
