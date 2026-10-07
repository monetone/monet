// thumbnailLoader — the app-wide lazy thumbnail pipeline behind the grid/
// filmstrip. Reads the source file, decodes+downscales via the engine, and
// stashes the object URL in a shared LRU. Dedups concurrent requests for the
// same photo and bounds how many decode at once (a scroll must not spawn 50
// full-res RAW decodes). Superseded by the native on-disk cache (task #8).

import { readFile } from "@tauri-apps/plugin-fs";

import {
  catalogAvailable,
  onRecipeChanged,
  previewGet,
  previewPut,
  previewRequest,
} from "../catalog/catalog";
import type { PhotoRow, PreviewIdentityV2, PreviewRequestV2 } from "../catalog/types";
import { rawFrameMetadata } from "../rawDecode";
import { generateThumbnail, urlFromEncoded } from "./thumbnails";
import { ThumbnailCache } from "./thumbnailCache";

/** Preview kind persisted in the native cache (matches the Rust `preview.kind`). */
const KIND = "thumbnail";

/** Shared cache, keyed by (photo id + decode size). Capacity ≫ any realistic
 *  on-screen set (grid + windowed filmstrip) so visible thumbnails are never
 *  evicted out from under a mounted cell. */
const cache = new ThumbnailCache<string>(600, (url) => URL.revokeObjectURL(url));

const inflight = new Map<string, Promise<string | null>>();
const latestKeys = new Map<string, string>();
const photoRevisions = new Map<number, number>();
const MAX_PREVIEW_ATTEMPTS = 3;

/** One photo yields a distinct thumbnail per decode size — the 128px filmstrip
 *  blob and the 256px grid blob must not collide (a smaller one would blur the
 *  grid). Key both the cache and the in-flight dedup on id+size. */
const cacheKey = (id: number, maxEdge: number): string => `${id}:${maxEdge}`;

function remember(baseKey: string, identityKey: string, url: string): void {
  const previous = latestKeys.get(baseKey);
  if (previous && previous !== identityKey) cache.delete(previous);
  cache.set(identityKey, url);
  latestKeys.set(baseKey, identityKey);
}

function invalidatePhoto(photoId: number): void {
  photoRevisions.set(photoId, (photoRevisions.get(photoId) ?? 0) + 1);
  for (const [baseKey, identityKey] of latestKeys) {
    if (baseKey.startsWith(`${photoId}:`)) {
      cache.delete(identityKey);
      latestKeys.delete(baseKey);
    }
  }
}

onRecipeChanged(invalidatePhoto);

// Bounded-concurrency gate (max simultaneous decodes).
const MAX_CONCURRENCY = 4;
let active = 0;
const queue: Array<() => void> = [];

function acquire(): Promise<void> {
  if (active < MAX_CONCURRENCY) {
    active++;
    return Promise.resolve();
  }
  return new Promise((resolve) => queue.push(resolve));
}

function release(): void {
  active--;
  const next = queue.shift();
  if (next) {
    active++;
    next();
  }
}

/** Cache-synchronous thumbnail URL for a photo at `maxEdge`, or null if not yet
 *  generated. */
export function peekThumbnail(id: number, maxEdge: number): string | null {
  const identityKey = latestKeys.get(cacheKey(id, maxEdge));
  return identityKey ? (cache.get(identityKey) ?? null) : null;
}

/**
 * Return a thumbnail object URL for `photo` (≤ maxEdge px), generating it if
 * absent. Concurrent calls for the same (photo, size) share one decode.
 */
