// ─────────────────────────────────────────────────────────────
// follow.ts — pure target resolution for "Lock View to Selected".
//
// Unity's Shift+F locks the Scene view camera to the selected GameObject so it
// follows the object as it moves. Jouer mirrors this: when following is on, the
// editor camera tracks the first selected object each frame. This module just
// answers "which object should the camera follow right now?".
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

import type { Id } from "./types";

/** The object id the camera should follow, or null when following is off or
 *  nothing is selected. Follows the first selected object. */
export function followTargetId(following: boolean, selection: Id[]): Id | null {
  return following && selection.length > 0 ? selection[0] : null;
}
