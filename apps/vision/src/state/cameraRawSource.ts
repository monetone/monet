// Source/snapshot lifecycle for persisted Camera Raw provenance. This sits one
// level ABOVE the flat Canonical codec (./cameraRaw): it migrates every persisted
// recipe through Vision's working-recipe normalizer (./visionDevelopRecipe), which
// accepts BOTH the old Canonical schema-2 (migrated) AND new V2 payloads — so older
// projects/sidecars keep loading (docs/plans/10 Phase 5). Splitting it out keeps
// ./cameraRaw free of any runtime import from ./visionDevelopRecipe (the import
// graph is now acyclic: cameraRawSource → visionDevelopRecipe → cameraRaw, and
// cameraRawSource → cameraRaw, never the reverse).
import {
  asRecord,
  cleanString,
  integer,
  normalizeCameraRawSourceMetadata,
  CAMERA_RAW_SOURCE_VERSION,
  MAX_CAMERA_RAW_SNAPSHOTS,
  MAX_CAMERA_RAW_SOURCE_BYTES,
  type CameraRawSnapshotEntry,
  type CameraRawSource,
} from "./cameraRaw";
import { normalizeWorkingRecipe } from "./visionDevelopRecipe";
import { RAW_DEMOSAICS, type RawDemosaic } from "./webExportPrefs";

/** Bound + normalize a snapshot list: valid recipes only, clean non-empty
 *  names, capped at MAX_CAMERA_RAW_SNAPSHOTS. */
export function normalizeCameraRawSnapshots(value: unknown): CameraRawSnapshotEntry[] {
  if (!Array.isArray(value)) return [];
  const out: CameraRawSnapshotEntry[] = [];
  for (const raw of value) {
    if (out.length >= MAX_CAMERA_RAW_SNAPSHOTS) break;
    const record = asRecord(raw);
    if (!record) continue;
    const name = cleanString(record.name, 128);
    if (!name || record.recipe == null) continue;
    // Working V2 recipe; accepts old Canonical schema-2 (migrated) and new V2.
    out.push({ name, recipe: normalizeWorkingRecipe(record.recipe) });
  }
  return out;
}

/** Validate project-owned RAW provenance. Bytes are defensively cloned unless
 * the caller explicitly transfers ownership of a freshly allocated buffer. */
export function normalizeCameraRawSource(
  value: unknown,
  options: { copyBytes?: boolean } = {},
): CameraRawSource | null {
  const raw = asRecord(value);
  if (!raw || raw.version !== CAMERA_RAW_SOURCE_VERSION) return null;
  const originalName = cleanString(raw.originalName, 1024);
  const originalBytes = raw.originalBytes instanceof Uint8Array ? raw.originalBytes : null;
  if (!originalName || !originalBytes?.length || originalBytes.length > MAX_CAMERA_RAW_SOURCE_BYTES) return null;
  // Working V2 recipe; normalizeWorkingRecipe fills defaults for junk/absent and
  // migrates the old Canonical schema-2 shape, so older projects still load.
  const recipe = normalizeWorkingRecipe(raw.recipe);
  const snapshots = normalizeCameraRawSnapshots(raw.snapshots);
  const originalPath = cleanString(raw.originalPath, 4096);
  const mimeType = cleanString(raw.mimeType, 256);
  const sha = cleanString(raw.sha256, 64).toLowerCase();
  const lastModified = integer(raw.lastModified, 0, 0, Number.MAX_SAFE_INTEGER);
  return {
    version: CAMERA_RAW_SOURCE_VERSION,
    originalName,
    ...(originalPath ? { originalPath } : {}),
    ...(mimeType ? { mimeType } : {}),
    ...(/^[0-9a-f]{64}$/.test(sha) ? { sha256: sha } : {}),
    ...(lastModified > 0 ? { lastModified } : {}),
    originalBytes: options.copyBytes === false ? originalBytes : originalBytes.slice(),
    metadata: normalizeCameraRawSourceMetadata(raw.metadata),
    recipe,
    ...(snapshots.length ? { snapshots } : {}),
    ...(RAW_DEMOSAICS.includes(raw.demosaic as RawDemosaic) ? { demosaic: raw.demosaic as RawDemosaic } : {}),
    ...(raw.depth === 32 ? { depth: 32 as const } : {}),
  };
}

export function cloneCameraRawSource(source: CameraRawSource): CameraRawSource {
  const clone = normalizeCameraRawSource(source);
  if (!clone) throw new Error("Invalid Camera Raw source");
  return clone;
}
