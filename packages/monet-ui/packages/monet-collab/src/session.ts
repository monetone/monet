// session — a live collaboration session over a Yjs document: the shared CRDT
// doc, the WebSocket transport, and the awareness (presence) channel. One
// session = one open `.monet` document/room.

import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
import { BlobStore } from "./blobs.js";
import type { CollabUser, PeerPresence, PresenceCursor } from "./presence.js";

export type { CollabUser } from "./presence.js";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";

export interface CollabOptions {
  /** Room / document id — collaborators sharing this string edit the same doc. */
  room: string;
  /** y-websocket server URL, e.g. "ws://localhost:1234". */
  wsUrl: string;
  /** Local user identity (drives their cursor color/label). */
  user: CollabUser;
  /** Connect immediately (default true). */
  connect?: boolean;
  /** Auth token, sent as `?token=` — must match the server's COLLAB_TOKEN when set. */
  token?: string;
}

/** Transaction origin tag for our own (local→Y) writes, so the binding can
 *  ignore the echo and only react to genuinely remote updates. */
export const LOCAL_ORIGIN = Symbol("monet-collab/local");

export class CollabSession {
  readonly doc: Y.Doc;
  /** The document root the store reflects into (see `bindStore`). */
  readonly root: Y.Map<unknown>;
  readonly provider: WebsocketProvider;
  readonly user: CollabUser;
  /** Collaborative, per-user undo: tracks only THIS client's local writes
   *  (origin === LOCAL_ORIGIN), so `undo()` reverts your own edits and never a
   *  collaborator's, even after their changes have merged in between. */
  readonly undoManager: Y.UndoManager;
  /** Out-of-band content-addressed store for large binary (PCM/images) that must
   *  not live in the document tree — see `BlobStore` and Rythme's adapter. */
  readonly blobs: BlobStore;

  private statusListeners = new Set<(s: ConnectionStatus) => void>();
  private presenceListeners = new Set<(peers: PeerPresence[]) => void>();

  constructor(opts: CollabOptions) {
    this.user = opts.user;
    this.doc = new Y.Doc();
    this.root = this.doc.getMap("doc");
    this.provider = new WebsocketProvider(opts.wsUrl, opts.room, this.doc, {
      connect: opts.connect ?? true,
      params: opts.token ? { token: opts.token } : undefined,
    });
    this.provider.awareness.setLocalStateField("user", opts.user);
    this.undoManager = new Y.UndoManager(this.root, {
      trackedOrigins: new Set([LOCAL_ORIGIN]),
    });
    this.blobs = new BlobStore(this.doc.getMap<string>("blobs"));

    this.provider.on("status", (e: { status: ConnectionStatus }) => {
      for (const l of this.statusListeners) l(e.status);
    });
    this.provider.awareness.on("change", () => {
      const peers = this.peers();
      for (const l of this.presenceListeners) l(peers);
    });
  }

  /** Undo the local user's last edit (no-op if nothing to undo). The revert is a
   *  normal CRDT update — it syncs to peers and the store adopts it via the
   *  binding's remote path (it is not tagged LOCAL_ORIGIN, so it isn't tracked
   *  as a new undoable edit). */
  undo(): void {
    this.undoManager.undo();
  }

  /** Redo the local user's last undone edit (no-op if nothing to redo). */
  redo(): void {
    this.undoManager.redo();
  }

  canUndo(): boolean {
    return this.undoManager.canUndo();
  }

  canRedo(): boolean {
    return this.undoManager.canRedo();
  }

  /** Has the initial sync with the server completed? Resolves once, then stays resolved. */
  whenSynced(): Promise<void> {
    if (this.provider.synced) return Promise.resolve();
    return new Promise((resolve) => this.provider.once("sync", () => resolve()));
  }

  onStatus(fn: (s: ConnectionStatus) => void): () => void {
    this.statusListeners.add(fn);
    return () => this.statusListeners.delete(fn);
  }

  /** Subscribe to remote peers' presence (cursors/selection). Fires on any change. */
  onPresence(fn: (peers: PeerPresence[]) => void): () => void {
    this.presenceListeners.add(fn);
    return () => this.presenceListeners.delete(fn);
  }

  /** All remote peers' presence (excludes the local user). */
  peers(): PeerPresence[] {
    const out: PeerPresence[] = [];
    const local = this.doc.clientID;
    for (const [clientId, state] of this.provider.awareness.getStates() as Map<number, Partial<PeerPresence>>) {
      if (clientId === local || !state.user) continue;
      out.push({ clientId, user: state.user, cursor: state.cursor ?? null, selection: state.selection ?? [] });
    }
    return out;
  }

  /** Publish the local cursor position (document/world coords), or null to hide it. */
  setCursor(cursor: PresenceCursor | null): void {
    this.provider.awareness.setLocalStateField("cursor", cursor);
  }

  /** Publish the local selection (entity ids). */
  setSelection(ids: string[]): void {
    this.provider.awareness.setLocalStateField("selection", ids);
  }

  destroy(): void {
    this.statusListeners.clear();
    this.presenceListeners.clear();
    this.undoManager.destroy();
    this.provider.destroy();
    this.doc.destroy();
  }
}
