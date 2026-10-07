// ─────────────────────────────────────────────────────────────
// model/types — the Monet Artisan document model
// ─────────────────────────────────────────────────────────────
// A Document owns artboards and a layer tree. Each Layer owns a z-ordered list
// of Items (index 0 = bottom, painted first). Items nest (groups), carry a
// local→parent transform, paint (fill/stroke), and compositing attributes.
//
// This module is PURE data — no React, no DOM. Geometry lives in ../geometry.

import type { Matrix } from "../geometry/matrix";
import type { PathGeometry } from "../geometry/path";
import type { RGBA } from "../color";

export type ID = string;

// ── Compositing ──────────────────────────────────────────────
// Values map 1:1 to CSS `mix-blend-mode`, so rendering is a direct passthrough.
export type BlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light"
  | "difference"
  | "exclusion"
  | "hue"
  | "saturation"
  | "color"
  | "luminosity";

export const BLEND_MODES: BlendMode[] = [
  "normal", "multiply", "screen", "overlay", "darken", "lighten",
  "color-dodge", "color-burn", "hard-light", "soft-light",
  "difference", "exclusion", "hue", "saturation", "color", "luminosity",
];

// ── Paint (fill / stroke source) ─────────────────────────────
export type GradientType = "linear" | "radial";
export type GradientSpread = "pad" | "reflect" | "repeat";

export interface GradientStop {
  /** Position along the gradient, 0..1. */
  offset: number;
  color: RGBA;
  /** Optional midpoint (0..1) of the blend toward the NEXT stop. */
  midpoint?: number;
}

export interface Gradient {
  type: GradientType;
  stops: GradientStop[];
  /** Endpoints in objectBoundingBox units (0..1), for linear + radial axis. */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** Radial center + radius + focal (objectBoundingBox units). */
  cx: number;
  cy: number;
  r: number;
  fx?: number;
  fy?: number;
  /** Tiling outside [0,1]. Absent ⇒ "pad" (SVG default). */
  spread?: GradientSpread;
  /** Raster-side sweep kinds (Vision's Gradient tool) parked verbatim so a Vision
   *  gradient survives an Artisan round trip; Artisan renders `type` instead.
   *  ponytail: courier field only — teach the renderer these sweeps if Artisan
   *  ever needs them natively. */
  sweep?: "angle" | "reflected" | "diamond";
}

/** A repeating tile of artwork used as a fill/stroke (SVG <pattern>). */
export interface Pattern {
  /** Tile artwork in the pattern's own space, (0,0)→(width,height). */
  tile: Item[];
  width: number;
  height: number;
  /** Optional tile→object transform (rotation/scale of the tiling). */
  transform?: Matrix;
}

export type InkKind = "process" | "spot";
export type ProcessInkName = "Cyan" | "Magenta" | "Yellow" | "Black";

export interface InkReference {
  id?: ID;
  name: string;
  kind: InkKind;
  /** Preview colour for spot/process ink chips. */
  color?: RGBA;
  /** CMYK components in percent, used for process swatches and PDF metadata. */
  components?: Partial<Record<"c" | "m" | "y" | "k", number>>;
  /** Spot tint in percent. Defaults to 100. */
  tint?: number;
}

export interface SeparationInk {
  id: ID;
  name: string;
  kind: InkKind;
  color: RGBA;
  enabled?: boolean;
}

export type PrintTarget = "active-artboard" | "all-artboards" | "selection";
export type PrintPageSize = "artboard" | "letter" | "a4" | "custom";
export type PrintOrientation = "auto" | "portrait" | "landscape";
export type PrintScaleMode = "fit" | "custom";
export type PrintPdfPreset = "artisan-editable" | "press-quality" | "smallest-file" | "custom";

