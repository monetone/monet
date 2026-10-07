// ─────────────────────────────────────────────────────────────
// tools/registry — tool singletons + tool-rail metadata
// ─────────────────────────────────────────────────────────────

import { createSelectionTool } from "./selection";
import { createDirectSelectionTool } from "./direct-selection";
import { createPenTool } from "./pen";
import { createTypeTool } from "./type";
import { createTypeOnPathTool } from "./type-path";
import { createAreaTypeTool } from "./area-type";
import { createEyedropperTool } from "./eyedropper";
import { createShapeTool, type ShapeKind } from "./shapes";
import { createTransformTool } from "./transform-tools";
import { createAddAnchorTool, createConvertAnchorTool, createDeleteAnchorTool, createScissorsTool, createSmoothTool } from "./path-tools";
import { createArtboardTool } from "./artboard-tool";
import { createSliceSelectionTool, createSliceTool } from "./slice";
import { createPencilTool } from "./freehand";
import { createBlobBrushTool } from "./blob-brush";
import { createPaintbrushTool } from "./paintbrush";
import { createReshapeTool } from "./reshape";
import { createWidthTool } from "./width";
import { createPuppetWarpTool } from "./puppet-warp";
import { createMeshTool } from "./mesh";
import { createPerspectiveGridTool, createPerspectiveSelectionTool } from "./perspective";
import { createSymbolSprayerTool } from "./symbol-sprayer";
import { createSymbolismTool } from "./symbolism";
import { createFreeTransformTool } from "./free-transform";
import { createGeneratorTool } from "./generators";
import { createDimensionTool } from "./dimension";
import { createLassoTool, createMagicWandTool } from "./select-extra";
import { createPathShapeTool, createGridTool } from "./path-shapes";
import { createLiquifyTool } from "./liquify";
import { createGradientTool } from "./gradient-tool";
import { createLivePaintBucketTool, createLivePaintSelectionTool } from "./live-paint";
import { createShapeBuilderTool } from "./shape-builder";
import { createEraserTool } from "./eraser";
import { createKnifeTool } from "./knife";
import { createHandTool, createRotateViewTool, createZoomTool } from "./view";
import { createCurvatureTool } from "./curvature";
import { createBlendTool } from "./blend-tool";
import type { Tool, ToolMeta } from "./types";

