// ─────────────────────────────────────────────────────────────
// body.ts — pure helpers for the physics-body component (Unity's
// Rigidbody2D/Collider2D). Framework-free; no React/Phaser/store.
// ─────────────────────────────────────────────────────────────

import type { GameObject, PhysicsBody } from "./types";

/** The physics body to assign when pasting `body` onto `target` — Unity's "Paste
 *  Component Values" for the Rigidbody/Collider. Containers carry no physics
 *  body, so they yield null (skip); every other kind gets an independent deep
 *  clone so pasted bodies never share mutable state with the source. */
export function bodyForPaste(target: GameObject, body: PhysicsBody): PhysicsBody | null {
  if (target.kind === "container") return null;
  return structuredClone(body);
}
