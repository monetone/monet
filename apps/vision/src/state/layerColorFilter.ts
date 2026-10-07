// Photoshop's Layers-panel "Filter for layer color": narrow the list to layers
// tagged with any of the selected colour labels. An empty selection means no
// colour filtering (show all). Engine-free; pairs with the #41 layerColorLabels
// map + LAYER_LABELS swatches.
import type { LayerLabel } from "./layerLabels";

// True when the layer passes the colour filter. No selection → every layer
// passes; otherwise the layer must carry one of the selected labels ("none"/unset
// never match an active colour filter).
export function layerColorMatches(label: LayerLabel | undefined, selected: LayerLabel[]): boolean {
  if (selected.length === 0) return true;
  return label !== undefined && label !== "none" && selected.includes(label);
}

// Toggle a colour in the filter selection (add if absent, remove if present);
// returns a new array — the input is never mutated.
export function toggleColorFilter(selected: LayerLabel[], label: LayerLabel): LayerLabel[] {
  return selected.includes(label) ? selected.filter((l) => l !== label) : [...selected, label];
}
