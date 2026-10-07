// ─────────────────────────────────────────────────────────────
// commands — the editing verbs the UI calls. Thin wrappers over store.mutate /
// store.patch that operate on the active composition + selection.
// ─────────────────────────────────────────────────────────────

import { createLayer } from "./model/factory";
import { newId } from "./model/ids";
import { effectiveTransform } from "./model/sample";
import { activeComp, findLayer, trackFor } from "./model/query";
import type { EaseId, Effect, EffectKind, Keyframe, LayerKind, TrackProperty } from "./model/types";
import {
  addLayerFront,
  getOrCreateTrack,
  moveLayer,
  removeKeyframe as removeKf,
  removeLayer,
  removeTrack,
  upsertKeyframe,
} from "./ops/edits";
import { store } from "./state/store";

const TRANSFORM_PROPS: TrackProperty[] = ["x", "y", "scaleX", "scaleY", "rotation", "opacity"];

// ── layers ────────────────────────────────────────────────────
export function addLayer(kind: LayerKind): void {
  const id = newId("layer"); // reserve so we can select it after mutate
  store.mutate(`Add ${kind} layer`, (p) => {
    const comp = activeComp(p);
    const layer = createLayer(kind, comp);
    layer.id = id;
    addLayerFront(comp, layer);
  });
  store.setSelection([id]);
}

/** Add an image layer from an already-decoded data URL (file import / drop),
 *  sized to the image's natural dimensions and selected so it can be moved. */
export function addImageLayer(name: string, src: string, width: number, height: number): void {
  const id = newId("layer");
  store.mutate("Add image layer", (p) => {
    const comp = activeComp(p);
    const layer = createLayer("image", comp, { name, src, width, height });
    layer.id = id;
    addLayerFront(comp, layer);
  });
  store.setSelection([id]);
}

export function deleteSelected(): void {
  const ids = store.getState().selection;
  if (ids.length === 0) return;
  store.mutate("Delete layer", (p) => {
    const comp = activeComp(p);
    for (const id of ids) removeLayer(comp, id);
  });
  store.setSelection([]);
}

export function selectLayer(id: string, additive = false): void {
  const cur = store.getState().selection;
  if (additive) {
    store.setSelection(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id]);
  } else {
    store.setSelection([id]);
  }
}

export function reorderLayer(id: string, toIndex: number): void {
  store.mutate("Reorder layer", (p) => moveLayer(activeComp(p), id, toIndex));
}

type LayerPatch = Partial<{
  name: string;
  visible: boolean;
  locked: boolean;
  solo: boolean;
  blendMode: import("./model/types").BlendMode;
  color: string;
  text: string;
  fontSize: number;
  inPoint: number;
  outPoint: number;
  src: string; // image data URL
  width: number;
  height: number;
}>;

export function setLayerProps(id: string, patch: LayerPatch, label = "Edit layer"): void {
  store.mutate(label, (p) => {
    const layer = findLayer(activeComp(p), id);
    if (layer) Object.assign(layer, patch);
  });
}

// ── transform values + keyframes ──────────────────────────────
/**
 * Set a transform property. If the property is animated (has a track), this
 * records/updates a keyframe at the current playhead; otherwise it sets the
 * static base value. Coalesced so a scrub drag is one undo step.
 */
export function setTransformValue(layerId: string, prop: TrackProperty, value: number): void {
  const t = store.getState().playhead;
  store.mutate(
    `Set ${prop}`,
    (p) => {
      const layer = findLayer(activeComp(p), layerId);
      if (!layer) return;
      const track = trackFor(layer, prop);
      if (track) {
        upsertKeyframe(track, { id: newId("kf"), time: t, value, ease: "linear" });
      } else {
        (layer.transform as Record<TrackProperty, number>)[prop] = value;
      }
    },
    { coalesceKey: `xf-${layerId}-${prop}` },
  );
}

/** Stopwatch toggle: enable animation (create a track + key current value) or
 *  disable it (remove the track, freezing the base value at its current sample). */
export function toggleAnimation(layerId: string, prop: TrackProperty): void {
  const t = store.getState().playhead;
  store.mutate("Toggle animation", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    if (!layer) return;
    if (trackFor(layer, prop)) {
      // freeze the current sampled value into the base, then drop the track
      const v = effectiveTransform(layer, t)[prop];
      (layer.transform as Record<TrackProperty, number>)[prop] = v;
      removeTrack(layer, prop);
    } else {
      const track = getOrCreateTrack(layer, prop);
      upsertKeyframe(track, { id: newId("kf"), time: t, value: layer.transform[prop], ease: "linear" });
    }
  });
}

