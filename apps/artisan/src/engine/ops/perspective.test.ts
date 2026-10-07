// ─────────────────────────────────────────────────────────────
// ops/perspective.test — Perspective live-object lifecycle
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import {
  DEFAULT_PERSPECTIVE_CORNERS,
  IDENTITY_PERSPECTIVE_CORNERS,
  IO,
  Ops,
  Query,
  makeDocument,
  makeRect,
  type GroupItem,
  type PathItem,
} from "../index";

const group = (doc: ReturnType<typeof makeDocument>, id: string): GroupItem =>
  Query.getItem(doc, id) as GroupItem;

const generatedPath = (doc: ReturnType<typeof makeDocument>, id: string): PathItem =>
  group(doc, id).children[0] as PathItem;

describe("perspective operations", () => {
  it("wraps artwork in a queryable Perspective group and generates distorted artwork", () => {
    const doc = makeDocument("Perspective");
    const rect = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, rect);

    const id = Ops.Perspective.makePerspectiveGroup(doc, [rect.id], {
      corners: DEFAULT_PERSPECTIVE_CORNERS,
      now: "2026-05-02T00:00:00.000Z",
    });

    expect(id).toBeTruthy();
    expect(doc.layers[0].items).toHaveLength(1);
    expect(group(doc, id!).perspective).toMatchObject({
      id,
      plane: "one-point",
      sourceIds: [rect.id],
      updatedAt: "2026-05-02T00:00:00.000Z",
    });
    expect(group(doc, id!).perspective?.sourceItems[0].type).toBe("rect");
    expect(generatedPath(doc, id!).type).toBe("path");
    expect(generatedPath(doc, id!).geometry.anchors[0].point).toEqual({ x: 20, y: 0 });
    expect(Query.perspectiveEntries(doc)[0]).toMatchObject({
      itemId: id,
      plane: "one-point",
      sourceCount: 1,
      layerName: "Layer 1",
    });
  });

  it("updates corners by regenerating from the stored source instead of compounding distortion", () => {
    const doc = makeDocument("Perspective Update");
    const rect = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Perspective.makePerspectiveGroup(doc, [rect.id], {
      corners: DEFAULT_PERSPECTIVE_CORNERS,
    })!;

    expect(Ops.Perspective.updatePerspectiveCorners(doc, id, IDENTITY_PERSPECTIVE_CORNERS, {
      now: "2026-05-03T00:00:00.000Z",
    })).toBe(true);

    expect(generatedPath(doc, id).geometry.anchors[0].point).toEqual({ x: 0, y: 0 });
    expect(generatedPath(doc, id).geometry.anchors[1].point).toEqual({ x: 100, y: 0 });
    expect(group(doc, id).perspective?.updatedAt).toBe("2026-05-03T00:00:00.000Z");
  });

  it("round-trips Perspective metadata through the native JSON format", () => {
    const doc = makeDocument("Perspective Roundtrip");
    const rect = makeRect(0, 0, 120, 60);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Perspective.makePerspectiveGroup(doc, [rect.id])!;

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(group(back, id).perspective).toEqual(group(doc, id).perspective);
    expect(Query.perspectiveEntries(back)[0]).toMatchObject({ itemId: id, sourceCount: 1 });
  });

  it("expands and releases Perspective groups without losing artwork", () => {
    const doc = makeDocument("Perspective Expand Release");
    const expandRect = makeRect(0, 0, 100, 100);
    const releaseRect = makeRect(150, 0, 100, 100);
    Ops.Items.addItems(doc, [expandRect, releaseRect]);
    const expandId = Ops.Perspective.makePerspectiveGroup(doc, [expandRect.id])!;
    const releaseId = Ops.Perspective.makePerspectiveGroup(doc, [releaseRect.id])!;

    expect(Ops.Perspective.expandPerspectiveGroups(doc, [expandId])).toEqual([expandId]);
    expect(group(doc, expandId).perspective).toBeUndefined();
    expect(generatedPath(doc, expandId).geometry.anchors[0].point).toEqual({ x: 20, y: 0 });

    expect(Ops.Perspective.releasePerspectiveGroups(doc, [releaseId])).toEqual([releaseRect.id]);
    expect(Query.getItem(doc, releaseRect.id)?.type).toBe("rect");
    expect(Query.perspectiveEntries(doc)).toHaveLength(0);
  });

  it("duplicates Perspective metadata with cloned source ids", () => {
    const doc = makeDocument("Perspective Duplicate");
    const rect = makeRect(0, 0, 100, 100);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Perspective.makePerspectiveGroup(doc, [rect.id])!;

    const duplicateId = Ops.Items.duplicateItems(doc, [id], 12, 8)[0];
    const duplicate = group(doc, duplicateId);

    expect(duplicate.perspective?.id).toBe(duplicateId);
    expect(duplicate.perspective?.sourceIds).toEqual(duplicate.children.map((child) => child.id));
    expect(duplicate.perspective?.sourceIds[0]).not.toBe(rect.id);
    expect(Query.perspectiveEntries(doc).map((entry) => entry.itemId)).toEqual([id, duplicateId]);
  });
});
