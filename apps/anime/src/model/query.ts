// query — pure read-only lookups over the document.

import type { AnimeProject, AnimTrack, Composition, Layer, TrackProperty } from "./types";

export function activeComp(project: AnimeProject): Composition {
  return project.compositions.find((c) => c.id === project.activeCompId) ?? project.compositions[0];
}

export function findComp(project: AnimeProject, id: string): Composition | undefined {
  return project.compositions.find((c) => c.id === id);
}

export function findLayer(comp: Composition, id: string): Layer | undefined {
  return comp.layers.find((l) => l.id === id);
}

export function layerIndex(comp: Composition, id: string): number {
  return comp.layers.findIndex((l) => l.id === id);
}

export function trackFor(layer: Layer, property: TrackProperty): AnimTrack | undefined {
  return layer.tracks.find((t) => t.property === property);
}

/** Current value of a transform property (base or — if you pass it — sampled). */
export function readProperty(layer: Layer, property: TrackProperty): number {
  return (layer.transform as Record<TrackProperty, number>)[property];
}

/** Is `property` animated (has a track) on this layer? */
export function isAnimated(layer: Layer, property: TrackProperty): boolean {
  return layer.tracks.some((t) => t.property === property);
}
