// ─────────────────────────────────────────────────────────────
// decoder.ts — frame decode into the frame-source cache.
//
// Two paths share one element per media (registry):
//  • Scrub / export: seek to the source frame's time, await `seeked`, capture.
//    Seeks per media are serialized + deduped; `ensureFrameDecoded` is awaitable
//    (used by the offline export render).
//  • Live playback: `livePlaybackTick` plays the element natively (the browser's
//    realtime decoder) and captures the current frame each RAF — far smoother
//    than per-frame seeking. The player owns this; the ProgramMonitor only
//    seek-decodes while paused so the two never fight over `currentTime`.
//
// Captures are downscaled to ≤ MAX_W (the compositor maps by native size, so
// this only trades preview sharpness for speed). WebCodecs VideoDecoder + a
// demuxer is the further upgrade for codec-accurate realtime (see AGENTS.md).
// ─────────────────────────────────────────────────────────────

import { store } from "../state/app";
import { getFrame, putFrame } from "../playback/frame-source";
import { collectVideoSpecs } from "../playback/transition-specs";
import type { MediaItem, Sequence } from "../timeline/model/types";
import { findMedia } from "../timeline/model/query";
import { forEachHandle, getHandle } from "./registry";

const MAX_W = 1280;
const scratch = typeof document !== "undefined" ? document.createElement("canvas") : null;
const sctx = scratch ? scratch.getContext("2d", { willReadFrequently: true }) : null;

const queues = new Map<string, Promise<void>>();
const inflight = new Set<string>();

function once(el: HTMLMediaElement, event: string, timeoutMs = 2000): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      el.removeEventListener(event, finish);
      resolve();
    };
    el.addEventListener(event, finish, { once: true });
    setTimeout(finish, timeoutMs);
  });
}

function capDims(w: number, h: number): [number, number] {
  if (w <= MAX_W) return [w, h];
  const s = MAX_W / w;
  return [MAX_W, Math.max(1, Math.round(h * s))];
}

/** Draw the element's current frame into the cache under (mediaId, sourceFrame). */
function capture(el: HTMLVideoElement, media: MediaItem, sourceFrame: number): void {
  if (!sctx) return;
  const nw = media.width || el.videoWidth;
  const nh = media.height || el.videoHeight;
  if (!nw || !nh) return;
  const [w, h] = capDims(nw, nh);
  scratch!.width = w;
  scratch!.height = h;
  try {
    sctx.drawImage(el, 0, 0, w, h);
    const img = sctx.getImageData(0, 0, w, h);
    putFrame(media.id, sourceFrame, { data: img.data, width: w, height: h });
  } catch {
    /* element not ready for drawImage */
  }
}

async function decodeOne(media: MediaItem, sourceFrame: number): Promise<void> {
  const h = getHandle(media.id);
  if (!(h?.el instanceof HTMLVideoElement)) return;
  const v = h.el;
  if (v.readyState < 1) await once(v, "loadedmetadata");
  const t = sourceFrame / (media.fps || 24);
  v.currentTime = Math.min(Math.max(0, t), v.duration || t);
  await once(v, "seeked");
  capture(v, media, sourceFrame);
}

/** Request a seek-decode (fire-and-forget). Cached / in-flight are ignored. */
export function requestFrame(media: MediaItem, sourceFrame: number): void {
  if (media.kind !== "video") return;
  const key = `${media.id}@${sourceFrame}`;
  if (inflight.has(key) || getFrame(media.id, sourceFrame)) return;
  inflight.add(key);
  const prev = queues.get(media.id) ?? Promise.resolve();
  const next = prev
    .then(() => decodeOne(media, sourceFrame))
    .then(() => store.bump())
    .finally(() => inflight.delete(key));
  queues.set(media.id, next);
}

/** Awaitable decode — resolves once the frame is in the cache (used by export). */
export function ensureFrameDecoded(media: MediaItem, sourceFrame: number): Promise<void> {
  if (media.kind !== "video" || getFrame(media.id, sourceFrame)) return Promise.resolve();
  const prev = queues.get(media.id) ?? Promise.resolve();
  const next = prev.then(() => decodeOne(media, sourceFrame));
  queues.set(media.id, next);
  return next;
}

/** Queue seek-decodes for every layer (incl. transition partners) at `playhead`. */
export function scheduleDecodesFor(seq: Sequence, playhead: number): void {
  for (const spec of collectVideoSpecs(seq, playhead)) {
    if (spec.clip.kind !== "video") continue;
    const media = findMedia(store.getProject(), spec.clip.mediaId);
    if (media) requestFrame(media, spec.sampleFrame);
  }
}

/** Per-RAF live capture during playback: play each visible video element
 *  natively, nudge it into sync, and snapshot the current frame. */
export function livePlaybackTick(seq: Sequence, playhead: number): void {
  for (const spec of collectVideoSpecs(seq, playhead)) {
    if (spec.clip.kind !== "video") continue;
    const media = findMedia(store.getProject(), spec.clip.mediaId);
    if (!media) continue;
    const el = getHandle(media.id)?.el;
    if (!(el instanceof HTMLVideoElement)) continue;
    if (el.readyState < 2) continue; // buffering — let it fill
    const rate = Math.abs(spec.clip.speed) || 1;
    if (el.playbackRate !== rate) el.playbackRate = rate;
    if (el.paused) void el.play().catch(() => {});
    const expected = spec.sampleFrame / (media.fps || 24);
    if (Math.abs(el.currentTime - expected) > 0.2) {
      try {
        el.currentTime = expected;
      } catch {
        /* ignore */
      }
    }
    capture(el, media, spec.sampleFrame);
  }
}

/** Pause every media element (called when transport stops). */
export function pausePlaybackElements(): void {
  forEachHandle((h) => {
    if (h.el) {
      try {
        h.el.pause();
      } catch {
        /* ignore */
      }
    }
  });
}
