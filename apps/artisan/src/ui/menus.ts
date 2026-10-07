// ─────────────────────────────────────────────────────────────
// ui/menus — application menu bar (data-driven, wired to commands)
// ─────────────────────────────────────────────────────────────

import type { MenuItemDef } from "@monet-ui/monet-react";
import { type ArtisanStore, type EditorState, Ops, Query } from "../engine";
import { commands, hasClipboard, hasHiddenItems, hasLockedItems, selectionHasAreaText, selectionHasBlend, selectionHasClipGroup, selectionHasCompound, selectionHasEnvelope, selectionHasLivePaint, selectionHasMask, selectionHasPerspective, selectionHasPointText, selectionHasText } from "../commands";
import { fileCommands } from "../io/commands";

interface MenuBarEntry {
  id: string;
  label: string;
  items: MenuItemDef[];
}

/** Illustrator's Warp style names, shared by Effect ▸ Warp and Envelope Distort. */
const WARP_LABELS = {
  arc: "Arc",
  "arc-lower": "Arc Lower",
  "arc-upper": "Arc Upper",
  flag: "Flag",
  wave: "Wave",
  bulge: "Bulge",
  rise: "Rise",
} as const;
type WarpStyleKey = keyof typeof WARP_LABELS;

/** The warp style of the first selected warp envelope, so Envelope Options
 *  re-bends with the style already in use instead of resetting to Arc. */
const envelopeWarpStyle = (store: ArtisanStore): WarpStyleKey | null => {
  for (const id of store.getState().selection) {
    const item = Query.findItem(store.doc, id)?.item;
    if (item?.type === "group" && item.envelope?.warp) return item.envelope.warp.style;
  }
  return null;
};

