// slideshow — the Slideshow module's playlist: derivation, ordering, advance,
// the Titles panel's Intro/Ending screens and Playback ▸ Fit to Music. The
// overlay component owns the timer; the saved look (Options / Layout /
// Overlays / Backdrop / Titles) lives in ui/slideshowStyle.

import type { PhotoRow } from "../catalog/types";

export const SLIDESHOW_INTERVAL_MS = 4000; // LR's default slide length

/** LR's Playback panel. `manual` disables the auto-advance timer entirely. */
export interface SlideshowOptions {
  durationMs: number;
  random: boolean;
  repeat: boolean;
  manual: boolean;
}

export const DEFAULT_SLIDESHOW_OPTIONS: SlideshowOptions = {
  durationMs: SLIDESHOW_INTERVAL_MS,
  random: false,
  repeat: true,
  manual: false,
};

/** LR semantics: play the selection when 2+ photos are selected, else the
 *  whole current view. Order follows the buffer (the active sort). */
export function slideshowPlaylist(
  photos: readonly PhotoRow[],
  selection: readonly number[],
): PhotoRow[] {
  if (selection.length > 1) {
    const sel = new Set(selection);
    return photos.filter((p) => sel.has(p.id));
  }
  return [...photos];
}

/** Playlist with LR's Random Order applied. Seeded so a given run keeps one
 *  stable order across re-renders instead of reshuffling every frame. */
export function orderedPlaylist(
  photos: readonly PhotoRow[],
  selection: readonly number[],
  opts: SlideshowOptions,
  seed = 1,
): PhotoRow[] {
  const list = slideshowPlaylist(photos, selection);
  if (!opts.random) return list;
  // Fisher-Yates driven by mulberry32 — ponytail: not crypto, just a stable shuffle.
  let s = seed >>> 0;
  const rand = () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list;
}

/** LR's Titles panel. Empty text = that screen is off. */
export interface SlideshowTitles {
  intro: string;
  ending: string;
}

/** One step of the show: a photo, or a Titles-panel screen. */
export type SlideEntry =
  | { kind: "photo"; photo: PhotoRow }
  | { kind: "title"; role: "intro" | "ending"; text: string };

/** The ordered playlist wrapped in its Intro/Ending screens. Titles only bracket
 *  a non-empty playlist — a show with no photos has nothing to introduce. */
export function slideSequence(
  photos: readonly PhotoRow[],
  titles: SlideshowTitles,
): SlideEntry[] {
  if (photos.length === 0) return [];
  const seq: SlideEntry[] = photos.map((photo) => ({ kind: "photo", photo }));
  if (titles.intro.trim() !== "") seq.unshift({ kind: "title", role: "intro", text: titles.intro });
  if (titles.ending.trim() !== "") seq.push({ kind: "title", role: "ending", text: titles.ending });
  return seq;
}

/** LR's Playback ▸ Fit to Music: the slide length that makes `count` slides span
 *  the track. Rounded to 100ms and clamped to the duration slider's 1–20s range
 *  — a three-slide show can't stretch across a six-minute track, so past the
 *  clamp the music simply outlasts (or is outlasted by) the show. */
export function fitToMusicDurationMs(trackMs: number, count: number): number {
  if (!Number.isFinite(trackMs) || trackMs <= 0 || count <= 0) return SLIDESHOW_INTERVAL_MS;
  const per = Math.round(trackMs / count / 100) * 100;
  return Math.min(20_000, Math.max(1000, per));
}

/** Cyclic advance in either direction; empty playlists pin to 0. */
export const nextSlide = (i: number, len: number, step: 1 | -1 = 1): number =>
  len <= 0 ? 0 : (i + step + len) % len;

/** Advance honouring LR's Repeat: `null` means the playlist ran off its end
 *  (repeat off), which the overlay treats as "pause on the last slide". */
export const advanceSlide = (
  i: number,
  len: number,
  repeat: boolean,
  step: 1 | -1 = 1,
): number | null => {
  if (len <= 0) return null;
  const n = i + step;
  if (n >= 0 && n < len) return n;
  return repeat ? nextSlide(i, len, step) : null;
};
