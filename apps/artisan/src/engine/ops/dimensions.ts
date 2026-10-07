// ops/dimensions - live dimension lifecycle

import {
  buildDimensionChildren,
  makeDimensionObject,
  type DimensionOptions,
} from "../model/dimensions";
import { findItem } from "../model/query";
import type { DimensionObject, Document, GroupItem, ID } from "../model/types";

export type DimensionOptionPatch = Partial<Omit<DimensionObject, "id" | "kind" | "length" | "angle">> & {
  label?: string | null;
};

const dimensionGroup = (doc: Document, id: ID): GroupItem | null => {
  const item = findItem(doc, id)?.item;
  return item?.type === "group" && item.dimension ? item : null;
};

const dimensionOptions = (
  dimension: DimensionObject,
  patch: DimensionOptionPatch,
  now?: string,
): DimensionOptions => {
  const label = patch.label === null ? undefined : patch.label ?? dimension.label;
  const updatedAt = now ?? patch.updatedAt ?? dimension.updatedAt;
  return {
    units: patch.units ?? dimension.units,
    precision: patch.precision ?? dimension.precision,
    ...(label ? { label } : {}),
    ...(updatedAt ? { updatedAt } : {}),
  };
};

const regenerated = (id: ID, dimension: DimensionObject, patch: DimensionOptionPatch = {}, now?: string): DimensionObject => ({
  ...makeDimensionObject(patch.start ?? dimension.start, patch.end ?? dimension.end, dimensionOptions(dimension, patch, now)),
  id,
});

export const setDimensionOptions = (
  doc: Document,
  dimensionId: ID,
  patch: DimensionOptionPatch,
  opts: { now?: string } = {},
): boolean => {
  const group = dimensionGroup(doc, dimensionId);
  if (!group) return false;
  group.dimension = regenerated(group.id, group.dimension!, patch, opts.now);
  group.children = buildDimensionChildren(group.dimension);
  return true;
};

export const regenerateDimension = (doc: Document, dimensionId: ID): boolean => {
  const group = dimensionGroup(doc, dimensionId);
  if (!group) return false;
  group.dimension = regenerated(group.id, group.dimension!);
  group.children = buildDimensionChildren(group.dimension);
  return true;
};

export const detachDimension = (doc: Document, ids: Iterable<ID>): ID[] => {
  const detached: ID[] = [];
  for (const id of ids) {
    const group = dimensionGroup(doc, id);
    if (!group) continue;
    delete group.dimension;
    detached.push(group.id);
  }
  return detached;
};