const factories: Record<string, () => Tool> = {
  selection: createSelectionTool,
  "group-selection": () => createSelectionTool({ id: "group-selection", targetLeaf: true, progressive: true }),
  "direct-selection": createDirectSelectionTool,
  lasso: createLassoTool,
  "magic-wand": createMagicWandTool,
  pen: createPenTool,
  curvature: createCurvatureTool,
  blend: createBlendTool,
  pencil: createPencilTool,
  paintbrush: createPaintbrushTool,
  "blob-brush": createBlobBrushTool,
  smooth: createSmoothTool,
  width: createWidthTool,
  "puppet-warp": createPuppetWarpTool,
  reshape: createReshapeTool,
  "symbol-sprayer": createSymbolSprayerTool,
  "symbol-shifter": () => createSymbolismTool("shifter"),
  "symbol-scruncher": () => createSymbolismTool("scruncher"),
  "symbol-sizer": () => createSymbolismTool("sizer"),
  "symbol-spinner": () => createSymbolismTool("spinner"),
  "symbol-stainer": () => createSymbolismTool("stainer"),
  "symbol-styler": () => createSymbolismTool("styler"),
  flare: () => createGeneratorTool("flare"),
  "column-graph": () => createGeneratorTool("column-graph"),
  "bar-graph": () => createGeneratorTool("bar-graph"),
  "pie-graph": () => createGeneratorTool("pie-graph"),
  "line-graph": () => createGeneratorTool("line-graph"),
  "area-graph": () => createGeneratorTool("area-graph"),
  "scatter-graph": () => createGeneratorTool("scatter-graph"),
  "radar-graph": () => createGeneratorTool("radar-graph"),
  measure: () => createDimensionTool("measure"),
  dimension: () => createDimensionTool("dimension"),
  artboard: createArtboardTool,
  slice: createSliceTool,
  "slice-selection": createSliceSelectionTool,
  arc: () => createPathShapeTool("arc"),
  spiral: () => createPathShapeTool("spiral"),
  "rect-grid": () => createGridTool("rect-grid"),
  "polar-grid": () => createGridTool("polar-grid"),
  warp: () => createLiquifyTool("warp"),
  twirl: () => createLiquifyTool("twirl"),
  pucker: () => createLiquifyTool("pucker"),
  bloat: () => createLiquifyTool("bloat"),
  crystallize: () => createLiquifyTool("crystallize"),
  scallop: () => createLiquifyTool("scallop"),
  wrinkle: () => createLiquifyTool("wrinkle"),
  knife: createKnifeTool,
  "add-anchor": createAddAnchorTool,
  "delete-anchor": createDeleteAnchorTool,
  "convert-anchor": createConvertAnchorTool,
  type: createTypeTool,
  "type-on-path": createTypeOnPathTool,
  "area-type": createAreaTypeTool,
  // Illustrator's vertical type family — same tools, seeded with a vertical
  // writing mode (the model/renderer/Character panel already honour it).
  "vertical-type": () => createTypeTool({ id: "vertical-type", writingMode: "vertical-rl" }),
  "vertical-area-type": () => createAreaTypeTool({ id: "vertical-area-type", writingMode: "vertical-rl" }),
  "vertical-type-on-path": () => createTypeOnPathTool({ id: "vertical-type-on-path", writingMode: "vertical-rl" }),
  eyedropper: createEyedropperTool,
  rect: () => createShapeTool("rect"),
  "rounded-rect": () => createShapeTool("rounded-rect"),
  ellipse: () => createShapeTool("ellipse"),
  polygon: () => createShapeTool("polygon"),
  star: () => createShapeTool("star"),
  line: () => createShapeTool("line"),
  "free-transform": createFreeTransformTool,
  rotate: () => createTransformTool("rotate"),
  scale: () => createTransformTool("scale"),
  reflect: () => createTransformTool("reflect"),
  shear: () => createTransformTool("shear"),
  "shape-builder": createShapeBuilderTool,
  eraser: createEraserTool,
  scissors: createScissorsTool,
  gradient: createGradientTool,
  mesh: createMeshTool,
  "perspective-grid": createPerspectiveGridTool,
  "perspective-selection": createPerspectiveSelectionTool,
  "live-paint-bucket": createLivePaintBucketTool,
  "live-paint-selection": createLivePaintSelectionTool,
  "rotate-view": createRotateViewTool,
  hand: createHandTool,
  zoom: createZoomTool,
};

const instances: Record<string, Tool> = {};

export function getTool(id: string): Tool {
  if (!instances[id]) {
    const make = factories[id] ?? factories.selection;
    instances[id] = make();
  }
  return instances[id];
}

export function hasTool(id: string): boolean {
  return id in factories;
}

