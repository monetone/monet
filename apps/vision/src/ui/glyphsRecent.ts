// Type ▸ Glyphs: the panel's "Recently Used" row. Photoshop keeps the glyphs you
// last inserted across sessions, so this persists to localStorage like the
// script-event bindings in Dialogs.tsx. Lives in its own module (rather than
// inline in Dialogs.tsx) so the ordering rule is unit-testable in the node env.

const KEY = "mv.recentGlyphs";
export const RECENT_GLYPHS_MAX = 12;

/** The list with `ch` promoted to the front: most-recent-first, de-duplicated,
 *  capped at one row. Pure. */
export function pushRecentGlyph(list: readonly string[], ch: string): string[] {
  if (!ch) return [...list];
  return [ch, ...list.filter((g) => g !== ch)].slice(0, RECENT_GLYPHS_MAX);
}

/** The persisted row, or empty when storage is unavailable or holds junk. */
export function loadRecentGlyphs(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((g): g is string => typeof g === "string" && g.length > 0)
      .slice(0, RECENT_GLYPHS_MAX);
  } catch { return []; }
}

export function saveRecentGlyphs(list: readonly string[]) {
  try { localStorage.setItem(KEY, JSON.stringify(list)); } catch { /* storage may be unavailable */ }
}
