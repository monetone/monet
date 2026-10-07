import { describe, expect, it, vi } from "vitest";
import { CollabSession, materialize, reconcile, type Plain } from "@monet-ui/monet-collab";
import { ArtisanStore, initialState, makeDocument, makeRect, Ops, Query, type Document } from "../engine";
import { installUnsavedWorkGuard } from "../state/app";
import { bindArtisanStore } from "./index";

const session = () => new CollabSession({
  room: `test-${Math.random().toString(36).slice(2)}`,
  wsUrl: "ws://127.0.0.1:1",
  user: { id: "u1", name: "Tester", color: "#f00" },
  connect: false,
});

async function sync(s: CollabSession) {
  s.provider.synced = true;
  await Promise.resolve();
  await Promise.resolve();
}

const itemX = (doc: Document, id: string) => Query.findItem(doc, id)!.item.transform.e;

describe("Artisan collaboration transactions", () => {
  it("marks a received peer edit unsaved and protects browser close", async () => {
    const store = new ArtisanStore();
    const s = session();
    const unbind = bindArtisanStore(s, store);
    await sync(s);
    let beforeUnload: ((event: BeforeUnloadEvent) => void) | undefined;
    vi.stubGlobal("window", {
      addEventListener: (type: string, listener: (event: BeforeUnloadEvent) => void) => {
        if (type === "beforeunload") beforeUnload = listener;
      },
    });

    try {
      await installUnsavedWorkGuard(store);
      const remote = structuredClone(store.doc);
      remote.layers[0].items.push(makeRect(0, 0, 20, 20));
      s.doc.transact(
        () => reconcile(s.root, remote as unknown as Record<string, Plain>),
        Symbol("peer"),
      );

      expect(store.getState().dirty).toBe(true);
      const preventDefault = vi.fn();
      beforeUnload?.({ preventDefault, returnValue: "" } as unknown as BeforeUnloadEvent);
      expect(preventDefault).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllGlobals();
      unbind();
      s.destroy();
    }
  });

  it("does not reconcile Artisan's ephemeral state changes", async () => {
    const store = new ArtisanStore();
    const s = session();
    const unbind = bindArtisanStore(s, store);
    await sync(s);
    let transactions = 0;
    s.doc.on("afterTransaction", () => { transactions++; });

    store.setView({ zoom: 2 });
    store.setTool("direct-selection");
    store.setSelection([]);
    expect(transactions).toBe(0);

    store.transact("Rename", (doc) => { doc.name = "Changed"; });
    expect(transactions).toBe(1);

    unbind();
    s.destroy();
  });

  it("rebases a mid-drag remote edit through another frame, end, broadcast, and undo", async () => {
    const doc = makeDocument();
    const local = makeRect(0, 0, 20, 20);
    const removedByPeer = makeRect(25, 0, 20, 20);
    doc.layers[0].items.push(local, removedByPeer);
    const store = new ArtisanStore(initialState(doc));
    store.setSelection([local.id, removedByPeer.id]);
    store.setAnchorSelection({ [removedByPeer.id]: [0] });
    store.setKeyObject(removedByPeer.id);
    const s = session();
    const unbind = bindArtisanStore(s, store);
    await sync(s);

    store.beginTransaction("Move");
    const dragStart = store.transactionBase!;
    store.mutateFrom(dragStart, (draft) => Ops.Transform.translateItems(draft, [local.id], 10, 0));
    expect(itemX(materialize(s.root) as unknown as Document, local.id)).toBe(0);

    const remote = structuredClone(dragStart);
    const peer = makeRect(50, 0, 20, 20);
    remote.layers[0].items = remote.layers[0].items.filter((item) => item.id !== removedByPeer.id);
    remote.layers[0].items.push(peer);
    s.doc.transact(
      () => reconcile(s.root, remote as unknown as Record<string, Plain>),
      Symbol("peer"),
    );
    // The remote snapshot becomes the fresh drag base immediately. The next
    // pointer frame reapplies the gesture's absolute delta on top of it.
    expect(itemX(store.doc, local.id)).toBe(0);
    expect(Query.findItem(store.doc, peer.id)).toBeTruthy();
    expect(store.selection).toEqual([local.id]);
    expect(store.getState().anchorSelection).toEqual({});
    expect(store.keyObjectId).toBeNull();

    store.mutateFrom(dragStart, (draft) => Ops.Transform.translateItems(draft, [local.id], 20, 0));
    const duringDrag = materialize(s.root) as unknown as Document;
    expect(itemX(duringDrag, local.id)).toBe(0);
    expect(Query.findItem(duringDrag, peer.id)).toBeTruthy();
    store.endTransaction();
    expect(itemX(store.doc, local.id)).toBe(20);
    const settled = materialize(s.root) as unknown as Document;
    expect(itemX(settled, local.id)).toBe(20);
    expect(Query.findItem(settled, peer.id)).toBeTruthy();

    store.undo();
    expect(itemX(store.doc, local.id)).toBe(0);
    expect(Query.findItem(store.doc, peer.id)).toBeTruthy();
    const undone = materialize(s.root) as unknown as Document;
    expect(itemX(undone, local.id)).toBe(0);
    expect(Query.findItem(undone, peer.id)).toBeTruthy();

    unbind();
    s.destroy();
  });
});
