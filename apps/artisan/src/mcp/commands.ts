// Monet Artisan — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing action layer (commands.ts).
//
// Keep these thin: they delegate to the same `commands.*` action object the UI
// uses, bound to the live `store` singleton, so MCP automation and the UI stay
// in lockstep. Most of these act on the current selection / active layer, so no
// object ids are needed — drive a selection from the UI first.

import { commands } from "../commands";
import { fileCommands } from "../io/commands";
import { store } from "../state/app";

// Param unions are written INLINE (not via the `AlignAction` / `PathfinderOp` /
// `BlendMode` aliases) so the MCP codegen — which reads the syntactic type node,
// not the type checker — emits a proper string `enum` schema. Each inline union
// mirrors its alias exactly and stays assignable to it when passed to commands.*.
type AlignActionArg =
  | "left" | "center-h" | "right"
  | "top" | "middle-v" | "bottom"
  | "dist-h" | "dist-v"
  | "dist-center-h" | "dist-center-v"
  | "dist-left" | "dist-right" | "dist-top" | "dist-bottom";

type PathfinderOpArg =
  | "unite" | "minus-front" | "intersect" | "exclude" | "minus-back"
  | "divide" | "trim" | "merge" | "crop" | "outline";

type BlendModeArg =
  | "normal" | "multiply" | "screen" | "overlay" | "darken" | "lighten"
  | "color-dodge" | "color-burn" | "hard-light" | "soft-light"
  | "difference" | "exclusion" | "hue" | "saturation" | "color" | "luminosity";

const sameIds = (a: string[], b: string[]): boolean => a.length === b.length && a.every((id, index) => id === b[index]);

const documentChange = (action: () => void, success: string, refusal: string): string => {
  const before = store.doc;
  action();
  if (store.doc === before) throw new Error(refusal);
  return success;
};

const selectionChange = (action: () => void, success: string, refusal: string): string => {
  const before = store.getState().selection;
  action();
  if (sameIds(store.getState().selection, before)) throw new Error(refusal);
  return success;
};

// ── Document ─────────────────────────────────────────────────────────────────

/**
 * Open a document from disk, replacing the current one — the same loader File ▸ Open uses (.mart and any Monet container, .svg/.svgz, .ai/.eps/.ps, .pdf, .cdr). Native desktop only.
 * @mcp doc.open
 * @param path Absolute path of the file to open.
 */
export async function openDocument(path: string): Promise<string> {
  if (!(await fileCommands.openPath(store, path))) {
    throw new Error("Open cancelled to preserve unsaved changes");
  }
  return `Opened ${path}`;
}

// ── Selection ────────────────────────────────────────────────────────────────

/**
 * Select every selectable object in the document.
 * @mcp select.all
 */
export function selectAll(): string {
  return selectionChange(() => commands.selectAll(store), "Selected all objects", "No additional selectable objects are available");
}

/**
 * Deselect everything.
 * @mcp select.none
 */
export function deselectAll(): string {
  return selectionChange(() => commands.deselectAll(store), "Deselected all", "Nothing is selected");
}

/**
 * Invert the selection — select every selectable object that isn't selected.
 * @mcp select.inverse
 */
export function selectInverse(): string {
  return selectionChange(() => commands.selectInverse(store), "Inverted the selection", "Inverting the selection would not change it");
}

// ── Layers ───────────────────────────────────────────────────────────────────

/**
 * Add a new empty layer above the active one and make it active.
 * @mcp layer.add
 */
export function newLayer(): string {
  return documentChange(() => commands.newLayer(store), "Added a new layer", "A new layer could not be added");
}

/**
 * Duplicate the active layer (and its items) above it.
 * @mcp layer.duplicate
 */
export function duplicateLayer(): string {
  return documentChange(() => commands.duplicateLayer(store), "Duplicated the active layer", "There is no active layer to duplicate");
}

/**
 * Delete the active layer and its items (never the last remaining layer).
 * @mcp layer.delete
 */
export function deleteLayer(): string {
  return documentChange(() => commands.deleteLayer(store), "Deleted the active layer", "The last remaining layer cannot be deleted");
}

/**
 * Flatten all layers into the active one, preserving stacking order.
 * @mcp layer.flatten
 */
export function flattenArtwork(): string {
  return documentChange(() => commands.flattenArtwork(store), "Flattened artwork", "Flattening needs more than one layer");
}

// ── Object ───────────────────────────────────────────────────────────────────

/**
 * Delete the selected objects.
 * @mcp object.delete
 */
export function deleteSelection(): string {
  return documentChange(() => commands.delete(store), "Deleted the selection", "Deleting needs a selected object");
}

/**
 * Duplicate the selected objects in place.
 * @mcp object.duplicate
 */
export function duplicateSelection(): string {
  return documentChange(() => commands.duplicate(store), "Duplicated the selection", "Duplicating needs a selected object");
}

/**
 * Group the selected objects (needs 2 or more).
 * @mcp object.group
 */
export function group(): string {
  return documentChange(() => commands.group(store), "Grouped the selection", "Grouping needs two or more selected objects");
}

/**
 * Ungroup the selected groups.
 * @mcp object.ungroup
 */
export function ungroup(): string {
  return documentChange(() => commands.ungroup(store), "Ungrouped the selection", "Ungrouping needs a selected group");
}

/**
 * Expand the selection — convert live shapes to paths and outline strokes.
 * @mcp object.expand
 */
export function expand(): string {
  return documentChange(() => commands.expand(store), "Expanded the selection", "The selection has no expandable artwork");
}

// ── Arrange (z-order) ─────────────────────────────────────────────────────────

/**
 * Bring the selection to the front of its stack.
 * @mcp arrange.bringToFront
 */
