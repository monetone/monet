// Monet Jouer — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing action layer (commands.ts / state/app.ts).
//
// Keep these thin: they delegate to the same undo-wrapped verbs the UI uses, so
// MCP automation and the UI stay in lockstep. Parameters are scalars only
// (number / boolean / string / string-literal union) so the codegen can emit a
// clean JSON-Schema; commands prefer acting on the current selection or the
// active scene rather than taking opaque object ids.

import * as cmd from "../commands";
import { openProjectPath } from "../io/files";
import { store } from "../state/app";

// ── Document ──────────────────────────────────────────────────────────────────

/**
 * Open a `.jouer` project from disk, replacing the current one. Native desktop only.
 * @mcp doc.open
 * @param path Absolute path of the `.jouer` (or `.json`) project to open.
 */
export async function openDocument(path: string): Promise<string> {
  // No catch: a failed open has to reach the client as a tool error, not as an
  // "Opened …" string in front of the untouched previous project.
  await openProjectPath(path);
  return `Opened ${path}`;
}

// ── Objects ───────────────────────────────────────────────────────────────────

/**
 * Add a new game object of the given kind to the active scene (centred), and
 * select it.
 * @mcp object.add
 * @param kind The object kind to create.
 */
export function addObject(
  kind: "sprite" | "image" | "text" | "rectangle" | "ellipse" | "triangle" | "hexagon" | "hexagonFlat" | "diamond" | "capsule" | "container",
): string {
  cmd.addObject(kind);
  return `Added ${kind}`;
}

/**
 * Delete the current selection from the active scene.
 * @mcp object.delete
 */
export function deleteSelection(): string {
  cmd.deleteSelection();
  return "Deleted selection";
}

/**
 * Duplicate the current selection (offset by 16px) and select the copies.
 * @mcp object.duplicate
 */
export function duplicateSelection(): string {
  cmd.duplicateSelection();
  return "Duplicated selection";
}

/**
 * Wrap the current selection into a new container, preserving world positions.
 * @mcp object.group
 */
export function groupSelection(): string {
  cmd.groupSelection();
  return "Grouped selection";
}

/**
 * Align the selected objects to a shared edge or centre (needs 2+ selected).
 * @mcp object.align
 * @param edge The alignment edge.
 */
export function alignSelection(edge: "left" | "hcenter" | "right" | "top" | "vcenter" | "bottom"): string {
  cmd.alignSelection(edge);
  return `Aligned ${edge}`;
}

/**
 * Flip the selected objects horizontally or vertically (mirrors scale across the
 * selection's centre).
 * @mcp object.flip
 * @param axis The flip axis.
 */
export function flipSelection(axis: "horizontal" | "vertical"): string {
  cmd.flipSelection(axis);
  return `Flipped ${axis}`;
}

// ── Transform ─────────────────────────────────────────────────────────────────

/**
 * Translate every (unlocked) selected object by (dx, dy) world pixels.
 * @mcp transform.translate
 * @param dx Horizontal delta in pixels.
 * @param dy Vertical delta in pixels.
 */
export function translateSelection(dx: number, dy: number): string {
  cmd.translateSelection(dx, dy);
  return `Moved by (${dx}, ${dy})`;
}

/**
 * Reset the selection's transform to identity (position 0, rotation 0, scale 1);
 * origin and alpha are preserved.
 * @mcp transform.reset
 * @param target Which component(s) to reset.
 */
export function resetTransform(target: "all" | "position" | "rotation" | "scale" = "all"): string {
  cmd.resetTransform(target);
  return `Reset transform (${target})`;
}

/**
 * Snap each (unlocked) selected object's position to the current grid.
 * @mcp transform.snapToGrid
 */
export function snapSelectionToGrid(): string {
  cmd.snapSelectionToGrid();
  return "Snapped selection to grid";
}

// ── Selection ─────────────────────────────────────────────────────────────────

/**
 * Select every object in the active scene.
 * @mcp select.all
 */
export function selectAll(): string {
  cmd.selectAll();
  return "Selected all";
}

/**
 * Clear the selection.
 * @mcp select.none
 */
export function deselectAll(): string {
  cmd.deselectAll();
  return "Cleared selection";
}

/**
 * Select everything that isn't currently selected.
 * @mcp select.invert
 */
export function invertSelection(): string {
  cmd.invertSelection();
  return "Inverted selection";
}

/**
 * Replace the selection with the descendants of the selected containers.
 * @mcp select.children
 */
export function selectChildren(): string {
  cmd.selectChildren();
  return "Selected children";
}

// ── Scene ─────────────────────────────────────────────────────────────────────

/**
 * Add a new empty scene and make it active.
 * @mcp scene.add
 */
export function addScene(): string {
  cmd.addScene();
  return "Added scene";
}

// ── Tool + transport + view ─────────────────────────────────────────────────

/**
 * Set the active editing tool.
 * @mcp tool.set
 * @param tool The tool to activate.
 */
export function setTool(tool: "select" | "hand" | "rectangle" | "ellipse" | "sprite" | "image" | "text"): string {
  cmd.setTool(tool);
  return `Tool: ${tool}`;
}

/**
 * Play or pause the timeline.
 * @mcp transport.play
 * @param playing True to play, false to pause.
 */
export function setPlaying(playing: boolean): string {
  store.setPlaying(playing);
  return playing ? "Playing" : "Paused";
}

/**
 * Move the timeline playhead to a time in seconds (clamped to the timeline).
 * @mcp transport.seek
 * @param seconds Playhead position in seconds (0..).
 */
export function seek(seconds: number): string {
  store.setPlayhead(seconds);
  return `Playhead at ${seconds}s`;
}

/**
 * Step the playhead one frame forward or back (pauses playback first).
 * @mcp transport.step
 * @param forward Step forward when true, back when false.
 */
export function stepFrame(forward: boolean): string {
  cmd.stepFrame(forward ? 1 : -1);
  return `Stepped ${forward ? "forward" : "back"}`;
}

/**
 * Show or hide the editor grid.
 * @mcp view.grid
 * @param show True to show the grid, false to hide it.
 */
export function setShowGrid(show: boolean): string {
  store.setShowGrid(show);
  return show ? "Grid on" : "Grid off";
}

// ── History ───────────────────────────────────────────────────────────────────

/**
 * Undo the last document edit.
 * @mcp edit.undo
 */
export function undo(): string {
  cmd.undo();
  return "Undid last edit";
}

/**
 * Redo the last undone document edit.
 * @mcp edit.redo
 */
export function redo(): string {
  cmd.redo();
  return "Redid last edit";
}
