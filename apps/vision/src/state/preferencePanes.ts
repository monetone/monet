// Preferences ▸ Cursors, Workspace and Camera Raw (#482). Each pane's choices
// are application preferences held in the store and persisted beside its other
// `mv.*` keys. Storage is user-editable, so a stale or hand-edited blob is
// coerced field by field, and anything unreadable falls back to the default.

const bool = (v: unknown, fallback: boolean) => (typeof v === "boolean" ? v : fallback);
const pick = <T extends string>(v: unknown, options: readonly T[], fallback: T): T =>
  options.includes(v as T) ? (v as T) : fallback;
const fields = (raw: unknown) =>
  (raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

/** Painting Cursors: the tool's icon, a crosshair, or an outline of the brush
 *  tip — Normal rings the part of a dab painted at 50% or more, Full Size the
 *  whole footprint. */
export const PAINTING_CURSORS = ["standard", "precise", "normal", "full"] as const;
export type PaintingCursor = (typeof PAINTING_CURSORS)[number];
/** Other Cursors: the tool's icon or a crosshair. */
export const OTHER_CURSORS = ["standard", "precise"] as const;
export type OtherCursor = (typeof OTHER_CURSORS)[number];

export interface CursorPrefs {
  painting: PaintingCursor;
  /** Show Crosshair in Brush Tip. */
  crosshairInTip: boolean;
  /** Show Only Crosshair While Painting. */
  crosshairWhilePainting: boolean;
  other: OtherCursor;
}

// Photoshop's defaults, except Other Cursors: Vision's tool icons carry no
// hotspot, so Precise (the crosshair every other tool has always used) stays it.
export const DEFAULT_CURSOR_PREFS: CursorPrefs = {
  painting: "normal", crosshairInTip: false, crosshairWhilePainting: false, other: "precise",
};

export function normalizeCursorPrefs(raw: unknown, base = DEFAULT_CURSOR_PREFS): CursorPrefs {
  const r = fields(raw);
  return {
    painting: pick(r.painting, PAINTING_CURSORS, base.painting),
    crosshairInTip: bool(r.crosshairInTip, base.crosshairInTip),
    crosshairWhilePainting: bool(r.crosshairWhilePainting, base.crosshairWhilePainting),
    other: pick(r.other, OTHER_CURSORS, base.other),
  };
}

/** Whether a Painting Cursors choice draws the brush-tip outline. */
export const isBrushTipCursor = (painting: PaintingCursor) => painting === "normal" || painting === "full";

export interface WorkspacePrefs {
  /** A collapsed dock's sprung-out panel folds away on a click elsewhere. */
  autoCollapseIconicPanels: boolean;
  /** With the panels hidden (Tab), the pointer at the window's left or right
   *  edge shows that side's panels until it leaves them. */
  autoShowHiddenPanels: boolean;
  /** Full-height document tabs; off gives the smaller tab bar. */
  largeTabs: boolean;
}

export const DEFAULT_WORKSPACE_PREFS: WorkspacePrefs = {
  autoCollapseIconicPanels: true, autoShowHiddenPanels: true, largeTabs: true,
};

export function normalizeWorkspacePrefs(raw: unknown, base = DEFAULT_WORKSPACE_PREFS): WorkspacePrefs {
  const r = fields(raw);
  return {
    autoCollapseIconicPanels: bool(r.autoCollapseIconicPanels, base.autoCollapseIconicPanels),
    autoShowHiddenPanels: bool(r.autoShowHiddenPanels, base.autoShowHiddenPanels),
    largeTabs: bool(r.largeTabs, base.largeTabs),
  };
}

/** How close (px) to the window edge the pointer has to come to show hidden panels. */
export const HIDDEN_PANELS_EDGE = 6;

/** Which side's hidden panels to show for a pointer at `x`: an edge shows its
 *  side, and a shown side stays out while the pointer is over its panels. */
export function hiddenPanelsPeek(shown: "" | "left" | "right", x: number, width: number, overPanels: boolean): "" | "left" | "right" {
  if (x <= HIDDEN_PANELS_EDGE) return "left";
  if (x >= width - HIDDEN_PANELS_EDGE) return "right";
  return overPanels ? shown : "";
}

export interface CameraRawPrefs {
  /** Opening a raw file shows the Camera Raw workspace; off opens it straight
   *  into a document with its saved (sidecar) or default settings. */
  openInCameraRaw: boolean;
  /** Opening an image from Camera Raw also writes its settings to the sidecar
   *  .xmp, as Done always does. */
  sidecarOnOpen: boolean;
}

export const DEFAULT_CAMERA_RAW_PREFS: CameraRawPrefs = { openInCameraRaw: true, sidecarOnOpen: false };

export function normalizeCameraRawPrefs(raw: unknown, base = DEFAULT_CAMERA_RAW_PREFS): CameraRawPrefs {
  const r = fields(raw);
  return {
    openInCameraRaw: bool(r.openInCameraRaw, base.openInCameraRaw),
    sidecarOnOpen: bool(r.sidecarOnOpen, base.sidecarOnOpen),
  };
}
