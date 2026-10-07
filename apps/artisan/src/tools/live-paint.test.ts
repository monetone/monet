import { describe, expect, it } from "vitest";
import { ArtisanStore, Ops, Query, makeDocument, makeRect, rgba, solid, type GroupItem } from "../engine";
import { createLivePaintBucketTool } from "./live-paint";
import type { ToolContext, ToolPointer } from "./types";

const context = (store: ArtisanStore): ToolContext => ({
  store,
  state: store.getState(),
  worldToScreen: (point) => point,
  screenToWorld: (point) => point,
  requestRender: () => {},
  zoom: 1,
  viewport: { width: 800, height: 600 },
});

const pointer = (x: number, y: number): ToolPointer => ({
  world: { x, y },
  rawWorld: { x, y },
  screen: { x, y },
  shift: false,
  alt: false,
  mod: false,
  button: 0,
  detail: 1,
});

describe("Live Paint Bucket tool", () => {
  it("paints Live Paint edge metadata when stroke is the active target", () => {
    const doc = makeDocument("Live Paint Stroke Tool");
    const rect = makeRect(0, 0, 40, 40);
    Ops.Items.addItem(doc, rect);
    const groupId = Ops.LivePaint.makeLivePaintGroup(doc, [rect.id])!;
    const store = new ArtisanStore();
    store.replaceDoc(doc, { markClean: true });
    store.setActivePaint("stroke");
    store.setStroke({ ...store.getState().stroke, paint: solid(rgba(240, 40, 20)), width: 7 });

    createLivePaintBucketTool().onPointerDown!(pointer(10, 10), context(store));

    const group = Query.getItem(store.doc, groupId) as GroupItem;
    expect(group.livePaint?.edges[0].stroke).toMatchObject({
      paint: { type: "solid", color: { r: 240, g: 40, b: 20 } },
      width: 7,
    });
    expect(Query.getItem(store.doc, rect.id)?.stroke.width).toBe(7);
    store.undo();
    expect((Query.getItem(store.doc, groupId) as GroupItem).livePaint?.edges[0].stroke.width).not.toBe(7);
  });
});
