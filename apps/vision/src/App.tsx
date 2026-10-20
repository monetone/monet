// ─────────────────────────────────────────────────────────────
// Monet Vision — the application shell. Composes the Monet dockable
// workspace: tool rail, per-tool options bar, wired panels, menus,
// status bar and the document canvas, all driven by the Rust engine.
// ─────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useCallback, useSyncExternalStore } from "react";
import {
  DockableWorkspace, ToolRail, OptionsBar, Canvas, StatusBar, Slider, Checkbox,
  SegmentedControl, Select, ToastProvider, useToast, useMonetContext, useFileDrop, Input, NumberField, BLEND_MODES, Icon, dockLayoutPanelIds, isDropdownOpen, isEditableTarget, type FileDropPoint, type Platform,
  type DockableWorkspaceHandle, type DockLayout, type ToolbarLayout,
} from "@monet-ui/monet-react";
import { isTauri } from "@tauri-apps/api/core";
import { engine, store, useStore, commandPalette, adj, fil, runCliJob, repeatLastFilter, xform, canRepeatLastTransform, repeatLastTransform, copyLayerCSS, copyLayerSVG, exportLayersToFiles, exportLayerCompsToFiles, exportLayerCompsToPDF, exportPNG, printDocument, exportJPEG, quickExportSelectedLayers, exportSizes, exportContentCredentials, exportSignedContentCredentials, exportPSD, exportPSB, exportPSDCMYK, exportOriginalPhotoshop, exportGIF, exportTIFF, exportWebP, exportWebPLossy, exportHDR, exportEXR, exportHEIC, exportDNG, exportAVIF, exportTGA, exportPPM, exportPCX, exportVideo, exportPathsSVG, exportDocumentSVG, exportArtboardsToFiles, exportArtboardsToPDF, exportPDF, exportPDFX1a, exportPDFX4, exportColorLUT, importColorLutFile, exportZoomify, toggleImageAssetsGenerator, contactSheet, picturePackage, cropAndStraightenPhotos, pdfPresentation, browseAndRunScript, openDroppedFiles, openDroppedPaths, openAsSmartObject, placeImageFile, placeLinkedImage, openFiles, openPaths, revertDocument, loadFilesIntoStack, loadMultipleDicomFiles, importVideoFramesToLayers, importNotesFile, saveDocument, saveDocumentAs, saveDocumentAsCopy, packageDocument, closeDocumentTab, frequencySeparation, smart, patchSelection, exposureFusion, puppetWarp, commitPuppetWarp, cancelPuppetWarp, generativeFill, openGifFile, ml, models, text, dataVars, exportLiquifyMeshFile, importLiquifyMeshFile, pngToImageData, cascadeFloats } from "./state/app";
import { hsvToRgba, arrangeColumns, viewOf, type ArrangeMode, type ToolId, type DocSummary, type LiquifyBackdropSource } from "./state/store";
import { isVisionFileDropTarget } from "./state/fileDropTarget";
import { LAYER_KIND } from "./state/engineContracts";
import { hiddenPanelsPeek } from "./state/preferencePanes";
import { FX } from "./state/effects";
import { CanvasView } from "./canvas/CanvasView";
import { getPuppetRev, getPuppetSession, subscribePuppet } from "./state/puppetWarp";
import { FloatWindows } from "./native/FloatWindows";
import { fitFloatRect } from "./canvas/vanishingPoint";
import { DialogProvider, useDialogs, TypeToolbar, VectorMaskPathOp } from "./ui/Dialogs";
import { AdaptiveWideAngle } from "./ui/AdaptiveWideAngle";
import { GradientBar } from "./ui/GradientBar";
import { LayersPanel, ColorPanel, AdjustmentsPanel, HistoryPanel, ActionsPanel, PropertiesPanel, MeasurementLogPanel, InfoPanel, HistogramPanel, ChannelsPanel, AnimationPanel, NotesPanel, SwatchesPanel, BrushesPanel, NavigatorPanel, PathsPanel, LayerCompsPanel, LibrariesPanel, StylesPanel, CharacterPanel, ParagraphPanel, CloneSourcePanel } from "./ui/Panels";
import { CROP_ASPECTS } from "./state/cropAspect";
import { ARTBOARD_PRESETS } from "./state/artboardTool";
import { ARTBOARD_BACKGROUNDS, artboardBackgroundChoice, artboardBackgroundHex, resolveArtboardBackground, toArtboardBackground, type ArtboardBackground, type RGBA as ArtboardRGBA } from "./state/artboardBackground";
import { CUSTOM_GRADIENT, gradientByName, gradientPresetFor } from "./state/gradientPresets";
import { CLONE_SAMPLE_MODES } from "./state/cloneSample";
import { CROP_OVERLAYS, nextCropOverlay, nextCropOverlayOrientation } from "./state/cropOverlay";
import { straightenAngle } from "./state/straighten";
import type { PathTransform } from "./state/transformControls";
import { formatStatusInfo, STATUS_INFO_MODES, type StatusInfoMode } from "./state/statusInfo";
import { stepBrushSize, stepBrushHardness } from "./state/brushShortcuts";
import { SEPARABLE_BLEND_MODES } from "./state/blendModes";
import { codeDigit, digitOpacity, digitSequencePercent, DIGIT_SEQUENCE_MS, isOpacityTool } from "./state/opacityShortcuts";
import { parseZoomField } from "./state/zoomField";
import { defaultColors } from "@monet-ui/monet-color";
import { clampFeather, supportsFeather } from "./state/selectionFeather";
import { normalizeFixedSize } from "./state/marqueeStyle";
import { LIQUIFY_MODES, LIQUIFY_RECONSTRUCT_MODES, LIQUIFY_TOOL_MODES } from "./state/liquify";
import { syncMacMenu } from "./native/macMenu";
import { historyTransactionActive } from "./engine/historyTransaction";
import { installOpenFilesListener } from "./native/openFiles";
import { installCliListener, isCliBoot } from "./native/cli";
import { NO_HIDDEN, buildPhotoshopMenus, imageModeCheckedIds, loadHiddenMenuCommands, nameUndoItem, viewToggleCheckedIds } from "./ui/psMenus";
import { Home } from "./ui/Home";
import { AppInfoPanel } from "./ui/AppInfoPanel";
import { OPENTYPE_FEATURE_TAGS, type TextSpec } from "./text/spec";
import {
  applyShortcutOverrides,
  collectShortcutCommands,
  shortcutCommandMap,
  shortcutFromEvent,
  TOOL_ACTION_SHORTCUT_DEFAULTS,
  toolShortcutFromEvent,
  type ShortcutCommand,
  type ShortcutOverrides,
} from "./state/keyboardShortcuts";

import { TOOL_DEFS, configuredToolRail, validateToolbarConfiguration, type ToolbarConfiguration } from "./state/toolRail";
import { ExtraTools } from "./ui/CustomizeToolbar";
import { PANEL_ICONS } from "./ui/panelIcons";
export { TOOLS } from "./state/toolRail";

const ACCENT = "var(--accent-raster)";

// Tab / ⇧Tab chrome hiding — the counterpart of the Screen Mode rules in
// styles.css, keyed off [data-mv-chrome-hidden] on <html>. Panel docks, floats
// and their splitters go at either level; the relocatable toolbars (tool rail +
// options bar) only at "all", which is exactly the Tab vs ⇧Tab difference.
// ponytail: carried inline because styles.css is owned elsewhere this pass —
// move it next to the html[data-mv-screen-mode="full"] block when merging.
// Home start screen (#476): the menu commands that stay live with no document
// open — the ones that create/open one, and preferences. Everything else in the
// registered action table needs an engine and is disabled at the dispatcher.
const NO_DOCUMENT_COMMANDS = /^(new|openf|clearrecent|browse|search|colorsettings|pref[a-z]*|exportprefs|customizetoolbar)$/;

const CHROME_HIDE_CSS = `
html[data-mv-chrome-hidden] .monet-dock,
html[data-mv-chrome-hidden] .monet-float,
html[data-mv-chrome-hidden] .monet-split,
html[data-mv-chrome-hidden] .mv-taskbar { display: none !important; }
html[data-mv-chrome-hidden="all"] .monet-toolbar,
html[data-mv-chrome-hidden="all"] .monet-tb-lanes,
html[data-mv-chrome-hidden="all"] .monet-tb-strip { display: none !important; }
html[data-mv-chrome-peek="left"] .monet-dock--left,
html[data-mv-chrome-peek="right"] .monet-dock--right { display: flex !important; position: absolute; top: 0; bottom: 0; z-index: 12; }
html[data-mv-chrome-peek="left"] .monet-dock--left { left: 0; }
html[data-mv-chrome-peek="right"] .monet-dock--right { right: 0; }
`;

// Brush Mode (blend) options: the separable modes plus the four non-separable
// ones (indices 21–24 match the engine's BlendMode::from_u8). Group-only modes
// (Pass Through) are excluded — they don't apply to a paint dab.
const BRUSH_BLEND_MODES: { value: number; label: string }[] = [
  { value: 0, label: "Normal" },
  // Behind / Clear are brush-specific composites, not layer blends (negative
  // sentinels decoded in store.pushBrush → set_brush_paint_mode).
  { value: -1, label: "Behind" },
  { value: -2, label: "Clear" },
  ...SEPARABLE_BLEND_MODES.filter((m) => m.value !== 0).map((m) => ({ value: m.value, label: m.label })),
  { value: 21, label: "Hue" },
  { value: 22, label: "Saturation" },
  { value: 23, label: "Color" },
  { value: 24, label: "Luminosity" },
];

// Mixer Brush ▸ Useful Combinations (Photoshop's Dry / Moist / Wet / Very Wet:
// Wet 0/10/50/100, Load 50, Mix 0/10/50/100). Photoshop's Mix is the CANVAS
// share of the deposit; ours is the reservoir share, so it maps to 1 − Mix.
const MIXER_PRESETS: { id: string; label: string; wet: number; load: number; mix: number }[] = [
  { id: "dry", label: "Dry", wet: 0, load: 0.5, mix: 1 },
  { id: "moist", label: "Moist", wet: 0.1, load: 0.5, mix: 0.9 },
  { id: "wet", label: "Wet", wet: 0.5, load: 0.5, mix: 0.5 },
  { id: "veryWet", label: "Very Wet", wet: 1, load: 0.5, mix: 0 },
];

const LIQUIFY_BACKDROP_SOURCES: { value: LiquifyBackdropSource; label: string }[] = [
  { value: "all", label: "All Layers" },
  { value: "active", label: "Active Layer" },
  { value: "behind", label: "Behind Active Layer" },
];

// One editable binding per Photoshop flyout group. Shift cycles its members.
// Groups with no Photoshop default remain assignable instead of inventing one.
export const TOOL_SHORTCUT_GROUPS: {
  id: string; label: string; defaultChord: string | null; tools: ToolId[];
}[] = [
  { id: "tool-v", label: "Move / Artboard tools", defaultChord: "KeyV", tools: ["move", "artboard"] },
  { id: "tool-m", label: "Marquee tools", defaultChord: "KeyM", tools: ["marquee", "ellipse", "singlerow", "singlecolumn"] },
  { id: "tool-l", label: "Lasso tools", defaultChord: "KeyL", tools: ["lasso", "polylasso", "magneticlasso"] },
  { id: "tool-w", label: "Selection tools", defaultChord: "KeyW", tools: ["wand", "quickselection", "objectselection"] },
  { id: "tool-c", label: "Crop / Slice tools", defaultChord: "KeyC", tools: ["crop", "slice", "sliceselect"] },
  { id: "tool-k", label: "Frame tool", defaultChord: "KeyK", tools: ["frame"] },
  { id: "tool-j", label: "Healing tools", defaultChord: "KeyJ", tools: ["remove", "spothealing", "heal", "patch", "contentawaremove", "redeye"] },
  { id: "tool-b", label: "Brush tools", defaultChord: "KeyB", tools: ["brush", "pencil", "colorreplace", "mixerbrush"] },
  { id: "tool-adjustment", label: "Adjustment Brush tool", defaultChord: null, tools: ["adjustmentbrush"] },
  { id: "tool-s", label: "Clone tools", defaultChord: "KeyS", tools: ["clone", "patternstamp", "vanishingpoint"] },
  { id: "tool-y", label: "History Brush tool", defaultChord: "KeyY", tools: ["historybrush"] },
  { id: "tool-e", label: "Eraser tools", defaultChord: "KeyE", tools: ["erase", "backgrounderaser", "magiceraser"] },
  { id: "tool-g", label: "Gradient / Paint Bucket tools", defaultChord: "KeyG", tools: ["gradient", "bucket"] },
  { id: "tool-o", label: "Dodge / Burn / Sponge tools", defaultChord: "KeyO", tools: ["dodge", "burn", "sponge"] },
  { id: "tool-p", label: "Pen tools", defaultChord: "KeyP", tools: ["pen", "freeformpen", "curvaturepen", "addanchor", "deleteanchor", "convertpoint"] },
  { id: "tool-t", label: "Type tools", defaultChord: "KeyT", tools: ["text", "verticaltype", "horizontaltypemask", "verticaltypemask"] },
  { id: "tool-a", label: "Path Selection tools", defaultChord: "KeyA", tools: ["pathselect", "directselect"] },
  { id: "tool-u", label: "Shape tool", defaultChord: "KeyU", tools: ["shape"] },
  { id: "tool-i", label: "Eyedropper / Measure tools", defaultChord: "KeyI", tools: ["dropper", "colorsampler", "ruler", "count", "note"] },
  { id: "tool-h", label: "Hand tool", defaultChord: "KeyH", tools: ["hand"] },
  { id: "tool-r", label: "Rotate View tool", defaultChord: "KeyR", tools: ["rotateview"] },
  { id: "tool-z", label: "Zoom tool", defaultChord: "KeyZ", tools: ["zoom"] },
  { id: "tool-focus", label: "Blur / Sharpen / Smudge / Liquify tools", defaultChord: null, tools: ["blur", "sharpen", "smudge", "liquify"] },
];

