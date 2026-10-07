// store-binding — seeding an empty room and (#227) the undo stack the seed must
// NOT land on. Uses a real `CollabSession` with `connect: false`: the provider
// never opens a socket, and flipping its `synced` flag emits the same "sync"
// event `whenSynced()` waits for — so this exercises the production wiring
// (UndoManager built in the constructor, seed transacted by `bindStore`) rather
// than a re-creation of it.

import { describe, expect, it } from "vitest";
import { materialize } from "./reflect";
import { CollabSession } from "./session";
import { bindStore, type CollabStoreAdapter } from "./store-binding";

type Doc = { name: string; layers: { id: string; v: number }[] };

function session() {
  return new CollabSession({
    room: `test-${Math.random().toString(36).slice(2)}`,
    wsUrl: "ws://127.0.0.1:1",
    user: { id: "u1", name: "Tester", color: "#f00" },
    connect: false,
  });
}

/** Minimal store adapter: `mutate` is the app's local edit → subscriber notify. */
function store(initial: Doc) {
  const listeners = new Set<() => void>();
  let doc = initial;
  return {
    get doc() {
      return doc;
    },
    mutate(next: Doc) {
      doc = next;
      for (const l of listeners) l();
    },
    notify() {
      for (const l of listeners) l();
    },
    getDoc: () => doc,
    applyRemote(next: Doc) {
      doc = next;
    },
    subscribe(fn: () => void) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  } satisfies CollabStoreAdapter<Doc> & { doc: Doc; mutate(next: Doc): void; notify(): void };
}

/** Resolve `whenSynced()` without a server, then let its `.then` chain run. */
async function sync(s: CollabSession) {
  s.provider.synced = true;
  await Promise.resolve();
  await Promise.resolve();
}

describe("bindStore", () => {
  it("seeds an empty room without making the seed undoable (#227)", async () => {
    const s = session();
    const st = store({ name: "Project", layers: [{ id: "L1", v: 1 }] });
    const unbind = bindStore(s, st);
    await sync(s);

    expect(s.root.size).toBeGreaterThan(0); // the room was seeded…
    expect(s.canUndo()).toBe(false); // …but joining a room is not an edit

    // The first Cmd-Z used to reset the whole document to {} — for every peer.
    s.undo();
    expect(s.root.size).toBeGreaterThan(0);
    expect(st.doc.layers.map((l) => l.id)).toEqual(["L1"]);

    unbind();
    s.destroy();
  });

  it("undoes a local edit back to the seeded document, not to nothing", async () => {
    const s = session();
    const st = store({ name: "Project", layers: [{ id: "L1", v: 1 }] });
    const unbind = bindStore(s, st);
    await sync(s);

    st.mutate({ name: "Project", layers: [{ id: "L1", v: 1 }, { id: "L2", v: 2 }] });
    expect(s.canUndo()).toBe(true);

    s.undo();
    expect(st.doc.layers.map((l) => l.id)).toEqual(["L1"]);
    expect(st.doc.name).toBe("Project");

    unbind();
    s.destroy();
  });

  it("reconciles a notified in-place document mutation", async () => {
    const s = session();
    const st = store({ name: "Project", layers: [{ id: "L1", v: 1 }] });
    const unbind = bindStore(s, st);
    await sync(s);

    st.doc.layers[0].v = 2;
    st.notify();
    expect((materialize(s.root) as unknown as Doc).layers[0].v).toBe(2);

    unbind();
    s.destroy();
  });
});
