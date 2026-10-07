// ─────────────────────────────────────────────────────────────
// Default colors — pure helper for Photoshop's D shortcut. Resets to black
// foreground / white background, but inverted (white fg / black bg) while a mask
// is the active edit target (masks are grayscale where white reveals). Engine-free
// (type-only HSV import) so it unit-tests in node; callers pass the result to
// store.setForeground / store.setBackground.
// ─────────────────────────────────────────────────────────────

import type { HSV } from "./hsv";

const black = (): HSV => ({ h: 0, s: 0, v: 0, a: 1 });
const white = (): HSV => ({ h: 0, s: 0, v: 1, a: 1 });

/** Photoshop default colours: black fg / white bg, inverted to white fg / black bg
 *  while editing a layer mask. In Quick Mask the paint target is the rubylith
 *  channel (black adds to the mask), so D resets to the normal black fg / white bg
 *  — not the inverted pair. Returns fresh objects each call (callers must not share
 *  mutable colour refs). */
export function defaultColors(maskEdit: boolean, quickMask = false): { fg: HSV; bg: HSV } {
  if (quickMask) return { fg: black(), bg: white() };
  return maskEdit ? { fg: white(), bg: black() } : { fg: black(), bg: white() };
}
