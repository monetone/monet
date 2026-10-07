// ─────────────────────────────────────────────────────────────
// ops/appearance — Appearance panel stack editing
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { syncPrimaryFromAppearance } from "../model/appearance";
import { eachItem } from "../model/query";
import { newId } from "../model/factory";
import type { AppearanceEntry, AppearanceStack, BlendMode, Document, ID, Item, Paint, Stroke } from "../model/types";

export type AppearanceMoveDirection = "up" | "down";

export interface AppearanceEntryPatch {
  name?: string;
  visible?: boolean;
  opacity?: number;
  blendMode?: BlendMode;
  overprint?: boolean;
  paint?: Paint;
  stroke?: Partial<Stroke>;
}

const clampOpacity = (opacity: number): number => Math.max(0, Math.min(1, Number.isFinite(opacity) ? opacity : 1));

const legacyEntryName = (kind: AppearanceEntry["kind"]): string => (kind === "fill" ? "Fill" : "Stroke");

export const canAddPaint = (item: Item): boolean => item.type !== "group" && item.type !== "image";

export const ensureAppearanceStack = (item: Item): AppearanceStack => {
  if (item.appearance?.entries.length) return item.appearance;
  item.appearance = {
    entries: [
      { id: `${item.id}:fill`, name: legacyEntryName("fill"), kind: "fill", paint: cloneDeep(item.fill) },
      { id: `${item.id}:stroke`, name: legacyEntryName("stroke"), kind: "stroke", stroke: cloneDeep(item.stroke) },
    ],
    ...(item.effects?.length
      ? { effectPlacements: item.effects.map((effect) => ({ scope: "object" as const, effect: cloneDeep(effect) })) }
      : {}),
  };
  return item.appearance;
};

const selectedItems = (doc: Document, ids: Iterable<ID>, fn: (item: Item) => boolean | void): ID[] => {
  const set = new Set(ids);
  const changed: ID[] = [];
  eachItem(doc, (item) => {
    if (!set.has(item.id)) return;
    if (fn(item) !== false) changed.push(item.id);
  });
  return changed;
};

const insertEntry = (stack: AppearanceStack, entry: AppearanceEntry, index?: number): void => {
  const at = index == null ? stack.entries.length : Math.max(0, Math.min(stack.entries.length, Math.trunc(index)));
  stack.entries.splice(at, 0, entry);
};

export const addFill = (
  doc: Document,
  ids: Iterable<ID>,
  paint: Paint,
  opts: { name?: string; index?: number; opacity?: number } = {},
): AppearanceEntry[] => {
  const added: AppearanceEntry[] = [];
  selectedItems(doc, ids, (item) => {
    if (!canAddPaint(item)) return false;
    const entry: AppearanceEntry = {
      id: newId("ap"),
      name: opts.name ?? "New Fill",
      kind: "fill",
      paint: cloneDeep(paint),
      ...(opts.opacity != null ? { opacity: clampOpacity(opts.opacity) } : {}),
    };
    insertEntry(ensureAppearanceStack(item), entry, opts.index);
    syncPrimaryFromAppearance(item);
    added.push(cloneDeep(entry));
  });
  return added;
};

export const addStroke = (
  doc: Document,
  ids: Iterable<ID>,
  stroke: Stroke,
  opts: { name?: string; index?: number; opacity?: number } = {},
): AppearanceEntry[] => {
  const added: AppearanceEntry[] = [];
  selectedItems(doc, ids, (item) => {
    if (!canAddPaint(item)) return false;
    const entry: AppearanceEntry = {
      id: newId("ap"),
      name: opts.name ?? "New Stroke",
      kind: "stroke",
      stroke: cloneDeep(stroke),
      ...(opts.opacity != null ? { opacity: clampOpacity(opts.opacity) } : {}),
    };
    insertEntry(ensureAppearanceStack(item), entry, opts.index);
    syncPrimaryFromAppearance(item);
    added.push(cloneDeep(entry));
  });
  return added;
};

export const updateEntry = (doc: Document, ids: Iterable<ID>, entryId: ID, patch: AppearanceEntryPatch): ID[] =>
  selectedItems(doc, ids, (item) => {
    const stack = ensureAppearanceStack(item);
    const entry = stack.entries.find((e) => e.id === entryId);
    if (!entry) return false;
    if (patch.name != null) entry.name = patch.name;
    if (patch.visible != null) entry.visible = patch.visible;
    if (patch.opacity != null) entry.opacity = clampOpacity(patch.opacity);
    if (patch.blendMode != null) entry.blendMode = patch.blendMode;
    if (patch.overprint != null) entry.overprint = patch.overprint;
    if (entry.kind === "fill" && patch.paint) entry.paint = cloneDeep(patch.paint);
    if (entry.kind === "stroke" && patch.stroke) entry.stroke = { ...entry.stroke, ...cloneDeep(patch.stroke) };
    syncPrimaryFromAppearance(item);
  });

export const deleteEntry = (doc: Document, ids: Iterable<ID>, entryId: ID): ID[] =>
  selectedItems(doc, ids, (item) => {
    const stack = ensureAppearanceStack(item);
    if (stack.entries.length <= 1) return false;
    const index = stack.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return false;
    stack.entries.splice(index, 1);
    if (stack.effectPlacements) {
      stack.effectPlacements = stack.effectPlacements.filter((placement) => placement.entryId !== entryId);
    }
    syncPrimaryFromAppearance(item);
  });

export const moveEntry = (doc: Document, ids: Iterable<ID>, entryId: ID, direction: AppearanceMoveDirection): ID[] =>
  selectedItems(doc, ids, (item) => {
    const stack = ensureAppearanceStack(item);
    const index = stack.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return false;
    const next = direction === "up" ? index + 1 : index - 1;
    if (next < 0 || next >= stack.entries.length) return false;
    const [entry] = stack.entries.splice(index, 1);
    stack.entries.splice(next, 0, entry);
    syncPrimaryFromAppearance(item);
  });

export const duplicateEntry = (doc: Document, ids: Iterable<ID>, entryId: ID): AppearanceEntry[] => {
  const added: AppearanceEntry[] = [];
  selectedItems(doc, ids, (item) => {
    const stack = ensureAppearanceStack(item);
    const index = stack.entries.findIndex((entry) => entry.id === entryId);
    if (index < 0) return false;
    const copy: AppearanceEntry = { ...cloneDeep(stack.entries[index]), id: newId("ap"), name: `${stack.entries[index].name ?? legacyEntryName(stack.entries[index].kind)} copy` } as AppearanceEntry;
    stack.entries.splice(index + 1, 0, copy);
    syncPrimaryFromAppearance(item);
    added.push(cloneDeep(copy));
  });
  return added;
};
