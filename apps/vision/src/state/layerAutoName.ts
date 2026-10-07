import type { LayerInfo } from "./store";

export interface LayerNameUpdate {
  id: number;
  name: string;
}

export interface AutoNameOptions {
  onlyGeneric?: boolean;
}

const KIND_NAMES: Record<number, string> = {
  0: "Pixel Layer",
  1: "Adjustment Layer",
  2: "Text Layer",
  3: "Shape Layer",
  4: "Fill Layer", // (#152) LAYER_KIND.fill — matches Panels' LAYER_KIND_LABELS
  6: "Group",
  7: "Smart Object",
};

export function isGenericLayerName(name: string): boolean {
  const n = name.trim();
  return (
    /^Layer \d+$/i.test(n)
    || /^Layer$/i.test(n)
    || /^Background(?: copy(?: \d+)?)?$/i.test(n)
    || /^Group \d+$/i.test(n)
    || /^Untitled(?:-\d+)?$/i.test(n)
    || /^blank$/i.test(n)
  );
}

export function suggestedLayerBaseName(layer: Pick<LayerInfo, "kind" | "hasMask" | "hasFx" | "visible">): string {
  const base = KIND_NAMES[layer.kind] ?? "Layer";
  const parts = [base];
  if (!layer.visible) parts.push("Hidden");
  if (layer.hasMask) parts.push("Mask");
  if (layer.hasFx) parts.push("FX");
  return parts.join(" ");
}

export function autoNameLayerUpdates(layers: LayerInfo[], opts: AutoNameOptions = {}): LayerNameUpdate[] {
  // (#153) one set of taken names — preserved layer names are seeded up front so a
  // generated "<base> N" can never collide with a name kept elsewhere in the stack.
  const preserved = (layer: LayerInfo) => !!opts.onlyGeneric && !isGenericLayerName(layer.name);
  const taken = new Set(layers.filter(preserved).map((l) => l.name));
  const nextName = (base: string) => {
    let name = base;
    for (let n = 2; taken.has(name); n++) name = `${base} ${n}`;
    taken.add(name);
    return name;
  };
  const updates: LayerNameUpdate[] = [];
  for (const layer of layers) {
    if (preserved(layer)) continue;
    const name = nextName(suggestedLayerBaseName(layer));
    if (name !== layer.name) updates.push({ id: layer.id, name });
  }
  return updates;
}