// Icons: keys in Monet's `I` map, or raw 16-box SVG path strings.
const ICON_ELLIPSE = "M3 8A5 5 0 1 0 13 8A5 5 0 0 0 3 8";
const ICON_POLYGON = "M8 2L14 6L12 13L4 13L2 6Z";
const ICON_STAR = "M8 2L9.8 6L14 6.2L10.7 9L12 13L8 10.7L4 13L5.3 9L2 6.2L6.2 6Z";
const ICON_LINE = "M3 13L13 3";
const ICON_RRECT = "M4 3L12 3Q13 3 13 4L13 12Q13 13 12 13L4 13Q3 13 3 12L3 4Q3 3 4 3Z";
const ICON_FREE_TRANSFORM = "M3 3H13V13H3Z M3 8H13 M8 3V13 M4 4L12 12 M12 4L4 12";
const ICON_SCALE = "M3 13L13 3 M9 3L13 3L13 7 M3 7L3 13L9 13";
const ICON_REFLECT = "M8 2L8 14 M3 5L5 8L3 11 M13 5L11 8L13 11";
const ICON_SHEAR = "M5 13L9 3L14 3L10 13Z";
const ICON_CONVERT = "M3 13Q3 4 13 4 M11 2L13 4L11 6";
const ICON_ADD_ANCHOR = "M8 3L8 13 M3 8L13 8";
const ICON_DEL_ANCHOR = "M3 8L13 8";
const ICON_ARC = "M3 13Q3 3 13 3";
const ICON_SPIRAL = "M8 8A2 2 0 1 1 6 6A4 4 0 1 1 10 10A6 6 0 1 1 3 4";
const ICON_RECT_GRID = "M3 3H13V13H3Z M3 8H13 M8 3V13";
const ICON_POLAR_GRID = "M8 2A6 6 0 1 1 7.9 2 M8 5A3 3 0 1 1 7.9 5 M2 8H14 M8 2V14";
const ICON_WARP = "M2 10Q5 4 8 8T14 6";
const ICON_TWIRL = "M8 8m-3 0a3 3 0 1 0 6 0a3 3 0 1 0 -6 0 M8 2A6 6 0 0 1 14 8";
const ICON_PUCKER = "M3 3L7 8L3 13 M13 3L9 8L13 13";
const ICON_BLOAT = "M8 2A6 6 0 1 1 7.9 2Z";
const ICON_CRYSTALLIZE = "M8 1L9.4 6L14 5L10.5 9L13 14L8 11L3 14L5.5 9L2 5L6.6 6Z";
const ICON_SCALLOP = "M2 9Q5 5 8 9T14 9";
const ICON_WRINKLE = "M2 8L4 6L6 9L8 5L10 9L12 6L14 8";
const ICON_KNIFE = "M4 12L11 5 M11 5L13 7L6 14Z";
const ICON_RESHAPE = "M3 12Q8 2 13 12 M8 6.5A1.5 1.5 0 1 0 8.01 6.5";
const ICON_SPRAYER = "M4 6h.6 M8 4h.6 M11 7h.6 M5 10h.6 M9 10h.6 M12 12h.6 M3 12h.6";
const ICON_FLARE = "M8 1V5 M8 11V15 M1 8H5 M11 8H15 M3.5 3.5L6 6 M10 10L12.5 12.5 M12.5 3.5L10 6 M6 10L3.5 12.5";
const ICON_COLUMN_GRAPH = "M3 13V8H5.5V13Z M6.7 13V4H9.2V13Z M10.5 13V9H13V13Z";
const ICON_PIE_GRAPH = "M8 8L8 2A6 6 0 0 1 13.2 9Z M8 8m-6 0a6 6 0 1 0 12 0a6 6 0 1 0 -12 0";
const ICON_LINE_GRAPH = "M3 12L6 8L9 10L13 4";
const ICON_DIMENSION = "M3 11H13 M4 9L3 11L4 13 M12 9L13 11L12 13 M5 5H11";

