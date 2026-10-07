// ─────────────────────────────────────────────────────────────
// model/mesh — live gradient mesh metadata and generated patches
// ─────────────────────────────────────────────────────────────

import { mix, type RGBA } from "../color";
import { defaultStroke, makeAnchor, makeGroup, makePath, noPaint, solid } from "./factory";
import { localBounds } from "./shapes";
import { paintedFill } from "./appearance";
import type { GradientMeshObject, GroupItem, Item, MeshBounds, MeshPoint, PathItem } from "./types";

export const DEFAULT_MESH_ROWS = 5;
export const DEFAULT_MESH_COLUMNS = 5;

const DEFAULT_MESH_COLOR: RGBA = { r: 180, g: 180, b: 200, a: 1 };

const clampInt = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, Math.round(Number.isFinite(value) ? value : min)));

const cloneColor = (color: RGBA): RGBA => ({ ...color });

const lighten = (color: RGBA, t: number): RGBA => mix(color, { r: 255, g: 255, b: 255, a: color.a }, t);
const darken = (color: RGBA, t: number): RGBA => mix(color, { r: 0, g: 0, b: 0, a: color.a }, t);
const bilinear = (tl: RGBA, tr: RGBA, bl: RGBA, br: RGBA, u: number, v: number): RGBA =>
  mix(mix(tl, tr, u), mix(bl, br, u), v);

export const meshCornerColors = (base: RGBA = DEFAULT_MESH_COLOR): { tl: RGBA; tr: RGBA; bl: RGBA; br: RGBA } => ({
  tl: lighten(base, 0.3),
  tr: cloneColor(base),
  bl: lighten(base, 0.55),
  br: darken(base, 0.35),
});

const normalizedBounds = (bounds: MeshBounds): MeshBounds => ({
  x: Number.isFinite(bounds.x) ? bounds.x : 0,
  y: Number.isFinite(bounds.y) ? bounds.y : 0,
  width: Math.max(1, Math.abs(Number.isFinite(bounds.width) ? bounds.width : 1)),
  height: Math.max(1, Math.abs(Number.isFinite(bounds.height) ? bounds.height : 1)),
});

const makePoint = (
  bounds: MeshBounds,
  rows: number,
  columns: number,
  row: number,
  column: number,
  color: RGBA,
): MeshPoint => ({
  row,
  column,
  x: bounds.x + (bounds.width * column) / columns,
  y: bounds.y + (bounds.height * row) / rows,
  color: cloneColor(color),
});

export const makeMeshPoints = (
  bounds: MeshBounds,
  rows: number,
  columns: number,
  colors: { tl: RGBA; tr: RGBA; bl: RGBA; br: RGBA },
): MeshPoint[] => {
  const safeRows = clampInt(rows, 1, 100);
  const safeColumns = clampInt(columns, 1, 100);
  const safeBounds = normalizedBounds(bounds);
  const points: MeshPoint[] = [];
  for (let row = 0; row <= safeRows; row++) {
    for (let column = 0; column <= safeColumns; column++) {
      const u = column / safeColumns;
      const v = row / safeRows;
      points.push(makePoint(safeBounds, safeRows, safeColumns, row, column, bilinear(colors.tl, colors.tr, colors.bl, colors.br, u, v)));
    }
  }
  return points;
};

const pointKey = (row: number, column: number): string => `${row}:${column}`;

const pointMap = (points: MeshPoint[]): Map<string, MeshPoint> => {
  const map = new Map<string, MeshPoint>();
  points.forEach((point) => map.set(pointKey(point.row, point.column), point));
  return map;
};

const fallbackPoint = (mesh: GradientMeshObject, row: number, column: number): MeshPoint => {
  const bounds = normalizedBounds(mesh.bounds);
  return makePoint(bounds, mesh.rows, mesh.columns, row, column, DEFAULT_MESH_COLOR);
};

export const normalizeGradientMesh = (mesh: GradientMeshObject): GradientMeshObject => {
  const rows = clampInt(mesh.rows, 1, 100);
  const columns = clampInt(mesh.columns, 1, 100);
  const bounds = normalizedBounds(mesh.bounds);
  const points = pointMap(mesh.points);
  const normalizedPoints: MeshPoint[] = [];
  for (let row = 0; row <= rows; row++) {
    for (let column = 0; column <= columns; column++) {
      const existing = points.get(pointKey(row, column)) ?? fallbackPoint({ ...mesh, rows, columns, bounds }, row, column);
      normalizedPoints.push({
        row,
        column,
        x: bounds.x + (bounds.width * column) / columns,
        y: bounds.y + (bounds.height * row) / rows,
        color: cloneColor(existing.color),
      });
    }
  }
  return {
    id: mesh.id,
    rows,
    columns,
    bounds,
    points: normalizedPoints,
    ...(mesh.updatedAt ? { updatedAt: mesh.updatedAt } : {}),
  };
};

export const makeGradientMeshObject = (
  bounds: MeshBounds,
  opts: { id?: string; rows?: number; columns?: number; baseColor?: RGBA; updatedAt?: string } = {},
): GradientMeshObject => {
  const rows = clampInt(opts.rows ?? DEFAULT_MESH_ROWS, 1, 100);
  const columns = clampInt(opts.columns ?? DEFAULT_MESH_COLUMNS, 1, 100);
  const safeBounds = normalizedBounds(bounds);
  return {
    id: opts.id ?? "",
    rows,
    columns,
    bounds: safeBounds,
    points: makeMeshPoints(safeBounds, rows, columns, meshCornerColors(opts.baseColor)),
    ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
  };
};

const cellColor = (tl: MeshPoint, tr: MeshPoint, bl: MeshPoint, br: MeshPoint): RGBA =>
  bilinear(tl.color, tr.color, bl.color, br.color, 0.5, 0.5);

export const buildMeshChildren = (mesh: GradientMeshObject): PathItem[] => {
  const normalized = normalizeGradientMesh(mesh);
  const points = pointMap(normalized.points);
  const patches: PathItem[] = [];
  for (let row = 0; row < normalized.rows; row++) {
    for (let column = 0; column < normalized.columns; column++) {
      const tl = points.get(pointKey(row, column))!;
      const tr = points.get(pointKey(row, column + 1))!;
      const br = points.get(pointKey(row + 1, column + 1))!;
      const bl = points.get(pointKey(row + 1, column))!;
      patches.push(makePath(
        { closed: true, anchors: [tl, tr, br, bl].map((point) => makeAnchor({ x: point.x, y: point.y })) },
        { fill: solid(cellColor(tl, tr, bl, br)), stroke: defaultStroke(noPaint()) },
      ));
    }
  }
  return patches;
};

export const meshBaseColor = (item: Item): RGBA => {
  const fill = paintedFill(item);
  return fill.type === "solid" ? fill.color : DEFAULT_MESH_COLOR;
};

export const makeGradientMeshGroupFromItem = (
  item: Exclude<Item, GroupItem>,
  opts: { rows?: number; columns?: number; updatedAt?: string } = {},
): GroupItem => {
  const mesh = makeGradientMeshObject(localBounds(item), {
    rows: opts.rows,
    columns: opts.columns,
    baseColor: meshBaseColor(item),
    updatedAt: opts.updatedAt,
  });
  const group = makeGroup(buildMeshChildren(mesh), {
    name: "Gradient Mesh",
    transform: { ...item.transform },
    fill: noPaint(),
    stroke: defaultStroke(noPaint()),
  });
  mesh.id = group.id;
  group.mesh = mesh;
  return group;
};