export async function loadThumbnail(photo: PhotoRow, maxEdge: number): Promise<string | null> {
  const baseKey = cacheKey(photo.id, maxEdge);
  if (!catalogAvailable()) {
    const hit = cache.get(baseKey);
    if (hit) return hit;
    const pending = inflight.get(baseKey);
    if (pending) return pending;
    const job = generateThumbnailJob(photo, maxEdge, baseKey, baseKey, null, 0);
    inflight.set(baseKey, job);
    return job;
  }

  const revision = photoRevisions.get(photo.id) ?? 0;
  let request: PreviewRequestV2;
  try {
    request = await previewRequest(photo.id, KIND, maxEdge);
  } catch (error) {
    console.error("galerie thumbnail: canonical request failed", photo.path, error);
    return null;
  }
  if ((photoRevisions.get(photo.id) ?? 0) !== revision) {
    return loadThumbnail(photo, maxEdge);
  }

  const identityKey = `${baseKey}:${request.cacheKey}`;
  const hit = cache.get(identityKey);
  if (hit) {
    latestKeys.set(baseKey, identityKey);
    return hit;
  }
  const pending = inflight.get(identityKey);
  if (pending) return pending;
  const job = generateThumbnailJob(photo, maxEdge, baseKey, identityKey, request, revision);
  inflight.set(identityKey, job);
  return job;
}

function generateThumbnailJob(
  photo: PhotoRow,
  maxEdge: number,
  baseKey: string,
  identityKey: string,
  request: PreviewRequestV2 | null,
  revision: number,
): Promise<string | null> {
  const job = (async (): Promise<string | null> => {
    try {
      // 1. Native on-disk cache hit — persists across restarts, skips the wasm
      //    decode entirely, and isn't concurrency-gated (a cheap DB + file read).
      if (request) {
        try {
          const cached = await previewGet(photo.id, KIND, request.identity);
          if (cached) {
            const url = urlFromEncoded(cached);
            if ((photoRevisions.get(photo.id) ?? 0) !== revision) {
              URL.revokeObjectURL(url);
              return null;
            }
            remember(baseKey, identityKey, url);
            return url;
          }
        } catch {
          /* cache read failed — fall through and regenerate */
        }
      }
      // 2. Generate via the engine (concurrency-gated), then write-through.
      await acquire();
      try {
        const fileBytes = await readFile(photo.readPath ?? photo.path);
        const raw = photo.format.startsWith("raw:");
        const { url, encoded, decodedRaw } = await generateThumbnail(
          fileBytes,
          raw,
          maxEdge,
          photo.readPath ?? photo.path,
          request?.recipeJson,
          request?.identity.scaleNumerator,
          request?.identity.scaleDenominator,
        );
        if (request) {
          await previewPut(
            photo.id,
            KIND,
            maxEdge,
            request.identity,
            decodedRaw ? rawFrameMetadata(decodedRaw) : null,
            encoded,
          ).catch((error) => console.warn("Galerie preview cache write rejected", error));
        }
        if (request && (photoRevisions.get(photo.id) ?? 0) !== revision) {
          URL.revokeObjectURL(url);
          return null;
        }
        remember(baseKey, identityKey, url);
        return url;
      } finally {
        release();
      }
    } catch (e) {
      console.error("galerie thumbnail: failed", photo.path, e);
      return null;
    } finally {
      inflight.delete(identityKey);
    }
  })();

  return job;
}

/**
 * Cache-aware full-size preview for Loupe/Develop: native disk-cache read →
 * decode-on-miss → write-through. Returns a fresh object URL the CALLER owns
 * (revoke it) — deliberately NOT held in the shared thumbnail LRU, since these
 * previews are large (2560px) and each view mounts only one.
 */
