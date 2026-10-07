// ─────────────────────────────────────────────────────────────
// ops/live-paint.test — Live Paint group lifecycle
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  IO,
  Ops,
  Query,
  makeDocument,
  makeRect,
  rgba,
  solid,
  type GroupItem,
} from "../index";

const group = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem =>
  Query.getItem(doc, id) as GroupItem;

describe("live paint operations", () => {
  it("wraps selected artwork in a queryable Live Paint group", () => {
    const doc = makeDocument("Live Paint");
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(30, 0, 40, 40);
    Ops.Items.addItems(doc, [a, b]);

    const id = Ops.LivePaint.makeLivePaintGroup(doc, [a.id, b.id], {
      gapDetection: "small",
      now: "2026-04-02T00:00:00.000Z",
    });

    expect(id).toBeTruthy();
    expect(doc.layers[0].items).toHaveLength(1);
    expect(group(doc, id!).livePaint).toMatchObject({
      id,
      gapDetection: "small",
      updatedAt: "2026-04-02T00:00:00.000Z",
    });
    expect(group(doc, id!).livePaint?.faces.map((face) => face.itemId)).toEqual([a.id, b.id]);
    expect(Query.livePaintEntries(doc)[0]).toMatchObject({
      itemId: id,
      faceCount: 2,
      edgeCount: 2,
      layerName: "Layer 1",
    });
  });

  it("records bucket fills on the Live Paint face metadata", () => {
    const doc = makeDocument("Live Paint Fill");
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(30, 0, 40, 40);
    Ops.Items.addItems(doc, [a, b]);
    const id = Ops.LivePaint.makeLivePaintGroup(doc, [a.id, b.id])!;
    const fill = solid(rgba(255, 120, 0));

    expect(Ops.LivePaint.applyFaceFill(doc, a.id, fill, {
      now: "2026-04-03T00:00:00.000Z",
    })).toBe(true);

    expect(Query.getItem(doc, a.id)?.fill).toEqual(fill);
    const face = group(doc, id).livePaint?.faces.find((candidate) => candidate.itemId === a.id);
    expect(face).toMatchObject({
      fill,
      updatedAt: "2026-04-03T00:00:00.000Z",
    });
    expect(group(doc, id).livePaint?.updatedAt).toBe("2026-04-03T00:00:00.000Z");
  });

  it("round-trips Live Paint metadata through the native JSON format", () => {
    const doc = makeDocument("Live Paint Roundtrip");
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(30, 0, 40, 40);
    Ops.Items.addItems(doc, [a, b]);
    const id = Ops.LivePaint.makeLivePaintGroup(doc, [a.id, b.id])!;

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(group(back, id).livePaint).toEqual(group(doc, id).livePaint);
    expect(Query.livePaintEntries(back)[0]).toMatchObject({ itemId: id, faceCount: 2, edgeCount: 2 });
  });

  it("expands and releases Live Paint groups without losing artwork", () => {
    const doc = makeDocument("Live Paint Expand Release");
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(30, 0, 40, 40);
    Ops.Items.addItems(doc, [a, b]);
    const id = Ops.LivePaint.makeLivePaintGroup(doc, [a.id, b.id])!;

    expect(Ops.LivePaint.expandLivePaintGroups(doc, [id])).toEqual([id]);
    expect(group(doc, id).livePaint).toBeUndefined();
    expect(group(doc, id).children).toHaveLength(2);

    group(doc, id).livePaint = {
      id,
      faces: [],
      edges: [],
      gapDetection: "none",
    };
    expect(Ops.LivePaint.releaseLivePaintGroups(doc, [id]).sort()).toEqual([a.id, b.id].sort());
    expect(doc.layers[0].items.map((item) => item.id).sort()).toEqual([a.id, b.id].sort());
  });

  it("duplicates Live Paint metadata with cloned child ids", () => {
    const doc = makeDocument("Live Paint Duplicate");
    const a = makeRect(0, 0, 40, 40);
    const b = makeRect(30, 0, 40, 40);
    Ops.Items.addItems(doc, [a, b]);
    const id = Ops.LivePaint.makeLivePaintGroup(doc, [a.id, b.id])!;

    const duplicateId = Ops.Items.duplicateItems(doc, [id], 12, 8)[0];
    const duplicate = group(doc, duplicateId);

    expect(duplicate.livePaint?.id).toBe(duplicateId);
    expect(duplicate.livePaint?.faces.map((face) => face.itemId)).toEqual(duplicate.children.map((child) => child.id));
    expect(duplicate.livePaint?.edges.map((edge) => edge.itemId)).toEqual(duplicate.children.map((child) => child.id));
    expect(Query.livePaintEntries(doc).map((entry) => entry.itemId)).toEqual([id, duplicateId]);
  });
});
