// oplog — a synced, append-only operation log over a Yjs array. The substrate
// for OPERATION-based collaboration (e.g. Monet Vision brush strokes), where
// reflecting whole document state is wrong: raster pixels live in WASM memory and
// change per-stroke, so peers exchange the strokes themselves and replay them.
// Each op is tagged with its author's clientId so a peer ignores its own echoes.
//
// This is the "stroke-operation channel" the collab design doc calls for as the
// path to collaborative raster painting (Vision, §6 of the engine merge doc).

import * as Y from "yjs";

interface Entry<T> {
  c: number; // author clientId
  op: T;
}

export interface OpLogOptions {
  /** Resolves when the room's initial sync has landed — pass `session.whenSynced()`.
   *  Everything already in the log at that moment is HISTORY and is NOT delivered
   *  to `onRemoteOp` (use `replayAll` to reconstruct state from it).
   *
   *  Without it the constructor's cursor is a snapshot of a doc that has not
   *  synced yet — always 0 — so the whole room history arrives through
   *  `onRemoteOp` as if it had just been drawn, and a late joiner that also calls
   *  `replayAll` applies every op twice (#229). */
  synced?: Promise<void>;
}

export class OpLog<T> {
  private readonly arr: Y.Array<Entry<T>>;
  private readonly listeners = new Set<(op: T, clientId: number) => void>();
  private cursor: number;
  /** False until `opts.synced` resolves: pre-sync ops are history, not live. */
  private live: boolean;

  constructor(doc: Y.Doc, private readonly clientId: number, name = "ops", opts: OpLogOptions = {}) {
    this.arr = doc.getArray<Entry<T>>(name);
    // Only deliver ops appended from here on. With `opts.synced` "here" is the
    // moment the room synced; without it, construction time (fine for a doc that
    // is already populated, but see OpLogOptions.synced).
    this.cursor = this.arr.length;
    this.live = !opts.synced;
    void opts.synced?.then(() => {
      this.cursor = this.arr.length;
      this.live = true;
    });
    this.arr.observe(() => this.drain());
  }

  private drain(): void {
    if (!this.live) return;
    const items = this.arr.toArray();
    for (; this.cursor < items.length; this.cursor++) {
      const e = items[this.cursor];
      if (e.c !== this.clientId) {
        for (const l of this.listeners) l(e.op, e.c);
      }
    }
  }

  /** Append a local operation — broadcast to all peers. */
  push(op: T): void {
    this.arr.push([{ c: this.clientId, op }]);
  }

  /** Subscribe to remote peers' operations (never your own echoes). */
  onRemoteOp(fn: (op: T, clientId: number) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  /** Replay every op in the log (including history) — for a late-joiner that
   *  reconstructs state from the op stream. Consumes the log up to here, so an
   *  op can never be delivered twice (once by replay, once by `onRemoteOp`) — the
   *  double-application the doc comment's own recipe used to invite (#229). */
  replayAll(fn: (op: T, clientId: number) => void): void {
    const items = this.arr.toArray();
    this.cursor = items.length;
    for (const e of items) fn(e.op, e.c);
  }

  /** Number of ops in the log. */
  get length(): number {
    return this.arr.length;
  }
}