export async function loadPreview(photo: PhotoRow, kind: string, maxEdge: number): Promise<string | null> {
  const previewKind = kind as PreviewIdentityV2["previewKind"];
  if (!catalogAvailable()) {
    try {
      const bytes = await readFile(photo.readPath ?? photo.path);
      return (await generateThumbnail(bytes, photo.format.startsWith("raw:"), maxEdge, photo.readPath ?? photo.path)).url;
    } catch (error) {
      console.error("galerie preview: failed", photo.path, error);
      return null;
    }
  }

  for (let attempt = 0; attempt < MAX_PREVIEW_ATTEMPTS; attempt++) {
    const revision = photoRevisions.get(photo.id) ?? 0;
    let request: PreviewRequestV2;
    try {
      request = await previewRequest(photo.id, previewKind, maxEdge);
    } catch (error) {
      console.warn("galerie preview: canonical request failed", photo.path, error);
      return null;
    }
    if ((photoRevisions.get(photo.id) ?? 0) !== revision) continue;

    try {
      const cached = await previewGet(photo.id, kind, request.identity);
      if (cached) {
        const url = urlFromEncoded(cached);
        if ((photoRevisions.get(photo.id) ?? 0) === revision) return url;
        URL.revokeObjectURL(url);
        continue;
      }
    } catch (error) {
      if ((photoRevisions.get(photo.id) ?? 0) !== revision) continue;
      console.warn("galerie preview: cache read failed; regenerating", photo.path, error);
    }

    try {
      const bytes = await readFile(photo.readPath ?? photo.path);
      const raw = photo.format.startsWith("raw:");
      const { url, encoded, decodedRaw } = await generateThumbnail(
        bytes,
        raw,
        maxEdge,
        photo.readPath ?? photo.path,
        request.recipeJson,
        request.identity.scaleNumerator,
        request.identity.scaleDenominator,
      );
      if ((photoRevisions.get(photo.id) ?? 0) !== revision) {
        URL.revokeObjectURL(url);
        continue;
      }
      try {
        await previewPut(
          photo.id,
          kind,
          maxEdge,
          request.identity,
          decodedRaw ? rawFrameMetadata(decodedRaw) : null,
          encoded,
        );
      } catch (error) {
        console.warn("galerie preview: cache write failed", photo.path, error);
        let current: PreviewRequestV2;
        try {
          current = await previewRequest(photo.id, previewKind, maxEdge);
        } catch {
          URL.revokeObjectURL(url);
          return null;
        }
        if (
          (photoRevisions.get(photo.id) ?? 0) !== revision
          || current.cacheKey !== request.cacheKey
        ) {
          URL.revokeObjectURL(url);
          continue;
        }
      }
      if ((photoRevisions.get(photo.id) ?? 0) === revision) return url;
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error("galerie preview: failed", photo.path, error);
      return null;
    }
  }
  return null;
}

/** The engine's RAW proxy ceiling (raw_decode.rs PROXY_MAX_EDGE): preview
 *  requests above it are refused for RAW sources, so "1:1" for a big RAW means
 *  the largest decode the pipeline can actually deliver. */
export const RAW_PROXY_MAX_EDGE = 4096;

/** The largest preview edge worth requesting for a photo: native long edge,
 *  capped at the proxy ceiling for RAW. 0 when dimensions are unknown. */
export function previewTargetEdge(photo: PhotoRow): number {
  const full = Math.max(photo.width, photo.height);
  if (full <= 0) return 0;
  return photo.format.startsWith("raw:") ? Math.min(full, RAW_PROXY_MAX_EDGE) : full;
}

/** Progress + cancel hooks for a batch preview build — the caller owns the
 *  StatusBar job (see CatalogStore.runJob). Both optional. */
export interface PreviewProgress {
  onTick?: () => void;
  isCancelled?: () => boolean;
}

/** LR's Build Previews: warm the native preview cache for a batch, revoking
 *  the object URLs immediately (only the disk cache matters here). Injectable
 *  loader for tests. Stops between photos when the caller cancels. Returns the
 *  failure count (of the photos actually attempted). */
export async function buildPreviews(
  photos: readonly PhotoRow[],
  kind: string,
  maxEdge: number | ((p: PhotoRow) => number),
  load: typeof loadPreview = loadPreview,
  progress: PreviewProgress = {},
): Promise<number> {
  let failed = 0;
  for (const p of photos) {
    // Poll before each photo: a 20k build must stop on the next item, not at
    // the end of the batch.
    if (progress.isCancelled?.()) break;
    const url = await load(p, kind, typeof maxEdge === "function" ? maxEdge(p) : maxEdge);
    if (url) URL.revokeObjectURL(url);
    else failed++;
    progress.onTick?.();
  }
  return failed;
}
