// ─────────────────────────────────────────────────────────────
// registry.ts — runtime media handles, kept OUT of the serializable project
// (and out of undo). Maps mediaId → { objectUrl, a hidden HTMLVideoElement /
// HTMLAudioElement used for decode + audio playback, poster thumb, audio peaks }.
// The bin / decoder read from here; arrivals call store.bump() to repaint
// without creating an undo step.
// ─────────────────────────────────────────────────────────────

import { store } from "../state/app";

export interface MediaHandle {
  objectUrl: string;
  /** Hidden element used for seek+draw decode and audio playback. */
  el?: HTMLVideoElement | HTMLAudioElement;
  /** True once the element fired loadedmetadata / canplay. */
  loaded: boolean;
  thumb?: string;
  peaks?: Float32Array;
}

const handles = new Map<string, MediaHandle>();

export function setHandle(mediaId: string, handle: MediaHandle): void {
  handles.set(mediaId, handle);
}

export function getHandle(mediaId: string): MediaHandle | undefined {
  return handles.get(mediaId);
}

export function forEachHandle(fn: (h: MediaHandle) => void): void {
  handles.forEach(fn);
}

export function setThumb(mediaId: string, thumb: string): void {
  const h = handles.get(mediaId);
  if (h) {
    h.thumb = thumb;
    store.bump();
  }
}

export function setPeaks(mediaId: string, peaks: Float32Array): void {
  const h = handles.get(mediaId);
  if (h) {
    h.peaks = peaks;
    store.bump();
  }
}

export function evictHandle(mediaId: string): void {
  const h = handles.get(mediaId);
  if (h) {
    try {
      URL.revokeObjectURL(h.objectUrl);
    } catch {
      /* already revoked */
    }
    handles.delete(mediaId);
  }
}

export function clearHandles(): void {
  for (const id of [...handles.keys()]) evictHandle(id);
}