export function bringToFront(): string {
  return documentChange(() => commands.bringToFront(store), "Brought to front", "The selection cannot move further forward");
}

/**
 * Bring the selection forward one step.
 * @mcp arrange.bringForward
 */
export function bringForward(): string {
  return documentChange(() => commands.bringForward(store), "Brought forward", "The selection cannot move further forward");
}

/**
 * Send the selection backward one step.
 * @mcp arrange.sendBackward
 */
export function sendBackward(): string {
  return documentChange(() => commands.sendBackward(store), "Sent backward", "The selection cannot move further backward");
}

/**
 * Send the selection to the back of its stack.
 * @mcp arrange.sendToBack
 */
export function sendToBack(): string {
  return documentChange(() => commands.sendToBack(store), "Sent to back", "The selection cannot move further backward");
}

// ── Align ─────────────────────────────────────────────────────────────────────

/**
 * Align or distribute the selected objects.
 * @mcp align.apply
 * @param action One of: left, center-h, right, top, middle-v, bottom, dist-h, dist-v, dist-center-h, dist-center-v, dist-left, dist-right, dist-top, dist-bottom.
 * @param relativeTo Align relative to the selection bounds or the active artboard.
 */
export function align(action: AlignActionArg, relativeTo: "selection" | "artboard" = "selection"): string {
  return documentChange(
    () => commands.align(store, action, relativeTo),
    `Aligned ${action} (relative to ${relativeTo})`,
    "Alignment needs an applicable selection",
  );
}

// ── Transform ─────────────────────────────────────────────────────────────────

/**
 * Rotate the selection 90 degrees clockwise around its centre.
 * @mcp transform.rotate90Cw
 */
export function rotate90CW(): string {
  return documentChange(() => commands.rotate90CW(store), "Rotated 90° CW", "Rotation needs a selected object");
}

/**
 * Rotate the selection 90 degrees counter-clockwise around its centre.
 * @mcp transform.rotate90Ccw
 */
export function rotate90CCW(): string {
  return documentChange(() => commands.rotate90CCW(store), "Rotated 90° CCW", "Rotation needs a selected object");
}

/**
 * Reflect (mirror) the selection horizontally about its centre.
 * @mcp transform.reflectHorizontal
 */
export function reflectHorizontal(): string {
  return documentChange(() => commands.reflectHorizontal(store), "Reflected horizontally", "Reflection needs a selected object");
}

/**
 * Reflect (mirror) the selection vertically about its centre.
 * @mcp transform.reflectVertical
 */
export function reflectVertical(): string {
  return documentChange(() => commands.reflectVertical(store), "Reflected vertically", "Reflection needs a selected object");
}

// ── Path ──────────────────────────────────────────────────────────────────────

/**
 * Create an offset copy of each selected object.
 * @mcp path.offset
 * @param distance Offset distance in points; negative insets (-1000..1000).
 */
export function offsetPath(distance = 10): string {
  return documentChange(() => commands.offsetPath(store, { distance }), `Offset path by ${distance}`, "Offset Path needs selected path artwork");
}

/**
 * Round the sharp corners of each selected object into circular fillets.
 * @mcp path.roundCorners
 * @param radius Corner radius in points (0..1000).
 */
export function roundCorners(radius = 10): string {
  return documentChange(() => commands.roundCorners(store, radius), `Rounded corners r=${radius}`, "Round Corners needs selected artwork with eligible corners");
}

/**
 * Reduce the anchor count of each selected path while keeping its shape.
 * @mcp path.simplify
 * @param tolerance Simplification tolerance in points; higher removes more (0..100).
 */
export function simplify(tolerance = 2): string {
  return documentChange(() => commands.simplify(store, tolerance), `Simplified (tolerance ${tolerance})`, "Simplify needs a selected path that would change");
}

/**
 * Outline the strokes of the selection into filled paths.
 * @mcp path.outlineStroke
 */
export function outlineStroke(): string {
  return documentChange(() => commands.outlineStroke(store), "Outlined strokes", "Outline Stroke needs selected artwork with a visible stroke");
}

/**
 * Reverse the direction of each selected path.
 * @mcp path.reverse
 */
export function reversePath(): string {
  return documentChange(() => commands.reversePath(store), "Reversed path direction", "Reverse Path needs selected path artwork");
}

// ── Pathfinder ────────────────────────────────────────────────────────────────

/**
 * Combine the selected objects (2 or more) with a Pathfinder operation.
 * @mcp pathfinder.apply
 * @param op One of: unite, minus-front, intersect, exclude, minus-back, divide, trim, merge, crop, outline.
 */
export function pathfinder(op: PathfinderOpArg): string {
  return documentChange(() => commands.pathfinder(store, op), `Applied Pathfinder ${op}`, "Pathfinder needs two or more applicable selected objects");
}

// ── Transparency ──────────────────────────────────────────────────────────────

/**
 * Set the blend mode on the selection.
 * @mcp transparency.blendMode
 * @param mode One of: normal, multiply, screen, overlay, darken, lighten, color-dodge, color-burn, hard-light, soft-light, difference, exclusion, hue, saturation, color, luminosity.
 */
export function setBlendMode(mode: BlendModeArg): string {
  return documentChange(() => commands.setBlendMode(store, mode), `Set blend mode to ${mode}`, "Blend Mode needs a selection and a different mode");
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * Undo the last change.
 * @mcp edit.undo
 */
export function undo(): string {
  return documentChange(() => commands.undo(store), "Undid the last change", "There is nothing to undo");
}

/**
 * Redo the last undone change.
 * @mcp edit.redo
 */
export function redo(): string {
  return documentChange(() => commands.redo(store), "Redid the last change", "There is nothing to redo");
}
