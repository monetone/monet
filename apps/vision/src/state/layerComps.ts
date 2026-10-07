// Layer Comps — pure & node-safe helpers (no engine/DOM). A Layer Comp is a named
// snapshot of the document's per-layer state; the store captures/applies it via the
// existing engine layer ops. It records visibility, position, and appearance.
//
//   https://helpx.adobe.com/photoshop/using/layer-comps.html

import { sanitizeStyleEffects, type StyleData } from "./stylePresets";
import { FX_MAX_INSTANCES } from "./effects";

export interface LayerCompState {
  id: number;
  visible: boolean;
  opacity: number; // 0..100
  blendMode: string; // kebab id
  offset?: [number, number];
  style?: StyleData;
}

export interface LayerComp {
  name: string;
  layers: LayerCompState[];
  /** Free-form note shown in the panel (Layer Comp Options ▸ Comment). */
  comment?: string;
  // Which attributes the comp applies (Layer Comp Options ▸ Apply To Layers).
  // Absent means applied — old comps captured everything, so they keep working.
  applyVisibility?: boolean;
  applyPosition?: boolean;
  applyAppearance?: boolean;
}

/** The live per-layer state used to fill in attributes a comp does not apply. */
export type LayerCompLiveState = Pick<LayerCompState, "id" | "visible" | "opacity" | "blendMode">;

export const MAX_LAYER_COMPS = 1000;
export const MAX_LAYERS_PER_COMP = 10_000;
export const MAX_LAYER_STATES = 100_000;
const MAX_COMP_NAME = 1024;
const MAX_COMP_COMMENT = 4096;
const MAX_EFFECT_PARAMS = 256;
// 10 effect types × the engine's per-type instance cap — the most entries a
// layer's style can legitimately carry (see StyleEffect in stylePresets.ts).
const MAX_STYLE_EFFECT_ENTRIES = 10 * FX_MAX_INSTANCES;
const MAX_LAYER_ID = 0xffff_ffff;
const MAX_FLOAT32 = 3.4e38;
const MIN_I32 = -0x8000_0000;
const MAX_I32 = 0x7fff_ffff;

function finiteArray(value: unknown, max: number): number[] | null {
  if (!Array.isArray(value) || value.length > max || !value.every((item) => typeof item === "number" && Number.isFinite(item))) return null;
  return value.map((item) => Math.max(-MAX_FLOAT32, Math.min(MAX_FLOAT32, item)));
}

function normalizeStyle(value: unknown): StyleData | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Partial<StyleData>;
  if (!Array.isArray(raw.effects) || raw.effects.length > MAX_STYLE_EFFECT_ENTRIES) return undefined;
  // Untrusted (project file / comp JSON) effect entries: a bad fx id or an
  // over-cap instance count is dropped here, never handed to set_layer_effect_at.
  const effects = sanitizeStyleEffects(raw.effects, MAX_EFFECT_PARAMS);
  const blendIf = finiteArray(raw.blendIf, 32);
  if (!blendIf || (blendIf.length !== 0 && blendIf.length !== 32) || typeof raw.fillOpacity !== "number" || !Number.isFinite(raw.fillOpacity)) return undefined;
  return { effects, blendIf: blendIf.map((value) => Math.max(0, Math.min(1, value))), fillOpacity: Math.max(0, Math.min(100, raw.fillOpacity)) };
}

