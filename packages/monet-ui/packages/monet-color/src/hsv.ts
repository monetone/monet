/** Canonical HSV color: h 0..360, s/v 0..1, alpha 0..1 (treated as 1 when
 *  omitted). Framework-free twin of monet-react's HSV so this package stays a
 *  leaf; the two are structurally identical and interchange freely. */
export interface HSV { h: number; s: number; v: number; a?: number; }
