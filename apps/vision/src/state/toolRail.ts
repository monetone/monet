import type { ToolRailTool } from "@monet-ui/monet-react";
import type { ToolId } from "./store";

// Individual tool definitions, keyed by ToolId. Grouped into Photoshop-style
// flyout slots below so the rail shows ~17 slots instead of every tool at once
// (a slot with `children` is a flyout: it shows the active/last-used member, with
// a corner triangle; click selects it, right-click / long-press opens the flyout,
// Alt-click cycles). The grouping mirrors Adobe Photoshop's toolbar — only the
// tools Monet Vision actually has appear in each group.
export const TOOL_DEFS: Record<ToolId, ToolRailTool> = {
  move: { id: "move", name: "Move (V)", icon: "cursor", description: "Move layers, selections, and guides around the canvas." },
  marquee: { id: "marquee", name: "Rectangle Marquee (M)", icon: "marquee", description: "Select rectangular regions to edit, fill, or mask." },
  ellipse: { id: "ellipse", name: "Ellipse Marquee (M)", icon: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 1 0 0-11z", description: "Select elliptical and circular regions." },
  singlerow: { id: "singlerow", name: "Single Row Marquee", icon: "M2 7h12v2H2z", description: "Click to select a 1px-tall row across the full width." },
  singlecolumn: { id: "singlecolumn", name: "Single Column Marquee", icon: "M7 2h2v12H7z", description: "Click to select a 1px-wide column across the full height." },
  lasso: { id: "lasso", name: "Lasso (L)", icon: "lasso", description: "Draw a freehand selection by dragging around an area." },
  polylasso: { id: "polylasso", name: "Polygonal Lasso (L)", icon: "M2 12l4-8 5 3 3-5M2 12l5 1 4-4", description: "Click to place straight-edge selection corners; double-click to close." },
  magneticlasso: { id: "magneticlasso", name: "Magnetic Lasso (L)", icon: "M3 4v3a5 5 0 0 0 10 0V4M3 4h2.5M3 4v-1M13 4h-2.5M13 4v-1M6 11l-1.5 2.5M10 11l1.5 2.5M8 12v2.5", description: "Drag near a high-contrast edge and the selection snaps to and follows it." },
  wand: { id: "wand", name: "Magic Wand (W)", icon: "M3 13l6-6M10 3l.8 2.2L13 6l-2.2.8L10 9l-.8-2.2L7 6l2.2-.8z", description: "Select contiguous areas of similar color with one click." },
  quickselection: { id: "quickselection", name: "Quick Selection (W)", icon: "M2 12a4 4 0 004 4c2.2 0 3.6-1.6 5.5-3.8L14 9l-2-2-2.7 3C7.6 12 6 13 4 13M11 2.5l.6 1.6 1.6.6-1.6.6L11 7l-.6-1.7L8.8 4.7l1.6-.6z", description: "Paint to grow a selection over similar, contiguous areas — drag to add, Alt-drag to subtract." },
  objectselection: { id: "objectselection", name: "Object Selection (W)", icon: "M3 5h3M10 5h3M3 11h3M10 11h3M3 4v3M13 4v3M3 9v3M13 9v3M6.5 8l1.5 2 1.5-3 1 1", description: "Drag a box around an object; its distinct shape is selected automatically." },
  crop: { id: "crop", name: "Crop (C)", icon: "crop", description: "Trim the canvas down to a chosen region." },
  frame: { id: "frame", name: "Frame (K)", icon: "M2 3h12v10H2zM2 3l12 10M14 3L2 13", description: "Drag to create a placeholder frame, then drop or place an image to fill it (clipped to the frame)." },
  artboard: { id: "artboard", name: "Artboard (⇧V)", icon: "M2 5h12M2 5v8h12V5M5 2v3M11 2v3", description: "Drag empty canvas to create an artboard; click one to select, drag its body to move (with its layers), handles to resize, Delete to remove." },
  slice: { id: "slice", name: "Slice (C)", icon: "M2 2h12v12H2zM2 6h12M6 2v12", description: "Drag to draw rectangular slices that divide the image for web export." },
  sliceselect: { id: "sliceselect", name: "Slice Select (C)", icon: "M2 2h6v6H2zM10 4l5 2.2-2 .9 1.6 2.9-1.6.9-1.6-2.9-1.4 2z", description: "Select, move, and resize existing slices; press Delete to remove one." },
  brush: { id: "brush", name: "Brush (B)", icon: "brush", description: "Paint soft strokes with the foreground color." },
  pencil: { id: "pencil", name: "Pencil (B)", icon: "M3 13l1-3 7-7 2 2-7 7-3 1zM10.5 3.5l2 2", description: "Paint hard-edged, aliased strokes — crisp pixel-perfect lines, no soft edge." },
  colorreplace: { id: "colorreplace", name: "Color Replacement (B)", icon: "M3 13l6.5-6.5 3 3L6 16H3zM11.5 1.5a2.2 2.2 0 100 4.4 2.2 2.2 0 000-4.4z", description: "Recolor with the foreground while preserving each pixel's brightness/shading." },
  mixerbrush: { id: "mixerbrush", name: "Mixer Brush (B)", icon: "M4 12l6-6 2 2-6 6H4zM11 3l2 2M12.6 9.4c1 1.2 1.6 2.1 1.6 2.9a1.6 1.6 0 0 1-3.2 0c0-.8.6-1.7 1.6-2.9z", description: "Wet-media paint: blends the brush's paint reservoir with the canvas colors you drag through (Wet/Load/Mix)." },
  historybrush: { id: "historybrush", name: "History Brush (Y)", icon: "M13.5 7.5A5.5 5.5 0 1 1 12 3.7M13.5 3v3h-3M2 14l5-5 2 2-5 5H2z", description: "Paint to revert areas back to a saved history state — set the source in the History panel (Set Source), then brush over the changes to restore them." },
  erase: { id: "erase", name: "Eraser (E)", icon: "erase", description: "Erase pixels to transparency or the background color." },
  magiceraser: { id: "magiceraser", name: "Magic Eraser (E)", icon: "M2 12l6-6 4 4-6 6H4zM11 2l.7 1.8L13.5 4.5l-1.8.7L11 7l-.7-1.8L8.5 4.5l1.8-.7zM14 8l.5 1.2 1.2.5-1.2.5L14 11.4l-.5-1.2-1.2-.5 1.2-.5z", description: "Click to erase all similar-colored pixels to transparency in one step." },
  backgrounderaser: { id: "backgrounderaser", name: "Background Eraser (E)", icon: "M3 11l5-5 4 4-4 4H5zM10 3l3 3M2 14h5M9.5 13.5h.01M12 13.5h.01M14 13.5h.01", description: "Drag to erase pixels matching the sampled background color to transparency, keeping the foreground." },
  clone: { id: "clone", name: "Clone Stamp (S)", icon: "clone", description: "Paint with pixels copied from elsewhere. Alt-click to set the source." },
  vanishingpoint: { id: "vanishingpoint", name: "Vanishing Point", icon: "M2 12l12-4L2 4v8zM2 4l6 4-6 4M8 8h6", description: "Clone through a perspective plane. Alt-click to set the plane source." },
  patternstamp: { id: "patternstamp", name: "Pattern Stamp (S)", icon: "M5 2h6v2l1 4H4l1-4zM4 11h8v3H4zM6 4h1v1H6zM9 4h1v1H9zM7 6h1v1H7z", description: "Paint with the defined pattern (Edit ▸ Define Pattern), tiled across the canvas." },
  heal: { id: "heal", name: "Healing Brush (J)", icon: "M6 4l6 6a2 2 0 0 1-3 3L3 7a2 2 0 0 1 3-3zM5 6l5 5", description: "Blend sampled pixels to remove blemishes seamlessly. Alt-click to set the source." },
  spothealing: { id: "spothealing", name: "Spot Healing Brush (J)", icon: "M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM5.5 8L7 9.5 10.5 6", description: "Remove blemishes by content-aware sampling of the surroundings — no source needed. Click or drag over a spot." },
  remove: { id: "remove", name: "Remove (J)", icon: "M4 4l8 8M12 4l-8 8M2.5 8a5.5 5.5 0 1 1 11 0 5.5 5.5 0 0 1-11 0z", description: "Brush over a distraction — wires, blemishes, people — and release to erase it with content-aware fill." },
  redeye: { id: "redeye", name: "Red Eye (J)", icon: "M1 8s2.6-4.5 7-4.5S15 8 15 8s-2.6 4.5-7 4.5S1 8 1 8zM8 5.5a2.5 2.5 0 100 5 2.5 2.5 0 000-5z", description: "Remove red-eye from flash photos: drag a rectangle over the eye." },
  patch: { id: "patch", name: "Patch (J)", icon: "M3 5.5C3 4 4 3 5.5 3h5C12 3 13 4 13 5.5v5c0 1.5-1 2.5-2.5 2.5h-5C4 13 3 12 3 10.5zM3 8h10M8 3v10", description: "Make a selection, then drag it over a clean area to heal the selection with that texture." },
  contentawaremove: { id: "contentawaremove", name: "Content-Aware Move (J)", icon: "M8 1.5l2 2.5H8.8v3.3H12V6l2.5 2-2.5 2V8.8H8.8V12H10l-2 2.5L6 12h1.2V8.8H4V10L1.5 8 4 6v1.2h3.2V4H6z", description: "Make a selection, then drag its contents to a new spot — the object moves and the source is content-aware-filled." },
  dodge: { id: "dodge", name: "Dodge (O)", icon: "M8 5v-2M8 13v-2M5 8H3M13 8h-2M5.2 5.2 4 4M12 12l-1.2-1.2M5.2 10.8 4 12M12 4l-1.2 1.2M8 5.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5z", description: "Lighten areas of the image as you brush over them." },
  burn: { id: "burn", name: "Burn (O)", icon: "M8 2c3 4 4.5 6 4.5 8a4.5 4.5 0 0 1-9 0C3.5 8 5 6 8 2z", description: "Darken areas of the image as you brush over them." },
  sponge: { id: "sponge", name: "Sponge (O)", icon: "M4 8.5c0-2 1.8-3 4-3s4 1 4 3v3.5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1zM5.5 9h.01M7.5 8h.01M9.5 9h.01M8 10.5h.01M10.5 10h.01", description: "Brush to saturate or desaturate (intensify or wash out) the colors you paint over." },
  adjustmentbrush: { id: "adjustmentbrush", name: "Adjustment Brush", icon: "M3 11l6-6 2 2-6 6H3v-2zM9 5l1.6-1.6a1.4 1.4 0 0 1 2 2L11 7M11.5 11.5h2.5M12.75 10.25v2.5", description: "Brush a local, non-destructive adjustment onto the image — strokes reveal a hidden adjustment-layer mask where you paint." },
  smudge: { id: "smudge", name: "Smudge", icon: "M8 3c2 3 3.2 4.4 3.2 6.2a3.2 3.2 0 0 1-6.4 0C4.8 7.4 6 6 8 3zM4.5 13c2 1.2 4.5 1.2 7 0", description: "Push and smear pixels as if dragging through wet paint." },
  liquify: { id: "liquify", name: "Liquify", icon: "M8 2c1.6 2.2 2.6 3.6 2.6 5a2.6 2.6 0 0 1-5.2 0c0-1.4 1-2.8 2.6-5zM3 11c1.7 1.4 3.3 2 5 2s3.3-.6 5-2M3 13.5c1.7 1.4 3.3 2 5 2s3.3-.6 5-2", description: "Forward-warp brush: push, bloat, pucker, twirl or reconstruct pixels like wet paint (Filter ▸ Liquify)." },
  blur: { id: "blur", name: "Blur", icon: "M8 2.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM8 5.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z", description: "Brush to soften and blur the areas you paint over." },
  sharpen: { id: "sharpen", name: "Sharpen", icon: "M8 2l5 11H3zM8 6.5v4M8 12h.01", description: "Brush to increase contrast at the edges you paint over, sharpening detail." },
  bucket: { id: "bucket", name: "Paint Bucket (G)", icon: "M7 2v4L3 10l5 5 5-5-4-4V2zM13 12c0 1 1 2 1 2s1-1 1-2-1-2-1-2z", description: "Flood-fill an area with the foreground color." },
  gradient: { id: "gradient", name: "Gradient (G)", icon: "gradient", description: "Blend between colors across a dragged line." },
  shape: { id: "shape", name: "Shape (U)", icon: "shape", description: "Draw vector rectangles, ellipses, and custom shapes." },
  pen: { id: "pen", name: "Pen (P)", icon: "pen", description: "Draw precise vector paths point by point. Double-click to fill." },
  freeformpen: { id: "freeformpen", name: "Freeform Pen (P)", icon: "M2 13c3-1 4-6 7-7s4 3 5 1M3.5 12.5l-1.5 1 .6-1.8", description: "Drag to draw a freehand path; release to fill it with the foreground color." },
  curvaturepen: { id: "curvaturepen", name: "Curvature Pen (P)", icon: "M2 12c2 0 3-7 6-7s4 7 6 7M5 12h.01M11 12h.01", description: "Draw curves by clicking points; the path bends smoothly through them. Double-click or Enter to finish." },
  directselect: { id: "directselect", name: "Direct Selection (A)", icon: "M4 3l0 11 3-3 2 4 2-1-2-4 4 0z", description: "Drag a path's anchor points to reshape it." },
  addanchor: { id: "addanchor", name: "Add Anchor Point", icon: "pen", description: "Click a path segment to insert an anchor point without changing the shape." },
  deleteanchor: { id: "deleteanchor", name: "Delete Anchor Point", icon: "pen", description: "Click an anchor point to remove it." },
  convertpoint: { id: "convertpoint", name: "Convert Point", icon: "pen", description: "Click an anchor to toggle smooth ⇄ corner." },
  pathselect: { id: "pathselect", name: "Path Selection (A)", icon: "M3 2l0 13 3.6-3.6 2 4.4 2.2-1-2-4.4 4.6 0z", description: "Drag a whole path to move it." },
  text: { id: "text", name: "Horizontal Type (T)", icon: "text", description: "Add and edit horizontal type layers." },
  verticaltype: { id: "verticaltype", name: "Vertical Type (T)", icon: "M4 3h8M8 3v10M5 13h6", description: "Add and edit type laid out top-to-bottom in vertical columns." },
  horizontaltypemask: { id: "horizontaltypemask", name: "Horizontal Type Mask (T)", icon: "M3 3h10M8 3v8M2 14.5h1.5M6.25 14.5h1.5M10.5 14.5h1.5", description: "Type to create a selection in the shape of the text (a type mask), not a layer." },
  verticaltypemask: { id: "verticaltypemask", name: "Vertical Type Mask (T)", icon: "M4 3h7M7.5 3v8M2.5 14h1.5M6 14h1.5M9.5 14h1.5", description: "Type a top-to-bottom selection in the shape of the text (a vertical type mask)." },
  dropper: { id: "dropper", name: "Eyedropper (I)", icon: "dropper", description: "Sample a color from the canvas as the foreground color." },
  colorsampler: { id: "colorsampler", name: "Color Sampler (I)", icon: "M8 1v4M8 11v4M1 8h4M11 8h4M8 5.2a2.8 2.8 0 100 5.6 2.8 2.8 0 000-5.6z", description: "Place up to 10 sample points and watch their colors in the Info panel." },
  ruler: { id: "ruler", name: "Ruler (I)", icon: "M2 10l4-4 1.5 1.5L9 6l1.5 1.5L12 6l2 2-4 4zM4 12l8-8", description: "Measure distances and angles by dragging across the image." },
  count: { id: "count", name: "Count (I)", icon: "M4 4h8v8H4zM6 6h1M6 8h2M6 10h3", description: "Tally items by clicking to drop numbered markers." },
  note: { id: "note", name: "Note (I)", icon: "M3 3h10v7l-3 3H3zM10 13v-3h3M5 6h6M5 8.5h4", description: "Attach annotation notes to the image; edit them in the Notes panel." },
  hand: { id: "hand", name: "Hand (H)", icon: "hand", description: "Pan around the document." },
  rotateview: { id: "rotateview", name: "Rotate View (R)", icon: "M13 8a5 5 0 1 1-1.5-3.5M13 2v3h-3", description: "Drag to rotate the canvas view non-destructively (the pixels are unchanged)." },
  zoom: { id: "zoom", name: "Zoom (Z)", icon: "zoom", description: "Zoom the view in and out." },
};

/** A flyout-group slot: shows its default (first) member's icon as a fallback,
 *  holds the related tools as children. `id` is a stable key, never selected. */
const group = (id: string, name: string, members: ToolId[]): ToolRailTool => ({
  id, name, icon: TOOL_DEFS[members[0]].icon, children: members.map((m) => TOOL_DEFS[m]),
});

// Photoshop-style toolbar: related tools collapse into one flyout slot. ~17 slots
// + 2 dividers instead of 33 buttons. Selection tools · retouch/paint/vector ·
// nav/measure, matching Photoshop's grouping (every Vision tool stays reachable).
export const TOOLS: Array<ToolRailTool | "div"> = [
  TOOL_DEFS.move,
  group("grp-marquee", "Marquee", ["marquee", "ellipse", "singlerow", "singlecolumn"]),
  group("grp-lasso", "Lasso", ["lasso", "polylasso", "magneticlasso"]),
  group("grp-wand", "Magic Wand", ["wand", "quickselection", "objectselection"]),
  group("grp-crop", "Crop", ["crop", "slice", "sliceselect"]),
  TOOL_DEFS.frame,
  TOOL_DEFS.artboard,
  "div",
  group("grp-healing", "Healing Brush", ["remove", "spothealing", "heal", "patch", "contentawaremove", "redeye"]),
  group("grp-brush", "Brush", ["brush", "pencil", "colorreplace", "mixerbrush", "adjustmentbrush"]),
  group("grp-clone", "Clone Stamp", ["clone", "vanishingpoint", "patternstamp"]),
  group("grp-history", "History Brush", ["historybrush"]),
  group("grp-eraser", "Eraser", ["erase", "backgrounderaser", "magiceraser"]),
  group("grp-dodge", "Dodge", ["dodge", "burn", "sponge"]),
  group("grp-focus", "Blur", ["blur", "sharpen", "smudge", "liquify"]),
  group("grp-gradient", "Gradient", ["gradient", "bucket"]),
  TOOL_DEFS.shape,
  // Photoshop's Pen flyout holds the three point tools; Path Selection is its
  // own slot (and its own ⇧A group). Leaving the point tools out of the rail
  // made them reachable only by ⇧P cycling, with no slot to light up (#502).
  group("grp-pen", "Pen", ["pen", "freeformpen", "curvaturepen", "addanchor", "deleteanchor", "convertpoint"]),
  group("grp-type", "Type", ["text", "verticaltype", "horizontaltypemask", "verticaltypemask"]),
  group("grp-pathselect", "Path Selection", ["pathselect", "directselect"]),
  "div",
  group("grp-eyedropper", "Eyedropper", ["dropper", "colorsampler", "ruler", "count", "note"]),
  group("grp-hand", "Hand", ["hand", "rotateview"]),
  TOOL_DEFS.zoom,
];

export interface ToolbarConfiguration {
  version: 1;
  slots: Array<ToolId[] | "div">;
  extra: ToolId[];
}

export function factoryToolbarConfiguration(): ToolbarConfiguration {
  return { version: 1, slots: TOOLS.map((entry) => entry === "div" ? "div" : (entry.children ?? [entry]).map((tool) => tool.id as ToolId)), extra: [] };
}

/** Every tool occurs exactly once, including tools behind Extra Tools. A saved
 *  configuration can predate a tool: it rejoins its factory group when a member
 *  of that group is still in a slot, otherwise Extra Tools. Tools Vision no
 *  longer has are dropped. Only malformed data throws. */
export function validateToolbarConfiguration(value: unknown): ToolbarConfiguration {
  if (!value || typeof value !== "object") throw new Error("Toolbar configuration must contain slots and Extra Tools.");
  const config = value as Partial<ToolbarConfiguration>;
  if (config.version !== 1 || !Array.isArray(config.slots) || !Array.isArray(config.extra)
    || config.slots.length > Object.keys(TOOL_DEFS).length * 2
    || config.slots.some((slot) => slot !== "div" && (!Array.isArray(slot) || !slot.length))) {
    throw new Error("Unsupported toolbar configuration. Restore Defaults or use version 1 with nonempty tool groups.");
  }
  const seen = new Set<string>();
  for (const id of [...config.slots.flatMap((slot) => slot === "div" ? [] : slot), ...config.extra]) {
    if (typeof id !== "string") throw new Error(`Unknown toolbar tool “${String(id)}”. Use an existing Vision tool.`);
    if (seen.has(id)) throw new Error(`Toolbar tool “${id}” occurs more than once. Move it instead of duplicating it.`);
    seen.add(id);
  }
  const known = (id: string): id is ToolId => Object.hasOwn(TOOL_DEFS, id);
  const slots = config.slots.map((slot) => slot === "div" ? slot : slot.filter(known)).filter((slot) => slot === "div" || slot.length);
  const extra = config.extra.filter(known);
  for (const members of factoryToolbarConfiguration().slots) {
    if (members === "div") continue;
    members.forEach((id, index) => {
      if (seen.has(id)) return;
      seen.add(id);
      const slot = slots.find((s): s is ToolId[] => s !== "div" && s.some((m) => members.includes(m)));
      if (!slot) { extra.push(id); return; }
      const before = members.slice(0, index).reverse().find((m) => slot.includes(m));
      slot.splice(before ? slot.indexOf(before) + 1 : 0, 0, id);
    });
  }
  return { version: 1, slots, extra };
}

/** A workspace or preference saved before the toolbar became customizable
 *  carries no configuration — those fall back to the factory rail. */
export function configuredToolRail(config: ToolbarConfiguration | undefined): Array<ToolRailTool | "div"> {
  const slots = config?.slots;
  if (!slots) return TOOLS;
  return slots.map((slot) => {
    if (slot === "div") return slot;
    const original = TOOLS.find((entry) => entry !== "div"
      && (entry.children ?? [entry]).map((tool) => tool.id).join(",") === slot.join(","));
    if (original) return original;
    const first = TOOL_DEFS[slot[0]];
    return slot.length === 1 ? first : { id: `custom-${slot[0]}`, name: `${first.name} tools`, icon: first.icon, children: slot.map((id) => TOOL_DEFS[id]) };
  });
}

function removeEmptySlots(config: ToolbarConfiguration): ToolbarConfiguration {
  const slots: ToolbarConfiguration["slots"] = [];
  for (const slot of config.slots) {
    if (slot === "div" ? slots.length && slots.at(-1) !== "div" : slot.length) slots.push(slot);
  }
  if (slots.at(-1) === "div") slots.pop();
  return { ...config, slots };
}

/** Omit position to create a new slot; provide it to join/reorder a group.
 *  Indices refer to the original configuration, before removing the tool. */
export function moveToolbarTool(config: ToolbarConfiguration, tool: ToolId, destination: number | "extra", position?: number): ToolbarConfiguration {
  const next = validateToolbarConfiguration(config);
  if (!Object.hasOwn(TOOL_DEFS, tool)) throw new Error("Choose an existing tool to move.");
  const source = config.slots.findIndex((slot) => slot !== "div" && slot.includes(tool));
  const sourceTools = source < 0 ? config.extra : config.slots[source] as ToolId[];
  const sourcePosition = sourceTools.indexOf(tool);
  if (source < 0) next.extra = next.extra.filter((id) => id !== tool);
  else next.slots[source] = sourceTools.filter((id) => id !== tool);
  if (destination === "extra") {
    const at = position ?? config.extra.length;
    if (!Number.isInteger(at) || at < 0 || at > config.extra.length) throw new Error("Choose a valid Extra Tools position.");
    next.extra.splice(at - (source < 0 && sourcePosition < at ? 1 : 0), 0, tool);
  } else {
    if (!Number.isInteger(destination) || destination < 0 || destination > next.slots.length) throw new Error("Choose a valid toolbar slot.");
    if (position === undefined) next.slots.splice(destination, 0, [tool]);
    else {
      const group = next.slots[destination];
      const originalGroup = config.slots[destination];
      if (!Array.isArray(group) || !Array.isArray(originalGroup) || !Number.isInteger(position) || position < 0 || position > originalGroup.length) throw new Error("Choose a valid position in a tool group.");
      group.splice(position - (source === destination && sourcePosition < position ? 1 : 0), 0, tool);
    }
  }
  return removeEmptySlots(next);
}

export function moveToolbarSlot(config: ToolbarConfiguration, from: number, to: number): ToolbarConfiguration {
  const next = validateToolbarConfiguration(config);
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || from >= next.slots.length || to < 0 || to > next.slots.length) throw new Error("Choose an existing tool group and a valid destination.");
  const [slot] = next.slots.splice(from, 1);
  next.slots.splice(to - (from < to ? 1 : 0), 0, slot);
  return removeEmptySlots(next);
}
