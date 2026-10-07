// quickCollection — Lightroom Classic "Quick Collection" + "Target Collection".
//
// The Quick Collection is a built-in temporary collection you toggle photos into
// with the B key (Catalog panel). Any collection can be designated the Target
// Collection; then B adds to that instead.
//
// Pure decisions only — the store performs the catalog membership calls. The
// Quick Collection is reserved by a sentinel name (kind "collection") so no
// schema/Rust change is needed.

import type { CollectionRow } from "../catalog/types";

/** Reserved name for the built-in Quick Collection (LR's default B-key target). */
export const QUICK_COLLECTION_NAME = "Quick Collection";

// ponytail: reserved by name — a user collection named exactly "Quick Collection"
// would collide. Promote to a dedicated kind/flag if that ever matters.
export function findQuickCollection(collections: readonly CollectionRow[]): CollectionRow | undefined {
  return collections.find((c) => c.kind === "collection" && c.name === QUICK_COLLECTION_NAME);
}

/** The effective B-key target id: the explicit Target Collection if it still
 *  exists, else the Quick Collection (LR default). null when neither exists. */
export function resolveTargetId(
  collections: readonly CollectionRow[],
  targetCollectionId: number | null,
  quickId: number | null,
): number | null {
  if (targetCollectionId != null && collections.some((c) => c.id === targetCollectionId)) {
    return targetCollectionId;
  }
  return quickId;
}

/** LR "add to target" toggle over a selection: if EVERY selected photo is already
 *  a member, remove them all; otherwise add the ones that are still missing. */
export type MembershipToggle = { action: "add" | "remove"; ids: number[] };
export function membershipToggle(
  memberIds: readonly number[],
  selection: readonly number[],
): MembershipToggle {
  const members = new Set(memberIds);
  const sel = [...new Set(selection)];
  if (sel.length === 0) return { action: "add", ids: [] };
  const allMembers = sel.every((id) => members.has(id));
  if (allMembers) return { action: "remove", ids: sel };
  return { action: "add", ids: sel.filter((id) => !members.has(id)) };
}
