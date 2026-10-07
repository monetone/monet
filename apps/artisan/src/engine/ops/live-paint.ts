// ─────────────────────────────────────────────────────────────
// ops/live-paint — Live Paint group baseline operations
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { defaultStroke, makeGroup, noPaint } from "../model/factory";
import { makeLivePaintObject, normalizeLivePaintObject, syncLivePaintFromChildren } from "../model/live-paint";
import { findItem } from "../model/query";
import type { Document, GroupItem, ID, LivePaintGapDetection, Paint, Stroke } from "../model/types";
import { group as groupItems, ungroup } from "./group";

export interface MakeLivePaintOptions {
  gapDetection?: LivePaintGapDetection;
  now?: string;
}

const asLivePaintGroup = (item: unknown): GroupItem | null =>
  item && typeof item === "object" && (item as GroupItem).type === "group" && (item as GroupItem).livePaint
    ? (item as GroupItem)
    : null;

const livePaintGroup = (doc: Document, groupId: ID): GroupItem | null =>
  asLivePaintGroup(findItem(doc, groupId)?.item ?? null);

const directLivePaintParent = (doc: Document, itemId: ID): GroupItem | null => {
  const loc = findItem(doc, itemId);
  const parent = loc?.ancestors[loc.ancestors.length - 1];
  return parent?.livePaint && parent.children.some((child) => child.id === itemId) ? parent : null;
};

const markLivePaint = (group: GroupItem, opts: MakeLivePaintOptions = {}): ID => {
  group.name = group.name && group.name !== "Group" ? group.name : "Live Paint Group";
  group.livePaint = makeLivePaintObject(group, {
    gapDetection: opts.gapDetection,
    updatedAt: opts.now,
  });
  return group.id;
};

export const makeLivePaintGroup = (
  doc: Document,
  ids: Iterable<ID>,
  opts: MakeLivePaintOptions = {},
): ID | null => {
  const idList = Array.from(new Set(ids));
  if (!idList.length) return null;

  if (idList.length === 1) {
    const loc = findItem(doc, idList[0]);
    if (!loc) return null;
    if (loc.item.type === "group") return markLivePaint(loc.item, opts);

    const group = makeGroup([loc.item], {
      name: "Live Paint Group",
      fill: noPaint(),
      stroke: defaultStroke(noPaint()),
    });
    loc.container.splice(loc.index, 1, group);
    return markLivePaint(group, opts);
  }

  const groupId = groupItems(doc, idList);
  const group = groupId ? findItem(doc, groupId)?.item : null;
  return group?.type === "group" ? markLivePaint(group, opts) : null;
};

export const applyFaceFill = (
  doc: Document,
  itemId: ID,
  fill: Paint,
  opts: { now?: string } = {},
): boolean => {
  const loc = findItem(doc, itemId);
  const group = directLivePaintParent(doc, itemId);
  if (!loc || !group) return false;
  loc.item.fill = cloneDeep(fill);

  const metadata = normalizeLivePaintObject(group);
  const face = metadata.faces.find((candidate) => candidate.itemId === itemId);
  if (!face) return false;
  face.fill = cloneDeep(fill);
  if (opts.now) {
    face.updatedAt = opts.now;
    metadata.updatedAt = opts.now;
  }
  group.livePaint = metadata;
  return true;
};

export const applyEdgeStroke = (
  doc: Document,
  itemId: ID,
  stroke: Stroke,
  opts: { now?: string } = {},
): boolean => {
  const loc = findItem(doc, itemId);
  const group = directLivePaintParent(doc, itemId);
  if (!loc || !group) return false;
  loc.item.stroke = cloneDeep(stroke);

  const metadata = normalizeLivePaintObject(group);
  const edge = metadata.edges.find((candidate) => candidate.itemId === itemId);
  if (!edge) return false;
  edge.stroke = cloneDeep(stroke);
  if (opts.now) {
    edge.updatedAt = opts.now;
    metadata.updatedAt = opts.now;
  }
  group.livePaint = metadata;
  return true;
};

export const setGapDetection = (
  doc: Document,
  groupId: ID,
  gapDetection: LivePaintGapDetection,
  opts: { now?: string } = {},
): boolean => {
  const group = livePaintGroup(doc, groupId);
  if (!group) return false;
  group.livePaint = {
    ...normalizeLivePaintObject(group),
    gapDetection,
    ...(opts.now ? { updatedAt: opts.now } : {}),
  };
  return true;
};

export const syncGroup = (
  doc: Document,
  groupId: ID,
  opts: { now?: string } = {},
): boolean => {
  const group = livePaintGroup(doc, groupId);
  if (!group) return false;
  group.livePaint = syncLivePaintFromChildren(group, opts.now);
  return true;
};

export const expandLivePaintGroups = (doc: Document, ids: Iterable<ID>): ID[] => {
  const expanded: ID[] = [];
  for (const id of ids) {
    const group = livePaintGroup(doc, id);
    if (!group) continue;
    delete group.livePaint;
    expanded.push(group.id);
  }
  return expanded;
};

export const releaseLivePaintGroups = (doc: Document, ids: Iterable<ID>): ID[] => {
  const releaseIds: ID[] = [];
  for (const id of ids) {
    const group = livePaintGroup(doc, id);
    if (!group) continue;
    delete group.livePaint;
    releaseIds.push(group.id);
  }
  return releaseIds.length ? ungroup(doc, releaseIds) : [];
};
