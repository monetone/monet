// ─────────────────────────────────────────────────────────────
// ops/graphs — data-backed graph creation and regeneration
// ─────────────────────────────────────────────────────────────

import {
  buildGraphChildren,
  makeGraphObject,
  normalizeGraphData,
} from "../model/graphs";
import { findItem } from "../model/query";
import type { Document, GraphDatum, GraphKind, GraphObject, GroupItem, ID } from "../model/types";

export type GraphOptionPatch = Partial<Omit<GraphObject, "id" | "kind" | "data">> & {
  kind?: GraphKind;
  data?: GraphDatum[];
};

const graphGroup = (doc: Document, id: ID): GroupItem | null => {
  const item = findItem(doc, id)?.item;
  return item?.type === "group" && item.graph ? item : null;
};

const regenerated = (graph: GraphObject): GraphObject => ({
  ...makeGraphObject(graph.kind, graph.width, graph.height, {
    data: graph.data,
    showAxes: graph.showAxes,
    showLegend: graph.showLegend,
    stacked: graph.stacked,
    updatedAt: graph.updatedAt,
  }),
  id: graph.id,
});

export const updateGraphData = (
  doc: Document,
  graphId: ID,
  data: GraphDatum[],
  opts: { now?: string } = {},
): boolean => {
  const group = graphGroup(doc, graphId);
  if (!group) return false;
  group.graph = regenerated({
    ...group.graph!,
    id: group.id,
    data: normalizeGraphData(data),
    ...(opts.now ? { updatedAt: opts.now } : {}),
  });
  group.children = buildGraphChildren(group.graph);
  return true;
};

export const setGraphOptions = (
  doc: Document,
  graphId: ID,
  patch: GraphOptionPatch,
  opts: { now?: string } = {},
): boolean => {
  const group = graphGroup(doc, graphId);
  if (!group) return false;
  group.graph = regenerated({
    ...group.graph!,
    ...patch,
    id: group.id,
    data: patch.data ? normalizeGraphData(patch.data) : group.graph!.data,
    ...(opts.now ? { updatedAt: opts.now } : {}),
  });
  group.children = buildGraphChildren(group.graph);
  if (patch.kind) group.name = group.name || `${patch.kind[0].toUpperCase()}${patch.kind.slice(1)} Graph`;
  return true;
};

export const regenerateGraph = (doc: Document, graphId: ID): boolean => {
  const group = graphGroup(doc, graphId);
  if (!group) return false;
  group.graph = regenerated({ ...group.graph!, id: group.id });
  group.children = buildGraphChildren(group.graph);
  return true;
};

export const detachGraph = (doc: Document, ids: Iterable<ID>): ID[] => {
  const detached: ID[] = [];
  for (const id of ids) {
    const group = graphGroup(doc, id);
    if (!group) continue;
    delete group.graph;
    detached.push(group.id);
  }
  return detached;
};
