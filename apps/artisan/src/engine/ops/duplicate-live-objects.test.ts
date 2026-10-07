// ─────────────────────────────────────────────────────────────
// ops/duplicate-live-objects.test — duplicating a LIVE object keeps it live
// ─────────────────────────────────────────────────────────────
// Every live-object family stores ids that point INTO its own subtree
// (blendKeyIds → children, envelope.sourceIds → the source snapshot). Duplicate
// re-ids the whole tree, so any family `reidItemTree` forgets keeps pointing at
// the ORIGINAL's ids — and the copy's Release/Expand then operates on nothing.

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeRect, makeAnchor as anchor, Ops, Query, solid, rgba, type GroupItem } from "../index";

const RED = rgba(220, 0, 0);
const BLUE = rgba(0, 0, 220);
const squareAt = (x: number) => ({
  closed: true,
  anchors: [anchor({ x, y: 0 }), anchor({ x: x + 20, y: 0 }), anchor({ x: x + 20, y: 20 }), anchor({ x, y: 20 })],
});
const topItems = (doc: ReturnType<typeof makeDocument>) => doc.layers.flatMap((l) => l.items);
const groupOf = (doc: ReturnType<typeof makeDocument>, id: string) => Query.getItem(doc, id) as GroupItem;

describe("duplicating a Blend", () => {
  it("the copy's blendKeyIds point at the COPY's own children", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 2 })!;

    const [copyId] = Ops.Items.duplicateItems(doc, [gid]);
    const copy = groupOf(doc, copyId);
    const childIds = new Set(copy.children.map((c) => c.id));
    for (const keyId of copy.blendKeyIds ?? []) {
      expect(childIds.has(keyId), `blendKeyId ${keyId} must be one of the copy's children`).toBe(true);
    }
  });

  it("releasing the copy restores its keys instead of deleting it", () => {
    const doc = makeDocument();
    const a = makePath(squareAt(0), { fill: solid(RED) });
    const b = makePath(squareAt(100), { fill: solid(BLUE) });
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Blend.blend(doc, [a.id, b.id], { steps: 2 })!;
    const [copyId] = Ops.Items.duplicateItems(doc, [gid]);
    expect(topItems(doc)).toHaveLength(2); // the blend + its copy

    const restored = Ops.Blend.releaseBlend(doc, [copyId]);
    expect(restored, "release must return the copy's key objects").toHaveLength(2);
    // The original blend is untouched and the copy became its two keys.
    expect(topItems(doc)).toHaveLength(3);
    expect(Query.getItem(doc, gid), "the ORIGINAL blend must survive").toBeTruthy();
  });
});

describe("duplicating an Envelope", () => {
  it("the copy's envelope metadata is re-ided onto the copy", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    const r2 = makeRect(0, 60, 100, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r1);
    Ops.Items.addItem(doc, r2);
    const gid = Ops.Envelope.makeWithWarp(doc, [r1.id, r2.id], { style: "arc", bend: 0.5 })!;

    const [copyId] = Ops.Items.duplicateItems(doc, [gid]);
    const copy = groupOf(doc, copyId);
    expect(copy.envelope?.id, "envelope.id must follow the copy").toBe(copyId);
    const original = groupOf(doc, gid);
    expect(copy.envelope?.sourceIds).not.toEqual(original.envelope?.sourceIds);
  });

  it("releasing the copy restores its own artwork and leaves the original alone", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    const r2 = makeRect(0, 60, 100, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, r1);
    Ops.Items.addItem(doc, r2);
    const gid = Ops.Envelope.makeWithWarp(doc, [r1.id, r2.id], { style: "arc", bend: 0.5 })!;
    const [copyId] = Ops.Items.duplicateItems(doc, [gid]);

    const released = Ops.Envelope.release(doc, [copyId]);
    expect(released.length).toBeGreaterThan(0);
    expect(Query.getItem(doc, gid), "the ORIGINAL envelope must survive").toBeTruthy();
    expect(groupOf(doc, gid).envelope, "and stay an envelope").toBeTruthy();
  });
});

describe("duplicating a Perspective group", () => {
  it("re-links a nested envelope role to the copied source group", () => {
    const doc = makeDocument();
    const source = makeRect(0, 0, 100, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, source);
    const envelopeId = Ops.Envelope.makeWithWarp(doc, [source.id], { style: "arc", bend: 0.5 })!;
    const sibling = makeRect(0, 60, 100, 40, 0, 0, { fill: solid(BLUE) });
    Ops.Items.addItem(doc, sibling);
    const wrapperId = Ops.Group.group(doc, [envelopeId, sibling.id])!;
    const perspectiveId = Ops.Perspective.makePerspectiveGroup(doc, [wrapperId])!;

    const [copyId] = Ops.Items.duplicateItems(doc, [perspectiveId]);
    const nestedEnvelope = groupOf(doc, copyId).perspective?.sourceItems.find(
      (item): item is GroupItem => item.type === "group" && !!item.envelope,
    );

    expect(nestedEnvelope?.envelope?.id).toBe(nestedEnvelope?.id);
    expect(Query.getItem(doc, nestedEnvelope!.id)).toBeTruthy();
  });
});
