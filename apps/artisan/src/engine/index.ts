// ─────────────────────────────────────────────────────────────
// engine — the pure (React-free) Monet Artisan vector core
// ─────────────────────────────────────────────────────────────
// Geometry namespaces (Vec/Mat/BBox/Bez/Path) + core types are re-exported
// flat; model query/shapes/ops are namespaced to avoid name clashes.

export * from "./geometry";
export * from "./color";
export * from "./color-harmony";
export * from "./clone";
export * from "./model/types";
export * from "./model/factory";
export * from "./model/brushes";
export * from "./model/appearance";
export * from "./model/typography";
export * from "./model/prepress";
export * from "./model/export";
export * from "./model/shortcuts";
export * from "./model/variables";
export * from "./model/graphs";
export * from "./model/dimensions";
export * from "./model/mesh";
export * from "./model/live-paint";
export * from "./model/perspective";

export * as Shapes from "./model/shapes";
export * as Query from "./model/query";
export * as Ops from "./ops";
export * as IO from "./io";
export { arrowheadGeom, hasArrowheads, type ArrowheadGeom } from "./io/arrowhead-markers";

export * from "./store/store";