export interface PrintBleed {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface PrintMarks {
  trim: boolean;
  registration: boolean;
  colorBars: boolean;
  pageInfo: boolean;
}

export interface PrintSettings {
  target: PrintTarget;
  pageSize: PrintPageSize;
  orientation: PrintOrientation;
  scaleMode: PrintScaleMode;
  /** Percent scale used when scaleMode is custom. */
  scale: number;
  tileArtwork: boolean;
  marks: PrintMarks;
  bleed: PrintBleed;
  preserveSpotColors: boolean;
  flattenTransparency: boolean;
  pdfPreset: PrintPdfPreset;
}

export interface PrepressSettings {
  overprintPreview: boolean;
  inks?: SeparationInk[];
  proofProfile?: string;
  inkLimit?: number;
  print?: PrintSettings;
}

export type Paint =
  | { type: "none" }
  | { type: "solid"; color: RGBA; ink?: InkReference }
  | { type: "gradient"; gradient: Gradient }
  | { type: "pattern"; pattern: Pattern };

export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";
export type StrokeAlign = "center" | "inside" | "outside";
/** Live stroke arrowhead (Illustrator's Stroke panel Arrowheads) — an SVG marker
 *  at the path's start/end that scales with the stroke and follows its direction. */
export type ArrowheadKind = "none" | "triangle" | "circle" | "square" | "bar";

export type BrushKind = "calligraphic";

export interface CalligraphicBrushSettings {
  /** Brush diameter in document units before zoom scaling. */
  size: number;
  /** Nib angle in degrees; -45 matches the legacy Paintbrush tool. */
  angle: number;
  /** 0..1 width multiplier for the calligraphic nib. */
  roundness: number;
  /** Which active paint supplies newly drawn brush artwork. */
  paintSource: "stroke" | "fill";
}

export interface CalligraphicBrushDefinition extends CalligraphicBrushSettings {
  id: ID;
  name: string;
  kind: "calligraphic";
  createdAt?: string;
  updatedAt?: string;
}

export type BrushDefinition = CalligraphicBrushDefinition;

export interface BrushApplication {
  brushId: ID;
  brushName: string;
  kind: BrushKind;
  settings: CalligraphicBrushSettings;
  /** Paintbrush currently expands the brush into geometry; path strokes can stay live. */
  expanded?: boolean;
  appliedAt?: string;
}

export interface Stroke {
  paint: Paint;
  width: number;
  cap: StrokeCap;
  join: StrokeJoin;
  miterLimit: number;
  dash: number[];
  dashOffset: number;
  align: StrokeAlign;
  /** Per-anchor width multipliers, flattened across compound subpaths. Absent ⇒ uniform width. */
  widthProfile?: number[];
  /** Arrowhead at the path start (marker-start). Absent ⇒ "none". */
  startArrow?: ArrowheadKind;
  /** Arrowhead at the path end (marker-end). Absent ⇒ "none". */
  endArrow?: ArrowheadKind;
}

// ── Effects (rendered as SVG filters) ────────────────────────
export type Effect =
  | { type: "drop-shadow"; dx: number; dy: number; blur: number; color: RGBA }
  | { type: "blur"; radius: number }
  | { type: "feather"; radius: number }
  | { type: "glow"; blur: number; color: RGBA }
  | { type: "inner-glow"; blur: number; color: RGBA };

export const EFFECT_TYPES = ["drop-shadow", "blur", "feather", "glow", "inner-glow"] as const;

// -- Appearance stack --------------------------------------------------------
// Illustrator paints an object through an ordered Appearance stack: multiple
// fills/strokes, each with its own visibility, opacity, blend mode, and effects.
// The legacy `fill`, `stroke`, `effects`, `opacity`, and `blendMode` fields stay
// as the primary/simple appearance for old documents and existing UI controls.
// When `appearance` exists, its entries paint bottom-to-top.
export interface AppearanceEntryBase {
  id: ID;
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  effects?: Effect[];
  overprint?: boolean;
}

export interface AppearanceFillEntry extends AppearanceEntryBase {
  kind: "fill";
  paint: Paint;
}

export interface AppearanceStrokeEntry extends AppearanceEntryBase {
  kind: "stroke";
  stroke: Stroke;
}

export type AppearanceEntry = AppearanceFillEntry | AppearanceStrokeEntry;

export interface AppearanceEffectPlacement {
  /** Effect metadata preserved for object-level or entry-level placement. */
  effect: Effect;
  scope: "object" | "entry";
  entryId?: ID;
}

export interface AppearanceStack {
  entries: AppearanceEntry[];
  effectPlacements?: AppearanceEffectPlacement[];
}

// ── Items ────────────────────────────────────────────────────
export interface ItemBase {
  id: ID;
  name: string;
  /** Local → parent transform. */
  transform: Matrix;
  fill: Paint;
  stroke: Stroke;
  /** Optional Brushes panel metadata for brush-applied strokes or expanded brush art. */
  brush?: BrushApplication;
  /** Optional Illustrator-style ordered appearance stack. */
  appearance?: AppearanceStack;
  /** 0..1 object opacity. */
  opacity: number;
  blendMode: BlendMode;
  visible: boolean;
  locked: boolean;
  /** Even-odd vs nonzero fill rule (paths/compound). */
  evenOdd?: boolean;
  /** Live effects rendered as an SVG filter chain. */
  effects?: Effect[];
  /** Print overprint flags for fill/stroke separations. */
  overprintFill?: boolean;
  overprintStroke?: boolean;
  /** Luminance mask content (SVG <mask>): white=opaque … black=transparent.
   *  These items render only as the mask, never as normal artwork. */
  mask?: Item[];
  /** Mask interpretation (SVG <mask mask-type>). Absent ⇒ "luminance" (default).
   *  "alpha" uses the mask content's alpha channel instead of its luminance. */
  maskType?: "luminance" | "alpha";
}

export interface PathItem extends ItemBase {
  type: "path";
  geometry: PathGeometry;
}

export interface CompoundPathItem extends ItemBase {
  type: "compound";
  subpaths: PathGeometry[];
}

export interface GroupItem extends ItemBase {
  type: "group";
  children: Item[];
  /** When true, the first child clips the rest (clip group). */
  clip: boolean;
  /** When set, this is a Blend group (Object ▸ Blend ▸ Make): the ids of the
   *  original key objects among `children`. Object ▸ Blend ▸ Release uses these
   *  to restore the originals and drop the interpolated steps. */
  blendKeyIds?: ID[];
  /** Linked symbol-instance metadata. Children are a synced editable snapshot. */
  symbolInstance?: SymbolInstance;
  /** Live data-backed graph metadata. Children are regenerated artwork. */
  graph?: GraphObject;
  /** Live dimension/measure annotation metadata. Children are regenerated artwork. */
  dimension?: DimensionObject;
  /** Live gradient mesh metadata. Children are regenerated patch artwork. */
  mesh?: GradientMeshObject;
  /** Live Paint group metadata. Children remain editable source artwork. */
  livePaint?: LivePaintObject;
  /** Live perspective metadata. Children are regenerated distorted artwork. */
  perspective?: PerspectiveObject;
  /** Envelope Distort metadata. Children are regenerated distorted artwork. */
  envelope?: EnvelopeObject;
}

/** Live rectangle in local space (0,0)→(width,height); rx/ry corner radii. */
export interface RectItem extends ItemBase {
  type: "rect";
  width: number;
  height: number;
  rx: number;
  ry: number;
  /** Live corner style for rounded corners (Illustrator "Corners"). Defaults to
   *  round; chamfer = straight cut, inverted = concave arc. */
  cornerStyle?: "round" | "chamfer" | "inverted";
}

/** Live ellipse, local bounding box (0,0)→(width,height). */
export interface EllipseItem extends ItemBase {
  type: "ellipse";
  width: number;
  height: number;
  /** Live "Pie" angles in degrees (Illustrator). When set and spanning less than
   *  a full turn, the ellipse renders as a wedge from pieStart→pieEnd. */
  pieStart?: number;
  pieEnd?: number;
}

/** Live regular polygon centered at local origin. */
export interface PolygonItem extends ItemBase {
  type: "polygon";
  radius: number;
  sides: number;
}

/** Live star centered at local origin (outer radius1, inner radius2). */
export interface StarItem extends ItemBase {
  type: "star";
  radius1: number;
  radius2: number;
  points: number;
}

/** Live line segment in local space. */
export interface LineItem extends ItemBase {
  type: "line";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
}

export type TextAlign = "left" | "center" | "right" | "justify";
export type TextDirection = "ltr" | "rtl";
export type TextWritingMode = "horizontal-tb" | "vertical-rl" | "vertical-lr";
export type TextGlyphOrientation = "mixed" | "upright" | "sideways";

export type FontResolutionStatus = "unresolved" | "resolved" | "missing" | "substituted";

export interface FontFallback {
  family: string;
  status?: FontResolutionStatus;
  source?: "document" | "system" | "generic";
  postScriptName?: string;
}

export interface FontResolution {
  requestedFamily: string;
  resolvedFamily?: string;
  postScriptName?: string;
  status: FontResolutionStatus;
  fallbacks?: FontFallback[];
  substitutedFor?: string;
}

export interface OpenTypeFeatureSetting {
  /** Four-character OpenType tag, e.g. "liga", "kern", "ss01". */
  tag: string;
  value: boolean | number | string;
}

export interface TextShapingRun {
  start: number;
  end: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  language?: string;
  direction?: TextDirection;
  features?: OpenTypeFeatureSetting[];
}

export interface TextGlyphPlacement {
  cluster: number;
  glyphId?: string;
  outlineD?: string;
  x: number;
  y: number;
  advance: number;
  rotation?: number;
}

export interface TextLayoutRun {
  start: number;
  end: number;
  source: "browser" | "harfbuzz" | "manual";
  width?: number;
  height?: number;
  glyphs?: TextGlyphPlacement[];
}

export interface TextLayoutSnapshot {
  engine: string;
  version: number;
  writingMode?: TextWritingMode;
  measuredAt?: string;
  runs: TextLayoutRun[];
}

/** One run of rich (multi-span) point text — an SVG <tspan>. */
export interface TextRun {
  text: string;
  /** Per-run fill; falls back to the item fill when absent. */
  fill?: Paint;
  /** Per-run shift (SVG tspan dx/dy, user units). */
  dx?: number;
  dy?: number;
  fontFamily?: string;
  fontSize?: number;
  fontWeight?: number;
  fontStyle?: "normal" | "italic";
  language?: string;
  direction?: TextDirection;
  features?: OpenTypeFeatureSetting[];
}

export interface TextItem extends ItemBase {
  type: "text";
  /** Point text baseline origin is the local (0,0). */
  text: string;
  /** Multi-run rich text. When present the renderer/exporter emit one <tspan>
   *  per run; `.text` stays the concatenated plain-text fallback. */
  runs?: TextRun[];
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
  lineHeight: number;
  align: TextAlign;
  /** Requested/resolved family metadata for font substitution and packaging. */
  fontResolution?: FontResolution;
  /** Default language/script hint for future shaping engines. */
  language?: string;
  /** Bidirectional layout hint; absent means browser/default LTR behavior. */
  direction?: TextDirection;
  /** Vertical type planning hook; horizontal-tb is the neutral/default mode. */
  writingMode?: TextWritingMode;
  /** Vertical glyph orientation policy for future vertical type tools. */
  glyphOrientation?: TextGlyphOrientation;
  /** Object-wide OpenType feature settings applied before per-run overrides. */
  features?: OpenTypeFeatureSetting[];
  /** Explicit run ranges for a future shaper; inferred from runs when absent. */
  shapingRuns?: TextShapingRun[];
  /** Optional measured/glyph layout snapshot; invalidated by text edit ops. */
  layout?: TextLayoutSnapshot;
  // ── Advanced Character (Illustrator's Character panel). All optional; an
  // absent value means the neutral default noted, so existing docs are unaffected.
  /** Vertical baseline offset in user units; positive raises (super/subscript). Default 0. */
  baselineShift?: number;
  /** Horizontal glyph scale, percent. Default 100. */
  horizontalScale?: number;
  /** Vertical glyph scale, percent. Default 100. */
  verticalScale?: number;
  /** Pair kerning. Default "auto". */
  kerning?: "auto" | "none";
  /** Underline decoration. Default off. */
  underline?: boolean;
  /** Strikethrough decoration. Default off. */
  strikethrough?: boolean;
  /** All Caps / Small Caps display style (reversible, unlike Change Case). Default normal. */
  caps?: "all" | "small";
  // ── Advanced Paragraph (Illustrator's Paragraph panel). All optional, default 0.
  /** Extra space before each paragraph (user units). */
  spaceBefore?: number;
  /** Extra space after each paragraph (user units). */
  spaceAfter?: number;
  /** Left margin / indent (user units). */
  indentLeft?: number;
  /** Right margin / indent — only affects wrapped area type (user units). */
  indentRight?: number;
  /** First-line indent (user units). */
  indentFirst?: number;
  /** Optional fixed area-type box (width/height). When absent it is point text. */
  boxWidth?: number;
  boxHeight?: number;
  /** Type-on-a-path: baked SVG path data (local space) the text flows along. */
  pathD?: string;
}

export interface CharacterStyleAttributes {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  fontStyle: "normal" | "italic";
  letterSpacing: number;
  lineHeight: number;
  baselineShift?: number;
  horizontalScale?: number;
  verticalScale?: number;
  kerning?: "auto" | "none";
  underline?: boolean;
  strikethrough?: boolean;
  caps?: "all" | "small";
  language?: string;
  direction?: TextDirection;
  writingMode?: TextWritingMode;
  glyphOrientation?: TextGlyphOrientation;
  features?: OpenTypeFeatureSetting[];
  fill?: Paint;
}

export interface ParagraphStyleAttributes {
  align: TextAlign;
  lineHeight: number;
  spaceBefore?: number;
  spaceAfter?: number;
  indentLeft?: number;
  indentRight?: number;
  indentFirst?: number;
}

export interface CharacterStyle {
  id: ID;
  name: string;
  attributes: CharacterStyleAttributes;
  createdAt?: string;
  updatedAt?: string;
}

export interface ParagraphStyle {
  id: ID;
  name: string;
  attributes: ParagraphStyleAttributes;
  createdAt?: string;
  updatedAt?: string;
}

export type PlacedAssetMode = "linked" | "embedded";
export type PlacedAssetStatus = "ok" | "missing" | "modified";

/** Illustrator-style placed-file metadata for the Links panel.
 *  Optional so legacy image items remain valid; query helpers infer a read-only
 *  view for old docs from `href`. */
export interface PlacedAsset {
  id: ID;
  mode: PlacedAssetMode;
  status: PlacedAssetStatus;
  name?: string;
  /** Original file/URL source when known; embedded assets keep it as provenance. */
  source?: string;
  mimeType?: string;
  sizeBytes?: number;
  lastModified?: number;
  linkedAt?: string;
  embeddedAt?: string;
  updatedAt?: string;
}

export interface ImageItem extends ItemBase {
  type: "image";
  /** Data URL or asset href. */
  href: string;
  /** Persistent linked/embedded placed-asset metadata. */
  asset?: PlacedAsset;
  width: number;
  height: number;
  naturalWidth: number;
  naturalHeight: number;
}

export type Item =
  | PathItem
  | CompoundPathItem
  | GroupItem
  | RectItem
  | EllipseItem
  | PolygonItem
  | StarItem
  | LineItem
  | TextItem
  | ImageItem;

export type ItemType = Item["type"];

/** Live shapes that can be losslessly converted to a path on demand. */
export const LIVE_SHAPES: ItemType[] = ["rect", "ellipse", "polygon", "star", "line"];

// ── Layers / Artboards / Document ────────────────────────────
export interface Layer {
  id: ID;
  name: string;
  /** UI swatch color for the layer. */
  color: string;
  visible: boolean;
  locked: boolean;
  opacity: number;
  blendMode: BlendMode;
  /** Non-printing template (reference) layer. */
  template: boolean;
  /** Z-ordered items: index 0 = bottom. */
  items: Item[];
}

export interface Artboard {
  id: ID;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

/** An export slice region (Slice tool). */
export interface Slice {
  id: ID;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface SymbolDefinition {
  id: ID;
  name: string;
  items: Item[];
  createdAt?: string;
  updatedAt?: string;
}

export interface SymbolInstance {
  symbolId: ID;
  detached?: boolean;
}

export type GraphKind =
  | "column"
  | "bar"
  | "line"
  | "area"
  | "scatter"
  | "pie"
  | "radar";

export interface GraphDatum {
  label: string;
  value: number;
  /** Optional x value for scatter graphs; absent means ordinal/indexed data. */
  x?: number;
  /** Optional per-datum display colour. */
  color?: RGBA;
}

export interface GraphObject {
  id: ID;
  kind: GraphKind;
  data: GraphDatum[];
  width: number;
  height: number;
  showLegend?: boolean;
  showAxes?: boolean;
  stacked?: boolean;
  updatedAt?: string;
}

export type DimensionKind = "linear";

export interface DimensionObject {
  id: ID;
  kind: DimensionKind;
  /** Start/end points in the dimension group's local space. */
  start: { x: number; y: number };
  end: { x: number; y: number };
  /** Distance in document units between start and end. */
  length: number;
  /** Angle in radians from start to end, measured in document coordinates. */
  angle: number;
  units: Units;
  precision: number;
  /** Optional custom label; absent means derive from length/units/precision. */
  label?: string;
  updatedAt?: string;
}

export interface MeshBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MeshPoint {
  row: number;
  column: number;
  x: number;
  y: number;
  color: RGBA;
}

export interface GradientMeshObject {
  id: ID;
  rows: number;
  columns: number;
  bounds: MeshBounds;
  points: MeshPoint[];
  updatedAt?: string;
}

export type LivePaintGapDetection = "none" | "small" | "medium" | "large";

export interface LivePaintFace {
  id: ID;
  /** Child item whose current fill represents this baseline face. */
  itemId: ID;
  fill: Paint;
  updatedAt?: string;
}

export interface LivePaintEdge {
  id: ID;
  /** Child item whose current stroke represents this baseline edge. */
  itemId: ID;
  stroke: Stroke;
  updatedAt?: string;
}

export interface LivePaintObject {
  id: ID;
  faces: LivePaintFace[];
  edges: LivePaintEdge[];
  gapDetection?: LivePaintGapDetection;
  updatedAt?: string;
}

export type PerspectivePlaneKind = "one-point" | "two-point" | "three-point";

export interface PerspectiveCornerSet {
  topLeft: { x: number; y: number };
  topRight: { x: number; y: number };
  bottomRight: { x: number; y: number };
  bottomLeft: { x: number; y: number };
}

/** Warp styles shared by Effect ▸ Warp and Object ▸ Envelope Distort ▸ Make with Warp. */
export type WarpStyle = "arc" | "arc-lower" | "arc-upper" | "flag" | "wave" | "bulge" | "rise";

/** How an envelope deforms its contents. */
export type EnvelopeKind = "warp" | "top-object";

/**
 * Object ▸ Envelope Distort metadata on a group. The group's children are
 * REGENERATED distorted artwork; `sourceItems` keeps the undistorted originals so
 * changing the envelope re-derives from them (never compounding), Release can
 * restore them, and Expand simply drops this metadata.
 */
export interface EnvelopeObject {
  id: ID;
  kind: EnvelopeKind;
  /** Warp parameters (kind === "warp"). */
  warp?: { style: WarpStyle; bend: number };
  /** The envelope outline in world space (kind === "top-object"). */
  shape?: PathGeometry;
  /** Original child artwork snapshot used to regenerate or release the group. */
  sourceItems: Item[];
  sourceIds: ID[];
}

export interface PerspectiveObject {
  id: ID;
  plane: PerspectivePlaneKind;
  /** Normalized unit-square corners used by the affine/bilinear fallback. */
  corners: PerspectiveCornerSet;
  /** Original child artwork snapshot used to regenerate or release the group. */
  sourceItems: Item[];
  sourceIds: ID[];
  updatedAt?: string;
}

export type ActionStepCommand =
  | "duplicate"
  | "group"
  | "ungroup"
  | "bring-to-front"
  | "bring-forward"
  | "send-backward"
  | "send-to-back"
  | "delete";

export interface ActionStep {
  id: ID;
  name: string;
  command: ActionStepCommand;
  enabled?: boolean;
}

export interface DocumentAction {
  id: ID;
  name: string;
  steps: ActionStep[];
  createdAt?: string;
  updatedAt?: string;
}

export type ShortcutModifier = "meta" | "shift" | "alt";

export interface ShortcutBinding {
  key: string;
  modifiers: ShortcutModifier[];
}

export interface ShortcutOverride {
  actionId: string;
  binding?: ShortcutBinding;
  enabled?: boolean;
  updatedAt?: string;
}

export interface ShortcutSettings {
  setName: string;
  overrides: ShortcutOverride[];
  updatedAt?: string;
}

export type DataVariableKind = "visibility" | "text" | "fill";

export interface DataVariableBinding {
  itemId: ID;
  attribute: DataVariableKind;
}

export interface DataVariable {
  id: ID;
  name: string;
  kind: DataVariableKind;
  binding?: DataVariableBinding;
  createdAt?: string;
  updatedAt?: string;
}

export interface DataVariableValue {
  text?: string;
  visible?: boolean;
  paint?: Paint;
}

export interface DataSet {
  id: ID;
  name: string;
  values: Record<ID, DataVariableValue>;
  createdAt?: string;
  updatedAt?: string;
}

export interface DataVariableSettings {
  variables: DataVariable[];
  dataSets: DataSet[];
  activeDataSetId?: ID;
  updatedAt?: string;
}

export type ExportForScreensTarget = "artboards" | "slices" | "artboards-and-slices";
export type ExportForScreensFormat = "svg" | "png" | "pdf" | "jpeg" | "webp" | "tiff";

export interface ExportForScreensSettings {
  target: ExportForScreensTarget;
  formats: ExportForScreensFormat[];
  scale: number;
  includeManifest?: boolean;
  baseName?: string;
}

export type ColorMode = "RGB" | "CMYK";
export type Units = "px" | "pt" | "pc" | "in" | "mm" | "cm";

export interface DocumentMeta {
  colorMode: ColorMode;
  units: Units;
  /** Document raster effect resolution (ppi). */
  dpi: number;
}

export interface Document {
  id: ID;
  name: string;
  meta: DocumentMeta;
  artboards: Artboard[];
  activeArtboard: number;
  /** Z-ordered layers: index 0 = bottom, painted first. */
  layers: Layer[];
  /** Document-level reusable color swatches. */
  swatches: Paint[];
  /** Reusable stroke/paint brushes shown in the Brushes panel. */
  brushes?: BrushDefinition[];
  /** Saved appearance presets (Graphic Styles panel), re-applied to a selection. */
  graphicStyles?: GraphicStyle[];
  /** Saved Character Styles panel presets. */
  characterStyles?: CharacterStyle[];
  /** Saved Paragraph Styles panel presets. */
  paragraphStyles?: ParagraphStyle[];
  /** Reusable symbol definitions used by linked symbol instances. */
  symbols?: SymbolDefinition[];
  /** Document-backed Actions panel macros replayed against the current selection. */
  actions?: DocumentAction[];
  /** Document-backed shortcut override set for the keyboard shortcut editor. */
  shortcuts?: ShortcutSettings;
  /** Baseline Variables panel metadata for data-driven graphics. */
  variables?: DataVariableSettings;
  /** Print/prepress preview and ink metadata. */
  prepress?: PrepressSettings;
  /** Export for Screens target/format setup. */
  exportForScreens?: ExportForScreensSettings;
  /** Export slice regions. */
  slices?: Slice[];
}

/** A saved appearance (fill / stroke / opacity / blend mode / appearance stack) re-applied from the
 *  Graphic Styles panel. Stored on the document, like swatches. */
export interface GraphicStyle {
  id: ID;
  name: string;
  fill: Paint;
  stroke: Stroke;
  appearance?: AppearanceStack;
  opacity: number;
  blendMode: BlendMode;
}
