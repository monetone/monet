// ─────────────────────────────────────────────────────────────
// model/live-paint — baseline Live Paint group metadata
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { newId } from "./factory";
import { paintedFill, paintedStroke } from "./appearance";
import type { GroupItem, Item, LivePaintEdge, LivePaintFace, LivePaintGapDetection, LivePaintObject, Paint, Stroke } from "./types";

const clonePaint = (paint: Paint): Paint => cloneDeep(paint);
const cloneStroke = (stroke: Stroke): Stroke => cloneDeep(stroke);

export interface LivePaintOptions {
  gapDetection?: LivePaintGapDetection;
  updatedAt?: string;
}

export const makeLivePaintFace = (item: Item, updatedAt?: string): LivePaintFace => ({
  id: newId("lpf"),
  itemId: item.id,
  fill: clonePaint(paintedFill(item)),
  ...(updatedAt ? { updatedAt } : {}),
});

export const makeLivePaintEdge = (item: Item, updatedAt?: string): LivePaintEdge => ({
  id: newId("lpe"),
  itemId: item.id,
  stroke: cloneStroke(paintedStroke(item)),
  ...(updatedAt ? { updatedAt } : {}),
});

export const makeLivePaintObject = (group: GroupItem, opts: LivePaintOptions = {}): LivePaintObject => ({
  id: group.id,
  faces: group.children.map((child) => makeLivePaintFace(child, opts.updatedAt)),
  edges: group.children.map((child) => makeLivePaintEdge(child, opts.updatedAt)),
  gapDetection: opts.gapDetection ?? "none",
  ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
});

const byItemId = <T extends { itemId: string }>(records: T[]): Map<string, T> =>
  new Map(records.map((record) => [record.itemId, record]));

export const normalizeLivePaintObject = (group: GroupItem): LivePaintObject => {
  const source = group.livePaint ?? makeLivePaintObject(group);
  const faces = byItemId(source.faces);
  const edges = byItemId(source.edges);
  return {
    id: group.id,
    faces: group.children.map((child) => {
      const existing = faces.get(child.id);
      return existing
        ? { ...existing, itemId: child.id, fill: clonePaint(existing.fill) }
        : makeLivePaintFace(child, source.updatedAt);
    }),
    edges: group.children.map((child) => {
      const existing = edges.get(child.id);
      return existing
        ? { ...existing, itemId: child.id, stroke: cloneStroke(existing.stroke) }
        : makeLivePaintEdge(child, source.updatedAt);
    }),
    gapDetection: source.gapDetection ?? "none",
    ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}),
  };
};

export const syncLivePaintFromChildren = (group: GroupItem, updatedAt?: string): LivePaintObject => {
  const current = normalizeLivePaintObject(group);
  return {
    ...current,
    faces: current.faces.map((face) => {
      const child = group.children.find((item) => item.id === face.itemId);
      return {
        ...face,
        fill: clonePaint(child ? paintedFill(child) : face.fill),
        ...(updatedAt ? { updatedAt } : {}),
      };
    }),
    edges: current.edges.map((edge) => {
      const child = group.children.find((item) => item.id === edge.itemId);
      return {
        ...edge,
        stroke: cloneStroke(child ? paintedStroke(child) : edge.stroke),
        ...(updatedAt ? { updatedAt } : {}),
      };
    }),
    ...(updatedAt ? { updatedAt } : {}),
  };
};
