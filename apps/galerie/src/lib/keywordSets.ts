// keywordSets — Lightroom Classic "Keyword Sets" (Keywording panel).
//
// A keyword set is a named list of up to nine keyword strings, surfaced as a
// quick-apply grid at the bottom of the keyword UI. LR ships built-in sets
// (Outdoor / Portrait / Wedding) plus a computed "Recent Keywords" set showing
// the nine most recently applied keywords, which "can't be deleted".
//
// Pure model + a session-scoped, reactive recents ring. The recents ring is fed
// from the single catalog chokepoint (catalog.addKeyword) so *every* apply path
// (Keywording bar, Painter, …) contributes; UI subscribes via useSyncExternalStore.

export interface KeywordSet {
  /** Display name in the set picker. */
  name: string;
  /** Up to nine keyword names; grid slots fill left-to-right, top-to-bottom. */
  keywords: string[];
}

/** Minimal shape of a tagged keyword (structural — avoids a catalog import). */
export interface NamedKeyword {
  id: number;
  name: string;
}

/** LR caps a keyword set at nine slots. */
export const MAX_KEYWORDS = 9;

/** The special computed set (nine most recently applied keywords). */
export const RECENT_SET_NAME = "Recent Keywords";

/** Normalize a keyword-name list for a set: trim, drop blanks, case-insensitive
 *  dedup (first occurrence wins), cap at MAX_KEYWORDS. */
export function clampKeywords(names: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const raw of names) {
    const name = raw.trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
    if (out.length >= MAX_KEYWORDS) break;
  }
  return out;
}

/** LR's built-in keyword sets (excluding the computed Recent Keywords). */
export const BUILT_IN_SETS: KeywordSet[] = [
  {
    name: "Outdoor Photography",
    keywords: ["Landscape", "Wildlife", "Sunset", "Mountains", "Water", "Forest", "Sky", "Snow", "Beach"],
  },
  {
    name: "Portrait Photography",
    keywords: ["Headshot", "Candid", "Studio", "Environmental", "Group", "Child", "Family", "Fashion", "Black & White"],
  },
  {
    name: "Wedding Photography",
    keywords: ["Ceremony", "Reception", "Bride", "Groom", "Rings", "Bouquet", "First Dance", "Cake", "Venue"],
  },
];

/** Is `name` already among `current` (case-insensitive)? Drives set-button highlight. */
export function isApplied(current: readonly NamedKeyword[], name: string): boolean {
  const key = name.trim().toLowerCase();
  return current.some((c) => c.name.toLowerCase() === key);
}

/** What a set-button click should do: remove the matching keyword if present,
 *  else add it. Pure — the UI performs the catalog call. */
export type KeywordToggle = { action: "add"; name: string } | { action: "remove"; id: number };
export function toggleKeyword(current: readonly NamedKeyword[], name: string): KeywordToggle {
  const trimmed = name.trim();
  const key = trimmed.toLowerCase();
  const hit = current.find((c) => c.name.toLowerCase() === key);
  return hit ? { action: "remove", id: hit.id } : { action: "add", name: trimmed };
}

// ── Recent keywords (reactive session ring) ─────────────────────────────────

/** Push a freshly-applied keyword onto a most-recent-first history: dedup
 *  case-insensitively, cap at MAX_KEYWORDS. Pure — returns a new array (or the
 *  same reference when nothing changes, e.g. a blank name). */
export function pushRecent(history: string[], name: string): string[] {
  const trimmed = name.trim();
  if (!trimmed) return history;
  const key = trimmed.toLowerCase();
  return [trimmed, ...history.filter((h) => h.toLowerCase() !== key)].slice(0, MAX_KEYWORDS);
}

// ponytail: session-only recents (in-memory ring). Persist to the catalog when
// cross-session "Recent Keywords" is actually asked for.
let recent: string[] = [];
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

/** Subscribe to recents changes (useSyncExternalStore) — returns an unsubscribe. */
export function subscribeRecent(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** Record that a keyword was applied (feeds the Recent Keywords set + notifies). */
export function recordKeywordUse(name: string): void {
  const next = pushRecent(recent, name);
  if (next === recent) return; // blank / no-op
  recent = next;
  emit();
}

/** The nine most recently applied keywords, most-recent-first. Stable reference
 *  between changes (safe as a useSyncExternalStore snapshot). */
export function recentKeywords(): string[] {
  return recent;
}

/** Reset the recent-keywords ring (tests / catalog switch). */
export function resetRecentKeywords(): void {
  if (recent.length === 0) return;
  recent = [];
  emit();
}

/** All keyword sets for the picker: Recent Keywords first, then the built-ins.
 *  Pass an explicit `recentList` (e.g. a subscribed snapshot) or default to the ring. */
export function keywordSets(recentList: string[] = recentKeywords()): KeywordSet[] {
  return [{ name: RECENT_SET_NAME, keywords: recentList }, ...BUILT_IN_SETS];
}
