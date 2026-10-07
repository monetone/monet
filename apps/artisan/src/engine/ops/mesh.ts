// ─────────────────────────────────────────────────────────────
// ops/mesh — live gradient mesh creation and regeneration
// ─────────────────────────────────────────────────────────────

import type { RGBA } from "../color";
import {
  buildMeshChildren,
  makeGradientMeshGroupFromItem,
  makeGradientMeshObject,
  makeMeshPoints,
  normalizeGradientMesh,
} from "../model/mesh";
import { findItem } from "../model/query";
import type { Document, GradientMeshObject, GroupItem, ID, Item, MeshPoint } from "../model/types";

type MeshSourceItem = Exclude<Item, GroupItem>;

export interface CreateMeshOptions {
  rows?: number;
  columns?: number;
  now?: string;
}

const DEFAULT_COLOR: RGBA = { r: 180, g: 180, b: 200, a: 1 };

const meshGroup = (doc: Document, id: ID): GroupItem | null => {
  const item = findItem(doc, id)?.item;
  return item?.type === "group" && item.mesh ? item : null;
};

const withTimestamp = (mesh: GradientMeshObject, now?: string): GradientMeshObject => ({
  ...mesh,
  ...(now ? { updatedAt: now } : {}),
});

const rebuildGroup = (group: GroupItem, mesh: GradientMeshObject): void => {
  const normalized = normalizeGradientMesh({ ...mesh, id: group.id });
  group.mesh = normalized;
  group.children = buildMeshChildren(normalized);
};

const pointColor = (points: MeshPoint[], row: number, column: number): RGBA =>
  points.find((point) => point.row === row && point.column === column)?.color ?? DEFAULT_COLOR;

export const createMeshFromItem = (
  doc: Document,
  itemId: ID,
  opts: CreateMeshOptions = {},
): ID | null => {
  const loc = findItem(doc, itemId);
  if (!loc || loc.item.type === "group") return null;
  const group = makeGradientMeshGroupFromItem(loc.item as MeshSourceItem, {
    rows: opts.rows,
    columns: opts.columns,
    updatedAt: opts.now,
  });
  loc.container.splice(loc.index, 1, group);
  return group.id;
};

export const updateMeshPointColor = (
  doc: Document,
  meshId: ID,
  row: number,
  column: number,
  color: RGBA,
  opts: { now?: string } = {},
): boolean => {
  const group = meshGroup(doc, meshId);
  if (!group) return false;
  const mesh = normalizeGradientMesh({ ...group.mesh!, id: group.id });
  const point = mesh.points.find((candidate) => candidate.row === row && candidate.column === column);
  if (!point) return false;
  point.color = { ...color };
  rebuildGroup(group, withTimestamp(mesh, opts.now));
  return true;
};

export const setMeshGrid = (
  doc: Document,
  meshId: ID,
  rows: number,
  columns: number,
  opts: { now?: string } = {},
): boolean => {
  const group = meshGroup(doc, meshId);
  if (!group) return false;
  const current = normalizeGradientMesh({ ...group.mesh!, id: group.id });
  const next = makeGradientMeshObject(current.bounds, {
    id: group.id,
    rows,
    columns,
    updatedAt: opts.now ?? current.updatedAt,
  });
  next.points = makeMeshPoints(next.bounds, next.rows, next.columns, {
    tl: pointColor(current.points, 0, 0),
    tr: pointColor(current.points, 0, current.columns),
    bl: pointColor(current.points, current.rows, 0),
    br: pointColor(current.points, current.rows, current.columns),
  });
  rebuildGroup(group, next);
  return true;
};

export const regenerateMesh = (doc: Document, meshId: ID): boolean => {
  const group = meshGroup(doc, meshId);
  if (!group) return false;
  rebuildGroup(group, { ...group.mesh!, id: group.id });
  return true;
};

/** Edit the mesh's source colours and immediately rebuild its generated cells. */
export const mapMeshColors = (doc: Document, meshId: ID, map: (color: RGBA) => RGBA): boolean => {
  const group = meshGroup(doc, meshId);
  if (!group) return false;
  const mesh = normalizeGradientMesh({ ...group.mesh!, id: group.id });
  mesh.points = mesh.points.map((point) => ({ ...point, color: map(point.color) }));
  rebuildGroup(group, mesh);
  return true;
};

export const detachMesh = (doc: Document, ids: Iterable<ID>): ID[] => {
  const detached: ID[] = [];
  for (const id of ids) {
    const group = meshGroup(doc, id);
    if (!group) continue;
    delete group.mesh;
    detached.push(group.id);
  }
  return detached;
};
