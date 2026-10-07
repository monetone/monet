// Monet Anime — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing action layer (src/commands.ts).
//
// Keep these thin: they delegate to the same command verbs the UI calls, so MCP
// automation and the UI stay in lockstep. Anime has no window global and most
// edits target a specific layer by id; these wrappers expose only scalar params
// and resolve the *currently selected* layer from the store, so an MCP client
// can drive the active selection without juggling ids.

import * as cmd from "../commands";
import { importImagePath, openDocumentPath } from "../io/files";
import type { EffectKind, LayerKind, TrackProperty } from "../model/types";
import { activeComp, findLayer } from "../model/query";
import { store } from "../state/store";

// Resolve the currently selected layer's id, or throw a clear error so the tool
// result tells the client to select a layer first.
function selectedLayerId(): string {
  const id = store.getState().selection[0];
  if (!id) throw new Error("No layer selected — select a layer first");
  return id;
}

function selectedLayerName(id: string): string {
  const layer = findLayer(activeComp(store.getState().project), id);
  return layer?.name ?? id;
}

// ── Document ──────────────────────────────────────────────────────────────────

/**
 * Open a `.mani` (or any Monet container) document from disk, replacing the current project. Native desktop only; use `layer.addImage` to bring in an image instead.
 * @mcp doc.open
 * @param path Absolute path of the `.mani` (or any Monet container) document to open.
 */
export async function openDocument(path: string): Promise<string> {
  // No catch: a foreign or future-schema file must come back as a tool error,
  // not as "Opened …" over the untouched previous project.
  await openDocumentPath(path);
  return `Opened ${path}`;
}

// ── Layers ────────────────────────────────────────────────────────────────────

/**
 * Add a new layer of the given kind and select it.
 * @mcp layer.add
 * @param kind Layer kind to create.
 */
export function addLayer(kind: LayerKind): string {
  cmd.addLayer(kind);
  return `Added ${kind} layer`;
}

/**
 * Add an image layer from a file on disk (no dialog) and select it. The image
 * is embedded as a data URL, so it travels inside the saved `.mani` container.
 * @mcp layer.addImage
 * @param path Absolute path to an image file (png, jpg, jpeg, gif, webp, bmp, avif, svg).
 */
export async function addImage(path: string): Promise<string> {
  await importImagePath(path);
  return `Added image layer from ${path}`;
}

/**
 * Delete the currently selected layer(s).
 * @mcp layer.deleteSelected
 */
export function deleteSelected(): string {
  cmd.deleteSelected();
  return "Deleted selected layer(s)";
}

// ── Transform (operates on the selected layer) ─────────────────────────────────

/**
 * Set a transform property on the selected layer. If the property is animated
 * this writes a keyframe at the playhead, otherwise it sets the static value.
 * @mcp layer.setTransform
 * @param prop Transform property to set.
 * @param value New value (px for position/anchor, percent for scale, degrees for rotation, 0..100 for opacity).
 */
export function setTransform(prop: TrackProperty, value: number): string {
  const id = selectedLayerId();
  cmd.setTransformValue(id, prop, value);
  return `Set ${prop}=${value} on "${selectedLayerName(id)}"`;
}

/**
 * Set the opacity of the selected layer (0..100).
 * @mcp layer.setOpacity
 * @param opacity Opacity percent (0..100).
 */
export function setOpacity(opacity: number): string {
  const id = selectedLayerId();
  cmd.setTransformValue(id, "opacity", opacity);
  return `Set opacity=${opacity} on "${selectedLayerName(id)}"`;
}

/**
 * Set the rotation of the selected layer in degrees.
 * @mcp layer.setRotation
 * @param degrees Rotation in degrees (-3600..3600).
 */
export function setRotation(degrees: number): string {
  const id = selectedLayerId();
  cmd.setTransformValue(id, "rotation", degrees);
  return `Set rotation=${degrees}° on "${selectedLayerName(id)}"`;
}

/**
 * Toggle keyframe animation (the stopwatch) for a transform property on the
 * selected layer.
 * @mcp layer.toggleAnimation
 * @param prop Transform property to toggle animation for.
 */
export function toggleAnimation(prop: TrackProperty): string {
  const id = selectedLayerId();
  cmd.toggleAnimation(id, prop);
  return `Toggled animation for ${prop} on "${selectedLayerName(id)}"`;
}

/**
 * Add a keyframe at the playhead for one transform property on the selected layer.
 * @mcp layer.keyProperty
 * @param prop Transform property to key.
 */
export function keyProperty(prop: TrackProperty): string {
  const id = selectedLayerId();
  cmd.keyProperty(id, prop);
  return `Keyed ${prop} on "${selectedLayerName(id)}"`;
}

/**
 * Key all core transform properties at the playhead on the selected layer.
 * @mcp layer.keyAllTransform
 */
export function keyAllTransform(): string {
  const id = selectedLayerId();
  cmd.keyAllTransform(id);
  return `Keyed all transform on "${selectedLayerName(id)}"`;
}

// ── Effects (operates on the selected layer) ───────────────────────────────────

/**
 * Add an effect to the selected layer with its default parameters.
 * @mcp layer.addEffect
 * @param kind Effect kind to add.
 */
export function addEffect(kind: EffectKind): string {
  const id = selectedLayerId();
  cmd.addEffect(id, kind);
  return `Added ${kind} effect to "${selectedLayerName(id)}"`;
}

// ── Composition settings ───────────────────────────────────────────────────────

/**
 * Resize the active composition.
 * @mcp comp.resize
 * @param width New width in pixels (1..16384).
 * @param height New height in pixels (1..16384).
 */
export function resizeComp(width: number, height: number): string {
  cmd.setCompSettings({ width, height });
  return `Resized composition to ${width}×${height}`;
}

/**
 * Set the frame rate of the active composition.
 * @mcp comp.setFps
 * @param fps Frames per second (1..240).
 */
export function setFps(fps: number): string {
  cmd.setCompSettings({ fps });
  return `Set fps=${fps}`;
}

/**
 * Set the duration of the active composition.
 * @mcp comp.setDuration
 * @param seconds Duration in seconds (0.1..3600).
 */
export function setDuration(seconds: number): string {
  cmd.setCompSettings({ duration: seconds });
  return `Set duration=${seconds}s`;
}

/**
 * Set the background color of the active composition.
 * @mcp comp.setBackground
 * @param color CSS hex color (e.g. #0b0b10).
 */
export function setBackground(color: string): string {
  cmd.setCompSettings({ background: color });
  return `Set background=${color}`;
}

// ── Transport ──────────────────────────────────────────────────────────────────

/**
 * Toggle play/pause of the timeline.
 * @mcp playback.togglePlay
 */
export function togglePlay(): string {
  cmd.togglePlay();
  return store.getState().playing ? "Playing" : "Paused";
}

/**
 * Step the playhead by a number of frames (negative steps backward).
 * @mcp playback.stepFrame
 * @param frames Number of frames to step (-600..600).
 */
export function stepFrame(frames: number): string {
  cmd.stepFrame(frames);
  return `Stepped ${frames} frame(s)`;
}

/**
 * Move the playhead to the start of the composition.
 * @mcp playback.goToStart
 */
export function goToStart(): string {
  cmd.goToStart();
  return "Moved to start";
}

/**
 * Move the playhead to the end of the composition.
 * @mcp playback.goToEnd
 */
export function goToEnd(): string {
  cmd.goToEnd();
  return "Moved to end";
}
