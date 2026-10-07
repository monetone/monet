// ─────────────────────────────────────────────────────────────
// panels-links.test — Links panel store transactions
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, makeDocument, makeImage, type ImageItem } from "./engine";

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument("Panel Links");
  const linked = makeImage("file:///assets/logo.png", 0, 0, 64, 64);
  doc.layers[0].items.push(linked);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([linked.id]);
  return { store, linked };
};

const image = (store: ArtisanStore, id: string): ImageItem => Query.getItem(store.getState().doc, id) as ImageItem;
const entries = (store: ArtisanStore) => Query.placedAssetEntries(store.getState().doc);

describe("Links panel transactions", () => {
  it("marks a link missing through an undoable transaction", () => {
    const { store, linked } = setup();

    store.transact("Link Status", (doc) => {
      Ops.LinkedAssets.setImageAssetStatus(doc, linked.id, "missing", { now: "2026-07-03T11:00:00.000Z" });
    });

    expect(entries(store)[0].asset.status).toBe("missing");
    expect(store.getState().dirty).toBe(true);

    store.undo();
    expect(entries(store)[0].asset.status).toBe("ok");
  });

  it("relinks and embeds with panel-equivalent transactions", () => {
    const { store, linked } = setup();

    store.transact("Relink Image", (doc) => {
      Ops.LinkedAssets.relinkImage(doc, linked.id, "file:///assets/updated.png", {
        now: "2026-07-03T11:05:00.000Z",
      });
    });

    expect(image(store, linked.id).href).toBe("file:///assets/updated.png");
    expect(entries(store)[0].asset).toMatchObject({
      mode: "linked",
      status: "ok",
      name: "updated.png",
      source: "file:///assets/updated.png",
    });

    store.transact("Embed Image", (doc) => {
      Ops.LinkedAssets.embedImage(doc, linked.id, {
        href: "data:image/png;base64,CCCC",
        now: "2026-07-03T11:06:00.000Z",
      });
    });

    expect(image(store, linked.id).href).toBe("data:image/png;base64,CCCC");
    expect(entries(store)[0].asset).toMatchObject({
      mode: "embedded",
      status: "ok",
      source: "file:///assets/updated.png",
    });

    store.undo();
    expect(entries(store)[0].asset).toMatchObject({
      mode: "linked",
      source: "file:///assets/updated.png",
    });
  });

  it("keeps panel selection state independent from link metadata", () => {
    const { store, linked } = setup();

    store.setSelection([]);
    expect(store.getState().selection).toEqual([]);

    store.setSelection([linked.id]);
    store.transact("Update Link", (doc) => {
      Ops.LinkedAssets.updateLinkedImage(doc, linked.id, { now: "2026-07-03T11:10:00.000Z" });
    });

    expect(store.getState().selection).toEqual([linked.id]);
    expect(entries(store)[0].asset.updatedAt).toBe("2026-07-03T11:10:00.000Z");
  });
});