export const TOOL_META: ToolMeta[] = [
  { id: "selection", name: "Selection", icon: "cursor", shortcut: "V", group: "select", description: "Select, move, and resize whole objects." },
  { id: "direct-selection", name: "Direct Selection", icon: "marquee", shortcut: "A", group: "select", description: "Select and drag individual anchor points and path segments." },
  { id: "group-selection", name: "Group Selection", icon: "cursor", group: "select", description: "Select objects inside a group, one nesting level at a time." },
  { id: "magic-wand", name: "Magic Wand", icon: "marker", shortcut: "Y", group: "select", description: "Select objects with a similar fill, stroke, or opacity." },
  { id: "lasso", name: "Lasso", icon: "lasso", shortcut: "Q", group: "select", description: "Select anchor points and paths by dragging a freehand loop." },
  { id: "pen", name: "Pen", icon: "pen", shortcut: "P", group: "pen", description: "Draw precise paths by placing anchor points and curves." },
  { id: "add-anchor", name: "Add Anchor Point", icon: ICON_ADD_ANCHOR, shortcut: "+", group: "pen", description: "Add an anchor point to an existing path." },
  { id: "delete-anchor", name: "Delete Anchor Point", icon: ICON_DEL_ANCHOR, shortcut: "-", group: "pen", description: "Remove an anchor point from a path." },
  { id: "convert-anchor", name: "Anchor Point", icon: ICON_CONVERT, shortcut: "⇧C", group: "pen", description: "Convert anchors between smooth and corner points." },
  { id: "curvature", name: "Curvature", icon: "M2 11Q6 2 8 8T14 5", shortcut: "⇧~", group: "pen", description: "Draw smooth curves by placing points the path runs through." },
  { id: "type", name: "Type", icon: "text", shortcut: "T", group: "type", description: "Add and edit point or area text." },
  { id: "area-type", name: "Area Type", icon: "M3 4H13V12H3Z M5 6H11 M5 8H10 M5 10H8", group: "type", description: "Flow text inside a shape's outline." },
  { id: "type-on-path", name: "Type on a Path", icon: ICON_ARC, group: "type", description: "Set text running along a path." },
  { id: "vertical-type", name: "Vertical Type", icon: "M8 3V13 M5 4H11 M5 12H11", group: "type", description: "Add point text that reads top to bottom." },
  { id: "vertical-area-type", name: "Vertical Area Type", icon: "M3 4H13V12H3Z M6 5V11 M9 5V11", group: "type", description: "Flow vertical text inside a shape's outline." },
  { id: "vertical-type-on-path", name: "Vertical Type on a Path", icon: "M3 13Q3 3 13 3 M7 6V10", group: "type", description: "Set vertical text running along a path." },
  { id: "pencil", name: "Pencil", icon: "brush", shortcut: "N", group: "draw", description: "Draw freehand paths that follow your cursor." },
  { id: "paintbrush", name: "Paintbrush", icon: "marker", shortcut: "B", group: "draw", description: "Paint brush strokes along a path." },
  { id: "blob-brush", name: "Blob Brush", icon: "clone", shortcut: "⇧B", group: "draw", description: "Paint filled shapes that merge as you draw." },
  { id: "smooth", name: "Smooth", icon: ICON_ARC, group: "draw", description: "Smooth out a path's bumps while keeping its shape." },
  { id: "line", name: "Line Segment", icon: ICON_LINE, shortcut: "\\", group: "line", description: "Draw straight line segments." },
  { id: "arc", name: "Arc", icon: ICON_ARC, group: "line", description: "Draw curved arc segments." },
  { id: "spiral", name: "Spiral", icon: ICON_SPIRAL, group: "line", description: "Draw spiral shapes." },
  { id: "rect-grid", name: "Rectangular Grid", icon: ICON_RECT_GRID, group: "line", description: "Draw rectangular grids." },
  { id: "polar-grid", name: "Polar Grid", icon: ICON_POLAR_GRID, group: "line", description: "Draw concentric circular grids." },
  { id: "rect", name: "Rectangle", icon: "shape", shortcut: "M", group: "shape", description: "Draw rectangles and squares." },
  { id: "rounded-rect", name: "Rounded Rectangle", icon: ICON_RRECT, group: "shape", description: "Draw rectangles with rounded corners." },
  { id: "ellipse", name: "Ellipse", icon: ICON_ELLIPSE, shortcut: "L", group: "shape", description: "Draw ellipses and circles." },
  { id: "polygon", name: "Polygon", icon: ICON_POLYGON, group: "shape", description: "Draw polygons with any number of sides." },
  { id: "star", name: "Star", icon: ICON_STAR, group: "shape", description: "Draw stars with adjustable points." },
  { id: "free-transform", name: "Free Transform", icon: ICON_FREE_TRANSFORM, shortcut: "E", group: "transform", description: "Transform selected artwork with bounding-box scale and rotate handles." },
  { id: "rotate", name: "Rotate", icon: "loop", shortcut: "R", group: "transform", description: "Rotate objects around a set point." },
  { id: "scale", name: "Scale", icon: ICON_SCALE, shortcut: "S", group: "transform", description: "Scale objects larger or smaller." },
  { id: "reflect", name: "Reflect", icon: ICON_REFLECT, shortcut: "O", group: "transform", description: "Flip objects across an axis." },
  { id: "shear", name: "Shear", icon: ICON_SHEAR, group: "transform", description: "Slant objects along an axis." },
  { id: "reshape", name: "Reshape", icon: ICON_RESHAPE, group: "transform", description: "Adjust a path's shape while preserving its detail." },
  { id: "width", name: "Width", icon: "M2 8H14 M4 6V10 M8 4V12 M12 6V10", shortcut: "⇧W", group: "transform", description: "Vary a stroke's width at points along it." },
  { id: "puppet-warp", name: "Puppet Warp", icon: "M4 4L12 12 M4 12L12 4 M8 8m-2 0a2 2 0 1 0 4 0a2 2 0 1 0 -4 0", group: "transform", description: "Bend and reposition artwork with placed pins." },
  { id: "warp", name: "Warp", icon: ICON_WARP, shortcut: "⇧R", group: "liquify", description: "Push and stretch artwork by dragging." },
  { id: "twirl", name: "Twirl", icon: ICON_TWIRL, group: "liquify", description: "Swirl artwork around the cursor." },
  { id: "pucker", name: "Pucker", icon: ICON_PUCKER, group: "liquify", description: "Pull artwork inward toward the cursor." },
  { id: "bloat", name: "Bloat", icon: ICON_BLOAT, group: "liquify", description: "Push artwork outward from the cursor." },
  { id: "crystallize", name: "Crystallize", icon: ICON_CRYSTALLIZE, group: "liquify", description: "Add spiky, crystalline detail to artwork." },
  { id: "scallop", name: "Scallop", icon: ICON_SCALLOP, group: "liquify", description: "Add curved, scalloped detail to artwork." },
  { id: "wrinkle", name: "Wrinkle", icon: ICON_WRINKLE, group: "liquify", description: "Add jagged, wrinkled detail to artwork." },
  { id: "shape-builder", name: "Shape Builder", icon: "M5 5A3 3 0 1 0 5 11A3 3 0 0 0 5 5Z M11 5A3 3 0 1 0 11 11A3 3 0 0 0 11 5Z", shortcut: "⇧M", group: "build", description: "Merge and subtract overlapping shapes by dragging." },
  { id: "eraser", name: "Eraser", icon: "erase", shortcut: "⇧E", group: "build", description: "Erase parts of vector artwork by brushing over them." },
  { id: "knife", name: "Knife", icon: ICON_KNIFE, group: "cut", description: "Cut objects along a freehand line." },
  { id: "scissors", name: "Scissors", icon: "cut", shortcut: "C", group: "cut", description: "Split a path at a single point." },
  { id: "gradient", name: "Gradient", icon: "gradient", shortcut: "G", group: "paint", description: "Apply and adjust gradient fills by dragging." },
  { id: "mesh", name: "Mesh", icon: ICON_RECT_GRID, shortcut: "U", group: "paint", description: "Add a gradient mesh for multi-directional color blends." },
  { id: "blend", name: "Blend", icon: "M3 8A5 5 0 1 0 13 8A5 5 0 0 0 3 8 M5 8H11 M8 5V11", shortcut: "W", group: "paint", description: "Blend two objects by clicking one then the other." },
  { id: "perspective-grid", name: "Perspective Grid", icon: "M2 13L8 5L14 13 M2 13H14", shortcut: "⇧P", group: "perspective", description: "Draw and edit artwork on a perspective grid." },
  { id: "perspective-selection", name: "Perspective Selection", icon: "M4 12L12 12L10 5L6 5Z", shortcut: "⇧V", group: "perspective", description: "Move and add artwork within the perspective grid." },
  { id: "live-paint-bucket", name: "Live Paint Bucket", icon: "clone", shortcut: "K", group: "paint", description: "Fill regions of a Live Paint group with color." },
  { id: "live-paint-selection", name: "Live Paint Selection", icon: "cursor", shortcut: "⇧L", group: "paint", description: "Select faces and edges within a Live Paint group." },
  { id: "eyedropper", name: "Eyedropper", icon: "dropper", shortcut: "I", group: "paint", description: "Sample and apply appearance attributes between objects." },
  { id: "symbol-sprayer", name: "Symbol Sprayer", icon: ICON_SPRAYER, shortcut: "⇧S", group: "symbol", description: "Spray instances of a symbol like a particle stream." },
  { id: "symbol-shifter", name: "Symbol Shifter", icon: ICON_WARP, group: "symbol", description: "Nudge sprayed symbol instances around." },
  { id: "symbol-scruncher", name: "Symbol Scruncher", icon: ICON_PUCKER, group: "symbol", description: "Pull symbol instances closer together or apart." },
  { id: "symbol-sizer", name: "Symbol Sizer", icon: ICON_SCALE, group: "symbol", description: "Resize symbol instances in a set." },
  { id: "symbol-spinner", name: "Symbol Spinner", icon: "loop", group: "symbol", description: "Rotate symbol instances in a set." },
  { id: "symbol-stainer", name: "Symbol Stainer", icon: "dropper", group: "symbol", description: "Tint symbol instances toward the fill color." },
  { id: "symbol-styler", name: "Symbol Styler", icon: "marker", group: "symbol", description: "Apply a graphic style to symbol instances." },
  { id: "flare", name: "Flare", icon: ICON_FLARE, group: "shape", description: "Add a lens-flare object with rays and rings." },
  { id: "column-graph", name: "Column Graph", icon: ICON_COLUMN_GRAPH, shortcut: "J", group: "graph", description: "Create a vertical column graph from data." },
  { id: "bar-graph", name: "Bar Graph", icon: ICON_COLUMN_GRAPH, group: "graph", description: "Create a horizontal bar graph from data." },
  { id: "pie-graph", name: "Pie Graph", icon: ICON_PIE_GRAPH, group: "graph", description: "Create a pie graph from data." },
  { id: "line-graph", name: "Line Graph", icon: ICON_LINE_GRAPH, group: "graph", description: "Create a line graph from data." },
  { id: "area-graph", name: "Area Graph", icon: ICON_LINE_GRAPH, group: "graph", description: "Create a filled area graph from data." },
  { id: "scatter-graph", name: "Scatter Graph", icon: ICON_SPRAYER, group: "graph", description: "Create a scatter plot from data." },
  { id: "radar-graph", name: "Radar Graph", icon: ICON_POLAR_GRID, group: "graph", description: "Create a radar (web) graph from data." },
  { id: "measure", name: "Measure", icon: ICON_DIMENSION, group: "measure", description: "Measure distances by dragging a live dimension annotation." },
  { id: "dimension", name: "Dimension", icon: ICON_DIMENSION, group: "measure", description: "Draw measured dimension annotations with generated labels." },
  { id: "artboard", name: "Artboard", icon: ICON_RECT_GRID, shortcut: "⇧O", group: "canvas", description: "Create, resize, and rearrange artboards." },
  { id: "slice", name: "Slice", icon: "crop", shortcut: "⇧K", group: "canvas", description: "Define slices for web export." },
  { id: "slice-selection", name: "Slice Selection", icon: "cursor", group: "canvas", description: "Select and adjust existing slices." },
  { id: "hand", name: "Hand", icon: "hand", shortcut: "H", group: "view", description: "Pan around the document." },
  { id: "rotate-view", name: "Rotate View", icon: "loop", group: "view", description: "Temporarily rotate the canvas view." },
  { id: "zoom", name: "Zoom", icon: "zoom", shortcut: "Z", group: "view", description: "Zoom the view in and out." },
];

