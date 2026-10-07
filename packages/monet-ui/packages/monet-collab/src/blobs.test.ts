// Blob channel — content-addressed binary syncs out-of-band between two docs.
import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { BlobStore } from "./blobs";

function sync(a: Y.Doc, b: Y.Doc) {
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a));
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b));
}

describe("BlobStore", () => {
  it("is content-addressed and idempotent", () => {
    const doc = new Y.Doc();
    const store = new BlobStore(doc.getMap<string>("blobs"));
    const bytes = new Uint8Array([1, 2, 3, 4, 250, 0, 128]);
    const h1 = store.put(bytes);
    const h2 = store.put(new Uint8Array([1, 2, 3, 4, 250, 0, 128]));
    expect(h1).toBe(h2); // same content → same hash
    expect(store.has(h1)).toBe(true);
    expect(Array.from(store.get(h1)!)).toEqual(Array.from(bytes));
  });

  it("transfers a blob from one peer to another (out of the document tree)", () => {
    const docA = new Y.Doc();
    const docB = new Y.Doc();
    const a = new BlobStore(docA.getMap<string>("blobs"));
    const b = new BlobStore(docB.getMap<string>("blobs"));

    const payload = new Uint8Array(2048).map((_, i) => i & 0xff);
    const hash = a.put(payload);
    expect(b.get(hash)).toBeNull(); // not yet synced

    let arrived: string | null = null;
    b.onBlob((h) => (arrived = h));
    sync(docA, docB);

    expect(arrived).toBe(hash); // peer B was notified
    expect(Array.from(b.get(hash)!)).toEqual(Array.from(payload)); // bytes intact
  });
});
