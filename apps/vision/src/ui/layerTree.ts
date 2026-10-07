export interface LayerTreeItem {
  id: number;
  group: number;
  kind: number;
}

export interface LayerTreeRow<T extends LayerTreeItem> {
  layer: T;
  depth: number;
}

export type LayerDropPosition = "before" | "inside" | "after";

export interface LayerDropPlan {
  targetId: number;
  parentId: number;
  position: LayerDropPosition;
  positionCode: 0 | 1 | 2;
}

export type LayerStepDirection = -1 | 1;

const GROUP_KIND = 6;

function validParent<T extends LayerTreeItem>(layer: T, byId: Map<number, T>): number {
  const parent = byId.get(layer.group);
  return layer.group !== layer.id && parent?.kind === GROUP_KIND ? layer.group : 0;
}

/** Flatten the engine's parent-id tree in panel order, keeping matching ancestors. */
export function flattenLayerTree<T extends LayerTreeItem>(
  layers: readonly T[],
  collapsed: ReadonlySet<number>,
  include: (layer: T) => boolean = () => true,
): LayerTreeRow<T>[] {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const children = new Map<number, T[]>();
  for (const layer of layers) {
    const parent = validParent(layer, byId);
    const siblings = children.get(parent);
    if (siblings) siblings.push(layer);
    else children.set(parent, [layer]);
  }

  const visited = new Set<number>();
  const walk = (layer: T, depth: number): { matches: boolean; rows: LayerTreeRow<T>[] } => {
    if (visited.has(layer.id)) return { matches: false, rows: [] };
    visited.add(layer.id);
    const nested = (children.get(layer.id) ?? []).map((child) => walk(child, depth + 1));
    const matches = include(layer) || nested.some((result) => result.matches);
    if (!matches) return { matches: false, rows: [] };
    return {
      matches: true,
      rows: [
        { layer, depth },
        ...(collapsed.has(layer.id) ? [] : nested.flatMap((result) => result.rows)),
      ],
    };
  };

  const rows = (children.get(0) ?? []).flatMap((layer) => walk(layer, 0).rows);
  // Malformed cyclic/orphaned imports still get one root row per remaining layer.
  for (const layer of layers) {
    if (!visited.has(layer.id)) rows.push(...walk(layer, 0).rows);
  }
  return rows;
}

export function layerDropPosition(
  clientY: number,
  top: number,
  height: number,
  targetIsGroup: boolean,
): LayerDropPosition {
  const ratio = height > 0 ? (clientY - top) / height : 0.5;
  if (ratio < 0.25) return "before";
  if (ratio > 0.75) return "after";
  if (targetIsGroup) return "inside";
  return ratio < 0.5 ? "before" : "after";
}

/** Validate a panel drop before asking the engine to perform the atomic move. */
export function planLayerDrop<T extends LayerTreeItem>(
  layers: readonly T[],
  draggedId: number,
  targetId: number,
  position: LayerDropPosition,
  topLevelContainers: ReadonlySet<number> = new Set(),
): LayerDropPlan | null {
  if (draggedId === targetId) return null;
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const dragged = byId.get(draggedId);
  const target = byId.get(targetId);
  if (!dragged || !target || (position === "inside" && target.kind !== GROUP_KIND)) return null;

  const parentId = position === "inside" ? target.id : validParent(target, byId);
  if (
    (topLevelContainers.has(dragged.id) && parentId !== 0) ||
    (dragged.kind === GROUP_KIND && topLevelContainers.has(parentId))
  ) {
    return null;
  }
  const seen = new Set<number>();
  for (let ancestor = parentId; ancestor !== 0;) {
    if (ancestor === dragged.id || seen.has(ancestor)) return null;
    seen.add(ancestor);
    const parent = byId.get(ancestor);
    ancestor = parent ? validParent(parent, byId) : 0;
  }

  return {
    targetId,
    parentId,
    position,
    positionCode: position === "before" ? 0 : position === "inside" ? 1 : 2,
  };
}

/** Move one slot among siblings without splitting a group subtree. */
export function planLayerStep<T extends LayerTreeItem>(
  layers: readonly T[],
  id: number,
  direction: LayerStepDirection,
  topLevelContainers: ReadonlySet<number> = new Set(),
): LayerDropPlan | null {
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const layer = byId.get(id);
  if (!layer) return null;
  const parentId = validParent(layer, byId);
  const siblings = layers.filter((candidate) => validParent(candidate, byId) === parentId);
  const index = siblings.findIndex((candidate) => candidate.id === id);
  const target = siblings[index + direction];
  return target
    ? planLayerDrop(
        layers,
        id,
        target.id,
        direction < 0 ? "before" : "after",
        topLevelContainers,
      )
    : null;
}

export interface ClippingLayerItem extends LayerTreeItem {
  clipped?: boolean;
}

/** Resolve an Alt-clicked visible row boundary without crossing a hidden row,
 *  group boundary, or parent boundary. An already-clipped upper layer may
 *  always be released. */
export function clippingBoundaryLayer<T extends ClippingLayerItem>(
  layers: readonly T[],
  visibleIds: readonly number[],
  rowId: number,
  edge: "top" | "bottom",
): T | null {
  const visibleIndex = visibleIds.indexOf(rowId);
  if (visibleIndex < 0) return null;
  const upperId = edge === "top" ? visibleIds[visibleIndex - 1] : visibleIds[visibleIndex];
  const lowerId = edge === "top" ? visibleIds[visibleIndex] : visibleIds[visibleIndex + 1];
  const byId = new Map(layers.map((layer) => [layer.id, layer]));
  const upper = byId.get(upperId);
  const lower = byId.get(lowerId);
  if (!upper || !lower) return null;
  if (upper.clipped) return upper;
  if (upper.kind === GROUP_KIND) return null;
  const parentId = validParent(upper, byId);
  if (lower.kind === GROUP_KIND || validParent(lower, byId) !== parentId) return null;
  const siblings = layers.filter((layer) => validParent(layer, byId) === parentId);
  const upperIndex = siblings.findIndex((layer) => layer.id === upper.id);
  return siblings[upperIndex + 1]?.id === lower.id ? upper : null;
}
