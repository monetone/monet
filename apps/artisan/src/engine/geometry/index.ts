// Barrel for the geometry layer. Submodules share short names (add/sub/scale),
// so they are exposed as namespaces; the core data types are re-exported flat.

export * as Vec from "./vec";
export * as Mat from "./matrix";
export * as BBox from "./bbox";
export * as Bez from "./bezier";
export * as Path from "./path";

export type { Point } from "./vec";
export type { Matrix, Decomposition } from "./matrix";
export type { Rect } from "./bbox";
export type { Cubic } from "./bezier";
export type { Anchor, PathGeometry, PathHit } from "./path";
