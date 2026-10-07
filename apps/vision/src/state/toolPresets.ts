// ─────────────────────────────────────────────────────────────
// Tool presets — pure helpers for the "Tool Presets" library. A preset captures
// a tool plus the option-bar state that matters for it (brush settings + the
// foreground colour), mirroring brushPresets.ts. Engine-free so it unit-tests in
// node; the Store snapshots the live state into one and applies it via the
// existing setTool / setBrush / setForeground.
// ─────────────────────────────────────────────────────────────
import type { HSV } from "@monet-ui/monet-react";
import type { BrushState, ToolId } from "./store";

export interface ToolPreset {
  name: string;
  tool: ToolId;
  brush: Partial<BrushState>;
  fg: HSV;
}

const BLACK: HSV = { h: 0, s: 0, v: 0, a: 1 };

/** A small Photoshop-like starter set of tool presets. */
export const DEFAULT_TOOL_PRESETS: ToolPreset[] = [
  { name: "Soft Round 30", tool: "brush", brush: { size: 30, hardness: 0, flow: 1, opacity: 1 }, fg: BLACK },
  { name: "Hard Round 20", tool: "brush", brush: { size: 20, hardness: 1, flow: 1, opacity: 1 }, fg: BLACK },
  { name: "Eraser 40", tool: "erase", brush: { size: 40, hardness: 0.5, flow: 1, opacity: 1 }, fg: BLACK },
];

/** The next "Tool N" auto-name, one past the highest existing "Tool <int>". */
export function defaultToolPresetName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Tool (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Tool ${max + 1}`;
}

/** Append a preset; a preset whose name is already present is a same-ref no-op. */
export function addToolPresetTo(list: ToolPreset[], preset: ToolPreset): ToolPreset[] {
  if (list.some((p) => p.name === preset.name)) return list;
  return [...list, preset];
}

/** Remove the preset at index `i`; out-of-range is a same-ref no-op. */
export function removeToolPresetAt(list: ToolPreset[], i: number): ToolPreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Parse a persisted tool-preset library (localStorage JSON) → the list
 *  (possibly empty), or null when the payload is missing/malformed. Validates each entry's
 *  shape so a corrupt store can't break the app. */
export function parseToolPresets(json: string | null): ToolPreset[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    if (!v.every((p) => p && typeof p.name === "string" && typeof p.tool === "string" && p.brush && typeof p.brush === "object" && p.fg && typeof p.fg === "object")) return null;
    return v as ToolPreset[];
  } catch { return null; }
}
