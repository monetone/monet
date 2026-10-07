// ─────────────────────────────────────────────────────────────
// Layer color labels — pure helpers for Photoshop's per-layer colour tag
// (Red/Orange/Yellow/Green/Blue/Violet/Gray, or No Color). Organisational only;
// labels live in the store keyed by layer id. Engine-free so it unit-tests in node;
// the LayersPanel drives the row chip + a thumbnail dot from labelColor().
// ─────────────────────────────────────────────────────────────

export type LayerLabel = "none" | "red" | "orange" | "yellow" | "green" | "blue" | "violet" | "gray";

export interface LayerLabelOption {
  value: LayerLabel;
  label: string;
  color?: string; // chip colour; absent for "none"
}

export const LAYER_LABELS: LayerLabelOption[] = [
  { value: "none", label: "No Color" },
  { value: "red", label: "Red", color: "#e2504a" },
  { value: "orange", label: "Orange", color: "#e0863a" },
  { value: "yellow", label: "Yellow", color: "#d6b13a" },
  { value: "green", label: "Green", color: "#5aa84f" },
  { value: "blue", label: "Blue", color: "#4a7fd0" },
  { value: "violet", label: "Violet", color: "#8a63c4" },
  { value: "gray", label: "Gray", color: "#8a8f96" },
];

/** The chip colour for a layer label, or undefined for "none"/unset/unknown. */
export function labelColor(label: LayerLabel | undefined): string | undefined {
  return label ? LAYER_LABELS.find((o) => o.value === label)?.color : undefined;
}

/** Pure reducer for the layer-id → label map. "none" removes the entry; otherwise
 *  sets it. Returns a new map (the input is never mutated). */
export function setLabel(map: Record<number, LayerLabel>, id: number, label: LayerLabel): Record<number, LayerLabel> {
  const next = { ...map };
  if (label === "none") delete next[id];
  else next[id] = label;
  return next;
}
