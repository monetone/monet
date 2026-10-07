// ─────────────────────────────────────────────────────────────
// ops/perspective — Perspective live-object baseline operations
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { defaultStroke, makeGroup, noPaint } from "../model/factory";
import {
  DEFAULT_PERSPECTIVE_CORNERS,
  makePerspectiveObject,
  normalizePerspectiveCorners,
  normalizePerspectiveObject,
} from "../model/perspective";
import { findItem } from "../model/query";
import type { Document, GroupItem, ID, Item, PerspectiveCornerSet, PerspectivePlaneKind } from "../model/types";
import { freeDistort, type FreeDistortCorners } from "./free-distort";
import { group as groupItems, ungroup } from "./group";
import { convertToPath } from "./path-edit";

export interface MakePerspectiveOptions {
  plane?: PerspectivePlaneKind;
  corners?: PerspectiveCornerSet;
  now?: string;
}

const asPerspectiveGroup = (item: unknown): GroupItem | null =>
  item && typeof item === "object" && (item as GroupItem).type === "group" && (item as GroupItem).perspective
    ? (item as GroupItem)
    : null;

const perspectiveGroup = (doc: Document, groupId: ID): GroupItem | null =>
  asPerspectiveGroup(findItem(doc, groupId)?.item ?? null);

const leafIds = (items: Item[]): ID[] => {
  const out: ID[] = [];
  const walk = (item: Item) => {
    if (item.type === "group") item.children.forEach(walk);
    else out.push(item.id);
  };
  items.forEach(walk);
  return out;
};

const toFreeDistortCorners = (corners: PerspectiveCornerSet): FreeDistortCorners => ({
  topLeft: { ...corners.topLeft },
  topRight: { ...corners.topRight },
  bottomRight: { ...corners.bottomRight },
  bottomLeft: { ...corners.bottomLeft },
});

const regeneratePerspectiveArtwork = (
  doc: Document,
  group: GroupItem,
  opts: MakePerspectiveOptions = {},
): boolean => {
  const source = normalizePerspectiveObject(group);
  const corners = normalizePerspectiveCorners(opts.corners ?? source.corners);
  const sourceItems = cloneDeep(source.sourceItems);
  group.children = cloneDeep(sourceItems);
  group.perspective = {
    ...source,
    plane: opts.plane ?? source.plane,
    corners,
    sourceItems,
    sourceIds: sourceItems.map((item) => item.id),
    ...(opts.now ? { updatedAt: opts.now } : {}),
  };
  const ids = leafIds(group.children);
  ids.forEach((id) => convertToPath(doc, id));
  freeDistort(doc, ids, toFreeDistortCorners(corners));
  return true;
};

const markPerspective = (doc: Document, group: GroupItem, opts: MakePerspectiveOptions = {}): ID => {
  group.name = group.name && group.name !== "Group" ? group.name : "Perspective Group";
  group.perspective = makePerspectiveObject(group, {
    plane: opts.plane,
    corners: opts.corners ?? DEFAULT_PERSPECTIVE_CORNERS,
    updatedAt: opts.now,
  });
  regeneratePerspectiveArtwork(doc, group, opts);
  return group.id;
};

export const makePerspectiveGroup = (
  doc: Document,
  ids: Iterable<ID>,
  opts: MakePerspectiveOptions = {},
): ID | null => {
  const idList = Array.from(new Set(ids));
  if (!idList.length) return null;

  if (idList.length === 1) {
    const loc = findItem(doc, idList[0]);
    if (!loc) return null;
    if (loc.item.type === "group") {
      if (loc.item.perspective) {
        updatePerspectiveCorners(doc, loc.item.id, opts.corners ?? loc.item.perspective.corners, opts);
        return loc.item.id;
      }
      return markPerspective(doc, loc.item, opts);
    }

    const group = makeGroup([loc.item], {
      name: "Perspective Group",
      fill: noPaint(),
      stroke: defaultStroke(noPaint()),
    });
    loc.container.splice(loc.index, 1, group);
    return markPerspective(doc, group, opts);
  }

  const groupId = groupItems(doc, idList);
  const group = groupId ? findItem(doc, groupId)?.item : null;
  return group?.type === "group" ? markPerspective(doc, group, opts) : null;
};

export const updatePerspectiveCorners = (
  doc: Document,
  groupId: ID,
  corners: PerspectiveCornerSet,
  opts: Omit<MakePerspectiveOptions, "corners"> = {},
): boolean => {
  const group = perspectiveGroup(doc, groupId);
  if (!group) return false;
  return regeneratePerspectiveArtwork(doc, group, { ...opts, corners });
};

export const setPerspectivePlane = (
  doc: Document,
  groupId: ID,
  plane: PerspectivePlaneKind,
  opts: { now?: string } = {},
): boolean => {
  const group = perspectiveGroup(doc, groupId);
  if (!group) return false;
  group.perspective = {
    ...normalizePerspectiveObject(group),
    plane,
    ...(opts.now ? { updatedAt: opts.now } : {}),
  };
  return true;
};

export const syncPerspectiveSource = (
  doc: Document,
  groupId: ID,
  opts: { now?: string } = {},
): boolean => {
  const group = perspectiveGroup(doc, groupId);
  if (!group) return false;
  group.perspective = makePerspectiveObject(group, {
    plane: group.perspective?.plane,
    corners: group.perspective?.corners,
    sourceItems: group.children,
    updatedAt: opts.now,
  });
  return true;
};

export const expandPerspectiveGroups = (doc: Document, ids: Iterable<ID>): ID[] => {
  const expanded: ID[] = [];
  for (const id of ids) {
    const group = perspectiveGroup(doc, id);
    if (!group) continue;
    delete group.perspective;
    expanded.push(group.id);
  }
  return expanded;
};

export const releasePerspectiveGroups = (doc: Document, ids: Iterable<ID>): ID[] => {
  const releaseIds: ID[] = [];
  for (const id of ids) {
    const group = perspectiveGroup(doc, id);
    if (!group) continue;
    const source = normalizePerspectiveObject(group);
    group.children = cloneDeep(source.sourceItems);
    delete group.perspective;
    releaseIds.push(group.id);
  }
  return releaseIds.length ? ungroup(doc, releaseIds) : [];
};
