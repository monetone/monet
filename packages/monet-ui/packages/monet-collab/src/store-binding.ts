// store-binding — connect an app's document store to a CollabSession. The app
// keeps its whole-state `mutate(...)` model; this bridges it to the Yjs CRDT:
//   local edit  → reconcile(root, getDoc())     (tagged LOCAL_ORIGIN)
//   remote edit → applyRemote(materialize(root))
// Echoes are suppressed via the transaction origin + an `applyingRemote` guard.

import * as Y from "yjs";
import { materialize, reconcile, type Plain } from "./reflect.js";
import { CollabSession, LOCAL_ORIGIN } from "./session.js";

/** The minimal surface a store must expose to participate in collaboration. */
export interface CollabStoreAdapter<P> {
  /** The current plain document (JSON-serializable tree). */
  getDoc(): P;
  /** Replace the document from a remote update — must NOT push undo or re-emit
   *  a change that would loop back (the binding guards re-entry, but this should
   *  be a quiet "adopt this state" that still refreshes the UI). */
  applyRemote(doc: P): void;
  /** Subscribe to local document changes; return an unsubscribe fn. */
  subscribe(fn: () => void): () => void;
}

/**
 * Bind `store` to `session`. On the first server sync, an empty room is seeded
 * from the local document; a non-empty room is adopted into the store. Returns
 * an unbind function. Safe to call before connection — it waits for sync.
 */
/** Origin for the one-off seed of an empty room. Deliberately NOT `LOCAL_ORIGIN`
 *  (#227): the session's UndoManager tracks that origin, so seeding with it made
 *  the whole document the first undoable item — the first `session.undo()` reset
 *  the room to `{}`, for every peer, and the store adopted the wipe. Only local
 *  EDITS are undoable; joining a room is not an edit. */
const SEED_ORIGIN = Symbol("monet-collab/seed");

export function bindStore<P extends { [k: string]: Plain }>(
  session: CollabSession,
  store: CollabStoreAdapter<P>,
): () => void {
  const { doc, root } = session;
  let applyingRemote = false;
  let unsubStore: (() => void) | null = null;
  let disposed = false;

  const pushLocal = () => {
    if (applyingRemote) return; // don't echo a remote update back out
    doc.transact(() => reconcile(root, store.getDoc()), LOCAL_ORIGIN);
  };

  const pullRemote = (events: Y.YEvent<Y.AbstractType<unknown>>[], txn: Y.Transaction) => {
    if (txn.origin === LOCAL_ORIGIN) return; // our own write echoing back
    void events;
    applyingRemote = true;
    try {
      store.applyRemote(materialize(root) as unknown as P);
    } finally {
      applyingRemote = false;
    }
  };

  void session.whenSynced().then(() => {
    if (disposed) return;
    if (root.size === 0) {
      // First peer in the room — seed it with the local document.
      doc.transact(() => reconcile(root, store.getDoc()), SEED_ORIGIN);
    } else {
      // Room already has a document — adopt it locally.
      applyingRemote = true;
      try {
        store.applyRemote(materialize(root) as unknown as P);
      } finally {
        applyingRemote = false;
      }
    }
    root.observeDeep(pullRemote);
    unsubStore = store.subscribe(pushLocal);
  });

  return () => {
    disposed = true;
    root.unobserveDeep(pullRemote);
    unsubStore?.();
  };
}