export function buildMenus(store: ArtisanStore, state: EditorState): MenuBarEntry[] {
  const has = state.selection.length > 0;
  const canPaste = hasClipboard();
  const hasText = selectionHasText(store);
  const hasLivePaint = selectionHasLivePaint(store);
  const hasPerspective = selectionHasPerspective(store);
  const hasEnvelope = selectionHasEnvelope(store);
  const avgAnchors = Object.values(state.anchorSelection).reduce((n, a) => n + a.length, 0) >= 2;
  const hasAnchorSel = Object.values(state.anchorSelection).some((a) => a && a.length > 0);
  const undoLabel = store.undoLabel();
  const redoLabel = store.redoLabel();

  return [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New…", shortcut: "⌘N", action: () => void fileCommands.new(store) },
        { id: "open", label: "Open / Import…", shortcut: "⌘O", action: () => void fileCommands.open(store) },
        { id: "sep1", separator: true },
        { id: "save", label: "Save", shortcut: "⌘S", action: () => void fileCommands.save(store) },
        { id: "saveas", label: "Save As…", shortcut: "⇧⌘S", action: () => void fileCommands.saveAs(store) },
        { id: "sep2", separator: true },
        { id: "expsvg", label: "Export as SVG…", shortcut: "⌘E", action: () => void fileCommands.exportSvg(store) },
        { id: "exppng", label: "Export as PNG…", shortcut: "⇧⌘E", action: () => void fileCommands.exportPng(store) },
        { id: "expslices", label: "Export Slices…", action: () => void fileCommands.exportSlices(store) },
        { id: "exportscreens", label: "Export for Screens Manifest…", action: () => void fileCommands.exportForScreensManifest(store) },
      ],
    },
    {
      id: "edit",
      label: "Edit",
      items: [
        { id: "undo", label: undoLabel ? `Undo ${undoLabel}` : "Undo", shortcut: "⌘Z", disabled: !store.canUndo, action: () => commands.undo(store) },
        { id: "redo", label: redoLabel ? `Redo ${redoLabel}` : "Redo", shortcut: "⇧⌘Z", disabled: !store.canRedo, action: () => commands.redo(store) },
        { id: "sep1", separator: true },
        { id: "cut", label: "Cut", shortcut: "⌘X", disabled: !has, action: () => commands.cut(store) },
        { id: "copy", label: "Copy", shortcut: "⌘C", disabled: !has, action: () => commands.copy(store) },
        { id: "paste", label: "Paste", shortcut: "⌘V", disabled: !canPaste, action: () => commands.paste(store) },
        { id: "pastefront", label: "Paste in Front", shortcut: "⌘F", disabled: !canPaste, action: () => commands.pasteInFront(store) },
        { id: "pasteback", label: "Paste in Back", shortcut: "⌘B", disabled: !canPaste, action: () => commands.pasteInBack(store) },
        { id: "pasteplace", label: "Paste in Place", shortcut: "⌥⌘V", disabled: !canPaste, action: () => commands.pasteInPlace(store) },
        { id: "pasteall", label: "Paste on All Artboards", shortcut: "⌥⇧⌘V", disabled: !canPaste || state.doc.artboards.length < 2, action: () => commands.pasteOnAllArtboards(store) },
        { id: "sep2", separator: true },
        { id: "dup", label: "Duplicate", shortcut: "⌘D", disabled: !has, action: () => commands.duplicate(store) },
        { id: "del", label: "Delete", shortcut: "⌫", disabled: !has, action: () => commands.delete(store) },
        { id: "sep3", separator: true },
        {
          id: "edit-colors",
          label: "Edit Colors",
          items: [
            { id: "invert-colors", label: "Invert Colors", disabled: !has, action: () => commands.editColors(store, "invert") },
            { id: "grayscale", label: "Convert to Grayscale", disabled: !has, action: () => commands.editColors(store, "grayscale") },
            { id: "saturate", label: "Saturate", disabled: !has, action: () => commands.editColors(store, "saturate") },
            { id: "desaturate", label: "Desaturate", disabled: !has, action: () => commands.editColors(store, "desaturate") },
            { id: "ecsep", separator: true },
            { id: "blend-ftb", label: "Blend Front to Back", disabled: state.selection.length < 3, action: () => commands.blendColors(store, "front-to-back") },
            { id: "blend-h", label: "Blend Horizontally", disabled: state.selection.length < 3, action: () => commands.blendColors(store, "horizontal") },
            { id: "blend-v", label: "Blend Vertically", disabled: state.selection.length < 3, action: () => commands.blendColors(store, "vertical") },
          ],
        },
      ],
    },
    {
      id: "object",
      label: "Object",
      items: [
        { id: "group", label: "Group", shortcut: "⌘G", disabled: state.selection.length < 2, action: () => commands.group(store) },
        { id: "ungroup", label: "Ungroup", shortcut: "⇧⌘G", disabled: !Ops.Group.canUngroup(state.doc, state.selection), action: () => commands.ungroup(store) },
        { id: "msep0", separator: true },
        { id: "clip", label: "Make Clipping Mask", shortcut: "⌘7", disabled: state.selection.length < 2, action: () => commands.makeClipMask(store) },
        { id: "relclip", label: "Release Clipping Mask", shortcut: "⌥⌘7", disabled: !selectionHasClipGroup(store), action: () => commands.releaseClipMask(store) },
        { id: "mask", label: "Make Opacity Mask", disabled: state.selection.length < 2, action: () => commands.makeMask(store) },
        { id: "relmask", label: "Release Opacity Mask", disabled: !selectionHasMask(store), action: () => commands.releaseMask(store) },
        {
          id: "live-paint",
          label: "Live Paint",
          items: [
            { id: "live-paint-make", label: "Make", disabled: !has, action: () => commands.makeLivePaint(store) },
            { id: "live-paint-expand", label: "Expand", disabled: !hasLivePaint, action: () => commands.expandLivePaint(store) },
            { id: "live-paint-release", label: "Release", disabled: !hasLivePaint, action: () => commands.releaseLivePaint(store) },
          ],
        },
        {
          id: "envelope",
          label: "Envelope Distort",
          items: [
            {
              id: "envelope-warp",
              label: "Make with Warp",
              items: (["arc", "arc-lower", "arc-upper", "flag", "wave", "bulge", "rise"] as const).map((style) => ({
                id: `envelope-warp-${style}`,
                label: WARP_LABELS[style],
                disabled: !has,
                action: () => commands.makeEnvelopeWarp(store, style),
              })),
            },
            { id: "envelope-top", label: "Make with Top Object", shortcut: "⌥⌘C", disabled: state.selection.length < 2, action: () => commands.makeEnvelopeTopObject(store) },
            {
              id: "envelope-options",
              label: "Envelope Options",
              items: ([-0.8, -0.4, 0.4, 0.8] as const).map((bend) => ({
                id: `envelope-bend-${bend}`,
                label: `Bend ${Math.round(bend * 100)}%`,
                disabled: !hasEnvelope,
                action: () => commands.envelopeOptions(store, envelopeWarpStyle(store) ?? "arc", bend),
              })),
            },
            { id: "envelope-release", label: "Release", shortcut: "⌥⇧⌘C", disabled: !hasEnvelope, action: () => commands.releaseEnvelope(store) },
            { id: "envelope-expand", label: "Expand", disabled: !hasEnvelope, action: () => commands.expandEnvelope(store) },
          ],
        },
        {
          id: "perspective",
          label: "Perspective",
          items: [
            { id: "perspective-make", label: "Make", disabled: !has, action: () => commands.makePerspective(store) },
            { id: "perspective-expand", label: "Expand", disabled: !hasPerspective, action: () => commands.expandPerspective(store) },
            { id: "perspective-release", label: "Release", disabled: !hasPerspective, action: () => commands.releasePerspective(store) },
          ],
        },
        { id: "makepattern", label: "Make Pattern", disabled: !has, action: () => commands.makePattern(store) },
        { id: "trim-marks", label: "Create Trim Marks", disabled: !has, action: () => commands.createTrimMarks(store) },
        { id: "seplock", separator: true },
        { id: "lock", label: "Lock Selection", shortcut: "⌘2", disabled: !has, action: () => commands.lockSelection(store) },
        { id: "lockabove", label: "Lock All Artwork Above", shortcut: "⌥⇧⌘2", disabled: !has, action: () => commands.lockAllArtworkAbove(store) },
        { id: "lockother", label: "Lock Other Layers", disabled: state.doc.layers.length <= 1, action: () => commands.lockOtherLayers(store) },
        { id: "unlockall", label: "Unlock All", shortcut: "⌥⌘2", disabled: !hasLockedItems(store), action: () => commands.unlockAll(store) },
        { id: "hide", label: "Hide Selection", shortcut: "⌘3", disabled: !has, action: () => commands.hideSelection(store) },
        { id: "hideabove", label: "Hide All Artwork Above", disabled: !has, action: () => commands.hideAllArtworkAbove(store) },
        { id: "hideother", label: "Hide Other Layers", disabled: state.doc.layers.length <= 1, action: () => commands.hideOtherLayers(store) },
        { id: "showall", label: "Show All", shortcut: "⌥⌘3", disabled: !hasHiddenItems(store), action: () => commands.showAll(store) },
        { id: "sep1", separator: true },
        {
          id: "arrange",
          label: "Arrange",
          items: [
            { id: "front", label: "Bring to Front", shortcut: "⇧⌘]", disabled: !has, action: () => commands.bringToFront(store) },
            { id: "forward", label: "Bring Forward", shortcut: "⌘]", disabled: !has, action: () => commands.bringForward(store) },
            { id: "backward", label: "Send Backward", shortcut: "⌘[", disabled: !has, action: () => commands.sendBackward(store) },
            { id: "back", label: "Send to Back", shortcut: "⇧⌘[", disabled: !has, action: () => commands.sendToBack(store) },
            { id: "arrsep", separator: true },
            { id: "send-current-layer", label: "Send to Current Layer", disabled: !has, action: () => commands.sendToCurrentLayer(store) },
          ],
        },
        {
          id: "align",
          label: "Align",
          items: [
            { id: "align-left", label: "Horizontal Align Left", disabled: state.selection.length < 2, action: () => commands.align(store, "left") },
            { id: "align-center-h", label: "Horizontal Align Center", disabled: state.selection.length < 2, action: () => commands.align(store, "center-h") },
            { id: "align-right", label: "Horizontal Align Right", disabled: state.selection.length < 2, action: () => commands.align(store, "right") },
            { id: "alignsep", separator: true },
            { id: "align-top", label: "Vertical Align Top", disabled: state.selection.length < 2, action: () => commands.align(store, "top") },
            { id: "align-center-v", label: "Vertical Align Center", disabled: state.selection.length < 2, action: () => commands.align(store, "middle-v") },
            { id: "align-bottom", label: "Vertical Align Bottom", disabled: state.selection.length < 2, action: () => commands.align(store, "bottom") },
          ],
        },
        {
          id: "distribute",
          label: "Distribute",
          items: [
            { id: "dist-left", label: "Horizontal Distribute Left", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-left") },
            { id: "dist-center-h", label: "Horizontal Distribute Center", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-center-h") },
            { id: "dist-right", label: "Horizontal Distribute Right", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-right") },
            { id: "distsep1", separator: true },
            { id: "dist-top", label: "Vertical Distribute Top", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-top") },
            { id: "dist-center-v", label: "Vertical Distribute Center", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-center-v") },
            { id: "dist-bottom", label: "Vertical Distribute Bottom", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-bottom") },
            { id: "distsep2", separator: true },
            { id: "dist-h", label: "Distribute Horizontal Space", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-h") },
            { id: "dist-v", label: "Distribute Vertical Space", disabled: state.selection.length < 3, action: () => commands.align(store, "dist-v") },
          ],
        },
        {
          id: "transform",
          label: "Transform",
          items: [
            { id: "transform-again", label: "Transform Again", disabled: !has || !state.lastTransform, action: () => commands.transformAgain(store) },
            { id: "ta-sep", separator: true },
            { id: "rotcw", label: "Rotate 90° CW", disabled: !has, action: () => commands.rotate90CW(store) },
            { id: "rotccw", label: "Rotate 90° CCW", disabled: !has, action: () => commands.rotate90CCW(store) },
            { id: "sep", separator: true },
            { id: "reflh", label: "Reflect Horizontal", disabled: !has, action: () => commands.reflectHorizontal(store) },
            { id: "reflv", label: "Reflect Vertical", disabled: !has, action: () => commands.reflectVertical(store) },
            { id: "sep2", separator: true },
            { id: "transform-each", label: "Transform Each", disabled: !has, action: () => commands.transformEach(store) },
          ],
        },
        { id: "expand", label: "Expand", disabled: !has, action: () => commands.expand(store) },
        { id: "expand-appearance", label: "Expand Appearance", disabled: !has, action: () => commands.expandAppearance(store) },
        { id: "rasterize", label: "Rasterize", disabled: !has, action: () => commands.rasterize(store) },
        {
          id: "path",
          label: "Path",
          items: [
            { id: "join", label: "Join", shortcut: "⌘J", disabled: !has, action: () => commands.join(store) },
            { id: "add-anchors", label: "Add Anchor Points", disabled: !has, action: () => commands.addAnchorPoints(store) },
            { id: "remove-anchors", label: "Remove Anchor Points", disabled: !hasAnchorSel, action: () => commands.removeAnchorPoints(store) },
            { id: "convert-corner", label: "Convert to Corner", disabled: !hasAnchorSel, action: () => commands.convertAnchorPoints(store, "corner") },
            { id: "convert-smooth", label: "Convert to Smooth", disabled: !hasAnchorSel, action: () => commands.convertAnchorPoints(store, "smooth") },
            { id: "avg-both", label: "Average", disabled: !avgAnchors, action: () => commands.average(store, "both") },
            { id: "avg-h", label: "Average Horizontal", disabled: !avgAnchors, action: () => commands.average(store, "horizontal") },
            { id: "avg-v", label: "Average Vertical", disabled: !avgAnchors, action: () => commands.average(store, "vertical") },
            { id: "outline-stroke", label: "Outline Stroke", disabled: !has, action: () => commands.outlineStroke(store) },
            { id: "offset-path", label: "Offset Path", disabled: !has, action: () => commands.offsetPath(store) },
            { id: "round-corners", label: "Round Corners", disabled: !has, action: () => commands.roundCorners(store) },
            { id: "zigzag", label: "Zig Zag", disabled: !has, action: () => commands.zigZag(store) },
            { id: "split-grid", label: "Split Into Grid", disabled: !has, action: () => commands.splitIntoGrid(store) },
            { id: "divide-below", label: "Divide Objects Below", disabled: state.selection.length !== 1, action: () => commands.divideObjectsBelow(store) },
            { id: "simplify", label: "Simplify", disabled: !has, action: () => commands.simplify(store) },
            { id: "reverse-path", label: "Reverse Path Direction", disabled: !has, action: () => commands.reversePath(store) },
            { id: "clean-up", label: "Clean Up", action: () => commands.cleanUp(store) },
          ],
        },
        {
          id: "compound",
          label: "Compound Path",
          items: [
            { id: "make-compound", label: "Make", shortcut: "⌘8", disabled: state.selection.length < 2, action: () => commands.makeCompoundPath(store) },
            { id: "release-compound", label: "Release", shortcut: "⌥⌘8", disabled: !selectionHasCompound(store), action: () => commands.releaseCompoundPath(store) },
          ],
        },
        {
          id: "blend",
          label: "Blend",
          items: [
            { id: "make-blend", label: "Make", shortcut: "⌥⌘B", disabled: state.selection.length < 2, action: () => commands.blend(store) },
            { id: "release-blend", label: "Release", shortcut: "⌥⇧⌘B", disabled: !selectionHasBlend(store), action: () => commands.releaseBlend(store) },
            { id: "reverse-blend", label: "Reverse Front to Back", disabled: !selectionHasBlend(store), action: () => commands.reverseBlendFrontToBack(store) },
            {
              id: "blend-options",
              label: "Blend Options",
              items: [
                { id: "blend-smooth", label: "Smooth Color", disabled: !selectionHasBlend(store), action: () => commands.blendOptions(store, { mode: "smooth" }) },
                { id: "blend-steps-3", label: "Specified Steps: 3", disabled: !selectionHasBlend(store), action: () => commands.blendOptions(store, { mode: "steps", steps: 3 }) },
                { id: "blend-steps-8", label: "Specified Steps: 8", disabled: !selectionHasBlend(store), action: () => commands.blendOptions(store, { mode: "steps", steps: 8 }) },
                { id: "blend-steps-16", label: "Specified Steps: 16", disabled: !selectionHasBlend(store), action: () => commands.blendOptions(store, { mode: "steps", steps: 16 }) },
              ],
            },
          ],
        },
        {
          id: "convert-shape",
          label: "Convert to Shape",
          items: [
            { id: "to-rect", label: "Rectangle", disabled: !has, action: () => commands.convertToShape(store, "rectangle") },
            { id: "to-round-rect", label: "Rounded Rectangle", disabled: !has, action: () => commands.convertToShape(store, "rounded-rectangle") },
            { id: "to-ellipse", label: "Ellipse", disabled: !has, action: () => commands.convertToShape(store, "ellipse") },
          ],
        },
        {
          id: "slice",
          label: "Slice",
          items: [
            { id: "slice-make", label: "Create from Selection", disabled: !has, action: () => commands.createSliceFromSelection(store) },
            { id: "slice-guides", label: "Create from Guides", disabled: state.doc.artboards.length === 0, action: () => commands.createSlicesFromGuides(store) },
            { id: "slice-delete-all", label: "Delete All Slices", disabled: !state.doc.slices?.length, action: () => commands.deleteAllSlices(store) },
          ],
        },
        {
          id: "artboards",
          label: "Artboards",
          items: [
            { id: "ab-new", label: "New Artboard", action: () => commands.newArtboard(store) },
            { id: "ab-delete", label: "Delete Artboard", disabled: state.doc.artboards.length <= 1, action: () => commands.deleteArtboard(store) },
            { id: "ab-duplicate", label: "Duplicate Artboard", action: () => commands.duplicateArtboard(store) },
            { id: "ab-sep", separator: true },
            { id: "ab-fit-selection", label: "Fit to Selected Art", disabled: !has || state.doc.artboards.length === 0, action: () => commands.fitArtboardToSelection(store) },
            { id: "ab-fit-artwork", label: "Fit to Artwork Bounds", disabled: state.doc.artboards.length === 0, action: () => commands.fitArtboardToArtwork(store) },
            { id: "ab-rearrange", label: "Rearrange All Artboards", disabled: state.doc.artboards.length < 2, action: () => commands.rearrangeArtboards(store) },
            { id: "ab-convert", label: "Convert to Artboards", disabled: !has, action: () => commands.convertToArtboards(store) },
          ],
        },
      ],
    },
    {
      id: "type",
      label: "Type",
      items: [
        {
          id: "change-case",
          label: "Change Case",
          items: [
            { id: "case-upper", label: "UPPERCASE", disabled: !hasText, action: () => commands.changeCase(store, "upper") },
            { id: "case-lower", label: "lowercase", disabled: !hasText, action: () => commands.changeCase(store, "lower") },
            { id: "case-title", label: "Title Case", disabled: !hasText, action: () => commands.changeCase(store, "title") },
            { id: "case-sentence", label: "Sentence case", disabled: !hasText, action: () => commands.changeCase(store, "sentence") },
          ],
        },
        { id: "smart-punctuation", label: "Smart Punctuation", disabled: !hasText, action: () => commands.smartPunctuation(store) },
        { id: "type-sep", separator: true },
        { id: "to-area-type", label: "Convert to Area Type", disabled: !selectionHasPointText(store), action: () => commands.convertTextType(store, "area") },
        { id: "to-point-type", label: "Convert to Point Type", disabled: !selectionHasAreaText(store), action: () => commands.convertTextType(store, "point") },
      ],
    },
    {
      id: "effect",
      label: "Effect",
      items: [
        { id: "shadow", label: "Drop Shadow", disabled: !has, action: () => commands.applyEffect(store, "drop-shadow") },
        { id: "blur", label: "Gaussian Blur", disabled: !has, action: () => commands.applyEffect(store, "blur") },
        { id: "feather", label: "Feather", disabled: !has, action: () => commands.applyEffect(store, "feather") },
        { id: "glow", label: "Outer Glow", disabled: !has, action: () => commands.applyEffect(store, "glow") },
        { id: "inner-glow", label: "Inner Glow", disabled: !has, action: () => commands.applyEffect(store, "inner-glow") },
        { id: "scribble", label: "Scribble", disabled: !has, action: () => commands.scribble(store) },
        { id: "fx-round-corners", label: "Round Corners", disabled: !has, action: () => commands.roundCorners(store) },
        {
          id: "add-arrowheads",
          label: "Add Arrowheads",
          // One submenu per arrowhead style; each carries End / Start / Both Ends.
          // Triangle keeps the original arrow-end/start/both ids (default style).
          items: (
            [
              { style: "triangle", label: "Triangle", ids: ["arrow-end", "arrow-start", "arrow-both"] },
              { style: "circle", label: "Circle", ids: ["arrow-circle-end", "arrow-circle-start", "arrow-circle-both"] },
              { style: "square", label: "Square", ids: ["arrow-square-end", "arrow-square-start", "arrow-square-both"] },
              { style: "bar", label: "Bar", ids: ["arrow-bar-end", "arrow-bar-start", "arrow-bar-both"] },
            ] as const
          ).map((s) => ({
            id: `arrow-style-${s.style}`,
            label: s.label,
            items: [
              { id: s.ids[0], label: "End", disabled: !has, action: () => commands.addArrowheads(store, "end", s.style) },
              { id: s.ids[1], label: "Start", disabled: !has, action: () => commands.addArrowheads(store, "start", s.style) },
              { id: s.ids[2], label: "Both Ends", disabled: !has, action: () => commands.addArrowheads(store, "both", s.style) },
            ],
          })),
        },
        { id: "efsep0", separator: true },
        {
          id: "fx-convert-shape",
          label: "Convert to Shape",
          items: [
            { id: "fx-to-rect", label: "Rectangle", disabled: !has, action: () => commands.convertToShape(store, "rectangle") },
            { id: "fx-to-round-rect", label: "Rounded Rectangle", disabled: !has, action: () => commands.convertToShape(store, "rounded-rectangle") },
            { id: "fx-to-ellipse", label: "Ellipse", disabled: !has, action: () => commands.convertToShape(store, "ellipse") },
          ],
        },
        {
          id: "distort-transform",
          label: "Distort & Transform",
          items: [
            { id: "fx-free-distort", label: "Free Distort", disabled: !has, action: () => commands.freeDistort(store) },
            { id: "fx-pucker-bloat", label: "Pucker & Bloat", disabled: !has, action: () => commands.puckerBloat(store) },
            { id: "fx-roughen", label: "Roughen", disabled: !has, action: () => commands.roughen(store) },
            { id: "fx-tweak", label: "Tweak", disabled: !has, action: () => commands.tweak(store) },
            { id: "fx-twist", label: "Twist", disabled: !has, action: () => commands.twist(store) },
            { id: "fx-transform", label: "Transform", disabled: !has, action: () => commands.transformCopies(store) },
            { id: "fx-zigzag", label: "Zig Zag", disabled: !has, action: () => commands.zigZag(store) },
          ],
        },
        {
          id: "warp",
          label: "Warp",
          items: (Object.keys(WARP_LABELS) as WarpStyleKey[]).map((style) => ({
            id: `warp-${style}`,
            label: WARP_LABELS[style],
            disabled: !has,
            action: () => commands.warp(store, style),
          })),
        },
        { id: "sep", separator: true },
        { id: "clear", label: "Clear Effects", disabled: !has, action: () => commands.clearEffects(store) },
      ],
    },
    {
      id: "select",
      label: "Select",
      items: [
        { id: "all", label: "Select All", shortcut: "⌘A", action: () => commands.selectAll(store) },
        { id: "all-artboard", label: "All on Active Artboard", shortcut: "⌥⌘A", action: () => commands.selectAllOnActiveArtboard(store) },
        { id: "none", label: "Deselect", shortcut: "⇧⌘A", action: () => commands.deselectAll(store) },
        { id: "reselect", label: "Reselect", shortcut: "⌘6", disabled: !state.lastSelectQuery, action: () => commands.reselect(store) },
        { id: "inverse", label: "Inverse", disabled: !has, action: () => commands.selectInverse(store) },
        { id: "next-above", label: "Next Object Above", shortcut: "⌥⌘]", disabled: state.selection.length !== 1, action: () => commands.selectNextObject(store, "above") },
        { id: "next-below", label: "Next Object Below", shortcut: "⌥⌘[", disabled: state.selection.length !== 1, action: () => commands.selectNextObject(store, "below") },
        { id: "ssep", separator: true },
        {
          id: "same",
          label: "Same",
          items: [
            { id: "same-fill", label: "Fill Color", disabled: !has, action: () => commands.selectSame(store, "fill") },
            { id: "same-stroke", label: "Stroke Color", disabled: !has, action: () => commands.selectSame(store, "stroke") },
            { id: "same-weight", label: "Stroke Weight", disabled: !has, action: () => commands.selectSame(store, "stroke-weight") },
            { id: "same-opacity", label: "Opacity", disabled: !has, action: () => commands.selectSame(store, "opacity") },
            { id: "same-blend-mode", label: "Blending Mode", disabled: !has, action: () => commands.selectSame(store, "blend-mode") },
            { id: "same-fill-stroke", label: "Fill & Stroke", disabled: !has, action: () => commands.selectSame(store, "fill-stroke") },
            { id: "same-font-family", label: "Font Family", disabled: !hasText, action: () => commands.selectSame(store, "font-family") },
            { id: "same-font-style", label: "Font Family & Style", disabled: !hasText, action: () => commands.selectSame(store, "font-family-style") },
            { id: "same-font-size", label: "Font Size", disabled: !hasText, action: () => commands.selectSame(store, "font-size") },
            { id: "same-text-fill", label: "Text Fill Color", disabled: !hasText, action: () => commands.selectSame(store, "text-fill") },
          ],
        },
        {
          id: "object",
          label: "Object",
          items: [
            { id: "obj-same-layers", label: "All on Same Layers", disabled: !has, action: () => commands.selectSameLayers(store) },
            { id: "obj-text", label: "Text Objects", action: () => commands.selectObjects(store, "text") },
            { id: "obj-point-text", label: "Point Text Objects", action: () => commands.selectObjects(store, "point-text") },
            { id: "obj-area-text", label: "Area Text Objects", action: () => commands.selectObjects(store, "area-text") },
            { id: "obj-stray", label: "Stray Points", action: () => commands.selectObjects(store, "stray-points") },
            { id: "obj-clip", label: "Clipping Masks", action: () => commands.selectObjects(store, "clipping-masks") },
          ],
        },
        { id: "ssep2", separator: true },
        { id: "save-selection", label: "Save Selection", disabled: !has, action: () => commands.saveSelection(store) },
        // Saved selections list at the bottom of the Select menu (Illustrator parity).
        ...(state.savedSelections.length
          ? [
              { id: "ssep3", separator: true } as MenuItemDef,
              ...state.savedSelections.map(
                (sv): MenuItemDef => ({ id: `saved-${sv.id}`, label: sv.name, action: () => commands.applySavedSelection(store, sv.id) }),
              ),
            ]
          : []),
      ],
    },
    {
      id: "view",
      label: "View",
      items: [
        { id: "zin", label: "Zoom In", shortcut: "⌘+", action: () => commands.zoomIn(store) },
        { id: "zout", label: "Zoom Out", shortcut: "⌘-", action: () => commands.zoomOut(store) },
        { id: "fit", label: "Fit Artboard", shortcut: "⌘0", action: () => commands.zoomFit(store) },
        { id: "fitall", label: "Fit All in Window", shortcut: "⌥⌘0", action: () => commands.zoomFitAll(store) },
        { id: "actual", label: "Actual Size", shortcut: "⌘1", action: () => commands.zoomActual(store) },
        { id: "resetrot", label: "Reset Rotation", action: () => commands.resetRotation(store) },
        { id: "sep1", separator: true },
        { id: "outline", label: "Outline", checked: state.outlineMode, action: () => commands.toggleOutline(store) },
        { id: "trim-view", label: "Trim View", checked: state.trimView, action: () => commands.toggleTrimView(store) },
        { id: "hide-edges", label: "Hide Edges", shortcut: "⌘H", checked: state.hideEdges, action: () => commands.toggleHideEdges(store) },
        { id: "bounding-box", label: "Show Bounding Box", shortcut: "⇧⌘B", checked: state.showBoundingBox, action: () => commands.toggleBoundingBox(store) },
        { id: "rulers", label: "Rulers", shortcut: "⌘R", checked: state.rulers, action: () => commands.toggleRulers(store) },
        { id: "showguides", label: "Show Guides", shortcut: "⌘;", checked: state.showGuides, action: () => commands.toggleGuides(store) },
        { id: "make-guides", label: "Make Guides", shortcut: "⌘5", disabled: state.selection.length === 0, action: () => commands.makeGuides(store) },
        { id: "clearguides", label: "Clear Guides", disabled: state.guides.length === 0, action: () => commands.clearGuides(store) },
        { id: "grid", label: "Grid", shortcut: "⌘'", checked: state.grid.show, action: () => commands.toggleGrid(store) },
        { id: "transparency-grid", label: "Show Transparency Grid", shortcut: "⇧⌘D", checked: state.transparencyGrid, action: () => commands.toggleTransparencyGrid(store) },
        { id: "sep2", separator: true },
        { id: "snap", label: "Snap", checked: state.snap.enabled, action: () => commands.toggleSnap(store) },
        { id: "snapgrid", label: "Snap to Grid", shortcut: "⇧⌘'", checked: state.snap.toGrid, action: () => commands.toggleSnapGrid(store) },
        { id: "snappixel", label: "Snap to Pixel", checked: state.snap.toPixel, action: () => commands.toggleSnapPixel(store) },
        { id: "smartguides", label: "Smart Guides", shortcut: "⌘U", checked: state.snap.toPoint, action: () => commands.toggleSmartGuides(store) },
      ],
    },
    {
      id: "help",
      label: "Help",
      items: [{ id: "about", label: "About Monet Artisan", action: () => console.info("Monet Artisan — vector studio") }],
    },
  ];
}