/** Add a keyframe at the playhead for one property (current effective value). */
export function keyProperty(layerId: string, prop: TrackProperty): void {
  const t = store.getState().playhead;
  store.mutate("Add keyframe", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    if (!layer) return;
    const value = effectiveTransform(layer, t)[prop];
    upsertKeyframe(getOrCreateTrack(layer, prop), { id: newId("kf"), time: t, value, ease: "linear" });
  });
}

/** Key all core transform properties at the playhead (AE's "key all"). */
export function keyAllTransform(layerId: string): void {
  const t = store.getState().playhead;
  store.mutate("Key transform", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    if (!layer) return;
    const xf = effectiveTransform(layer, t);
    for (const prop of TRANSFORM_PROPS) {
      upsertKeyframe(getOrCreateTrack(layer, prop), { id: newId("kf"), time: t, value: xf[prop], ease: "linear" });
    }
  });
}

/** Replace a track's keyframes (timeline keyframe drag). Coalesced. */
export function setTrackKeyframes(layerId: string, prop: TrackProperty, keyframes: Keyframe[]): void {
  store.mutate(
    "Move keyframe",
    (p) => {
      const layer = findLayer(activeComp(p), layerId);
      if (!layer) return;
      const track = getOrCreateTrack(layer, prop);
      track.keyframes = keyframes.slice().sort((a, b) => a.time - b.time);
    },
    { coalesceKey: `kf-${layerId}-${prop}` },
  );
}

export function deleteKeyframe(layerId: string, prop: TrackProperty, kfId: string): void {
  store.mutate("Delete keyframe", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    const track = layer && trackFor(layer, prop);
    if (track) removeKf(track, kfId);
  });
}

export function setKeyframeEase(layerId: string, prop: TrackProperty, kfId: string, ease: EaseId): void {
  store.mutate("Set easing", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    const track = layer && trackFor(layer, prop);
    const kf = track?.keyframes.find((k) => k.id === kfId);
    if (kf) kf.ease = ease;
  });
}

// ── effects ───────────────────────────────────────────────────
const EFFECT_DEFAULTS: Record<EffectKind, Record<string, number>> = {
  blur: { radius: 8 },
  glow: { radius: 12, intensity: 1 },
  dropShadow: { distance: 12, angle: 135, blur: 8 },
  brightness: { amount: 120 },
  tint: { hue: 0, amount: 50 },
};

export function addEffect(layerId: string, kind: EffectKind): void {
  store.mutate(`Add ${kind}`, (p) => {
    const layer = findLayer(activeComp(p), layerId);
    if (layer) {
      const effect: Effect = { id: newId("fx"), kind, enabled: true, params: { ...EFFECT_DEFAULTS[kind] } };
      layer.effects.push(effect);
    }
  });
}

export function setEffectParam(layerId: string, fxId: string, key: string, value: number): void {
  store.mutate(
    "Edit effect",
    (p) => {
      const layer = findLayer(activeComp(p), layerId);
      const fx = layer?.effects.find((e) => e.id === fxId);
      if (fx) fx.params[key] = value;
    },
    { coalesceKey: `fx-${fxId}-${key}` },
  );
}

export function toggleEffect(layerId: string, fxId: string): void {
  store.mutate("Toggle effect", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    const fx = layer?.effects.find((e) => e.id === fxId);
    if (fx) fx.enabled = !fx.enabled;
  });
}

export function removeEffect(layerId: string, fxId: string): void {
  store.mutate("Remove effect", (p) => {
    const layer = findLayer(activeComp(p), layerId);
    if (layer) layer.effects = layer.effects.filter((e) => e.id !== fxId);
  });
}

// ── composition settings ──────────────────────────────────────
export function setCompSettings(patch: Partial<{ width: number; height: number; fps: number; duration: number; background: string; name: string }>): void {
  store.mutate("Composition settings", (p) => Object.assign(activeComp(p), patch));
}

// ── transport ─────────────────────────────────────────────────
export function togglePlay(): void {
  store.setPlaying(!store.getState().playing);
}
export function stepFrame(dir: number): void {
  const s = store.getState();
  const comp = activeComp(s.project);
  store.setPlaying(false);
  store.setPlayhead(s.playhead + (dir / comp.fps));
}
export function goToStart(): void {
  store.setPlaying(false);
  store.setPlayhead(0);
}
export function goToEnd(): void {
  const comp = activeComp(store.getState().project);
  store.setPlaying(false);
  store.setPlayhead(comp.duration);
}