const TOOL_ACTION_SHORTCUTS: Omit<ShortcutCommand, "chord">[] = [
  {
    id: "tool-d", label: "Default Foreground/Background Colors", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-d"],
    run: () => {
      const colors = defaultColors(store.state.maskEdit, store.state.quickMask);
      store.setForeground(colors.fg);
      store.setBackground(colors.bg);
    },
  },
  { id: "tool-x", label: "Switch Foreground/Background Colors", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-x"], run: () => store.swapColors() },
  { id: "tool-q", label: "Toggle Quick Mask Mode", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-q"], run: () => store.toggleQuickMask() },
  { id: "tool-mask-rubylith", label: "Toggle Layer Mask Rubylith Preview", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-mask-rubylith"], run: () => store.toggleMaskRubylith() },
  {
    id: "tool-screen-mode", label: "Toggle Screen Modes", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-screen-mode"],
    run: () => store.cycleScreenMode(), shiftRun: () => store.cycleScreenMode(true),
  },
  {
    id: "tool-brush-size-decrease", label: "Decrease Brush Size", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-size-decrease"], repeatable: true,
    run: () => store.setBrush({ size: stepBrushSize(store.state.brush.size, -1) }),
  },
  {
    id: "tool-brush-size-increase", label: "Increase Brush Size", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-size-increase"], repeatable: true,
    run: () => store.setBrush({ size: stepBrushSize(store.state.brush.size, 1) }),
  },
  {
    id: "tool-brush-hardness-decrease", label: "Decrease Brush Hardness", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-hardness-decrease"], repeatable: true,
    run: () => store.setBrush({ hardness: stepBrushHardness(store.state.brush.hardness, -1) }),
  },
  {
    id: "tool-brush-hardness-increase", label: "Increase Brush Hardness", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-hardness-increase"], repeatable: true,
    run: () => store.setBrush({ hardness: stepBrushHardness(store.state.brush.hardness, 1) }),
  },
  {
    id: "tool-brush-preset-previous", label: "Select Previous Brush Preset", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-preset-previous"],
    run: () => store.navigateBrushPresets(-1),
  },
  {
    id: "tool-brush-preset-next", label: "Select Next Brush Preset", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-preset-next"],
    run: () => store.navigateBrushPresets(1),
  },
  {
    id: "tool-brush-preset-first", label: "Select First Brush Preset", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-preset-first"],
    run: () => store.navigateBrushPresets(-1, true),
  },
  {
    id: "tool-brush-preset-last", label: "Select Last Brush Preset", defaultChord: TOOL_ACTION_SHORTCUT_DEFAULTS["tool-brush-preset-last"],
    run: () => store.navigateBrushPresets(1, true),
  },
];

const BAR_BTN: React.CSSProperties = {
  font: "inherit", fontSize: 11, padding: "2px 10px", borderRadius: 4,
  border: "1px solid var(--border-1, #3a3f48)", background: "var(--surface-2, #2a2e35)",
  color: "var(--text-1)", cursor: "pointer",
};
// Square variant for icon-only options-bar buttons (align / distribute / spacing).
const BAR_ICON_BTN: React.CSSProperties = {
  ...BAR_BTN, padding: "3px 6px", display: "inline-flex", alignItems: "center", justifyContent: "center",
};

// Align / distribute / spacing glyphs on the 16×16 @monet-ui Icon grid. Align
// icons are monoline (a reference edge + two bars pinned to it); distribute /
// spacing icons are filled bars whose varying widths/positions show which edge
// (left/centre/right · top/middle/bottom) is being equalized.
const ALIGN_ICON = {
  left: "M2.5 2.5v11M2.5 5.5h8M2.5 10.5h5",
  hcenter: "M8 2.5v11M3.5 5.5h9M5.5 10.5h5",
  right: "M13.5 2.5v11M5.5 5.5h8M8.5 10.5h5",
  top: "M2.5 2.5h11M5.5 2.5v8M10.5 2.5v5",
  vcenter: "M2.5 8h11M5.5 3.5v9M10.5 5.5v5",
  bottom: "M2.5 13.5h11M5.5 5.5v8M10.5 8.5v5",
} as const;
const DIST_ICON = {
  left: "M1.5 4h2v8h-2zM6.5 4h3v8h-3zM11.5 4h2.5v8h-2.5z",
  hcenter: "M2 4h2v8h-2zM6 4h4v8h-4zM12 4h2v8h-2z",
  right: "M2.5 4h2v8h-2zM6.5 4h3v8h-3zM12 4h2.5v8h-2.5z",
  top: "M4 1.5h8v2h-8zM4 6.5h8v3h-8zM4 11.5h8v2.5h-8z",
  vcenter: "M4 2h8v2h-8zM4 6h8v4h-8zM4 12h8v2h-8z",
  bottom: "M4 2.5h8v2h-8zM4 6.5h8v3h-8zM4 12h8v2.5h-8z",
  hspace: "M2 4h1.6v8h-1.6zM7.2 4h1.6v8h-1.6zM12.4 4h1.6v8h-1.6z",
  vspace: "M4 2h8v1.6h-8zM4 7.2h8v1.6h-8zM4 12.4h8v1.6h-8z",
} as const;
// The Align / Distribute / Spacing button strip the Move tool (layers) and the
// Path Selection tool (path components, #456) share; only the target differs.
function alignDistributeGroups(onAlign: (mode: number) => void, onDistribute: (axis: number, key: number) => void) {
  const align = (id: string, mode: number, title: string, icon: string) => (
    <button key={id} id={id} style={BAR_ICON_BTN} title={title} aria-label={title} onClick={() => onAlign(mode)}><Icon d={icon} size={14} /></button>
  );
  const dist = (id: string, axis: number, key: number, title: string, icon: string) => (
    <button key={id} id={id} style={BAR_ICON_BTN} title={title} aria-label={title} onClick={() => onDistribute(axis, key)}><Icon d={icon} size={14} fill /></button>
  );
  return (
    <>
      <OptionsBar.Group>
        <span style={{ color: "var(--text-3)" }}>Align</span>
        {align("mv-align-left", 0, "Align left edges", ALIGN_ICON.left)}
        {align("mv-align-hcenter", 1, "Align horizontal centers", ALIGN_ICON.hcenter)}
        {align("mv-align-right", 2, "Align right edges", ALIGN_ICON.right)}
        {align("mv-align-top", 3, "Align top edges", ALIGN_ICON.top)}
        {align("mv-align-vcenter", 4, "Align vertical centers", ALIGN_ICON.vcenter)}
        {align("mv-align-bottom", 5, "Align bottom edges", ALIGN_ICON.bottom)}
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{ color: "var(--text-3)" }}>Distribute</span>
        {dist("mv-dist-left", 0, 0, "Distribute left edges", DIST_ICON.left)}
        {dist("mv-dist-hcenter", 0, 1, "Distribute horizontal centers", DIST_ICON.hcenter)}
        {dist("mv-dist-right", 0, 2, "Distribute right edges", DIST_ICON.right)}
        {dist("mv-dist-top", 1, 0, "Distribute top edges", DIST_ICON.top)}
        {dist("mv-dist-vcenter", 1, 1, "Distribute vertical centers", DIST_ICON.vcenter)}
        {dist("mv-dist-bottom", 1, 2, "Distribute bottom edges", DIST_ICON.bottom)}
      </OptionsBar.Group>
      <OptionsBar.Group>
        <span style={{ color: "var(--text-3)" }}>Spacing</span>
        {dist("mv-dist-hspace", 0, 3, "Distribute horizontal spacing", DIST_ICON.hspace)}
        {dist("mv-dist-vspace", 1, 3, "Distribute vertical spacing", DIST_ICON.vspace)}
      </OptionsBar.Group>
    </>
  );
}
const PEN_HINT: Record<string, string> = {
  pen: "Click to add anchor points; double-click or Enter to close the path.",
  freeformpen: "Drag to draw a smooth freehand path; release to close it.",
  curvaturepen: "Click to add points; the path bends smoothly through them. Double-click or Enter to finish, Esc to cancel.",
};

// Window ▸ Workspace persistence — named workspaces + the last-used state,
// stored in localStorage mirroring the store's other `mv.*` preference keys.
// Like Photoshop, a workspace owns the panel layout AND the toolbar placement
// (tool rail / options bar), plus optionally the keyboard shortcut set that was
// active when it was saved.
// ponytail: no menu customization set — Vision has no menu-hiding/colouring
// feature to capture yet. Add `menus` here once one exists.
type SavedWorkspace = {
  name: string;
  layout: DockLayout;
  toolbarLayout?: ToolbarLayout;
  toolConfiguration?: ToolbarConfiguration;
  shortcuts?: ShortcutOverrides;
};
function loadLS<T>(key: string, fallback: T): T {
  try { const s = localStorage.getItem(key); return s ? (JSON.parse(s) as T) : fallback; } catch { return fallback; }
}
function saveLS(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage may be unavailable */ }
}
const loadWorkspacesLS = () => loadLS<SavedWorkspace[]>("mv.workspaces", []);
const saveWorkspacesLS = (list: SavedWorkspace[]) =>
  store.persistAuthoredContent("mv.workspaces", JSON.stringify(list), "workspaces");
const loadLastLayoutLS = () => loadLS<DockLayout | null>("mv.workspaceLast", null);
const saveLastLayoutLS = (layout: DockLayout) => saveLS("mv.workspaceLast", layout);
// The workspace last applied or saved: the one Reset Panels restores.
const loadActiveWorkspaceLS = () => loadLS<string>("mv.workspaceActive", "Essentials");
const saveActiveWorkspaceLS = (name: string) => saveLS("mv.workspaceActive", name);
const loadLastToolbarLS = () => loadLS<ToolbarLayout | null>("mv.toolbarLast", null);
const saveLastToolbarLS = (toolbarLayout: ToolbarLayout) => saveLS("mv.toolbarLast", toolbarLayout);
// Factory dock seed (Reset Panels target). Module-scope so the Window-menu
// panel checkmarks can be seeded from the same layout the workspace mounts with.
const initialLayout: DockLayout = {
  right: {
    size: 440,
    cols: [
      { flex: 0.8, stack: [
        { tabs: ["color", "swatches", "libraries", "brushes", "styles", "adjustments"], active: "color", flex: 0.95 },
        { tabs: ["histogram", "channels", "info", "notes", "animation"], active: "histogram", flex: 0.7 },
      ]},
      { flex: 1, stack: [
        { tabs: ["properties", "layers", "history", "actions", "paths", "navigator", "layercomps"], active: "layers", flex: 1 },
      ]},
    ],
  },
};
// Factory toolbar seed: tool rail down the left, options bar across the top.
// Also what a workspace with no captured toolbar placement (every built-in)
// restores, so applying one puts the rail back where Photoshop starts it.
const initialToolbarLayout: ToolbarLayout = { left: ["tools"], top: ["options"] };
// Window ▸ Workspace built-ins — Photoshop's task-tuned starting layouts, so a
// fresh install has named layouts before the user ever saves one. Each column
// is a list of tab stacks; the first tab of a stack is the one showing.
const rightDock = (...cols: string[][][]): DockLayout => ({
  right: {
    size: 440,
    cols: cols.map((stacks) => ({
      flex: 1,
      stack: stacks.map((tabs) => ({ tabs, active: tabs[0], flex: 1 })),
    })),
  },
});
// ponytail: Photoshop's 3D workspace is omitted — Vision ships no 3D panels, so
// it would mount empty. Add it here once a 3D panel exists.
const BUILTIN_WORKSPACES: SavedWorkspace[] = [
  { name: "Essentials", layout: initialLayout },
  { name: "Photography", layout: rightDock(
    [["histogram", "navigator", "info"], ["adjustments", "channels"]],
    [["layers", "history", "paths"]],
  ) },
  { name: "Painting", layout: rightDock(
    [["brushes", "color", "swatches"], ["styles", "navigator"]],
    [["layers", "history", "channels"]],
  ) },
  { name: "Typography", layout: rightDock(
    [["character", "paragraph"], ["color", "swatches", "styles"]],
    [["layers", "paths", "history"]],
  ) },
  { name: "Graphic and Web", layout: rightDock(
    [["color", "swatches", "libraries"], ["adjustments", "styles", "character", "paragraph"]],
    [["layers", "paths", "layercomps", "history"]],
  ) },
  { name: "Motion", layout: {
    ...rightDock(
      [["histogram", "info", "adjustments"]],
      [["layers", "history", "channels", "paths"]],
    ),
    // Photoshop docks the Timeline along the bottom in Motion.
    bottom: { size: 200, cols: [{ flex: 1, stack: [{ tabs: ["animation"], active: "animation", flex: 1 }] }] },
  } },
];
type OptionsForToolProps = {
  forceLiquify?: boolean;
  onLiquifyApply?: () => void;
  onLiquifyCancel?: () => void;
  // Select Subject needs the host's ML runner (busy lock + toasts), which lives
  // with the menu actions, so the bar's button is handed down like Liquify's.
  onSelectSubject?: () => void;
};
function OptionsForTool({ forceLiquify = false, onLiquifyApply, onLiquifyCancel, onSelectSubject }: OptionsForToolProps = {}) {
  // Read every slice unconditionally (rules of hooks); branch only on render.
  const tool = useStore((s) => s.tool);
  const b = useStore((s) => s.brush);
  // #433 Sample All Layers, shared by the four retouch brushes (Blur / Sharpen /
  // Smudge / Mixer): the dab reads the merged image beneath the brush.
  const sampleAllLayers = (
    <Checkbox checked={b.sampleAllLayers} onChange={(v) => store.setBrush({ sampleAllLayers: v })}>Sample All Layers</Checkbox>
  );
  const lq = useStore((s) => s.liquify);
  const fillTolerance = useStore((s) => s.fillTolerance);
  const fillContiguous = useStore((s) => s.fillContiguous);
  const fillSampleAllLayers = useStore((s) => s.fillSampleAllLayers);
  const fillSource = useStore((s) => s.fillSource);
  const fillMode = useStore((s) => s.fillMode);
  const fillOpacity = useStore((s) => s.fillOpacity);
  const eraserMode = useStore((s) => s.eraserMode);
  const hasHistorySource = useStore((s) => s.hasHistorySource);
  const wandTolerance = useStore((s) => s.wandTolerance);
  const quickSelectionTolerance = useStore((s) => s.quickSelectionTolerance);
  const objectSelectionTolerance = useStore((s) => s.objectSelectionTolerance);
  const objectSelectionLasso = useStore((s) => s.objectSelectionLasso);
  const quickSelectionMode = useStore((s) => s.quickSelectionMode);
  const patchMode = useStore((s) => s.patchMode);
  const patchDestination = useStore((s) => s.patchDestination);
  const patchTransparent = useStore((s) => s.patchTransparent);
  const patchStructure = useStore((s) => s.patchStructure);
  const patchColor = useStore((s) => s.patchColor);
  const camExtend = useStore((s) => s.camExtend);
  const camStructure = useStore((s) => s.camStructure);
  const camColor = useStore((s) => s.camColor);
  const camTransformOnDrop = useStore((s) => s.camTransformOnDrop);
  const quickSelectionSampleAll = useStore((s) => s.quickSelectionSampleAll);
  const quickSelectionAutoEnhance = useStore((s) => s.quickSelectionAutoEnhance);
  const magneticLassoRadius = useStore((s) => s.magneticLassoRadius);
  const magneticLassoThreshold = useStore((s) => s.magneticLassoThreshold);
  const rotationAngle = useStore((s) => s.rotationAngle);
  const wandContiguous = useStore((s) => s.wandContiguous);
  const wandSampleAllLayers = useStore((s) => s.wandSampleAllLayers);
  const magicEraserTolerance = useStore((s) => s.magicEraserTolerance);
  const magicEraserContiguous = useStore((s) => s.magicEraserContiguous);
  const magicEraserSampleAll = useStore((s) => s.magicEraserSampleAll);
  const magicEraserOpacity = useStore((s) => s.magicEraserOpacity);
  const selMode = useStore((s) => s.selMode);
  const selectionFeather = useStore((s) => s.selectionFeather);
  const cloneAligned = useStore((s) => s.cloneAligned);
  const patternAligned = useStore((s) => s.patternAligned);
  const cloneSample = useStore((s) => s.cloneSample);
  const colorReplaceMode = useStore((s) => s.colorReplaceMode);
  const redeyePupil = useStore((s) => s.redeyePupil);
  const redeyeDarken = useStore((s) => s.redeyeDarken);
  const antiAlias = useStore((s) => s.antiAlias);
  const sampleSize = useStore((s) => s.sampleSize);
  const sampleMode = useStore((s) => s.sampleMode);
  const gradientType = useStore((s) => s.gradientType);
  const gradientReverse = useStore((s) => s.gradientReverse);
  const gradientDither = useStore((s) => s.gradientDither);
  const gradientTransparency = useStore((s) => s.gradientTransparency);
  const gradientMethod = useStore((s) => s.gradientMethod);
  const gradientNoiseRoughness = useStore((s) => s.gradientNoiseRoughness);
  const gradientMode = useStore((s) => s.gradientMode);
  const gradientOpacity = useStore((s) => s.gradientOpacity);
  const gradientStops = useStore((s) => s.gradientStops);
  const gradientPresets = useStore((s) => s.gradientPresets);
  const shapeKind = useStore((s) => s.shapeKind);
  const shapeMode = useStore((s) => s.shapeMode);
  const penMode = useStore((s) => s.penMode);
  const customShapes = useStore((s) => s.customShapes);
  const activeCustomShape = useStore((s) => s.activeCustomShape);
  const polygonSides = useStore((s) => s.polygonSides);
  const polygonStar = useStore((s) => s.polygonStar);
  const polygonIndent = useStore((s) => s.polygonIndent);
  const lineWeight = useStore((s) => s.lineWeight);
  const lineArrowStart = useStore((s) => s.lineArrowStart);
  const lineArrowEnd = useStore((s) => s.lineArrowEnd);
  const lineArrowWidth = useStore((s) => s.lineArrowWidth);
  const lineArrowLength = useStore((s) => s.lineArrowLength);
  const lineArrowConcavity = useStore((s) => s.lineArrowConcavity);
  const roundRectRadius = useStore((s) => s.roundRectRadius);
  const shapeStrokeWidth = useStore((s) => s.shapeStrokeWidth);
  const shapeStrokeAlign = useStore((s) => s.shapeStrokeAlign);
  const cropAspect = useStore((s) => s.cropAspect);
  const cropOverlay = useStore((s) => s.cropOverlay);
  const cropContentAware = useStore((s) => s.cropContentAware);
  const cropDeletePixels = useStore((s) => s.cropDeletePixels);
  const slices = useStore((s) => s.slices);
  const selectedSlice = useStore((s) => s.selectedSlice);
  const slicesLocked = useStore((s) => s.slicesLocked);
  const showSlices = useStore((s) => s.showSlices);
  const marqueeStyle = useStore((s) => s.marqueeStyle);
  const marqueeFixedW = useStore((s) => s.marqueeFixedW);
  const marqueeFixedH = useStore((s) => s.marqueeFixedH);
  const frameMode = useStore((s) => s.frameMode);
  const artboards = useStore((s) => s.artboards);
  const selectedArtboard = useStore((s) => s.selectedArtboard);
  const artboardPreset = useStore((s) => s.artboardPreset);
  const artboardOrientation = useStore((s) => s.artboardOrientation);
  const rulerLine = useStore((s) => s.rulerLine);
  const countPoints = useStore((s) => s.countPoints);
  const colorSamplers = useStore((s) => s.colorSamplers);
  const notes = useStore((s) => s.notes);
  const noteAuthor = useStore((s) => s.noteAuthor);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const layers = useStore((s) => s.layers);
  const showTransformControls = useStore((s) => s.showTransformControls);
  const selectedPaths = useStore((s) => s.selectedPaths);
  const liquifyTargets = useMemo(() => layers.filter((layer) => layer.kind === LAYER_KIND.pixel && !layer.locked), [layers]);
  const liquifyTargetValue = lq.targetLayerId > 0 && liquifyTargets.some((layer) => layer.id === lq.targetLayerId) ? String(lq.targetLayerId) : "0";

  // `step` (in value units) lets an integer option move one unit per arrow key;
  // the default 1% fraction step rounds straight back to the same integer.
  const slider = (label: string, value: number, min: number, max: number, onChange: (v: number) => void, fmt?: (v: number) => string, step?: number) => (
    <span style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 130 }}>
      <span style={{ color: "var(--text-3)" }}>{label}</span>
      <Slider aria-label={label} value={(value - min) / (max - min)} accent={ACCENT} onChange={(f) => onChange(min + f * (max - min))}
        step={step && step / (max - min)} style={{ width: 80 }} />
      <span style={{ fontFamily: "var(--font-mono)", color: "var(--text-1)", fontSize: 11, minWidth: 34 }}>{fmt ? fmt(value) : Math.round(value)}</span>
    </span>
  );

  // A selected type layer takes over the options bar with the Type toolbar,
  // regardless of the active tool — the text editor lives here, not in a modal.
  const activeLayer = layers.find((l) => l.id === activeLayerId);
  if (activeLayer?.kind === LAYER_KIND.text && !forceLiquify) return <TypeToolbar key={activeLayerId} id={activeLayerId} />;

  if (tool === "move") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <Checkbox id="mv-move-xform" checked={showTransformControls} onChange={(v) => store.setOptions({ showTransformControls: v })}>Show Transform Controls</Checkbox>
        </OptionsBar.Group>
        {alignDistributeGroups((mode) => store.alignLayer(mode), (axis, key) => store.distributeLayers(axis, key))}
      </OptionsBar>
    );
  }
  // Path Selection: Photoshop retargets Align / Distribute / Arrange to the
  // shift-click-selected path components inside the shape layer (#456).
  if (tool === "pathselect") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>{selectedPaths.length} component{selectedPaths.length === 1 ? "" : "s"} selected</span>
        </OptionsBar.Group>
        {alignDistributeGroups((mode) => store.alignPathComponents(mode), (axis, key) => store.distributePathComponents(axis, key))}
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Arrange</span>
          <button id="mv-arrange-front" style={BAR_BTN} title="Bring the selected components to the front" onClick={() => store.arrangePathComponents(true)}>Bring to Front</button>
          <button id="mv-arrange-back" style={BAR_BTN} title="Send the selected components to the back" onClick={() => store.arrangePathComponents(false)}>Send to Back</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (isOpacityTool(tool)) {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Size", b.size, 1, 400, (v) => store.setBrush({ size: v }), (v) => `${Math.round(v)}px`)}
          {/* Pencil (and the hard Eraser modes) are 100% hard (aliased) — no Hardness control. */}
          {tool !== "pencil" && !(tool === "erase" && eraserMode !== "brush") &&
            slider("Hardness", b.hardness, 0, 1, (v) => store.setBrush({ hardness: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        {/* Brush Mode (Photoshop's blend dropdown) — paint & pencil only; the engine
            ignores it for the other brush tools. Pass Through (25) is group-only. */}
        {(tool === "brush" || tool === "pencil") && (
          <OptionsBar.Group>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ color: "var(--text-3)" }}>Mode</span>
              <Select size="sm" aria-label="Brush blend mode" value={String(b.blend)}
                onChange={(v) => store.setBrush({ blend: +v })}
                options={BRUSH_BLEND_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
            </label>
          </OptionsBar.Group>
        )}
        {tool === "erase" && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Mode</span>
            <SegmentedControl value={eraserMode} onChange={(v) => store.setOptions({ eraserMode: v as "brush" | "pencil" | "block" })}
              items={[{ value: "brush", label: "Brush" }, { value: "pencil", label: "Pencil" }, { value: "block", label: "Block" }]} />
            {/* Photoshop's Erase to History: the History Brush's paint path with
                the Eraser's tip. Nothing to restore until a source is set. */}
            <span title={hasHistorySource ? "Strokes restore the History source instead of erasing" : "Set a source in the History panel first (Set Source)"}>
              <Checkbox checked={b.eraseToHistory} disabled={!hasHistorySource}
                onChange={(v) => store.setBrush({ eraseToHistory: v })}>Erase to History</Checkbox>
            </span>
          </OptionsBar.Group>
        )}
        {tool === "pencil" && (
          <OptionsBar.Group>
            {/* Pixel-art toggle: a stroke begun on foreground-coloured pixels
                paints the background colour for its whole length. */}
            <Checkbox checked={b.autoErase} onChange={(v) => store.setBrush({ autoErase: v })}>Auto Erase</Checkbox>
          </OptionsBar.Group>
        )}
        <OptionsBar.Group>
          {slider("Flow", b.flow, 0, 1, (v) => store.setBrush({ flow: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Opacity", b.opacity, 0, 1, (v) => store.setBrush({ opacity: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Smoothing", b.smoothing, 0, 1, (v) => store.setBrush({ smoothing: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        {/* Brush Tip Shape (elliptical/calligraphic tip). The Block eraser is a fixed square — roundness/angle don't apply. */}
        {!(tool === "erase" && eraserMode === "block") && (
          <OptionsBar.Group>
            {slider("Angle", b.angle, -180, 180, (v) => store.setBrush({ angle: v }), (v) => `${Math.round(v)}°`)}
            {slider("Roundness", b.roundness, 0.05, 1, (v) => store.setBrush({ roundness: v }), (v) => `${Math.round(v * 100)}%`)}
            {/* Spacing is the dab step as a fraction of the tip diameter — Photoshop's 1%..1000%. */}
            {slider("Spacing", b.spacing, 0.01, 10, (v) => store.setBrush({ spacing: v }), (v) => `${Math.round(v * 100)}%`)}
          </OptionsBar.Group>
        )}
        <OptionsBar.Group>
          <Checkbox checked={b.sizePressure} onChange={(v) => store.setBrush({ sizePressure: v })}>Pressure size</Checkbox>
          <Checkbox checked={b.flowPressure} onChange={(v) => store.setBrush({ flowPressure: v })}>Pressure flow</Checkbox>
          {/* Build-up: paint keeps depositing while the pointer is held still, the way
              Photoshop's airbrush does. The engine and the rate timer already existed;
              without this control there was no way for anyone to switch it on. */}
          <Checkbox checked={b.airbrush} onChange={(v) => store.setBrush({ airbrush: v })}>Airbrush</Checkbox>
          {(tool === "clone" || tool === "heal") && (
            <Checkbox checked={cloneAligned} onChange={(v) => store.setOptions({ cloneAligned: v })}>Aligned</Checkbox>
          )}
          {tool === "patternstamp" && (
            <Checkbox checked={patternAligned} onChange={(v) => store.setOptions({ patternAligned: v })}>Aligned</Checkbox>
          )}
          {(tool === "clone" || tool === "heal" || tool === "vanishingpoint") && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <span style={{ color: "var(--text-3)" }}>Sample</span>
              <Select size="sm" id="mv-clone-sample" value={String(cloneSample)} aria-label="Clone sample source"
                onChange={(v) => store.setOptions({ cloneSample: +v })}
                options={CLONE_SAMPLE_MODES.map((m) => ({ value: String(m.value), label: m.label }))} />
            </label>
          )}
          {tool === "heal" && (
            <>
              {/* Photoshop's Healing Brush Source + Diffusion. Sampled heals from
                  the alt-clicked point, Pattern heals the defined tile in; Diffusion
                  1..7 sets how fast the patch falls off into its surroundings. */}
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Source</span>
              <SegmentedControl value={b.healSource} onChange={(v) => store.setBrush({ healSource: v as "sampled" | "pattern" })}
                items={[{ value: "sampled", label: "Sampled" }, { value: "pattern", label: "Pattern" }]} />
              {slider("Diffusion", b.healDiffusion, 1, 7, (v) => store.setBrush({ healDiffusion: Math.round(v) }), (v) => String(Math.round(v)))}
            </>
          )}
          {tool === "clone" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Alt-click to set source</span>}
          {tool === "vanishingpoint" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Alt-click source</span>}
          {tool === "patternstamp" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Paints the defined pattern (Edit ▸ Define Pattern)</span>}
          {tool === "historybrush" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Reverts to the History panel source (set it with "Set Source")</span>}
          {tool === "colorreplace" && (
            <>
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Mode</span>
              <Select size="sm" id="mv-colorreplace-mode" value={String(colorReplaceMode)} aria-label="Color Replacement mode"
                onChange={(v) => store.setOptions({ colorReplaceMode: +v })}
                options={[{ value: "0", label: "Hue" }, { value: "1", label: "Saturation" }, { value: "2", label: "Color" }, { value: "3", label: "Luminosity" }]} />
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Replaces color with the foreground, keeping brightness</span>
            </>
          )}
        </OptionsBar.Group>
        {(tool === "dodge" || tool === "burn") && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Range</span>
            <SegmentedControl value={String(b.dodgeRange)} onChange={(v) => store.setBrush({ dodgeRange: +v })}
              items={[{ value: "0", label: "Shadows" }, { value: "1", label: "Midtones" }, { value: "2", label: "Highlights" }]} />
            {slider("Exposure", b.dodgeExposure, 0, 1, (v) => store.setBrush({ dodgeExposure: v }), (v) => `${Math.round(v * 100)}%`)}
            <Checkbox checked={b.protectTones} onChange={(v) => store.setBrush({ protectTones: v })}>Protect Tones</Checkbox>
          </OptionsBar.Group>
        )}
        {tool === "sponge" && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Mode</span>
            <SegmentedControl value={String(b.spongeMode)} onChange={(v) => store.setBrush({ spongeMode: +v })}
              items={[{ value: "0", label: "Saturate" }, { value: "1", label: "Desaturate" }]} />
            {slider("Flow", b.spongeRate, 0, 1, (v) => store.setBrush({ spongeRate: v }), (v) => `${Math.round(v * 100)}%`)}
            <Checkbox checked={b.spongeVibrance} onChange={(v) => store.setBrush({ spongeVibrance: v })}>Vibrance</Checkbox>
          </OptionsBar.Group>
        )}
        {tool === "smudge" && (
          <OptionsBar.Group>
            <Checkbox checked={b.smudgeFinger} onChange={(v) => store.setBrush({ smudgeFinger: v })}>Finger Painting</Checkbox>
            <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Starts each smear with the foreground color</span>
            {sampleAllLayers}
          </OptionsBar.Group>
        )}
        {tool === "blur" && (
          <OptionsBar.Group>
            {slider("Strength", b.blurRate, 0, 1, (v) => store.setBrush({ blurRate: v }), (v) => `${Math.round(v * 100)}%`)}
            {sampleAllLayers}
          </OptionsBar.Group>
        )}
        {tool === "sharpen" && (
          <OptionsBar.Group>
            {slider("Strength", b.sharpenRate, 0, 1, (v) => store.setBrush({ sharpenRate: v }), (v) => `${Math.round(v * 100)}%`)}
            <Checkbox checked={b.sharpenProtect} onChange={(v) => store.setBrush({ sharpenProtect: v })}>Protect Detail</Checkbox>
            {sampleAllLayers}
          </OptionsBar.Group>
        )}
        {tool === "backgrounderaser" && (
          <OptionsBar.Group>
            {slider("Tolerance", b.bgEraserTolerance, 0, 1, (v) => store.setBrush({ bgEraserTolerance: v }), (v) => `${Math.round(v * 100)}%`)}
            <Checkbox checked={b.bgEraserProtectFg} onChange={(v) => store.setBrush({ bgEraserProtectFg: v })}>Protect Foreground</Checkbox>
            <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Sampling</span>
            <Select size="sm" id="mv-bgeraser-sampling" value={String(b.bgEraserSampling)} aria-label="Background Eraser sampling"
              onChange={(v) => store.setBrush({ bgEraserSampling: +v })}
              options={[{ value: "0", label: "Continuous" }, { value: "1", label: "Once" }, { value: "2", label: "Background Swatch" }]} />
            <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Limits</span>
            <Select size="sm" id="mv-bgeraser-limits" value={String(b.bgEraserLimits)} aria-label="Background Eraser limits"
              onChange={(v) => store.setBrush({ bgEraserLimits: +v })}
              options={[{ value: "0", label: "Discontiguous" }, { value: "1", label: "Contiguous" }, { value: "2", label: "Find Edges" }]} />
          </OptionsBar.Group>
        )}
        {tool === "mixerbrush" && (
          <OptionsBar.Group>
            <Select size="sm" id="mv-mixer-preset" aria-label="Mixer Brush preset"
              value={MIXER_PRESETS.find((p) => p.wet === b.mixerWet && p.load === b.mixerLoad && p.mix === b.mixerMix)?.id ?? "custom"}
              onChange={(v) => {
                const p = MIXER_PRESETS.find((x) => x.id === v);
                if (p) store.setBrush({ mixerWet: p.wet, mixerLoad: p.load, mixerMix: p.mix });
              }}
              options={[{ value: "custom", label: "Custom" }, ...MIXER_PRESETS.map((p) => ({ value: p.id, label: p.label }))]} />
            {slider("Wet", b.mixerWet, 0, 1, (v) => store.setBrush({ mixerWet: v }), (v) => `${Math.round(v * 100)}%`)}
            {slider("Load", b.mixerLoad, 0, 1, (v) => store.setBrush({ mixerLoad: v }), (v) => `${Math.round(v * 100)}%`)}
            {slider("Mix", b.mixerMix, 0, 1, (v) => store.setBrush({ mixerMix: v }), (v) => `${Math.round(v * 100)}%`)}
            <Checkbox checked={b.mixerAutoLoad} onChange={(v) => store.setBrush({ mixerAutoLoad: v })}>Load after stroke</Checkbox>
            <Checkbox checked={b.mixerAutoClean} onChange={(v) => store.setBrush({ mixerAutoClean: v })}>Clean after stroke</Checkbox>
            {sampleAllLayers}
          </OptionsBar.Group>
        )}
      </OptionsBar>
    );
  }
  if (tool === "liquify" || forceLiquify) {
    const applyLiquify = onLiquifyApply ?? (() => store.endLiquify());
    const cancelLiquify = onLiquifyCancel ?? (() => store.cancelLiquify());
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-3)" }}>Target</span>
            <Select size="sm" id="mv-liquify-target-layer" value={liquifyTargetValue} aria-label="Liquify target layer"
              onChange={(v) => store.setLiquify({ targetLayerId: +v })}
              options={[{ value: "0", label: "Active Layer" }, ...liquifyTargets.map((layer) => ({ value: String(layer.id), label: layer.name }))]} />
          </label>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={String(lq.mode)} onChange={(v) => store.setLiquify({ mode: +v })}
            items={LIQUIFY_TOOL_MODES.map((mode) => ({ value: String(mode), label: LIQUIFY_MODES[mode] }))} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Reconstruct</span>
          <LiquifyReconstructModes mode={lq.mode} style={BAR_BTN} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          {slider("Size", lq.size, 1, 600, (v) => store.setLiquify({ size: v }), (v) => `${Math.round(v)}px`)}
          {slider("Density", lq.density, 0, 1, (v) => store.setLiquify({ density: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Pressure", lq.pressure, 0, 1, (v) => store.setLiquify({ pressure: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Strength", lq.strength, 0, 1, (v) => store.setLiquify({ strength: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Rate", lq.rate, 0, 1, (v) => store.setLiquify({ rate: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <Checkbox id="mv-liquify-pin-edges" checked={lq.pinEdges} onChange={(v) => store.setLiquify({ pinEdges: v })}>Pin Edges</Checkbox>
          <Checkbox id="mv-liquify-preview" checked={lq.preview} onChange={(v) => store.setLiquify({ preview: v })}>Preview</Checkbox>
          <Checkbox id="mv-liquify-show-backdrop" checked={lq.showBackdrop} onChange={(v) => store.setLiquify({ showBackdrop: v })}>Show Backdrop</Checkbox>
          <Checkbox id="mv-liquify-show-mesh" checked={lq.showMesh} onChange={(v) => store.setLiquify({ showMesh: v })}>Show Mesh</Checkbox>
          {lq.showBackdrop && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
              <span style={{ color: "var(--text-3)" }}>Source</span>
              <Select size="sm" id="mv-liquify-backdrop-source" value={lq.backdropSource} aria-label="Liquify backdrop source"
                onChange={(v) => store.setLiquify({ backdropSource: v as LiquifyBackdropSource })}
                options={LIQUIFY_BACKDROP_SOURCES} />
            </label>
          )}
          {lq.showBackdrop && slider("Backdrop", lq.backdropOpacity, 0, 1, (v) => store.setLiquify({ backdropOpacity: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button style={BAR_BTN} title="Restore all live Liquify distortion without leaving the workspace" onClick={() => store.restoreLiquify()}>Restore All</button>
          <button style={BAR_BTN} title="Freeze the whole editable Liquify area" onClick={() => store.liquifyMaskAll()}>Mask All</button>
          <button style={BAR_BTN} title="Clear the Liquify freeze mask" onClick={() => store.liquifyMaskClear()}>Clear Mask</button>
          <button style={BAR_BTN} title="Invert the Liquify freeze mask" onClick={() => store.liquifyMaskInvert()}>Invert Mask</button>
          <button style={BAR_BTN} title="Save the current live Liquify mesh for this session" onClick={() => store.saveLiquifyMesh()}>Save Mesh</button>
          <button style={BAR_BTN} title="Load the last saved same-size Liquify mesh" onClick={() => store.loadLiquifyMesh()}>Load Mesh</button>
          <button style={BAR_BTN} title="Export the current live Liquify mesh to a same-size file" onClick={() => void exportLiquifyMeshFile()}>Export Mesh</button>
          <button style={BAR_BTN} title="Import a same-size Liquify mesh file into this workspace" onClick={() => void importLiquifyMeshFile()}>Import Mesh</button>
          {!forceLiquify && (
            <>
              <button style={BAR_BTN} title="Apply the warp (also Enter)" onClick={applyLiquify}>Apply</button>
              <button style={BAR_BTN} title="Discard the warp (also Esc)" onClick={cancelLiquify}>Cancel</button>
            </>
          )}
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  // Patch (#428): Photoshop's Mode / Source-Destination / Transparent, with
  // Structure and Color replacing Transparent in Content-Aware mode.
  if (tool === "patch") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={String(patchMode)} onChange={(v) => store.setOptions({ patchMode: +v })}
            items={[{ value: "0", label: "Normal" }, { value: "1", label: "Content-Aware" }]} />
          <span style={{ color: "var(--text-3)" }}>Patch</span>
          <SegmentedControl value={patchDestination ? "destination" : "source"} onChange={(v) => store.setOptions({ patchDestination: v === "destination" })}
            items={[{ value: "source", label: "Source" }, { value: "destination", label: "Destination" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          {patchMode === 1 ? (
            <>
              {slider("Structure", patchStructure, 1, 7, (v) => store.setOptions({ patchStructure: Math.round(v) }))}
              {slider("Color", patchColor, 0, 10, (v) => store.setOptions({ patchColor: Math.round(v) }))}
            </>
          ) : (
            <Checkbox checked={patchTransparent} onChange={(v) => store.setOptions({ patchTransparent: v })}>Transparent</Checkbox>
          )}
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
            {patchDestination ? "Drag the selection to where its contents should go." : "Drag the selection over a clean area to heal it with that texture."}
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  // Content-Aware Move (#429): Photoshop's Mode (Move / Extend), Patch's
  // Structure and Color applied to the dropped object, and Transform On Drop,
  // which leaves the drop in a live frame (Enter applies, Esc cancels).
  if (tool === "contentawaremove") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl aria-label="Mode" value={camExtend ? "extend" : "move"} onChange={(v) => store.setOptions({ camExtend: v === "extend" })}
            items={[{ value: "move", label: "Move" }, { value: "extend", label: "Extend" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          {slider("Structure", camStructure, 1, 7, (v) => store.setOptions({ camStructure: Math.round(v) }), undefined, 1)}
          {slider("Color", camColor, 0, 10, (v) => store.setOptions({ camColor: Math.round(v) }), undefined, 1)}
          <Checkbox checked={camTransformOnDrop} onChange={(v) => store.setOptions({ camTransformOnDrop: v })}>Transform On Drop</Checkbox>
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
            {camExtend ? "Drag the selection to copy its contents there." : "Drag the selection to move its contents; the spot they leave is content-aware-filled."}
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  // Pen family: Photoshop's Mode dropdown decides what closing a path produces —
  // Pixels fills it, Shape commits an editable vector layer (which the Direct /
  // Path Selection tools then edit, and which .monetgfx round-trips to Artisan).
  if (tool === "pen" || tool === "freeformpen" || tool === "curvaturepen") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={penMode} onChange={(v) => store.setOptions({ penMode: v as "pixels" | "shape" })}
            items={[{ value: "pixels", label: "Pixels" }, { value: "shape", label: "Shape" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>{PEN_HINT[tool]}</span>
          {penMode === "shape" && <span style={{ color: "var(--text-3)" }}>Closes onto a vector layer — edit it with Direct Selection (A).</span>}
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "rotateview") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Rotation</span>
          <input id="mv-rotate-angle" type="number" min={-180} max={180} value={Math.round(rotationAngle)}
            onChange={(e) => store.setRotation(+e.target.value || 0)} style={{ width: 56 }} />
          <span style={{ color: "var(--text-3)" }}>°</span>
          <button style={BAR_BTN} onClick={() => store.setRotation(0)}>Reset View</button>
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Drag the canvas to rotate · view-only, pixels unchanged</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "magneticlasso") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Width", magneticLassoRadius, 1, 60, (v) => store.setOptions({ magneticLassoRadius: Math.round(v) }), (v) => `${Math.round(v)}px`)}
          {slider("Contrast", magneticLassoThreshold, 0, 1, (v) => store.setOptions({ magneticLassoThreshold: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <Checkbox checked={antiAlias} onChange={(v) => store.setOptions({ antiAlias: v })}>Anti-alias</Checkbox>
          <span style={{ color: "var(--text-3)" }}>Feather</span>
          <input id="mv-selection-feather" type="number" min={0} max={1000} value={selectionFeather}
            onChange={(e) => store.setOptions({ selectionFeather: clampFeather(+e.target.value) })}
            style={{ width: 48 }} />
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Drag along an edge; release to close the selection</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "objectselection") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={String(selMode)} onChange={(v) => store.setOptions({ selMode: +v })}
            items={[{ value: "0", label: "New" }, { value: "1", label: "Add" }, { value: "2", label: "Subtract" }, { value: "3", label: "Intersect" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Hint</span>
          <SegmentedControl value={objectSelectionLasso ? "lasso" : "rect"} onChange={(v) => store.setOptions({ objectSelectionLasso: v === "lasso" })}
            items={[{ value: "rect", label: "Rectangle" }, { value: "lasso", label: "Lasso" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          {slider("Tolerance", objectSelectionTolerance, 0, 1, (v) => store.setOptions({ objectSelectionTolerance: v }), (v) => `${Math.round(v * 255)}`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <Checkbox checked={antiAlias} onChange={(v) => store.setOptions({ antiAlias: v })}>Anti-alias</Checkbox>
          <span style={{ color: "var(--text-3)" }}>Feather</span>
          <input id="mv-selection-feather" type="number" min={0} max={1000} value={selectionFeather}
            onChange={(e) => store.setOptions({ selectionFeather: clampFeather(+e.target.value) })}
            style={{ width: 48 }} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button style={BAR_BTN} disabled={!onSelectSubject} onClick={() => onSelectSubject?.()}>Select Subject</button>
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>
            {objectSelectionLasso ? "Draw a loop around the object" : "Drag a box around the object"} · Shift adds · Alt subtracts
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "quickselection") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={String(quickSelectionMode)} onChange={(v) => store.setOptions({ quickSelectionMode: +v })}
            items={[{ value: "0", label: "New" }, { value: "1", label: "Add" }, { value: "2", label: "Subtract" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          {slider("Size", b.size, 1, 400, (v) => store.setBrush({ size: v }), (v) => `${Math.round(v)}px`)}
          {slider("Tolerance", quickSelectionTolerance, 0, 1, (v) => store.setOptions({ quickSelectionTolerance: v }), (v) => `${Math.round(v * 255)}`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <Checkbox checked={quickSelectionSampleAll} onChange={(v) => store.setOptions({ quickSelectionSampleAll: v })}>Sample All Layers</Checkbox>
          <Checkbox checked={quickSelectionAutoEnhance} onChange={(v) => store.setOptions({ quickSelectionAutoEnhance: v })}>Auto-Enhance</Checkbox>
          <span style={{ color: "var(--text-3)" }}>Feather</span>
          <input id="mv-selection-feather" type="number" min={0} max={1000} value={selectionFeather}
            onChange={(e) => store.setOptions({ selectionFeather: clampFeather(+e.target.value) })}
            style={{ width: 48 }} />
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Drag to grow · Alt-drag to subtract</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "magiceraser") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Tolerance", magicEraserTolerance, 0, 1, (v) => store.setOptions({ magicEraserTolerance: v }), (v) => `${Math.round(v * 255)}`)}
          <Checkbox checked={magicEraserContiguous} onChange={(v) => store.setOptions({ magicEraserContiguous: v })}>Contiguous</Checkbox>
          <Checkbox checked={magicEraserSampleAll} onChange={(v) => store.setOptions({ magicEraserSampleAll: v })}>Sample All Layers</Checkbox>
          {slider("Opacity", magicEraserOpacity, 0, 1, (v) => store.setOptions({ magicEraserOpacity: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "bucket" || tool === "wand") {
    const isBucket = tool === "bucket";
    const tol = isBucket ? fillTolerance : wandTolerance;
    const contig = isBucket ? fillContiguous : wandContiguous;
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {isBucket && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8 }}>
              <span style={{ color: "var(--text-3)" }}>Fill</span>
              <Select size="sm" id="mv-bucket-source" value={fillSource} aria-label="Bucket fill source"
                onChange={(v) => store.setOptions({ fillSource: v as "foreground" | "pattern" })}
                options={[{ value: "foreground", label: "Foreground" }, { value: "pattern", label: "Pattern" }]} />
            </label>
          )}
          {isBucket && (
            <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8 }}>
              <span style={{ color: "var(--text-3)" }}>Mode</span>
              <Select size="sm" id="mv-bucket-mode" value={fillMode} aria-label="Bucket blend mode"
                onChange={(v) => store.setOptions({ fillMode: v })} options={BLEND_MODES} />
            </label>
          )}
          {isBucket && slider("Opacity", fillOpacity, 0, 1, (v) => store.setOptions({ fillOpacity: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Tolerance", tol, 0, 1, (v) => store.setOptions(isBucket ? { fillTolerance: v } : { wandTolerance: v }), (v) => `${Math.round(v * 255)}`)}
          <Checkbox checked={contig} onChange={(v) => store.setOptions(isBucket ? { fillContiguous: v } : { wandContiguous: v })}>Contiguous</Checkbox>
          {!isBucket && (
            <Checkbox checked={antiAlias} onChange={(v) => store.setOptions({ antiAlias: v })}>Anti-alias</Checkbox>
          )}
          <Checkbox
            checked={isBucket ? fillSampleAllLayers : wandSampleAllLayers}
            onChange={(v) => store.setOptions(isBucket ? { fillSampleAllLayers: v } : { wandSampleAllLayers: v })}>
            {isBucket ? "All Layers" : "Sample All Layers"}
          </Checkbox>
          {supportsFeather(tool) && (
            <>
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Feather</span>
              <input id="mv-selection-feather" type="number" min={0} max={1000} value={selectionFeather}
                onChange={(e) => store.setOptions({ selectionFeather: clampFeather(+e.target.value) })}
                style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>px</span>
            </>
          )}
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "marquee" || tool === "ellipse" || tool === "lasso" || tool === "polylasso" || tool === "singlerow" || tool === "singlecolumn") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={String(selMode)} onChange={(v) => store.setOptions({ selMode: +v })}
            items={[{ value: "0", label: "New" }, { value: "1", label: "Add" }, { value: "2", label: "Subtract" }, { value: "3", label: "Intersect" }]} />
          {(tool === "ellipse" || tool === "lasso" || tool === "polylasso") && (
            <Checkbox checked={antiAlias} onChange={(v) => store.setOptions({ antiAlias: v })}>Anti-alias</Checkbox>
          )}
          {(tool === "marquee" || tool === "ellipse") && (
            <>
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Style</span>
              <SegmentedControl value={marqueeStyle} onChange={(v) => store.setOptions({ marqueeStyle: v as "normal" | "ratio" | "size" })}
                items={[{ value: "normal", label: "Normal" }, { value: "ratio", label: "Fixed Ratio" }, { value: "size", label: "Fixed Size" }]} />
              {marqueeStyle !== "normal" && (
                <>
                  <span style={{ color: "var(--text-3)" }}>W</span>
                  <input id="mv-marquee-w" type="number" min={1} max={10000} value={marqueeFixedW}
                    onChange={(e) => store.setOptions({ marqueeFixedW: normalizeFixedSize(+e.target.value) })}
                    style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                  <span style={{ color: "var(--text-3)" }}>H</span>
                  <input id="mv-marquee-h" type="number" min={1} max={10000} value={marqueeFixedH}
                    onChange={(e) => store.setOptions({ marqueeFixedH: normalizeFixedSize(+e.target.value) })}
                    style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                </>
              )}
            </>
          )}
          {supportsFeather(tool) && (
            <>
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Feather</span>
              <input id="mv-selection-feather" type="number" min={0} max={1000} value={selectionFeather}
                onChange={(e) => store.setOptions({ selectionFeather: clampFeather(+e.target.value) })}
                style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>px</span>
            </>
          )}
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Shift = add · Alt = subtract · Shift+Alt = intersect</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "gradient") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Type</span>
          <SegmentedControl aria-label="Type" value={gradientType} onChange={(v) => store.setOptions({ gradientType: v as "linear" | "radial" | "angle" | "reflected" | "diamond" })}
            items={[{ value: "linear", label: "Linear" }, { value: "radial", label: "Radial" }, { value: "angle", label: "Angle" }, { value: "reflected", label: "Reflected" }, { value: "diamond", label: "Diamond" }]} />
          <span style={{ color: "var(--text-3)" }}>Method</span>
          <SegmentedControl aria-label="Method" value={gradientMethod} onChange={(v) => store.setOptions({ gradientMethod: v as "perceptual" | "linear" | "classic" })}
            items={[{ value: "perceptual", label: "Perceptual" }, { value: "linear", label: "Linear" }, { value: "classic", label: "Classic" }]} />
          <Checkbox checked={gradientReverse} onChange={(v) => store.setOptions({ gradientReverse: v })}>Reverse</Checkbox>
          <Checkbox checked={gradientDither} onChange={(v) => store.setOptions({ gradientDither: v })}>Dither</Checkbox>
          <Checkbox checked={gradientTransparency} onChange={(v) => store.setOptions({ gradientTransparency: v })}>Transparency</Checkbox>
          <span style={{ color: "var(--text-3)" }}>Noise</span>
          <button type="button" data-mv-gradient-noise style={BAR_BTN} title="Fill the ramp with a random noise gradient (click again to re-randomize)" onClick={() => store.noiseGradient()}>Randomize</button>
          <span style={{ color: "var(--text-3)" }}>Roughness</span>
          <Slider aria-label="Noise Roughness" min={0} max={100} step={1} accent={ACCENT} value={Math.round(gradientNoiseRoughness * 100)}
            onChange={(v) => store.setOptions({ gradientNoiseRoughness: v / 100 })} style={{ width: 70 }} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6, marginRight: 8 }}>
            <span style={{ color: "var(--text-3)" }}>Mode</span>
            <Select size="sm" id="mv-gradient-mode" value={gradientMode} aria-label="Gradient blend mode"
              onChange={(v) => store.setOptions({ gradientMode: v })} options={BLEND_MODES} />
          </label>
          {slider("Opacity", gradientOpacity, 0, 1, (v) => store.setOptions({ gradientOpacity: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Preset</span>
          <Select size="sm" id="mv-gradient-preset" value={gradientPresetFor(gradientStops, gradientPresets)?.name ?? CUSTOM_GRADIENT}
            onChange={(v) => { const p = gradientByName(v, gradientPresets); if (p) store.setOptions({ gradientStops: p.stops.map((s) => ({ ...s })) }); }}
            style={{ marginLeft: 8 }}
            options={[{ value: CUSTOM_GRADIENT }, ...gradientPresets.map((p) => ({ value: p.name }))]} />
          <button id="mv-gradient-preset-save" title="Save the current gradient as a preset"
            onClick={() => store.addGradientPreset()}
            style={{ marginLeft: 6, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 8px", cursor: "pointer" }}>
            ＋ Save
          </button>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <GradientBar />
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "shape") {
    return (
      <OptionsBar>
        {/* Photoshop's Shape/Path/Pixels dropdown: Shape → a live vector layer,
            Path → the work path, Pixels → rasterized fill (like the Pen's Mode). */}
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Mode</span>
          <SegmentedControl value={shapeMode} onChange={(v) => store.setOptions({ shapeMode: v as "shape" | "path" | "pixels" })}
            items={[{ value: "shape", label: "Shape" }, { value: "path", label: "Path" }, { value: "pixels", label: "Pixels" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Shape</span>
          <SegmentedControl value={shapeKind} onChange={(v) => store.setOptions({ shapeKind: v as "rect" | "ellipse" | "custom" | "polygon" | "line" | "roundrect" })}
            items={[{ value: "rect", label: "Rectangle" }, { value: "roundrect", label: "Rounded" }, { value: "ellipse", label: "Ellipse" }, { value: "polygon", label: "Polygon" }, { value: "line", label: "Line" }, { value: "custom", label: "Custom" }]} />
          {shapeKind === "custom" && (customShapes.length > 0 ? (
            <Select size="sm" id="mv-customshape-select" value={String(activeCustomShape)}
              onChange={(v) => store.setActiveCustomShape(+v)}
              style={{ marginLeft: 8 }}
              options={customShapes.map((s, i) => ({ value: String(i), label: s.name }))} />
          ) : (
            <span style={{ color: "var(--text-3)", marginLeft: 8, fontSize: 11 }}>Draw a Pen path, then Edit ▸ Define Custom Shape…</span>
          ))}
          {(shapeKind === "rect" || shapeKind === "ellipse") && shapeMode === "pixels" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Fills with foreground</span>}
          {shapeMode === "shape" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Draws a live vector layer — edit it with Direct Selection (A).</span>}
          {shapeMode === "path" && <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Sets the work path (Paths panel).</span>}
          {(shapeKind === "rect" || shapeKind === "ellipse") && (
            <>
              <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Stroke</span>
              <input id="mv-shape-stroke" type="number" min={0} max={500} value={shapeStrokeWidth}
                onChange={(e) => store.setOptions({ shapeStrokeWidth: Math.max(0, Math.round(+e.target.value) || 0) })}
                style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>px (bg)</span>
              {shapeStrokeWidth > 0 && (
                <Select size="sm" id="mv-shape-stroke-align" value={String(shapeStrokeAlign)}
                  onChange={(v) => store.setOptions({ shapeStrokeAlign: (+v) as 0 | 1 | 2 })}
                  style={{ marginLeft: 4 }}
                  options={[{ value: "0", label: "Inside" }, { value: "1", label: "Center" }, { value: "2", label: "Outside" }]} />
              )}
            </>
          )}
        </OptionsBar.Group>
        {shapeKind === "polygon" && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Sides</span>
            <input id="mv-polygon-sides" type="number" min={3} max={24} value={polygonSides}
              onChange={(e) => store.setOptions({ polygonSides: Math.max(3, Math.min(24, Math.round(+e.target.value) || 3)) })}
              style={{ width: 48, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, marginLeft: 8, color: "var(--text-3)" }}>
              <input id="mv-polygon-star" type="checkbox" checked={polygonStar} onChange={(e) => store.setOptions({ polygonStar: e.target.checked })} />
              Star
            </label>
            {polygonStar && (
              <>
                <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Indent</span>
                <Slider id="mv-polygon-indent" aria-label="Star indent" min={5} max={95} step={1} accent={ACCENT}
                  value={Math.round(polygonIndent * 100)}
                  onChange={(v) => store.setOptions({ polygonIndent: v / 100 })} style={{ width: 80 }} />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)" }}>{Math.round(polygonIndent * 100)}%</span>
              </>
            )}
          </OptionsBar.Group>
        )}
        {shapeKind === "line" && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Weight</span>
            <input id="mv-line-weight" type="number" min={1} max={500} value={lineWeight}
              onChange={(e) => store.setOptions({ lineWeight: Math.max(1, Math.round(+e.target.value) || 1) })}
              style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>px · Shift = 45°</span>
            <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Arrows</span>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-3)" }}>
              <input id="mv-arrow-start" type="checkbox" checked={lineArrowStart} onChange={(e) => store.setOptions({ lineArrowStart: e.target.checked })} />
              Start
            </label>
            <label style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--text-3)" }}>
              <input id="mv-arrow-end" type="checkbox" checked={lineArrowEnd} onChange={(e) => store.setOptions({ lineArrowEnd: e.target.checked })} />
              End
            </label>
            {(lineArrowStart || lineArrowEnd) && (
              <>
                <span style={{ color: "var(--text-3)" }}>W px</span>
                <input id="mv-arrow-width" type="number" min={1} max={10000} value={lineArrowWidth}
                  onChange={(e) => store.setOptions({ lineArrowWidth: Math.max(1, Math.min(10000, Math.round(+e.target.value) || 1)) })}
                  style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                <span style={{ color: "var(--text-3)" }}>L px</span>
                <input id="mv-arrow-length" type="number" min={1} max={10000} value={lineArrowLength}
                  onChange={(e) => store.setOptions({ lineArrowLength: Math.max(1, Math.min(10000, Math.round(+e.target.value) || 1)) })}
                  style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
                <span style={{ color: "var(--text-3)" }}>Concavity</span>
                <input id="mv-arrow-concavity" type="number" min={-50} max={50} value={lineArrowConcavity}
                  onChange={(e) => store.setOptions({ lineArrowConcavity: Math.max(-50, Math.min(50, Math.round(+e.target.value) || 0)) })}
                  style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
              </>
            )}
          </OptionsBar.Group>
        )}
        {shapeKind === "roundrect" && (
          <OptionsBar.Group>
            <span style={{ color: "var(--text-3)" }}>Radius</span>
            <input id="mv-roundrect-radius" type="number" min={0} max={500} value={roundRectRadius}
              onChange={(e) => store.setOptions({ roundRectRadius: Math.max(0, Math.round(+e.target.value) || 0) })}
              style={{ width: 56, background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--line)", borderRadius: 4, fontSize: 11, padding: "2px 4px" }} />
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>px</span>
          </OptionsBar.Group>
        )}
      </OptionsBar>
    );
  }
  if (tool === "redeye") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Pupil Size", redeyePupil, 0, 1, (v) => store.setOptions({ redeyePupil: v }), (v) => `${Math.round(v * 100)}%`)}
          {slider("Darken Amount", redeyeDarken, 0, 1, (v) => store.setOptions({ redeyeDarken: v }), (v) => `${Math.round(v * 100)}%`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Drag a rectangle over the eye to remove red</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "spothealing") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Size", b.size, 1, 400, (v) => store.setBrush({ size: v }), (v) => `${Math.round(v)}px`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          {/* Photoshop's Spot Healing Type. Content-Aware and Create Texture both
              synthesize from the surroundings (best-match vs random donor patches);
              Proximity Match diffuses the colour around the edge inward. */}
          <span style={{ color: "var(--text-3)" }}>Type</span>
          <SegmentedControl value={String(b.spotHealType)} onChange={(v) => store.setBrush({ spotHealType: +v })}
            items={[{ value: "0", label: "Content-Aware" }, { value: "1", label: "Proximity Match" }, { value: "2", label: "Create Texture" }]} />
          <Checkbox checked={b.spotHealSampleAll} onChange={(v) => store.setBrush({ spotHealSampleAll: v })}>Sample All Layers</Checkbox>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "remove") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Size", b.size, 1, 400, (v) => store.setBrush({ size: v }), (v) => `${Math.round(v)}px`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Brush over a distraction, then release to erase it (Content-Aware)</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "adjustmentbrush") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          {slider("Size", b.size, 1, 400, (v) => store.setBrush({ size: v }), (v) => `${Math.round(v)}px`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Brush to reveal a local adjustment; tune its amount in the Properties panel</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "crop") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Ratio</span>
          <Select size="sm" id="mv-crop-aspect" value={cropAspect}
            onChange={(v) => store.setOptions({ cropAspect: v })}
            options={CROP_ASPECTS.map((a) => ({ value: a.key, label: a.label }))} />
          <span style={{ color: "var(--text-3)", marginLeft: 8 }}>Overlay</span>
          <Select size="sm" id="mv-crop-overlay" value={cropOverlay}
            onChange={(v) => store.setOptions({ cropOverlay: v as typeof cropOverlay })}
            options={CROP_OVERLAYS.map((o) => ({ value: o.key, label: o.label }))} />
          <span style={{ marginLeft: 8 }}>
            <Checkbox checked={cropContentAware} onChange={(v) => store.setOptions({ cropContentAware: v })}>Content-Aware</Checkbox>
          </span>
          <span style={{ marginLeft: 8 }}>
            <Checkbox checked={cropDeletePixels} onChange={(v) => store.setOptions({ cropDeletePixels: v })}>Delete Cropped Pixels</Checkbox>
          </span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>
            {cropContentAware
              ? "Drag past the edges to fill the exposed border"
              : cropDeletePixels ? "Drag a rectangle, release to crop" : "Drag to crop — cropped pixels are kept for Reveal All"}
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "frame") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Frame</span>
          <SegmentedControl value={frameMode} onChange={(v) => store.setOptions({ frameMode: v as "rect" | "ellipse" })}
            items={[{ value: "rect", label: "Rectangular" }, { value: "ellipse", label: "Elliptical" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Drag to create a frame · drop or place an image to fill it</span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "artboard") {
    const sel = artboards.find((a) => a.id === selectedArtboard) ?? null;
    // Artboard Options ▸ Artboard Background Color. Read straight from the engine
    // (the artboard list only carries bounds + name); every commit resyncs the
    // store, so this re-renders with the new colour.
    const bg = toArtboardBackground(sel ? engine.e.artboard_background(sel.id) : null);
    const applyBg = (next: ArtboardRGBA) => {
      if (sel && engine.e.set_artboard_background(sel.id, next[0], next[1], next[2], next[3])) engine.commit();
    };
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Size</span>
          <Select size="sm" id="mv-artboard-preset" value={artboardPreset} aria-label="Artboard size preset"
            onChange={(v) => store.setOptions({ artboardPreset: v })}
            options={ARTBOARD_PRESETS.map((p) => ({ value: p.name }))} />
          <SegmentedControl value={artboardOrientation} onChange={(v) => store.setOptions({ artboardOrientation: v as "portrait" | "landscape" })}
            items={[{ value: "landscape", label: "Landscape" }, { value: "portrait", label: "Portrait" }]} />
          <button id="mv-artboard-add" style={BAR_BTN} onClick={() => store.createArtboardPreset()}>Add Artboard</button>
        </OptionsBar.Group>
        <OptionsBar.Group>
          {/* Keep a stable height (Delete always present, disabled when nothing's
              selected) so selecting an artboard never reflows + shifts the canvas. */}
          {sel ? (
            <span data-mv-artboard-dims style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {sel.w} × {sel.h} px
            </span>
          ) : (
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>Drag to create an artboard · click one to select, drag to move, handles to resize</span>
          )}
          {/* Background stays mounted (disabled without a selection) for the same
              no-reflow reason as Delete. Transparent is how a UI/icon artboard
              exports with alpha instead of on white. */}
          <span style={{ color: "var(--text-3)" }}>Background</span>
          <Select size="sm" id="mv-artboard-bg" value={artboardBackgroundChoice(bg)} disabled={!sel} aria-label="Artboard background color"
            onChange={(v) => applyBg(resolveArtboardBackground(v as ArtboardBackground, bg, artboardBackgroundHex(bg)))}
            options={ARTBOARD_BACKGROUNDS} />
          <input id="mv-artboard-bg-color" type="color" disabled={!sel} aria-label="Artboard background swatch"
            value={artboardBackgroundHex(bg)}
            onChange={(e) => applyBg(resolveArtboardBackground("other", bg, e.target.value))}
            style={{ width: 26, height: 20, padding: 0, background: "none", border: "1px solid var(--line)", borderRadius: 4 }} />
          <button id="mv-artboard-delete" style={BAR_BTN} disabled={!sel} onClick={() => store.deleteSelectedArtboard()}>Delete</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "slice") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <Checkbox id="mv-slice-show" checked={showSlices} onChange={() => store.toggleShowSlices()}>Show Slices</Checkbox>
          <Checkbox id="mv-slice-lock" checked={slicesLocked} onChange={() => store.toggleLockSlices()}>Lock Slices</Checkbox>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span data-mv-slice-count={slices.length} style={{ color: "var(--text-3)", fontSize: 11 }}>
            {slices.length} slice{slices.length === 1 ? "" : "s"} · drag to draw a new one
          </span>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "sliceselect") {
    const sel = selectedSlice >= 0 && selectedSlice < slices.length ? slices[selectedSlice] : null;
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <Checkbox id="mv-slice-show" checked={showSlices} onChange={() => store.toggleShowSlices()}>Show Slices</Checkbox>
          <Checkbox id="mv-slice-lock" checked={slicesLocked} onChange={() => store.toggleLockSlices()}>Lock Slices</Checkbox>
        </OptionsBar.Group>
        <OptionsBar.Group>
          {sel ? (
            <span data-mv-slice-dims style={{ color: "var(--text-1)", fontFamily: "var(--font-mono)", fontSize: 11 }}>
              {`W ${sel.w}  H ${sel.h}  X ${sel.x}  Y ${sel.y}`}
            </span>
          ) : (
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>Click a slice to select; drag to move, handles to resize, Delete to remove</span>
          )}
          <button id="mv-slice-delete" style={BAR_BTN} disabled={!sel || slicesLocked} onClick={() => store.deleteSelectedSlice()}>Delete</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "dropper") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Sample Size</span>
          <SegmentedControl value={String(sampleSize)} onChange={(v) => store.setOptions({ sampleSize: +v })}
            items={[{ value: "1", label: "Point" }, { value: "3", label: "3×3" }, { value: "5", label: "5×5" }, { value: "11", label: "11×11" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Sample</span>
          <SegmentedControl value={String(sampleMode)} onChange={(v) => store.setOptions({ sampleMode: +v })}
            items={[{ value: "0", label: "All Layers" }, { value: "1", label: "Current Layer" }, { value: "2", label: "Current & Below" }]} />
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "colorsampler") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Color Sampler</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)" }}>{colorSamplers.length}/10</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Sample Size</span>
          <SegmentedControl value={String(sampleSize)} onChange={(v) => store.setOptions({ sampleSize: +v })}
            items={[{ value: "1", label: "Point" }, { value: "3", label: "3×3" }, { value: "5", label: "5×5" }, { value: "11", label: "11×11" }]} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Click to add · Alt-click to remove · drag to move</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button style={BAR_BTN} onClick={() => store.clearColorSamplers()}>Clear</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "note") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Author</span>
          <Input id="mv-note-author" value={noteAuthor} style={{ width: 120 }}
            onChange={(e) => store.setNoteAuthor(e.target.value)} />
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>{notes.length} note{notes.length === 1 ? "" : "s"}</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button style={BAR_BTN} onClick={() => store.clearNotes()}>Clear All</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "ruler") {
    const r = rulerLine;
    const dx = r ? r.x1 - r.x0 : 0, dy = r ? r.y1 - r.y0 : 0;
    const len = Math.hypot(dx, dy), ang = (Math.atan2(-dy, dx) * 180) / Math.PI;
    const cell = (k: string, v: string) => (
      <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)" }}>
        <span style={{ color: "var(--text-3)" }}>{k} </span>{v}</span>
    );
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Ruler</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          {cell("X", `${r ? Math.round(r.x0) : 0}`)}{cell("Y", `${r ? Math.round(r.y0) : 0}`)}
          {cell("W", `${Math.round(dx)}`)}{cell("H", `${Math.round(dy)}`)}
          {cell("D", `${len.toFixed(1)}`)}{cell("A", `${ang.toFixed(1)}°`)}
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button id="mv-ruler-straighten" style={BAR_BTN} disabled={!r}
            onClick={() => { if (r) { const deg = straightenAngle(dx, dy); if (Math.abs(deg) > 0.01) xform.rotateArbitrary(deg); store.setRulerLine(null); } }}>
            Straighten Layer
          </button>
          <button style={BAR_BTN} onClick={() => store.setRulerLine(null)}>Clear</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "zoom") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Zoom</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button id="mv-zoom-actual" style={BAR_BTN} onClick={() => store.requestZoom("actual")}>100%</button>
          <button id="mv-zoom-fit" style={BAR_BTN} onClick={() => store.fit()}>Fit Screen</button>
          <button id="mv-zoom-fill" style={BAR_BTN} onClick={() => store.requestZoom("fill")}>Fill Screen</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  if (tool === "count") {
    return (
      <OptionsBar>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)" }}>Count</span>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)" }}>{countPoints.length}</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 11 }}>Click to add · Alt-click to remove</span>
        </OptionsBar.Group>
        <OptionsBar.Group>
          <button style={BAR_BTN} onClick={() => store.clearCountPoints()}>Clear</button>
        </OptionsBar.Group>
      </OptionsBar>
    );
  }
  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span style={{ color: "var(--text-3)" }}>{labelForTool(tool)}</span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}

function labelForTool(t: ToolId) {
  switch (t) {
    case "move": return "Drag to move the active layer";
    case "crop": return "Drag a rectangle, release to crop";
    case "frame": return "Drag to create a frame · drop or place an image to fill it";
    case "artboard": return "Drag empty canvas to create an artboard · click to select · drag body to move · handles to resize · Delete to remove";
    case "dropper": return "Click to sample a color";
    case "colorsampler": return "Click to add a sample point · Alt-click to remove · drag to move";
    case "note": return "Click to add a note · click a note to edit · drag to move · Alt-click to delete";
    case "hand": return "Drag to pan · scroll to pan · ⌘scroll to zoom";
    case "zoom": return "Click to zoom in · Alt-click to zoom out";
    case "text": return "Click to place text · double-click a type layer to edit";
    case "ruler": return "Drag to measure distance and angle";
    case "count": return "Click to add a count marker · Alt-click to remove";
    default: return "";
  }
}

// The pointer position updates on every mousemove over the canvas. Isolating it
// in a leaf keeps those ~60 Hz updates from re-rendering the whole Editor (which
// rebuilds the menu tree + panels) — see review Perf C2.
function CursorReadout() {
  const cursor = useStore((s) => s.cursor);
  return <span>{cursor ? `x ${cursor.x}  y ${cursor.y}` : ""}</span>;
}

// Photoshop's editable status-bar zoom field: type a % + Enter to set the zoom.
// Tracks the live zoom when not being edited; reverts on Escape / invalid input.
function ZoomField() {
  const zoom = useStore((s) => s.zoom);
  const [draft, setDraft] = useState<string | null>(null);
  // The draft also lives in a ref: blur() below dispatches focusout synchronously
  // inside the same keydown, before React flushes setDraft(null), so an Escape
  // that only cleared state would have its stale value re-applied by onBlur. (#241)
  const draftRef = useRef<string | null>(null);
  const setBoth = (v: string | null) => { draftRef.current = v; setDraft(v); };
  const commit = (revert = false) => {
    const d = draftRef.current;
    setBoth(null);
    if (!revert && d !== null) { const z = parseZoomField(d); if (z !== null) store.setZoom(z); }
  };
  return (
    <span style={{ display: "inline-flex", alignItems: "center" }}>
      <input
        id="mv-status-zoom" aria-label="Zoom"
        value={draft ?? String(Math.round(zoom * 100))}
        onChange={(e) => setBoth(e.currentTarget.value)}
        onFocus={(e) => { setBoth(String(Math.round(zoom * 100))); e.currentTarget.select(); }}
        onBlur={() => commit()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { commit(); e.currentTarget.blur(); }
          else if (e.key === "Escape") { commit(true); e.currentTarget.blur(); }
        }}
        style={{ width: 34, background: "transparent", color: "var(--text-1)", border: "none", fontSize: 11, fontFamily: "var(--font-mono)", textAlign: "right", outline: "none", padding: 0 }}
      />
      <span style={{ color: "var(--text-1)" }}>%</span>
    </span>
  );
}

const LIQUIFY_MODE_ICONS = [
  "M3 8h8M8 4l4 4-4 4",
  "M8 3v3M8 10v3M3 8h3M10 8h3M5.2 5.2l2.1 2.1M10.8 5.2L8.7 7.3M5.2 10.8l2.1-2.1M10.8 10.8L8.7 8.7",
  "M8 3v3M8 10v3M3 8h3M10 8h3M4.8 4.8L7 7M11.2 4.8L9 7M4.8 11.2L7 9M11.2 11.2L9 9",
  "M12.5 4.5A5 5 0 1 0 13 9M12.5 4.5H9.5M12.5 4.5v3",
  "M3.5 4.5A5 5 0 1 1 3 9M3.5 4.5h3M3.5 4.5v3",
  "M13 8A5 5 0 1 1 11.5 4.5M13 3v5H8",
  "M8 2v12M2 8h12M3.7 3.7l8.6 8.6M12.3 3.7l-8.6 8.6",
  "M8 2.5c1.9 2.4 3.2 4.2 3.2 6.2a3.2 3.2 0 0 1-6.4 0C4.8 6.7 6.1 4.9 8 2.5zM5.7 11.3l4.6-4.6",
  "M2 11c1.6-4 3-6 4.4-6 1.5 0 1.6 6 3.2 6 1.3 0 2.5-2 4.4-5",
  "M13 8H5M8.5 4.5 5 8l3.5 3.5M3 3v10",
] as const;

const LIQUIFY_MODE_TITLES = [
  "Forward Warp",
  "Bloat",
  "Pucker",
  "Twirl Clockwise",
  "Twirl Counterclockwise",
  "Reconstruct",
  "Freeze Mask",
  "Thaw Mask",
  "Smooth",
  "Push Left",
  "Reconstruct — Rigid",
  "Reconstruct — Stiff",
  "Reconstruct — Smooth",
  "Reconstruct — Loose",
] as const;

// Photoshop's Reconstruct Options: the same reconstruct brush, differing only in
// how much of the surrounding mesh it keeps as it relaxes. Strength is the
// "amount". Rendered both in the options bar and the workspace settings panel.
function LiquifyReconstructModes({ mode, style }: { mode: number; style: React.CSSProperties }) {
  return (
    <>
      {LIQUIFY_RECONSTRUCT_MODES.map(({ mode: m, label }) => {
        const active = mode === m;
        return (
          <button
            key={m}
            type="button"
            // The rail already owns a plain "Smooth" tool — keep these names distinct.
            aria-label={`Reconstruct ${label}`}
            aria-pressed={active}
            data-mv-liquify-reconstruct-mode={m}
            data-mv-liquify-reconstruct-mode-active={active ? "1" : "0"}
            title={`Reconstruct brush — ${label}. Strength is the reconstruct amount.`}
            onClick={() => store.setLiquify({ mode: m })}
            style={active ? { ...style, borderColor: "var(--accent-raster)", color: "var(--accent-raster)" } : style}
          >
            {label}
          </button>
        );
      })}
    </>
  );
}

const LIQUIFY_PANEL: React.CSSProperties = {
  pointerEvents: "auto",
  border: "1px solid rgba(255,255,255,0.14)",
  background: "rgba(24,27,33,0.96)",
  boxShadow: "0 12px 40px rgba(0,0,0,0.45)",
  borderRadius: 8,
};

function LiquifyWorkspaceIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false" style={{ display: "block" }}>
      <path d={path} fill="none" stroke="currentColor" strokeWidth="1.35" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function LiquifyWorkspaceSlider({ label, value, min, max, onChange, fmt }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void; fmt: (v: number) => string }) {
  return (
    <label style={{ display: "grid", gridTemplateColumns: "1fr auto", gap: "5px 10px", alignItems: "center" }}>
      <span style={{ color: "var(--text-3)", fontSize: 11 }}>{label}</span>
      <span style={{ color: "var(--text-1)", fontSize: 11, fontFamily: "var(--font-mono)", minWidth: 42, textAlign: "right" }}>{fmt(value)}</span>
      <Slider value={(value - min) / (max - min)} accent={ACCENT} onChange={(f) => onChange(min + f * (max - min))} style={{ gridColumn: "1 / -1", width: "100%" }} />
    </label>
  );
}

function LiquifyWorkspaceSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section style={{ display: "grid", gap: 10 }}>
      <div style={{ fontSize: 10, letterSpacing: 0, textTransform: "uppercase", color: "var(--text-3)", fontWeight: 700 }}>{title}</div>
      {children}
    </section>
  );
}

const VP_TOOLS = [
  { id: "edit", label: "Edit Plane", title: "Edit Plane: click a plane to select it; ⌘/Ctrl-drag an edge handle to tear off a plane" },
  { id: "marquee", label: "Marquee", title: "Marquee: drag on a plane to select in perspective; drag inside to move the selection, Alt-drag to clone it" },
  { id: "stamp", label: "Stamp", title: "Stamp: Alt-click a source, then paint to clone in perspective" },
] as const;
const VP_EDGES = ["Top", "Right", "Bottom", "Left"];
const VP_CORNERS = ["TL X", "TL Y", "TR X", "TR Y", "BR X", "BR Y", "BL X", "BL Y"];

/** Float the clipboard image onto the active Vanishing Point plane (⌘V in the
 *  workspace). The float moves with the Marquee and renders on OK. */
async function pasteIntoPerspective() {
  const target = await store.readyClipboardForPaste();
  if (!store.state.vanishingPointSession) return;
  if (!target || !target.has_clipboard()) {
    engine.onEditError?.("Copy an image first (Edit ▸ Copy), then paste it into the plane.");
    return;
  }
  const img = await pngToImageData(target.clipboard_png(), false);
  const index = store.state.vanishingPointActivePlane;
  const plane = store.state.vanishingPointPlanes[index];
  if (!img || !plane || engine.engine !== target || !store.state.vanishingPointSession) return;
  const { width: w, height: h } = img;
  store.setVanishingFloat(img.data, w, h, [0, 0, w, 0, w, h, 0, h], fitFloatRect(plane.quad, w, h, index));
  store.setOptions({ vanishingPointTool: "marquee" });
}

function VanishingPointWorkspace() {
  const open = useStore((s) => s.vanishingPointSession);
  const vpTool = useStore((s) => s.vanishingPointTool);
  const planes = useStore((s) => s.vanishingPointPlanes);
  const active = useStore((s) => s.vanishingPointActivePlane);
  const docW = useStore((s) => s.doc.width);
  const docH = useStore((s) => s.doc.height);
  const [edge, setEdge] = useState(1);
  if (!open) return null;
  const plane = planes[active];
  let root = active;
  while (planes[root] && planes[root].parent !== null) root = planes[root].parent!;
  const rootQuad = planes[root]?.quad ?? [];
  const panelButton: React.CSSProperties = { ...BAR_BTN, minHeight: 26, padding: "3px 9px" };
  const field: React.CSSProperties = { display: "grid", gridTemplateColumns: "auto 1fr", gap: 6, alignItems: "center", color: "var(--text-3)", fontSize: 11 };
  return (
    <div data-mv-vp-workspace="1" role="dialog" aria-modal="true" aria-label="Vanishing Point"
      style={{ position: "fixed", inset: 0, zIndex: 40, pointerEvents: "none" }}>
      <div style={{ position: "absolute", top: 8, left: 8, right: 8, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, ...LIQUIFY_PANEL, padding: "8px 10px", minHeight: 42 }}>
        <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", whiteSpace: "nowrap" }}>Vanishing Point</div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button type="button" style={BAR_BTN} title="Discard every change made in Vanishing Point (also Esc)" onClick={() => store.cancelVanishingPoint()}>Cancel</button>
          <button type="button" style={{ ...BAR_BTN, borderColor: "var(--accent-raster)", color: "var(--accent-raster)" }} title="Apply to the active layer (also Enter)" onClick={() => store.applyVanishingPoint()}>OK</button>
        </div>
      </div>
      <div role="toolbar" aria-label="Vanishing Point tools" aria-orientation="vertical"
        style={{ position: "absolute", left: 12, top: 70, display: "grid", gap: 6, padding: 8, ...LIQUIFY_PANEL }}>
        {VP_TOOLS.map((t) => (
          <button key={t.id} type="button" aria-label={t.label} aria-pressed={vpTool === t.id} title={t.title} data-mv-vp-tool={t.id}
            onClick={() => store.setOptions({ vanishingPointTool: t.id })}
            style={{ ...panelButton, ...(vpTool === t.id ? { borderColor: "var(--accent-raster)", color: "var(--accent-raster)" } : null) }}>
            {t.label}
          </button>
        ))}
      </div>
      <div style={{ position: "absolute", top: 70, right: 12, width: 252, maxHeight: "calc(100vh - 90px)", overflow: "auto", display: "grid", gap: 16, padding: 12, ...LIQUIFY_PANEL }}>
        <LiquifyWorkspaceSection title="Planes">
          <Select block size="sm" aria-label="Vanishing Point plane" value={String(active)} onChange={(v) => store.setOptions({ vanishingPointActivePlane: +v })}
            options={planes.map((p, i) => ({
              value: String(i),
              label: p.parent === null ? `Plane ${i + 1}` : `Plane ${i + 1} (from Plane ${p.parent + 1}, ${VP_EDGES[p.edge]?.toLowerCase()} edge)`,
            }))} />
          <div style={{ display: "flex", gap: 6 }}>
            <Select size="sm" aria-label="Tear-off edge" value={String(edge)} onChange={(v) => setEdge(+v)}
              options={VP_EDGES.map((name, i) => ({ value: String(i), label: name }))} />
            <button type="button" style={panelButton} title="Tear off a plane at 90° from this edge of the active plane (or ⌘/Ctrl-drag an edge handle)"
              onClick={() => store.tearOffVanishingPlane(active, edge)}>Tear Off</button>
          </div>
          <label style={field}>
            Angle
            <NumberField aria-label="Angle" size="sm" value={plane?.angle ?? 90} min={1} max={359} suffix="°"
              disabled={!plane || plane.parent === null} onChange={(v) => store.setVanishingPlaneAngle(v)} />
          </label>
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title={`Plane ${root + 1} Corners`}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {VP_CORNERS.map((label, i) => (
              <label key={label} style={field}>
                {label}
                <NumberField aria-label={label} size="sm" value={Math.round(rootQuad[i] ?? 0)} min={0} max={i % 2 ? docH : docW}
                  onChange={(v) => store.setVanishingRootCorner(i, v)} />
              </label>
            ))}
          </div>
          <button type="button" style={panelButton} title="Replace every plane with the default plane and clear the source" onClick={() => store.resetVanishingPlanes()}>Reset</button>
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title="Edit">
          <button type="button" style={panelButton} title="Float the clipboard image onto the active plane (also ⌘V)" onClick={() => void pasteIntoPerspective()}>Paste into Perspective</button>
        </LiquifyWorkspaceSection>
      </div>
    </div>
  );
}

function LiquifyWorkspace({ open, onApply, onCancel }: { open: boolean; onApply: () => void; onCancel: () => void }) {
  const lq = useStore((s) => s.liquify);
  const layers = useStore((s) => s.layers);
  const liquifyTargets = useMemo(() => layers.filter((layer) => layer.kind === LAYER_KIND.pixel && !layer.locked), [layers]);
  const liquifyTargetValue = lq.targetLayerId > 0 && liquifyTargets.some((layer) => layer.id === lq.targetLayerId) ? String(lq.targetLayerId) : "0";
  // How From Transparency / From Layer Mask combine with the existing freeze
  // mask (0 Replace · 1 Add · 2 Subtract · 3 Intersect) — the same op codes the
  // selection tools use. Panel-local: it is a choice, not document state.
  const [liquifyMaskOp, setLiquifyMaskOp] = useState(0);
  if (!open) return null;
  const modeName = LIQUIFY_MODE_TITLES[lq.mode] ?? LIQUIFY_MODES[lq.mode] ?? "Liquify";
  const panelButton: React.CSSProperties = { ...BAR_BTN, minHeight: 26, padding: "3px 9px" };
  return (
    <div
      data-mv-liquify-workspace="1"
      role="dialog"
      aria-modal="true"
      aria-label="Liquify"
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 40,
        pointerEvents: "none",
        background: "linear-gradient(180deg, rgba(8,10,14,0.72), rgba(8,10,14,0.18) 18%, rgba(8,10,14,0.18) 78%, rgba(8,10,14,0.68))",
      }}
    >
      <div
        data-mv-liquify-workspace-header="1"
        style={{
          position: "absolute",
          top: 8,
          left: 8,
          right: 8,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 12,
          ...LIQUIFY_PANEL,
          padding: "8px 10px",
          minHeight: 42,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 800, color: "var(--text-1)", whiteSpace: "nowrap" }}>Liquify</div>
          <div style={{ fontSize: 12, color: "var(--text-2)", whiteSpace: "nowrap" }} data-mv-liquify-active-mode={lq.mode}>{modeName}</div>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <label style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ color: "var(--text-3)", fontSize: 11 }}>Target</span>
            <Select size="sm" id="mv-liquify-target-layer" value={liquifyTargetValue} aria-label="Liquify target layer"
              onChange={(v) => store.setLiquify({ targetLayerId: +v })}
              options={[{ value: "0", label: "Active Layer" }, ...liquifyTargets.map((layer) => ({ value: String(layer.id), label: layer.name }))]} />
          </label>
          <button type="button" style={BAR_BTN} title="Discard the warp (also Esc)" onClick={onCancel}>Cancel</button>
          <button type="button" style={{ ...BAR_BTN, borderColor: "var(--accent-raster)", color: "var(--accent-raster)" }} title="Apply the warp (also Enter)" onClick={onApply}>Apply</button>
        </div>
      </div>
      <div
        data-mv-liquify-tool-rail="1"
        role="toolbar"
        aria-label="Liquify tools"
        style={{
          position: "absolute",
          left: 12,
          top: 70,
          display: "grid",
          gap: 6,
          padding: 8,
          ...LIQUIFY_PANEL,
        }}
      >
        {LIQUIFY_TOOL_MODES.map((mode) => {
          const label = LIQUIFY_MODES[mode];
          const active = lq.mode === mode;
          return (
            <button
              key={mode}
              type="button"
              aria-label={LIQUIFY_MODE_TITLES[mode] ?? label}
              aria-pressed={active}
              title={LIQUIFY_MODE_TITLES[mode] ?? label}
              data-mv-liquify-workspace-mode={mode}
              data-mv-liquify-workspace-mode-active={active ? "1" : "0"}
              onClick={() => store.setLiquify({ mode })}
              style={{
                width: 34,
                height: 34,
                display: "grid",
                placeItems: "center",
                borderRadius: 6,
                border: active ? "1px solid var(--accent-raster)" : "1px solid transparent",
                background: active ? "rgba(108,178,255,0.18)" : "rgba(255,255,255,0.06)",
                color: active ? "var(--accent-raster)" : "var(--text-2)",
                cursor: "pointer",
              }}
            >
              <LiquifyWorkspaceIcon path={LIQUIFY_MODE_ICONS[mode]} />
            </button>
          );
        })}
      </div>
      <div
        data-mv-liquify-settings-panel="1"
        style={{
          position: "absolute",
          top: 70,
          right: 12,
          width: 252,
          maxHeight: "calc(100vh - 90px)",
          overflow: "auto",
          display: "grid",
          gap: 16,
          padding: 12,
          ...LIQUIFY_PANEL,
        }}
      >
        <LiquifyWorkspaceSection title="Brush">
          <LiquifyWorkspaceSlider label="Size" value={lq.size} min={1} max={600} onChange={(v) => store.setLiquify({ size: v })} fmt={(v) => `${Math.round(v)}px`} />
          <LiquifyWorkspaceSlider label="Density" value={lq.density} min={0} max={1} onChange={(v) => store.setLiquify({ density: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <LiquifyWorkspaceSlider label="Pressure" value={lq.pressure} min={0} max={1} onChange={(v) => store.setLiquify({ pressure: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <LiquifyWorkspaceSlider label="Strength" value={lq.strength} min={0} max={1} onChange={(v) => store.setLiquify({ strength: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          {/* Rate drives the repeat-dab timer: 0 = dabs only on pointer move (the
              historical behaviour), higher = keeps warping while held still. */}
          <LiquifyWorkspaceSlider label="Rate" value={lq.rate} min={0} max={1} onChange={(v) => store.setLiquify({ rate: v })} fmt={(v) => `${Math.round(v * 100)}%`} />
          <Checkbox id="mv-liquify-ws-pin-edges" checked={lq.pinEdges} onChange={(v) => store.setLiquify({ pinEdges: v })}>Pin Edges</Checkbox>
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title="Reconstruct Options">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 6 }}>
            <LiquifyReconstructModes mode={lq.mode} style={panelButton} />
          </div>
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title="View">
          <Checkbox id="mv-liquify-preview" checked={lq.preview} onChange={(v) => store.setLiquify({ preview: v })}>Preview</Checkbox>
          <Checkbox id="mv-liquify-show-backdrop" checked={lq.showBackdrop} onChange={(v) => store.setLiquify({ showBackdrop: v })}>Show Backdrop</Checkbox>
          <Checkbox id="mv-liquify-show-mesh" checked={lq.showMesh} onChange={(v) => store.setLiquify({ showMesh: v })}>Show Mesh</Checkbox>
          {lq.showBackdrop && (
            <label style={{ display: "grid", gap: 5 }}>
              <span style={{ color: "var(--text-3)", fontSize: 11 }}>Source</span>
              <Select block size="sm" id="mv-liquify-backdrop-source" value={lq.backdropSource} aria-label="Liquify backdrop source"
                onChange={(v) => store.setLiquify({ backdropSource: v as LiquifyBackdropSource })}
                options={LIQUIFY_BACKDROP_SOURCES} />
            </label>
          )}
          {lq.showBackdrop && <LiquifyWorkspaceSlider label="Backdrop" value={lq.backdropOpacity} min={0} max={1} onChange={(v) => store.setLiquify({ backdropOpacity: v })} fmt={(v) => `${Math.round(v * 100)}%`} />}
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title="Mask">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" style={panelButton} title="Freeze the whole editable Liquify area" onClick={() => store.liquifyMaskAll()}>Mask All</button>
            <button type="button" style={panelButton} title="Clear the Liquify freeze mask" onClick={() => store.liquifyMaskClear()}>Clear</button>
            <button type="button" style={{ ...panelButton, gridColumn: "1 / -1" }} title="Invert the Liquify freeze mask" onClick={() => store.liquifyMaskInvert()}>Invert Mask</button>
            <Select block size="sm" id="mv-liquify-mask-op" aria-label="Liquify mask combine mode" style={{ gridColumn: "1 / -1" }}
              value={String(liquifyMaskOp)} onChange={(v) => setLiquifyMaskOp(+v)}
              options={[{ value: "0", label: "Replace" }, { value: "1", label: "Add" }, { value: "2", label: "Subtract" }, { value: "3", label: "Intersect" }]} />
            <button type="button" style={panelButton} title="Freeze from the layer's transparency" onClick={() => store.liquifyMaskFromTransparency(liquifyMaskOp)}>From Transparency</button>
            <button type="button" style={panelButton} title="Freeze from the layer's mask" onClick={() => store.liquifyMaskFromLayerMask(liquifyMaskOp)}>From Layer Mask</button>
          </div>
        </LiquifyWorkspaceSection>
        <LiquifyWorkspaceSection title="Mesh">
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            <button type="button" style={panelButton} title="Restore all live Liquify distortion without leaving the workspace" onClick={() => store.restoreLiquify()}>Restore</button>
            <button type="button" style={panelButton} title="Save the current live Liquify mesh for this session" onClick={() => store.saveLiquifyMesh()}>Save</button>
            <button type="button" style={panelButton} title="Load the last saved same-size Liquify mesh" onClick={() => store.loadLiquifyMesh()}>Load</button>
            <button type="button" style={panelButton} title="Export the current live Liquify mesh to a same-size file" onClick={() => void exportLiquifyMeshFile()}>Export</button>
            <button type="button" style={{ ...panelButton, gridColumn: "1 / -1" }} title="Import a same-size Liquify mesh file into this workspace" onClick={() => void importLiquifyMeshFile()}>Import Mesh</button>
          </div>
        </LiquifyWorkspaceSection>
      </div>
    </div>
  );
}

/** The menu ids that should show a checkmark for the active type layer's spec:
 *  the four legacy OpenType toggles, every enabled advanced feature tag
 *  (whose menu id is the tag itself — see psMenus PATH_WIRING) and East Asian
 *  Features. */
function openTypeCheckedIds(spec: TextSpec): Set<string> {
  const ids = new Set<string>();
  if (spec.eastAsian) ids.add("langeastasian");
  if (spec.liga) ids.add("otliga");
  if (spec.dlig) ids.add("otdlig");
  if (spec.frac) ids.add("otfrac");
  if (spec.ordn) ids.add("otordn");
  if (spec.features) for (const [tag, on] of Object.entries(spec.features)) if (on) ids.add(tag);
  return ids;
}

/** Edit ▸ Transform retargets to the Pen work path whenever a path tool holds
 *  one — Photoshop's "Transform Path". Returns false when the layer is still the
 *  target, so each menu action falls back to its `xform` layer op. */
function transformPath(t: PathTransform): boolean {
  return store.pathIsTransformTarget() && store.transformWorkPath(t);
}

// ── Window ▸ Arrange ────────────────────────────────────────
// Photoshop's "New Window for <doc>" is a second live view of the same document
// at its own zoom (paint at 400%, watch the 100% result), and Tile / Tile All
// puts every open document up n-up. Vision keeps one main canvas — documents
// are tabs — so both land as one dockable panel of real canvas views: every
// pane is a CanvasView with its own zoom, pan and rotation that takes the same
// tools. A pane mirrors the live canvas dab by dab while its document is the
// active one; a pane over a background document activates it on first click.
function SecondViewPanel({ mode }: { mode: ArrangeMode }) {
  const floatDocs = useStore((s) => s.floatDocs);
  // A floated document's view is its own window (and owns its view state).
  const documents = useStore((s) => s.documents).filter((d) => !floatDocs.includes(d.id));
  const activeDocId = useStore((s) => s.activeDocId);
  const zoom = useStore((s) => viewOf(s, activeDocId).zoom);
  const single = mode === "single";
  const panes = single ? documents.filter((d) => d.id === activeDocId) : documents;
  if (!panes.length) {
    return <span style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", fontSize: 11, color: "var(--text-3)" }}>No document</span>;
  }
  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", minHeight: 0, gap: 6 }}>
      <div
        data-mv-secondview={mode}
        style={{
          flex: 1, minHeight: 0, display: "grid", gap: 6,
          gridTemplateColumns: `repeat(${arrangeColumns(panes.length, mode)}, minmax(0, 1fr))`,
          gridAutoRows: "minmax(140px, 1fr)",
        }}
      >
        {panes.map((d) => (
          <div
            key={d.id} data-mv-secondview-tile={d.id} role="group" aria-label={`${d.name} view`}
            aria-current={d.id === activeDocId ? "true" : undefined}
            style={{
              display: "flex", flexDirection: "column", minHeight: 0, overflow: "hidden", borderRadius: 4,
              // The same width either way: activating a pane mid-gesture must not
              // move the canvas under the pointer.
              border: `1px solid ${d.id === activeDocId ? ACCENT : "var(--stroke-soft)"}`,
            }}
          >
            {!single && (
              <span style={{ padding: "2px 4px", fontSize: 11, color: "var(--text-1)", background: "var(--glass-1)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {d.name}{d.dirty ? "*" : ""}
              </span>
            )}
            <div style={{ position: "relative", flex: 1, minHeight: 0 }}>
              <CanvasView paneDocId={d.id} />
            </div>
          </div>
        ))}
      </div>
      {single && (
        <div className="monet-row" style={{ gap: 6, alignItems: "center" }}>
          <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--text-1)", minWidth: 44 }}>{Math.round(zoom * 100)}%</span>
          <Slider
            id="mv-secondview-zoom" aria-label="Second view zoom" min={2} max={3200} step={1} accent={ACCENT}
            value={Math.round(zoom * 100)}
            onChange={(v) => store.setPaneZoom(activeDocId, v / 100)}
            style={{ flex: 1 }}
          />
        </div>
      )}
    </div>
  );
}

// The layers a Layer-menu command acts on: the Layers panel's multi-selection
// when there is one, else the active layer — the same rule align/distribute/
// group already follow (store.ts groupSelectedLayers). (#243)
function targetLayerIds(): number[] {
  const { selectedLayerIds, activeLayerId } = store.state;
  return selectedLayerIds.length ? [...selectedLayerIds] : [activeLayerId];
}

// View ▸ Show ▸ All / None: the patch that flips every extra the Show submenu
// wires, not just the grid and guides it used to touch. (#240)
function showExtrasPatch(v: boolean) {
  return {
    showGrid: v, showGuides: v, showLayerEdges: v, showSelectionEdges: v,
    showSmartGuides: v, showTargetPath: v, showBrushPreview: v, showPixelGrid: v,
    showCount: v, showSamplers: v, showNotes: v, showSlices: v,
  };
}

function Editor({ platform }: { platform: Platform }) {
  const { open } = useDialogs();
  const placeInputRef = useRef<HTMLInputElement>(null);
  const gifInputRef = useRef<HTMLInputElement>(null);
  const [taskBarOpen, setTaskBarOpen] = useState(true);
  const [arrangeMode, setArrangeMode] = useState<ArrangeMode>("single");
  const dockRef = useRef<DockableWorkspaceHandle>(null);
  useEffect(() => {
    store.getWorkspace = () => dockRef.current;
    return () => { store.getWorkspace = () => null; };
  }, []);
  const [workspaces, setWorkspaces] = useState<SavedWorkspace[]>(loadWorkspacesLS);
  const [persistedLayout] = useState(loadLastLayoutLS);
  const [persistedToolbarLayout] = useState(loadLastToolbarLS);
  const toolbarConfiguration = useStore((s) => s.toolbarConfiguration);
  const tools = useMemo(() => configuredToolRail(toolbarConfiguration), [toolbarConfiguration]);
  const doc = useStore((s) => s.doc);
  const selectionActive = useStore((s) => s.selectionActive);
  const canUndo = useStore((s) => s.canUndo);
  const undoLabel = useStore((s) => s.undoLabel);
  const canRedo = useStore((s) => s.canRedo);
  const canFade = useStore((s) => s.canFade);
  const canReselect = useStore((s) => s.canReselect);
  const hasClipboard = useStore((s) => s.hasClipboard);
  const selectedLayerIds = useStore((s) => s.selectedLayerIds);
  const hasSmartFilterMask = useStore((s) => s.hasSmartFilterMask);
  const canTransformAgain = useStore(() => store.canRepeatWorkPathTransform() || canRepeatLastTransform());
  // Drain a store-requested dialog (e.g. Camera Raw auto-opens after a RAW open).
  const pendingDialog = useStore((s) => s.pendingDialog);
  useEffect(() => {
    if (!pendingDialog) return;
    if (store.getSnapshot().pendingDialog?.serial !== pendingDialog.serial) return;
    open(pendingDialog.name as Parameters<typeof open>[0], pendingDialog.arg);
    store.clearPendingDialog(pendingDialog.serial);
  }, [pendingDialog, open]);
  const layers = useStore((s) => s.layers);
  const tool = useStore((s) => s.tool);
  const mode = useStore((s) => s.mode);
  const depth = useStore((s) => s.depth);
  const hasDuotone = useStore((s) => !!s.duotone);
  const photoshopPreview = useStore((s) => s.photoshopPreview);
  const colorProfile = useStore((s) => s.colorProfile);
  const colorProfileAssigned = useStore((s) => s.colorProfileAssigned);
  const iccProfileName = useStore((s) => s.iccProfileName);
  const modeProfileName = useStore((s) => s.modeProfileName);
  const statusInfo = useStore((s) => s.statusInfo);
  const measureScale = useStore((s) => s.measureScale);
  const measureScalePresets = useStore((s) => s.measureScalePresets);
  const screenMode = useStore((s) => s.screenMode);
  const documents = useStore((s) => s.documents);
  const floatDocs = useStore((s) => s.floatDocs); // out of the tab bar, in their own windows
  const activeDocId = useStore((s) => s.activeDocId);
  const recentFiles = useStore((s) => s.recentFiles);
  const keyboardShortcuts = useStore((s) => s.keyboardShortcuts);
  const pixelAspect = useStore((s) => s.pixelAspect);
  const pixelAspectPresets = useStore((s) => s.pixelAspectPresets);
  const activeLayerId = useStore((s) => s.activeLayerId);
  const [dropping, setDropping] = useState(false);
  // Tab / ⇧Tab chrome hiding (Photoshop). "" = everything visible, "panels" =
  // docks + floats hidden, "all" = those plus the tool rail and options bar.
  const [chromeHidden, setChromeHidden] = useState<"" | "panels" | "all">("");
  const workspacePrefs = useStore((s) => s.workspacePrefs);
  const [liquifyWorkspaceOpen, setLiquifyWorkspaceOpen] = useState(false);
  const [adaptiveWideOpen, setAdaptiveWideOpen] = useState(false);
  const [vectorMaskOpPicker, setVectorMaskOpPicker] = useState(false);
  const liquifyWorkspaceOpenRef = useRef(liquifyWorkspaceOpen);
  liquifyWorkspaceOpenRef.current = liquifyWorkspaceOpen;
  const puppetRev = useSyncExternalStore(subscribePuppet, getPuppetRev, getPuppetRev);
  const puppetOpenRef = useRef(false);
  puppetOpenRef.current = puppetRev >= 0 && getPuppetSession() != null;
  const toast = useToast();
  const editBlockedToast = useRef<string | null>(null);
  const mlBusy = useRef(false);
  const shortcutCommandsRef = useRef<Map<string, ShortcutCommand>>(new Map());
  const toolShortcutCommandsRef = useRef<Map<string, ShortcutCommand>>(new Map());
  const menuActionsRef = useRef<Record<string, () => void>>({});
  // Edit ▸ Toggle Last State alternates between the two most recent history
  // states, so it has to remember which way it went last — and only alternate
  // while it is still the most recent history move. (#244)
  const lastToggleRef = useRef<{ at: number; undone: boolean } | null>(null);

  useEffect(() => {
    engine.onEditError = (message) => {
      const target = engine.engine;
      if (editBlockedToast.current) toast.dismiss(editBlockedToast.current);
      editBlockedToast.current = toast.push({
        title: "Edit blocked",
        message,
        variant: "warn",
        // Only the engine's float-safety refusals are fixed by converting.
        action: target?.doc_depth() === 32 && message.includes("16 or 8 bits/channel")
          ? { label: "Convert to 16-bit", onClick: () => { if (engine.engine === target) store.setDepth(16); } }
          : undefined,
      });
    };
    return () => {
      engine.onEditError = null;
    };
  }, [toast]);

  const openLiquifyWorkspace = () => {
    store.setTool("liquify");
    setLiquifyWorkspaceOpen(true);
  };
  const applyLiquifyWorkspace = () => {
    store.endLiquify();
    setLiquifyWorkspaceOpen(false);
  };
  const cancelLiquifyWorkspace = () => {
    store.cancelLiquify();
    setLiquifyWorkspaceOpen(false);
  };

  const fillWith = (which: "fg" | "bg") => {
    const c = which === "fg" ? store.state.fg : store.state.bg;
    const [r, g, b, a] = hsvToRgba(c);
    engine.e.fill_selection(r, g, b, a);
    engine.commit();
  };

  // Run a menu-triggered ML job (multi-second, on-device ONNX) with toast
  // feedback and an in-flight lock. The Neural Filters dialog has its own busy
  // state + status line; the fire-and-forget menu actions previously swallowed
  // every failure — including the "Make a selection" message — to console.error
  // with no user signal, and a double-click started two jobs on one engine.
  const runMl = (label: string, job: (p: (m: string) => void) => Promise<unknown>) => {
    if (mlBusy.current) return; // ignore re-entry while a job is running
    mlBusy.current = true;
    const id = toast.push({ message: `${label}…`, variant: "info", duration: null });
    job(() => {})
      .then(() => { toast.dismiss(id); toast.push({ title: label, message: "Done.", variant: "success" }); })
      .catch((e: unknown) => { toast.dismiss(id); toast.push({ title: label, message: e instanceof Error ? e.message : String(e), variant: "error" }); })
      .finally(() => { mlBusy.current = false; });
  };

  // ── document/file commands (shared by the File menu + keyboard) ──
  // These read store.state fresh, so they're safe inside the once-bound keydown
  // listener (no stale React closures).
  const docLabel = (d: DocSummary) => d.name + (d.dirty ? "*" : "");
  const findDoc = (label: string) => store.state.documents.find((d) => d.name === label.replace(/\*$/, ""));
  // false = the user cancelled the save/discard prompt (state/app.ts). (#242)
  const requestClose = (d: DocSummary) => closeDocumentTab(d.id);
  const doNew = () => open("new");
  const doOpen = () => openFiles();
  // Script Events Manager's "Save Document": fires only when a save actually
  // wrote. It used to fire on the promise settling, so a cancelled destination
  // dialog or a failed export ran the bound action anyway — the same misfire
  // Open Document was excluded to avoid (#495).
  const doSave = () => { void saveDocument(); };
  const doSaveAs = () => { void saveDocumentAs(); };
  // Save a Copy writes a copy WITHOUT re-targeting the open document. Wiring it to
  // doSaveAs made every later ⌘S write the copy instead of the original. (#237)
  const doSaveCopy = () => { void saveDocumentAsCopy(); };
  const setRgbMode = () => {
    if (store.state.photoshopPreview && typeof confirm === "function" && !confirm(
      "Convert this read-only Photoshop preview to editable RGB?\n\nThe preserved non-RGB source will no longer be attached to this document. Export the original first if you need another exact copy.",
    )) return;
    store.setColorMode(0);
  };
  const doClose = () => {
    const a = store.state.documents.find((d) => d.id === store.state.activeDocId);
    if (a) void requestClose(a);
  };
  // Cancel in any prompt aborts the whole command (Photoshop), instead of just
  // sparing that one document and marching on through the rest. (#242)
  const doCloseAll = async () => {
    for (const d of [...store.state.documents]) if (!(await requestClose(d))) return;
  };
  const doCloseOthers = async () => {
    const keep = store.state.activeDocId;
    for (const d of [...store.state.documents]) if (d.id !== keep && !(await requestClose(d))) return;
  };

  // File drag-and-drop → open each file as a new document tab. Native Tauri
  // drops arrive as paths; browser/e2e drops arrive as File objects. A droplet
  // dropped with images runs over them instead (#469).
  // Home stands where the canvas does when no document is open (#476), so it is
  // the same drop target — otherwise dragging a photo onto a freshly launched
  // window does nothing, with no overlay to say why.
  const isCanvasDrop = ({ x, y }: FileDropPoint) =>
    isVisionFileDropTarget(document.elementFromPoint(x, y));
  useFileDrop({
    onOver: (over, point) => setDropping(over && !!point && isCanvasDrop(point)),
    onPaths: (paths, point) => { if (isCanvasDrop(point)) void openDroppedPaths(paths); },
    onFiles: (files, point) => { if (isCanvasDrop(point)) void openDroppedFiles(files); },
  });

  // Launch hand-off: `open -a "Monet Vision" photo.tif`, a Finder double-click,
  // or an argv path. src-tauri/main.rs parks those paths (the OS delivers them
  // long before React mounts) and flushes them once we announce we're listening.
  // openPaths replaces only a launch blank marked pristine. A user File ▸ New
  // stays beside the opened file (#528). The droplet app hands
  // over its descriptor with the dropped images, and those run as a batch (#469).
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen, emit }) => installOpenFilesListener(listen, emit, openDroppedPaths))
      .then((u) => { if (cancelled) u(); else un = u; })
      .catch((e) => console.error("Launch file hand-off unavailable:", e));
    return () => { cancelled = true; un?.(); };
  }, []);

  // Command line (#468): `monet-vision --run-script foo.js` or `--play-action
  // Set/Name --batch dir`. main.rs booted this window hidden and hands the job
  // over once we listen; runCliJob's status becomes the process exit code.
  // Every launch listens: the handshake also carries the binary's path for
  // Copy as Command Line.
  useEffect(() => {
    if (!isTauri()) return;
    let un: (() => void) | undefined;
    let cancelled = false;
    void import("@tauri-apps/api/event")
      .then(({ listen, emit }) => installCliListener(listen, emit, runCliJob))
      .then((u) => { if (cancelled) u(); else un = u; })
      .catch((e) => console.error("Command-line hand-off unavailable:", e));
    return () => { cancelled = true; un?.(); };
  }, []);

  // First-run discovery: if an optional AI model (MI-GAN / AI Denoise / SD-1.5) isn't
  // installed, surface it once. Guarded by a mv.* localStorage key so it never
  // nags again — the Model Manager is the persistent surface after that.
  // A command-line job's hidden window has nobody to show it to.
  useEffect(() => {
    if (isCliBoot()) return;
    try { if (localStorage.getItem("mv.modelNoticeShown")) return; } catch { return; }
    let live = true;
    void Promise.all([models.miganInstalled(), models.drunetInstalled(), models.sdStatus(false)]).then(([migan, drunet, sd]) => {
      if (!live) return;
      if (!migan || !drunet || sd !== "real") {
        toast.push({ title: "AI Models", message: "Optional AI models are not installed (MI-GAN, AI Denoise, SD-1.5). Filter ▸ Neural Filters ▸ Manage AI Models.", variant: "info" });
      }
      try { localStorage.setItem("mv.modelNoticeShown", "1"); } catch { /* storage may be unavailable */ }
    });
    return () => { live = false; };
  }, [toast]);

  // keyboard shortcuts
  useEffect(() => {
    type SpringTool = { code: string; previous: ToolId; action: () => void; timer: number; activated: boolean };
    type PendingDigit = {
      kind: "opacity" | "flow" | "fill" | "groupOpacity";
      target: string;
      digit: string;
      at: number;
      timer: number;
      engineInstance: typeof engine.engine;
      docGen: number;
      endPropertyEdit: (() => void) | null;
    };
    let springTool: SpringTool | null = null;
    let pendingDigit: PendingDigit | null = null;
    const clearSpringTool = (restore: boolean) => {
      const pending = springTool;
      if (!pending) return;
      springTool = null;
      window.clearTimeout(pending.timer);
      if (restore && pending.activated) store.setTool(pending.previous);
    };
    const clearPendingDigit = () => {
      const pending = pendingDigit;
      if (!pending) return;
      pendingDigit = null;
      window.clearTimeout(pending.timer);
      pending.endPropertyEdit?.();
    };
    const applyDigit = (
      kind: PendingDigit["kind"], target: string, digit: string, repeat: boolean,
      apply: (percent: number) => void, propertyEdit = false,
    ) => {
      const now = Date.now();
      const exact = !repeat && pendingDigit?.kind === kind && pendingDigit.target === target
        && pendingDigit.engineInstance === engine.engine
        && pendingDigit.docGen === engine.docGen
        && now - pendingDigit.at <= DIGIT_SEQUENCE_MS;
      if (!exact) clearPendingDigit();
      apply(digitSequencePercent(exact ? pendingDigit!.digit : null, digit)!);
      if (exact) { clearPendingDigit(); return; }
      if (repeat) { if (propertyEdit) engine.engine?.end_prop_edit(); return; }
      const propertyEngine = propertyEdit ? engine.engine : null;
      const pending: PendingDigit = {
        kind, target, digit, at: Date.now(), timer: 0,
        engineInstance: engine.engine,
        docGen: engine.docGen,
        endPropertyEdit: propertyEngine ? () => {
          if (engine.engine === propertyEngine) propertyEngine.end_prop_edit();
        } : null,
      };
      pending.timer = window.setTimeout(() => {
        if (pendingDigit === pending) clearPendingDigit();
      }, DIGIT_SEQUENCE_MS);
      pendingDigit = pending;
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      // A focused dropdown owns its keys (type-ahead, Space/arrows to open), so
      // tool chords/opacity digits must not steal them. (#245) A Monet Select
      // stops the keys it handles; an open one counts as a field below.
      // …except Esc in a Vanishing Point field or closed select, which still discards the workspace.
      const vpControl = store.state.vanishingPointSession && t?.closest("[data-mv-vp-workspace]");
      if (isEditableTarget(t) && !(vpControl && e.key === "Escape")) { clearPendingDigit(); return; }
      if (!store.state.documents.length) {
        const shortcut = shortcutFromEvent(e);
        const command = shortcut ? shortcutCommandsRef.current.get(shortcut) : undefined;
        if (command) { e.preventDefault(); command.run(); }
        return; // Home keeps native focus/Space behavior and has no canvas shortcuts.
      }
      const plainDigit = !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey && digitOpacity(e.key) !== null ? e.key : null;
      const shiftDigit = !e.altKey && !e.ctrlKey && !e.metaKey && e.shiftKey ? codeDigit(e.code) : null;
      const preservesShiftSequence = e.key === "Shift"
        && (pendingDigit?.kind === "flow" || pendingDigit?.kind === "fill" || pendingDigit?.kind === "groupOpacity");
      if (plainDigit === null && shiftDigit === null && !preservesShiftSequence) clearPendingDigit();
      // Hold the physical grave/tilde key to erase with the active Brush tip.
      // The tool and brush settings stay selected; release/blur affects the next stroke.
      if (e.code === "Backquote" && store.state.tool === "brush" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        e.preventDefault(); store.setTemporaryErase(true); return;
      }
      // Vanishing Point is modal: Esc discards, Enter applies, ⌘V floats the
      // clipboard onto the active plane. Other keys aimed at the workspace's own
      // controls stay native, so a focused button still activates on Enter/Space.
      if (store.state.vanishingPointSession) {
        const pasteKey = (e.metaKey || e.ctrlKey) && !e.altKey && !e.shiftKey && e.key.toLowerCase() === "v";
        if (e.key !== "Escape" && !pasteKey && vpControl) return;
        if (e.key === "Escape" || e.key === "Enter") {
          e.preventDefault();
          if (e.key === "Enter") store.applyVanishingPoint();
          else store.cancelVanishingPoint();
          return;
        }
        if (pasteKey) {
          e.preventDefault();
          void pasteIntoPerspective();
          return;
        }
      }
      // Liquify owns Enter/Escape only while its workspace or lazy warp session
      // is open; merely selecting the tool must not trap Screen Mode Escape.
      if (store.state.tool === "liquify"
          && (liquifyWorkspaceOpenRef.current || store.hasLiquifySession())
          && (e.key === "Enter" || e.key === "Escape")) {
        e.preventDefault();
        if (e.key === "Enter") applyLiquifyWorkspace();
        else cancelLiquifyWorkspace();
        return;
      }
      // Puppet Warp's mesh is modal the same way: Enter commits, Esc cancels.
      // A dialog (aria-modal) keeps Escape for itself.
      if (puppetOpenRef.current && (e.key === "Enter" || e.key === "Escape")) {
        if (t?.closest("[aria-modal]")) return;
        e.preventDefault();
        if (e.key === "Enter") commitPuppetWarp();
        else cancelPuppetWarp();
        return;
      }
      // A preview transaction owns the document until OK/Cancel. Let its own
      // Enter/Escape/Tab handling through, but never fold another app command
      // into the preview's undo/action step.
      if (historyTransactionActive(engine.engine)
          && e.key !== "Enter" && e.key !== "Escape" && e.key !== "Tab") {
        clearPendingDigit();
        e.preventDefault();
        return;
      }
      // Spacebar → temporary Hand (pan) while held (Photoshop). preventDefault so
      // it doesn't scroll the page or activate a focused control; the active tool
      // is left unchanged — CanvasView treats a drag as a pan while spacePan is on.
      // A modal dialog hides the canvas, so its focused control keeps Space.
      if (e.code === "Space" || e.key === " ") {
        if (t?.closest('[aria-modal="true"]')) return;
        e.preventDefault(); store.setSpacePan(true); return;
      }
      const meta = e.metaKey || e.ctrlKey;
      // Slice Select: ⌫ / Del removes the selected slice (no slice selected → no-op).
      if (!meta && (e.key === "Backspace" || e.key === "Delete") && store.state.tool === "sliceselect") {
        e.preventDefault(); store.deleteSelectedSlice(); return;
      }
      // Artboard tool: ⌫ / Del removes the selected artboard + its contents.
      if (!meta && (e.key === "Backspace" || e.key === "Delete") && store.state.tool === "artboard") {
        e.preventDefault(); store.deleteSelectedArtboard(); return;
      }
      const shortcut = shortcutFromEvent(e);
      const command = shortcut ? shortcutCommandsRef.current.get(shortcut) : undefined;
      if (command) { clearPendingDigit(); e.preventDefault(); command.run(); return; }
      // Tab hides panels + tool rail + options bar, ⇧Tab hides panels only, and
      // either restores everything (Photoshop). Checked *after* the user
      // shortcut map so a rebind onto Tab still wins. Tab is also the web's
      // focus-navigation key, so we only claim it when focus isn't parked on a
      // control — a keyboard user tabbing through the panels keeps normal
      // navigation, and hidden chrome is display:none so it leaves the a11y tree.
      if (e.key === "Tab" && !meta && !e.altKey
          && !(t && t.closest("button, select, a[href], [tabindex]:not([tabindex='-1'])"))) {
        clearPendingDigit();
        e.preventDefault();
        if (!e.repeat) setChromeHidden((prev) => (prev ? "" : e.shiftKey ? "panels" : "all"));
        return;
      }
      // Bare Escape leaves either nonstandard Screen Mode. Defer until every
      // canvas/overlay listener has seen this event so an in-progress operation
      // can consume Escape first via preventDefault().
      if (e.code === "Escape" && !e.altKey && !e.ctrlKey && !e.metaKey && !e.shiftKey
          && store.state.screenMode !== "standard") {
        window.setTimeout(() => {
          if (!e.defaultPrevented && store.state.screenMode !== "standard") store.setScreenMode("standard");
        }, 0);
        return;
      }
      // Select previous/next layer: ⌥] up · ⌥[ down · ⇧ jumps to top/bottom.
      // These Photoshop gestures are absent from both the application-menu and
      // tool-selection catalogs, so they remain contextual panel commands.
      if (e.altKey && !meta && e.code === "BracketRight") { e.preventDefault(); store.selectAdjacentLayer(-1, e.shiftKey); return; }
      if (e.altKey && !meta && e.code === "BracketLeft") { e.preventDefault(); store.selectAdjacentLayer(1, e.shiftKey); return; }
      if (meta) return;
      // Crop owns O contextually: cycle the six Photoshop overlays, or change
      // Triangle / Golden Spiral orientation with Shift+O. Outside Crop, O keeps
      // its normal Dodge / Burn / Sponge tool shortcut below.
      if (store.state.tool === "crop" && e.code === "KeyO" && !e.altKey && !e.ctrlKey && !e.metaKey) {
        clearPendingDigit();
        e.preventDefault();
        if (e.repeat) return;
        if (e.shiftKey) {
          const orientation = nextCropOverlayOrientation(store.state.cropOverlay, store.state.cropOverlayOrientation);
          if (orientation !== store.state.cropOverlayOrientation) store.setOptions({ cropOverlayOrientation: orientation });
        } else {
          store.setOptions({ cropOverlay: nextCropOverlay(store.state.cropOverlay) });
        }
        return;
      }
      const toolShortcut = toolShortcutFromEvent(e);
      const toolCommand = toolShortcut ? toolShortcutCommandsRef.current.get(toolShortcut) : undefined;
      if (toolCommand) {
        clearPendingDigit();
        e.preventDefault();
        if (!toolCommand.cycle) {
          if (!e.repeat || toolCommand.repeatable) (e.shiftKey ? toolCommand.shiftRun ?? toolCommand.run : toolCommand.run)();
          return;
        }
        // ponytail: one held tool chord at a time; add a stack if Adobe documents
        // overlapping spring-loaded chords as a supported workflow.
        if (e.repeat || springTool) return;
        const action = (e.shiftKey || !store.state.useShiftKeyForToolSwitch) && toolCommand.cycle
          ? toolCommand.cycle
          : toolCommand.run;
        if (!store.state.springLoadedToolShortcuts || e.shiftKey) {
          action();
          return;
        }
        const pending: SpringTool = {
          code: e.code,
          previous: store.state.tool,
          action,
          timer: 0,
          activated: false,
        };
        pending.timer = window.setTimeout(() => {
          if (springTool !== pending) return;
          pending.activated = true;
          action();
        }, store.state.springLoadedToolDelayMs);
        springTool = pending;
        return;
      }
      // Photoshop number keys: one digit uses 10% steps; a rapid second digit
      // enters an exact percentage. Paint tools target opacity, otherwise layer.
      if (plainDigit !== null) {
        e.preventDefault();
        if (isOpacityTool(store.state.tool)) {
          applyDigit("opacity", `tool:${store.state.tool}`, plainDigit, e.repeat, (op) => store.setBrush({ opacity: op / 100 }));
        } else if (store.state.activeLayerId) {
          const layerId = store.state.activeLayerId;
          applyDigit("opacity", `layer:${store.state.activeDocId}:${layerId}`, plainDigit, e.repeat,
            (op) => store.setLayerOpacity(layerId, op), true);
        } else clearPendingDigit();
        return;
      }
      // Shift+number targets paint-tool Flow, or Fill opacity on a regular
      // active layer. Groups expose only overall Opacity in Photoshop.
      if (shiftDigit !== null) {
        if (isOpacityTool(store.state.tool)) {
          e.preventDefault();
          applyDigit("flow", `tool:${store.state.tool}`, shiftDigit, e.repeat, (flow) => store.setBrush({ flow: flow / 100 }));
        } else {
          const layerId = store.state.activeLayerId;
          const layer = store.state.layers.find((candidate) => candidate.id === layerId);
          if (layerId && layer?.kind === LAYER_KIND.groupHeader) {
            e.preventDefault();
            applyDigit("groupOpacity", `group:${store.state.activeDocId}:${layerId}`, shiftDigit, e.repeat,
              (opacity) => store.setLayerOpacity(layerId, opacity), true);
          } else if (layerId && layer) {
            e.preventDefault();
            applyDigit("fill", `layer:${store.state.activeDocId}:${layerId}`, shiftDigit, e.repeat,
              (fill) => store.setFillOpacity(layerId, fill), true);
          } else clearPendingDigit();
        }
        return;
      }
    };
    // Release the temporary Hand when Space is let go (or the window loses focus
    // while it's held, so the pan mode never gets stuck).
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === "Space" || e.key === " ") store.setSpacePan(false);
      if (e.code === "Backquote") store.setTemporaryErase(false);
      if (!springTool || e.code !== springTool.code) return;
      const pending = springTool;
      springTool = null;
      window.clearTimeout(pending.timer);
      if (pending.activated) store.setTool(pending.previous);
      else pending.action();
    };
    const onBlur = () => { clearPendingDigit(); store.setSpacePan(false); store.setTemporaryErase(false); clearSpringTool(true); };
    window.addEventListener("keydown", onKey);
    window.addEventListener("keyup", onKeyUp);
    window.addEventListener("blur", onBlur);
    return () => {
      store.setTemporaryErase(false);
      clearPendingDigit();
      clearSpringTool(true);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
    };
  }, []);

  useEffect(() => {
    if (tool !== "liquify" && liquifyWorkspaceOpen) setLiquifyWorkspaceOpen(false);
  }, [tool, liquifyWorkspaceOpen]);

  const openLayerContentOptions = () => {
    const e = engine.e;
    const layerId = store.state.activeLayerId;
    const layerKind = e.layer_kind(layerId);
    const subtype = e.layer_adj_kind(layerId);
    const params = Array.from(e.layer_adj_params(layerId));
    const adjustmentDialogs = {
      0: "alBrightness", 1: "alLevels", 2: "alHueSat", 3: "alVibrance",
      6: "alBlackWhite", 7: "alPosterize", 8: "alThreshold", 9: "alExposure",
      10: "alColorBalance", 11: "alPhotoFilter", 12: "alCurves", 13: "alGradientMap",
      14: "alChannelMixer", 15: "alSelectiveColor", 16: "alColorLookup",
    } as const;
    const fillDialogs = { 0: "solidFill", 1: "gradientFill", 2: "patternFill" } as const;
    const name = layerKind === 1
      ? adjustmentDialogs[subtype as keyof typeof adjustmentDialogs]
      : layerKind === 4
        ? fillDialogs[subtype as keyof typeof fillDialogs]
        : undefined;
    if (name) {
      open(name, { layerId, layerKind, subtype, params });
    } else {
      toast.push({
        title: "Layer Content Options",
        message: layerKind === 1 ? "This adjustment has no editable settings." : "Select an adjustment or fill layer.",
        variant: "info",
      });
    }
  };

  /** Window ▸ Arrange: pick a layout and reveal the Second View panel. */
  const showSecondView = (mode: ArrangeMode) => {
    setArrangeMode(mode);
    dockRef.current?.openPanel("secondview");
  };

  // Photoshop-shaped menu bar. The structure (every Photoshop menu, in order,
  // with submenus + disabled placeholders for commands we don't implement) lives
  // in ui/psMenuData.ts; this map wires the commands Monet DOES implement to
  // their handlers by blueprint id. buildPhotoshopMenus assembles the rest.
  // `adjinv`/`alLevels` disambiguate Photoshop's cross-menu id reuse (Image▸Invert
  // vs Select▸Inverse; New Adjustment Layer▸Levels vs Select▸All).
  const menuActions: Record<string, () => void> = {
    // File
    new: doNew,
    openf: doOpen,
    browse: () => open("docBrowser"),
    opensmartobject: () => { void openAsSmartObject(); },
    place: () => placeInputRef.current?.click(),
    placelinked: () => { void placeLinkedImage(); },
    importnotes: () => { void importNotesFile(); },
    opengif: () => gifInputRef.current?.click(),
    save: doSave,
    saveas: doSaveAs,
    savecopy: doSaveCopy,
    packagefile: () => { void packageDocument().then((path) => {
      if (path) toast.push({ title: "Package", message: `Created ${path}`, variant: "success" });
    }); },
    revert: () => { void revertDocument(); },
    clearrecent: () => store.clearRecentFiles(),
    loadfilesstack: () => { void loadFilesIntoStack(); },
    loaddicom: () => { void loadMultipleDicomFiles(); },
    videoframes: () => { void importVideoFramesToLayers(); },
    statistics: () => open("statistics"),
    close: doClose,
    closeall: () => { void doCloseAll(); },
    closeothers: () => { void doCloseOthers(); },
    png: () => exportPNG(`${doc.name.replace(/\.[^.]+$/, "")}.png`),
    qexportpng: quickExportSelectedLayers,
    copycss: () => copyLayerCSS(),
    copysvg: () => copyLayerSVG(),
    rendervideo: () => open("renderVideo"),
    saveforweb: () => open("saveForWeb"),
    exportlayers: () => exportLayersToFiles(doc.name.replace(/\.[^.]+$/, "")),
    layercompstofiles: () => exportLayerCompsToFiles(),
    layercompstopdf: () => { void exportLayerCompsToPDF(); },
    fitimage: () => open("fitImage"),
    delemptylayers: () => store.deleteEmptyLayers(),
    layercleanup: () => open("layerCleanup"),
    autonamelayers: () => store.autoNameLayers(false),
    flattenmasks: () => store.flattenAllMasks(),
    flatteneffects: () => store.flattenAllLayerEffects(),
    exportas: () => open("exportPrefs", { exportAs: "document", baseName: doc.name }),
    layerexportas: () => open("exportPrefs", { exportAs: "layers" }),
    exportsizes: () => exportSizes([1, 2, 3], doc.name),
    contentcredentials: () => exportContentCredentials(doc.name),
    contentcredentialssigned: () => void exportSignedContentCredentials(doc.name),
    exportprefs: () => open("exportPrefs"),
    fileinfo: () => open("fileInfo"),
    search: () => open("commandSearch"),
    autoalignlayers: () => store.autoAlignLayers(),
    autoblendlayers: () => store.autoBlendLayers(),
    photomerge: () => store.photomerge(),
    checkspelling: () => open("spellCheck"),
    fontpreviewnone: () => store.setFontPreviewSize("none"),
    fontpreviewsmall: () => store.setFontPreviewSize("small"),
    fontpreviewmedium: () => store.setFontPreviewSize("medium"),
    fontpreviewlarge: () => store.setFontPreviewSize("large"),
    fontpreviewextralarge: () => store.setFontPreviewSize("extraLarge"),
    fontpreviewhuge: () => store.setFontPreviewSize("huge"),
    findreplace: () => open("findReplace"),
    print: () => open("print"),
    printone: () => { void printDocument(); },
    jpg: () => exportJPEG(`${doc.name.replace(/\.[^.]+$/, "")}.jpg`, 92),
    psd: () => exportPSD(`${doc.name.replace(/\.[^.]+$/, "")}.psd`),
    psb: () => exportPSB(`${doc.name.replace(/\.[^.]+$/, "")}.psb`),
    psdcmyk: () => exportPSDCMYK(`${doc.name.replace(/\.[^.]+$/, "")}-cmyk.psd`),
    psdoriginal: () => exportOriginalPhotoshop(),
    gif: () => exportGIF(`${doc.name.replace(/\.[^.]+$/, "")}.gif`, 10),
    tiff: () => exportTIFF(`${doc.name.replace(/\.[^.]+$/, "")}.tif`),
    webp: () => exportWebP(`${doc.name.replace(/\.[^.]+$/, "")}.webp`),
    webplossy: () => void exportWebPLossy(doc.name),
    exporthdr: () => exportHDR(`${doc.name.replace(/\.[^.]+$/, "")}.hdr`),
    exr: () => exportEXR(`${doc.name.replace(/\.[^.]+$/, "")}.exr`),
    exportheic: () => void exportHEIC(doc.name),
    exportdng: () => void exportDNG(doc.name),
    exportpdf: () => void exportPDF(doc.name),
    exportpdfx1a: () => void exportPDFX1a(doc.name),
    exportpdfx4: () => void exportPDFX4(doc.name),
    avif: () => void exportAVIF(doc.name),
    exporttga: () => void exportTGA(`${doc.name.replace(/\.[^.]+$/, "")}.tga`),
    exportppm: () => void exportPPM(`${doc.name.replace(/\.[^.]+$/, "")}.ppm`),
    exportsvgdoc: () => exportDocumentSVG(`${doc.name.replace(/\.[^.]+$/, "")}.svg`),
    exportpcx: () => void exportPCX(`${doc.name.replace(/\.[^.]+$/, "")}.pcx`),
    // Window ▸ Contextual Task Bar + Workspace management
    toggletaskbar: () => setTaskBarOpen((v) => !v),
    // Window ▸ Arrange. The tilings and the second view open the Second View
    // panel. On the desktop, Float in Window / Float All in Windows / Cascade
    // pull documents out of the tab bar into OS windows (native/FloatWindows);
    // a browser has no windows to give them, so there they open the same live
    // in-app views instead. Consolidate All to Tabs brings every document
    // back to the single tabbed canvas.
    newwindowfordoc: () => showSecondView("single"),
    tileallvert: () => showSecondView("vertical"),
    tileallhoriz: () => showSecondView("horizontal"),
    tile: () => showSecondView("grid"),
    floatinwindow: () => (isTauri() ? store.floatDoc(store.state.activeDocId) : showSecondView("single")),
    floatallwindows: () => (isTauri() ? store.floatAllDocs() : showSecondView("grid")),
    cascade: () => (isTauri() ? void cascadeFloats().catch((e) => console.warn("Cascade failed:", e)) : showSecondView("grid")),
    consolidatetabs: () => { store.consolidateFloats(); dockRef.current?.closePanel("secondview"); },
    matchzoom: () => store.matchView({ zoom: true }),
    matchlocation: () => store.matchView({ location: true }),
    matchrotation: () => store.matchView({ rotation: true }),
    matchall: () => store.matchView({ zoom: true, location: true, rotation: true }),
    resetws: () => resetWorkspace(),
    savews: () => {
      const name = (typeof prompt === "function" ? prompt("Save workspace as:") : null)?.trim();
      if (!name || !dockRef.current) return;
      // Photoshop's Save Workspace captures panel layout + toolbar placement,
      // and optionally the shortcut set — we carry the user's custom chords
      // whenever there are any, so a workspace round-trips them.
      const shortcuts = store.state.keyboardShortcuts;
      const saved: SavedWorkspace = {
        name,
        layout: dockRef.current.getLayout(),
        toolbarLayout: dockRef.current.getToolbarLayout(),
        toolConfiguration: validateToolbarConfiguration(store.state.toolbarConfiguration),
        ...(Object.keys(shortcuts).length ? { shortcuts: { ...shortcuts } } : {}),
      };
      const next = [...workspaces.filter((w) => w.name !== name), saved];
      if (saveWorkspacesLS(next)) { setWorkspaces(next); saveActiveWorkspaceLS(name); }
    },
    delws: () => {
      if (!workspaces.length) return;
      const name = (typeof prompt === "function" ? prompt(`Delete workspace (${workspaces.map((w) => w.name).join(", ")}):`) : null)?.trim();
      if (!name) return;
      const next = workspaces.filter((w) => w.name !== name);
      setWorkspaces(next);
      saveWorkspacesLS(next);
    },
    vid: () => void exportVideo(`${doc.name.replace(/\.[^.]+$/, "")}.webm`, 12),
    script: () => open("script"),
    // Edit
    undo: () => store.undo(),
    // Photoshop's Toggle Last State alternates between the two most recent
    // history states — press it twice and you are back where you started. It
    // only alternates while our own move is still the latest one: any other
    // edit/undo/redo/seek moves historyIndex and drops us back to Undo, and a
    // move that did nothing (nothing left to undo) resets too. (#244)
    togglelaststate: () => {
      const last = lastToggleRef.current;
      const at = store.state.historyIndex;
      const undone = !(last && last.at === at && last.undone);
      if (undone) store.undo(); else store.redo();
      const now = store.state.historyIndex;
      lastToggleRef.current = now === at ? null : { at: now, undone };
    },
    about: () => open("about"),
    systeminfo: () => open("about", "systemInfo"),
    keyboardshortcuts: () => open("keyboardShortcuts"),
    customizetoolbar: () => open("customizeToolbar"),
    prefgeneral: () => open("preferences", "General"),
    prefinterface: () => open("preferences", "Interface"),
    prefworkspace: () => open("preferences", "Workspace"),
    preftools: () => open("preferences", "Tools"),
    prefhistory: () => open("preferences", "History Log"),
    preffile: () => open("preferences", "File Handling"),
    prefexport: () => open("preferences", "Export"),
    prefperf: () => open("preferences", "Performance"),
    prefscratch: () => open("preferences", "Scratch Disks"),
    prefcursors: () => open("preferences", "Cursors"),
    preftransp: () => open("preferences", "Transparency & Gamut"),
    prefunits: () => open("preferences", "Units & Rulers"),
    prefguides: () => open("preferences", "Guides, Grid & Slices"),
    prefplugins: () => open("preferences", "Plug-Ins"),
    preftype: () => open("preferences", "Type"),
    preftech: () => open("preferences", "Technology Previews"),
    prefproduct: () => open("preferences", "Product Improvement"),
    prefcameraraw: () => open("preferences", "Camera Raw"),
    contentawarescale: () => open("contentAwareScale"),
    purge: () => store.purge(),
    selectandmask: () => open("selectandmask"),
    quickmask: () => store.toggleQuickMask(),
    redo: () => store.redo(),
    fade: () => open("fade"),
    clear: () => { engine.e.clear_selection(); engine.commit(); },
    fill: () => open("fill"),
    fillfg: () => fillWith("fg"),
    fillbg: () => fillWith("bg"),
    stroke: () => open("stroke"),
    definebrush: () => store.defineBrushPreset(),
    defpat: () => store.definePattern(),
    definecustomshape: () => store.defineCustomShape(),
    skyreplacement: () => open("skyReplacement"),
    caf: () => open("contentAwareFill"),
    removedistractions: () => open("removeDistractions"),
    removereflections: () => open("removeReflections"),
    genfill: () => generativeFill(),
    genfillml: () => runMl("Generative Fill", ml.generativeFill),
    genimage: () => open("neuralAI", "generate"),
    gensimilar: () => runMl("Generate Similar", ml.generateSimilar),
    genexpand: () => open("neuralAI", "expand"),
    genbg: () => open("neuralAI", "generate"),
    patch: () => patchSelection(),
    freexf: () => open(store.pathIsTransformTarget() ? "transformPath" : "freeTransform"),
    xfscale: () => store.pathIsTransformTarget() ? open("transformPath", "scale") : open("freeTransform", "scale"),
    xfrotate: () => store.pathIsTransformTarget() ? open("transformPath", "rotate") : open("freeTransform", "rotate"),
    // Distort = arbitrary corner move → Perspective Warp (Free Transform can't
    // distort; it only scales/rotates/moves). This routes to the real capability.
    xfdistort: () => open("perspective"),
    persp: () => open("perspective"),
    skew: () => store.pathIsTransformTarget() ? open("transformPath", "skew") : open("skew"),
    transformagain: () => { if (!store.repeatWorkPathTransform()) repeatLastTransform(); },
    flh: () => { if (!transformPath({ sx: -1 })) xform.flipLayerH(); },
    flv: () => { if (!transformPath({ sy: -1 })) xform.flipLayerV(); },
    rl180: () => { if (!transformPath({ deg: 180 })) xform.rotateLayer180(); },
    rl90cw: () => { if (!transformPath({ deg: 90 })) xform.rotateLayer90(true); },
    rl90ccw: () => { if (!transformPath({ deg: -90 })) xform.rotateLayer90(false); },
    puppet: () => puppetWarp(),
    xfwarp: () => open("warp"),
    colordecontaminate: () => open("defringe"),
    // Image
    mrgb: setRgbMode,
    mgray: () => store.convertGrayscale(),
    bitmapmode: () => open("bitmapMode"),
    duotone: () => open("duotone"),
    indexedcolor: () => open("indexedColor"),
    mcmyk: () => store.setColorMode(2),
    mlab: () => store.setColorMode(3),
    mmultichannel: () => store.setColorMode(4),
    d8: () => store.setDepth(8),
    d16: () => store.setDepth(16),
    d32: () => store.setDepth(32),
    dupimg: () => open("duplicateImage"),
    autotone: () => adj.autoTone(),
    autocontrast: () => adj.autoContrast(),
    autocolor: () => adj.autoColor(),
    size: () => open("imageSize"),
    canvas: () => open("canvasSize"),
    cropsel: () => xform.cropToSelection(),
    revealall: () => xform.revealAll(),
    trim: () => open("trim"),
    applyimg: () => open("applyImage"),
    calc: () => open("calculations"),
    rcw: () => xform.rotate90(true),
    rccw: () => xform.rotate90(false),
    rot180: () => xform.rotate180(),
    rotarb: () => open("rotateCanvas"),
    fh: () => xform.flipH(),
    fv: () => xform.flipV(),
    transformsymmetry: () => store.beginPaintSymmetryTransform(),
    hdr: () => exposureFusion(),
    // File ▸ Automate ▸ Merge to HDR Pro — the scene-referred merge: recovers the
    // camera response from the bracket and leaves a real 32-bit radiance
    // document, where Merge to HDR (Exposure Fusion) above stays in 0..1.
    // ponytail: no Merge to HDR Pro dialog yet, so the engine fits the exposures
    // off the frames instead of taking typed EVs, and the result stays 32-bit —
    // View ▸ 32-bit Preview Options, Image ▸ Adjustments ▸ HDR Toning and Image ▸
    // Mode do the tone mapping Photoshop offers inside that dialog. Upgrade
    // path: a Dialogs.tsx panel that passes the per-frame EVs through.
    hdrpro: () => { engine.e.merge_to_hdr(new Float32Array(), true); engine.commit(); },
    // Image ▸ Adjustments (destructive)
    bc: () => open("brightnessContrast"),
    lv: () => open("levels"),
    cv: () => open("curves"),
    hs: () => open("hueSaturation"),
    rc: () => open("replaceColor"),
    vb: () => open("vibrance"),
    cb: () => open("colorBalance"),
    ex: () => open("exposure"),
    pf: () => open("photoFilter"),
    cm: () => open("channelMixer"),
    sc: () => open("selectiveColor"),
    gm: () => open("gradientMap"),
    shl: () => open("shadowsHighlights"),
    hdrtoning: () => open("hdrToning"),
    cameraraw: () => store.requestCameraRawEdit(),
    colorsettings: () => open("colorSettings"),
    assignprofile: () => open("assignProfile"),
    converttoprofile: () => open("convertToProfile"),
    filtergallery: () => open("filterGallery"),
    matchcolor: () => open("matchColor"),
    colorlookup: () => open("colorLookup"),
    adjinv: () => adj.invert(),
    des: () => adj.desaturate(),
    bw: () => open("blackWhite"),
    eq: () => adj.equalize(),
    po: () => open("posterize"),
    th: () => open("threshold"),
    // Layer
    nl: () => open("newLayer"),
    dup: () => open("duplicateLayer"),
    vcopy: () => store.layerViaCopy(),
    vcut: () => store.layerViaCut(),
    cut: () => store.cut(),
    copy: () => store.copy(),
    copymerged: () => store.copyMerged(),
    paste: () => store.paste(),
    pasteinplace: () => store.pasteInPlace(),
    pasteinto: () => store.pasteInto(false),
    pasteoutside: () => store.pasteInto(true),
    del: () => { for (const id of targetLayerIds()) store.deleteLayer(id); }, // (#243)
    // With the Path Selection tool active, Arrange retargets to the selected path
    // components inside the shape layer (Photoshop, #456); otherwise the layer.
    arrFront: () => { if (!store.arrangePathComponents(true)) store.arrangeLayer(0); },
    arrFwd: () => store.arrangeLayer(1),
    arrBwd: () => store.arrangeLayer(2),
    arrBack: () => { if (!store.arrangePathComponents(false)) store.arrangeLayer(3); },
    blendopts: () => open("layerStyle"),
    hidealleffects: () => store.toggleEffectsVisible(),
    globallight: () => open("globalLight"),
    scaleeffects: () => open("scaleEffects"),
    fxbevel: () => open("layerStyle", FX.BEVEL),
    fxstroke: () => open("layerStyle", FX.STROKE),
    fxinnershadow: () => open("layerStyle", FX.INNER_SHADOW),
    fxinnerglow: () => open("layerStyle", FX.INNER_GLOW),
    fxsatin: () => open("layerStyle", FX.SATIN),
    fxcoloroverlay: () => open("layerStyle", FX.COLOR_OVERLAY),
    fxgradientoverlay: () => open("layerStyle", FX.GRADIENT_OVERLAY),
    fxpatternoverlay: () => open("layerStyle", FX.PATTERN_OVERLAY),
    fxouterglow: () => open("layerStyle", FX.OUTER_GLOW),
    fxdropshadow: () => open("layerStyle", FX.DROP_SHADOW),
    alb: () => open("alBrightness"),
    alLevels: () => open("alLevels"),
    alc: () => open("alCurves"),
    alh: () => open("alHueSat"),
    alv: () => open("alVibrance"),
    alcb: () => open("alColorBalance"),
    ale: () => open("alExposure"),
    albw: () => open("alBlackWhite"),
    alp: () => open("alPosterize"),
    alt: () => open("alThreshold"),
    alpf: () => open("alPhotoFilter"),
    algm: () => open("alGradientMap"),
    alcm: () => open("alChannelMixer"),
    alsc: () => open("alSelectiveColor"),
    alcolorlookup: () => open("alColorLookup"),
    ali: () => store.addAdjustmentLayer(4, new Float32Array(0), "Invert"),
    ald: () => store.addAdjustmentLayer(5, new Float32Array(0), "Desaturate"),
    grp: () => store.groupSelectedLayers(),
    aligntop: () => store.alignLayer(3),
    alignvc: () => store.alignLayer(4),
    alignbottom: () => store.alignLayer(5),
    alignleft: () => store.alignLayer(0),
    alignhc: () => store.alignLayer(1),
    alignright: () => store.alignLayer(2),
    // Photoshop's entry flips to "Show Layers" once the target is hidden, so this
    // toggles: any target still visible → hide them all, else show them all. (#243)
    hidelayers: () => {
      const ids = targetLayerIds();
      const v = !store.state.layers.some((l) => ids.includes(l.id) && l.visible);
      for (const id of ids) store.setLayerVisible(id, v);
    },
    reverselayers: () => store.reverseLayers(),
    isolatelayers: () => store.toggleIsolate(),
    alllayers: () => store.selectAllLayers(),
    deselectlayers: () => store.deselectLayers(),
    focusarea: () => open("focusArea"),
    findlayers: () => store.toggleLayerFilter(),
    disttop: () => store.distributeLayers(1, 0),
    distvc: () => store.distributeLayers(1, 1),
    distbottom: () => store.distributeLayers(1, 2),
    distleft: () => store.distributeLayers(0, 0),
    disthc: () => store.distributeLayers(0, 1),
    distright: () => store.distributeLayers(0, 2),
    disth: () => store.distributeLayers(0, 1),
    distv: () => store.distributeLayers(1, 1),
    clipmask: () => store.toggleClipping(), // ⌥⌘G creates OR releases, like Photoshop
    layerfrombg: () => store.setLayerLocked(store.state.activeLayerId, false),
    locklayers: () => open("lockLayers"), // (#418) the real dialog the ellipsis promises
    newgroup: () => open("newGroup"),
    groupfromlayers: () => store.groupSelectedLayers(),
    fillsolid: () => open("solidFill"),
    fillgradient: () => open("gradientFill"),
    // A restored pattern library is reachable even when the engine's single tile
    // slot is empty — the dialog's picker pushes the chosen tile into it.
    fillpattern: () => store.state.patternPresets.length > 0 || engine.e.has_pattern()
      ? open("patternFill")
      : toast.push({ title: "Pattern Fill", message: "Use Edit ▸ Define Pattern first.", variant: "info" }),
    layercontentoptions: openLayerContentOptions,
    renamelayer: () => open("renameLayer"),
    ungrp: () => store.ungroup(store.state.activeLayerId),
    smartobj: () => smart.convert(store.state.activeLayerId),
    convertsmart: () => smart.convert(store.state.activeLayerId),
    freqsep: () => frequencySeparation(8),
    // New Smart Object via Copy: duplicate, then break the copy out of the
    // instance group so its contents stop tracking the original's.
    smartviacopy: () => { store.duplicateLayer(store.state.activeLayerId); smart.detach(store.state.activeLayerId); },
    smartclr: () => smart.clearFilters(store.state.activeLayerId),
    enablesmart: () => smart.setFiltersEnabled(store.state.activeLayerId, true),
    disablesmart: () => smart.setFiltersEnabled(store.state.activeLayerId, false),
    deletefiltermask: () => smart.deleteFilterMask(store.state.activeLayerId),
    // Photoshop toggles the label Disable/Enable Filter Mask; the blueprint has
    // one row, so this is the toggle.
    disablefiltermask: () => {
      const id = store.state.activeLayerId;
      smart.setFilterMaskEnabled(id, !smart.filterMaskEnabled(id));
    },
    rasterizesmart: () => smart.rasterize(store.state.activeLayerId),
    smartreset: () => smart.resetTransform(store.state.activeLayerId),
    soedit: () => smart.editContents(),
    soupdate: () => smart.updateEditedContents(),
    soupdatelink: () => smart.updateLinkedContents(),
    sorelink: () => smart.relinkContents(),
    soreplace: () => smart.replaceContents(),
    soexport: () => smart.exportContents(),
    soembed: () => smart.embedLinked(store.state.activeLayerId),
    soembedall: () => smart.embedAllLinked(),
    soconvertlinked: () => smart.convertToLinked(),
    smartstack: () => open("smartStackMode"),
    linklayers: () => store.linkLayers(),
    selectlinkedlayers: () => store.selectLinkedLayers(),
    rasterizelayerstyle: () => store.rasterizeLayerStyle(),
    createlayersfromstyle: () => store.createLayersFromStyle(),
    pathstoai: () => exportPathsSVG(`${doc.name.replace(/\.[^.]+$/, "")}-paths.svg`),
    artboardstofiles: () => exportArtboardsToFiles(),
    artboardstopdf: () => { void exportArtboardsToPDF(); },
    exportcolorlut: () => exportColorLUT(`${doc.name.replace(/\.[^.]+$/, "")}.cube`),
    importlut: () => void importColorLutFile(),
    zoomify: () => exportZoomify(doc.name.replace(/\.[^.]+$/, "")),
    imageassets: () => toggleImageAssetsGenerator(),
    contactsheet: () => { void contactSheet(); },
    picturepackage: () => { void picturePackage(); },
    conditionalmode: () => open("conditionalMode"),
    cropstraighten: () => cropAndStraightenPhotos(),
    variablesdefine: () => open("variablesDefine"),
    datasets: () => open("dataSets"),
    applydataset: () => dataVars.apply(store.state.activeDataSet),
    exportdatasets: () => dataVars.exportAll(),
    importdatasets: () => { void dataVars.importFile(); },
    batch: () => open("batch"),
    createdroplet: () => open("createDroplet"),
    scripteventsmanager: () => open("scriptEvents"),
    pdfpresentation: () => { void pdfPresentation(); },
    scriptbrowse: () => { void browseAndRunScript(); },
    imageprocessor: () => open("imageProcessor"),
    vectormaskpath: () => setVectorMaskOpPicker(true),
    vectormaskdelete: () => store.deleteVectorMask(),
    rasterizevectormask: () => store.rasterizeVectorMask(),
    vectormaskrevealall: () => store.addVectorMaskRevealAll(),
    vectormaskhideall: () => store.addVectorMaskHideAll(),
    vectormaskenable: () => store.toggleVectorMaskEnabled(),
    vectormasklink: () => store.toggleVectorMaskLinked(),
    presetmanager: () => open("presetManager"),
    fxcopy: () => store.copyLayerStyle(),
    fxpaste: () => store.pasteLayerStyle(),
    fxclear: () => store.clearLayerStyle(),
    addmask: () => store.addLayerMask(store.state.activeLayerId),
    hidemask: () => store.addLayerMaskHidden(store.state.activeLayerId),
    revealsel: () => store.addLayerMaskRevealSelection(store.state.activeLayerId),
    hidesel: () => store.addLayerMaskHideSelection(store.state.activeLayerId),
    unlinkmask: () => store.toggleLayerMaskLinked(store.state.activeLayerId),
    enablemask: () => store.setLayerMaskEnabled(store.state.activeLayerId, true),
    disablemask: () => store.setLayerMaskEnabled(store.state.activeLayerId, false),
    maskfromtransp: () => store.maskFromTransparency(store.state.activeLayerId),
    applymask: () => store.applyLayerMask(store.state.activeLayerId),
    delmask: () => store.deleteLayerMask(store.state.activeLayerId),
    defringe: () => open("defringe"),
    rmwhite: () => store.removeMatte(true),
    rmblack: () => store.removeMatte(false),
    merge: () => store.mergeDown(store.state.activeLayerId),
    mergevis: () => store.mergeVisible(),
    flat: () => store.flatten(),
    // Type
    tnew: () => text.createAt(Math.round(doc.width / 2 - 120), Math.round(doc.height / 2 - 40)),
    tedit: () => { text.pending = { mode: "edit", id: store.state.activeLayerId, ax: 0, ay: 0 }; open("type"); },
    twarp: () => { text.pending = { mode: "edit", id: store.state.activeLayerId, ax: 0, ay: 0 }; open("type"); },
    trast: () => text.rasterizeLayer(store.state.activeLayerId),
    rasterizetype: () => text.rasterizeLayer(store.state.activeLayerId),
    rasterizefillcontent: () => store.rasterizeFillLayer(store.state.activeLayerId),
    rasterizelayer: () => { const id = store.state.activeLayerId; text.rasterizeLayer(id); smart.rasterize(id); store.rasterizeFillLayer(id); },
    rasterizealllayers: () => { for (const l of store.state.layers) { text.rasterizeLayer(l.id); smart.rasterize(l.id); store.rasterizeFillLayer(l.id); } },
    aanone: () => text.setAntialias("none"),
    aasharp: () => text.setAntialias("sharp"),
    aacrisp: () => text.setAntialias("crisp"),
    aastrong: () => text.setAntialias("strong"),
    aasmooth: () => text.setAntialias("smooth"),
    aawindowslcd: () => text.setAntialias("windowslcd"),
    aawindows: () => text.setAntialias("windows"),
    orienth: () => text.setOrientation(false),
    orientv: () => text.setOrientation(true),
    pastelorem: () => text.pasteLorem(),
    updatealltext: () => text.updateAll(),
    converttoparagraph: () => text.toggleParagraph(),
    createworkpath: () => store.createWorkPath(),
    converttoshape: () => store.convertToShape(),
    rasterizeshape: () => store.rasterizeShape(),
    textonpath: () => text.textOnPath(),
    bindtoworkpath: () => text.bindToPath(),
    typeonpathoptions: () => open("onPathOptions"),
    matchfont: () => open("matchFont"),
    newartboard: () => open("newArtboard"),
    newframe: () => store.newFrame(),
    artboardfromgroup: () => store.artboardFromGroup(),
    artboardfromlayers: () => store.artboardFromLayers(),
    uniteshapes: () => store.combineShapes(0),
    subtractfrontshape: () => store.combineShapes(1),
    uniteshapesoverlap: () => store.combineShapes(2),
    subtractshapesoverlap: () => store.combineShapes(3),
    mergeshapecomponents: () => store.mergeShapeComponents(),
    replacemissingfonts: () => text.replaceMissingFonts(),
    resolvemissingfonts: () => text.replaceMissingFonts(),
    digitslatin: () => text.setDigits("latin"),
    digitsarabic: () => text.setDigits("arabic"),
    digitshindi: () => text.setDigits("hindi"),
    kashidanone: () => text.setKashida("none"),
    kashidashort: () => text.setKashida("short"),
    kashidamedium: () => text.setKashida("medium"),
    kashidalong: () => text.setKashida("long"),
    kashidastylistic: () => text.setKashida("stylistic"),
    textdirltr: () => text.setDirection("ltr"),
    textdirrtl: () => text.setDirection("rtl"),
    composerlatin: () => text.setComposer("latin"),
    composerworldready: () => text.setComposer("worldReady"),
    langeastasian: () => text.toggleEastAsian(),
    savedefaulttypestyles: () => text.saveDefaultStyles(),
    loaddefaulttypestyles: () => text.loadDefaultStyles(),
    glyphs: () => open("glyphs"),
    otliga: () => text.toggleFeature("liga"),
    otdlig: () => text.toggleFeature("dlig"),
    otfrac: () => text.toggleFeature("frac"),
    otordn: () => text.toggleFeature("ordn"),
    // Type ▸ OpenType advanced features (ss01–ss20, swsh, salt, calt, onum,
    // titl, jalt) — each menu id is the CSS feature tag (psMenus PATH_WIRING).
    ...Object.fromEntries(OPENTYPE_FEATURE_TAGS.map((tag) => [tag, () => text.toggleFeature(tag)])),
    charstyles: () => open("typeStyles", "char"),
    parastyles: () => open("typeStyles", "para"),
    // Type ▸ Panels ▸ Character/Paragraph dock the real panels beside the
    // canvas (Photoshop), rather than reopening the modal Type dialog. They
    // open with no type layer selected too — the panel shows the hint.
    characterpanel: () => dockRef.current?.openPanel("character"),
    paragraphpanel: () => dockRef.current?.openPanel("paragraph"),
    // Select
    all: () => store.selectAll(),
    none: () => store.deselect(),
    resel: () => store.reselect(),
    inv: () => store.invertSelection(),
    crange: () => open("colorRange"),
    savesel: () => open("saveSelection"),
    loadsel: () => open("loadSelection"),
    xfsel: () => open("transformSelection"),
    expand: () => open("expandContract"),
    contract: () => open("expandContract"),
    feather: () => open("feather"),
    border: () => open("border"),
    smooth: () => open("smooth"),
    grow: () => store.growSelection(),
    similar: () => store.similarSelection(),
    subj: () => runMl("Select Subject", ml.selectSubject),
    sky: () => store.selectSky(),
    rembg: () => runMl("Remove Background", ml.removeBackground),
    // Filter
    gb: () => open("gaussianBlur"),
    blur: () => fil.gaussian(1),
    blurmore: () => fil.gaussian(3),
    bb: () => open("boxBlur"),
    mb: () => open("motionBlur"),
    pathblur: () => open("pathBlur"),
    browsefilters: () => window.open("https://exchange.adobe.com/apps/browse/cc?product=PHSP", "_blank", "noopener"),
    sfb: () => open("surfaceBlur"),
    smb: () => open("smartBlur"),
    lensblur: () => open("lensBlur"),
    shapeblur: () => open("shapeBlur"),
    extrudefilter: () => open("extrudeFilter"),
    fieldblur: () => open("fieldBlur"),
    irisblur: () => open("irisBlur"),
    tiltshift: () => open("tiltShift"),
    spinblur: () => open("spinBlur"),
    lastfilter: () => repeatLastFilter(),
    lenscorrection: () => open("lensCorrection"),
    adaptivewide: () => setAdaptiveWideOpen(true),
    vanishingpoint: () => store.openVanishingPoint(),
    liquify: () => openLiquifyWorkspace(),
    displace: () => open("displace"),
    tree: () => open("tree"),
    flame: () => open("flame"),
    pictureframe: () => open("pictureFrame"),
    rdb: () => open("radialBlur"),
    avg: () => fil.average(),
    sh: () => fil.sharpen(1),
    she: () => fil.sharpenEdges(),
    sharpenmore: () => fil.sharpen(3),
    us: () => open("unsharp"),
    smartsharpen: () => open("smartSharpen"),
    shakereduction: () => open("shakeReduction"),
    no: () => open("addNoise"),
    reducenoise: () => open("reduceNoise"),
    md: () => open("median"),
    dspk: () => fil.despeckle(),
    facet: () => fil.facet(),
    dust: () => open("dustScratches"),
    fe: () => fil.findEdges(),
    tracecontour: () => open("traceContour"),
    wind: () => open("wind"),
    tiles: () => open("tiles"),
    glowedges: () => open("glowingEdges"),
    solarize: () => fil.solarize(),
    posteredges: () => open("posterEdges"),
    cutout: () => open("cutout"),
    coloredpencil: () => open("coloredPencil"),
    smudgestick: () => open("smudgeStick"),
    sponge: () => open("sponge"),
    paletteknife: () => open("paletteKnife"),
    paintdaubs: () => open("paintDaubs"),
    fresco: () => open("fresco"),
    roughpastels: () => open("roughPastels"),
    underpainting: () => open("underpainting"),
    drybrush: () => open("dryBrush"),
    watercolor: () => open("watercolor"),
    filmgrain: () => open("filmGrain"),
    crosshatch: () => open("crosshatch"),
    spatter: () => open("spatter"),
    angledstrokes: () => open("angledStrokes"),
    darkstrokes: () => open("darkStrokes"),
    sprayedstrokes: () => open("sprayedStrokes"),
    sumie: () => open("sumiE"),
    mosaictiles: () => open("mosaicTiles"),
    patchwork: () => open("patchwork"),
    craquelure: () => open("craquelure"),
    grain: () => open("grain"),
    neonglow: () => open("neonGlow"),
    plasticwrap: () => open("plasticWrap"),
    accentededges: () => open("accentedEdges"),
    inkoutlines: () => open("inkOutlines"),
    texturizer: () => open("texturizer"),
    graphicpen: () => open("graphicPen"),
    charcoal: () => open("charcoal"),
    halftonepattern: () => open("halftonePattern"),
    basrelief: () => open("basRelief"),
    chrome: () => open("chrome"),
    photocopy: () => open("photocopy"),
    stampfilter: () => open("stamp"),
    notepaper: () => open("notePaper"),
    tornedges: () => open("tornEdges"),
    waterpaper: () => open("waterPaper"),
    chalkcharcoal: () => open("chalkCharcoal"),
    contecrayon: () => open("conteCrayon"),
    reticulation: () => open("reticulation"),
    plaster: () => open("plaster"),
    diffuse: () => open("diffuse"),
    em: () => open("emboss"),
    hp: () => open("highPass"),
    mo: () => open("mosaic"),
    frag: () => fil.fragment(),
    chalf: () => open("colorHalftone"),
    cryst: () => open("crystallize"),
    mezzotint: () => open("mezzotint"),
    pointl: () => open("pointillize"),
    stained: () => open("stainedGlass"),
    vg: () => open("vignette"),
    nai: () => open("neuralAI"),
    njpeg: () => open("deblock"),
    nsr: () => runMl("Super-Resolution", ml.superResolution),
    ndenoise: () => open("aiDenoise"),
    noil: () => open("oil"),
    // Parametered neural filters deep-link into the Neural Filters dialog
    // (VIS-FX-05) — they used to fire one-shot at hardcoded strengths.
    ncol: () => open("neuralAI", "colorize"),
    ndepthblur: () => open("neuralAI", "depthblur"),
    nharmonize: () => open("neuralAI", "harmonize"),
    nrestore: () => open("neuralAI", "restore"),
    nfaceliquify: () => open("neuralAI", "faceliquify"),
    nskinsmooth: () => open("neuralAI", "skinsmooth"),
    matchfontai: () => runMl("Match Font (Image)", async (p) => {
      const r = await ml.matchFontImage(p);
      toast.push({ title: "Match Font", message: `Closest: ${r.ranking.slice(0, 3).join(", ")}`, variant: "success" });
      return r;
    }),
    dpinch: () => open("pinch"),
    dsph: () => open("spherize"),
    dtwl: () => open("twirl"),
    dpolar: () => open("polar"),
    drip: () => open("ripple"),
    oceanripple: () => open("oceanRipple"),
    glassfilter: () => open("glass"),
    dzz: () => open("zigzag"),
    dshr: () => open("shear"),
    dwave: () => open("wave"),
    dglow: () => open("diffuseGlow"),
    clouds: () => fil.clouds(),
    diffclouds: () => fil.differenceClouds(),
    lensflare: () => open("lensFlare"),
    fibers: () => open("fibers"),
    lightingfx: () => open("lightingEffects"),
    perspcrop: () => open("perspectiveCrop"),
    offset: () => open("offset"),
    maximum: () => open("maximum"),
    minimum: () => open("minimum"),
    custom: () => open("custom"),
    hsbhsl: () => open("hsbHsl"),
    ntsccolors: () => fil.ntscColors(),
    deinterlace: () => open("deinterlace"),
    // View
    zi: () => store.zoomBy(1.25),
    zo: () => store.zoomBy(0.8),
    fit: () => store.requestFit(),
    fitlayer: () => store.fitLayer(),
    extras: () => store.toggleView("showExtras"),
    newguidelayout: () => open("newGuideLayout"),
    proofcolors: () => store.toggleProofColors(),
    proofcmyk: () => store.setProof("cmyk"),
    proofcyan: () => store.setProof("cyan"),
    proofmagenta: () => store.setProof("magenta"),
    proofyellow: () => store.setProof("yellow"),
    proofblack: () => store.setProof("black"),
    proofcmy: () => store.setProof("cmy"),
    proofacescg: () => store.setProof("acescg"),
    proofaces2065: () => store.setProof("aces2065"),
    proofhdrpq: () => store.setProof("hdr-pq"),
    proofhdrhlg: () => store.setProof("hdr-hlg"),
    proofgamma18: () => store.setProof("gamma18"),
    proofsrgb: () => store.setProof("srgb"),
    proofmonitor: () => store.setProof("monitor"),
    proofprotanopia: () => store.setProof("protanopia"),
    proofdeuteranopia: () => store.setProof("deuteranopia"),
    gamutwarning: () => store.toggleGamutWarning(),
    parsquare: () => store.setPixelAspect(1),
    parntsc: () => store.setPixelAspect(0.91),
    parpal: () => store.setPixelAspect(1.09),
    parntscwide: () => store.setPixelAspect(1.21),
    parhdv: () => store.setPixelAspect(1.33),
    parpalwide: () => store.setPixelAspect(1.46),
    paranamorphic: () => store.setPixelAspect(2.0),
    pardvcpro: () => store.setPixelAspect(1.5),
    parcorrection: () => store.togglePixelAspectCorrection(),
    hdrpreview: () => open("hdrPreview"),
    custompixelaspect: () => open("customPixelAspect"),
    deletepixelaspect: () => open("deletePixelAspect"),
    resetpixelaspects: () => open("resetPixelAspects"),
    proofsetupcustom: () => open("proofSetupCustom"),
    showextrasoptions: () => open("showExtrasOptions"),
    rulertool: () => store.setTool("ruler"),
    counttool: () => store.setTool("count"),
    colorsamplertool: () => store.setTool("colorsampler"),
    notetool: () => store.setTool("note"),
    showcount: () => store.toggleShowCount(),
    showsamplers: () => store.toggleShowSamplers(),
    shownotes: () => store.toggleShowNotes(),
    setmeasurescale: () => { store.setTool("ruler"); open("measurementScale"); },
    selectdatapoints: () => open("selectDataPoints"),
    colortable: () => open("colorTable"),
    trap: () => open("trap"),
    // Photoshop records into the docked Measurement Log panel — a modal over the
    // canvas is the wrong place to watch a measuring pass accumulate.
    recordmeasurements: () => { store.recordMeasurement(); dockRef.current?.openPanel("measurementlog"); },
    placescalemarker: () => open("placeScaleMarker"),
    newlayerbasedslice: () => store.newLayerBasedSlice(),
    showslices: () => store.toggleShowSlices(),
    lockslices: () => store.toggleLockSlices(),
    clearslices: () => store.clearSlices(),
    showgrid: () => store.toggleView("showGrid"),
    zoom200: () => store.setZoom(2),
    // Print Size = physical inches on screen: zoom 1 is 1 doc px per CSS px and
    // CSS defines 96 px/in, so doc ppi → 96/ppi. resolutionPpi is normalized ≥ 1.
    // ponytail: assumes standard 96 CSS px/in displays; a screen-DPI preference
    // like Photoshop's would go in store settings if accuracy complaints arrive.
    printsize: () => store.setZoom(96 / store.state.resolutionPpi),
    pixelgrid: () => store.toggleView("showPixelGrid"),
    patternpreview: () => store.togglePatternPreview(),
    layeredges: () => store.toggleView("showLayerEdges"),
    selectionedges: () => store.toggleView("showSelectionEdges"),
    smartguides: () => store.toggleView("showSmartGuides"),
    targetpath: () => store.toggleView("showTargetPath"),
    brushpreview: () => store.toggleView("showBrushPreview"),
    guidesfromshape: () => store.guidesFromShape(),
    showguides: () => store.toggleView("showGuides"),
    rulers: () => store.toggleView("showRulers"),
    snap: () => store.toggleView("snapEnabled"),
    snapguides: () => store.toggleView("snapGuides"),
    snapgrid: () => store.toggleView("snapGrid"),
    snapdocbounds: () => store.toggleView("snapDocBounds"),
    snapall: () => store.setOptions({ snapGuides: true, snapGrid: true, snapDocBounds: true }),
    snapnone: () => store.setOptions({ snapGuides: false, snapGrid: false, snapDocBounds: false }),
    lockguides: () => store.toggleView("guidesLocked"),
    clearguides: () => store.clearGuides(),
    newguide: () => open("newGuide"),
    screenfull: () => store.setScreenMode("full"),
    screenfullmenu: () => store.setScreenMode("fullMenu"),
    screenstandard: () => store.setScreenMode("standard"),
    showall: () => store.setOptions(showExtrasPatch(true)),
    shownone: () => store.setOptions(showExtrasPatch(false)),
    actual: () => store.setZoom(1),
  };
  menuActionsRef.current = menuActions;
  const stableMenuActions = useMemo(() => Object.fromEntries(
    Object.keys(menuActions).map((id) => [id, () => {
      if (store.state.documents.length || NO_DOCUMENT_COMMANDS.test(id)) menuActionsRef.current[id]?.();
    }]),
    // Menu ids are the static bridge between the generated blueprint and this
    // action table. The wrappers stay stable while their targets refresh.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ), []);
  // The menu structure is static (PS_MENUS blueprint; items are only disabled
  // when unimplemented), and every handler reads store.state fresh, so the tree
  // is identical across renders — build it once instead of walking the 3848-line
  // blueprint on every render. (Previously this ran ~60×/sec via the cursor
  // subscription; see review Perf C2.)
  // Built-ins first, then the user's saved layouts. A saved workspace that
  // reuses a built-in name shadows it, so the menu never shows the name twice
  // and Apply resolves to what the user last saved under it.
  const menuWorkspaces = useMemo(() => {
    const custom = new Set(workspaces.map((w) => w.name));
    return [
      ...BUILTIN_WORKSPACES.filter((w) => !custom.has(w.name)).map((w) => ({ ...w, builtin: true })),
      ...workspaces,
    ];
  }, [workspaces]);
  const applyWorkspace = (name: string) => {
    const w = menuWorkspaces.find((x) => x.name === name);
    if (!w || !dockRef.current) return;
    try {
      // Like the shortcut set below: a workspace with no captured tool arrangement
      // (every built-in, anything saved before #481) keeps the user's rail.
      if (w.toolConfiguration && !store.setToolbarConfiguration(w.toolConfiguration)) return;
    } catch (error) {
      toast.push({ title: "Workspace", message: error instanceof Error ? error.message : String(error), variant: "error" });
      return;
    }
    dockRef.current.setLayout(w.layout);
    dockRef.current.setToolbarLayout(w.toolbarLayout ?? initialToolbarLayout);
    saveActiveWorkspaceLS(w.name);
    // Only a workspace that actually captured chords replaces them — applying a
    // built-in must not silently wipe the user's custom shortcut set.
    if (w.shortcuts) store.setKeyboardShortcuts(w.shortcuts);
  };
  // Reset Panels puts back the active workspace's own saved panels and toolbar
  // placement, collapsed docks included; a deleted one falls back to Essentials.
  const resetWorkspace = () => {
    const w = menuWorkspaces.find((x) => x.name === loadActiveWorkspaceLS()) ?? BUILTIN_WORKSPACES[0];
    dockRef.current?.setLayout(w.layout);
    dockRef.current?.setToolbarLayout(w.toolbarLayout ?? initialToolbarLayout);
  };
  const panels = {
    layers: { title: "Layers", icon: <Icon d={PANEL_ICONS.layers} />, flush: true, render: () => <LayersPanel /> },
    color: { title: "Color", icon: <Icon d={PANEL_ICONS.color} />, render: () => <ColorPanel /> },
    adjustments: { title: "Adjustments", icon: <Icon d={PANEL_ICONS.adjustments} />, render: () => <AdjustmentsPanel /> },
    properties: { title: "Properties", icon: <Icon d={PANEL_ICONS.properties} />, render: () => <PropertiesPanel /> },
    history: { title: "History", icon: <Icon d={PANEL_ICONS.history} />, render: () => <HistoryPanel /> },
    actions: { title: "Actions", icon: <Icon d={PANEL_ICONS.actions} />, render: () => <ActionsPanel /> },
    measurementlog: { title: "Measurement Log", icon: <Icon d={PANEL_ICONS.measurementlog} />, render: () => <MeasurementLogPanel /> },
    info: { title: "Info", icon: <Icon d={PANEL_ICONS.info} />, render: () => <InfoPanel /> },
    histogram: { title: "Histogram", icon: <Icon d={PANEL_ICONS.histogram} />, render: () => <HistogramPanel /> },
    channels: { title: "Channels", icon: <Icon d={PANEL_ICONS.channels} />, render: () => <ChannelsPanel /> },
    navigator: { title: "Navigator", icon: <Icon d={PANEL_ICONS.navigator} />, render: () => <NavigatorPanel /> },
    secondview: { title: "Second View", icon: <Icon d={PANEL_ICONS.secondview} />, render: () => <SecondViewPanel mode={arrangeMode} /> },
    animation: { title: "Animation", icon: <Icon d={PANEL_ICONS.animation} />, render: () => <AnimationPanel /> },
    notes: { title: "Notes", icon: <Icon d={PANEL_ICONS.notes} />, render: () => <NotesPanel /> },
    swatches: { title: "Swatches", icon: <Icon d={PANEL_ICONS.swatches} />, render: () => <SwatchesPanel /> },
    libraries: { title: "Libraries", icon: <Icon d={PANEL_ICONS.libraries} />, render: () => <LibrariesPanel /> },
    brushes: { title: "Brushes", icon: <Icon d={PANEL_ICONS.brushes} />, render: () => <BrushesPanel /> },
    clonesource: { title: "Clone Source", icon: <Icon d={PANEL_ICONS.clonesource} />, render: () => <CloneSourcePanel /> },
    styles: { title: "Styles", icon: <Icon d={PANEL_ICONS.styles} />, render: () => <StylesPanel /> },
    paths: { title: "Paths", icon: <Icon d={PANEL_ICONS.paths} />, render: () => <PathsPanel /> },
    layercomps: { title: "Layer Comps", icon: <Icon d={PANEL_ICONS.layercomps} />, render: () => <LayerCompsPanel /> },
    character: { title: "Character", icon: <Icon d={PANEL_ICONS.character} />, render: () => <CharacterPanel /> },
    paragraph: { title: "Paragraph", icon: <Icon d={PANEL_ICONS.paragraph} />, render: () => <ParagraphPanel /> },
  };
  // Type ▸ OpenType checkmarks follow the active type layer's spec. Keyed on a
  // stable string so the (expensive) menu tree only rebuilds when the set of
  // checked ids actually changes, not on every layer edit.
  const generatorWatch = useStore((s) => s.generatorWatch);
  const showGridChecked = useStore((s) => s.showGrid);
  const showRulersChecked = useStore((s) => s.showRulers);
  const snapEnabledChecked = useStore((s) => s.snapEnabled);
  const proofOnChecked = useStore((s) => s.proofOn);
  const openTypeCheckedKey = useMemo(() => {
    const active = layers.find((l) => l.id === activeLayerId);
    if (active?.kind !== LAYER_KIND.text) return "";
    const spec = text.get(activeLayerId);
    return spec ? [...openTypeCheckedIds(spec)].sort().join(",") : "";
  }, [layers, activeLayerId]);
  // ⌥⌘G is a toggle: with the active layer clipped, Layer ▸ Create Clipping Mask
  // reads Release Clipping Mask instead (same command id). Keyed on a boolean so
  // the expensive menu rebuild only happens when the clip state actually flips.
  const activeClipped = !!layers.find((l) => l.id === activeLayerId)?.clipped;
  // Type ▸ Language Options ▸ East Asian Features acts on the active type layer,
  // so without one it greys out (as in Photoshop) instead of doing nothing.
  const activeIsText = layers.find((l) => l.id === activeLayerId)?.kind === LAYER_KIND.text;
  // Window ▸ panel checkmarks mirror the live dock tree. Seeded from the same
  // layout the workspace mounts with (persisted snapshot, else the factory
  // seed) and refreshed by onLayoutChange below.
  const [openPanelIds, setOpenPanelIds] = useState<ReadonlySet<string>>(
    () => new Set(dockLayoutPanelIds(loadLastLayoutLS() ?? initialLayout)),
  );
  // Edit ▸ Menus… — the dialog saves the hidden set to localStorage and writes
  // the shortcut overrides in the same handler, so re-reading it whenever that
  // store write lands makes hiding apply on OK instead of whenever some
  // unrelated menu dep happens to change next. (#239)
  const hiddenMenuCommands = useMemo(() => loadHiddenMenuCommands(), [keyboardShortcuts]); // eslint-disable-line react-hooks/exhaustive-deps -- deliberate cache-buster, not a read
  const menuEnablement = useMemo(() => {
    const hasDocument = doc.width > 0 && doc.height > 0;
    // Home (#476): with no document open, every registered command needs an
    // engine except the ones that create/open one or edit preferences. Dropping
    // them here (the dispatcher boundary) disables both the menu items and their
    // keyboard shortcuts, so a stray ⌘Z on Home never reaches `engine.e`.
    const documentless: Record<string, boolean> = hasDocument ? {} : Object.fromEntries(
      Object.keys(stableMenuActions).filter((id) => !NO_DOCUMENT_COMMANDS.test(id)).map((id) => [id, false]),
    );
    return {
      undo: canUndo,
      redo: canRedo,
      fade: canFade,
      resel: canReselect,
      paste: hasDocument,
      pasteinplace: hasDocument,
      pasteinto: hasDocument && selectionActive,
      pasteoutside: hasDocument && selectionActive,
      // Copy, Cut, and Fill intentionally work on the whole active layer when
      // there is no selection; only their document-less state is unavailable.
      cut: hasDocument,
      copy: hasDocument,
      copymerged: hasDocument,
      fill: hasDocument,
      fillfg: hasDocument,
      fillbg: hasDocument,
      clear: hasDocument && selectionActive,
      stroke: hasDocument && selectionActive,
      cropsel: hasDocument && selectionActive,
      transformagain: hasDocument && canTransformAgain,
      deletefiltermask: hasSmartFilterMask,
      disablefiltermask: hasSmartFilterMask,
      langeastasian: activeIsText,
      // File ▸ Revert needs a file on disk. A never-saved document has nothing
      // to reload, so the command (and its bare F12 shortcut) stays disabled.
      revert: hasDocument && documents.some((d) => d.id === activeDocId && d.hasFile),
      autoalignlayers: hasDocument && layers.filter((l) => selectedLayerIds.includes(l.id) && l.kind === 0 && l.visible && !l.locked && ((l.locks ?? 0) & 4) === 0).length >= 2,
      autoblendlayers: hasDocument && layers.filter((l) => selectedLayerIds.includes(l.id) && l.kind === 0 && l.visible && !l.locked && ((l.locks ?? 0) & 4) === 0).length >= 2,
      ...documentless, // last, so no per-command flag can re-enable an engine command on Home
    };
  }, [doc.width, doc.height, canUndo, canRedo, canFade, canReselect, hasClipboard, selectionActive, canTransformAgain, hasSmartFilterMask, activeIsText, stableMenuActions, documents, activeDocId, layers, selectedLayerIds]);
  // Built twice from one definition: once as the live bar (hidden commands
  // removed, disabled ones action-less) and once unfiltered, for Edit ▸ Keyboard
  // Shortcuts. The editor lists what HAS a shortcut, not what happens to be
  // runnable right now — ⌘Z with nothing to undo is still ⌘Z (#501).
  const buildMenus = useCallback((
    hidden: ReadonlySet<string>,
    enablement: Readonly<Record<string, boolean>>,
  ) => {
    const menus = buildPhotoshopMenus(
      stableMenuActions,
      recentFiles,
      (p) => void openPaths([p]),
      {
        workspaces: menuWorkspaces,
        onApplyWorkspace: applyWorkspace,
        panels: Object.entries(panels).map(([id, panel]) => ({ id, title: panel.title })),
        openPanelIds,
        // Photoshop toggle: reopen a closed panel, close an open one — except
        // that a panel iconified on a collapsed dock springs out of its rail.
        // Presence is read from the live layout at click time so the memoized
        // menu tree can never act on a stale checkmark set.
        onOpenPanel: (id) => {
          const dock = dockRef.current;
          if (!dock) return;
          const layout = dock.getLayout();
          const iconified = (["left", "right", "top", "bottom"] as const)
            .some((side) => layout[side]?.collapsed && dockLayoutPanelIds({ [side]: layout[side] }).includes(id));
          if (!iconified && dockLayoutPanelIds(layout).includes(id)) dock.closePanel(id);
          else dock.openPanel(id);
        },
        documents: documents.map((d) => ({ id: String(d.id), name: docLabel(d) })),
        activeDocumentId: String(activeDocId),
        onActivateDocument: (id) => store.activateDoc(Number(id)),
      },
      { presets: pixelAspectPresets, currentRatio: pixelAspect, onSelect: (ratio) => store.setPixelAspect(ratio) },
      { presets: measureScalePresets, currentScale: measureScale, onSelect: (scale) => store.setMeasureScale(scale.px, scale.units, scale.unit) },
      new Set([
        ...(openTypeCheckedKey ? openTypeCheckedKey.split(",") : []),
        ...(generatorWatch ? ["imageassets"] : []),
        ...imageModeCheckedIds(mode, depth, hasDuotone),
        ...viewToggleCheckedIds({
          showGrid: showGridChecked,
          showRulers: showRulersChecked,
          snapEnabled: snapEnabledChecked,
          proofOn: proofOnChecked,
        }),
      ]),
      !!photoshopPreview,
      hidden,
      enablement,
    );
    if (activeClipped) {
      // The generated blueprint nests the item inside a same-named submenu, so
      // relabel every occurrence rather than assuming a menu shape.
      const relabel = (items: { label?: unknown; items?: unknown[] }[]) => items.forEach((it) => {
        if (it.label === "Create Clipping Mask") it.label = "Release Clipping Mask";
        if (it.items) relabel(it.items as typeof items);
      });
      relabel(menus);
    }
    nameUndoItem(menus, undoLabel);
    return menus;
  }, [recentFiles, workspaces, pixelAspect, pixelAspectPresets, measureScale, measureScalePresets, openTypeCheckedKey, photoshopPreview, generatorWatch, showGridChecked, showRulersChecked, snapEnabledChecked, proofOnChecked, activeClipped, openPanelIds, documents, activeDocId, mode, depth, hasDuotone, undoLabel]); // eslint-disable-line react-hooks/exhaustive-deps
  const baseMenus = useMemo(
    () => buildMenus(hiddenMenuCommands, menuEnablement),
    [buildMenus, hiddenMenuCommands, menuEnablement],
  );
  const catalogMenus = useMemo(() => buildMenus(NO_HIDDEN, {}), [buildMenus]);
  const shortcutCommands = useMemo(
    () => collectShortcutCommands(baseMenus, keyboardShortcuts),
    [baseMenus, keyboardShortcuts],
  );
  /** Every bindable command, whatever its current state. Dispatch and Edit ▸
   *  Search use `shortcutCommands`; only the editor reads this. */
  const shortcutCatalog = useMemo(
    () => collectShortcutCommands(catalogMenus, keyboardShortcuts),
    [catalogMenus, keyboardShortcuts],
  );
  shortcutCommandsRef.current = shortcutCommandMap(shortcutCommands);
  const toolShortcutCommands = useMemo(() => [
    ...TOOL_SHORTCUT_GROUPS.map((definition): ShortcutCommand => ({
      id: definition.id,
      label: definition.label,
      defaultChord: definition.defaultChord,
      chord: Object.hasOwn(keyboardShortcuts, definition.id)
        ? keyboardShortcuts[definition.id]
        : definition.defaultChord,
      run: () => store.setTool(definition.tools[0]),
      cycle: () => {
        const current = definition.tools.indexOf(store.state.tool);
        store.setTool(definition.tools[(current + 1) % definition.tools.length]);
      },
    })),
    ...TOOL_ACTION_SHORTCUTS.map((definition): ShortcutCommand => ({
      ...definition,
      chord: Object.hasOwn(keyboardShortcuts, definition.id)
        ? keyboardShortcuts[definition.id]
        : definition.defaultChord,
    })),
  ], [keyboardShortcuts]);
  toolShortcutCommandsRef.current = shortcutCommandMap(toolShortcutCommands);
  const menus = useMemo(
    () => applyShortcutOverrides(baseMenus, keyboardShortcuts, platform === "mac" ? "mac" : "windows"),
    [baseMenus, keyboardShortcuts, platform],
  );

  // Mirror the menu bar into the native macOS system menu bar. Vision's native
  // window frame and in-app document bar do not render application menus, so
  // the native menu
  // rebuilds only when its structure changes. No-op off mac / outside Tauri.
  // See native/macMenu.ts.
  useEffect(() => {
    void syncMacMenu(menus, platform, () => historyTransactionActive(engine.engine));
  }, [menus, platform]);

  // View ▸ Screen Mode: mirror the mode onto the document root (app CSS hides the
  // chrome in Full Screen) + best-effort OS fullscreen for the two full modes.
  const browserFullscreenRef = useRef(false);
  const pendingStandardExitRef = useRef(false);
  useEffect(() => {
    document.documentElement.setAttribute("data-mv-screen-mode", screenMode);
    if (screenMode === "standard") {
      if (document.fullscreenElement || browserFullscreenRef.current) {
        pendingStandardExitRef.current = true;
      }
      if (document.fullscreenElement) {
        void document.exitFullscreen?.().catch(() => {
          pendingStandardExitRef.current = false;
        });
      }
    } else if (!document.fullscreenElement && !pendingStandardExitRef.current) {
      void document.documentElement.requestFullscreen?.().catch(() => {});
    }
  }, [screenMode]);

  // Tab / ⇧Tab: mirror the hidden-chrome level onto the document root, same
  // shape as the Screen Mode attribute above (CHROME_HIDE_CSS does the hiding).
  useEffect(() => {
    const root = document.documentElement;
    if (chromeHidden) root.setAttribute("data-mv-chrome-hidden", chromeHidden);
    else root.removeAttribute("data-mv-chrome-hidden");
  }, [chromeHidden]);
  // Preferences ▸ Workspace ▸ Auto-Show Hidden Panels: with the panels hidden,
  // the pointer at the left/right window edge floats that side's dock over the
  // canvas until the pointer leaves it (CHROME_HIDE_CSS again).
  const autoShowHiddenPanels = workspacePrefs.autoShowHiddenPanels;
  useEffect(() => {
    const root = document.documentElement;
    if (!chromeHidden || !autoShowHiddenPanels) return;
    let shown: "" | "left" | "right" = "";
    const onMove = (e: PointerEvent) => {
      // A dropdown/menu opened from the peeked dock is portalled into the
      // overlay root; the pointer on it still counts as over the dock, and an
      // open dropdown list keeps the dock up until it closes.
      const overShown = !!shown && (isDropdownOpen()
        || (e.target instanceof Element && !!e.target.closest(`.monet-dock--${shown}, #monet-overlay-root`)));
      const next = hiddenPanelsPeek(shown, e.clientX, window.innerWidth, overShown);
      if (next === shown) return;
      shown = next;
      if (next) root.setAttribute("data-mv-chrome-peek", next);
      else root.removeAttribute("data-mv-chrome-peek");
    };
    window.addEventListener("pointermove", onMove);
    return () => { window.removeEventListener("pointermove", onMove); root.removeAttribute("data-mv-chrome-peek"); };
  }, [chromeHidden, autoShowHiddenPanels]);
  // Preferences ▸ Workspace ▸ Large Tabs off: the smaller document tab bar.
  const largeTabs = workspacePrefs.largeTabs;
  useEffect(() => {
    if (largeTabs) document.documentElement.removeAttribute("data-mv-small-tabs");
    else document.documentElement.setAttribute("data-mv-small-tabs", "");
  }, [largeTabs]);

  // Home start screen (#476): no document open → the docks, toolbars and status
  // bar hide (styles.css `html[data-mv-home]`) and the canvas slot shows Home.
  const onHome = documents.length === 0;
  useEffect(() => {
    const root = document.documentElement;
    if (onHome) root.setAttribute("data-mv-home", "");
    else root.removeAttribute("data-mv-home");
  }, [onHome]);

  // Reconcile native/browser fullscreen in both directions. The OS can consume
  // Escape before the webview sees keydown, and a slow request can resolve after
  // the app has already returned to Standard.
  useEffect(() => {
    const onFullscreenChange = () => {
      if (document.fullscreenElement) {
        browserFullscreenRef.current = true;
        if (store.state.screenMode === "standard") {
          pendingStandardExitRef.current = true;
          void document.exitFullscreen?.().catch(() => {
            pendingStandardExitRef.current = false;
          });
        } else {
          pendingStandardExitRef.current = false;
        }
      } else {
        browserFullscreenRef.current = false;
        if (pendingStandardExitRef.current) {
          pendingStandardExitRef.current = false;
          if (store.state.screenMode !== "standard") {
            void document.documentElement.requestFullscreen?.().catch(() => {});
          }
        } else if (store.state.screenMode !== "standard") {
          store.setScreenMode("standard");
        }
      }
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  // Edit ▸ Search and Edit ▸ Keyboard Shortcuts share the same resolved,
  // runnable application-menu command list.
  useEffect(() => {
    commandPalette.items = shortcutCommands;
    commandPalette.toolItems = toolShortcutCommands;
    commandPalette.catalog = shortcutCatalog;
  }, [shortcutCommands, toolShortcutCommands, shortcutCatalog]);

  // Photoshop's configurable status-bar readout (the "Show" menu): the selector
  // switches what the [data-mv-status] field reports from the live document state.
  const statusToolName = (TOOL_DEFS[tool]?.name || tool).replace(/\s*\([^)]*\)\s*$/, "");
  const statusText = formatStatusInfo(statusInfo, {
    docW: doc.width, docH: doc.height, colorMode: mode, depth, profile: colorProfile, profileAssigned: colorProfileAssigned, profileName: iccProfileName, modeProfileName, layerCount: layers.length, toolName: statusToolName, measureScale,
  });
  const photoshopMode = photoshopPreview ? ({
    0: "Bitmap", 1: "Grayscale", 2: "Indexed", 4: "CMYK",
    7: "Multichannel", 8: "Duotone", 9: "Lab",
  } as Record<number, string>)[photoshopPreview.mode] ?? `mode ${photoshopPreview.mode}` : "";
  const statusBar = (
    <StatusBar>
      <ZoomField /><span className="monet-vsep" />
      {photoshopPreview && <>
        <span data-mv-photoshop-read-only style={{ color: "var(--warning, #e8a33b)" }}>
          Read-only {photoshopPreview.isPsb ? "PSB" : "PSD"} · {photoshopMode} · {photoshopPreview.depth}-bit preview
        </span>
        <button type="button" onClick={setRgbMode}
          style={{ border: 0, background: "transparent", color: ACCENT, cursor: "pointer", padding: 0 }}>
          Convert to RGB
        </button>
        <span className="monet-vsep" />
      </>}
      <Select size="sm" id="mv-status-info" value={statusInfo} onChange={(v) => store.setOptions({ statusInfo: v as StatusInfoMode })}
        title="Status info" options={STATUS_INFO_MODES} />
      <span data-mv-status>{statusText}</span><span className="monet-vsep" />
      <span style={{ color: ACCENT }}>● {layers.length} layer{layers.length === 1 ? "" : "s"}{selectionActive ? " · selection" : ""}</span>
      <span className="grow" />
      <CursorReadout />
    </StatusBar>
  );

  // Contextual Task Bar — a floating on-canvas bar surfacing the most relevant
  // next actions for the current context (an active selection vs. none). Mirrors
  // Photoshop's Contextual Task Bar; toggled from Window ▸ Contextual Task Bar.
  const taskBarButtons: { label: string; onClick: () => void; primary?: boolean }[] =
    selectionActive
      ? [
          { label: "Generative Fill", onClick: () => generativeFill(), primary: true },
          { label: "Fill…", onClick: () => open("fill") },
          { label: "Select and Mask…", onClick: () => open("selectandmask") },
          { label: "Add Mask", onClick: () => store.addLayerMask(store.state.activeLayerId) },
          { label: "Deselect", onClick: () => store.deselect() },
        ]
      : [
          { label: "Select Subject", onClick: () => runMl("Select Subject", ml.selectSubject), primary: true },
          { label: "Remove Background", onClick: () => runMl("Remove Background", ml.removeBackground) },
          { label: "Select All", onClick: () => store.selectAll() },
        ];
  const contextualTaskBar = doc.width > 0 && taskBarOpen ? (
    <div className="mv-taskbar" role="toolbar" aria-label="Contextual task bar">
      {taskBarButtons.map((b) => (
        <button key={b.label} className={b.primary ? "mv-taskbar-btn mv-taskbar-primary" : "mv-taskbar-btn"} onClick={b.onClick}>{b.label}</button>
      ))}
      <span className="mv-taskbar-sep" />
      <button className="mv-taskbar-btn mv-taskbar-close" title="Hide task bar" aria-label="Hide task bar" onClick={() => setTaskBarOpen(false)}>×</button>
    </div>
  ) : null;

  return (
    <>
      <style>{CHROME_HIDE_CSS}</style>
      {/* Custom Monet liquid-glass frame only. Do NOT add `nativeFrame` here —
          it switches Vision to a native OS title bar. Guarded by
          src/native/windowChrome.test.ts (paired with main.rs decorations). */}
      <DockableWorkspace
        ref={dockRef}
        onLayoutChange={(layout) => { saveLastLayoutLS(layout); setOpenPanelIds(new Set(dockLayoutPanelIds(layout))); }}
        autoCollapseFlyouts={workspacePrefs.autoCollapseIconicPanels}
        accent={ACCENT}
        app="VISION"
        appPanel={<AppInfoPanel/>}
        platform={platform}
        docs={documents.filter((d) => !floatDocs.includes(d.id)).map(docLabel)}
        activeDoc={(() => { const a = documents.find((d) => d.id === activeDocId); return a ? docLabel(a) : undefined; })()}
        onDocSelect={(label) => { const d = findDoc(label); if (d) store.activateDoc(d.id); }}
        onDocClose={(label) => { const d = findDoc(label); if (d) void requestClose(d); }}
        onDocReorder={(order) => store.reorderDocs(order.map((l) => l.replace(/\*$/, "")))}
        menus={menus}
        toolbarDefs={{
          tools: { render: (o) => onHome ? <></> : <ToolRail tools={tools} active={tool} onSelect={(id) => store.setTool(id as ToolId)} orientation={o} inline
            footer={toolbarConfiguration.extra.length ? <ExtraTools tools={toolbarConfiguration.extra} active={tool} onSelect={(id) => store.setTool(id)} orientation={o} /> : undefined} /> },
          options: { horizontalOnly: true, render: () => onHome || liquifyWorkspaceOpen ? <></> : <OptionsForTool onSelectSubject={() => runMl("Select Subject", ml.selectSubject)} /> },
        }}
        initialToolbarLayout={initialToolbarLayout}
        toolbarLayout={persistedToolbarLayout ?? undefined}
        onToolbarLayoutChange={saveLastToolbarLS}
        canvas={onHome
          ? <Home recents={recentFiles} onNew={doNew} onOpen={doOpen} onOpenRecent={(p) => void openPaths([p])} />
          : <Canvas><CanvasView />{contextualTaskBar}</Canvas>}
        statusBar={onHome ? null : statusBar}
        panels={onHome ? Object.fromEntries(Object.entries(panels).map(([id, panel]) => [id, { ...panel, render: () => <></> }])) : panels}
        initialLayout={initialLayout}
        layout={persistedLayout ?? undefined}
      />
      <input ref={placeInputRef} type="file" accept="image/*,.svg,.tga,.pnm,.ppm,.pgm,.pbm,.pcx,.psd,.psb" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) placeImageFile(f); e.target.value = ""; }} />
      <input ref={gifInputRef} type="file" accept=".gif,image/gif" style={{ display: "none" }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) openGifFile(f); e.target.value = ""; }} />
      {dropping && (
        <div className="mv-dropzone" role="status" aria-live="polite">
          <div className="mv-dropzone-card">Drop files to import</div>
        </div>
      )}
      <LiquifyWorkspace open={liquifyWorkspaceOpen} onApply={applyLiquifyWorkspace} onCancel={cancelLiquifyWorkspace} />
      <VanishingPointWorkspace />
      {isTauri() && <FloatWindows />}
      {adaptiveWideOpen && <AdaptiveWideAngle onClose={() => setAdaptiveWideOpen(false)} />}
      {vectorMaskOpPicker && <VectorMaskPathOp onClose={() => setVectorMaskOpPicker(false)} />}
    </>
  );
}

export function App() {
  const { platform } = useMonetContext() ?? { platform: "mac" as const };
  return (
    <ToastProvider>
      <DialogProvider>
        <Editor platform={platform} />
      </DialogProvider>
    </ToastProvider>
  );
}
