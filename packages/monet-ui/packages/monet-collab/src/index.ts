// @monet-ui/monet-collab — real-time collaboration substrate for Monet apps.
// Bind a document store to a Yjs CRDT synced over a backend, with awareness-based
// presence (live cursors + selection). Opt-in; the React presence UI is the
// separate "@monet-ui/monet-collab/react" entry.

export { materialize, reconcile, type Plain } from "./reflect.js";
export { CollabSession, type CollabOptions, type CollabUser, type ConnectionStatus } from "./session.js";
export {
  type Presence,
  type PresenceCursor,
  type PeerPresence,
} from "./presence.js";
export { bindStore, type CollabStoreAdapter } from "./store-binding.js";
export { BlobStore } from "./blobs.js";
export { OpLog } from "./oplog.js";
