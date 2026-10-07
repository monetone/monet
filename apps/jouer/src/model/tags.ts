// ─────────────────────────────────────────────────────────────
// tags.ts — pure helpers for Unity-style object Tags.
//
// A tag is an identification label assigned to objects (Unity's GameObject.tag,
// queried at runtime via CompareTag / FindWithTag). The project owns the list of
// available tags ("Untagged" always present) and each object carries an optional
// `tag` (omitted ⇒ "Untagged"). Tags are the sibling of Sorting Layers — both
// live in Unity's "Tags and Layers" — but a tag is metadata, not render order,
// so it's exported as Phaser object data rather than affecting depth.
//
// Nothing in this module imports React, Phaser, or the DOM.
// ─────────────────────────────────────────────────────────────

export const DEFAULT_TAG = "Untagged";

/** The project's tags — always non-empty and containing "Untagged". */
export function projectTags(project: { tags?: string[] }): string[] {
  const ts = project.tags;
  if (!ts || ts.length === 0) return [DEFAULT_TAG];
  return ts.includes(DEFAULT_TAG) ? ts : [DEFAULT_TAG, ...ts];
}

/** An object's tag, defaulting to "Untagged" when unset. */
export function tagOf(o: { tag?: string }): string {
  return o.tag ?? DEFAULT_TAG;
}
