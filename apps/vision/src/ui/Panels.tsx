// ─────────────────────────────────────────────────────────────
// Panels — the wired dock panels: Layers, Color, Adjustments,
// History, Info, Histogram, Navigator. All read the reactive store
// and drive the engine through the action layer.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent as ReactMouseEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import {
  LayerList, LayerRow, OpacityControl, BlendModeSelect, ColorPicker, Button, Dialog, Icon, I,
  Histogram, Slider, NumberField, Select, Checkbox, SegmentedControl, hsvToHex, hexToHsv, ContextMenu, Menu, Textarea, Input, Autocomplete, useToast, type LayerData, type MenuItemDef,
} from "@monet-ui/monet-react";
import { engine, store, useStore, actions, anim, library, exportGIF, framesAdjust, copySwatchColor, smart, importSwatchesFile, exportSwatchesAco, saveBytes, importActionsFile, importStylesFile, text, authorActionStop } from "../state/app";
import { measurementLogText } from "../state/measurementLog";
import { ACTION_CONDITIONS, PLAYBACK_MODES, stepLabel, type PlaybackMode } from "../state/actionSets";
import { brushScatter, brushShapeDynamics, brushTransfer, setBrushScatter, setBrushShapeDynamics, setBrushTransfer, type BrushShapeDynamics, type BrushTransfer } from "../state/brushDynamics";
import type { Align, RGBA, TextRun, TextSpec, Hyphenation, Justification } from "../text/spec";
import { fontPreviewOptionStyle } from "../state/fontPreview";
import { axisLabel, axisStep, fontAxes, fontStylePatch, fontStyles, matchFontStyle, unknownFontStyleMessage } from "../state/fontStyles";
import type { LibraryGraphic } from "../state/libraries";
import { buildAsl, stylePreviewCss } from "../state/stylePresets";
import { histogramStats, levelFromFraction, histogramReadout } from "@monet-ui/monet-photo";
import { downsampleBins, histogramAllChannelOptions, histogramChannelOptions, type HistChannel, type HistScope } from "../state/channelHistogram";
import { drawVectorscope, drawWaveform, drawWaveformParade, drawWaveformRgb } from "@monet-ui/monet-scopes";
import { visibleDocRect, thumbBox, viewRectInThumb, panForCenter } from "../state/navigator";
import {
  layerAttributeMatches,
  layerEffectMatches,
  layerKindMatches,
  layerModeMatches,
  LAYER_ATTRIBUTE_FILTERS,
  LAYER_EFFECT_FILTERS,
  LAYER_KIND_FILTERS,
  LAYER_MODE_FILTERS,
  type LayerAttributeFilter,
  type LayerEffectFilter,
  type LayerKindFilter,
  type LayerModeFilter,
} from "../state/layerKindFilter";
import { LAYER_KIND, BLEND_ORDER, blendIndex } from "../state/engineContracts";
import { CAMERA_RAW_FID, DEFAULT_CHANNEL_OPTIONS, HISTORY_STATES_MAX, HISTORY_STATES_MIN, SNAPSHOT_THUMB_H, SNAPSHOT_THUMB_W, type ChannelOptions, type HistoryOptions, type SmartFilterRow, type ToolId } from "../state/store";
import { rampColor, RAMP_MODES, type RampMode } from "@monet-ui/monet-color";
import { defaultColors } from "@monet-ui/monet-color";
import { hasPath, MAX_CLIP_FLATNESS, MIN_CLIP_FLATNESS } from "../state/paths";
import { hexToRgb, FILL_CONTENTS, type FillContent } from "../state/fillContents";
import { quickMaskOverlay, setQuickMaskOverlay, type QuickMaskOverlay } from "../state/quickMaskOverlay";
import { LayerCompSessions, compForApply, type LayerComp } from "../state/layerComps";
import { labelColor, LAYER_LABELS, type LayerLabel } from "../state/layerLabels";
import { layerColorMatches } from "../state/layerColorFilter";
import { selectionRect } from "../state/selectionInfo";
import { rgbToHsb } from "@monet-ui/monet-color";
import { rgbToLab, rgbToCmyk } from "@monet-ui/monet-photo";
import { colorHexCode } from "@monet-ui/monet-color";
import { colorModeName, documentProfileName } from "@monet-ui/monet-color";
import { FX_DEFS } from "../state/effects";
import { filterDef } from "../state/filterGallery";
import { GALLERY_PINS_FID, SPIN_PINS_FID, type PinnedBlurEditRequest } from "./blurGallery";
import { useDialogs, MeasurementRows, ADJ_SPECS, HueSaturationControls, type DialogName } from "./Dialogs";
import { GROUP_BLEND_OPTIONS, titleCase, Row as SliderRow } from "./dialogs/common";
import { packHueSaturation, unpackHueSaturation } from "../state/hueSaturation";
import {
  formatDash, parseDash, STROKE_ALIGNS, STROKE_CAPS, STROKE_JOINS,
  type StrokeAlign, type StrokeCap, type StrokeJoin,
} from "../state/shapeProps";
import {
  clippingBoundaryLayer,
  flattenLayerTree,
  layerDropPosition,
  planLayerDrop,
  planLayerStep,
  type LayerDropPosition,
} from "./layerTree";
import { beginLayerPngDrag } from "../native/layerDragOut";
import { DEFAULT_PANEL_OPTIONS, PANEL_THUMBNAIL_SIZES, type PanelOptions } from "../state/panelOptions";
import { DEFAULT_CLONE_TRANSFORM } from "../state/cloneSample";

const ACCENT = "var(--accent-raster)";

function panelMenu(name: string, items: MenuItemDef[]) {
  return <Menu items={items} align="end">
    {({ ref, toggle, open: _open, id, ...aria }) => (
      <button ref={ref as React.Ref<HTMLButtonElement>} {...aria} type="button" id={id}
        data-mv-panel-flyout={name} aria-label={`${name} panel menu`} title={`${name} panel menu`}
        className="mv-panel-menu" onClick={toggle}>☰</button>
    )}
  </Menu>;
}

/** The Layers-panel row under an event. A Select's portalled options are
 *  role="option" too and bubble React events through the panel, but are not in
 *  its DOM — so they never count as a layer row. */
function layerRowAt(e: React.SyntheticEvent<HTMLElement>): Element | null {
  const row = (e.target as HTMLElement).closest('[role="option"]');
  return row && e.currentTarget.contains(row) ? row : null;
}

function thumbnailOptions(key: keyof typeof PANEL_THUMBNAIL_SIZES, size: number): MenuItemDef {
  return { id: `${key}-options`, label: "Thumbnail Size", items: PANEL_THUMBNAIL_SIZES[key].map((value, i) => ({
    id: `${key}-${value}`, label: ["Small", "Medium", "Large"][i], checked: size === value,
    action: () => store.setPanelOptions({ [key]: value }),
  })) };
}

/** Saved panel options that failed validation, shown beside the menu that saves them again. */
function PanelOptionsError() {
  const error = useStore((s) => s.panelOptionsError);
  return error ? <div role="alert" style={{ fontSize: 11, color: "var(--text-2)", marginBottom: 6 }}>{error}</div> : null;
}

/** Photoshop's per-attribute lock toggles, in panel order (#418). The bits
 *  match the engine's `set_layer_locks` bitfield. */
const LOCK_TOGGLES: { bit: number; label: string; glyph: string }[] = [
  { bit: 1, label: "Lock Transparent Pixels", glyph: "▨" },
  { bit: 2, label: "Lock Image Pixels", glyph: "🖌" },
  { bit: 4, label: "Lock Position", glyph: "✥" },
];

const SMART_FILTER_NAMES: Record<number, string> = {
  0: "Gaussian Blur",
  1: "Box Blur",
  2: "Sharpen",
  3: "Unsharp Mask",
  4: "Median",
  5: "Find Edges",
  6: "Emboss",
  7: "Motion Blur",
  8: "High Pass",
  9: "Mosaic",
  10: "Vignette",
  11: "Add Noise",
  12: "Oil Paint",
  13: "Spherize",
  14: "Twirl",
  15: "Path Blur",
  16: "Pinch",
  17: "Camera Raw",
  // fids 18-115: the whole Filter menu became smart-capable (VIS-LS-03).
  18: "Lens Blur",
  19: "Smart Sharpen",
  20: "Shake Reduction",
  21: "Reduce Noise",
  22: "Reduce JPEG Artifacts",
  23: "HSB/HSL",
  24: "Blur Gallery",
  25: "Spin Blur",
  26: "Displace",
  27: "Lens Correction",
  28: "Tree",
  29: "Flame",
  30: "Picture Frame",
  31: "NTSC Colors",
  32: "De-Interlace",
  33: "Glowing Edges",
  34: "Trace Contour",
  35: "Wind",
  36: "Poster Edges",
  37: "Cutout",
  38: "Film Grain",
  39: "Dry Brush",
  40: "Watercolor",
  41: "Colored Pencil",
  42: "Smudge Stick",
  43: "Sponge",
  44: "Palette Knife",
  45: "Paint Daubs",
  46: "Fresco",
  47: "Rough Pastels",
  48: "Underpainting",
  49: "Crosshatch",
  50: "Spatter",
  51: "Angled Strokes",
  52: "Dark Strokes",
  53: "Sprayed Strokes",
  54: "Sumi-e",
  55: "Mosaic Tiles",
  56: "Patchwork",
  57: "Craquelure",
  58: "Grain",
  59: "Neon Glow",
  60: "Plastic Wrap",
  61: "Accented Edges",
  62: "Ink Outlines",
  63: "Texturizer",
  64: "Fibers",
  65: "Photocopy",
  66: "Stamp",
  67: "Note Paper",
  68: "Torn Edges",
  69: "Water Paper",
  70: "Chalk & Charcoal",
  71: "Conte Crayon",
  72: "Reticulation",
  73: "Plaster",
  74: "Graphic Pen",
  75: "Charcoal",
  76: "Halftone Pattern",
  77: "Bas Relief",
  78: "Chrome",
  79: "Tiles",
  80: "Fragment",
  81: "Color Halftone",
  82: "Crystallize",
  83: "Stained Glass",
  84: "Pointillize",
  85: "Mezzotint",
  86: "Average",
  87: "Sharpen Edges",
  88: "Despeckle",
  89: "Facet",
  90: "Extrude",
  91: "Lighting Effects",
  92: "Radial Blur",
  93: "Polar Coordinates",
  94: "Ripple",
  95: "Ocean Ripple",
  96: "Glass",
  97: "ZigZag",
  98: "Shear",
  99: "Wave",
  100: "Diffuse Glow",
  101: "Shadows/Highlights",
  102: "Smart Blur",
  103: "Solarize",
  104: "Surface Blur",
  105: "Dust & Scratches",
  106: "Custom",
  107: "Maximum",
  108: "Minimum",
  109: "Lens Flare",
  110: "Offset",
  111: "Diffuse",
  112: "Clouds",
  113: "Difference Clouds",
  114: "Blur Gallery",
  115: "Spin Blur",
  // Same user-facing filter as 27, the variant with independent red/cyan and
  // blue/yellow fringe controls.
  116: "Lens Correction",
  117: "Liquify",
  118: "Lens Profile Correction",
};

// One editable field of a re-edited smart filter. `min`/`max` are in ENGINE
// units — a stored smart param is exactly the argument its `fil.*`/`distort.*`
// action received (state/app.ts `applyFilter`), so a gallery filter's UI range
// has to travel through that filter's own `args()` to land in the same space.
export interface SmartFilterParamSpec {
  label: string;
  min?: number;
  max?: number;
  /** Nudge granularity; also the field's precision (1 → integer field). */
  step?: number;
}

const bool = (label: string): SmartFilterParamSpec => ({ label, min: 0, max: 1, step: 1 });
const angle = (label = "Angle", min = -360, max = 360): SmartFilterParamSpec => ({ label, min, max });
const byteChannels = (prefix: string): SmartFilterParamSpec[] =>
  ["R", "G", "B"].map((c) => ({ label: `${prefix} ${c}`, min: 0, max: 255, step: 1 }));
// Filters that bake the foreground/background swatches (or a seed) into their
// params so a stack re-render replays identically.
const FG_BG = [...byteChannels("Foreground"), ...byteChannels("Background")];
const SEED: SmartFilterParamSpec = { label: "Seed" };

/** The Filter Gallery already owns labels + UI ranges for ~50 of these filters
 *  (state/filterGallery.ts). Its `args()` is index-aligned — output slot i is a
 *  function of input slot i only — so mapping the UI min/max through it gives
 *  the engine-space range of the same slot. `extra` names the params the action
 *  appends after the gallery's own (baked colours, seeds). */
function galleryParams(id: string, ...extra: SmartFilterParamSpec[]): SmartFilterParamSpec[] {
  const def = filterDef(id);
  if (!def) return extra; // unreachable in practice; keeps a renamed id from throwing
  const uiMin = def.params.map((p) => p.min);
  const lo = def.args(uiMin);
  const hi = def.args(def.params.map((p) => p.max));
  return [
    ...def.params.map((p, i) => {
      const next = uiMin.slice();
      next[i] = Math.min(p.max, p.min + (p.step ?? 1));
      const mappedStep = Math.abs(def.args(next)[i] - lo[i]);
      const spec = ranged(p.label, Math.min(lo[i], hi[i]), Math.max(lo[i], hi[i]));
      return mappedStep > 0 && Number.isInteger(mappedStep) ? { ...spec, step: mappedStep } : spec;
    }),
    ...extra,
  ];
}

/** A ranged field. Narrow ranges (the 0..1 normalised ones) get a 0.01 step so
 *  the field keeps two decimals; wide ones step by 1. */
function ranged(label: string, min: number, max: number): SmartFilterParamSpec {
  return { label, min, max, step: max - min <= 4 ? 0.01 : 1 };
}

// Field specs for a re-edited smart filter, in the engine's param order (the
// `params` array each `applyFilter` call site builds in state/app.ts, which is
// what `apply_smart_filter` reads back). Anything unnamed still falls back to
// "Value n", which edits the right float.
// ponytail: hand-kept for the non-gallery filters — that half of the fid → param
// layout has no machine-readable source. Lighting Effects (91) and Custom (106)
// are deliberately absent: a light rig and a 5×5 convolution kernel are not a
// list of named scalars, and both re-edit through their own dialog.
export const SMART_FILTER_PARAMS: Record<number, SmartFilterParamSpec[]> = {
  0: [{ label: "Radius" }],
  1: [{ label: "Radius" }],
  2: [{ label: "Amount" }],
  3: [{ label: "Radius" }, { label: "Amount" }, { label: "Threshold" }],
  4: [{ label: "Radius" }],
  6: [angle(), { label: "Amount" }, { label: "Height" }],
  7: [angle(), { label: "Distance" }],
  8: [{ label: "Radius" }],
  9: [{ label: "Cell Size" }],
  10: [{ label: "Amount" }],
  11: [{ label: "Amount" }, bool("Monochromatic"), SEED, bool("Gaussian")],
  12: [{ label: "Radius" }],
  13: [{ label: "Amount" }, { label: "Mode" }],
  14: [angle()],
  15: [angle("Angle", -180, 180), { label: "Speed" }, { label: "Taper" }, bool("Centered")],
  16: [{ label: "Amount" }],
  18: [{ label: "Radius" }, { label: "Brightness" }],
  19: [{ label: "Amount" }, { label: "Radius" }, { label: "Reduce Noise" }, { label: "Remove" },
    angle("Angle", -180, 180), { label: "Shadow Fade" }, { label: "Highlight Fade" }],
  20: [{ label: "Radius" }, { label: "Iterations" }],
  21: [{ label: "Strength" }, { label: "Reduce Color Noise" }, { label: "Preserve Details" }, { label: "Sharpen Details" }],
  22: [{ label: "Strength" }],
  23: [{ label: "Mode" }],
  24: [{ label: "Kind" }, { label: "Radius" }, { label: "Focus" }, { label: "Light Bokeh" }, { label: "Bokeh Color" }],
  25: [angle("Angle", 1, 90), { label: "Strobe Flashes" }],
  26: [{ label: "Horizontal Scale" }, { label: "Vertical Scale" }],
  27: [{ label: "Distortion" }, { label: "Vignette" }, { label: "Aberration" }, { label: "Scale" }, { label: "Vignette Midpoint" }],
  28: [angle("Angle", 5, 60), { label: "Depth" }, ...byteChannels("Color")],
  29: [SEED, ...byteChannels("Color")],
  30: [{ label: "Width" }, ...byteChannels("Color")],
  32: [bool("Eliminate Odd"), bool("Interpolate")],
  33: galleryParams("glowingEdges"),
  34: [{ label: "Level" }, bool("Upper")],
  35: [{ label: "Method" }, bool("From Left")],
  36: galleryParams("posterEdges"),
  37: galleryParams("cutout"),
  38: galleryParams("filmGrain", SEED),
  39: galleryParams("dryBrush"),
  40: galleryParams("watercolor"),
  41: galleryParams("coloredPencil"),
  42: galleryParams("smudgeStick"),
  43: galleryParams("sponge"),
  44: galleryParams("paletteKnife"),
  45: galleryParams("paintDaubs"),
  46: galleryParams("fresco"),
  47: galleryParams("roughPastels"),
  48: galleryParams("underpainting"),
  49: galleryParams("crosshatch"),
  50: galleryParams("spatter"),
  51: galleryParams("angledStrokes"),
  52: galleryParams("darkStrokes"),
  53: galleryParams("sprayedStrokes"),
  54: galleryParams("sumiE"),
  55: galleryParams("mosaicTiles"),
  56: galleryParams("patchwork"),
  57: galleryParams("craquelure"),
  58: galleryParams("grain", ...byteChannels("Background")),
  59: galleryParams("neonGlow", ...byteChannels("Glow")),
  60: galleryParams("plasticWrap"),
  61: galleryParams("accentedEdges"),
  62: galleryParams("inkOutlines"),
  63: galleryParams("texturizer"),
  64: [{ label: "Variance" }, { label: "Strength" }, ...FG_BG],
  65: galleryParams("photocopy", ...FG_BG),
  66: galleryParams("stamp", ...FG_BG),
  67: galleryParams("notePaper", ...FG_BG),
  68: galleryParams("tornEdges", ...FG_BG),
  69: galleryParams("waterPaper"),
  70: galleryParams("chalkCharcoal", ...FG_BG),
  71: galleryParams("conteCrayon", ...FG_BG),
  72: galleryParams("reticulation", ...FG_BG),
  73: galleryParams("plaster", ...FG_BG),
  74: galleryParams("graphicPen", ...FG_BG),
  75: galleryParams("charcoal", ...FG_BG),
  76: galleryParams("halftonePattern", ...FG_BG),
  77: galleryParams("basRelief", ...FG_BG),
  78: galleryParams("chrome"),
  // Tiles is the one gallery filter whose action rescales an argument
  // (`maxOffsetPct / 100`), so its offset range is hand-written in engine units.
  79: [ranged("Number Of Tiles", 1, 99), ranged("Maximum Offset", 0, 1),
    { label: "Fill Empty Area", min: 0, max: 3, step: 1 }, ...FG_BG],
  81: galleryParams("colorHalftone"),
  82: galleryParams("crystallize"),
  83: galleryParams("stainedGlass", ...byteChannels("Color")),
  84: galleryParams("pointillize", ...byteChannels("Color")),
  85: [{ label: "Kind" }, SEED],
  90: [{ label: "Size" }, { label: "Depth" }, bool("By Brightness"), SEED, { label: "Type" },
    bool("Solid Front"), bool("Mask Incomplete")],
  92: [{ label: "Amount" }, bool("Zoom"), ranged("Center X", 0, 1), ranged("Center Y", 0, 1), { label: "Quality" }],
  93: [bool("To Polar")],
  94: [{ label: "Amount" }, { label: "Size" }],
  95: galleryParams("oceanRipple"),
  96: galleryParams("glass"),
  97: [{ label: "Amount" }, { label: "Ridges" }, { label: "Style" }],
  98: [{ label: "Top" }, { label: "Bottom" }, bool("Wrap")],
  99: [{ label: "Generators" }, { label: "Min Wavelength" }, { label: "Max Wavelength" },
    { label: "Min Amplitude" }, { label: "Max Amplitude" }, { label: "Horizontal Scale" },
    { label: "Vertical Scale" }, { label: "Type" }, bool("Wrap")],
  100: galleryParams("diffuseGlow", ...byteChannels("Background")),
  101: [{ label: "Shadow Amount" }, { label: "Shadow Width" }, { label: "Highlight Amount" },
    { label: "Highlight Width" }, { label: "Color" }, { label: "Midtone" },
    ranged("Shadow Radius", 0, 2500), ranged("Highlight Radius", 0, 2500),
    ranged("Black Clip", 0, 0.5), ranged("White Clip", 0, 0.5)],
  102: [{ label: "Radius" }, { label: "Threshold" }, { label: "Mode" }, { label: "Quality" }],
  104: [{ label: "Radius" }, { label: "Threshold" }],
  105: [{ label: "Radius" }, { label: "Threshold" }],
  107: [{ label: "Radius" }, bool("Round")],
  108: [{ label: "Radius" }, bool("Round")],
  // Lens Flare stores centre coordinates in document pixels, so its bounds are
  // document-dependent and cannot be expressed in this static table.
  109: [{ label: "Center X" }, { label: "Center Y" }, { label: "Brightness" }, { label: "Lens Type" }],
  110: [{ label: "Horizontal" }, { label: "Vertical" }, { label: "Edge" },
    ...byteChannels("Background"), { label: "Background A", min: 0, max: 255, step: 1 }],
  111: [{ label: "Mode" }, SEED],
  112: [SEED, ...FG_BG],
  113: [SEED, ...FG_BG],
  116: [{ label: "Distortion" }, { label: "Vignette" }, { label: "Red/Cyan Fringe" },
    { label: "Blue/Yellow Fringe" }, { label: "Scale" }, { label: "Vignette Midpoint" }],
};
// Per-filter Blending Options: the layer modes minus group-only Pass Through.
const FILTER_BLEND_OPTIONS = GROUP_BLEND_OPTIONS.filter((o) => o.value !== "pass-through");

// The Layers filter bar's dropdowns (Kind / Attribute / Mode / Effect).

function toggleSetMember<T>(current: ReadonlySet<T>, member: T): ReadonlySet<T> {
  const next = new Set(current);
  if (next.has(member)) next.delete(member); else next.add(member);
  return next;
}

