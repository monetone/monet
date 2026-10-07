// ─────────────────────────────────────────────────────────────
// ops/linked-assets.test — placed image link/embed metadata
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { IO, Ops, Query, makeDocument, makeImage, makePlacedAsset, type ImageItem } from "../index";

const linkedHref = "file:///Users/art/logo%20mark.png";
const linkedStamp = "2026-07-03T10:00:00.000Z";
const updateStamp = "2026-07-03T10:10:00.000Z";

const setup = () => {
  const doc = makeDocument("Links");
  const linked = makeImage(linkedHref, 10, 20, 120, 80, 240, 160, {
    asset: makePlacedAsset(linkedHref, {
      id: "asset_logo",
      linkedAt: linkedStamp,
      lastModified: 10,
      mimeType: "image/png",
      sizeBytes: 4096,
    }),
  });
  const embedded = makeImage("data:image/png;base64,AAAA", 40, 50, 20, 20, 20, 20);
  doc.layers[0].items.push(linked, embedded);
  return { doc, linked, embedded };
};

describe("linked asset operations", () => {
  it("classifies linked, embedded, and legacy image entries", () => {
    const { doc, linked, embedded } = setup();
    const legacy = makeImage("https://cdn.example.com/photo.jpg", 0, 0, 10, 10);
    delete legacy.asset;
    doc.layers[0].items.push(legacy);

    const entries = Query.placedAssetEntries(doc);
    expect(entries.map((e) => [e.itemId, e.asset.mode, e.asset.status])).toEqual([
      [linked.id, "linked", "ok"],
      [embedded.id, "embedded", "ok"],
      [legacy.id, "linked", "ok"],
    ]);
    expect(entries[0].asset.name).toBe("logo mark.png");
    expect(entries[1].asset.name).toBe("Embedded image");
    expect(entries[2].asset.source).toBe("https://cdn.example.com/photo.jpg");
  });

  it("relinks while preserving asset identity and recording source state", () => {
    const { doc, linked } = setup();

    expect(
      Ops.LinkedAssets.relinkImage(doc, linked.id, "file:///Users/art/replacement.png", {
        now: updateStamp,
        lastModified: 20,
        sizeBytes: 8192,
      }),
    ).toBe(true);

    const item = Query.getItem(doc, linked.id) as ImageItem;
    expect(item.href).toBe("file:///Users/art/replacement.png");
    expect(item.asset).toEqual({
      id: "asset_logo",
      mode: "linked",
      status: "ok",
      name: "replacement.png",
      source: "file:///Users/art/replacement.png",
      mimeType: "image/png",
      sizeBytes: 8192,
      lastModified: 20,
      linkedAt: linkedStamp,
      updatedAt: updateStamp,
    });
  });

  it("marks missing, embeds, and updates only linked assets", () => {
    const { doc, linked, embedded } = setup();

    expect(Ops.LinkedAssets.setImageAssetStatus(doc, linked.id, "missing", { now: updateStamp })).toBe(true);
    expect((Query.getItem(doc, linked.id) as ImageItem).asset?.status).toBe("missing");

    expect(Ops.LinkedAssets.embedImage(doc, linked.id, { href: "data:image/png;base64,BBBB", now: updateStamp })).toBe(true);
    const linkedItem = Query.getItem(doc, linked.id) as ImageItem;
    expect(linkedItem.asset?.mode).toBe("embedded");
    expect(linkedItem.asset?.status).toBe("ok");
    expect(linkedItem.asset?.source).toBe(linkedHref);
    expect(linkedItem.asset?.embeddedAt).toBe(updateStamp);

    expect(Ops.LinkedAssets.updateLinkedImage(doc, linked.id, { now: "2026-07-03T10:20:00.000Z" })).toBe(false);
    expect(Ops.LinkedAssets.updateLinkedImage(doc, embedded.id, { now: "2026-07-03T10:20:00.000Z" })).toBe(false);
  });

  it("round-trips placed asset metadata through .artisan JSON", () => {
    const { doc, linked } = setup();
    Ops.LinkedAssets.setImageAssetStatus(doc, linked.id, "modified", { now: updateStamp });

    const back = IO.deserializeDocument(IO.serializeDocument(doc));
    const item = Query.getItem(back, linked.id) as ImageItem;
    expect(item.asset).toEqual((Query.getItem(doc, linked.id) as ImageItem).asset);
    expect(IO.serializeDocument(back)).toBe(IO.serializeDocument(doc));
  });
});
