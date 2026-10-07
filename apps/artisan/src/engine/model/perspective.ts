// ─────────────────────────────────────────────────────────────
// model/perspective — baseline Perspective live-object metadata
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import type { GroupItem, Item, PerspectiveCornerSet, PerspectiveObject, PerspectivePlaneKind } from "./types";

export const IDENTITY_PERSPECTIVE_CORNERS: PerspectiveCornerSet = {
  topLeft: { x: 0, y: 0 },
  topRight: { x: 1, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

export const DEFAULT_PERSPECTIVE_CORNERS: PerspectiveCornerSet = {
  topLeft: { x: 0.2, y: 0 },
  topRight: { x: 0.8, y: 0 },
  bottomRight: { x: 1, y: 1 },
  bottomLeft: { x: 0, y: 1 },
};

export interface PerspectiveOptions {
  plane?: PerspectivePlaneKind;
  corners?: PerspectiveCornerSet;
  sourceItems?: Item[];
  updatedAt?: string;
}

const cloneItems = (items: Item[]): Item[] => items.map((item) => cloneDeep(item));

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

export const clonePerspectiveCorners = (corners: PerspectiveCornerSet): PerspectiveCornerSet => ({
  topLeft: { ...corners.topLeft },
  topRight: { ...corners.topRight },
  bottomRight: { ...corners.bottomRight },
  bottomLeft: { ...corners.bottomLeft },
});

export const normalizePerspectiveCorners = (
  corners: PerspectiveCornerSet = DEFAULT_PERSPECTIVE_CORNERS,
): PerspectiveCornerSet => ({
  topLeft: {
    x: finite(corners.topLeft.x, IDENTITY_PERSPECTIVE_CORNERS.topLeft.x),
    y: finite(corners.topLeft.y, IDENTITY_PERSPECTIVE_CORNERS.topLeft.y),
  },
  topRight: {
    x: finite(corners.topRight.x, IDENTITY_PERSPECTIVE_CORNERS.topRight.x),
    y: finite(corners.topRight.y, IDENTITY_PERSPECTIVE_CORNERS.topRight.y),
  },
  bottomRight: {
    x: finite(corners.bottomRight.x, IDENTITY_PERSPECTIVE_CORNERS.bottomRight.x),
    y: finite(corners.bottomRight.y, IDENTITY_PERSPECTIVE_CORNERS.bottomRight.y),
  },
  bottomLeft: {
    x: finite(corners.bottomLeft.x, IDENTITY_PERSPECTIVE_CORNERS.bottomLeft.x),
    y: finite(corners.bottomLeft.y, IDENTITY_PERSPECTIVE_CORNERS.bottomLeft.y),
  },
});

export const perspectiveCornersForHorizontalAmount = (amount: number): PerspectiveCornerSet => {
  const inset = Math.max(-0.9, Math.min(0.9, amount)) / 2;
  return {
    topLeft: { x: inset, y: 0 },
    topRight: { x: 1 - inset, y: 0 },
    bottomRight: { x: 1, y: 1 },
    bottomLeft: { x: 0, y: 1 },
  };
};

export const makePerspectiveObject = (
  group: GroupItem,
  opts: PerspectiveOptions = {},
): PerspectiveObject => {
  const sourceItems = cloneItems(opts.sourceItems ?? group.children);
  return {
    id: group.id,
    plane: opts.plane ?? "one-point",
    corners: normalizePerspectiveCorners(opts.corners),
    sourceItems,
    sourceIds: sourceItems.map((item) => item.id),
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
  };
};

export const normalizePerspectiveObject = (group: GroupItem): PerspectiveObject => {
  const source = group.perspective ?? makePerspectiveObject(group);
  const sourceItems = source.sourceItems.length ? cloneItems(source.sourceItems) : cloneItems(group.children);
  return {
    id: group.id,
    plane: source.plane ?? "one-point",
    corners: normalizePerspectiveCorners(source.corners),
    sourceItems,
    sourceIds: sourceItems.map((item) => item.id),
    ...(source.updatedAt ? { updatedAt: source.updatedAt } : {}),
  };
};
