// photoBadges — the flag / rating / colour-label badges a photo shows, shared by
// the Library grid cell and the filmstrip. Kept pure (no React) so it's unit-
// tested; the two call sites render from the descriptor it returns.

import type { MetadataStatus } from "../lib/metadataStatus";

/** Colour-label name → swatch colour. Unknown names get no swatch. */
export const LABEL_COLORS: Record<string, string> = {
  red: "#e5484d",
  yellow: "#f5d90a",
  green: "#46a758",
  blue: "#3b82f6",
  purple: "#8b5cf6",
};

export interface Badges {
  /** -1 reject, 0 unflagged, 1 pick. */
  flag: number;
  /** 0–5 stars. */
  rating: number;
  /** Resolved label swatch colour, or null for no / unknown label. */
  labelColor: string | null;
}

/** Which badges a photo shows. `labelColor` is resolved through LABEL_COLORS. */
export function photoBadges(photo: { flag: number; rating: number; colorLabel: string | null }): Badges {
  return {
    flag: photo.flag,
    rating: photo.rating,
    labelColor: photo.colorLabel ? (LABEL_COLORS[photo.colorLabel] ?? null) : null,
  };
}

/** True when a photo has at least one badge worth drawing. */
export function hasBadges(b: Badges): boolean {
  return b.flag !== 0 || b.rating > 0 || b.labelColor !== null;
}

/** Metadata-status badge (LR's grid arrows): glyph + tooltip, or null when
 *  there is nothing to warn about (synced / never synced). */
export function metadataStatusBadge(
  status: MetadataStatus,
): { glyph: string; label: string } | null {
  switch (status) {
    case "catalogNewer":
      return { glyph: "↑", label: "Metadata changed in catalog — not saved to file" };
    case "fileNewer":
      return { glyph: "↓", label: "Metadata file changed on disk — not read into catalog" };
    case "conflict":
      return { glyph: "⇅", label: "Metadata conflict — catalog and file both changed" };
    default:
      return null;
  }
}
