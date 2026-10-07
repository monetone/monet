// ─────────────────────────────────────────────────────────────
// ops/symbols — symbol library and linked instance operations
// ─────────────────────────────────────────────────────────────

import { IDENTITY, translation, type Matrix } from "../geometry/matrix";
import { defaultStroke, makeGroup, newId, noPaint } from "../model/factory";
import { eachItem, findItem } from "../model/query";
import type { Document, GroupItem, ID, Item, SymbolDefinition } from "../model/types";
import { addItem, cloneItemDeep } from "./items";

export interface SymbolCreateResult {
  definition: SymbolDefinition;
  instanceId?: ID;
}

export interface SymbolInstanceOptions {
  name?: string;
  transform?: Matrix;
  layerId?: ID;
}

const symbolList = (doc: Document): SymbolDefinition[] => {
  doc.symbols ??= [];
  return doc.symbols;
};

const cloneSymbolItems = (items: Item[]): Item[] => items.map((item) => cloneItemDeep(item));

export const getSymbolDefinition = (doc: Document, symbolId: ID): SymbolDefinition | null =>
  doc.symbols?.find((symbol) => symbol.id === symbolId) ?? null;

const addSymbolDefinition = (
  doc: Document,
  name: string,
  items: Item[],
  opts: { id?: ID; now?: string } = {},
): SymbolDefinition => {
  const definition: SymbolDefinition = {
    id: opts.id ?? newId("sym"),
    name,
    items: cloneSymbolItems(items),
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  };
  symbolList(doc).push(definition);
  return definition;
};

export const makeSymbolInstance = (
  definition: SymbolDefinition,
  opts: Omit<SymbolInstanceOptions, "layerId"> = {},
): GroupItem => {
  const group = makeGroup(cloneSymbolItems(definition.items), {
    name: opts.name ?? definition.name,
    transform: opts.transform ?? { ...IDENTITY },
    fill: noPaint(),
    stroke: defaultStroke(noPaint()),
  });
  group.symbolInstance = { symbolId: definition.id };
  return group;
};

export const placeSymbolInstance = (
  doc: Document,
  symbolId: ID,
  opts: SymbolInstanceOptions = {},
): ID | null => {
  const definition = getSymbolDefinition(doc, symbolId);
  if (!definition) return null;
  const instance = makeSymbolInstance(definition, opts);
  addItem(doc, instance, opts.layerId);
  return instance.id;
};

export const createSymbolFromSelection = (
  doc: Document,
  ids: Iterable<ID>,
  name: string,
  opts: { replaceSelection?: boolean; now?: string } = {},
): SymbolCreateResult | null => {
  const locs = [...new Set(ids)]
    .map((id) => findItem(doc, id))
    .filter((loc): loc is NonNullable<typeof loc> => !!loc)
    .sort((a, b) => a.layerIndex - b.layerIndex || a.index - b.index);
  if (!locs.length) return null;

  const definition = addSymbolDefinition(doc, name, locs.map((loc) => loc.item), { now: opts.now });
  if (!opts.replaceSelection) return { definition };

  const container = locs[0].container;
  if (!locs.every((loc) => loc.container === container)) return { definition };

  const firstIndex = Math.min(...locs.map((loc) => loc.index));
  const instance = makeSymbolInstance(definition, { name, transform: translation(0, 0) });
  for (const loc of [...locs].sort((a, b) => b.index - a.index)) {
    container.splice(loc.index, 1);
  }
  container.splice(firstIndex, 0, instance);
  return { definition, instanceId: instance.id };
};

const syncSymbolInstances = (doc: Document, symbolId: ID): ID[] => {
  const definition = getSymbolDefinition(doc, symbolId);
  if (!definition) return [];
  const targets: ID[] = [];
  eachItem(doc, (item) => {
    if (item.type !== "group") return;
    if (item.symbolInstance?.symbolId !== symbolId || item.symbolInstance.detached) return;
    targets.push(item.id);
  });
  const synced: ID[] = [];
  for (const id of targets) {
    const item = findItem(doc, id)?.item;
    if (item?.type !== "group" || item.symbolInstance?.symbolId !== symbolId || item.symbolInstance.detached) continue;
    item.children = cloneSymbolItems(definition.items);
    item.name = item.name || definition.name;
    synced.push(item.id);
  }
  return synced;
};

const containsSymbolInstance = (item: Item, symbolId: ID): boolean =>
  item.type === "group" && (
    item.symbolInstance?.symbolId === symbolId || item.children.some((child) => containsSymbolInstance(child, symbolId))
  );

export const redefineSymbolFromSelection = (
  doc: Document,
  symbolId: ID,
  ids: Iterable<ID>,
  opts: { now?: string } = {},
): boolean => {
  const definition = getSymbolDefinition(doc, symbolId);
  if (!definition) return false;
  const items = [...new Set(ids)]
    .map((id) => findItem(doc, id)?.item)
    .filter((item): item is Item => !!item);
  if (!items.length || items.some((item) => containsSymbolInstance(item, symbolId))) return false;
  definition.items = cloneSymbolItems(items);
  if (opts.now) definition.updatedAt = opts.now;
  syncSymbolInstances(doc, symbolId);
  return true;
};

export const swapSymbol = (doc: Document, ids: Iterable<ID>, symbolId: ID): ID[] => {
  const definition = getSymbolDefinition(doc, symbolId);
  if (!definition) return [];
  const swapped: ID[] = [];
  for (const id of new Set(ids)) {
    const item = findItem(doc, id)?.item;
    if (item?.type !== "group" || !item.symbolInstance) continue;
    item.symbolInstance = { symbolId };
    item.children = cloneSymbolItems(definition.items);
    item.name = definition.name;
    swapped.push(item.id);
  }
  return swapped;
};

export const breakLink = (doc: Document, ids: Iterable<ID>): ID[] => {
  const selected = new Set(ids);
  const broken: ID[] = [];
  eachItem(doc, (item) => {
    if (!selected.has(item.id) || item.type !== "group" || !item.symbolInstance) return;
    delete item.symbolInstance;
    broken.push(item.id);
  });
  return broken;
};

export const deleteSymbolDefinition = (doc: Document, symbolId: ID, opts: { detachInstances?: boolean } = {}): boolean => {
  const symbols = doc.symbols ?? [];
  const index = symbols.findIndex((symbol) => symbol.id === symbolId);
  if (index < 0) return false;
  symbols.splice(index, 1);
  if (opts.detachInstances) {
    eachItem(doc, (item) => {
      if (item.type === "group" && item.symbolInstance?.symbolId === symbolId) delete item.symbolInstance;
    });
  }
  return true;
};

export const cloneDefinition = (
  doc: Document,
  symbolId: ID,
  opts: { name?: string; now?: string } = {},
): SymbolDefinition | null => {
  const source = getSymbolDefinition(doc, symbolId);
  if (!source) return null;
  return addSymbolDefinition(doc, opts.name ?? `${source.name} copy`, source.items, { now: opts.now });
};
