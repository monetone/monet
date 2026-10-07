// Monet Cinema — MCP command surface.
//
// Every exported `@mcp` function here becomes an MCP tool automatically: the
// codegen (`pnpm mcp:codegen`) reads the JSDoc + parameter types and writes
// mcp.manifest.json + mcp.generated.ts, and `pnpm mcp:check` fails CI if a new
// command is added without regenerating. To add a feature to the MCP surface,
// add a typed, `@mcp`-tagged exported function here that calls into the app's
// existing editor command layer (commands.ts).
//
// Keep these thin: they delegate to the same commands the UI/menu/shortcuts use
// (and the same `store` transport), so MCP automation and the UI stay in
// lockstep. Wrappers take only scalars and act on the active sequence /
// selection / playhead, so an MCP client never needs to know internal ids.

import {
  addAudioTrack,
  addColorMatte,
  addMediaToTimeline,
  addTitle,
  addVideoTrack,
  duplicateSelected,
  goNextEdge,
  goPrevEdge,
  goToEnd,
  goToStart,
  markIn,
  markOut,
  newProject,
  newSequence,
  nudgeSelected,
  razorAtPlayhead,
  redo,
  rippleDeleteSelected,
  selectAll,
  setSelectedSpeed,
  slipSelected,
  stepFrame,
  togglePlay,
  undo,
} from "../commands";
import { store } from "../state/app";
import { importFromPath } from "../media/import";

// ── Project / sequence ────────────────────────────────────────────────────────

/**
 * Create a new empty project, replacing the current one.
 * @mcp project.new
 */
export function projectNew(): string {
  newProject();
  return "Created a new project";
}

/**
 * Add a new sequence to the project and make it active.
 * @mcp sequence.new
 */
export function sequenceNew(): string {
  newSequence();
  return "Created a new sequence";
}

// ── Tracks ─────────────────────────────────────────────────────────────────────

/**
 * Add a video track to the active sequence.
 * @mcp track.addVideo
 */
export function trackAddVideo(): string {
  addVideoTrack();
  return "Added a video track";
}

/**
 * Add an audio track to the active sequence.
 * @mcp track.addAudio
 */
export function trackAddAudio(): string {
  addAudioTrack();
  return "Added an audio track";
}

// ── Synthetic sources ────────────────────────────────────────────────────────

/**
 * Add a color-matte clip on the top video track at the playhead.
 * @mcp source.addColorMatte
 * @param color Matte color as a hex string (e.g. "#1f2430").
 */
export function sourceAddColorMatte(color = "#1f2430"): string {
  addColorMatte(color);
  return `Added color matte ${color}`;
}

/**
 * Add a title clip on the top video track at the playhead.
 * @mcp source.addTitle
 * @param text Title text shown on the clip.
 */
export function sourceAddTitle(text = "Title"): string {
  addTitle(text);
  return `Added title "${text}"`;
}

// ── Media files ────────────────────────────────────────────────────────────────

/**
 * Import a media file (video/audio/image) from an absolute filesystem path and place it on the timeline at the playhead (video on V1 + linked audio on A1).
 * @mcp source.addMediaFile
 * @param path Absolute path to the media file to import.
 */
export async function sourceAddMediaFile(path: string): Promise<string> {
  const item = await importFromPath(path);
  if (!item) return `Failed to import "${path}" (unsupported or unreadable)`;
  addMediaToTimeline(item.id);
  return `Imported and placed "${item.name}" on the timeline`;
}

// ── Clip edits (act on the current selection / playhead) ───────────────────────

/**
 * Split clips at the playhead (razor). Cuts all tracks or just the active one.
 * @mcp clip.split
 * @param allTracks Split every track when true, only the active track when false.
 */
export function clipSplit(allTracks = true): string {
  razorAtPlayhead(allTracks);
  return allTracks ? "Split all tracks at the playhead" : "Split the active track at the playhead";
}

/**
 * Ripple-delete the selected clips, closing the gaps they leave behind.
 * @mcp clip.rippleDelete
 */
export function clipRippleDelete(): string {
  rippleDeleteSelected();
  return "Ripple-deleted the selected clips";
}

/**
 * Duplicate the selected clips immediately after themselves.
 * @mcp clip.duplicate
 */
export function clipDuplicate(): string {
  duplicateSelected();
  return "Duplicated the selected clips";
}

/**
 * Nudge the selected clips along the timeline by a frame delta.
 * @mcp clip.nudge
 * @param deltaFrames Frames to move (negative = left, positive = right).
 */
export function clipNudge(deltaFrames: number): string {
  nudgeSelected(deltaFrames);
  return `Nudged selection by ${deltaFrames} frame(s)`;
}

/**
 * Set the playback speed of the selected clips.
 * @mcp clip.setSpeed
 * @param speed Playback speed multiplier (0.1..10).
 */
export function clipSetSpeed(speed: number): string {
  setSelectedSpeed(speed);
  return `Set selected clip speed to ${speed}×`;
}

/**
 * Slip the source in/out of the selected clips without moving them on the timeline.
 * @mcp clip.slip
 * @param delta Frames to slip the source content (negative or positive).
 */
export function clipSlip(delta: number): string {
  slipSelected(delta);
  return `Slipped selection by ${delta} frame(s)`;
}

// ── Selection / history ────────────────────────────────────────────────────────

/**
 * Select every clip in the active sequence.
 * @mcp edit.selectAll
 */
export function editSelectAll(): string {
  selectAll();
  return "Selected all clips";
}

/**
 * Undo the last edit.
 * @mcp edit.undo
 */
export function editUndo(): string {
  undo();
  return "Undid the last edit";
}

/**
 * Redo the last undone edit.
 * @mcp edit.redo
 */
export function editRedo(): string {
  redo();
  return "Redid the last edit";
}

// ── Playback / transport ───────────────────────────────────────────────────────

/**
 * Toggle play/pause of the timeline.
 * @mcp playback.togglePlay
 */
export function playbackTogglePlay(): string {
  togglePlay();
  return store.state.playing ? "Playing" : "Paused";
}

/**
 * Step the playhead by a number of frames.
 * @mcp playback.step
 * @param delta Frames to step (negative = back, positive = forward).
 */
export function playbackStep(delta: number): string {
  stepFrame(delta);
  return `Playhead at frame ${store.state.playhead}`;
}

/**
 * Move the playhead to the start of the sequence.
 * @mcp playback.goToStart
 */
export function playbackGoToStart(): string {
  goToStart();
  return "Playhead at sequence start";
}

/**
 * Move the playhead to the end of the sequence.
 * @mcp playback.goToEnd
 */
export function playbackGoToEnd(): string {
  goToEnd();
  return `Playhead at frame ${store.state.playhead}`;
}

/**
 * Move the playhead to the next clip edge.
 * @mcp playback.nextEdge
 */
export function playbackNextEdge(): string {
  goNextEdge();
  return `Playhead at frame ${store.state.playhead}`;
}

/**
 * Move the playhead to the previous clip edge.
 * @mcp playback.prevEdge
 */
export function playbackPrevEdge(): string {
  goPrevEdge();
  return `Playhead at frame ${store.state.playhead}`;
}

/**
 * Set the in point of the work area to the playhead.
 * @mcp playback.markIn
 */
export function playbackMarkIn(): string {
  markIn();
  return `Marked in at frame ${store.state.playhead}`;
}

/**
 * Set the out point of the work area to the playhead.
 * @mcp playback.markOut
 */
export function playbackMarkOut(): string {
  markOut();
  return `Marked out at frame ${store.state.playhead}`;
}
