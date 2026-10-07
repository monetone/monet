// ─────────────────────────────────────────────────────────────
// Brush presets — pure helpers for the Brushes panel's saved-brush library.
// Engine-free so they unit-test in node; the Store delegates to them and applies
// a preset via the existing store.setBrush. A preset is a BrushState settings
// snapshot (Vision's procedural round brush has no tip bitmap), mirroring the
// Swatches panel template (swatches.ts). The BrushState import is type-only so
// nothing engine-side is pulled into node.
// ─────────────────────────────────────────────────────────────
import type { BrushState } from "./store";

export interface BrushPreset {
  name: string;
  brush: Partial<BrushState>;
}

/** A Photoshop-like starter set of brush presets (settings snapshots). */
export const DEFAULT_BRUSH_PRESETS: BrushPreset[] = [
  { name: "Soft Round", brush: { size: 30, hardness: 0, flow: 1, opacity: 1, spacing: 0.16 } },
  { name: "Hard Round", brush: { size: 20, hardness: 1, flow: 1, opacity: 1, spacing: 0.16 } },
  { name: "Soft Round Pressure", brush: { size: 40, hardness: 0.2, flow: 0.85, opacity: 1, spacing: 0.1, sizePressure: true, flowPressure: true } },
  { name: "Airbrush Soft", brush: { size: 50, hardness: 0, flow: 0.3, opacity: 1, spacing: 0.05 } },
  { name: "Pencil Hard", brush: { size: 4, hardness: 1, flow: 1, opacity: 1, spacing: 0.1 } },
  { name: "Chalk", brush: { size: 24, hardness: 0.5, flow: 0.7, opacity: 0.9, spacing: 0.25 } },
];

/** The next "Brush N" name, one past the highest existing "Brush <int>"
 *  (Photoshop-like auto-numbering); names not of that form are ignored. */
export function defaultBrushPresetName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Brush (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Brush ${max + 1}`;
}

/** Append a preset; a preset whose name is already present is a same-ref no-op. */
export function addBrushPresetTo(list: BrushPreset[], preset: BrushPreset): BrushPreset[] {
  if (list.some((p) => p.name === preset.name)) return list;
  return [...list, preset];
}

/** Remove the preset at index `i`; out-of-range is a same-ref no-op. */
export function removeBrushPresetAt(list: BrushPreset[], i: number): BrushPreset[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, j) => j !== i);
}

/** Resolve Photoshop's brush-preset keyboard navigation. Previous/next clamp
 *  at the library ends; Shift requests the first/last endpoint directly. When
 *  no preset is selected yet, next starts at the first and previous at the last. */
export function brushPresetNavigationIndex(
  current: number,
  count: number,
  direction: -1 | 1,
  endpoint = false,
): number {
  if (count <= 0) return -1;
  if (endpoint) return direction < 0 ? 0 : count - 1;
  if (current < 0 || current >= count) return direction < 0 ? count - 1 : 0;
  return Math.max(0, Math.min(count - 1, current + direction));
}

/** Parse a persisted brush-preset library (localStorage JSON) → the list, or
 *  null when the payload is missing/malformed. An empty array is a valid saved
 *  library (#133): the user deleted every preset and must not get the factory
 *  set back on reload. Validates each entry's shape so a corrupt store can't
 *  break the app. */
export function parseBrushPresets(json: string | null): BrushPreset[] | null {
  if (!json) return null;
  try {
    const v = JSON.parse(json);
    if (!Array.isArray(v)) return null;
    if (!v.every((p) => p && typeof p.name === "string" && p.brush && typeof p.brush === "object")) return null;
    return v as BrushPreset[];
  } catch { return null; }
}
