// presence — the ephemeral, per-user "awareness" state (NOT part of the synced
// document): who is here, where their cursor is, and what they have selected.
// Carried over the Yjs awareness channel, not the document CRDT.

/** A collaborator's identity. `color` drives their cursor/selection tint. */
export interface CollabUser {
  id: string;
  name: string;
  /** CSS color for this user's cursor/selection (e.g. "#e8590c"). */
  color: string;
}

/** A cursor position in the document's own coordinate space (world coords). The
 *  app maps this to screen pixels when rendering, so it stays correct under
 *  pan/zoom and across differing viewport sizes. */
export interface PresenceCursor {
  x: number;
  y: number;
}

/** The local user's published awareness state. */
export interface Presence {
  user: CollabUser;
  cursor?: PresenceCursor | null;
  /** Ids of the entities this user has selected. */
  selection?: string[];
}

/** A remote peer's presence, tagged with their Yjs client id. */
export interface PeerPresence extends Presence {
  clientId: number;
}