/**
 * Adobe Illustrator-style tool rail. Each entry is either a flyout *group* —
 * related tools sharing one rail slot, the first id being the slot's
 * default-visible tool and the rest reached via a click-hold flyout — or the
 * `"div"` token, a section divider. This mirrors Illustrator's default
 * toolbar: ~two dozen single-icon slots instead of every tool at once, with a
 * corner triangle marking slots that hide a flyout. Every tool stays reachable.
 */
export type RailEntry = string[] | "div";
export const TOOL_RAIL_GROUPS: RailEntry[] = [
  ["selection"],
  ["direct-selection", "group-selection"],
  ["magic-wand"],
  ["lasso"],
  "div",
  ["pen", "add-anchor", "delete-anchor", "convert-anchor", "curvature"],
  ["type", "area-type", "type-on-path", "vertical-type", "vertical-area-type", "vertical-type-on-path"],
  "div",
  ["line", "arc", "spiral", "rect-grid", "polar-grid"],
  ["rect", "rounded-rect", "ellipse", "polygon", "star", "flare"],
  ["paintbrush", "blob-brush"],
  ["pencil", "smooth"],
  ["shape-builder", "live-paint-bucket", "live-paint-selection"],
  ["eraser", "scissors", "knife"],
  "div",
  ["free-transform", "rotate", "reflect"],
  ["scale", "shear", "reshape"],
  ["width", "warp", "twirl", "pucker", "bloat", "scallop", "crystallize", "wrinkle"],
  ["puppet-warp"],
  "div",
  ["symbol-sprayer", "symbol-shifter", "symbol-scruncher", "symbol-sizer", "symbol-spinner", "symbol-stainer", "symbol-styler"],
  ["column-graph", "bar-graph", "pie-graph", "line-graph", "area-graph", "scatter-graph", "radar-graph"],
  ["measure", "dimension"],
  "div",
  ["mesh"],
  ["gradient"],
  ["blend"],
  ["eyedropper"],
  "div",
  ["perspective-grid", "perspective-selection"],
  ["artboard"],
  ["slice", "slice-selection"],
  "div",
  ["hand", "rotate-view"],
  ["zoom"],
];

/**
 * Tool shortcuts keyed for `KeyboardEvent` lookup. Illustrator pairs related
 * tools on one letter — B / ⇧B is Paintbrush / Blob Brush, E / ⇧E is Free
 * Transform / Eraser — so a Shift-prefixed meta shortcut ("⇧B") is keyed
 * `shift+b` and a plain one just `b`.
 */
export const shortcutToTool = (): Record<string, string> => {
  const map: Record<string, string> = {};
  for (const t of TOOL_META) {
    if (!t.shortcut) continue;
    const shift = t.shortcut.startsWith("⇧");
    map[(shift ? "shift+" : "") + t.shortcut.slice(shift ? 1 : 0).toLowerCase()] = t.id;
  }
  return map;
};