/** Normalize untrusted/project comp payloads into bounded, immutable data. */
export function normalizeLayerComps(value: unknown): LayerComp[] {
  if (!Array.isArray(value)) return [];
  const comps: LayerComp[] = [];
  let totalLayers = 0;
  for (const item of value.slice(0, MAX_LAYER_COMPS)) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Partial<LayerComp>;
    if (typeof raw.name !== "string" || !Array.isArray(raw.layers)) continue;
    const layers: LayerCompState[] = [];
    const seen = new Set<number>();
    for (const state of raw.layers.slice(0, MAX_LAYERS_PER_COMP)) {
      if (!state || typeof state !== "object") continue;
      const layer = state as Partial<LayerCompState>;
      const id = typeof layer.id === "number" && Number.isFinite(layer.id) ? Math.round(layer.id) : 0;
      if (id <= 0 || id > MAX_LAYER_ID || seen.has(id) || typeof layer.visible !== "boolean"
        || typeof layer.opacity !== "number" || !Number.isFinite(layer.opacity) || typeof layer.blendMode !== "string") continue;
      seen.add(id);
      const offset = Array.isArray(layer.offset) && layer.offset.length === 2
        && layer.offset.every((n) => typeof n === "number" && Number.isFinite(n))
        ? layer.offset.map((n) => Math.max(MIN_I32, Math.min(MAX_I32, Math.round(n)))) as [number, number]
        : undefined;
      const style = normalizeStyle(layer.style);
      layers.push({
        id,
        visible: layer.visible,
        opacity: Math.max(0, Math.min(100, layer.opacity)),
        blendMode: layer.blendMode.slice(0, 64),
        ...(offset ? { offset } : {}),
        ...(style ? { style } : {}),
      });
      totalLayers++;
      if (layers.length >= MAX_LAYERS_PER_COMP || totalLayers >= MAX_LAYER_STATES) break;
    }
    const comment = typeof raw.comment === "string" && raw.comment ? raw.comment.slice(0, MAX_COMP_COMMENT) : undefined;
    // Only `false` is persisted — an absent flag means "applies this attribute".
    comps.push({
      name: raw.name.slice(0, MAX_COMP_NAME),
      layers,
      ...(comment ? { comment } : {}),
      ...(raw.applyVisibility === false ? { applyVisibility: false as const } : {}),
      ...(raw.applyPosition === false ? { applyPosition: false as const } : {}),
      ...(raw.applyAppearance === false ? { applyAppearance: false as const } : {}),
    });
    if (comps.length >= MAX_LAYER_COMPS || totalLayers >= MAX_LAYER_STATES) break;
  }
  return comps;
}

/** Clone trusted runtime comps through the same persistence bounds. */
export function cloneLayerComps(comps: LayerComp[]): LayerComp[] {
  return normalizeLayerComps(comps);
}

/**
 * Narrow a comp to the attributes its options enable. Visibility/appearance the
 * comp does not apply come from `live` instead; position/appearance it does not
 * apply are dropped so the engine keeps whatever the document already has.
 */
export function compForApply(comp: LayerComp, live: LayerCompLiveState[]): LayerComp {
  if (comp.applyVisibility !== false && comp.applyPosition !== false && comp.applyAppearance !== false) return comp;
  const now = new Map(live.map((l) => [l.id, l]));
  return {
    ...comp,
    layers: comp.layers.map((layer) => {
      const cur = now.get(layer.id);
      const next: LayerCompState = {
        id: layer.id,
        visible: comp.applyVisibility === false ? cur?.visible ?? layer.visible : layer.visible,
        opacity: comp.applyAppearance === false ? cur?.opacity ?? layer.opacity : layer.opacity,
        blendMode: comp.applyAppearance === false ? cur?.blendMode ?? layer.blendMode : layer.blendMode,
      };
      if (comp.applyPosition !== false && layer.offset) next.offset = layer.offset;
      if (comp.applyAppearance !== false && layer.style) next.style = layer.style;
      return next;
    }),
  };
}

/** Next default comp name: "Layer Comp N" where N is one past the highest existing N. */
export function defaultLayerCompName(names: string[]): string {
  let max = 0;
  for (const n of names) {
    const m = /^Layer Comp (\d+)$/.exec(n);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return `Layer Comp ${max + 1}`;
}

/** Immutably append a comp, refusing state the runtime clone would truncate. */
export function addLayerComp(list: LayerComp[], comp: LayerComp): LayerComp[] {
  if (list.length >= MAX_LAYER_COMPS || comp.layers.length > MAX_LAYERS_PER_COMP) return list;
  const totalLayers = list.reduce((total, item) => total + item.layers.length, comp.layers.length);
  if (totalLayers > MAX_LAYER_STATES) return list;
  return [...list, comp];
}

/** Immutably remove the comp at index i (out-of-range → unchanged). */
export function removeLayerCompAt(list: LayerComp[], i: number): LayerComp[] {
  if (i < 0 || i >= list.length) return list;
  return list.filter((_, idx) => idx !== i);
}
