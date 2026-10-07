// ─────────────────────────────────────────────────────────────
// tools/types — the tool interface the viewport dispatches to
// ─────────────────────────────────────────────────────────────

import type { ReactNode } from "react";
import type { ArtisanStore, EditorState, Point } from "../engine";

export interface ToolPointer {
  /** Pointer in world coords (snapped if snapping is on). */
  world: Point;
  /** Pointer in world coords, unsnapped. */
  rawWorld: Point;
  /** Pointer in viewport screen coords (px). */
  screen: Point;
  shift: boolean;
  alt: boolean;
  /** ctrl on Windows / Linux, also true for ⌘ on macOS. */
  mod: boolean;
  button: number;
  detail: number;
}

export interface ToolContext {
  store: ArtisanStore;
  state: EditorState;
  worldToScreen: (p: Point) => Point;
  screenToWorld: (p: Point) => Point;
  /** Force the overlay to re-render transient tool state. */
  requestRender: () => void;
  /** Pixel size of one world unit on screen (= view.zoom). */
  zoom: number;
  /** Viewport pixel size (the canvas drawing area). */
  viewport: { width: number; height: number };
}

export interface Tool {
  id: string;
  cursor?: string;
  /** Opt in when onPointerMove also provides buttonless hover feedback. */
  receivesHover?: boolean;
  onActivate?(ctx: ToolContext): void;
  onDeactivate?(ctx: ToolContext): void;
  onPointerDown?(p: ToolPointer, ctx: ToolContext): void;
  /** Fired on every move (hover when no button is down, drag otherwise). */
  onPointerMove?(p: ToolPointer, ctx: ToolContext): void;
  onPointerUp?(p: ToolPointer, ctx: ToolContext): void;
  onDoubleClick?(p: ToolPointer, ctx: ToolContext): void;
  onKeyDown?(e: KeyboardEvent, ctx: ToolContext): void;
  /** Transient overlay drawn in SCREEN space (an <svg> child). */
  renderOverlay?(ctx: ToolContext): ReactNode;
  /** Transient overlay drawn in an HTML layer over the canvas (e.g. a text editor). */
  renderHtmlOverlay?(ctx: ToolContext): ReactNode;
}

export const shouldDispatchPointerMove = (tool: Tool, buttons: number): boolean =>
  buttons !== 0 || tool.receivesHover === true;

export interface ToolMeta {
  id: string;
  name: string;
  /** Icon: a key in Monet's `I` map or a raw SVG path. */
  icon: string;
  shortcut?: string;
  cursor?: string;
  /** Group key for the tool rail (tools in a group share a slot/flyout). */
  group: string;
  /** One-line description shown in the tool's hover tooltip (after a 1s dwell). */
  description?: string;
}