export function LayersPanel() {
  const thumbnailSize = useStore((s) => s.panelOptions?.layerThumbnailSize) ?? DEFAULT_PANEL_OPTIONS.layerThumbnailSize;
  const layers = useStore((s) => s.layers);
  const activeDocId = useStore((s) => s.activeDocId);
  const activeId = useStore((s) => s.activeLayerId);
  const selectedIds = useStore((s) => s.selectedLayerIds);
  const maskEditOn = useStore((s) => s.maskEdit);
  const maskViewOn = useStore((s) => s.maskView);
  const layerColorLabels = useStore((s) => s.layerColorLabels);
  const layerColorFilter = useStore((s) => s.layerColorFilter);
  const layerFilter = useStore((s) => s.layerFilter);
  const layerFilterOpen = useStore((s) => s.layerFilterOpen);
  const layerKindFilter = useStore((s) => s.layerKindFilter);
  const layerAttributeFilter = useStore((s) => s.layerAttributeFilter);
  const layerModeFilter = useStore((s) => s.layerModeFilter);
  const layerEffectFilter = useStore((s) => s.layerEffectFilter);
  const artboards = useStore((s) => s.artboards);
  const active = layers.find((l) => l.id === activeId);
  const activeIndex = layers.findIndex((l) => l.id === activeId);
  // How many layers share each smart-object source, so only real instances are
  // badged (a lone converted smart object has an id but no siblings).
  const instanceCounts = useMemo(() => {
    const counts: Record<number, number> = {};
    for (const l of layers) {
      const id = l.smartSourceId ?? 0;
      if (id) counts[id] = (counts[id] ?? 0) + 1;
    }
    return counts;
  }, [layers]);
  const { open } = useDialogs();
  const toast = useToast();
  // The layer whose name is being edited inline (double-click / right-click ▸
  // Rename), or null. Renaming only swaps that one row's name for an input.
  const [renamingId, setRenamingId] = useState<number | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<ReadonlySet<number>>(new Set());
  const [collapsedDetails, setCollapsedDetails] = useState<ReadonlySet<string>>(new Set());
  const [dragLayerId, setDragLayerId] = useState<number | null>(null);
  const [dropHint, setDropHint] = useState<{ rowId: number; position: LayerDropPosition } | null>(null);
  const abIds = new Set(artboards.map((a) => a.id));
  useEffect(() => {
    setRenamingId(null);
    setCollapsedGroups(new Set());
    setCollapsedDetails(new Set());
    setDragLayerId(null);
    setDropHint(null);
  }, [activeDocId]);

  const data: LayerData[] = layers.map((l) => {
    // A user colour label (Photoshop) overrides the kind-derived chip; resolve it
    // once for both the row chip and the thumbnail dot.
    const labelChip = labelColor(layerColorLabels[l.id]);
    const linkTitle = l.smartLink
      ? `${l.smartLink.missing ? "Missing linked source" : "Linked source"}: ${l.smartLink.name}${l.smartLink.path ? ` (${l.smartLink.path})` : ""}`
      : undefined;
    return {
      id: String(l.id),
      // Clipped layers get Photoshop's indented down-arrow pointing at their base.
      name: (l.clipped ? "⬐ " : "") + l.name,
      visible: l.visible,
      locked: l.locked,
      opacity: l.opacity,
      blendMode: l.blendMode,
      colorChip: labelChip ?? (l.kind === LAYER_KIND.groupHeader ? "#9aa0a6" : l.kind === LAYER_KIND.adjustment || l.kind === LAYER_KIND.fill ? "var(--accent-raster)" : l.kind === LAYER_KIND.smartObject ? "#4a9eff" : l.kind === LAYER_KIND.text ? "#ffcc00" : undefined),
      thumb:
        l.kind === LAYER_KIND.groupHeader ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--glass-1)", fontSize: 13 }}>🗀</div>
        ) : l.kind === LAYER_KIND.adjustment ? (
          <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "var(--glass-1)", fontSize: 11, color: "var(--text-2)" }}>fx</div>
        ) : (
          <>
            {l.kind === LAYER_KIND.text ? (
              <span
                role="img"
                aria-label="Text layer"
                title="Text layer"
                style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", color: "var(--text-1)", background: "var(--glass-2)" }}
              >
                <Icon d={I.text} size={14} />
              </span>
            ) : (
              <img src={l.thumb} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }} />
            )}
            {labelChip && <span data-mv-layer-label={layerColorLabels[l.id]} style={{ position: "absolute", left: 1, top: 1, width: 8, height: 8, borderRadius: "50%", background: labelChip, boxShadow: "0 0 0 1px #000" }} />}
            {l.kind === LAYER_KIND.smartObject && <span style={{ position: "absolute", left: 1, bottom: 1, fontSize: 7, color: "#fff", background: "#4a9eff", padding: "0 2px", borderRadius: 2, lineHeight: "9px" }}>SO</span>}
            {l.kind === LAYER_KIND.smartObject && instanceCounts[l.smartSourceId ?? 0] > 1 && (
              // Photoshop marks instances so an edit's blast radius is visible
              // before you make it.
              <span
                data-mv-smart-instance={l.smartSourceId}
                title={`Smart object instance — ${instanceCounts[l.smartSourceId ?? 0]} layers share this source; editing one updates them all`}
                style={{ position: "absolute", right: 1, bottom: 1, minWidth: 9, height: 9, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 2, fontSize: 7, fontWeight: 700, lineHeight: "9px", color: "#fff", background: "#7a5af8", boxShadow: "0 0 0 1px rgba(0,0,0,0.55)" }}
              >
                ⧉
              </span>
            )}
            {l.kind === LAYER_KIND.smartObject && l.smartLink && (
              <span
                data-mv-smart-link-state={l.smartLink.missing ? "missing" : "linked"}
                title={linkTitle}
                style={{ position: "absolute", left: 19, bottom: 1, minWidth: 9, height: 9, boxSizing: "border-box", display: "inline-flex", alignItems: "center", justifyContent: "center", borderRadius: 2, fontSize: 7, fontWeight: 700, lineHeight: "9px", color: l.smartLink.missing ? "#000" : "#fff", background: l.smartLink.missing ? "#ffcc00" : "#1f9d55", boxShadow: "0 0 0 1px rgba(0,0,0,0.55)" }}
              >
                {l.smartLink.missing ? "!" : "↗"}
              </span>
            )}
            {l.hasFx && <span title="Has layer effects" style={{ position: "absolute", right: 1, top: 1, fontSize: 7, fontWeight: 700, color: "#000", background: "#ffcc00", padding: "0 2px", borderRadius: 2, lineHeight: "9px" }}>fx</span>}
          </>
        ),
    };
  });

  // Select ▸ Find Layers: keep matching rows plus their group ancestors.
  const q = layerFilter.trim().toLowerCase();
  const effectiveKind: LayerKindFilter = layerFilterOpen ? layerKindFilter : "all";
  const effectiveAttribute: LayerAttributeFilter = layerFilterOpen ? layerAttributeFilter : "all";
  const effectiveMode: LayerModeFilter = layerFilterOpen ? layerModeFilter : "all";
  const effectiveEffect: LayerEffectFilter = layerFilterOpen ? layerEffectFilter : "all";
  const effectiveColors: LayerLabel[] = layerFilterOpen ? layerColorFilter : [];
  const shownRows = flattenLayerTree(layers, collapsedGroups, (layer) =>
    layerKindMatches(layer.kind, effectiveKind)
    && layerAttributeMatches(layer, effectiveAttribute)
    && layerModeMatches(layer.blendMode, effectiveMode)
    && layerEffectMatches(layer.fxMask ?? 0, effectiveEffect)
    && layerColorMatches(layerColorLabels[layer.id], effectiveColors)
    && (!q || layer.name.toLowerCase().includes(q)));
  const dataById = new Map(data.map((layer) => [+layer.id, layer]));
  const rowById = new Map(shownRows.map((row) => [row.layer.id, row]));
  const shownData = shownRows.flatMap((row) => {
    const layer = dataById.get(row.layer.id);
    return layer ? [layer] : [];
  });
  const shownIds = shownRows.map((row) => row.layer.id);
  const moveUp = planLayerStep(layers, activeId, -1, abIds);
  const moveDown = planLayerStep(layers, activeId, 1, abIds);

  const header = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", minWidth: 0 }}>
      {active?.smartLink?.missing && (
        <div
          data-mv-smart-link-warning={active.id}
          title={active.smartLink.path ?? active.smartLink.name}
          style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, padding: "4px 6px", borderRadius: 4, background: "rgba(255,204,0,0.16)", color: "var(--text-1)", boxShadow: "inset 0 0 0 1px rgba(255,204,0,0.32)" }}
        >
          <span data-mv-smart-link-state="active-missing" style={{ flex: "0 0 auto", width: 15, height: 15, borderRadius: 3, display: "inline-flex", alignItems: "center", justifyContent: "center", background: "#ffcc00", color: "#000", fontSize: 10, fontWeight: 800 }}>!</span>
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 11 }}>
            Missing linked source: {active.smartLink.name}
          </span>
          <Button size="sm" variant="ghost" onClick={() => smart.relinkContents()}>Relink</Button>
          <Button size="sm" variant="ghost" onClick={() => smart.embedLinked(active.id)}>Embed</Button>
        </div>
      )}
      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0 }}>
        <BlendModeSelect size="sm" value={active?.blendMode ?? "normal"} aria-label="Blend mode"
          options={active?.kind === LAYER_KIND.groupHeader ? GROUP_BLEND_OPTIONS : undefined}
          onChange={(v: string) => active && store.setLayerBlend(active.id, v)} />
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 2 }}>
          <OpacityControl value={active?.opacity ?? 100} accent={ACCENT}
            onChange={(pct) => active && store.setLayerOpacity(active.id, pct)} />
          <OpacityControl label="Fill" value={active?.fillOpacity ?? 100} accent={ACCENT}
            onChange={(pct) => active && store.setFillOpacity(active.id, pct)} />
        </div>
        {active?.hasMask && (
          <button title="Paint on layer mask (toggle)" onClick={() => store.maskEdit(!maskEditOn)}
            style={{ flex: "0 0 auto", width: 26, height: 22, borderRadius: 5, border: "none", cursor: "pointer",
              background: maskEditOn ? "var(--accent-raster)" : "var(--glass-1)", color: maskEditOn ? "#000" : "var(--text-2)" }}>◐</button>
        )}
      </div>
    </div>
  );

  const iconBtn = (title: string, d: string, onClick: () => void, disabled = false) => (
    <button type="button" className="monet-iconbtn" title={title} aria-label={title}
      onClick={onClick} disabled={disabled}
      style={{ opacity: disabled ? 0.4 : 1, cursor: disabled ? "default" : "pointer" }}>
      <Icon d={d} size={13} />
    </button>
  );

  const footer = (
    <>
      {iconBtn("Add layer", I.plus, () => store.addLayer())}
      {iconBtn("New group", "M2 4.5h4l1.2 1.2H14V13H2z", () => store.createGroup())}
      {iconBtn("Duplicate", "M5 5h6v6H5z M3 3h6v1H4v5H3z", () => store.duplicateLayer(activeId))}
      {iconBtn(
        active?.hasMask ? "Apply layer mask" : "Add layer mask (from selection)",
        "M8 2a6 6 0 1 0 0 12z",
        () => (active?.hasMask ? store.applyLayerMask(activeId) : store.addLayerMask(activeId)),
      )}
      {iconBtn("Blending Options (layer effects)", "M8 1l1.9 4.1 4.1.6-3 2.9.7 4.4L8 12l-3.7 1.9.7-4.4-3-2.9 4.1-.6z", () => open("layerStyle"))}
      {iconBtn("Merge down", "M4 4l4 4 4-4 M4 9h8", () => store.mergeDown(activeId), activeIndex >= layers.length - 1)}
      <span style={{ flex: 1 }} />
      {iconBtn("Move up", "M8 3l4 5H4z", () => {
        if (moveUp) store.moveLayerInTree(activeId, moveUp.targetId, moveUp.positionCode);
      }, moveUp == null)}
      {iconBtn("Move down", "M8 13l-4-5h8z", () => {
        if (moveDown) store.moveLayerInTree(activeId, moveDown.targetId, moveDown.positionCode);
      }, moveDown == null)}
      {iconBtn("Delete", "M4 5L12 5L11 13L5 13ZM6 3L10 3L10 5L6 5Z", () => store.deleteLayer(activeId), layers.length <= 1)}
    </>
  );

  // Right-click a layer → monet-ui context menu (Blending Options + common actions).
  // Using the framework's <ContextMenu> renders through the managed overlay root,
  // so the menu inherits --font-ui and the standard monet menu styling.
  const layerCtx: MenuItemDef[] = [
    { id: "ctx-blend", label: "Blending Options…", action: () => open("layerStyle") },
    { id: "ctx-s1", separator: true },
    { id: "ctx-rename", label: "Rename Layer", action: () => setRenamingId(store.state.activeLayerId) },
    { id: "ctx-dup", label: "Duplicate Layer…", action: () => open("duplicateLayer") },
    {
      id: "ctx-mask",
      label: active?.hasMask ? "Apply Layer Mask" : "Add Layer Mask",
      action: () => (active?.hasMask ? store.applyLayerMask(store.state.activeLayerId) : store.addLayerMask(store.state.activeLayerId)),
    },
    { id: "ctx-s-sel", separator: true },
    {
      id: "ctx-select-pixels",
      label: "Select Pixels",
      disabled: active == null || active.kind === LAYER_KIND.groupHeader,
      action: () => store.loadLayerTransparencyAsSelection(store.state.activeLayerId),
    },
    {
      id: "ctx-select-mask",
      label: "Select Mask",
      disabled: !active?.hasMask,
      action: () => store.loadLayerMaskAsSelection(store.state.activeLayerId),
    },
    { id: "ctx-merge", label: "Merge Down", disabled: activeIndex >= layers.length - 1, action: () => store.mergeDown(store.state.activeLayerId) },
    { id: "ctx-s2", separator: true },
    { id: "ctx-label", label: "Color Label", items: LAYER_LABELS.map((o) => ({ id: `lbl-${o.value}`, label: o.label, action: () => store.setLayerColorLabel(store.state.activeLayerId, o.value) })) },
    // Keyboard-reachable twin of the drag-onto-an-artboard-row gesture.
    ...(artboards.length ? [{
      id: "ctx-artboard",
      label: "Move to Artboard",
      items: [
        ...artboards.map((a) => ({
          id: `ctx-ab-${a.id}`,
          label: a.name,
          disabled: active == null || active.kind === LAYER_KIND.groupHeader || active.group === a.id,
          action: () => store.moveLayerToArtboard(store.state.activeLayerId, a.id),
        })),
        {
          id: "ctx-ab-none",
          label: "Document",
          disabled: active == null || !abIds.has(active.group),
          action: () => store.moveLayerToArtboard(store.state.activeLayerId, 0),
        },
      ],
    }] : []),
    { id: "ctx-s3", separator: true },
    { id: "ctx-del", label: "Delete Layer", disabled: layers.length <= 1, action: () => store.deleteLayer(store.state.activeLayerId) },
  ];

  return (
    <div
      data-mv-layers-panel
      style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, "--mv-layer-thumbnail-size": `${thumbnailSize}px` } as CSSProperties}
      onPointerUp={() => store.endPropEdit()} // slider release ends opacity-drag coalescing
      onKeyUp={(e) => {
        // Only slider-adjustment keys close a keyboard slider gesture. Number
        // shortcuts bubble through this panel and deliberately stay open long
        // enough for an exact two-digit Opacity/Fill sequence.
        if ((e.target as HTMLElement).getAttribute("role") !== "slider") return;
        if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "PageUp", "PageDown", "Home", "End"].includes(e.key)) {
          store.endPropEdit();
        }
      }}
      onPointerDownCapture={(e) => {
        // ⌥-click the boundary between two rows → toggle the upper layer's
        // clipping mask, either way (Photoshop's Layers-panel affordance).
        if (e.altKey && !e.shiftKey && !e.metaKey) {
          const row = layerRowAt(e);
          if (row?.id && !(e.target as HTMLElement).closest("button")) {
            const rect = row.getBoundingClientRect();
            const EDGE = 5; // px from a row edge that counts as "the boundary"
            const edge = e.clientY - rect.top < EDGE
              ? "top"
              : rect.bottom - e.clientY < EDGE
                ? "bottom"
                : null;
            const upper = edge
              ? clippingBoundaryLayer(layers, shownIds, Number(row.id), edge)
              : null;
            if (upper) {
              e.stopPropagation();
              e.preventDefault();
              store.setClipping(upper.id, !upper.clipped);
            }
          }
          return;
        }
        // Shift / ⌘-click a row → toggle it in the multi-layer selection.
        if (!(e.shiftKey || e.metaKey)) return;
        const row = layerRowAt(e);
        if (row?.id && !(e.target as HTMLElement).closest("button")) {
          e.stopPropagation();
          e.preventDefault();
          store.toggleLayerInSelection(+row.id);
        }
      }}
      onContextMenuCapture={(e) => {
        // select the right-clicked row so the menu acts on it
        const row = layerRowAt(e);
        if (row?.id) store.selectLayer(+row.id);
      }}
      onDoubleClickCapture={(e) => {
        // double-click a layer row (but not its eye/lock buttons or the rename
        // field itself) to rename it in place
        const t = e.target as HTMLElement;
        if (t.closest(".mv-layer-rename")) return;
        const row = layerRowAt(e);
        if (row?.id && !t.closest("button")) {
          store.selectLayer(+row.id);
          setRenamingId(+row.id);
        }
      }}
    >
      <div className="mv-panel-menu-row">
        {panelMenu("Layers", [
          { id: "layers-options", label: "Panel Options", items: [thumbnailOptions("layerThumbnailSize", thumbnailSize)] },
          { id: "layers-separator", separator: true },
          ...layerCtx,
        ])}
      </div>
      <PanelOptionsError />
      {layerFilterOpen && (
        <div style={{ padding: "4px 6px", display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <Select size="sm" id="mv-layer-kind" aria-label="Filter by kind" value={layerKindFilter} options={LAYER_KIND_FILTERS}
              onChange={(v) => store.setOptions({ layerKindFilter: v as LayerKindFilter })} />
            <Select size="sm" id="mv-layer-attribute" aria-label="Filter by attribute" value={layerAttributeFilter} options={LAYER_ATTRIBUTE_FILTERS}
              onChange={(v) => store.setOptions({ layerAttributeFilter: v as LayerAttributeFilter })} />
            <input type="text" autoFocus value={layerFilter} placeholder="Find layers by name…"
              aria-label="Find layers"
              style={{ flex: 1, fontSize: 12, padding: "3px 6px", borderRadius: 4, border: "1px solid var(--border-1, #3a3f48)", background: "var(--surface-2, #2a2e35)", color: "var(--text-1)" }}
              onChange={(e) => store.setLayerFilter(e.currentTarget.value)}
              onKeyDown={(e) => { if (e.key === "Escape") store.toggleLayerFilter(); }} />
            <span data-mv-layer-count style={{ fontSize: 11, color: "var(--text-3)" }}>{shownData.length}/{data.length}</span>
          </div>
          {/* Photoshop's "Filter for blending mode" and "Filter for effect" (#423). */}
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Mode</span>
            <Select size="sm" id="mv-layer-mode" aria-label="Filter by mode" value={layerModeFilter} options={LAYER_MODE_FILTERS}
              onChange={(v) => store.setOptions({ layerModeFilter: v as LayerModeFilter })}
              style={{ flex: 1, minWidth: 0 }} />
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Effect</span>
            <Select size="sm" id="mv-layer-effect" aria-label="Filter by effect" value={String(layerEffectFilter)}
              options={LAYER_EFFECT_FILTERS.map((fx) => ({ value: String(fx.value), label: fx.label }))}
              onChange={(v) => store.setOptions({ layerEffectFilter: v === "all" ? "all" : +v })}
              style={{ flex: 1, minWidth: 0 }} />
          </div>
          {/* Photoshop's "Filter for layer color": toggle colour swatches to narrow the list. */}
          <div data-mv-color-filter style={{ display: "flex", gap: 4, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-3)" }}>Color</span>
            {LAYER_LABELS.filter((o) => o.value !== "none").map((o) => {
              const on = layerColorFilter.includes(o.value);
              return (
                <button key={o.value} type="button" title={o.label} aria-label={`Filter ${o.label}`} aria-pressed={on}
                  data-mv-color-filter-btn={o.value} onClick={() => store.toggleLayerColorFilter(o.value)}
                  style={{ width: 14, height: 14, padding: 0, borderRadius: "50%", cursor: "pointer", background: o.color,
                    border: on ? "2px solid var(--text-1)" : "1px solid #000", boxSizing: "border-box" }} />
              );
            })}
          </div>
        </div>
      )}
      {/* Photoshop's lock cluster: four independent toggles acting on the whole
          selection, mirroring Layer ▸ Lock Layers…. */}
      <div data-mv-lock-cluster className="monet-row" style={{ gap: 4, alignItems: "center", padding: "2px 0 4px" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>Lock</span>
        {LOCK_TOGGLES.map(({ bit, label, glyph }) => {
          const on = (active?.locks ?? 0) & bit ? true : false;
          return (
            <button
              key={label}
              type="button"
              data-mv-lock={label}
              aria-label={label}
              aria-pressed={on}
              title={label}
              onClick={() => {
                for (const id of selectedIds.length ? selectedIds : [activeId]) {
                  store.setLayerLocks(id, (store.layerLocks(id) ^ bit) & 7);
                }
              }}
              style={{ width: 22, height: 20, padding: 0, borderRadius: 3, fontSize: 11, cursor: "pointer", color: on ? ACCENT : "var(--text-2)", background: on ? "var(--bg-3)" : "transparent", border: `1px solid ${on ? ACCENT : "var(--border-1, #3a3f48)"}` }}
            >
              {glyph}
            </button>
          );
        })}
        <button type="button" data-mv-lock="Lock All" aria-label="Lock All"
          aria-pressed={active?.locked ?? false} title="Lock All"
          onClick={() => {
            const next = !(active?.locked ?? false);
            for (const id of selectedIds.length ? selectedIds : [activeId]) store.setLayerLocked(id, next);
          }}
          style={{ width: 22, height: 20, padding: 0, borderRadius: 3, fontSize: 11, cursor: "pointer", color: active?.locked ? ACCENT : "var(--text-2)", background: active?.locked ? "var(--bg-3)" : "transparent", border: `1px solid ${active?.locked ? ACCENT : "var(--border-1, #3a3f48)"}` }}
        >🔒</button>
      </div>
      <ContextMenu items={layerCtx} className="mv-layer-ctx">
        <LayerList
          layers={shownData}
          selectedId={String(activeId)}
          onSelect={(id) => store.selectLayer(+id)}
          onVisibilityChange={(id, v) => store.setLayerVisible(+id, v)}
          onLockChange={(id, l) => store.setLayerLocked(+id, l)}
          onOpacityChange={(id, o) => store.setLayerOpacity(+id, o)}
          onBlendModeChange={(id, m) => store.setLayerBlend(+id, m)}
          renderRow={(layer, info) => {
            const raw = layers.find((sl) => String(sl.id) === layer.id);
            const treeRow = raw ? rowById.get(raw.id) : undefined;
            if (!raw || !treeRow) return null;
            const renaming = raw.id === renamingId;
            // Effects are a multiset: reading instance 0 alone hid a type whose
            // FIRST shadow/stroke was switched off while a later one was still
            // painting — the row then omitted an effect the canvas was showing.
            const effects = raw.hasFx
              ? FX_DEFS.filter((effect) => {
                  const count = store.effectInstanceCount(raw.id, effect.id);
                  for (let i = 0; i < count; i++) {
                    const params = store.effectParamsAt(raw.id, effect.id, i);
                    if (params.length > 0 && (params[0] ?? 0) >= 0.5) return true;
                  }
                  return false;
                }).map((effect) => effect.name)
              : [];
            const smartFilters = raw.kind === LAYER_KIND.smartObject ? store.smartFilterRows(raw.id) : [];
            const hint = dropHint?.rowId === raw.id ? dropHint.position : null;
            const dropStyle = hint === "inside"
              ? { boxShadow: `inset 0 0 0 1.5px ${ACCENT}`, borderRadius: 4 }
              : hint === "before"
                ? { boxShadow: `inset 0 2px 0 ${ACCENT}` }
                : hint === "after"
                  ? { boxShadow: `inset 0 -2px 0 ${ACCENT}` }
                  : undefined;
            return (
              <div
                draggable={!renaming}
                data-mv-layer-drag={layer.id}
                onDragStart={(e) => {
                  if ((e.target as HTMLElement).closest(
                    "[data-mv-layer-detail],button,input,select,textarea,[contenteditable]",
                  )) {
                    e.preventDefault();
                    return;
                  }
                  setDragLayerId(raw.id);
                  e.dataTransfer.effectAllowed = "move";
                  e.dataTransfer.setData("text/plain", String(raw.id));
                }}
                onDragOver={(e) => {
                  if (dragLayerId == null) return;
                  const rect = (e.currentTarget.querySelector('[role="option"]') as HTMLElement | null)?.getBoundingClientRect()
                    ?? e.currentTarget.getBoundingClientRect();
                  const position = layerDropPosition(e.clientY, rect.top, rect.height, raw.kind === LAYER_KIND.groupHeader);
                  if (!planLayerDrop(layers, dragLayerId, raw.id, position, abIds)) {
                    if (dropHint?.rowId === raw.id) setDropHint(null);
                    return;
                  }
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropHint?.rowId !== raw.id || dropHint.position !== position) setDropHint({ rowId: raw.id, position });
                }}
                onDragLeave={(e) => {
                  if (!e.currentTarget.contains(e.relatedTarget as Node | null)) {
                    setDropHint((current) => current?.rowId === raw.id ? null : current);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragLayerId != null) {
                    const rect = (e.currentTarget.querySelector('[role="option"]') as HTMLElement | null)?.getBoundingClientRect()
                      ?? e.currentTarget.getBoundingClientRect();
                    const position = layerDropPosition(e.clientY, rect.top, rect.height, raw.kind === LAYER_KIND.groupHeader);
                    const plan = planLayerDrop(layers, dragLayerId, raw.id, position, abIds);
                    if (plan) store.moveLayerInTree(dragLayerId, plan.targetId, plan.positionCode);
                  }
                  setDragLayerId(null);
                  setDropHint(null);
                }}
                onDragEnd={() => { setDragLayerId(null); setDropHint(null); }}
                style={dropStyle}
              >
              <LayerRow
                id={layer.id}
                name={renaming ? (
                  <span style={{ display: "flex", minWidth: 0, paddingLeft: treeRow.depth * 14 }}>
                    <RenameInput
                      initial={raw.name}
                      onCommit={(v) => { const n = v.trim(); if (n) store.renameLayer(raw.id, n); setRenamingId(null); }}
                      onCancel={() => setRenamingId(null)}
                    />
                  </span>
                ) : (
                  <LayerName
                    name={layer.name}
                    depth={treeRow.depth}
                    groupCollapsed={raw.kind === LAYER_KIND.groupHeader ? collapsedGroups.has(raw.id) : undefined}
                    onToggleGroup={() => setCollapsedGroups((current) => toggleSetMember(current, raw.id))}
                    hasMask={raw.hasMask}
                    maskActive={maskEditOn && raw.id === activeId}
                    maskThumb={raw.maskThumb}
                    maskEnabled={raw.maskEnabled}
                    maskViewing={maskViewOn !== "off" && raw.id === activeId}
                    onMaskClick={({ alt, shift, meta }) => {
                      // Photoshop: ⌘ loads the mask as a selection (with ⇧/⌥
                      // combining), ⇧ disables the mask, ⌥ views it alone, a
                      // plain click targets it for painting.
                      if (meta) { store.loadLayerMaskAsSelection(raw.id, loadSelectionMode({ shift, alt })); return; }
                      if (shift) { store.toggleLayerMaskEnabled(raw.id); return; }
                      if (alt) { store.toggleMaskGrayView(raw.id); return; }
                      if (raw.id !== activeId) store.selectLayer(raw.id);
                      store.maskEdit(raw.id === activeId ? !maskEditOn : true);
                    }}
                    smartLink={raw.smartLink}
                  />
                )}
                visible={layer.visible ?? true}
                locked={layer.locked ?? false}
                opacity={layer.opacity}
                blendMode={layer.blendMode}
                colorChip={layer.colorChip}
                thumb={(
                  <span
                    draggable
                    data-mv-layer-export-drag={layer.id}
                    title={`Drag “${raw.name}” out as PNG — ⌘-click to load its transparency as a selection`}
                    onClick={(e) => {
                      // Photoshop's ⌘-click-the-thumbnail gesture. It must not
                      // also re-target the layer, so the row's own click stops here.
                      if (!(e.metaKey || e.ctrlKey)) return;
                      e.stopPropagation();
                      e.preventDefault();
                      store.loadLayerTransparencyAsSelection(raw.id, loadSelectionMode({ shift: e.shiftKey, alt: e.altKey }));
                    }}
                    onDragStart={(e) => {
                      e.stopPropagation();
                      const failed = (error: unknown) => {
                        console.error("Layer drag export failed:", error);
                        toast.push({
                          title: "Layer export failed",
                          message: error instanceof Error ? error.message : String(error),
                          variant: "error",
                        });
                      };
                      let pending: Promise<void> | undefined;
                      try {
                        // The export can throw outright (engine not ready, a kind
                        // with no pixels); that reaches the same toast as a
                        // rejected native drag rather than killing the render.
                        pending = beginLayerPngDrag(e.dataTransfer, raw.name, engine.e.export_layer_png_trimmed(raw.id), raw.thumb);
                      } catch (error) {
                        e.preventDefault();
                        failed(error);
                        return;
                      }
                      if (!pending) return;
                      e.preventDefault();
                      void pending.catch(failed);
                    }}
                    style={{ position: "absolute", inset: 0, cursor: "copy" }}
                  >
                    {layer.thumb}
                  </span>
                )}
                selected={info.selected || selectedIds.includes(+layer.id)}
                tabIndex={info.tabIndex}
                onSelect={() => store.selectLayer(+layer.id)}
                onVisibilityToggle={(v) => store.setLayerVisible(+layer.id, v)}
                onLockToggle={(l) => store.setLayerLocked(+layer.id, l)}
              />
              <LayerDisclosures
                depth={treeRow.depth + 1}
                effects={effects}
                smartFilters={smartFilters}
                collapsed={collapsedDetails}
                onToggle={(key) => setCollapsedDetails((current) => toggleSetMember(current, key))}
                layerId={raw.id}
              />
              </div>
            );
          }}
          header={header}
          footer={footer}
        />
      </ContextMenu>
    </div>
  );
}

function LayerName({
  name,
  depth,
  groupCollapsed,
  onToggleGroup,
  hasMask,
  maskActive,
  maskThumb,
  maskEnabled,
  maskViewing,
  onMaskClick,
  smartLink,
}: {
  name: string;
  depth: number;
  groupCollapsed?: boolean;
  onToggleGroup: () => void;
  hasMask: boolean;
  maskActive: boolean;
  maskThumb?: string;
  maskEnabled?: boolean;
  maskViewing: boolean;
  onMaskClick: (mods: { alt: boolean; shift: boolean; meta: boolean }) => void;
  smartLink?: { name: string; path?: string; missing: boolean };
}) {
  const state = smartLink?.missing ? "missing" : "linked";
  const title = smartLink
    ? `${smartLink.missing ? "Missing linked source" : "Linked source"}: ${smartLink.name}${smartLink.path ? ` (${smartLink.path})` : ""}`
    : undefined;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, minWidth: 0, maxWidth: "100%" }} title={title}>
      <span aria-hidden style={{ flex: "0 0 auto", width: depth * 14 }} />
      {groupCollapsed === undefined ? (
        <span aria-hidden style={{ flex: "0 0 auto", width: 14 }} />
      ) : (
        <button
          type="button"
          aria-label={groupCollapsed ? `Expand ${name}` : `Collapse ${name}`}
          aria-expanded={!groupCollapsed}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onToggleGroup(); }}
          style={{ flex: "0 0 auto", width: 14, height: 18, padding: 0, border: "none", background: "transparent", color: "var(--text-2)", cursor: "pointer" }}
        >
          {groupCollapsed ? "▸" : "▾"}
        </button>
      )}
      {hasMask && (
        <button
          type="button"
          data-mv-layer-mask
          data-mv-mask-enabled={maskEnabled === false ? 0 : 1}
          data-mv-mask-view={maskViewing ? 1 : 0}
          aria-label={`${maskActive ? "Stop editing" : "Edit"} ${name} mask${maskEnabled === false ? " (disabled)" : ""}`}
          aria-pressed={maskActive}
          // Photoshop's three mask-thumbnail gestures live on this one control.
          title={`Layer mask${maskEnabled === false ? " (disabled)" : ""} — click to target, ⌘-click to load as a selection, ⌥-click to view it alone, ⇧-click to ${maskEnabled === false ? "enable" : "disable"}`}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onMaskClick({ alt: e.altKey, shift: e.shiftKey, meta: e.metaKey || e.ctrlKey }); }}
          style={{
            position: "relative", flex: "0 0 auto", width: 20, height: 20, padding: 0, borderRadius: 3,
            border: `1px solid ${maskActive || maskViewing ? ACCENT : "var(--border-1, #555)"}`,
            // The mask itself, grayscale — the layer thumbnail's twin. The
            // half-tone gradient is the fallback before the first sync lands.
            background: maskThumb ? `#111 url(${maskThumb}) center / 100% 100% no-repeat` : "linear-gradient(90deg,#fff 50%,#111 50%)",
            cursor: "pointer",
          }}
        >
          {maskEnabled === false && (
            // Photoshop marks a disabled mask with a red X over its thumbnail.
            <span aria-hidden style={{ position: "absolute", inset: 0, display: "grid", placeItems: "center", color: "#f43", fontSize: 16, lineHeight: "18px", fontWeight: 700 }}>✕</span>
          )}
        </button>
      )}
      <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{name}</span>
      {smartLink && (
        <span
          data-mv-smart-link-name-state={state}
          style={{ flex: "0 0 auto", padding: "0 3px", borderRadius: 3, fontSize: 8, lineHeight: "12px", fontWeight: 700, color: smartLink.missing ? "#000" : "#fff", background: smartLink.missing ? "#ffcc00" : "#1f9d55" }}
        >
          {smartLink.missing ? "Missing" : "Linked"}
        </span>
      )}
    </span>
  );
}

