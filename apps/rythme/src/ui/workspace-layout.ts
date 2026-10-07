// ─────────────────────────────────────────────────────────────
// ui/workspace-layout — dock layout (panels on the LEFT, Audition-style)
// ─────────────────────────────────────────────────────────────
// Adobe Audition's default workspace docks Files / Effects Rack / Markers /
// Properties on the LEFT of the Editor (Rythme used to dock them on the right).
// The layout is pure data (panel keys + sizes), so it lives here and is
// unit-tested for Audition parity; App.tsx feeds it to the DockableWorkspace.

import type { DockLayout } from "@monet-ui/monet-react";
import type { CustomWorkspace } from "../engine";

export const WORKSPACE_LAYOUT = {
  left: {
    size: 330,
    stack: [
      // Top-left: Files + Effects Rack (Audition's prominent top-left column).
      { tabs: ["files", "video", "effects", "generate"], active: "files", flex: 1.2 },
      // Below: Markers + Properties + Analyze (Levels / Frequency).
      { tabs: ["markers", "properties", "analyze"], active: "markers", flex: 1 },
      // Bottom: Mixer + History.
      { tabs: ["mixer", "history"], active: "mixer", flex: 1 },
    ],
  },
};

// The tool rail stays on the left; the transport ("options") sits at the BOTTOM
// of the editor — where Audition keeps its transport/time/zoom controls.
export const WORKSPACE_TOOLBAR_LAYOUT = {
  left: ["tools"],
  bottom: ["options"],
};

// ── Window ▸ Workspace: named layout presets (Audition's workspace switcher) ──
// Adobe Audition ships task-focused workspaces (Default, Maximum Waveform
// Editing, Maximum Spectral Display, Mixing, Radio Production…) selectable from
// Window ▸ Workspace. Each is just a saved dock layout; Rythme stores them as
// pure data so they're unit-tested for parity and fed to the workspace handle.
export const WORKSPACES: { id: string; label: string; layout: DockLayout }[] = [
  // The standard left dock (identical to the boot layout).
  { id: "default", label: "Default", layout: WORKSPACE_LAYOUT },
  // Editing voice/waveform: a narrow dock so the editor fills the window.
  {
    id: "maxWaveform",
    label: "Maximum Waveform Editing",
    layout: { left: { size: 220, stack: [{ tabs: ["files", "markers"], active: "files", flex: 1 }] } },
  },
  // Spectral work: the Analyze panel (spectrum / spectrogram) takes the lead.
  {
    id: "maxSpectral",
    label: "Maximum Spectral Display",
    layout: {
      left: {
        size: 320,
        stack: [
          { tabs: ["analyze", "markers"], active: "analyze", flex: 1.4 },
          { tabs: ["properties", "effects"], active: "properties", flex: 1 },
        ],
      },
    },
  },
  // Mixing: the Mixer and Effects Rack lead, sources/properties below.
  {
    id: "mixing",
    label: "Mixing",
    layout: {
      left: {
        size: 340,
        stack: [
          { tabs: ["mixer", "effects"], active: "mixer", flex: 1.3 },
          { tabs: ["properties", "files", "video"], active: "properties", flex: 1 },
        ],
      },
    },
  },
  // Radio production: source files + markers up top, effects + history below.
  {
    id: "radio",
    label: "Radio Production",
    layout: {
      left: {
        size: 320,
        stack: [
          { tabs: ["files", "video", "markers"], active: "files", flex: 1.2 },
          { tabs: ["effects", "history"], active: "effects", flex: 1 },
        ],
      },
    },
  },
];

/** The dock layout for a workspace id, falling back to Default for unknown ids. */
export function getWorkspaceLayout(id: string, customWorkspaces: CustomWorkspace[] = []): DockLayout {
  return customWorkspaces.find((w) => w.id === id)?.layout ?? (WORKSPACES.find((w) => w.id === id) ?? WORKSPACES[0]).layout;
}

// ── Window menu: bring a docked panel to the front ──────────────────────────
// The DockableWorkspace layout is a tree of sides → columns → tab groups
// ({ tabs, active }). Focusing a panel = make its containing group's active tab
// that panel. Pure + immutable so it's unit-testable; App.tsx feeds the live
// layout from the workspace handle (getLayout → focusPanelInLayout → setLayout).

interface TabGroup {
  tabs?: string[];
  active?: string;
  stack?: TabGroup[];
  cols?: { stack?: TabGroup[] }[];
}

function activateInGroups(groups: TabGroup[], panelId: string): TabGroup[] {
  return groups.map((g) => (Array.isArray(g.tabs) && g.tabs.includes(panelId) ? { ...g, active: panelId } : g));
}

function activateInContainer<T extends TabGroup>(container: T, panelId: string): T {
  let next: T = container;
  if (Array.isArray(container.cols)) {
    next = { ...next, cols: container.cols.map((c) => (Array.isArray(c.stack) ? { ...c, stack: activateInGroups(c.stack, panelId) } : c)) };
  }
  if (Array.isArray(container.stack)) {
    next = { ...next, stack: activateInGroups(container.stack, panelId) };
  }
  return next;
}

/**
 * Return a copy of `layout` with `panelId`'s tab group brought to the front
 * (its `active` set to `panelId`). Any other groups, sizes and splits are
 * preserved; if no group holds the panel the layout is structurally unchanged.
 */
export function focusPanelInLayout<T>(layout: T, panelId: string): T {
  if (!layout || typeof layout !== "object") return layout;
  const out = { ...(layout as Record<string, unknown>) };
  for (const side of ["left", "right", "top", "bottom"]) {
    if (out[side] && typeof out[side] === "object") out[side] = activateInContainer(out[side] as TabGroup, panelId);
  }
  if (Array.isArray(out.floating)) out.floating = out.floating.map((f) => activateInContainer(f as TabGroup, panelId));
  return out as T;
}
