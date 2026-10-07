// ─────────────────────────────────────────────────────────────
// libraries.ts — a local, cross-document asset library (a CC-Libraries analog).
// Reusable graphics captured from any document, persisted to localStorage as
// downscaled PNG data URLs so they survive across sessions and documents.
// Pure storage helpers so they unit-test in node; capture/insert live in app.ts.
// ─────────────────────────────────────────────────────────────

import { persistLocalStorage } from "./persistLocalStorage";

export interface LibraryGraphic {
  id: string;
  name: string;
  dataUrl: string; // image/png data URL (downscaled thumbnail-ish)
  w: number;
  h: number;
}

const KEY = "mv.library";
export const MAX_ASSETS = 24;

/** A stored entry only counts when it can actually be drawn — `insert` feeds
 *  `dataUrl` straight to an Image, so a truncated/foreign value must not survive
 *  the load as a half-built graphic. (#137) */
function isGraphic(g: unknown): g is LibraryGraphic {
  const x = g as Partial<LibraryGraphic> | null;
  return !!x && typeof x.id === "string" && typeof x.dataUrl === "string"
    && typeof x.name === "string" && Number.isFinite(x.w) && Number.isFinite(x.h);
}

export function loadLibrary(): LibraryGraphic[] {
  try {
    const s = localStorage.getItem(KEY);
    if (!s) return [];
    const list = JSON.parse(s) as unknown;
    return Array.isArray(list) ? list.filter(isGraphic) : [];
  } catch { return []; }
}

/** False when the list was NOT persisted (quota exceeded / storage unavailable).
 *  The caller has to surface that: a capture the panel shows but storage never
 *  took disappears on reload, and every later capture fails the same way. (#137) */
export function saveLibrary(list: LibraryGraphic[]): boolean {
  return persistLocalStorage(KEY, JSON.stringify(list.slice(0, MAX_ASSETS)));
}

/** Prepend a graphic, dedupe by id, cap the count. Pure. */
export function addGraphic(list: LibraryGraphic[], g: LibraryGraphic): LibraryGraphic[] {
  return [g, ...list.filter((x) => x.id !== g.id)].slice(0, MAX_ASSETS);
}

export function removeGraphic(list: LibraryGraphic[], id: string): LibraryGraphic[] {
  return list.filter((x) => x.id !== id);
}