function LayerDisclosures({
  layerId,
  depth,
  effects,
  smartFilters,
  collapsed,
  onToggle,
}: {
  layerId: number;
  depth: number;
  effects: string[];
  smartFilters: SmartFilterRow[];
  collapsed: ReadonlySet<string>;
  onToggle: (key: string) => void;
}) {
  const section = (kind: "effects" | "filters", label: string, empty: boolean, body: ReactNode) => {
    if (empty) return null;
    const key = `${layerId}:${kind}`;
    const open = !collapsed.has(key);
    return (
      <div key={key} data-mv-layer-detail={kind} style={{ paddingLeft: 46 + depth * 14, color: "var(--text-3)", fontSize: 10 }}>
        <button
          type="button"
          draggable={false}
          aria-expanded={open}
          aria-label={`${open ? "Collapse" : "Expand"} ${label} for layer`}
          onClick={() => onToggle(key)}
          style={{ display: "flex", alignItems: "center", gap: 4, width: "100%", height: 19, padding: 0, border: "none", background: "transparent", color: "inherit", cursor: "pointer", textAlign: "left" }}
        >
          <span aria-hidden>{open ? "▾" : "▸"}</span>
          <span>{label}</span>
        </button>
        {open && body}
      </div>
    );
  };
  return (
    <>
      {section("effects", "Effects", effects.length === 0, effects.map((name, index) => (
        <div key={`${name}:${index}`} data-mv-layer-detail-row style={{ height: 18, display: "flex", alignItems: "center", gap: 5, paddingLeft: 14 }}>
          <span aria-hidden style={{ color: "var(--text-2)" }}>◉</span>
          <span>{name}</span>
        </div>
      )))}
      {section("filters", "Smart Filters", smartFilters.length === 0,
        <SmartFilterRows layerId={layerId} rows={smartFilters} />)}
    </>
  );
}

