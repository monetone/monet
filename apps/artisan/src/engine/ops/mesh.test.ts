// ─────────────────────────────────────────────────────────────
// ops/mesh.test — gradient mesh object lifecycle and regeneration
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

describe("mesh operations", () => {
  it("replaces a source item with a queryable live mesh group", () => {
    const doc = makeDocument("Mesh");
    const rect = makeRect(0, 0, 120, 80, 0, 0, {
      fill: solid(rgba(80, 150, 220)),
    });
    Ops.Items.addItem(doc, rect);

    const id = Ops.Meshes.createMeshFromItem(doc, rect.id, {
      now: "2026-03-01T00:00:00.000Z",
    });

    expect(id).toBeTruthy();
    expect(doc.layers[0].items).toHaveLength(1);
    expect(group(doc, id!).mesh).toMatchObject({
      id,
      rows: 5,
      columns: 5,
      updatedAt: "2026-03-01T00:00:00.000Z",
    });
    expect(group(doc, id!).children).toHaveLength(25);
    expect(Query.meshEntries(doc)[0]).toMatchObject({
      itemId: id,
      rows: 5,
      columns: 5,
      pointCount: 36,
      layerName: "Layer 1",
    });
  });

  it("updates mesh point colors and regenerates patch artwork", () => {
    const doc = makeDocument("Mesh Update");
    const rect = makeRect(0, 0, 100, 100, 0, 0);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Meshes.createMeshFromItem(doc, rect.id)!;
    const before = JSON.stringify(group(doc, id).children[0]);

    expect(Ops.Meshes.updateMeshPointColor(
      doc,
      id,
      0,
      0,
      rgba(255, 0, 0),
      { now: "2026-03-02T00:00:00.000Z" },
    )).toBe(true);

    expect(group(doc, id).mesh?.updatedAt).toBe("2026-03-02T00:00:00.000Z");
    expect(group(doc, id).mesh?.points.find((point) => point.row === 0 && point.column === 0)?.color)
      .toEqual(rgba(255, 0, 0));
    expect(JSON.stringify(group(doc, id).children[0])).not.toBe(before);
  });

  it("changes the grid while preserving corner colors", () => {
    const doc = makeDocument("Mesh Grid");
    const rect = makeRect(0, 0, 100, 100, 0, 0, {
      fill: solid(rgba(20, 120, 200)),
    });
    Ops.Items.addItem(doc, rect);
    const id = Ops.Meshes.createMeshFromItem(doc, rect.id)!;
    const topLeft = group(doc, id).mesh!.points.find((point) => point.row === 0 && point.column === 0)!.color;

    expect(Ops.Meshes.setMeshGrid(doc, id, 3, 4)).toBe(true);

    expect(group(doc, id).mesh).toMatchObject({ rows: 3, columns: 4 });
    expect(group(doc, id).mesh?.points).toHaveLength(20);
    expect(group(doc, id).children).toHaveLength(12);
    expect(group(doc, id).mesh?.points.find((point) => point.row === 0 && point.column === 0)?.color)
      .toEqual(topLeft);
  });

  it("round-trips mesh metadata through the native JSON format", () => {
    const doc = makeDocument("Mesh Roundtrip");
    const rect = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Meshes.createMeshFromItem(doc, rect.id)!;

    const back = IO.deserializeDocument(IO.serializeDocument(doc));

    expect(group(back, id).mesh).toEqual(group(doc, id).mesh);
    expect(Query.meshEntries(back)[0]).toMatchObject({ itemId: id, rows: 5, columns: 5, pointCount: 36 });
  });

  it("detaches a mesh without deleting generated artwork", () => {
    const doc = makeDocument("Mesh Detach");
    const rect = makeRect(0, 0, 100, 60, 0, 0);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Meshes.createMeshFromItem(doc, rect.id)!;
    const before = group(doc, id).children.length;

    expect(Ops.Meshes.detachMesh(doc, [id])).toEqual([id]);

    expect(group(doc, id).mesh).toBeUndefined();
    expect(group(doc, id).children).toHaveLength(before);
    expect(Query.meshEntries(doc)).toHaveLength(0);
  });

  it("duplicates mesh metadata with the cloned group id", () => {
    const doc = makeDocument("Mesh Duplicate");
    const rect = makeRect(0, 0, 80, 80, 0, 0);
    Ops.Items.addItem(doc, rect);
    const id = Ops.Meshes.createMeshFromItem(doc, rect.id)!;

    const duplicateId = Ops.Items.duplicateItems(doc, [id], 12, 8)[0];

    expect(duplicateId).toBeTruthy();
    expect(group(doc, duplicateId).mesh?.id).toBe(duplicateId);
    expect(group(doc, duplicateId).mesh?.id).not.toBe(id);
    expect(Query.meshEntries(doc).map((entry) => entry.itemId)).toEqual([id, duplicateId]);
  });
});
