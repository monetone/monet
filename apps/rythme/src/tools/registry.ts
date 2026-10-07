// ─────────────────────────────────────────────────────────────
// tools/registry — editor tool metadata
// ─────────────────────────────────────────────────────────────
// One row per tool. `icon` is a key into Monet's icon map `I` or a raw SVG path.

import type { ToolId } from "../engine";

export interface ToolMeta {
  id: ToolId;
  name: string;
  shortcut: string;
  icon: string;
  hint: string;
}

export const TOOL_META: ToolMeta[] = [
  { id: "select", name: "Selection", shortcut: "V", icon: "cursor", hint: "Select & move clips" },
  { id: "marquee", name: "Time Select", shortcut: "T", icon: "marquee", hint: "Select a time range across tracks" },
  { id: "razor", name: "Razor", shortcut: "R", icon: "cut", hint: "Split clips at the cursor" },
  { id: "envelope", name: "Envelope", shortcut: "E", icon: "pen", hint: "Draw volume or pan automation" },
  { id: "fade", name: "Fade", shortcut: "F", icon: "M3 13 L13 3", hint: "Drag clip fades" },
  { id: "marker", name: "Marker", shortcut: "M", icon: "marker", hint: "Drop markers / cues" },
  { id: "hand", name: "Hand", shortcut: "H", icon: "hand", hint: "Pan the timeline" },
  { id: "zoom", name: "Zoom", shortcut: "Z", icon: "zoom", hint: "Click to zoom in, Alt-click out" },
];

/** Layout for the tool rail: each entry is a tool id or a divider. */
export const TOOL_RAIL: (ToolId | "div")[] = [
  "select",
  "marquee",
  "razor",
  "div",
  "envelope",
  "fade",
  "div",
  "marker",
  "hand",
  "zoom",
];

export const TOOL_BY_SHORTCUT: Record<string, ToolId> = Object.fromEntries(
  TOOL_META.map((t) => [t.shortcut.toLowerCase(), t.id]),
);