// Photoshop's smart-filter sub-rows: an eye per filter, double-click (or the
// ⇅ button) to re-edit its live parameters, per-filter Blending Options,
// reorder, and delete — none of which the flat name list could do (VIS-LS-02).
export function SmartFilterRows({ layerId, rows }: { layerId: number; rows: SmartFilterRow[] }) {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const { open: openDialog } = useDialogs();
  const iconButton = (extra?: React.CSSProperties): React.CSSProperties => ({
    flex: "0 0 auto", width: 14, height: 16, padding: 0, border: "none", background: "transparent",
    color: "inherit", cursor: "pointer", fontSize: 10, lineHeight: "16px", ...extra,
  });
  return (
    <>
      {rows.map((row) => {
        const name = SMART_FILTER_NAMES[row.fid] ?? `Filter ${row.index + 1}`;
        const open = openIndex === row.index;
        // Camera Raw's recipe reopens in its own workspace; everything else
        // re-edits its stored params right here.
        const reedit = () => {
          if (row.fid === CAMERA_RAW_FID) store.requestCameraRawEdit();
          else if (row.fid === GALLERY_PINS_FID || row.fid === SPIN_PINS_FID) {
            const name: DialogName = row.fid === SPIN_PINS_FID ? "spinBlur"
              : row.params[0] === 1 ? "irisBlur" : row.params[0] === 2 ? "tiltShift" : "fieldBlur";
            openDialog(name, {
              docId: store.state.activeDocId, layerId, index: row.index, fid: row.fid, params: row.params,
            } satisfies PinnedBlurEditRequest);
          }
          else setOpenIndex(open ? null : row.index);
        };
        return (
          <div key={row.index} data-mv-smart-filter={row.index}>
            <div
              data-mv-layer-detail-row
              style={{ height: 18, display: "flex", alignItems: "center", gap: 5, paddingLeft: 14 }}
              onDoubleClick={reedit}
            >
              <button
                type="button"
                data-mv-smart-filter-eye={row.index}
                aria-label={`${row.enabled ? "Hide" : "Show"} ${name}`}
                aria-pressed={row.enabled}
                title={row.enabled ? "Hide this filter" : "Show this filter"}
                onClick={() => store.setSmartFilterEnabled(layerId, row.index, !row.enabled)}
                style={iconButton({ color: row.enabled ? "var(--text-2)" : "var(--text-3)" })}
              >
                {row.enabled ? "◉" : "◌"}
              </button>
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", opacity: row.enabled ? 1 : 0.5 }}>
                {name}
              </span>
              <button
                type="button"
                data-mv-smart-filter-options={row.index}
                aria-expanded={row.fid === CAMERA_RAW_FID || row.fid === GALLERY_PINS_FID || row.fid === SPIN_PINS_FID ? undefined : open}
                aria-label={`Edit ${name}`}
                title="Filter options"
                onClick={reedit}
                style={iconButton()}
              >
                ⇅
              </button>
              <button
                type="button"
                data-mv-smart-filter-delete={row.index}
                aria-label={`Delete ${name}`}
                title="Delete this filter"
                onClick={() => { setOpenIndex(null); store.removeSmartFilter(layerId, row.index); }}
                style={iconButton()}
              >
                ×
              </button>
            </div>
            {open && (
              <div style={{ display: "flex", flexDirection: "column", gap: 4, padding: "3px 4px 6px 28px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <BlendModeSelect
                    size="sm"
                    aria-label={`${name} blend mode`}
                    value={BLEND_ORDER[row.blend] ?? "normal"}
                    options={FILTER_BLEND_OPTIONS}
                    onChange={(v: string) => store.setSmartFilterBlend(layerId, row.index, blendIndex(v), row.opacity)}
                  />
                  <NumberField
                    size="sm"
                    aria-label={`${name} opacity`}
                    value={Math.round(row.opacity * 100)}
                    min={0}
                    max={100}
                    suffix="%"
                    onChange={(pct: number) => store.setSmartFilterBlend(layerId, row.index, row.blend, pct / 100)}
                  />
                  {/* ponytail: ▲▼ instead of Photoshop's drag-to-reorder — keyboard
                      operable and a fraction of the code. Wire HTML5 DnD here (with
                      stopPropagation, or the layer row steals the drag) if it matters. */}
                  <button type="button" aria-label={`Move ${name} up`} title="Move up" disabled={row.index === 0}
                    onClick={() => { setOpenIndex(row.index - 1); store.moveSmartFilter(layerId, row.index, row.index - 1); }}
                    style={iconButton({ cursor: row.index === 0 ? "default" : "pointer", opacity: row.index === 0 ? 0.35 : 1 })}>▲</button>
                  <button type="button" aria-label={`Move ${name} down`} title="Move down" disabled={row.index === rows.length - 1}
                    onClick={() => { setOpenIndex(row.index + 1); store.moveSmartFilter(layerId, row.index, row.index + 1); }}
                    style={iconButton({ cursor: row.index === rows.length - 1 ? "default" : "pointer", opacity: row.index === rows.length - 1 ? 0.35 : 1 })}>▼</button>
                </div>
                {row.params.map((value, paramIndex) => {
                  const spec = SMART_FILTER_PARAMS[row.fid]?.[paramIndex];
                  const label = spec?.label ?? `Value ${paramIndex + 1}`;
                  return (
                    <label key={paramIndex} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <span style={{ flex: 1, minWidth: 0 }}>{label}</span>
                      <NumberField
                        size="sm"
                        aria-label={`${name} ${label}`}
                        value={value}
                        min={spec?.min}
                        max={spec?.max}
                        step={spec?.step}
                        precision={spec?.step != null && Number.isInteger(spec.step) ? 0 : 2}
                        onChange={(v: number) => store.setSmartFilterParam(layerId, row.index, paramIndex, v)}
                      />
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

// Inline layer-name editor: an <input> that takes over a row's name slot while
// renaming. Enter / blur commit, Escape cancels (a `done` latch makes the blur
// that follows Enter/Escape a no-op so they don't double-fire).
function RenameInput({ initial, onCommit, onCancel }: {
  initial: string; onCommit: (v: string) => void; onCancel: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  const [val, setVal] = useState(initial);
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(val); else onCancel();
  };
  useEffect(() => { const el = ref.current; if (el) { el.focus(); el.select(); } }, []);
  return (
    <input
      ref={ref}
      className="mv-layer-rename"
      aria-label="Layer name"
      value={val}
      spellCheck={false}
      onChange={(e) => setVal(e.target.value)}
      onClick={(e) => e.stopPropagation()}
      onPointerDown={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        e.stopPropagation();
        // While an IME candidate is being composed (CJK, dead keys), Enter/Escape
        // belong to the IME — don't commit/cancel the rename.
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
      style={{
        width: "100%", boxSizing: "border-box", font: "inherit", color: "var(--text-1)",
        background: "var(--glass-2)", border: "1px solid var(--accent-raster)",
        borderRadius: 3, padding: "1px 4px", outline: "none",
      }}
    />
  );
}

export function ColorPanel() {
  const fg = useStore((s) => s.fg);
  const bg = useStore((s) => s.bg);
  const colorRampMode = useStore((s) => s.colorRampMode);
  const maskEditOn = useStore((s) => s.maskEdit);
  const quickMaskOn = useStore((s) => s.quickMask);
  const presets = ["#000000", "#ffffff", "#ff3b30", "#ff9500", "#ffcc00", "#34c759", "#00c7be", "#007aff", "#5856d6", "#af52de", "#c4724a", "#8a6850"];
  const colorCopySource = useRef<"fg" | "bg">("fg");
  const colorCtx: MenuItemDef[] = [
    { id: "cc-hex", label: "Copy Color's Hex Code", action: () => copySwatchColor(colorCopySource.current, "hex") },
    { id: "cc-html", label: "Copy Color as HTML", action: () => copySwatchColor(colorCopySource.current, "html") },
  ];
  // Photoshop's Color-panel ramp bar: click/drag picks the foreground for the
  // selected ramp mode (Spectrum / Grayscale / Current Colors).
  const rampDragging = useRef(false);
  const pickFromRamp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (rect.width <= 0) return;
    store.setForeground(rampColor(colorRampMode, (e.clientX - rect.left) / rect.width, fg, bg));
  };
  const rampBg = colorRampMode === "grayscale"
    ? "linear-gradient(to right, #000, #fff)"
    : colorRampMode === "current"
      ? `linear-gradient(to right, ${hsvToHex(fg)}, ${hsvToHex(bg)})`
      : "linear-gradient(to right, hsl(0,100%,50%), hsl(60,100%,50%), hsl(120,100%,50%), hsl(180,100%,50%), hsl(240,100%,50%), hsl(300,100%,50%), hsl(360,100%,50%))";
  return (
    <div>
      <div className="mv-panel-menu-row">
        {panelMenu("Color", [
          { id: "color-options", label: "Panel Options", items: RAMP_MODES.map((m) => ({
            id: `ramp-${m.value}`, label: m.label, checked: colorRampMode === m.value,
            action: () => store.setOptions({ colorRampMode: m.value as RampMode }),
          })) },
          ...colorCtx,
        ])}
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
        <ContextMenu items={colorCtx}>
          <div
            onContextMenuCapture={(event) => { colorCopySource.current = (event.target as HTMLElement).closest("[data-mv-bgswatch]") ? "bg" : "fg"; }}
            style={{ position: "relative", width: 44, height: 44 }}
          >
            <span data-mv-fgswatch title="Right-click to copy the foreground colour" style={{ position: "absolute", left: 0, top: 0, width: 30, height: 30, borderRadius: 5, background: hsvToHex(fg), boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }} />
            <span data-mv-bgswatch title="Right-click to copy the background colour" style={{ position: "absolute", right: 0, bottom: 0, width: 30, height: 30, borderRadius: 5, background: hsvToHex(bg), boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.2)" }} />
          </div>
        </ContextMenu>
        <Button size="sm" variant="ghost" onClick={() => store.swapColors()} title="Swap (X)">⇄</Button>
        <Button size="sm" variant="ghost" onClick={() => { const c = defaultColors(maskEditOn, quickMaskOn); store.setForeground(c.fg); store.setBackground(c.bg); }} title="Default (D)">▣</Button>
      </div>
      <ColorPicker value={fg} accent={ACCENT} onChange={(hsv) => store.setForeground(hsv)} swatches={presets} />
      <div className="monet-row" style={{ marginTop: 8, justifyContent: "flex-end" }}>
        <Select size="sm" id="mv-ramp-mode" aria-label="Ramp" value={colorRampMode} options={RAMP_MODES} onChange={(v) => store.setOptions({ colorRampMode: v as RampMode })} />
      </div>
      <div
        data-mv-color-ramp
        title="Click the ramp to set the foreground colour"
        onPointerDown={(e) => { rampDragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture optional */ } pickFromRamp(e); }}
        onPointerMove={(e) => { if (rampDragging.current) pickFromRamp(e); }}
        onPointerUp={(e) => { rampDragging.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }}
        onPointerCancel={(e) => { rampDragging.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }}
        style={{
          marginTop: 6, height: 16, borderRadius: 4, cursor: "crosshair", touchAction: "none",
          background: rampBg,
          boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)",
        }}
      />
    </div>
  );
}

// A panel that caches an engine read has to re-run whenever the COMPOSITE
// changes, and the undo bookkeeping does not track that: a layer-visibility
// toggle and every tick after the first of a coalesced opacity drag push no undo
// state at all (#102), and at the History States cap `undo_depth()` is pinned by
// eviction, so a run of same-label edits — every brush stroke pushes "Brush" —
// leaves both halves of the key constant (#171). `doc` is replaced on every
// engine→store sync (the signal InfoPanel already relies on), so its identity is
// the composite generation; this hands out a stable number per instance.
const compositeGens = new WeakMap<object, number>();
let compositeGenNext = 0;
function useCompositeGen(): number {
  return useStore((s) => {
    let gen = compositeGens.get(s.doc);
    if (gen === undefined) compositeGens.set(s.doc, (gen = ++compositeGenNext));
    return gen;
  });
}

// ACR-style hue/saturation vectorscope. The n×n density grid comes from the
// shared engine op (packages/engine, also used by monet-artisan); drawing is
// local (state/vectorscope.ts). Redraws whenever the live composite changes.
function VectorscopeView() {
  const rev = useStore((s) => s.undoDepth + ":" + s.undoLabel + ":" + s.layers.length + ":" + s.activeLayerId + ":" + s.activeDocId + ":" + s.selectionGen) + ":" + useCompositeGen();
  const ref = useRef<HTMLCanvasElement>(null);
  const N = 128;
  const SIZE = 176;
  useEffect(() => {
    void rev; // cache key: engine.vectorscope reads the live composite
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    drawVectorscope(ctx, engine.vectorscope(N), N, SIZE);
  }, [rev]);
  return <canvas ref={ref} width={SIZE} height={SIZE} data-mv-vectorscope-canvas style={{ width: SIZE, height: SIZE, display: "block", borderRadius: "50%" }} />;
}

// Broadcast waveform — luma (green trace), RGB (additive per-channel overlay)
// or RGB Parade (the three channels side by side in thirds). The density
// grid(s) come from the shared engine op (packages/engine, also used by
// monet-artisan); drawing is shared (@monet-ui/monet-scopes). Redraws on
// composite changes.
function WaveformView({ scope }: { scope: HistScope }) {
  const rev = useStore((s) => s.undoDepth + ":" + s.undoLabel + ":" + s.layers.length + ":" + s.activeLayerId + ":" + s.activeDocId + ":" + s.selectionGen) + ":" + useCompositeGen();
  const ref = useRef<HTMLCanvasElement>(null);
  const parade = scope === "waveform-parade";
  // a parade panel is only a third as wide, so sample proportionally fewer
  // columns — 176 columns into 80px would smear into sub-pixel cells
  const COLS = parade ? 64 : 176;
  const ROWS = 128;
  const W = 240;
  const H = 132;
  useEffect(() => {
    void rev; // cache key: engine.waveform reads the live composite
    const c = ref.current;
    const ctx = c?.getContext("2d");
    if (!c || !ctx) return;
    if (parade) drawWaveformParade(ctx, engine.waveformRgb(COLS, ROWS), COLS, ROWS, W, H);
    else if (scope === "waveform-rgb") drawWaveformRgb(ctx, engine.waveformRgb(COLS, ROWS), COLS, ROWS, W, H);
    else drawWaveform(ctx, engine.waveform(COLS, ROWS), COLS, ROWS, W, H);
  }, [rev, scope, parade, COLS]);
  return <canvas ref={ref} width={W} height={H} data-mv-waveform-canvas data-mv-waveform-mode={scope} style={{ width: W, height: H, display: "block", borderRadius: 4 }} />;
}

export function HistogramPanel() {
  // The composite generation catches consecutive same-label edits (and edits
  // that push no undo state at all); activeDocId catches tab switches between
  // documents whose other fields happen to coincide.
  const rev = useStore((s) => s.undoDepth + ":" + s.undoLabel + ":" + s.layers.length + ":" + s.activeLayerId + ":" + s.activeDocId + ":" + s.selectionGen) + ":" + useCompositeGen();
  const mode = useStore((s) => s.mode);
  const histChannel = useStore((s) => s.histChannel);
  const histAllChannels = useStore((s) => s.histAllChannels);
  const histScope = useStore((s) => s.histScope);
  const channelOptions = useMemo(() => histogramChannelOptions(mode), [mode]);
  const allChannelOptions = useMemo(() => histogramAllChannelOptions(mode), [mode]);
  const effectiveHistChannel = channelOptions.some((o) => o.id === histChannel) ? histChannel : channelOptions[0].id;
  const counts = useMemo(() => {
    void rev; // cache key: channelHistogram reads live engine state
    return engine.channelHistogram(effectiveHistChannel);
  }, [rev, effectiveHistChannel]);
  const data = useMemo(() => downsampleBins(counts, 48), [counts]);
  const stats = useMemo(() => histogramStats(counts), [counts]);
  // All Channels View: RGB, Lab, or CMYK/Multichannel histograms together.
  const allBars = useMemo(() => {
    void rev; // cache key: channelHistogramBars reads live engine state
    return histAllChannels
      ? allChannelOptions.map((o) => ({ ...o, data: engine.channelHistogramBars(o.id, 48) }))
      : null;
  }, [rev, histAllChannels, allChannelOptions]);
  // Photoshop's hover readout: the Level under the cursor + its Count + Percentile.
  const [hoverLevel, setHoverLevel] = useState<number | null>(null);
  const readout = hoverLevel != null ? histogramReadout(counts, hoverLevel) : null;
  const cell = (label: string, hook: string, value: string) => (
    <span data-mv-hist={hook} style={{ color: "var(--text-3)" }}>
      {label} <span style={{ color: "var(--text-1)" }}>{value}</span>
    </span>
  );
  // ACR-style right-click menu: switch the graph area between the tonal
  // histogram, the hue/saturation vectorscope, and the luma / RGB waveform.
  const scopeItem = (scope: HistScope, label: string): MenuItemDef => ({
    id: `scope-${scope}`,
    label: (histScope === scope ? "✓ " : "") + label,
    action: () => store.setOptions({ histScope: scope }),
  });
  const scopeCtx: MenuItemDef[] = [
    scopeItem("histogram", "Show Histogram"),
    scopeItem("vectorscope", "Show Vectorscope"),
    scopeItem("waveform", "Show Waveform"),
    scopeItem("waveform-rgb", "Show RGB Waveform"),
    scopeItem("waveform-parade", "Show RGB Parade"),
  ];
  const histogramMenu = panelMenu("Histogram", [
    { id: "histogram-options", label: "Panel Options", items: [
      ...scopeCtx,
      { id: "histogram-all-channels", label: "All Channels View", checked: histAllChannels,
        action: () => store.setOptions({ histScope: "histogram", histAllChannels: !histAllChannels }) },
    ] },
  ]);
  const isWave = histScope === "waveform" || histScope === "waveform-rgb" || histScope === "waveform-parade";
  if (histScope === "vectorscope" || isWave) {
    const title = histScope === "waveform-parade" ? "RGB Parade" : histScope === "waveform-rgb" ? "RGB Waveform" : histScope === "waveform" ? "Waveform" : "Vectorscope";
    return (
      <div>
        <div className="monet-row" style={{ gap: 6, marginBottom: 4 }}>
          <span className="monet-section-label" style={{ margin: 0 }}>{title}</span>
          <span style={{ flex: 1 }} />
          {histogramMenu}
        </div>
        <ContextMenu items={scopeCtx}>
          <div data-mv-hist-graph data-mv-vectorscope={isWave ? undefined : ""} style={{ display: "flex", justifyContent: "center", padding: "2px 0" }}>
            {isWave ? <WaveformView scope={histScope} /> : <VectorscopeView />}
          </div>
        </ContextMenu>
      </div>
    );
  }
  return (
    <div>
      <div className="monet-row" style={{ gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
        <span className="monet-section-label" style={{ margin: 0 }}>Channel</span>
        <Select size="sm" id="mv-hist-channel" style={{ flexShrink: 0 }} value={effectiveHistChannel} disabled={histAllChannels} onChange={(v) => store.setOptions({ histChannel: v as HistChannel })}
          options={channelOptions.map((o) => ({ value: o.id, label: o.label }))} />
        <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 11, color: "var(--text-3)", marginLeft: "auto" }}>
          <input id="mv-hist-all" type="checkbox" checked={histAllChannels} onChange={(e) => store.setOptions({ histAllChannels: e.target.checked })} />
          All Channels
        </label>
        {histogramMenu}
      </div>
      <ContextMenu items={scopeCtx}>
        <div>
          {allBars ? (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {allBars.map((s) => (
                <div key={s.id} data-mv-allchan={s.id}>
                  <Histogram accent={s.accent} aria-label={`${s.label} histogram`} data={s.data} />
                </div>
              ))}
            </div>
          ) : (
            <>
              <div data-mv-hist-graph
                onPointerMove={(e) => { const r = e.currentTarget.getBoundingClientRect(); if (r.width > 0) setHoverLevel(levelFromFraction((e.clientX - r.left) / r.width)); }}
                onPointerLeave={() => setHoverLevel(null)}>
                <Histogram accent={ACCENT} aria-label="Histogram" data={data} />
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 12px", fontSize: 11, marginTop: 6, fontFamily: "var(--font-mono)" }}>
                {cell("Mean", "mean", stats.mean.toFixed(2))}
                {cell("Std Dev", "stddev", stats.stdDev.toFixed(2))}
                {cell("Median", "median", String(stats.median))}
                {cell("Pixels", "pixels", String(stats.pixels))}
                {cell("Level", "level", readout ? String(readout.level) : "—")}
                {cell("Count", "count", readout ? String(readout.count) : "—")}
                {cell("Percentile", "percentile", readout ? `${readout.percentile.toFixed(1)}%` : "—")}
              </div>
            </>
          )}
        </div>
      </ContextMenu>
    </div>
  );
}

/** Photoshop's ⌘-click-a-channel-row convention (Ctrl on Windows). Clicks that
 *  land on one of the row's own buttons are that button's, not the row's. */
const rowModifierClick = (e: ReactMouseEvent<HTMLDivElement>) =>
  (e.metaKey || e.ctrlKey) && !(e.target as HTMLElement).closest("button");

// Photoshop's Load Selection modifiers, shared by the layer and mask thumbnails:
// ⌘ replaces, ⌘⇧ adds, ⌘⌥ subtracts, ⌘⌥⇧ intersects. Matches SelMode::from_u8.
const loadSelectionMode = (mods: { shift: boolean; alt: boolean }) =>
  mods.shift && mods.alt ? 3 : mods.alt ? 2 : mods.shift ? 1 : 0;

// Spot-plate ops, called on the engine directly the way Apply to Channel is —
// the store carries only the plate names.
type SpotOps = {
  spot_channel_ink?: (index: number) => number;
  spot_channel_solidity?: (index: number) => number;
  spot_channel_visible?: (index: number) => boolean;
  set_spot_channel_visible?: (index: number, on: boolean) => void;
  set_spot_channel_options?: (index: number, name: string, r: number, g: number, b: number, solidity: number) => void;
  load_spot_channel_as_selection?: (index: number, mode: number) => void;
  save_selection_to_spot_channel?: (index: number) => void;
  merge_spot_channel?: (index: number) => void;
};
const spotOps = () => {
  const e = engine.engine;
  return e ? (e as typeof e & SpotOps) : null;
};

type SpotDraft = { name: string; color: string; solidity: number };
type SpotRowData = SpotDraft & { visible: boolean };

/** One plate's live state, read straight from the engine. */
const spotRow = (name: string, index: number): SpotRowData => {
  const e = spotOps();
  const ink = e?.spot_channel_ink?.(index) ?? 0;
  return {
    name,
    color: `#${ink.toString(16).padStart(6, "0")}`,
    solidity: Math.round((e?.spot_channel_solidity?.(index) ?? 1) * 100),
    visible: e?.spot_channel_visible?.(index) ?? true,
  };
};

export function ChannelsPanel() {
  const thumbnailSize = useStore((s) => s.panelOptions?.channelThumbnailSize) ?? DEFAULT_PANEL_OPTIONS.channelThumbnailSize;
  const mode = useStore((s) => s.mode);
  const profile = useStore((s) => s.colorProfile);
  const profileAssigned = useStore((s) => s.colorProfileAssigned);
  const profileName = useStore((s) => s.iccProfileName);
  const modeProfileName = useStore((s) => s.modeProfileName);
  const selectionActive = useStore((s) => s.selectionActive);
  const channelTarget = useStore((s) => s.channelTarget);
  const channelAlone = useStore((s) => s.channelAlone);
  const channelOptions = useStore((s) => s.channelOptions);
  const [optionsFor, setOptionsFor] = useState<string | null>(null);
  // Quick Mask Options: the rubylith's own colour / opacity / Color Indicates.
  // The overlay module owns them (a targeted channel overwrites them with its
  // Channel Options), so the draft is seeded from it and written straight back.
  const [qmOptionsOpen, setQmOptionsOpen] = useState(false);
  const [qm, setQm] = useState<QuickMaskOverlay>(quickMaskOverlay);
  const rev = useStore((s) => `${s.activeDocId}:${s.selectionGen}:${s.undoDepth}:${s.undoLabel}:${s.mode}:${s.colorProfile}:${s.colorProfileAssigned}:${s.iccProfileName ?? ""}:${s.modeProfileName ?? ""}`) + `:${useCompositeGen()}`;
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev is the cache key for engine-owned alpha channels.
  const saved = useMemo(() => store.savedSelectionNames(), [rev]);
  const spots = useStore((s) => s.spotChannelNames);
  const quickMaskOn = useStore((s) => s.quickMask);
  const quickMaskGen = useStore((s) => s.quickMaskGen);
  const activeDocId = useStore((s) => s.activeDocId);
  // Which plate is being painted, and the draft of its Options dialog.
  const [spotEdit, setSpotEdit] = useState<number | null>(null);
  const [spotOptionsFor, setSpotOptionsFor] = useState<number | null>(null);
  const [spotDraft, setSpotDraft] = useState<SpotDraft>({ name: "", color: "#ec008c", solidity: 100 });
  // The plate's ink/solidity/eye live in the engine, not the store — this is the
  // cache key for reading them back (bumped by every spot edit).
  const [spotGen, setSpotGen] = useState(0);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev + spotGen are the cache key for engine-owned plates.
  const spotRows = useMemo(() => spots.map((name, i) => spotRow(name, i)), [rev, spotGen, spots]);
  // A plate is painted through the Quick Mask buffer: once that is gone (Q, a
  // doc swap, undo of the round-trip) there is no plane left to write back.
  useEffect(() => { if (!quickMaskOn) setSpotEdit(null); }, [quickMaskOn]);
  useEffect(() => { setSpotEdit(null); setSpotOptionsFor(null); }, [activeDocId]);
  const base = (() => {
    switch (mode) {
      case 1: return ["Gray"];
      case 2: return ["Composite CMYK", "Cyan", "Magenta", "Yellow", "Black"];
      case 3: return ["Composite Lab", "Lightness", "a", "b"];
      case 4: return ["Multichannel Composite", "Cyan", "Magenta", "Yellow", "Black"];
      default: return ["Composite RGB", "Red", "Green", "Blue"];
    }
  })();
  // The mode's real plates, 1-based the way the engine indexes them (the
  // composite row of a multi-plate mode is index 0, not a plate).
  const plates = mode === 1 ? base : base.slice(1);
  // Apply target, clamped so a mode change (4 inks → 3 Lab axes) can't leave it
  // pointing past the plate set.
  const [plateTarget, setPlateTarget] = useState(1);
  const applyPlate = Math.min(Math.max(plateTarget, 1), plates.length);
  const qmHex = `#${((qm.color.r << 16) | (qm.color.g << 8) | qm.color.b).toString(16).padStart(6, "0")}`;
  // Write one Quick Mask Option through. Display-only — nothing here touches the
  // mask's bytes, so there is no history step.
  // ponytail: the gen bump goes through setOptions because quickMaskGen is the
  // canvas overlay's only repaint signal and the store's own bumper
  // (applyChannelOverlay) resets the overlay to the defaults on the way past.
  const setQuickMaskOption = (patch: Partial<QuickMaskOverlay>) => {
    const next = { ...qm, ...patch };
    setQm(next);
    setQuickMaskOverlay(next);
    store.setOptions({ quickMaskGen: store.state.quickMaskGen + 1 });
  };
  const save = () => {
    const baseName = "Alpha";
    let name = baseName;
    for (let i = 2; saved.includes(name); i++) name = `${baseName} ${i}`;
    store.saveSelection(name);
  };
  // Every mode has real pixel channels: the engine separates CMYK inks and Lab
  // axes on demand through the same model the CMYK writer uses.
  const duplicate = (channelName: string, channel: number) => {
    let name = `${channelName} copy`;
    for (let i = 2; store.savedSelectionNames().includes(name); i++) name = `${channelName} copy ${i}`;
    store.duplicateChannel(channel, name);
  };
  // Apply to Channel: push an alpha channel back into a document plate — how a
  // CMYK/Lab plate is edited (paint into an alpha channel, then apply it to
  // Cyan). Called on the engine directly; the store has no wrapper for it.
  const applyToPlate = (name: string) => {
    const e = engine.engine;
    if (!e) return;
    const withPlates = e as typeof e & { apply_alpha_to_channel?: (channelName: string, plate: number) => void };
    if (!withPlates.apply_alpha_to_channel) return;
    withPlates.apply_alpha_to_channel(name, applyPlate);
    engine.commit();
  };
  // ── Spot plates ──
  // Photoshop paints a spot channel with any tool. Here the plate's coverage is
  // loaded into the Quick Mask buffer — the paintable grayscale plane the engine
  // already owns — and written back on the way out, exactly how an alpha channel
  // is targeted.
  const leaveSpotEdit = (e: NonNullable<ReturnType<typeof spotOps>>) => {
    if (spotEdit === null) return;
    // Only write back while the buffer is still the plate's: Q or an undo can
    // drop it, and saving the live selection then would wipe the coverage.
    if (e.quick_mask_on()) {
      e.exit_quick_mask();
      e.save_selection_to_spot_channel?.(spotEdit);
    }
    setSpotEdit(null);
  };
  const editSpot = (index: number) => {
    const e = spotOps();
    if (!e) return;
    const wasEditing = spotEdit;
    leaveSpotEdit(e);
    if (wasEditing !== index) {
      store.targetChannel(null); // an alpha channel and a plate share the buffer
      e.load_spot_channel_as_selection?.(index, 0);
      e.enter_quick_mask();
      setSpotEdit(index);
    }
    engine.commit();
    setSpotGen((gen) => gen + 1);
  };
  const spotAction = (run: (e: NonNullable<ReturnType<typeof spotOps>>) => void) => {
    const e = spotOps();
    if (!e) return;
    leaveSpotEdit(e); // never act on a plate whose coverage is still in the buffer
    run(e);
    engine.commit();
    setSpotGen((gen) => gen + 1);
  };
  const openSpotOptions = (index: number) => {
    const { name, color, solidity } = spotRow(spots[index], index);
    setSpotDraft({ name, color, solidity });
    setSpotOptionsFor(index);
  };
  // Applied on Done, not per keystroke — each apply is one history step.
  const applySpotOptions = (index: number) => {
    const [r, g, b] = hexToRgb(spotDraft.color);
    spotAction((e) => e.set_spot_channel_options?.(index, spotDraft.name, r, g, b, spotDraft.solidity / 100));
    setSpotOptionsFor(null);
  };
  // Live grayscale thumbnails of every document channel (index 0 = composite),
  // so the highest-contrast plane can be picked by eye — the first move of the
  // channel-masking workflow.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev is the cache key (channelThumbUrls reads live engine output).
  const thumbs = useMemo(() => store.channelThumbUrls(base.map((_, i) => i), thumbnailSize, thumbnailSize), [rev, thumbnailSize]);
  // The composite row shows the colour image, not its luminance.
  // eslint-disable-next-line react-hooks/exhaustive-deps -- same cache key.
  const compositeThumb = useMemo(() => (engine.engine ? engine.docThumbUrl(engine.engine, thumbnailSize, thumbnailSize) : ""), [rev, thumbnailSize]);
  // Alpha / spot / Quick Mask rows show their own coverage, like every document
  // plate above them. Keyed on the same revision the plate thumbnails use, plus
  // the Quick Mask generation, so a painted channel refreshes.
  const alphaThumbs = useMemo(
    () => Object.fromEntries(saved.map((name) => [name, store.savedChannelThumbUrl(name)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- rev is the cache key.
    [saved, rev],
  );
  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev is the cache key.
  const spotThumbs = useMemo(() => spots.map((_, i) => store.spotChannelThumbUrl(i)), [spots, rev]);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- quickMaskGen is the cache key.
  const qmThumb = useMemo(() => (quickMaskOn ? store.quickMaskThumbUrl() : ""), [quickMaskOn, quickMaskGen, rev]);
  const thumbBoxStyle = { width: thumbnailSize, height: thumbnailSize, borderRadius: 2, border: "1px solid var(--line)", flex: "0 0 auto" } as const;
  const thumb = (url: string, alt: string, fallback: string) => (url
    ? <img src={url} alt={alt} width={thumbnailSize} height={thumbnailSize} style={{ ...thumbBoxStyle, display: "block", objectFit: "cover" }} />
    : <span aria-hidden style={{ ...thumbBoxStyle, display: "block", background: fallback }} />
  );
  const row = (name: string, swatch: string, channel?: number) => (
    <div key={name} data-mv-channel={name} className="monet-row" title={`${name} — ⌘-click to load as a selection`}
      onClick={(e) => { if (rowModifierClick(e) && channel !== undefined) store.loadChannelAsSelection(channel); }}
      style={{ minHeight: thumbnailSize + 4, gap: 8 }}>
      {thumb(channel === 0 && base.length > 1 ? compositeThumb : thumbs[channel ?? 0], `${name} channel`, swatch)}
      <span style={{ flex: 1, fontSize: 11, color: "var(--text-1)" }}>{name}</span>
      {channel !== undefined && (
        <Button size="sm" variant="ghost" onClick={() => store.loadChannelAsSelection(channel)} title="Load this channel as the selection (⌘-click the row)">Load</Button>
      )}
      {channel !== undefined && (
        <Button size="sm" variant="ghost" onClick={() => duplicate(name, channel)} title="Duplicate this channel to a new alpha channel">Duplicate</Button>
      )}
    </div>
  );
  return (
    <div data-mv-channels-panel style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div className="mv-panel-menu-row">
        {panelMenu("Channels", [
          { id: "channels-options", label: "Panel Options", items: [thumbnailOptions("channelThumbnailSize", thumbnailSize)] },
          // No prompt(): the desktop webview has none. Naming stays in Select ▸ Save Selection….
          { id: "channels-save", label: "Save Selection as Channel", disabled: !selectionActive, action: save },
        ])}
      </div>
      <PanelOptionsError />
      <div>
        <div className="monet-row" style={{ gap: 6, marginBottom: 2 }}>
          <div className="monet-section-label" style={{ margin: 0 }}>Document Channels</div>
          <span style={{ flex: 1 }} />
          {mode === 0 && (
            <Button size="sm" variant="ghost" onClick={() => store.splitChannels()} title="Split into one grayscale document per channel">Split</Button>
          )}
          {mode === 0 && (
            <Button size="sm" variant="ghost" onClick={() => store.mergeChannels()} title="Merge <name>_Red/_Green/_Blue documents back into one RGB image">Merge</Button>
          )}
        </div>
        <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 4 }}>
          {colorModeName(mode)} · {documentProfileName(profile, profileAssigned, profileName, mode, modeProfileName)}
        </div>
        {base.map((name, i) => row(name, i === 1 ? "#ff4d4d" : i === 2 ? "#3ec96b" : i === 3 ? "#4d8dff" : "#d6d9df", i))}
      </div>
      {quickMaskOn && !channelTarget && spotEdit === null && (
        // Photoshop's temporary Quick Mask channel row — the only place its
        // Options are reachable (double-click there opens the same dialog).
        <div data-mv-quick-mask-channel className="monet-row" style={{ minHeight: thumbnailSize + 4, gap: 6 }}
          onDoubleClick={() => setQmOptionsOpen(true)} title="Quick Mask — double-click for Quick Mask Options">
          {qmThumb
            ? <img src={qmThumb} alt="" width={thumbnailSize} height={thumbnailSize}
                style={{ ...thumbBoxStyle, display: "block", objectFit: "cover" }} />
            : <span aria-hidden style={{ ...thumbBoxStyle, display: "block", background: qmHex }} />}
          <span style={{ flex: 1, fontSize: 11 }}>Quick Mask</span>
          <span className="monet-iconbtn" role="button" aria-label="Quick Mask Options" title="Quick Mask Options…"
            onClick={() => setQmOptionsOpen(true)} style={{ fontSize: 11, cursor: "pointer" }}>⚙</span>
        </div>
      )}
      <div>
        <div className="monet-row" style={{ gap: 6, marginBottom: 4, flexWrap: "wrap" }}>
          <div className="monet-section-label" style={{ margin: 0 }}>Alpha Channels</div>
          <span style={{ flex: 1 }} />
          <Select
            size="sm"
            aria-label="Apply to channel"
            style={{ flexShrink: 0 }}
            data-mv-apply-plate
            value={String(applyPlate)}
            onChange={(v) => setPlateTarget(+v)}
            title="Which document channel the Apply buttons below write into"
            options={plates.map((name, i) => ({ value: String(i + 1), label: name }))}
          />
          <Button size="sm" variant="ghost" disabled={!selectionActive} onClick={save} title="Save the current selection as an alpha channel">Save</Button>
        </div>
        {saved.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 11, padding: 4 }}>No saved alpha channels</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            <Checkbox checked={channelAlone} aria-label="View the targeted channel alone"
              onChange={(on) => store.setChannelAlone(on)}>View channel alone</Checkbox>
            {saved.map((name) => {
              const targeted = channelTarget === name;
              const opts = channelOptions[name] ?? DEFAULT_CHANNEL_OPTIONS;
              return (
                <div key={name} data-mv-alpha-channel={name} className="monet-row"
                  onClick={(e) => { if (rowModifierClick(e)) store.loadSelection(name, 0); }}
                  title={`${name} — ⌘-click to load as a selection`}
                  style={{ minHeight: thumbnailSize + 4, gap: 6, background: targeted ? "var(--bg-3)" : undefined }}>
                  <button type="button" className="monet-iconbtn" aria-pressed={targeted}
                    aria-label={`${targeted ? "Stop editing" : "Edit"} channel ${name}`}
                    title="Target this channel: paint it with any brush and see it on the canvas"
                    onClick={() => store.targetChannel(targeted ? null : name)}
                    style={{ opacity: targeted ? 1 : 0.35 }}>
                    <Icon d={I.eye} size={13} />
                  </button>
                  {alphaThumbs[name]
                    ? <img src={alphaThumbs[name]} alt="" width={thumbnailSize} height={thumbnailSize}
                        style={{ ...thumbBoxStyle, display: "block", objectFit: "cover" }} />
                    : <span aria-hidden style={{ ...thumbBoxStyle, display: "block", background: opts.color }} />}
                  <span style={{ flex: 1, fontSize: 11 }}>{name}</span>
                  <span className="monet-iconbtn" title="Channel Options…" onClick={(e) => { e.stopPropagation(); setOptionsFor(name); }} style={{ fontSize: 11, cursor: "pointer" }}>⚙</span>
                  <Button size="sm" variant="ghost" onClick={() => applyToPlate(name)} title={`Write this alpha channel into the ${plates[applyPlate - 1] ?? ""} channel of the active layer`}>Apply</Button>
                  <Button size="sm" variant="ghost" onClick={() => store.loadSelection(name, 0)} title="Load this alpha channel as the selection">Load</Button>
                  <Button size="sm" variant="ghost" onClick={() => store.deleteSavedSelection(name)} title="Delete this alpha channel">Delete</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div>
        <div className="monet-row" style={{ gap: 6, marginBottom: 4 }}>
          <div className="monet-section-label" style={{ margin: 0 }}>Spot Channels</div>
          <span style={{ flex: 1 }} />
          <Button size="sm" variant="ghost" onClick={() => store.newSpotChannel()} title="Add a spot-ink plate from the current selection, tinted with the foreground colour">New</Button>
        </div>
        {spots.length === 0 ? (
          <div style={{ color: "var(--text-3)", fontSize: 11, padding: 4 }}>No spot channels</div>
        ) : (
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {spotRows.map((spot, i) => {
              const editing = spotEdit === i;
              return (
                <div key={`${spot.name}-${i}`} data-mv-spot-channel={spot.name} className="monet-row"
                  onClick={(e) => { if (rowModifierClick(e)) spotAction((api) => api.load_spot_channel_as_selection?.(i, 0)); }}
                  title={`${spot.name} — ⌘-click to load the plate as a selection`}
                  style={{ minHeight: 26, gap: 6, background: editing ? "var(--bg-3)" : undefined }}>
                  <button type="button" className="monet-iconbtn" aria-pressed={spot.visible}
                    aria-label={`${spot.visible ? "Hide" : "Show"} spot channel ${spot.name}`}
                    title="Show or hide this ink on the composite"
                    onClick={(e) => { e.stopPropagation(); spotAction((api) => api.set_spot_channel_visible?.(i, !spot.visible)); }}
                    style={{ opacity: spot.visible ? 1 : 0.35 }}>
                    <Icon d={I.eye} size={13} />
                  </button>
                  {/* The plate's ink coverage, with its ink colour kept as a small
                      chip beside it — the row has to say both. */}
                  {spotThumbs[i]
                    ? <img src={spotThumbs[i]} alt="" width={thumbnailSize} height={thumbnailSize}
                        style={{ ...thumbBoxStyle, display: "block", objectFit: "cover" }} />
                    : <span aria-hidden style={{ ...thumbBoxStyle, display: "block", background: spot.color }} />}
                  <span aria-hidden style={{ width: 10, height: 10, borderRadius: 2, background: spot.color, border: "1px solid var(--line)" }} />
                  <span style={{ flex: 1, fontSize: 11 }}>{spot.name}</span>
                  <span style={{ fontSize: 10, color: "var(--text-3)" }}>{spot.solidity}%</span>
                  <button type="button" className="monet-iconbtn" aria-pressed={editing}
                    aria-label={`${editing ? "Stop painting" : "Paint"} spot channel ${spot.name}`}
                    title="Paint this plate: its coverage becomes the paintable mask until you toggle back"
                    onClick={(e) => { e.stopPropagation(); editSpot(i); }} style={{ fontSize: 11, cursor: "pointer" }}>✎</button>
                  <span className="monet-iconbtn" title="Spot Channel Options…"
                    onClick={(e) => { e.stopPropagation(); openSpotOptions(i); }} style={{ fontSize: 11, cursor: "pointer" }}>⚙</span>
                  <Button size="sm" variant="ghost" onClick={() => spotAction((api) => api.merge_spot_channel?.(i))}
                    title="Merge Spot Channel: flatten this ink into the image and drop the plate">Merge</Button>
                  <Button size="sm" variant="ghost" onClick={() => spotAction(() => store.removeSpotChannel(i))} title="Delete this spot channel">Delete</Button>
                </div>
              );
            })}
          </div>
        )}
      </div>
      {spotOptionsFor !== null && spotOptionsFor < spots.length && (
        // Photoshop's Spot Channel Options: the ink's name, colour and solidity.
        // Unlike the alpha-channel dialog above, these are document data, so they
        // are applied on Done as one history step.
        <Dialog open onClose={() => setSpotOptionsFor(null)} title={`Spot Channel Options — ${spots[spotOptionsFor]}`} width={260}
          footer={<Button size="sm" variant="primary" data-mv-spot-options-ok onClick={() => applySpotOptions(spotOptionsFor)}>Done</Button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Name</span>
              <Input size="sm" aria-label="Spot channel name" value={spotDraft.name}
                onChange={(e) => setSpotDraft({ ...spotDraft, name: e.target.value })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Color</span>
              <input type="color" aria-label="Spot ink color" value={spotDraft.color}
                onChange={(e) => setSpotDraft({ ...spotDraft, color: e.target.value })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Solidity</span>
              <NumberField size="sm" aria-label="Spot ink solidity" min={0} max={100} step={1} suffix="%"
                value={spotDraft.solidity}
                onChange={(solidity) => setSpotDraft({ ...spotDraft, solidity: Math.min(100, Math.max(0, solidity)) })} />
            </label>
          </div>
        </Dialog>
      )}
      {qmOptionsOpen && (
        // Photoshop's Quick Mask Options — the same three controls as Channel
        // Options, against the rubylith the mask buffer is drawn with.
        <Dialog open onClose={() => setQmOptionsOpen(false)} title="Quick Mask Options" width={260}
          footer={<Button size="sm" variant="primary" onClick={() => setQmOptionsOpen(false)}>Done</Button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span>Color Indicates</span>
              <SegmentedControl accent={ACCENT} value={qm.indicates} aria-label="Quick Mask color indicates"
                onChange={(v) => setQuickMaskOption({ indicates: v as QuickMaskOverlay["indicates"] })}
                items={[{ value: "masked", label: "Masked Areas" }, { value: "selected", label: "Selected Areas" }]} />
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Color</span>
              <input type="color" aria-label="Quick Mask color" value={qmHex}
                onChange={(e) => {
                  const [r, g, b] = hexToRgb(e.target.value);
                  setQuickMaskOption({ color: { r, g, b } });
                }} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Opacity</span>
              <NumberField size="sm" aria-label="Quick Mask opacity" min={0} max={100} step={1} suffix="%"
                value={Math.round(qm.opacity * 100)}
                onChange={(v) => setQuickMaskOption({ opacity: Math.min(1, Math.max(0, v / 100)) })} />
            </label>
          </div>
        </Dialog>
      )}
      {optionsFor !== null && (
        // Photoshop's Channel Options. Display-only, applied live — nothing here
        // touches the channel's bytes.
        // ponytail: no Name field; renaming a saved channel needs an engine op
        // (only the names are exposed, not a rename), so the title carries it.
        <Dialog open onClose={() => setOptionsFor(null)} title={`Channel Options — ${optionsFor}`} width={260}
          footer={<Button size="sm" variant="primary" onClick={() => setOptionsFor(null)}>Done</Button>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Color</span>
              <input type="color" aria-label="Channel overlay color"
                value={(channelOptions[optionsFor] ?? DEFAULT_CHANNEL_OPTIONS).color}
                onChange={(e) => store.setChannelOptions(optionsFor, { color: e.target.value })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
              <span style={{ flex: 1 }}>Opacity</span>
              <NumberField size="sm" aria-label="Channel overlay opacity" min={0} max={100} step={1} suffix="%"
                value={Math.round((channelOptions[optionsFor] ?? DEFAULT_CHANNEL_OPTIONS).opacity * 100)}
                onChange={(v) => store.setChannelOptions(optionsFor, { opacity: Math.min(1, Math.max(0, v / 100)) })} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span>Color Indicates</span>
              <SegmentedControl accent={ACCENT} value={(channelOptions[optionsFor] ?? DEFAULT_CHANNEL_OPTIONS).indicates}
                onChange={(v) => store.setChannelOptions(optionsFor, { indicates: v as ChannelOptions["indicates"] })}
                items={[{ value: "masked", label: "Masked Areas" }, { value: "selected", label: "Selected Areas" }]} />
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

// Navigator thumbnail box (px). The composite thumbnail is contain-fit into this
// box and centred; the view box is drawn over it (Photoshop's Navigator panel).
const NAV_W = 200;
const NAV_H = 140;

export function NavigatorPanel() {
  // Same cache key as the Histogram panel — docThumbUrl reads live engine state.
  const rev = useStore((s) => s.undoDepth + ":" + s.undoLabel + ":" + s.layers.length + ":" + s.activeLayerId + ":" + s.activeDocId + ":" + s.selectionGen) + ":" + useCompositeGen();
  const zoom = useStore((s) => s.zoom);
  const panX = useStore((s) => s.panX);
  const panY = useStore((s) => s.panY);
  const pixelAspect = useStore((s) => s.pixelAspect);
  const pixelAspectCorrection = useStore((s) => s.pixelAspectCorrection);
  const vp = useStore((s) => s.viewport);
  const doc = useStore((s) => s.doc);
  const docW = doc.width;
  const docH = doc.height;
  const dragging = useRef(false);

  // eslint-disable-next-line react-hooks/exhaustive-deps -- rev is the cache key (docThumbUrl reads engine state)
  const url = useMemo(() => (engine.engine && docW && docH ? engine.docThumbUrl(engine.engine, NAV_W, NAV_H) : ""), [rev]);
  const tb = thumbBox(docW, docH, NAV_W, NAV_H);
  const parX = pixelAspectCorrection ? pixelAspect : 1;
  const vr = viewRectInThumb(visibleDocRect(zoom, panX, panY, vp.w, vp.h, parX), docW, docH, tb.w, tb.h);
  // The thumbnail is centred inside the fixed box; offset the view box to match.
  const imgLeft = (NAV_W - tb.w) / 2;
  const imgTop = (NAV_H - tb.h) / 2;

  // Recenter the canvas on the clicked thumbnail point (drag scrolls live).
  const recenter = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!tb.w || !tb.h || !vp.w || !vp.h) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ox = Math.max(0, Math.min(tb.w, e.clientX - rect.left - imgLeft));
    const oy = Math.max(0, Math.min(tb.h, e.clientY - rect.top - imgTop));
    const { panX: nx, panY: ny } = panForCenter((ox / tb.w) * docW, (oy / tb.h) * docH, zoom, vp.w, vp.h, parX);
    store.setPan(nx, ny);
  };

  return (
    <div>
      <div
        data-mv-nav-thumb
        onPointerDown={(e) => { dragging.current = true; try { e.currentTarget.setPointerCapture(e.pointerId); } catch { /* capture optional */ } recenter(e); }}
        onPointerMove={(e) => { if (dragging.current) recenter(e); }}
        onPointerUp={(e) => { dragging.current = false; try { e.currentTarget.releasePointerCapture(e.pointerId); } catch { /* not captured */ } }}
        style={{ position: "relative", width: NAV_W, height: NAV_H, boxSizing: "border-box", background: "var(--bg-2)", border: "1px solid var(--line)", borderRadius: 4, cursor: docW ? "move" : "default", overflow: "hidden", touchAction: "none" }}
      >
        {url ? (
          <img src={url} alt="Navigator thumbnail" draggable={false} style={{ position: "absolute", left: imgLeft, top: imgTop, width: tb.w, height: tb.h, display: "block" }} />
        ) : (
          <span style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-3)" }}>No document</span>
        )}
        {url && vr.w > 0 && vr.h > 0 && (
          <div data-mv-nav-viewrect style={{ position: "absolute", left: imgLeft + vr.x, top: imgTop + vr.y, width: vr.w, height: vr.h, border: "1px solid #ff3b30", boxShadow: "0 0 0 1px rgba(0,0,0,0.4)", pointerEvents: "none" }} />
        )}
      </div>
      <div className="monet-row monet-cv-navigator-zoom" style={{ gap: 6, marginTop: 6, alignItems: "center" }}>
        <span data-mv-nav-zoom style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)", minWidth: 44 }}>{Math.round(zoom * 100)}%</span>
        <Slider
          id="mv-nav-slider" aria-label="Zoom" min={1} max={3200} step={1} accent={ACCENT}
          value={Math.round(zoom * 100)}
          onChange={(v) => store.setZoom(v / 100)}
          style={{ flex: 1 }}
        />
      </div>
    </div>
  );
}

// Photoshop's Adjustments panel is the NON-destructive one: every tile creates
// an adjustment layer. The destructive equivalents stay where Photoshop keeps
// them — the Image ▸ Adjustments menu — so these all point at the `al*` dialogs.
// Order and roster are Photoshop's own 16 tiles.
const ADJUSTMENTS: { label: string; name?: DialogName; action?: () => void }[] = [
  { label: "Brightness", name: "alBrightness" },
  { label: "Levels", name: "alLevels" },
  { label: "Curves", name: "alCurves" },
  { label: "Exposure", name: "alExposure" },
  { label: "Vibrance", name: "alVibrance" },
  { label: "Hue/Sat", name: "alHueSat" },
  { label: "Color Bal.", name: "alColorBalance" },
  { label: "Black & White", name: "alBlackWhite" },
  { label: "Photo Filt.", name: "alPhotoFilter" },
  { label: "Channel Mixer", name: "alChannelMixer" },
  { label: "Color Lookup", name: "alColorLookup" },
  // Invert has no settings, so Photoshop's tile creates the layer outright
  // (engine adjustment kind 4, the same call the Layer menu's entry makes).
  { label: "Invert", action: () => store.addAdjustmentLayer(4, new Float32Array(0), "Invert") },
  { label: "Posterize", name: "alPosterize" },
  { label: "Threshold", name: "alThreshold" },
  { label: "Gradient Map", name: "alGradientMap" },
  { label: "Selective Color", name: "alSelectiveColor" },
];

export function AdjustmentsPanel() {
  const { open } = useDialogs();
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
      {ADJUSTMENTS.map((a) => (
        <button key={a.label} className="mv-adj-tile"
          onClick={() => (a.name ? open(a.name) : a.action?.())}
          style={{
            aspectRatio: "1.4", borderRadius: 6, background: "var(--glass-0)", color: "var(--text-2)",
            fontSize: 10, border: "none", cursor: "pointer", boxShadow: "inset 0 0.5px 0 var(--hi-top)",
            display: "flex", alignItems: "center", justifyContent: "center", textAlign: "center", padding: 4,
          }}>
          {a.label}
        </button>
      ))}
    </div>
  );
}

const PANEL_HINT: React.CSSProperties = { fontSize: 11, color: "var(--text-3)", padding: "6px 4px", lineHeight: 1.5 };

const LAYER_KIND_LABELS: Record<number, string> = {
  [LAYER_KIND.pixel]: "Pixel Layer",
  [LAYER_KIND.adjustment]: "Adjustment Layer",
  [LAYER_KIND.text]: "Text Layer",
  [LAYER_KIND.vector]: "Shape Layer",
  [LAYER_KIND.fill]: "Fill Layer",
  [LAYER_KIND.groupHeader]: "Group",
  [LAYER_KIND.smartObject]: "Smart Object",
};

// engine adjustment kind → the ADJ_SPECS entry that describes its sliders. Built
// off the dialogs' own table so the panel can never drift from what the `al*`
// dialogs write.
const ADJ_SPEC_BY_KIND = new Map(Object.values(ADJ_SPECS).map((spec) => [spec.kind, spec]));
// The five whose editor is a canvas/list rather than sliders: re-open the dialog
// on this layer instead of duplicating the editor in a 240px panel.
const ADJ_EDITOR_DIALOGS: Record<number, { name: DialogName; label: string }> = {
  12: { name: "alCurves", label: "Curves" },
  13: { name: "alGradientMap", label: "Gradient Map" },
  14: { name: "alChannelMixer", label: "Channel Mixer" },
  15: { name: "alSelectiveColor", label: "Selective Color" },
  16: { name: "alColorLookup", label: "Color Lookup" },
};

// Photoshop's Properties panel: contextual controls for whatever is selected.
// Its Masks section is the reason this exists — the engine has carried
// non-destructive mask Density and Feather since maskProperties landed, and no
// menu or panel could reach either of them.
// Selecting an adjustment layer re-opens ITS controls here, seeded from the
// params the layer actually carries, and every edit writes THAT layer
// (set_adjustment_params) instead of stacking a new one. The slider-shaped
// adjustments render inline from the same ADJ_SPECS table the `al*` dialogs use;
// the five with a custom editor (a curve canvas, a gradient bar, …) re-open
// their dialog in edit mode — `useScratchAdjustmentLayer` takes the existing
// layer id, so that dialog edits the layer instead of creating one.
// The Shape section (#450): a shape layer stays re-editable forever, so its
// fill, stroke, W/H/X/Y and FOUR corner radii are fields here — Photoshop's live
// shape properties. Each edit patches the layer's scene and commits once.
const SHAPE_ROW: React.CSSProperties = { gap: 6, alignItems: "center", marginBottom: 6 };
const SHAPE_LBL: React.CSSProperties = { width: 30, fontSize: 11, flex: "0 0 auto" };
const SHAPE_CORNERS = [["TL", "top left"], ["TR", "top right"], ["BR", "bottom right"], ["BL", "bottom left"]] as const;
const shapeOptions = (values: readonly string[]) => values.map((v) => ({ value: v, label: titleCase(v) }));
const BLACK: RGBA = [0, 0, 0, 255];
/** Scene coordinates are floats; two decimals is what a field can show. */
const px2 = (v: number) => Math.round(v * 100) / 100;

export function PropertiesPanel() {
  const { open } = useDialogs();
  const layers = useStore((s) => s.layers);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const selectedPath = useStore((s) => s.selectedPaths[0]);
  const layer = layers.find((l) => l.id === activeLayerId);
  // The Shape section (#450) reads the layer's whole scene as JSON for one
  // component's fields, so it is memoised on the layer row — minted afresh by
  // every engine sync, so an undo / MCP edit / canvas drag still shows up — and
  // on the component Path Selection picked, rather than paid on every render.
  const shape = useMemo(
    () => (layer?.kind === LAYER_KIND.vector ? store.shapeProps() : null),
    [layer, selectedPath], // eslint-disable-line react-hooks/exhaustive-deps -- selectedPath is read inside store.shapeProps()
  );
  if (!layer) return <div style={PANEL_HINT}>No layer selected. Pick a layer to edit its properties.</div>;
  // Density/Feather live in the engine (they never rewrite the mask bytes), so
  // read them per render like Blending Options does instead of caching a copy.
  const density = layer.hasMask ? store.layerMaskDensity(layer.id) : 100;
  const feather = layer.hasMask ? store.layerMaskFeather(layer.id) : 0;
  const isAdjustment = layer.kind === LAYER_KIND.adjustment;
  // Same discipline as the mask rows: read per render off the engine, so an
  // undo / MCP / dialog edit of the same layer shows up without a cached copy
  // to invalidate.
  const adjKind = isAdjustment ? engine.e.layer_adj_kind(layer.id) : -1;
  const adjParams = isAdjustment ? Array.from(store.adjParams(layer.id)) : [];
  const adjSpec = ADJ_SPEC_BY_KIND.get(adjKind);
  const adjEditor = ADJ_EDITOR_DIALOGS[adjKind];
  // A layer saved before a control existed carries fewer params than the spec
  // declares; pad with 0, which is what the engine reads for a missing slot.
  const adjValues = adjSpec
    ? adjSpec.upgrade?.(adjParams) ?? Array.from({ length: Math.max(adjSpec.defaults.length, adjParams.length) }, (_, i) => (i < adjParams.length ? adjParams[i] : 0))
    : adjParams;
  const setAdjValue = (idx: number, v: number) => {
    const next = adjValues.slice();
    next[idx] = v;
    store.setAdjustmentParams(layer.id, new Float32Array(next));
  };
  return (
    <div data-mv-properties={layer.id} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        {layer.thumb && <img src={layer.thumb} alt="" style={{ width: 28, height: 28, objectFit: "contain", background: "var(--surface-2, rgba(255,255,255,0.05))", borderRadius: 3, flex: "0 0 auto" }} />}
        <div style={{ flex: 1, minWidth: 0 }}>
          {/* Keyed by the name too: an uncontrolled input never picks up a rename
              made in the Layers panel / MCP / undo, and blurring the stale field
              would commit the OLD name back. (#103) */}
          <input
            key={`${layer.id}:${layer.name}`} defaultValue={layer.name} aria-label="Layer name"
            onBlur={(e) => { const v = e.currentTarget.value.trim(); if (v && v !== layer.name) store.renameLayer(layer.id, v); }}
            onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
            style={{ width: "100%", boxSizing: "border-box", height: 22, fontSize: 11, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }} />
          <span style={{ fontSize: 10, color: "var(--text-3)" }}>{LAYER_KIND_LABELS[layer.kind] ?? "Layer"}</span>
        </div>
      </div>
      {isAdjustment && (
        <div data-mv-adj-properties={adjKind} style={{ borderTop: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6 }}>{adjSpec?.label ?? adjEditor?.label ?? "Adjustment"}</div>
          {adjSpec && adjKind === ADJ_SPECS.alHueSat.kind ? (
            <HueSaturationControls state={unpackHueSaturation(adjValues)}
              onChange={(state) => store.setAdjustmentParams(layer.id, packHueSaturation(state))}
              onChangeEnd={() => engine.e.end_prop_edit()} />
          ) : adjSpec?.controls.map((c) => (c.toggle ? (
            <div key={c.idx + c.label} style={{ padding: "2px 0 6px" }}>
              <Checkbox checked={adjValues[c.idx] > 0.5} aria-label={c.label}
                onChange={(v) => setAdjValue(c.idx, v ? 1 : 0)}>{c.label}</Checkbox>
            </div>
          ) : (
            <SliderRow key={c.idx + c.label} label={c.label} labelWidth={64} value={adjValues[c.idx]}
              min={c.min} max={c.max} format={c.format}
              onChange={(v) => setAdjValue(c.idx, v)}
              // The engine coalesces a drag into one "Adjustment Settings" step;
              // releasing closes the chain so the next drag is its own undo.
              onChangeEnd={() => engine.e.end_prop_edit()} />
          )))}
          {adjEditor && (
            <Button size="sm" variant="ghost"
              onClick={() => open(adjEditor.name, { layerId: layer.id, layerKind: LAYER_KIND.adjustment, subtype: adjKind, params: adjParams })}>
              Edit {adjEditor.label}…
            </Button>
          )}
          {!adjSpec && !adjEditor && <div style={{ ...PANEL_HINT, padding: 0 }}>This adjustment has no settings.</div>}
        </div>
      )}
      {shape && (
        <div data-mv-shape-properties={shape.id} style={{ borderTop: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", paddingTop: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6 }}>Shape · {titleCase(shape.kind)}</div>
          <div className="monet-row" style={SHAPE_ROW}>
            <span className="lbl" style={SHAPE_LBL}>Fill</span>
            <input type="color" aria-label="Shape fill" value={rgbaHex(shape.fill ?? BLACK)}
              onChange={(e) => store.setShapeProps({ fill: hexRgba(e.target.value, shape.fill?.[3] ?? 255) })} />
            <span className="lbl" style={SHAPE_LBL}>Stroke</span>
            <input type="color" aria-label="Shape stroke color" value={rgbaHex(shape.stroke.color ?? BLACK)}
              onChange={(e) => store.setShapeProps({ stroke: { color: hexRgba(e.target.value, shape.stroke.color?.[3] ?? 255) } })} />
          </div>
          <div className="monet-row" style={SHAPE_ROW}>
            <NumberField value={px2(shape.stroke.width)} min={0} max={1000} step={0.5} suffix="px" aria-label="Stroke width"
              onChange={(v) => store.setShapeProps({ stroke: { width: v } })} />
            <Select size="sm" aria-label="Stroke align" options={shapeOptions(STROKE_ALIGNS)} value={shape.stroke.align}
              onChange={(v) => store.setShapeProps({ stroke: { align: v as StrokeAlign } })} />
          </div>
          <div className="monet-row" style={SHAPE_ROW}>
            <Select size="sm" aria-label="Stroke cap" options={shapeOptions(STROKE_CAPS)} value={shape.stroke.cap}
              onChange={(v) => store.setShapeProps({ stroke: { cap: v as StrokeCap } })} />
            <Select size="sm" aria-label="Stroke join" options={shapeOptions(STROKE_JOINS)} value={shape.stroke.join}
              onChange={(v) => store.setShapeProps({ stroke: { join: v as StrokeJoin } })} />
          </div>
          <div className="monet-row" style={SHAPE_ROW}>
            <span className="lbl" style={SHAPE_LBL}>Dash</span>
            {/* Free text ("6, 3"), committed on blur — an uncontrolled field
                would otherwise re-commit a stale pattern after an undo. */}
            <input key={`${shape.id}:${formatDash(shape.stroke.dash)}`} defaultValue={formatDash(shape.stroke.dash)}
              aria-label="Stroke dash" placeholder="solid" style={INSERT_FIELD}
              onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
              onBlur={(e) => store.setShapeProps({ stroke: { dash: parseDash(e.currentTarget.value) } })} />
          </div>
          {/* W/H of a rotated/scaled component are its canvas box, read-only:
              no one local size resizes it to a given box. X/Y still move it. */}
          <div className="monet-row" style={SHAPE_ROW} title={shape.transformed ? "Rotated or scaled shape: size is read-only" : undefined}>
            <span className="lbl" style={SHAPE_LBL}>W</span>
            <NumberField value={px2(shape.w)} min={0} max={100000} suffix="px" aria-label="Shape width" disabled={shape.transformed}
              onChange={(v) => store.setShapeProps({ w: v })} />
            <span className="lbl" style={SHAPE_LBL}>H</span>
            <NumberField value={px2(shape.h)} min={0} max={100000} suffix="px" aria-label="Shape height" disabled={shape.transformed}
              onChange={(v) => store.setShapeProps({ h: v })} />
          </div>
          <div className="monet-row" style={SHAPE_ROW}>
            <span className="lbl" style={SHAPE_LBL}>X</span>
            <NumberField value={px2(shape.x)} min={-100000} max={100000} suffix="px" aria-label="Shape X"
              onChange={(v) => store.setShapeProps({ x: v })} />
            <span className="lbl" style={SHAPE_LBL}>Y</span>
            <NumberField value={px2(shape.y)} min={-100000} max={100000} suffix="px" aria-label="Shape Y"
              onChange={(v) => store.setShapeProps({ y: v })} />
          </div>
          {shape.radii && (
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 4 }}>
              {SHAPE_CORNERS.map(([short, name], i) => (
                <div key={name} className="monet-row" style={{ ...SHAPE_ROW, marginBottom: 0 }}>
                  <span className="lbl" style={SHAPE_LBL}>{short}</span>
                  <NumberField value={px2(shape.radii![i])} min={0} max={100000} suffix="px"
                    aria-label={`Corner radius ${name}`}
                    // Four INDEPENDENT radii: only this corner changes.
                    onChange={(v) => store.setShapeProps({
                      radii: shape.radii!.map((r, j) => (j === i ? v : r)) as [number, number, number, number],
                    })} />
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      <div style={{ borderTop: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", paddingTop: 8 }}>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6 }}>Masks</div>
        {layer.hasMask ? (
          <>
            <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span className="lbl" style={{ width: 60, fontSize: 11 }}>Density</span>
              <NumberField value={density} min={0} max={100} suffix="%" aria-label="Mask density"
                onChange={(v) => store.setLayerMaskDensity(layer.id, v)} />
            </div>
            <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
              <span className="lbl" style={{ width: 60, fontSize: 11 }}>Feather</span>
              <NumberField value={feather} min={0} max={1000} step={0.1} suffix="px" aria-label="Mask feather"
                onChange={(v) => store.setLayerMaskFeather(layer.id, v)} />
            </div>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              <Button size="sm" variant="ghost" onClick={() => open("selectandmask")}>Select and Mask…</Button>
              <Button size="sm" variant="ghost" onClick={() => store.toggleLayerMaskEnabled(layer.id)}>
                {layer.maskEnabled === false ? "Enable" : "Disable"}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => store.applyLayerMask(layer.id)}>Apply</Button>
              <Button size="sm" variant="ghost" onClick={() => store.deleteLayerMask(layer.id)}>Delete</Button>
            </div>
          </>
        ) : (
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            <span style={{ ...PANEL_HINT, flex: 1, padding: 0 }}>No mask on this layer.</span>
            <Button size="sm" variant="ghost" onClick={() => store.addLayerMask(layer.id)}>Add Mask</Button>
          </div>
        )}
      </div>
    </div>
  );
}

// Photoshop's Measurement Log — a panel, so a measuring pass can record row
// after row with the canvas still visible. Image ▸ Analysis ▸ Record
// Measurements opens it here instead of over the document.
export function MeasurementLogPanel() {
  const rows = useStore((s) => s.measurements);
  const dataPoints = useStore((s) => s.dataPoints);
  const unit = useStore((s) => s.measureScale.unit);
  // Photoshop's Export writes the log as tab-delimited text. It honours the same
  // Select Data Points columns the table renders — exporting hidden columns would
  // not match what the user is looking at.
  const exportLog = () => {
    const text = measurementLogText(rows, dataPoints, unit);
    if (!text) return;
    saveBytes("measurements.txt", new TextEncoder().encode(text), "text/plain");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>{rows.length} recorded</span>
        <Button size="sm" variant="ghost" data-mv-measure-export disabled={!rows.length}
          onClick={exportLog} title="Write the log to a tab-delimited .txt file">Export</Button>
        <Button size="sm" variant="ghost" disabled={!rows.length} onClick={() => store.clearMeasurements()}>Clear</Button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        <MeasurementRows />
      </div>
    </div>
  );
}

// Photoshop's Actions panel — its own dock panel, not a strip inside History.
// The step tree is the reason: nested under History it had a 180px window, so a
// ten-step action scrolled inside a scroller inside a panel.
const CONDITION_OPTIONS = ACTION_CONDITIONS.map((c) => ({ value: c, label: stepLabel(c) }));
const PLAYBACK_OPTIONS = PLAYBACK_MODES.map((m) => ({ value: m, label: stepLabel(m) }));
const INSERT_FIELD: React.CSSProperties = {
  flex: 1, minWidth: 0, height: 18, fontSize: 10, padding: "0 4px", borderRadius: 4,
  border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))",
  background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)",
};

export function ActionsPanel() {
  useStore((s) => s.actionVersion); // rerender when the module-level action registry changes
  const recording = actions.isRecording();
  const [actionQuery, setActionQuery] = useState("");
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [actionMsg, setActionMsg] = useState("");
  const [expandedActionId, setExpandedActionId] = useState<number | null>(null);
  // One draft pair for the whole panel — only one action expands at a time.
  const [menuItemDraft, setMenuItemDraft] = useState("");
  const [ifDraft, setIfDraft] = useState<{ condition: string; then: string; else: string }>(
    { condition: CONDITION_OPTIONS[0].value, then: "", else: "" });
  const [collapsedSets, setCollapsedSets] = useState<ReadonlySet<string>>(new Set());
  const filteredActions = actions.filter(actionQuery, favoritesOnly);
  // Group into sets (Photoshop's folder level), preserving list order.
  const actionSets = new Map<string, typeof filteredActions>();
  for (const a of filteredActions) {
    const rows = actionSets.get(a.set);
    if (rows) rows.push(a); else actionSets.set(a.set, [a]);
  }
  const toggleSetCollapsed = (name: string) => setCollapsedSets((prev) => {
    const next = new Set(prev);
    if (next.has(name)) next.delete(name); else next.add(name);
    return next;
  });
  const anyPersistable = actions.list().some((a) => actions.isPersistable(a.id));
  // A conditional branches by NAME, so the picker offers the saved names.
  const branchOptions = [{ value: "", label: "(nothing)" }, ...actions.list().map((a) => ({ value: a.name, label: a.name }))];
  const exportActions = () => saveBytes("actions.mvactions", new TextEncoder().encode(actions.exportJson()), "application/json");
  // Photoshop's Save Actions writes the SELECTED set, so this writes what the
  // panel is showing — narrow it with the search box to pick one set.
  const exportAtn = () => {
    const shown = filteredActions.filter((a) => actions.isPersistable(a.id));
    if (!shown.length) { setActionMsg("Nothing to save: the actions shown have no replayable steps"); return; }
    const set = shown[0].set;
    saveBytes(`${set}.atn`, actions.exportAtn(shown.map((a) => a.id), set), "application/octet-stream");
  };
  const importActions = async () => {
    const { imported, rejected } = await importActionsFile();
    setActionMsg(rejected.length
      ? `Imported ${imported} · rejected ${rejected.length}: ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}`
      : imported ? `Imported ${imported} action${imported === 1 ? "" : "s"}` : "");
  };
  // Adobe packs route through the same importJson funnel, so allowlist
  // validation, duplicate renaming and persistence are unchanged.
  const importAtn = async () => {
    const { imported, rejected, setName, error } = await importActionsFile();
    const parts: string[] = [];
    if (imported) parts.push(`Imported ${imported} action${imported === 1 ? "" : "s"}${setName ? ` from "${setName}"` : ""}`);
    if (rejected.length) parts.push(`rejected ${rejected.length}: ${rejected.map((r) => `${r.name} (${r.reason})`).join(", ")}`);
    if (error) parts.push(`stopped early: ${error}`);
    setActionMsg(parts.join(" · "));
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" variant={recording ? "danger" : "ghost"} onClick={() => (recording ? actions.stop() : actions.start())} title="Record an action macro">
          {recording ? `● ${actions.count()}` : "Rec"}
        </Button>
        <Button size="sm" variant="ghost" onClick={() => actions.play()} title="Replay recorded actions">Play</Button>
        <Button size="sm" variant={actions.allowToolRecording() ? "primary" : "ghost"} data-mv-action-tool-recording
          aria-pressed={actions.allowToolRecording()}
          onClick={() => actions.setAllowToolRecording(!actions.allowToolRecording())}
          title="Allow Tool Recording — capture brush, eraser, lasso and marquee gestures as steps">Tool</Button>
        <span data-mv-action-playback title="Playback Options — Accelerated runs straight through; Step By Step confirms every step">
          <Select size="sm" aria-label="Playback options" options={PLAYBACK_OPTIONS}
            value={actions.playbackMode()} onChange={(v) => actions.setPlaybackMode(v as PlaybackMode)} />
        </span>
        {panelMenu("Actions", [
          { id: "actions-playback-options", label: "Playback Options", items: PLAYBACK_OPTIONS.map((option) => ({
            id: `playback-${option.value}`, label: option.label, checked: actions.playbackMode() === option.value,
            action: () => actions.setPlaybackMode(option.value as PlaybackMode),
          })) },
          { id: "actions-load", label: "Load Actions…", action: () => { void importActions(); } },
          { id: "actions-save", label: "Save Actions…", disabled: !anyPersistable, action: exportAtn },
        ])}
        <Button size="sm" variant="ghost" disabled={recording || actions.count() === 0} onClick={() => actions.save()} title="Save the recorded action">Save</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" data-mv-action-export disabled={!anyPersistable} onClick={exportActions} title="Export saved actions to a .mvactions file (volatile actions are excluded)">Export</Button>
        <Button size="sm" variant="ghost" data-mv-action-export-atn disabled={!anyPersistable} onClick={exportAtn}
          title="Save the actions shown as one Adobe .atn set. Steps Photoshop has no command for are written as Stops naming them.">Save .atn</Button>
        <Button size="sm" variant="ghost" data-mv-action-import onClick={() => void importActions()} title="Import actions from a .mvactions file">Import</Button>
        <Button size="sm" variant="ghost" data-mv-action-import-atn onClick={() => void importAtn()} title="Load an Adobe .atn action pack. Steps Vision cannot replay import as Stops naming the Photoshop command.">.atn</Button>
      </div>
      {actionMsg && <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 6, wordBreak: "break-word" }}>{actionMsg}</div>}
      <div style={{ display: "flex", gap: 6, alignItems: "center", marginBottom: 6 }}>
        <input
          value={actionQuery}
          onChange={(e) => setActionQuery(e.currentTarget.value)}
          placeholder="Search actions"
          aria-label="Search actions"
          style={{ flex: 1, minWidth: 0, height: 22, fontSize: 11, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }}
        />
        <button
          aria-label="Favorite actions only"
          title="Favorite actions only"
          onClick={() => setFavoritesOnly((v) => !v)}
          style={{ width: 24, height: 22, borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: favoritesOnly ? ACCENT : "var(--surface-2, rgba(255,255,255,0.05))", color: favoritesOnly ? "#000" : "var(--text-2)", cursor: "pointer", padding: 0 }}>
          ★
        </button>
      </div>
      {/* The step tree gets the whole panel now, so an expanded action is read
          in place instead of through a 180px porthole. */}
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", display: "flex", flexDirection: "column", gap: 2 }}>
        {filteredActions.length === 0
          ? <div style={{ color: "var(--text-3)", fontSize: 11, padding: "2px 4px" }}>No saved actions</div>
          : [...actionSets.entries()].map(([setName, rows]) => (
            <div key={setName} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              <button data-mv-action-set={setName} aria-label={`Toggle set ${setName}`} aria-expanded={!collapsedSets.has(setName)}
                onClick={() => toggleSetCollapsed(setName)}
                style={{ display: "flex", alignItems: "center", gap: 4, height: 20, padding: "0 4px", border: "none", borderRadius: 4, background: "transparent", color: "var(--text-3)", cursor: "pointer", fontSize: 10, textAlign: "left" }}>
                <span style={{ width: 10 }}>{collapsedSets.has(setName) ? "▸" : "▾"}</span>
                <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{setName}</span>
                <span>{rows.length}</span>
              </button>
              {!collapsedSets.has(setName) && rows.map((a) => {
                const volatile = !actions.isPersistable(a.id);
                const expanded = expandedActionId === a.id;
                const steps = expanded ? actions.getSteps(a.id) : [];
                return (
                <div key={a.id} style={{ display: "flex", flexDirection: "column", gap: 1 }}>
                  <div data-mv-action-row={a.id} data-mv-action-volatile={volatile ? "1" : undefined}
                    style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 24, padding: "0 4px", borderRadius: 4, background: "var(--glass-0)" }}>
                    <button aria-label="Show action steps" title="Show action steps" aria-expanded={expanded}
                      onClick={() => setExpandedActionId(expanded ? null : a.id)}
                      style={{ width: 16, height: 20, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 0 }}>{expanded ? "▾" : "▸"}</button>
                    <button aria-label={a.favorite ? "Unfavorite action" : "Favorite action"} title={a.favorite ? "Unfavorite action" : "Favorite action"}
                      onClick={() => actions.toggleFavorite(a.id)}
                      style={{ width: 20, height: 20, border: "none", background: "transparent", color: a.favorite ? ACCENT : "var(--text-3)", cursor: "pointer", padding: 0 }}>★</button>
                    {volatile && <span title="contains non-scriptable steps — not saved across restarts" style={{ width: 5, height: 5, borderRadius: "50%", background: "var(--warn, #e0a020)", flexShrink: 0 }} />}
                    <input key={`${a.id}:${a.name}`} defaultValue={a.name} aria-label="Action name" data-mv-action-name={a.id}
                      title={volatile ? "contains non-scriptable steps — not saved across restarts" : a.name}
                      onBlur={(e) => {
                        const next = e.currentTarget.value.trim();
                        if (next && next !== a.name) actions.rename(a.id, next);
                        else e.currentTarget.value = a.name;
                      }}
                      onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                      style={{ flex: 1, minWidth: 0, height: 18, fontSize: 11, padding: "0 4px", borderRadius: 4, border: "1px solid transparent", background: "transparent", color: "var(--text-1)" }} />
                    <span style={{ color: "var(--text-3)", fontSize: 10, width: 34, textAlign: "right" }}>{a.stepCount} st</span>
                    <Button size="sm" variant="ghost" onClick={() => actions.playNamed(a.id)}>Play</Button>
                    <button aria-label="Delete action" title="Delete action" onClick={() => actions.delete(a.id)}
                      style={{ width: 20, height: 20, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 0 }}>×</button>
                  </div>
                  {expanded && (
                    <div style={{ display: "flex", flexDirection: "column", gap: 1, margin: "0 0 2px 20px" }}>
                      <label style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-3)" }}>
                        Set
                        {/* key re-syncs the draft after a commit renames the group */}
                        <input key={a.set} defaultValue={a.set} aria-label="Action set" data-mv-action-set-input
                          onBlur={(e) => { if (e.currentTarget.value.trim() !== a.set) actions.setActionSet(a.id, e.currentTarget.value); }}
                          onKeyDown={(e) => { if (e.key === "Enter") e.currentTarget.blur(); }}
                          style={{ flex: 1, minWidth: 0, height: 18, fontSize: 10, padding: "0 4px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }} />
                        <Button size="sm" variant="ghost" data-mv-action-insert-stop title="Append a Stop step that pauses playback with a message"
                          onClick={() => {
                            void (async () => {
                              const authored = await authorActionStop();
                              if (!authored) return;
                              const { message, allowContinue } = authored;
                              actions.insertStop(a.id, message, allowContinue);
                            })();
                          }}>＋ Stop</Button>
                      </label>
                      {/* Insert Menu Item / Insert Conditional: steps for commands that
                          were never recorded, and a branch into another action. */}
                      <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                        <Autocomplete value={menuItemDraft} placeholder="Command to insert"
                          aria-label="Menu item command" data-mv-action-menu-item style={INSERT_FIELD}
                          suggestions={actions.menuItemPaths().map((path) => ({ value: path, label: stepLabel(path) }))}
                          onChange={setMenuItemDraft} />
                        <Button size="sm" variant="ghost" data-mv-action-insert-menu-item disabled={!menuItemDraft.trim()}
                          title="Insert Menu Item: append a command that was never recorded"
                          onClick={() => {
                            const path = menuItemDraft.trim();
                            if (actions.insertMenuItem(a.id, path)) { setMenuItemDraft(""); setActionMsg(""); }
                            else setActionMsg(`Not a recordable command: ${path}`);
                          }}>＋ Item</Button>
                      </div>
                      <div style={{ display: "flex", alignItems: "center", gap: 4, flexWrap: "wrap", fontSize: 10, color: "var(--text-3)" }}>
                        If
                        <Select size="sm" aria-label="Condition" options={CONDITION_OPTIONS} value={ifDraft.condition}
                          onChange={(v) => setIfDraft({ ...ifDraft, condition: v })} />
                        play
                        <Select size="sm" aria-label="Then action" options={branchOptions} value={ifDraft.then}
                          onChange={(v) => setIfDraft({ ...ifDraft, then: v })} />
                        else
                        <Select size="sm" aria-label="Else action" options={branchOptions} value={ifDraft.else}
                          onChange={(v) => setIfDraft({ ...ifDraft, else: v })} />
                        <Button size="sm" variant="ghost" data-mv-action-insert-conditional
                          disabled={!ifDraft.then && !ifDraft.else}
                          title="Insert Conditional: branch into another action when the test passes"
                          onClick={() => {
                            if (actions.insertConditional(a.id, ifDraft.condition, ifDraft.then, ifDraft.else)) setActionMsg("");
                            else setActionMsg(`Unknown condition: ${ifDraft.condition}`);
                          }}>＋ If</Button>
                      </div>
                      {steps.map((s) => (
                        <div key={s.index} data-mv-action-step={s.index}
                          style={{ display: "flex", alignItems: "center", gap: 4, minHeight: 20, padding: "0 4px", borderRadius: 4 }}>
                          <input type="checkbox" aria-label="Toggle step" title={s.enabled ? "Disable step" : "Enable step"} checked={s.enabled}
                            onChange={(e) => actions.setStepEnabled(a.id, s.index, e.currentTarget.checked)} style={{ margin: 0 }} />
                          <button aria-label="Toggle modal dialog" aria-pressed={s.dialog} data-mv-action-step-dialog={s.dialog ? "1" : undefined}
                            title={s.dialog ? "Pauses to confirm on playback — click to run silently" : "Runs silently — click to pause and confirm on playback"}
                            onClick={() => actions.setStepDialog(a.id, s.index, !s.dialog)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", color: s.dialog ? ACCENT : "var(--text-4, #555)", cursor: "pointer", padding: 0, fontSize: 9 }}>▣</button>
                          <span title={s.volatile ? "non-scriptable step — replays this session only" : `${s.label} ${s.args}`}
                            style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", fontSize: 10, opacity: s.enabled ? 1 : 0.5, color: s.volatile ? "var(--warn, #e0a020)" : "var(--text-2)" }}>{s.label}</span>
                          <button aria-label="Play from this step" title="Play from here" onClick={() => actions.playNamed(a.id, s.index)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 0, fontSize: 9 }}>▶</button>
                          <button aria-label="Move step up" title="Move step up" disabled={s.index === 0} onClick={() => actions.moveStep(a.id, s.index, s.index - 1)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", color: s.index === 0 ? "var(--text-4, #555)" : "var(--text-3)", cursor: s.index === 0 ? "default" : "pointer", padding: 0, fontSize: 9 }}>↑</button>
                          <button aria-label="Move step down" title="Move step down" disabled={s.index === steps.length - 1} onClick={() => actions.moveStep(a.id, s.index, s.index + 1)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", color: s.index === steps.length - 1 ? "var(--text-4, #555)" : "var(--text-3)", cursor: s.index === steps.length - 1 ? "default" : "pointer", padding: 0, fontSize: 9 }}>↓</button>
                          <button aria-label="Delete step" title="Delete step" onClick={() => actions.deleteStep(a.id, s.index)}
                            style={{ width: 18, height: 18, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 0 }}>×</button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
                );
              })}
            </div>
          ))}
      </div>
    </div>
  );
}

export function HistoryPanel() {
  const history = useStore((s) => s.history);
  const historyIndex = useStore((s) => s.historyIndex);
  const canUndo = useStore((s) => s.canUndo);
  const canRedo = useStore((s) => s.canRedo);
  const historyStates = useStore((s) => s.historyStates);
  const historyOptions = useStore((s) => s.historyOptions);
  const snapshots = useStore((s) => s.snapshots);
  // History panel flyout. Photoshop's "Allow Non-Linear History" is deliberately
  // absent — keeping the redo branch alive across a new edit is an engine
  // undo-model change, not something this panel can honestly offer.
  // ponytail: only snapshots carry thumbnails, as in Photoshop (a state row is an
  // icon + label there too). Per-state previews would mean seeking and
  // compositing the whole document once per row; needs an engine-side
  // state-thumbnail cache before it is affordable.
  const newSnapshot = () => {
    if (!historyOptions.showNewSnapshotDialog) { store.takeSnapshot(); return; }
    const name = typeof prompt === "function" ? prompt("Snapshot name:", "") : null;
    if (name === null) return; // cancelled
    store.takeSnapshot(name);
  };
  const historyOption = (key: keyof HistoryOptions, label: string): MenuItemDef => ({
    id: `hist-opt-${key}`,
    label,
    checked: historyOptions[key],
    action: () => store.setHistoryOptions({ [key]: !historyOptions[key] }),
  });
  const historyMenu: MenuItemDef[] = [
    { id: "hist-new-doc", label: "New Document", action: () => store.newDocumentFromHistory() },
    { id: "hist-delete", label: "Delete", disabled: historyIndex === 0, action: () => store.deleteHistoryFrom(historyIndex) },
    { id: "hist-sep-1", separator: true },
    { id: "hist-new-snapshot", label: "New Snapshot…", action: newSnapshot },
    { id: "hist-sep-2", separator: true },
    {
      id: "hist-options",
      label: "History Options…",
      items: [
        historyOption("autoFirstSnapshot", "Automatically Create First Snapshot"),
        historyOption("autoSnapshotOnSave", "Automatically Create New Snapshot When Saving"),
        historyOption("showNewSnapshotDialog", "Show New Snapshot Dialog by Default"),
        historyOption("layerVisibilityUndoable", "Make Layer Visibility Changes Undoable"),
      ],
    },
  ];
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <Button size="sm" variant="ghost" disabled={!canUndo} onClick={() => store.undo()}>Undo</Button>
        <Button size="sm" variant="ghost" disabled={!canRedo} onClick={() => store.redo()}>Redo</Button>
        <Button size="sm" variant="ghost" id="mv-history-set-source" onClick={() => store.setHistorySource()} title="Set the History Brush / Fill ▸ History source to the current state. Seek to any state first, then seek back — the snapshot persists.">Set Source</Button>
        <span style={{ flex: 1 }} />
        <label title="History States (1–1000)" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 10, color: "var(--text-3)" }}>
          States
          <input
            type="number" min={HISTORY_STATES_MIN} max={HISTORY_STATES_MAX} value={historyStates}
            aria-label="History States"
            onChange={(e) => store.setHistoryStates(Number(e.currentTarget.value))}
            style={{ width: 46, height: 22, fontSize: 11, padding: "0 4px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)" }}
          />
        </label>
        <Menu items={historyMenu} align="end">
          {({ ref, toggle, open: _open, id, ...aria }) => (
            <button
              ref={ref as React.Ref<HTMLButtonElement>}
              {...aria}
              type="button"
              id={id}
              data-mv-history-flyout
              aria-label="History panel menu"
              title="History panel menu"
              onClick={toggle}
              style={{ width: 22, height: 22, borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-2)", cursor: "pointer", padding: 0, fontSize: 11 }}
            >
              ☰
            </button>
          )}
        </Menu>
      </div>
      {/* History Snapshots — named full-document checkpoints (per document). */}
      <div style={{ borderBottom: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", paddingBottom: 6, marginBottom: 6 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: snapshots.length ? 6 : 0 }}>
          <span style={{ fontSize: 10, color: "var(--text-3)", flex: 1 }}>Snapshots</span>
          <Button size="sm" variant="ghost" id="mv-snapshot-new" onClick={newSnapshot} title="Capture the whole document as a named checkpoint you can return to">＋ Snapshot</Button>
        </div>
        {snapshots.map((s) => (
          <div key={s.id} data-mv-snapshot-row={s.id} className="monet-layer"
            style={{ height: 24, padding: "0 8px", gap: 6, cursor: "pointer", alignItems: "center", display: "flex" }}
            title="Restore the document to this snapshot"
            onClick={() => store.restoreSnapshot(s.id)}>
            {/* Photoshop's snapshot thumbnail, captured when the snapshot was
                taken; the camera glyph stands in when there is no preview. */}
            {s.thumb
              ? <img src={s.thumb} alt="" data-mv-snapshot-thumb={s.id} style={{ width: SNAPSHOT_THUMB_W, height: SNAPSHOT_THUMB_H, objectFit: "contain", flex: "0 0 auto", background: "var(--surface-2, rgba(255,255,255,0.05))", borderRadius: 2 }} />
              : <span style={{ width: SNAPSHOT_THUMB_W, textAlign: "center", fontSize: 11, flex: "0 0 auto" }}>📷</span>}
            <span className="name" style={{ fontSize: 10, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</span>
            <span className="monet-iconbtn" title="Delete snapshot" onClick={(e) => { e.stopPropagation(); store.deleteSnapshot(s.id); }} style={{ fontSize: 11, cursor: "pointer" }}>✕</span>
          </div>
        ))}
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        {/* An "Open" (initial) row, then one row per timeline op. Click any row to
            revert/advance the document to that state; the active state is highlighted. */}
        {[{ applied: 0, label: "Open" }, ...history.map((h, i) => ({ applied: i + 1, label: h }))].map((row) => (
          <div key={row.applied} data-mv-history-row={row.applied}
            className={`monet-layer ${row.applied === historyIndex ? "is-selected" : ""}`}
            style={{ height: 24, padding: "0 8px", gap: 6, cursor: "pointer", opacity: row.applied > historyIndex ? 0.55 : 1 }}
            title="Revert the document to this state"
            onClick={() => store.seekHistory(row.applied)}>
            <span style={{ width: 5, height: 5, borderRadius: "50%", background: row.applied === historyIndex ? ACCENT : "var(--text-3)" }} />
            <span className="name" style={{ fontSize: 10, flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{row.label}</span>
            {/* Photoshop's per-state Delete: drops this state and every one after it. */}
            {row.applied > 0 && (
              <button
                type="button"
                data-mv-history-delete={row.applied}
                aria-label={`Delete ${row.label} and later states`}
                title="Delete this state and every state after it"
                onClick={(e) => { e.stopPropagation(); store.deleteHistoryFrom(row.applied); }}
                style={{ flex: "0 0 auto", width: 16, height: 16, border: "none", background: "transparent", color: "var(--text-3)", cursor: "pointer", padding: 0, fontSize: 10 }}
              >
                ✕
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

let currentWorkPathTolerance = 2;
// Photoshop's Make Selection dialog remembers its settings for the session; the
// plain (no-dialog) button click replays them, like ⌘-clicking a path thumbnail.
let currentMakeSelection = { mode: 0, feather: 0, antialias: true };
const MAKE_SELECTION_OPS = [
  { value: "0", label: "New Selection" },
  { value: "1", label: "Add to Selection" },
  { value: "2", label: "Subtract from Selection" },
  { value: "3", label: "Intersect with Selection" },
];
// Stroke Path ▸ Tool: Photoshop's painting tools, in its dialog order. Each is a
// live ToolId, so the store strokes with exactly the tool's own brush config.
const STROKE_PATH_TOOLS: { value: ToolId; label: string }[] = [
  { value: "pencil", label: "Pencil" },
  { value: "brush", label: "Brush" },
  { value: "erase", label: "Eraser" },
  { value: "backgrounderaser", label: "Background Eraser" },
  { value: "clone", label: "Clone Stamp" },
  { value: "patternstamp", label: "Pattern Stamp" },
  { value: "historybrush", label: "History Brush" },
  { value: "smudge", label: "Smudge" },
  { value: "blur", label: "Blur" },
  { value: "sharpen", label: "Sharpen" },
  { value: "sponge", label: "Sponge" },
  { value: "dodge", label: "Dodge" },
  { value: "burn", label: "Burn" },
];
// Every per-layer mode: only group-only Pass Through is dropped. A slice(0, 25)
// also cut Darker/Lighter Color, which Photoshop's Fill dialog offers and the
// engine already supports. (#105)
const FILL_BLEND_OPTIONS = BLEND_ORDER.filter((k) => k !== "pass-through").map((k) => ({ value: k, label: titleCase(k) }));
// Both path-op dialogs remember their settings for the session (like Make
// Selection above): a plain button click replays them, Option/Alt-click reopens.
let currentStrokePath = { tool: "brush" as ToolId, simulatePressure: false };
let currentFillPath = { contents: "fg" as FillContent, color: "#000000", mode: "normal", opacity: 1, preserve: false, feather: 0, antialias: true };

export function PathsPanel() {
  const penPath = useStore((s) => s.penPath);
  const savedPaths = useStore((s) => s.savedPaths);
  const selectionActive = useStore((s) => s.selectionActive);
  // View ▸ Show ▸ Target Path also gates the canvas outline, so the Paths panel
  // owns the toggle too — a made work path is otherwise only visible-by-luck.
  const showTargetPath = useStore((s) => s.showTargetPath);
  // Photoshop lists the active shape layer's own outline as "<layer> Shape Path".
  const layers = useStore((s) => s.layers);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const shapeLayer = layers.find((l) => l.id === activeLayerId && l.kind === LAYER_KIND.vector);
  const [workPathTolerance, setWorkPathTolerance] = useState(currentWorkPathTolerance);
  const [draftTolerance, setDraftTolerance] = useState(currentWorkPathTolerance);
  const [toleranceOpen, setToleranceOpen] = useState(false);
  const toleranceInput = useRef<HTMLInputElement>(null);
  const workActive = hasPath(penPath);
  useEffect(() => { if (toleranceOpen) toleranceInput.current?.focus(); }, [toleranceOpen]);
  const openTolerance = () => {
    setDraftTolerance(workPathTolerance);
    setToleranceOpen(true);
  };
  const makeWorkPath = (tolerance: number) => {
    currentWorkPathTolerance = tolerance;
    setWorkPathTolerance(tolerance);
    setToleranceOpen(false);
    store.makeWorkPathFromSelection(tolerance);
  };
  const [makeSelOpen, setMakeSelOpen] = useState(false);
  const [selDraft, setSelDraft] = useState(currentMakeSelection);
  const featherInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (makeSelOpen) featherInput.current?.focus(); }, [makeSelOpen]);
  const makeSelection = (o: typeof currentMakeSelection) => {
    currentMakeSelection = o;
    setMakeSelOpen(false);
    store.makeSelectionFromPath(store.state.penPath, o.mode, o.feather, o.antialias);
  };
  const [strokeOpen, setStrokeOpen] = useState(false);
  const [strokeDraft, setStrokeDraft] = useState(currentStrokePath);
  const [fillOpen, setFillOpen] = useState(false);
  const [fillDraft, setFillDraft] = useState(currentFillPath);
  // Clipping Path…: seeded from the current clipping path, else the first path.
  const [clipOpen, setClipOpen] = useState(false);
  const [clipDraft, setClipDraft] = useState({ index: 0, flatness: MIN_CLIP_FLATNESS });
  const openClipping = () => {
    const index = savedPaths.findIndex((p) => p.clipFlatness !== undefined);
    setClipDraft({ index: Math.max(index, 0), flatness: savedPaths[index]?.clipFlatness ?? MIN_CLIP_FLATNESS });
    setClipOpen(true);
  };
  const applyClipping = () => {
    if (store.setClippingPath(clipDraft.index < 0 ? null : clipDraft.index, clipDraft.flatness)) setClipOpen(false);
  };
  const fillFeatherInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (fillOpen) fillFeatherInput.current?.focus(); }, [fillOpen]);
  const strokePath = (o: typeof currentStrokePath) => {
    currentStrokePath = o;
    setStrokeOpen(false);
    store.strokePath(store.state.penPath, o.tool, o.simulatePressure);
  };
  const fillPath = (o: typeof currentFillPath) => {
    currentFillPath = o;
    setFillOpen(false);
    store.fillPath(store.state.penPath, {
      contents: o.contents, custom: hexToRgb(o.color), mode: o.mode,
      opacity: o.opacity, preserve: o.preserve, feather: o.feather, antialias: o.antialias,
    });
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <Button
          size="sm"
          variant="ghost"
          disabled={!workActive}
          onClick={(event) => { if (event.altKey) { setSelDraft(currentMakeSelection); setMakeSelOpen(true); } else makeSelection(currentMakeSelection); }}
          title="Load the work path as a selection (Option/Alt-click for feather, anti-alias and operation)"
        >Make Selection</Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!selectionActive}
          onClick={(event) => event.altKey ? openTolerance() : store.makeWorkPathFromSelection(workPathTolerance)}
          title="Make a work path from the active selection (Option/Alt-click for tolerance)"
        >Make Work Path</Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!workActive}
          onClick={(event) => { if (event.altKey) { setFillDraft(currentFillPath); setFillOpen(true); } else fillPath(currentFillPath); }}
          title="Fill the work path (Option/Alt-click for contents, blending and rendering)"
        >Fill Path</Button>
        <Button
          size="sm"
          variant="ghost"
          disabled={!workActive}
          onClick={(event) => { if (event.altKey) { setStrokeDraft(currentStrokePath); setStrokeOpen(true); } else strokePath(currentStrokePath); }}
          title="Stroke the work path outline with a painting tool (Option/Alt-click for the tool and Simulate Pressure)"
        >Stroke Path</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" disabled={!workActive} onClick={() => store.saveWorkPath()} title="Save the work path as a named path">Save</Button>
        {panelMenu("Paths", [
          { id: "paths-clipping", label: "Clipping Path…", disabled: savedPaths.length === 0, action: openClipping },
        ])}
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        {!shapeLayer && !workActive && savedPaths.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 11, padding: 4 }}>No paths — draw one with the Pen tool</div>}
        {shapeLayer && (
          <div data-mv-path-row="shape" className="monet-layer is-selected" style={{ height: 24, padding: "0 8px", gap: 6, alignItems: "center", display: "flex" }}>
            <span className="name" style={{ fontSize: 10, flex: 1, fontStyle: "italic" }}>{`${shapeLayer.name} Shape Path`}</span>
          </div>
        )}
        {workActive && (
          <div data-mv-path-row="work" className="monet-layer is-selected" style={{ height: 24, padding: "0 8px", gap: 6, alignItems: "center", display: "flex" }}>
            <span className="name" style={{ fontSize: 10, flex: 1, fontStyle: "italic" }}>Work Path</span>
            <span data-mv-path-visible={showTargetPath ? "on" : "off"} className="monet-iconbtn"
              title={showTargetPath ? "Hide the path outline on canvas" : "Show the path outline on canvas"}
              onClick={() => store.toggleView("showTargetPath")}
              style={{ fontSize: 11, cursor: "pointer", opacity: showTargetPath ? 1 : 0.4 }}>👁</span>
            <span className="monet-iconbtn" title="Delete the work path" onClick={() => store.deleteWorkPath()} style={{ fontSize: 11, cursor: "pointer" }}>✕</span>
          </div>
        )}
        {savedPaths.map((p, i) => (
          <div key={i} data-mv-path-row={i} {...(p.clipFlatness !== undefined ? { "data-mv-path-clipping": p.clipFlatness } : {})}
            className="monet-layer" style={{ height: 24, padding: "0 8px", gap: 6, cursor: "pointer", alignItems: "center", display: "flex" }}
            title="Click to load this path as the work path" onClick={() => store.loadSavedPath(i)}>
            <span className="name" style={{ fontSize: 10, flex: 1, fontWeight: p.clipFlatness !== undefined ? 700 : undefined }}
              title={p.clipFlatness !== undefined ? `Clipping path (flatness ${p.clipFlatness})` : undefined}>{p.name}</span>
            <span className="monet-iconbtn" title="Delete this path" onClick={(e) => { e.stopPropagation(); store.deleteSavedPath(i); }} style={{ fontSize: 11, cursor: "pointer" }}>✕</span>
          </div>
        ))}
      </div>
      {toleranceOpen && (
        <Dialog open onClose={() => setToleranceOpen(false)} title="Make Work Path" width={260}
          footer={<><Button size="sm" variant="ghost" onClick={() => setToleranceOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => makeWorkPath(draftTolerance)}>OK</Button></>}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 11 }}>
            <span style={{ flex: 1 }}>Tolerance</span>
            <NumberField ref={toleranceInput} aria-label="Tolerance" value={draftTolerance} onChange={setDraftTolerance} min={0.5} max={10} step={0.5} precision={1} suffix="px" size="sm" />
          </label>
        </Dialog>
      )}
      {makeSelOpen && (
        <Dialog open onClose={() => setMakeSelOpen(false)} title="Make Selection" width={300}
          footer={<><Button size="sm" variant="ghost" onClick={() => setMakeSelOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => makeSelection(selDraft)}>OK</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Feather Radius</span>
              <NumberField ref={featherInput} aria-label="Feather Radius" value={selDraft.feather} onChange={(v) => setSelDraft({ ...selDraft, feather: v })} min={0} max={1000} step={1} suffix="px" size="sm" />
            </label>
            <Checkbox checked={selDraft.antialias} aria-label="Anti-aliased" onChange={(v) => setSelDraft({ ...selDraft, antialias: v })}>Anti-aliased</Checkbox>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Operation</span>
              <Select size="sm" aria-label="Operation" options={MAKE_SELECTION_OPS} value={String(selDraft.mode)}
                onChange={(v) => setSelDraft({ ...selDraft, mode: Number(v) })} />
            </label>
          </div>
        </Dialog>
      )}
      {strokeOpen && (
        <Dialog open onClose={() => setStrokeOpen(false)} title="Stroke Path" width={300}
          footer={<><Button size="sm" variant="ghost" onClick={() => setStrokeOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => strokePath(strokeDraft)}>OK</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Tool</span>
              <Select size="sm" aria-label="Tool" options={STROKE_PATH_TOOLS} value={strokeDraft.tool}
                onChange={(v) => setStrokeDraft({ ...strokeDraft, tool: v as ToolId })} />
            </label>
            <Checkbox checked={strokeDraft.simulatePressure} aria-label="Simulate Pressure"
              onChange={(v) => setStrokeDraft({ ...strokeDraft, simulatePressure: v })}>Simulate Pressure</Checkbox>
          </div>
        </Dialog>
      )}
      {fillOpen && (
        <Dialog open onClose={() => setFillOpen(false)} title="Fill Path" width={320}
          footer={<><Button size="sm" variant="ghost" onClick={() => setFillOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={() => fillPath(fillDraft)}>OK</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Contents</span>
              <Select size="sm" aria-label="Contents" options={FILL_CONTENTS} value={fillDraft.contents}
                onChange={(v) => setFillDraft({ ...fillDraft, contents: v as FillContent })} />
            </label>
            {fillDraft.contents === "color" && (
              <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <span style={{ flex: 1 }}>Color</span>
                <input type="color" value={fillDraft.color} aria-label="Fill color"
                  onChange={(e) => setFillDraft({ ...fillDraft, color: e.currentTarget.value })} />
              </label>
            )}
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Mode</span>
              <Select size="sm" aria-label="Mode" options={FILL_BLEND_OPTIONS} value={fillDraft.mode}
                onChange={(v) => setFillDraft({ ...fillDraft, mode: v })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Opacity</span>
              <NumberField aria-label="Opacity" value={Math.round(fillDraft.opacity * 100)}
                onChange={(v) => setFillDraft({ ...fillDraft, opacity: v / 100 })} min={0} max={100} step={1} suffix="%" size="sm" />
            </label>
            <Checkbox checked={fillDraft.preserve} aria-label="Preserve Transparency"
              onChange={(v) => setFillDraft({ ...fillDraft, preserve: v })}>Preserve Transparency</Checkbox>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Feather Radius</span>
              <NumberField ref={fillFeatherInput} aria-label="Feather Radius" value={fillDraft.feather}
                onChange={(v) => setFillDraft({ ...fillDraft, feather: v })} min={0} max={1000} step={1} suffix="px" size="sm" />
            </label>
            <Checkbox checked={fillDraft.antialias} aria-label="Anti-aliased"
              onChange={(v) => setFillDraft({ ...fillDraft, antialias: v })}>Anti-aliased</Checkbox>
          </div>
        </Dialog>
      )}
      {clipOpen && (
        <Dialog open onClose={() => setClipOpen(false)} title="Clipping Path" width={300}
          footer={<><Button size="sm" variant="ghost" onClick={() => setClipOpen(false)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={applyClipping}>OK</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, fontSize: 11 }}>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Path</span>
              <Select size="sm" aria-label="Path" value={String(clipDraft.index)}
                options={[{ value: "-1", label: "None" }, ...savedPaths.map((p, i) => ({ value: String(i), label: p.name }))]}
                onChange={(v) => setClipDraft({ ...clipDraft, index: Number(v) })} />
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span style={{ flex: 1 }}>Flatness</span>
              <NumberField aria-label="Flatness" value={clipDraft.flatness} onChange={(v) => setClipDraft({ ...clipDraft, flatness: v })}
                min={MIN_CLIP_FLATNESS} max={MAX_CLIP_FLATNESS} step={0.1} precision={1} suffix="device px" size="sm" />
            </label>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function LayerCompsPanel() {
  const layerComps = useStore((s) => s.layerComps);
  const activeDocId = useStore((s) => s.activeDocId);
  // Applied index and the pre-apply snapshot are per document. Layer ids
  // overlap, so one panel-local index would restore document A's snapshot
  // onto document B.
  const sessions = useRef(new LayerCompSessions()).current;
  const [, setTick] = useState(0);
  const applied = sessions.session(activeDocId).applied;
  // Layer Comp Options dialog (rename, comment, Apply To Layers flags). -1 = closed.
  const [optionsIndex, setOptionsIndex] = useState(-1);
  const [draftName, setDraftName] = useState("");
  const [draftComment, setDraftComment] = useState("");
  const [draftVisibility, setDraftVisibility] = useState(true);
  const [draftPosition, setDraftPosition] = useState(true);
  const [draftAppearance, setDraftAppearance] = useState(true);
  const optionsNameInput = useRef<HTMLInputElement>(null);
  useEffect(() => { if (optionsIndex >= 0) optionsNameInput.current?.focus(); }, [optionsIndex]);
  const openOptions = (i: number) => {
    const c = layerComps[i];
    if (!c) return;
    setDraftName(c.name);
    setDraftComment(c.comment ?? "");
    setDraftVisibility(c.applyVisibility !== false);
    setDraftPosition(c.applyPosition !== false);
    setDraftAppearance(c.applyAppearance !== false);
    setOptionsIndex(i);
  };
  const commitOptions = () => {
    const c = layerComps[optionsIndex];
    if (c) {
      store.setLayerCompOptions(optionsIndex, {
        name: draftName.trim() || c.name,
        comment: draftComment.trim() || undefined,
        applyVisibility: draftVisibility ? undefined : false,
        applyPosition: draftPosition ? undefined : false,
        applyAppearance: draftAppearance ? undefined : false,
      });
    }
    setOptionsIndex(-1);
  };
  // ponytail: visibility/position/opacity/blend only — layer styles live behind
  // the store's private captureStyle, so effects a comp changes aren't restored.
  const snapshot = (): LayerComp => ({
    name: "Last Document State",
    layers: store.state.layers.map((l) => {
      const [x = 0, y = 0] = engine.e.layer_offset(l.id);
      return { id: l.id, visible: l.visible, opacity: l.opacity, blendMode: l.blendMode, offset: [x, y] as [number, number] };
    }),
  });
  const apply = (i: number) => {
    const comp = layerComps[i];
    if (!comp) return;
    const docId = store.state.activeDocId;
    const row = sessions.session(docId);
    sessions.markApplied(docId, i, row.applied < 0 ? snapshot() : (row.last ?? snapshot()));
    store.applyLayerCompToEngine(engine.e, compForApply(comp, store.state.layers));
    engine.commit();
    setTick((n) => n + 1);
  };
  const step = (d: number) => {
    const n = layerComps.length;
    if (n) apply(applied < 0 ? (d > 0 ? 0 : n - 1) : (applied + d + n) % n);
  };
  // `applied` is a bare index, so deleting a comp at or below it would slide the
  // ◆ marker (and step()'s base) onto a different comp. (#104)
  const removeComp = (i: number) => {
    store.deleteLayerComp(i);
    sessions.noteRemoved(store.state.activeDocId, i);
    setTick((n) => n + 1);
  };
  const restore = () => {
    const docId = store.state.activeDocId;
    if (docId !== activeDocId) return;
    const last = sessions.restore(docId);
    if (!last) return;
    store.applyLayerCompToEngine(engine.e, last);
    engine.commit();
    setTick((n) => n + 1);
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0 }}>
      <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
        <Button size="sm" variant="ghost" onClick={() => store.saveLayerComp()} title="Capture the current layers' visibility/opacity/blend as a new comp">New Layer Comp</Button>
        <div style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" aria-label="Apply previous layer comp" title="Apply previous comp" disabled={!layerComps.length} onClick={() => step(-1)}>◀</Button>
        <Button size="sm" variant="ghost" aria-label="Apply next layer comp" title="Apply next comp" disabled={!layerComps.length} onClick={() => step(1)}>▶</Button>
      </div>
      <div style={{ flex: 1, overflow: "auto", display: "flex", flexDirection: "column", gap: 1 }}>
        <div data-mv-comp-restore className="monet-layer" style={{ height: 24, padding: "0 8px", gap: 6, cursor: applied < 0 ? "default" : "pointer", alignItems: "center", display: "flex", opacity: applied < 0 ? 0.5 : 1 }}
          title="Revert to the document state from before a comp was applied" onClick={restore}>
          <span className="name" style={{ fontSize: 10, flex: 1 }}>Restore Last Document State</span>
        </div>
        {layerComps.length === 0 && <div style={{ color: "var(--text-3)", fontSize: 11, padding: 4 }}>No comps — click New Layer Comp to capture the current layer state</div>}
        {layerComps.map((c, i) => (
          <div key={i} data-mv-comp-row={i} className="monet-layer" style={{ height: 24, padding: "0 8px", gap: 6, cursor: "pointer", alignItems: "center", display: "flex" }}
            title={c.comment || "Click to apply this comp"} onClick={() => apply(i)}>
            <span style={{ fontSize: 10, width: 8, color: "var(--text-3)" }}>{i === applied ? "◆" : ""}</span>
            <span className="name" style={{ fontSize: 10, flex: 1 }}>{c.name}</span>
            {c.comment && <span style={{ fontSize: 9, color: "var(--text-3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.comment}</span>}
            <span className="monet-iconbtn" title="Layer Comp Options…" onClick={(e) => { e.stopPropagation(); openOptions(i); }} style={{ fontSize: 11, cursor: "pointer" }}>⚙</span>
            <span className="monet-iconbtn" title="Update this comp to the current state" onClick={(e) => { e.stopPropagation(); store.updateLayerComp(i); }} style={{ fontSize: 11, cursor: "pointer" }}>⟳</span>
            <span className="monet-iconbtn" title="Delete this comp" onClick={(e) => { e.stopPropagation(); removeComp(i); }} style={{ fontSize: 11, cursor: "pointer" }}>✕</span>
          </div>
        ))}
      </div>
      {optionsIndex >= 0 && layerComps[optionsIndex] && (
        <Dialog open onClose={() => setOptionsIndex(-1)} title="Layer Comp Options" width={280}
          footer={<><Button size="sm" variant="ghost" onClick={() => setOptionsIndex(-1)}>Cancel</Button>
            <Button size="sm" variant="primary" onClick={commitOptions}>OK</Button></>}>
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span>Name</span>
              <Input ref={optionsNameInput} size="sm" block aria-label="Layer comp name" value={draftName}
                onChange={(e) => setDraftName(e.target.value)} />
            </label>
            <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span>Comment</span>
              <Textarea rows={3} aria-label="Layer comp comment" value={draftComment}
                onChange={(e) => setDraftComment(e.target.value)} />
            </label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 11 }}>
              <span>Apply To Layers</span>
              <Checkbox checked={draftVisibility} aria-label="Apply visibility" onChange={setDraftVisibility}>Visibility</Checkbox>
              <Checkbox checked={draftPosition} aria-label="Apply position" onChange={setDraftPosition}>Position</Checkbox>
              <Checkbox checked={draftAppearance} aria-label="Apply appearance" onChange={setDraftAppearance}>Appearance</Checkbox>
            </div>
          </div>
        </Dialog>
      )}
    </div>
  );
}

export function InfoPanel() {
  const cursor = useStore((s) => s.cursor);
  const picked = useStore((s) => s.picked);
  const doc = useStore((s) => s.doc);
  const mode = useStore((s) => s.mode);
  const colorSamplers = useStore((s) => s.colorSamplers);
  const sampleSize = useStore((s) => s.sampleSize);
  const sampleMode = useStore((s) => s.sampleMode);
  const selectionActive = useStore((s) => s.selectionActive);
  const selectionDragRect = useStore((s) => s.selectionDragRect);
  const row = (a: string, b: string) => (
    <div className="monet-row"><span className="lbl">{a}</span><span className="val">{b}</span></div>
  );
  // HSB / Hex readouts (Photoshop Info-panel colour models) from the picked colour.
  const infoRow = (id: string, a: string, b: string) => (
    <div className="monet-row" data-mv-info={id}><span className="lbl">{a}</span><span className="val">{b}</span></div>
  );
  // Selection geometry rows (Photoshop's Info-panel W/H readout for the marquee).
  const selRow = (id: string, a: string, b: string) => (
    <div className="monet-row" data-mv-sel={id}><span className="lbl">{a}</span><span className="val">{b}</span></div>
  );
  const eng = engine.engine;
  const hsb = picked ? rgbToHsb(picked.r, picked.g, picked.b) : null;
  const labAtCursor = mode === 3 && cursor && eng ? eng.pick_lab(cursor.x, cursor.y) : null;
  const lab = labAtCursor
    ? { l: labAtCursor[0] ?? 0, a: labAtCursor[1] ?? 0, b: labAtCursor[2] ?? 0 }
    : picked ? rgbToLab(picked.r, picked.g, picked.b) : null;
  // CMYK readout for non-CMYK docs (Photoshop converts via the working CMYK space);
  // CMYK docs use the engine's pick_cmyk below.
  const cmykConv = mode !== 2 && picked ? rgbToCmyk(picked.r, picked.g, picked.b) : null;
  const cmyk = mode === 2 && cursor && eng ? eng.pick_cmyk(cursor.x, cursor.y) : null;
  // Color Sampler readouts: read each point's colour live from the composite so
  // they track edits (Photoshop's colour-monitoring behaviour). Sample Size and
  // Sample source are shared with the Eyedropper. Re-runs on every commit because
  // InfoPanel subscribes to `doc`, which is replaced on every engine sync.
  const samplerRadius = Math.max(0, Math.floor((sampleSize - 1) / 2));
  const samplerRows = eng
    ? colorSamplers.map((p, i) => {
        const packed = eng.pick_sample(p.x, p.y, samplerRadius, sampleMode) >>> 0;
        return { i, r: (packed >>> 24) & 255, g: (packed >>> 16) & 255, b: (packed >>> 8) & 255 };
      })
    : [];
  const modeLabel = colorModeName(mode);
  // Prefer the in-progress marquee geometry, then fall through to the committed
  // engine selection as soon as the pointer is released.
  const selRect = selectionDragRect ?? (selectionActive && eng ? selectionRect(eng.selection_bounds()) : null);
  return (
    <div>
      {row("X", cursor ? String(cursor.x) : "–")}
      {row("Y", cursor ? String(cursor.y) : "–")}
      <div className="monet-section-label" style={{ marginTop: 8 }}>Color · {modeLabel}</div>
      {row("R", picked ? String(picked.r) : "–")}
      {row("G", picked ? String(picked.g) : "–")}
      {row("B", picked ? String(picked.b) : "–")}
      {hsb && picked && (
        <>
          {infoRow("h", "H", `${hsb.h}°`)}
          {infoRow("s", "S", `${hsb.s}%`)}
          {infoRow("b", "B", `${hsb.b}%`)}
          {infoRow("hex", "Hex", colorHexCode(picked.r, picked.g, picked.b))}
        </>
      )}
      {lab && (
        <>
          {infoRow("lab-l", "L", String(lab.l))}
          {infoRow("lab-a", "a", String(lab.a))}
          {infoRow("lab-b", "b", String(lab.b))}
        </>
      )}
      {cmyk && (
        <>
          {row("C", `${Math.round(cmyk[0] * 100)}%`)}
          {row("M", `${Math.round(cmyk[1] * 100)}%`)}
          {row("Y", `${Math.round(cmyk[2] * 100)}%`)}
          {row("K", `${Math.round(cmyk[3] * 100)}%`)}
          {/* Photoshop's Total Ink readout — the plates are ink-limited, so this
              is the coverage that would actually go on press. */}
          {infoRow("total-ink", "Total Ink", `${Math.round(cmyk.reduce((sum, ink) => sum + ink, 0) * 100)}%`)}
        </>
      )}
      {cmykConv && (
        <>
          {infoRow("cmyk-c", "C", `${cmykConv.c}%`)}
          {infoRow("cmyk-m", "M", `${cmykConv.m}%`)}
          {infoRow("cmyk-y", "Y", `${cmykConv.y}%`)}
          {infoRow("cmyk-k", "K", `${cmykConv.k}%`)}
        </>
      )}
      {samplerRows.length > 0 && (
        <>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Color Samplers</div>
          {samplerRows.map((s) => (
            <div className="monet-row" key={s.i} data-mv-sampler={s.i + 1}>
              <span className="lbl">{`#${s.i + 1}`}</span>
              <span className="val">{`${s.r}, ${s.g}, ${s.b}`}</span>
            </div>
          ))}
        </>
      )}
      {selRect && (
        <>
          <div className="monet-section-label" style={{ marginTop: 8 }}>Selection</div>
          {selRow("x", "X", `${selRect.x} px`)}
          {selRow("y", "Y", `${selRect.y} px`)}
          {selRow("w", "W", `${selRect.w} px`)}
          {selRow("h", "H", `${selRect.h} px`)}
        </>
      )}
      <div className="monet-section-label" style={{ marginTop: 8 }}>Document</div>
      {row("W", `${doc.width} px`)}
      {row("H", `${doc.height} px`)}
    </div>
  );
}

export function NotesPanel() {
  const notes = useStore((s) => s.notes);
  const activeNoteId = useStore((s) => s.activeNoteId);
  const idx = notes.findIndex((n) => n.id === activeNoteId);
  const active = idx >= 0 ? notes[idx] : null;
  const cycle = (delta: number) => {
    if (!notes.length) return;
    const base = idx >= 0 ? idx : 0;
    store.selectNote(notes[(base + delta + notes.length) % notes.length].id);
  };
  if (!notes.length) {
    return (
      <div style={{ color: "var(--text-3)", fontSize: 11, padding: 4 }}>
        No notes. Pick the Note tool and click the canvas to add one.
      </div>
    );
  }
  return (
    <div data-mv-notes-panel style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        <Button size="sm" variant="ghost" disabled={notes.length < 2} onClick={() => cycle(-1)} title="Previous note">‹</Button>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{active ? `Note ${idx + 1} / ${notes.length}` : `${notes.length} notes`}</span>
        <Button size="sm" variant="ghost" disabled={notes.length < 2} onClick={() => cycle(1)} title="Next note">›</Button>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" disabled={!active} onClick={() => active && store.deleteNote(active.id)} title="Delete this note">Delete</Button>
      </div>
      {active ? (
        <>
          <div style={{ fontSize: 11, color: "var(--text-3)" }}>
            Author: <span style={{ color: "var(--text-1)" }}>{active.author || "—"}</span>
          </div>
          <Textarea id="mv-note-text" rows={6} value={active.text} placeholder="Type your note…"
            onChange={(e) => store.setNoteText(active.id, e.target.value)} />
        </>
      ) : (
        <div style={{ color: "var(--text-3)", fontSize: 11 }}>Select a note on the canvas to edit it.</div>
      )}
    </div>
  );
}

/** Libraries: a cross-document store of reusable graphics. Capture the current
 *  image as an asset, then click any asset to place it as a new layer in any
 *  open document. Persisted to localStorage (a local CC-Libraries analog). */
export function LibrariesPanel() {
  const [assets, setAssets] = useState<LibraryGraphic[]>(() => library.list());
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <Button size="sm" variant="ghost" title="Capture the current image as a reusable graphic" onClick={() => void library.capture().then(setAssets)}>+ Capture</Button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{assets.length} asset{assets.length === 1 ? "" : "s"}</span>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {assets.map((a) => (
          <div key={a.id} style={{ position: "relative" }} title={`${a.name} — click to place as a layer`}>
            <img src={a.dataUrl} alt={a.name} onClick={() => void library.insert(a.id)}
              style={{ width: "100%", aspectRatio: "1 / 1", objectFit: "contain", background: "rgba(255,255,255,0.05)", borderRadius: 3, cursor: "pointer", boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.12)", display: "block" }} />
            <span onClick={() => setAssets(library.remove(a.id))} title="Remove"
              style={{ position: "absolute", top: -5, right: -5, cursor: "pointer", fontSize: 10, background: "#000", color: "#fff", borderRadius: "50%", width: 15, height: 15, textAlign: "center", lineHeight: "15px", boxShadow: "0 0 0 1px rgba(255,255,255,0.3)" }}>×</span>
          </div>
        ))}
      </div>
      {!assets.length && <div style={{ fontSize: 11, color: "var(--text-3)", padding: 4 }}>Capture graphics here to reuse across documents. Click an asset to place it as a new layer.</div>}
    </div>
  );
}

export function StylesPanel() {
  const styles = useStore((s) => s.stylePresets);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" data-mv-style-save title="Save the active layer's style as a preset" onClick={() => store.addStylePreset()}>+ Save Style</Button>
        <Button size="sm" variant="ghost" data-mv-style-import onClick={() => void importStylesFile()} title="Import layer styles from an Adobe .asl style file">Import</Button>
        <Button size="sm" variant="ghost" data-mv-style-export onClick={() => saveBytes("styles.asl", buildAsl(styles), "application/octet-stream")} title="Export the Styles library to an Adobe .asl style file">Export</Button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{styles.length}</span>
      </div>
      <div data-mv-styles={styles.length} style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
        {styles.map((p, i) => (
          <div key={`${p.name}-${i}`} style={{ position: "relative" }} title={`${p.name} — click to apply to the active layer`}>
            {/* The tile *is* the preview (Photoshop's thumbnail view), so the name
                lives in the tooltip + accessible name rather than over the effect. */}
            <button data-mv-style={p.name} aria-label={p.name} onClick={() => store.applyStylePreset(i)}
              style={{ width: "100%", aspectRatio: "1 / 1", borderRadius: 4, border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", padding: 0, ...stylePreviewCss(p.style) }} />
            <span onClick={() => store.removeStylePreset(i)} title="Remove"
              style={{ position: "absolute", top: -5, right: -5, cursor: "pointer", fontSize: 10, background: "#000", color: "#fff", borderRadius: "50%", width: 15, height: 15, textAlign: "center", lineHeight: "15px", boxShadow: "0 0 0 1px rgba(255,255,255,0.3)" }}>×</span>
          </div>
        ))}
      </div>
      {!styles.length && <div style={{ fontSize: 11, color: "var(--text-3)", padding: 4 }}>Save the active layer's effects here to reuse them. Click a style to apply it to the active layer.</div>}
    </div>
  );
}

export function SwatchesPanel() {
  const { open } = useDialogs();
  const swatches = useStore((s) => s.swatches);
  const fg = useStore((s) => s.fg);
  const thumbnailSize = useStore((s) => s.panelOptions?.swatchThumbnailSize) ?? DEFAULT_PANEL_OPTIONS.swatchThumbnailSize;
  const view = useStore((s) => s.panelOptions?.swatchView) ?? DEFAULT_PANEL_OPTIONS.swatchView;
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <Button size="sm" variant="ghost" onClick={() => store.addSwatch(hsvToHex(fg))} title="Add the foreground colour as a swatch">+ Add</Button>
        <Button size="sm" variant="ghost" data-mv-swatch-import onClick={() => void importSwatchesFile()} title="Import colours from an Adobe .aco, .ase or .act swatch file">Import</Button>
        <Button size="sm" variant="ghost" data-mv-swatch-export onClick={() => exportSwatchesAco()} title="Export the swatch library to an Adobe .aco file">Export</Button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{swatches.length}</span>
        {panelMenu("Swatches", [
          { id: "swatches-options", label: "Panel Options", items: [
            thumbnailOptions("swatchThumbnailSize", thumbnailSize),
            ...(["grid", "list"] as PanelOptions["swatchView"][]).map((value) => ({
              id: `swatches-${value}`, label: value === "grid" ? "Thumbnail Grid" : "List", checked: view === value,
              action: () => store.setPanelOptions({ swatchView: value }),
            })),
          ] },
          { id: "swatches-manage", label: "Preset Manager…", action: () => open("presetManager") },
        ])}
      </div>
      <PanelOptionsError />
      <div data-mv-swatches={swatches.length} data-mv-swatch-view={view}
        style={{ display: "grid", gridTemplateColumns: view === "list" ? "1fr" : `repeat(auto-fill, minmax(${thumbnailSize}px, 1fr))`, gap: 4 }}>
        {swatches.map((hex, i) => (
          <button
            key={`${hex}-${i}`}
            data-mv-swatch={hex}
            aria-label={`Swatch ${hex}`}
            title={`${hex} — click to set foreground · Alt-click to remove`}
            onClick={(e) => (e.altKey ? store.removeSwatch(i) : store.setForeground(hexToHsv(hex) ?? fg))}
            style={{ display: "flex", gap: 8, alignItems: "center", width: "100%", minHeight: thumbnailSize, aspectRatio: view === "list" ? undefined : "1", borderRadius: 4, background: view === "list" ? "var(--bg-2)" : hex, color: "var(--text-1)", border: "1px solid rgba(255,255,255,0.18)", cursor: "pointer", padding: view === "list" ? 4 : 0 }}>
            {view === "list" && <><span aria-hidden style={{ width: thumbnailSize, height: thumbnailSize, borderRadius: 3, background: hex, flexShrink: 0 }} /><span>{hex}</span></>}
          </button>
        ))}
      </div>
    </div>
  );
}

export function BrushesPanel() {
  const presets = useStore((s) => s.brushPresets);
  const activePreset = useStore((s) => s.activeBrushPreset);
  const toolPresets = useStore((s) => s.toolPresets);
  const tips = useStore((s) => s.brushTips);
  const activeTip = useStore((s) => s.activeBrushTip);
  const symmetry = useStore((s) => s.paintSymmetry);
  const symmetrySegments = useStore((s) => s.paintSymmetrySegments);
  const symmetryVisible = useStore((s) => s.paintSymmetryVisible);
  const symmetryTransforming = useStore((s) => s.paintSymmetryTransforming);
  const [presetQuery, setPresetQuery] = useState("");
  // Brush Settings ▸ Transfer: per-dab opacity/flow jitter, pushed straight to
  // the engine (brushDynamics remembers the last values for a remount).
  const [transfer, setTransfer] = useState(brushTransfer);
  const [shape, setShape] = useState(brushShapeDynamics);
  const [scatter, setScatter] = useState(brushScatter);
  const shapeRow = (label: string, key: keyof BrushShapeDynamics, title: string) => (
    <div className="monet-row" style={{ gap: 8 }} title={title}>
      <span style={{ width: 108, fontSize: 11, color: "var(--text-3)" }}>{label}</span>
      <Slider value={shape[key]} accent={ACCENT} aria-label={label} style={{ flex: 1 }}
        onChange={(f) => setShape(setBrushShapeDynamics({ [key]: f }, engine.engine))} />
      <span style={{ width: 30, fontSize: 11, textAlign: "right" }}>{Math.round(shape[key] * 100)}</span>
    </div>
  );
  const transferRow = (label: string, key: keyof BrushTransfer, title: string) => (
    <div className="monet-row" style={{ gap: 8, marginBottom: 6 }}>
      <span className="lbl" style={{ width: 84 }} title={title}>{label}</span>
      <Slider value={transfer[key]} accent={ACCENT} aria-label={label} style={{ flex: 1 }}
        onChange={(f) => setTransfer(setBrushTransfer({ [key]: f }, engine.engine))} />
      <span className="val" style={{ fontFamily: "var(--font-mono)" }}>{Math.round(transfer[key] * 100)}%</span>
    </div>
  );
  const normalizedPresetQuery = presetQuery.trim().toLowerCase();
  const shownPresets = presets
    .map((preset, index) => ({ preset, index }))
    .filter(({ preset }) => !normalizedPresetQuery || preset.name.toLowerCase().includes(normalizedPresetQuery));
  return (
    <div>
      <div className="monet-row" style={{ gap: 4, marginBottom: 8, alignItems: "center", flexWrap: "wrap" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)", marginRight: "auto" }}>Symmetry</span>
        {["Off", "V", "H", "4·", "D", "W", "○", "S", "∥", "R", "M"].map((label, i) => (
          <Button key={label} size="sm" variant={symmetry === i ? "primary" : "ghost"} data-mv-symmetry={i}
            onClick={() => store.setPaintSymmetry(i)}
            title={["No symmetry", "Vertical axis", "Horizontal axis", "Dual (4-way)", "Diagonal", "Wavy", "Circle", "Spiral", "Parallel Lines", "Radial", "Mandala"][i]}>{label}</Button>
        ))}
      </div>
      {symmetry >= 9 && (
        <div className="monet-row" style={{ gap: 6, marginBottom: 8, alignItems: "center" }}>
          <label htmlFor="mv-symmetry-segments" style={{ fontSize: 11, color: "var(--text-3)" }}>Segments</label>
          <span style={{ flex: 1 }} />
          <div style={{ width: 72 }} data-mv-symmetry-segments={symmetrySegments}>
            <NumberField id="mv-symmetry-segments" aria-label="Symmetry segments" size="sm"
              value={symmetrySegments} min={symmetry === 10 ? 3 : 2} max={symmetry === 10 ? 10 : 12}
              onChange={(value) => store.setPaintSymmetrySegments(value)} />
          </div>
        </div>
      )}
      {symmetry !== 0 && (
        <div className="monet-row" style={{ gap: 6, marginBottom: 8, alignItems: "center" }}>
          <Button size="sm" variant={symmetryTransforming ? "primary" : "ghost"}
            data-mv-transform-symmetry onClick={() => store.beginPaintSymmetryTransform()}>Transform</Button>
          <Button size="sm" variant="ghost" data-mv-toggle-symmetry-guide
            onClick={() => store.togglePaintSymmetryVisibility()}>{symmetryVisible ? "Hide Guide" : "Show Guide"}</Button>
          {symmetryTransforming && <span style={{ fontSize: 10, color: "var(--text-3)" }}>Drag centre or outer handle · Enter/Esc</span>}
        </div>
      )}
      {/* Shape Dynamics — per-dab tip randomization. Minimum Diameter also
          floors the pressure-size ramp, which used to be a hard-coded 25%. */}
      <div style={{ marginTop: 4, marginBottom: 6, fontSize: 11, color: "var(--text-3)" }}>Shape Dynamics</div>
      <div data-mv-brush-shape-dynamics={`${shape.sizeJitter},${shape.minDiameter},${shape.angleJitter},${shape.roundnessJitter},${shape.minRoundness}`}>
        {shapeRow("Size Jitter", "sizeJitter", "Randomize each dab's diameter")}
        {shapeRow("Minimum Diameter", "minDiameter", "Smallest a jittered or pressure-scaled dab can get")}
        {shapeRow("Angle Jitter", "angleJitter", "Randomize each dab's rotation (100% = full circle)")}
        {shapeRow("Roundness Jitter", "roundnessJitter", "Randomize how squashed each dab is")}
        {shapeRow("Minimum Roundness", "minRoundness", "Roundest-to-flattest limit for a jittered dab")}
      </div>
      {/* Scattering — how far off the path each dab lands, and how many land
          per step. Scatter is shown as Photoshop's percentage. */}
      <div style={{ marginTop: 4, marginBottom: 6, fontSize: 11, color: "var(--text-3)" }}>Scattering</div>
      <div data-mv-brush-scatter={`${scatter.scatter},${scatter.bothAxes ? 1 : 0},${scatter.count},${scatter.countJitter}`}>
        <div className="monet-row" style={{ gap: 8 }} title="How far off the stroke a dab may land">
          <span style={{ width: 108, fontSize: 11, color: "var(--text-3)" }}>Scatter</span>
          <Slider value={scatter.scatter / 10} accent={ACCENT} aria-label="Scatter" style={{ flex: 1 }}
            onChange={(f) => setScatter(setBrushScatter({ scatter: f * 10 }, engine.engine))} />
          <span style={{ width: 30, fontSize: 11, textAlign: "right" }}>{Math.round(scatter.scatter * 100)}</span>
        </div>
        <div className="monet-row" style={{ gap: 8 }}>
          <span style={{ width: 108, fontSize: 11, color: "var(--text-3)" }}>Both Axes</span>
          <Checkbox checked={scatter.bothAxes} aria-label="Both Axes"
            onChange={(v) => setScatter(setBrushScatter({ bothAxes: v }, engine.engine))} />
        </div>
        <div className="monet-row" style={{ gap: 8 }} title="Dabs laid down per stroke step">
          <span style={{ width: 108, fontSize: 11, color: "var(--text-3)" }}>Count</span>
          <NumberField value={scatter.count} min={1} max={16} aria-label="Count"
            onChange={(v) => setScatter(setBrushScatter({ count: v }, engine.engine))} />
        </div>
        <div className="monet-row" style={{ gap: 8 }} title="Randomly drop some of the Count">
          <span style={{ width: 108, fontSize: 11, color: "var(--text-3)" }}>Count Jitter</span>
          <Slider value={scatter.countJitter} accent={ACCENT} aria-label="Count Jitter" style={{ flex: 1 }}
            onChange={(f) => setScatter(setBrushScatter({ countJitter: f }, engine.engine))} />
          <span style={{ width: 30, fontSize: 11, textAlign: "right" }}>{Math.round(scatter.countJitter * 100)}</span>
        </div>
      </div>
      {/* Transfer — Photoshop's per-dab opacity/flow randomization. Jitter is how
          far below the set value a dab may fall; Minimum floors it. */}
      <div style={{ marginTop: 4, marginBottom: 6, fontSize: 11, color: "var(--text-3)" }}>Transfer</div>
      <div data-mv-brush-transfer={`${transfer.opacityJitter},${transfer.minOpacity},${transfer.flowJitter},${transfer.minFlow}`}>
        {transferRow("Opacity Jitter", "opacityJitter", "Randomize each dab's opacity")}
        {transferRow("Minimum", "minOpacity", "Lowest opacity a jittered dab can drop to")}
        {transferRow("Flow Jitter", "flowJitter", "Randomize each dab's flow")}
        {transferRow("Flow Minimum", "minFlow", "Lowest flow a jittered dab can drop to")}
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <Button size="sm" variant="ghost" data-mv-brush-add onClick={() => store.addBrushPreset()} title="Save the current brush settings as a preset">+ Add</Button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{presets.length}</span>
      </div>
      <input
        type="search"
        value={presetQuery}
        onChange={(event) => setPresetQuery(event.currentTarget.value)}
        placeholder="Search brush presets"
        aria-label="Search brush presets"
        style={{ boxSizing: "border-box", width: "100%", height: 24, marginBottom: 8, padding: "0 6px", borderRadius: 4, border: "1px solid var(--stroke-2, rgba(255,255,255,0.12))", background: "var(--surface-2, rgba(255,255,255,0.05))", color: "var(--text-1)", fontSize: 11 }}
      />
      <div data-mv-brushes={presets.length} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {shownPresets.map(({ preset: p, index: i }) => {
          // Preview dot scaled to the brush size (clamped), softened when low-hardness.
          const d = Math.max(4, Math.min(20, Math.round((p.brush.size ?? 12) / 3)));
          return (
            <button
              key={`${p.name}-${i}`}
              data-mv-brush-preset={p.name}
              data-mv-active-brush-preset={i === activePreset ? "" : undefined}
              aria-pressed={i === activePreset}
              title={`${p.name} — click to apply · Alt-click to remove`}
              onClick={(e) => (e.altKey ? store.removeBrushPreset(i) : store.applyBrushPreset(i))}
              style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 6px", borderRadius: 4, background: i === activePreset ? "rgba(81,154,255,.18)" : "transparent", border: `1px solid ${i === activePreset ? "rgba(81,154,255,.55)" : "rgba(255,255,255,0.1)"}`, cursor: "pointer", color: "var(--text-1)", textAlign: "left" }}
            >
              <span style={{ width: 20, display: "inline-flex", justifyContent: "center" }}>
                <span style={{ width: d, height: d, borderRadius: "50%", background: "var(--text-1)", opacity: 0.85, filter: (p.brush.hardness ?? 1) < 0.5 ? "blur(1px)" : "none" }} />
              </span>
              <span style={{ fontSize: 12 }}>{p.name}</span>
            </button>
          );
        })}
        {!shownPresets.length && (
          <div style={{ color: "var(--text-3)", fontSize: 11, padding: "4px 6px" }}>No matching brush presets</div>
        )}
      </div>
      {/* Tool Presets — a saved tool + brush + foreground snapshot; clicking one
          selects its tool and restores its settings. */}
      <div className="monet-row" style={{ gap: 6, marginTop: 10, marginBottom: 4, alignItems: "center" }}>
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Tool Presets</div>
        <span style={{ flex: 1 }} />
        <Button size="sm" variant="ghost" data-mv-tool-preset-add onClick={() => store.addToolPreset()} title="Save the current tool + brush + foreground as a preset">+ Add</Button>
      </div>
      <div data-mv-tool-presets={toolPresets.length} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        {toolPresets.map((p, i) => (
          <button
            key={`${p.name}-${i}`}
            data-mv-tool-preset={p.name}
            title={`${p.name} (${p.tool}) — click to apply · Alt-click to remove`}
            onClick={(e) => (e.altKey ? store.removeToolPreset(i) : store.applyToolPreset(i))}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 6px", borderRadius: 4, background: "transparent", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", color: "var(--text-1)", textAlign: "left" }}
          >
            <span style={{ fontSize: 12, flex: 1 }}>{p.name}</span>
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{p.tool}</span>
          </button>
        ))}
      </div>
      {/* Custom tip library (Edit ▸ Define Brush Preset) — captured alpha bitmaps
          the brush paints with; "Round" reverts to the procedural disc. */}
      <div style={{ marginTop: 10, marginBottom: 4, fontSize: 11, color: "var(--text-3)" }}>Brush Tips</div>
      <div data-mv-brush-tips={tips.length} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
        <button
          data-mv-brush-round
          title="Use the procedural round brush"
          onClick={() => store.selectRoundBrush()}
          style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 6px", borderRadius: 4, background: activeTip < 0 ? "rgba(255,255,255,0.12)" : "transparent", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", color: "var(--text-1)", textAlign: "left" }}
        >
          <span style={{ width: 20, display: "inline-flex", justifyContent: "center" }}>
            <span style={{ width: 12, height: 12, borderRadius: "50%", background: "var(--text-1)", opacity: 0.85 }} />
          </span>
          <span style={{ fontSize: 12 }}>Round</span>
        </button>
        {tips.map((t, i) => (
          <button
            key={`${t.name}-${i}`}
            data-mv-brush-tip={t.name}
            title={`${t.name} (${t.w}×${t.h}) — click to use · Alt-click to remove`}
            onClick={(e) => (e.altKey ? store.removeBrushTip(i) : store.selectBrushTip(i))}
            style={{ display: "flex", alignItems: "center", gap: 8, width: "100%", padding: "4px 6px", borderRadius: 4, background: activeTip === i ? "rgba(255,255,255,0.12)" : "transparent", border: "1px solid rgba(255,255,255,0.1)", cursor: "pointer", color: "var(--text-1)", textAlign: "left" }}
          >
            <span style={{ width: 20, display: "inline-flex", justifyContent: "center" }}>
              <span style={{ width: 12, height: 12, borderRadius: 2, background: "var(--text-1)", opacity: 0.85 }} />
            </span>
            <span style={{ fontSize: 12 }}>{t.name}</span>
            <span style={{ flex: 1 }} />
            <span style={{ fontSize: 10, color: "var(--text-3)" }}>{t.w}×{t.h}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

// A Clone Source number field. It never clamps: Enter or blur hands the typed
// value to the store, which refuses an out-of-range one and says why, and
// Escape drops the edit (the latch keeps the blur after Enter/Escape a no-op).
function CloneField({ "aria-label": label, value, onCommit }: {
  "aria-label": string; value: number; onCommit: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const typed = useRef<string | null>(null);
  const edit = (next: string | null) => { typed.current = next; setDraft(next); };
  const finish = (commit: boolean) => {
    const v = typed.current;
    if (v === null) return;
    edit(null);
    if (commit) onCommit(Number(v));
  };
  return (
    <Input size="sm" aria-label={label} inputMode="decimal" value={draft ?? String(value)}
      style={{ width: 56 }}
      onChange={(e) => edit(e.currentTarget.value)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") { e.preventDefault(); finish(true); }
        else if (e.key === "Escape") { e.preventDefault(); finish(false); }
      }}
      onBlur={() => finish(true)}
    />
  );
}

/** Window ▸ Clone Source (#427): five source slots, the active slot's
 *  transform, and the overlay the Clone Stamp / Healing Brush draw under the
 *  brush. Slots are session-only; Alt-click samples into the selected one. */
export function CloneSourcePanel() {
  const slots = useStore((s) => s.cloneSources);
  const active = useStore((s) => s.cloneSourceSlot);
  const overlay = useStore((s) => s.cloneOverlay);
  const error = useStore((s) => s.cloneSourceError);
  const documents = useStore((s) => s.documents);
  const { source, transform: t } = slots[active];
  const docName = source && documents.find((d) => d.id === source.docId)?.name;
  const row: CSSProperties = { display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" };
  return (
    <div data-mv-clone-source-panel style={{ display: "grid", gap: 8, fontSize: 11 }}>
      <SegmentedControl aria-label="Clone sources" value={String(active)} onChange={(v) => store.selectCloneSlot(Number(v))}
        items={slots.map((_, i) => ({ value: String(i), label: String(i + 1) }))} />
      <div data-mv-clone-source-readout style={{ color: "var(--text-2)" }}>
        {source && docName ? `${docName} · ${Math.round(source.x)}, ${Math.round(source.y)}` : "Empty — Alt-click with the Clone Stamp to sample."}
      </div>
      <div style={row}>
        <span style={{ color: "var(--text-3)" }}>W</span>
        <CloneField aria-label="Source width (%)" value={t.w} onCommit={(w) => store.setCloneTransform({ w })} />
        <span style={{ color: "var(--text-3)" }}>H</span>
        <CloneField aria-label="Source height (%)" value={t.h} onCommit={(h) => store.setCloneTransform({ h })} />
        <span style={{ color: "var(--text-3)" }}>Angle</span>
        <CloneField aria-label="Source angle (°)" value={t.angle} onCommit={(angle) => store.setCloneTransform({ angle })} />
      </div>
      <div style={row}>
        <Button size="sm" aria-pressed={t.flipH} onClick={() => store.setCloneTransform({ flipH: !t.flipH })}>Flip Horizontal</Button>
        <Button size="sm" aria-pressed={t.flipV} onClick={() => store.setCloneTransform({ flipV: !t.flipV })}>Flip Vertical</Button>
        <Button size="sm" onClick={() => store.setCloneTransform(DEFAULT_CLONE_TRANSFORM)}>Reset Transform</Button>
      </div>
      <div style={row}>
        <Checkbox checked={overlay.show} aria-label="Show Overlay" onChange={(show) => store.setCloneOverlay({ show })}>Show Overlay</Checkbox>
        <span style={{ color: "var(--text-3)" }}>Opacity</span>
        <CloneField aria-label="Overlay opacity (%)" value={overlay.opacity} onCommit={(opacity) => store.setCloneOverlay({ opacity })} />
      </div>
      {error && <div role="alert" style={{ color: "var(--text-2)" }}>{error}</div>}
    </div>
  );
}

export function AnimationPanel() {
  const frames = useStore(() => anim.count());
  const onion = useStore((s) => s.onionSkin);
  const [delay, setDelay] = useState(10);
  return (
    <div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <Button size="sm" variant="ghost" onClick={() => anim.addFrame()} title="Capture current canvas as a frame">+ Frame</Button>
        <Button size="sm" variant="ghost" disabled={frames < 2} title="Insert cross-faded in-between frames on the last transition" onClick={() => anim.tween(frames - 2, frames - 1, 4)}>Tween</Button>
        <Button size="sm" variant="ghost" data-mv-frames-from-layers
          title="One frame per layer, bottom first — turn a stack of cels into a run"
          onClick={() => anim.framesFromLayers()}>From Layers</Button>
        <Button size="sm" variant="ghost" data-mv-frames-to-layers disabled={frames === 0}
          title="One layer per frame, in order — the frames are kept"
          onClick={() => anim.framesToLayers()}>To Layers</Button>
        <Button size="sm" variant="ghost" data-mv-reverse-frames disabled={frames < 2}
          title="Play the animation backwards — each frame keeps its own delay"
          onClick={() => anim.reverseFrames()}>Reverse</Button>
        <Button size="sm" variant="ghost" disabled={frames === 0} onClick={() => exportGIF("animation.gif", delay)}>Export GIF</Button>
        <Button size="sm" variant="ghost" disabled={frames === 0} title="GIF loop count (cycles Forever → Once → 3×)"
          onClick={() => anim.setRepeat(anim.repeat() === -1 ? 0 : anim.repeat() === 0 ? 2 : -1)}>
          Loop: {anim.repeat() === -1 ? "∞" : anim.repeat() === 0 ? "1×" : `${anim.repeat() + 1}×`}
        </Button>
        <Button size="sm" variant={onion ? "primary" : "ghost"} disabled={frames === 0}
          title="Ghost the last captured frame over the canvas" onClick={() => store.toggleOnionSkin()}>Onion Skin</Button>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>{frames} frame{frames === 1 ? "" : "s"}</span>
      </div>
      <div className="monet-row" style={{ gap: 8, marginBottom: 8 }}>
        <span className="lbl" style={{ width: 70 }} title="Used by frames without their own delay">Default delay</span>
        <Slider value={(delay - 2) / 48} accent={ACCENT} onChange={(f) => setDelay(Math.round(2 + f * 48))} style={{ flex: 1 }} />
        <span className="val" style={{ fontFamily: "var(--font-mono)" }}>{delay * 10}ms</span>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>FX all frames:</span>
        <Button size="sm" variant="ghost" disabled={frames === 0} onClick={() => framesAdjust(4, [])}>Invert</Button>
        <Button size="sm" variant="ghost" disabled={frames === 0} onClick={() => framesAdjust(5, [])}>B&amp;W</Button>
        <Button size="sm" variant="ghost" disabled={frames === 0} onClick={() => framesAdjust(3, [0.5, 0.1])}>Vibrance</Button>
      </div>
      <div style={{ display: "flex", gap: 5, overflowX: "auto", paddingBottom: 4 }}>
        {Array.from({ length: frames }).map((_, i) => (
          <div key={i} style={{ position: "relative", flex: "0 0 auto" }}>
            <img src={anim.thumbUrl(i)} alt="" style={{ width: 64, height: 40, borderRadius: 3, boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.15)", display: "block" }} />
            <span style={{ position: "absolute", bottom: 1, left: 3, fontSize: 9, color: "#fff", textShadow: "0 1px 2px #000" }}>{i + 1}</span>
            <div style={{ width: 64, marginTop: 2 }} title="This frame's delay (ms)">
              <NumberField value={(anim.frameDelay(i) || delay) * 10} min={10} max={60000}
                onChange={(ms) => anim.setFrameDelay(i, Math.max(1, Math.round(ms / 10)))} suffix="ms" />
            </div>
            <span onClick={() => anim.deleteFrame(i)} title="Delete frame"
              style={{ position: "absolute", top: -5, right: -5, cursor: "pointer", fontSize: 10, background: "#000", color: "#fff", borderRadius: "50%", width: 15, height: 15, textAlign: "center", lineHeight: "15px", boxShadow: "0 0 0 1px rgba(255,255,255,0.3)" }}>×</span>
          </div>
        ))}
        {frames === 0 && <div style={{ fontSize: 11, color: "var(--text-3)", padding: 4 }}>Add frames to build an animation, then export a GIF.</div>}
      </div>
      <TimelineSection />
    </div>
  );
}

/** Keyframe Timeline: animate a layer's opacity + non-destructive position over
 *  time, then bake it into frames for GIF/video export. */
function TimelineSection() {
  const timeline = useStore((s) => s.timeline);
  const playhead = useStore((s) => s.playhead);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const { fps, durationS, keys } = timeline;
  return (
    <div style={{ marginTop: 12, borderTop: "1px solid rgba(255,255,255,0.08)", paddingTop: 10 }}>
      <div style={{ fontWeight: 600, fontSize: 12, marginBottom: 6 }}>Timeline <span style={{ fontWeight: 400, color: "var(--text-3)" }}>— keyframe motion (opacity + position)</span></div>
      <div className="monet-row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span className="lbl" style={{ width: 46 }}>Time</span>
        <Slider value={durationS ? playhead / durationS : 0} accent={ACCENT} onChange={(f) => store.timelineSetPlayhead(+(f * durationS).toFixed(2))} style={{ flex: 1 }} />
        <span className="val" style={{ fontFamily: "var(--font-mono)", width: 42 }}>{playhead.toFixed(2)}s</span>
      </div>
      <div className="monet-row" style={{ gap: 8, marginBottom: 8, alignItems: "center" }}>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>fps</span>
        <div style={{ width: 54, flexShrink: 0 }}><NumberField block aria-label="Frames per second" size="sm" value={fps} min={1} max={60} onChange={(v) => store.timelineSetFps(v)} /></div>
        <span style={{ fontSize: 11, color: "var(--text-3)" }}>dur&nbsp;(s)</span>
        <div style={{ width: 64, flexShrink: 0 }}><NumberField block aria-label="Duration in seconds" size="sm" value={durationS} min={0.1} max={60} step={0.1} onChange={(v) => store.timelineSetDuration(v)} /></div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 8, flexWrap: "wrap" }}>
        <Button size="sm" variant="ghost" disabled={!activeLayerId} title="Capture the active layer's opacity + position at the playhead" onClick={() => store.timelineAddKey(playhead)}>◆ Key active layer</Button>
        <Button size="sm" variant="primary" disabled={!keys.length} title="Bake the keyframe animation into frames, then Export GIF / Video" onClick={() => store.timelineRender()}>Render → Frames</Button>
      </div>
      {keys.length > 0 ? (
        <div style={{ maxHeight: 96, overflowY: "auto", fontSize: 11 }}>
          {keys.map((k, i) => (
            <div key={i} className="monet-row" style={{ gap: 6, alignItems: "center", padding: "1px 0" }}>
              <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-2)" }}>L{k.layerId}·{k.t.toFixed(2)}s</span>
              <span style={{ color: "var(--text-3)" }}>op {Math.round(k.opacity * 100)}% · {k.dx},{k.dy}</span>
              <span style={{ flex: 1 }} />
              <span onClick={() => store.timelineDeleteKey(i)} title="Delete keyframe" style={{ cursor: "pointer", color: "var(--text-3)" }}>×</span>
            </div>
          ))}
        </div>
      ) : (
        <div style={{ fontSize: 11, color: "var(--text-3)" }}>Move a layer or change its opacity, then key it at two times to animate. Render bakes the motion into frames for GIF/video export.</div>
      )}
    </div>
  );
}

// ── Character / Paragraph panels ───────────────────────────────
// Photoshop's dockable type panels: format the active type layer live, docked
// beside the canvas, while the on-canvas editor stays open — no modal covering
// the artwork. Character controls format the on-canvas *selection* (the whole
// layer when nothing is selected, Photoshop's rule); Paragraph controls are
// layer-level. The advanced bits (warp, layer effects, on-path options) still
// live in the Type dialog, reachable from the type options bar.

/** The run covering character `idx`. Mirrors the Type dialog's runAt — the
 *  panel needs it to show what the current selection is actually styled as. */
function runAtIndex(spec: TextSpec, idx: number): TextRun {
  let pos = 0;
  for (const r of spec.runs) { if (idx < pos + r.text.length) return r; pos += r.text.length; }
  return spec.runs[spec.runs.length - 1] ?? { text: "" };
}

/** The character range the Character panel formats: the editor's live selection
 *  clamped to the string, falling back to the whole layer when the selection is
 *  empty or absent (Photoshop formats everything when nothing is selected). */
function typeFormatRange(len: number, sel: readonly [number, number] | null): [number, number] {
  if (!sel) return [0, len];
  const a = Math.max(0, Math.min(len, Math.min(sel[0], sel[1])));
  const b = Math.max(0, Math.min(len, Math.max(sel[0], sel[1])));
  return a === b ? [0, len] : [a, b];
}

/** The on-canvas text editor's caret range, or null when it isn't open.
 *  ponytail: read straight off the overlay textarea — that DOM node is the only
 *  place the caret lives today, and it keeps its selection while the panel has
 *  focus. Publish the range on store.textEdit if a second consumer needs it. */
function editorSelection(): [number, number] | null {
  const el = typeof document === "undefined" ? null
    : document.querySelector<HTMLTextAreaElement>("textarea.mv-text-edit");
  if (!el) return null;
  return [el.selectionStart ?? 0, el.selectionEnd ?? 0];
}

const rgbaHex = (c: RGBA) => "#" + colorHexCode(c[0], c[1], c[2]);
const hexRgba = (h: string, a: number): RGBA => {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255, a];
};

/** Live mirror of the active type layer's spec. The engine owns it; we keep a
 *  local copy so the controlled inputs stay cursor-safe, and re-adopt the
 *  engine's copy whenever it changes underneath us (options bar, Type dialog,
 *  undo/redo). Same discipline as TypeToolbar. Null when the active layer is
 *  not a type layer. */
function useActiveTextSpec(): { spec: TextSpec; apply: (next: TextSpec) => void } | null {
  const activeLayerId = useStore((s) => s.activeLayerId);
  const layers = useStore((s) => s.layers);
  // `doc` is replaced on every engine sync, so this re-reads the spec after any
  // commit (undo/redo, the options bar, another panel).
  useStore((s) => s.doc);
  const pushed = useRef("");
  const [spec, setSpec] = useState<TextSpec | null>(null);
  const isText = layers.find((l) => l.id === activeLayerId)?.kind === LAYER_KIND.text;
  const engineSpec = isText ? text.get(activeLayerId) : null;
  const engineJson = engineSpec ? JSON.stringify(engineSpec) : "";
  let current = spec;
  if (engineJson !== pushed.current) { pushed.current = engineJson; setSpec(engineSpec); current = engineSpec; }
  if (!current) return null;
  return {
    spec: current,
    apply: (next: TextSpec) => { pushed.current = JSON.stringify(next); setSpec(next); text.apply(activeLayerId, next); },
  };
}

function TypeEmpty({ what }: { what: string }) {
  return <div style={{ fontSize: 11, color: "var(--text-3)", padding: 4 }}>Select a type layer to edit its {what}. Draw one with the Type tool (T).</div>;
}

/** One label + controls row, sized for a docked (narrow) panel. */
function TypeRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="monet-row" style={{ gap: 8, alignItems: "center", marginBottom: 6 }}>
      <span className="lbl" style={{ width: 58, flexShrink: 0 }}>{label}</span>
      <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "center", minWidth: 0 }}>{children}</div>
    </div>
  );
}

export function CharacterPanel() {
  const fontPreviewSize = useStore((s) => s.fontPreviewSize);
  const active = useActiveTextSpec();
  // The panel re-renders on every engine commit, but moving the caret in the
  // on-canvas editor commits nothing — so re-read the selection when the
  // pointer arrives, which is exactly when you're about to change something.
  const [, bumpCaret] = useState(0);
  if (!active) return <TypeEmpty what="characters" />;
  const { spec, apply } = active;

  const len = text.fullText(spec).length;
  const [a, b] = typeFormatRange(len, editorSelection());
  const whole = a === 0 && b === len;
  const charPatch = (p: Partial<TextRun>) => apply({ ...spec, runs: text.applyRangeFormat(spec.runs, a, b, p) });
  const patch = (p: Partial<TextSpec>) => apply({ ...spec, ...p });
  const st = text.resolveStyle(spec, runAtIndex(spec, a));

  const fontOpts = text.FONTS.map((f) => ({
    value: f,
    label: f.split(",")[0].replace(/['"]/g, ""),
    style: fontPreviewOptionStyle(f, fontPreviewSize),
  }));
  // The family's real faces (Light / Semibold / Condensed Black …) and, for a
  // variable face, its design axes. Both come from the host font scan; in the
  // browser build the styles fall back to the generic four and there are no axes.
  const styles = fontStyles(st.font);
  const axes = fontAxes(st.font, st.face);
  const axisValue = (tag: string, def: number) => (tag === "wght" ? st.weight : st.axes[tag] ?? def);
  // Change only this dimension; each selected run keeps its own face and other styles/axes.
  const setAxis = (tag: string, v: number) =>
    charPatch(tag === "wght" ? { weight: v } : { axes: { [tag]: v } });

  return (
    <div data-mv-character-panel onPointerEnter={() => bumpCaret((n) => n + 1)}>
      <div style={{ fontSize: 11, color: "var(--text-3)", marginBottom: 6 }} data-mv-type-scope={whole ? "all" : `${a}-${b}`}>
        {whole ? "Formatting the whole layer" : `Formatting characters ${a}–${b}`}
      </div>
      <TypeRow label="Font">
        <Select block size="sm" aria-label="Font" options={fontOpts} value={st.font} onChange={(v) => charPatch({ font: v })} />
      </TypeRow>
      <TypeRow label="Style">
        <Select block size="sm" aria-label="Font style" value={matchFontStyle(styles, st.weight, st.italic, st.face)}
          options={styles.map((f) => ({ value: f.value, label: f.label }))}
          onChange={(v) => { const p = fontStylePatch(st.font, v); if (p) charPatch(p); else engine.onEditError?.(unknownFontStyleMessage(st.font)); }} />
      </TypeRow>
      {/* Variable-font axes, straight off the face's `fvar`. `wght` is the run's
          numeric weight (CSS font-weight IS that axis); the rest ride along in
          run.axes as font-variation-settings. */}
      {axes.map((ax) => (
        <TypeRow key={ax.tag} label={axisLabel(ax.tag)}>
          <Slider accent={ACCENT} aria-label={axisLabel(ax.tag)} style={{ flex: 1 }}
            value={axisValue(ax.tag, ax.def)} min={ax.min} max={ax.max} step={axisStep(ax)}
            onChange={(v) => setAxis(ax.tag, v)} />
          <span className="val" style={{ width: 34, textAlign: "right", fontFamily: "var(--font-mono)" }}>
            {Number(axisValue(ax.tag, ax.def).toFixed(2))}
          </span>
        </TypeRow>
      ))}
      <TypeRow label="Size">
        <NumberField block size="sm" aria-label="Size" value={Math.round(st.size)} min={1} max={800} suffix="px" onChange={(v) => charPatch({ size: v })} />
        {/* ponytail: leading is a layer attribute (TextSpec.leading) — mixed
            leading inside one paragraph needs TextRun.leading in text/spec.ts
            plus a per-line resolve in text/raster.ts. */}
        <NumberField block size="sm" aria-label="Leading" value={Math.round(spec.leading)} min={0} max={400} suffix="ld" onChange={(v) => patch({ leading: v })} />
      </TypeRow>
      <TypeRow label="Tracking">
        <NumberField block size="sm" aria-label="Tracking" value={Math.round(st.tracking)} min={-50} max={200} onChange={(v) => charPatch({ tracking: v })} />
        <NumberField block size="sm" aria-label="Baseline shift" value={Math.round(st.baseline)} min={-200} max={200} suffix="bl" onChange={(v) => charPatch({ baseline: v })} />
      </TypeRow>
      <TypeRow label="Scale">
        <NumberField block size="sm" aria-label="Horizontal scale" value={Math.round(st.hScale * 100)} min={10} max={400} suffix="%H" onChange={(v) => charPatch({ hScale: v / 100 })} />
        <NumberField block size="sm" aria-label="Vertical scale" value={Math.round(st.vScale * 100)} min={10} max={400} suffix="%V" onChange={(v) => charPatch({ vScale: v / 100 })} />
      </TypeRow>
      <TypeRow label="Kerning">
        <Select block size="sm" aria-label="Kerning" options={text.KERNING.map((k) => ({ value: k, label: text.KERNING_LABELS[k] }))}
          value={st.kerning} onChange={(v) => charPatch({ kerning: v as TextRun["kerning"] })} />
      </TypeRow>
      <TypeRow label="Emphasis">
        <Checkbox checked={st.bold} aria-label="Bold" onChange={(v) => charPatch({ weight: v ? 700 : 400, bold: v })}><span style={{ fontWeight: 800 }}>B</span></Checkbox>
        <Checkbox checked={st.italic} aria-label="Italic" onChange={(v) => charPatch({ italic: v })}><span style={{ fontStyle: "italic", fontFamily: "Georgia, serif" }}>I</span></Checkbox>
        <Checkbox checked={st.underline} aria-label="Underline" onChange={(v) => charPatch({ underline: v })}><span style={{ textDecoration: "underline" }}>U</span></Checkbox>
        <Checkbox checked={st.strike} aria-label="Strikethrough" onChange={(v) => charPatch({ strike: v })}><span style={{ textDecoration: "line-through" }}>S</span></Checkbox>
      </TypeRow>
      <TypeRow label="Faux">
        <Checkbox checked={st.fauxBold} aria-label="Faux bold" onChange={(v) => charPatch({ fauxBold: v })}>Bold</Checkbox>
        <Checkbox checked={st.fauxItalic} aria-label="Faux italic" onChange={(v) => charPatch({ fauxItalic: v })}>Italic</Checkbox>
      </TypeRow>
      <TypeRow label="Break">
        {/* wrapPara (raster.ts) turns a no-break run into one unbreakable,
            unhyphenatable token — spaces inside it included ("New York" holds). */}
        <Checkbox checked={st.noBreak} aria-label="No break" onChange={(v) => charPatch({ noBreak: v })}>No Break</Checkbox>
      </TypeRow>
      <TypeRow label="Case">
        <Select block size="sm" aria-label="Case" value={st.caps} onChange={(v) => charPatch({ caps: v as TextRun["caps"] })}
          options={[{ value: "none", label: "Normal" }, { value: "all", label: "ALL CAPS" }, { value: "small", label: "Small Caps" }]} />
        <Select block size="sm" aria-label="Position" value={st.script} onChange={(v) => charPatch({ script: v as TextRun["script"] })}
          options={[{ value: "none", label: "Baseline" }, { value: "super", label: "Super" }, { value: "sub", label: "Sub" }]} />
      </TypeRow>
      <TypeRow label="Color">
        <input type="color" aria-label="Text color" value={rgbaHex(st.color)} onChange={(e) => charPatch({ color: hexRgba(e.target.value, st.color[3]) })}
          style={{ width: 34, height: 24, border: "none", background: "none", padding: 0, cursor: "pointer" }} />
        <NumberField block size="sm" aria-label="Text opacity" value={st.color[3]} min={0} max={255} suffix="α"
          onChange={(v) => charPatch({ color: [st.color[0], st.color[1], st.color[2], v] })} />
      </TypeRow>
      <TypeRow label="Anti-alias">
        <Select block size="sm" aria-label="Anti-alias" options={text.ANTIALIAS.map((x) => ({ value: x, label: text.ANTIALIAS_LABELS[x] }))}
          value={spec.antialias} onChange={(v) => patch({ antialias: v as TextSpec["antialias"] })} />
      </TypeRow>
    </div>
  );
}

export function ParagraphPanel() {
  const active = useActiveTextSpec();
  if (!active) return <TypeEmpty what="paragraphs" />;
  const { spec, apply } = active;
  const patch = (p: Partial<TextSpec>) => apply({ ...spec, ...p });
  // Resolved (default-filled) Hyphenation / Justification, mirroring what
  // text/raster.ts actually composes with (hyphenationOf / justificationOf).
  const hy = text.hyphenationOf(spec);
  const ju = text.justificationOf(spec);
  const hyPatch = (p: Partial<Hyphenation>) => patch({ hyphenation: { ...spec.hyphenation, ...p } });
  const juPatch = (p: Partial<Justification>) => patch({ justification: { ...spec.justification, ...p } });

  return (
    <div data-mv-paragraph-panel>
      {/* Five alignments don't fit a docked panel as pills — a Select keeps
          every option reachable at any panel width. */}
      <TypeRow label="Align">
        <Select block size="sm" aria-label="Align" value={spec.align} onChange={(v) => patch({ align: v as Align })}
          options={text.ALIGNMENTS.map((x) => ({ value: x.id, label: x.label }))} />
      </TypeRow>
      <TypeRow label="Box">
        <SegmentedControl accent={ACCENT} value={spec.kind} onChange={(v) => patch({ kind: v as TextSpec["kind"] })}
          items={[{ value: "point", label: "Point" }, { value: "paragraph", label: "Paragraph" }]} />
      </TypeRow>
      {spec.kind === "paragraph" && (
        <TypeRow label="Size">
          <NumberField block size="sm" aria-label="Box width" value={Math.round(spec.boxW)} min={16} max={4000} suffix="w" onChange={(v) => patch({ boxW: v })} />
          <NumberField block size="sm" aria-label="Box height" value={Math.round(spec.boxH)} min={0} max={4000} suffix="h" onChange={(v) => patch({ boxH: v })} />
        </TypeRow>
      )}
      <TypeRow label="Indent">
        <NumberField block size="sm" aria-label="First line indent" value={Math.round(spec.firstIndent)} min={-400} max={400} suffix="1st" onChange={(v) => patch({ firstIndent: v })} />
        <NumberField block size="sm" aria-label="Left indent" value={Math.round(spec.leftIndent)} min={0} max={400} suffix="L" onChange={(v) => patch({ leftIndent: v })} />
        <NumberField block size="sm" aria-label="Right indent" value={Math.round(spec.rightIndent)} min={0} max={400} suffix="R" onChange={(v) => patch({ rightIndent: v })} />
      </TypeRow>
      <TypeRow label="Space">
        <NumberField block size="sm" aria-label="Space before" value={Math.round(spec.spaceBefore)} min={0} max={400} suffix="↑" onChange={(v) => patch({ spaceBefore: v })} />
        <NumberField block size="sm" aria-label="Space after" value={Math.round(spec.spaceAfter)} min={0} max={400} suffix="↓" onChange={(v) => patch({ spaceAfter: v })} />
      </TypeRow>
      <TypeRow label="Direction">
        <SegmentedControl accent={ACCENT} value={spec.direction ?? "ltr"} onChange={(v) => patch({ direction: v as TextSpec["direction"] })}
          items={text.DIRECTIONS.map((d) => ({ value: d.id, label: d.label }))} />
      </TypeRow>
      <TypeRow label="Composer">
        <Select block size="sm" aria-label="Composer" options={text.COMPOSERS.map((c) => ({ value: c.id, label: c.label }))}
          value={spec.composer ?? "latin"} onChange={(v) => patch({ composer: v as TextSpec["composer"] })} />
      </TypeRow>
      <TypeRow label="Kashida">
        <Select block size="sm" aria-label="Kashidas" options={text.KASHIDAS.map((k) => ({ value: k.id, label: k.label }))}
          value={spec.kashida ?? "none"} onChange={(v) => patch({ kashida: v as TextSpec["kashida"] })} />
      </TypeRow>
      <TypeRow label="Hyphenate">
        <Checkbox checked={!!spec.hyphenate} aria-label="Hyphenate" onChange={(v) => patch({ hyphenate: v })}>Hyphenate</Checkbox>
      </TypeRow>
      {/* Roman Hanging Punctuation: the renderer has always supported this
          (raster.ts `hangOn`), but nothing set the flag, so it was unreachable.
          Paragraph type, left-to-right only — the renderer ignores it otherwise. */}
      <TypeRow label="Hanging">
        <Checkbox checked={!!spec.hangingPunctuation} aria-label="Roman hanging punctuation"
          onChange={(v) => patch({ hangingPunctuation: v })}>Roman Hanging Punctuation</Checkbox>
      </TypeRow>
      {spec.hyphenate && (
        <>
          <TypeRow label="Word Len">
            <NumberField block size="sm" aria-label="Words longer than" value={hy.wordsLongerThan} min={1} max={30} suffix="≥" onChange={(v) => hyPatch({ wordsLongerThan: v })} />
            <NumberField block size="sm" aria-label="After first" value={hy.afterFirst} min={1} max={15} suffix="aft" onChange={(v) => hyPatch({ afterFirst: v })} />
          </TypeRow>
          <TypeRow label="Hyphen">
            <NumberField block size="sm" aria-label="Before last" value={hy.beforeLast} min={1} max={15} suffix="bef" onChange={(v) => hyPatch({ beforeLast: v })} />
            <NumberField block size="sm" aria-label="Hyphen limit" value={hy.hyphenLimit} min={0} max={20} suffix="lim" onChange={(v) => hyPatch({ hyphenLimit: v })} />
          </TypeRow>
          <TypeRow label="Zone">
            <NumberField block size="sm" aria-label="Hyphenation zone" value={hy.zone} min={0} max={400} suffix="px" onChange={(v) => hyPatch({ zone: v })} />
          </TypeRow>
        </>
      )}
      <TypeRow label="Line Break">
        <Select block size="sm" aria-label="Line composer" options={text.LINE_COMPOSERS.map((c) => ({ value: c.id, label: c.label }))}
          value={spec.lineComposer ?? "single"} onChange={(v) => patch({ lineComposer: v as TextSpec["lineComposer"] })} />
      </TypeRow>
      <TypeRow label="Word %">
        <NumberField block size="sm" aria-label="Word spacing minimum" value={ju.wordMin} min={0} max={1000} suffix="min" onChange={(v) => juPatch({ wordMin: v })} />
        <NumberField block size="sm" aria-label="Word spacing maximum" value={ju.wordMax} min={0} max={1000} suffix="max" onChange={(v) => juPatch({ wordMax: v })} />
      </TypeRow>
      <TypeRow label="Letter %">
        <NumberField block size="sm" aria-label="Letter spacing minimum" value={ju.letterMin} min={-100} max={500} suffix="min" onChange={(v) => juPatch({ letterMin: v })} />
        <NumberField block size="sm" aria-label="Letter spacing maximum" value={ju.letterMax} min={-100} max={500} suffix="max" onChange={(v) => juPatch({ letterMax: v })} />
      </TypeRow>
      <TypeRow label="Glyph %">
        <NumberField block size="sm" aria-label="Glyph scaling minimum" value={ju.glyphMin} min={50} max={200} suffix="min" onChange={(v) => juPatch({ glyphMin: v })} />
        <NumberField block size="sm" aria-label="Glyph scaling maximum" value={ju.glyphMax} min={50} max={200} suffix="max" onChange={(v) => juPatch({ glyphMax: v })} />
      </TypeRow>
      <TypeRow label="Auto Lead">
        <NumberField block size="sm" aria-label="Auto leading" value={ju.autoLeading} min={0} max={500} suffix="%" onChange={(v) => juPatch({ autoLeading: v })} />
      </TypeRow>
    </div>
  );
}
