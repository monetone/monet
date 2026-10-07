// ─────────────────────────────────────────────────────────────
// ops/brushes — document Brushes panel operations
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import {
  brushApplication,
  brushSettings,
  makeCalligraphicBrushDefinition,
  normalizeCalligraphicBrushSettings,
} from "../model/brushes";
import { defaultBrushes, newId } from "../model/factory";
import { paintedStroke, setPrimaryStroke } from "../model/appearance";
import { eachItem } from "../model/query";
import type {
  BrushDefinition,
  CalligraphicBrushDefinition,
  CalligraphicBrushSettings,
  Document,
  ID,
} from "../model/types";

const brushList = (doc: Document): BrushDefinition[] => {
  if (!doc.brushes || !doc.brushes.length) doc.brushes = defaultBrushes();
  return doc.brushes;
};

export const ensureBrushes = (doc: Document): BrushDefinition[] => brushList(doc);

export const getBrushDefinition = (doc: Document, brushId?: ID | null): BrushDefinition | null => {
  const brushes = brushList(doc);
  return brushes.find((brush) => brush.id === brushId) ?? brushes[0] ?? null;
};

export const addCalligraphicBrush = (
  doc: Document,
  opts: Partial<CalligraphicBrushSettings> & { id?: ID; name?: string; now?: string } = {},
): CalligraphicBrushDefinition => {
  const brush = makeCalligraphicBrushDefinition(
    opts.id ?? newId("br"),
    opts.name ?? `Calligraphic ${brushList(doc).length + 1}`,
    opts,
    opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {},
  );
  brushList(doc).push(brush);
  return brush;
};

export const duplicateBrush = (
  doc: Document,
  brushId: ID,
  opts: { name?: string; now?: string } = {},
): BrushDefinition | null => {
  const source = getBrushDefinition(doc, brushId);
  if (!source) return null;
  const clone: BrushDefinition = {
    ...cloneDeep(source),
    id: newId("br"),
    name: opts.name ?? `${source.name} copy`,
    ...(opts.now ? { createdAt: opts.now, updatedAt: opts.now } : {}),
  };
  brushList(doc).push(clone);
  return clone;
};

export const updateCalligraphicBrush = (
  doc: Document,
  brushId: ID,
  patch: Partial<CalligraphicBrushSettings> & { name?: string; now?: string },
): CalligraphicBrushDefinition | null => {
  const brush = getBrushDefinition(doc, brushId);
  if (!brush || brush.kind !== "calligraphic") return null;
  const settings = normalizeCalligraphicBrushSettings({ ...brushSettings(brush), ...patch });
  brush.name = patch.name ?? brush.name;
  brush.size = settings.size;
  brush.angle = settings.angle;
  brush.roundness = settings.roundness;
  brush.paintSource = settings.paintSource;
  if (patch.now) brush.updatedAt = patch.now;
  return brush;
};

export const deleteBrushDefinition = (doc: Document, brushId: ID): boolean => {
  const brushes = brushList(doc);
  if (brushes.length <= 1) return false;
  const index = brushes.findIndex((brush) => brush.id === brushId);
  if (index < 0) return false;
  brushes.splice(index, 1);
  return true;
};

export const applyBrushToItems = (
  doc: Document,
  ids: Iterable<ID>,
  brushId: ID,
  opts: { appliedAt?: string } = {},
): ID[] => {
  const brush = getBrushDefinition(doc, brushId);
  if (!brush) return [];
  const selected = new Set(ids);
  const applied: ID[] = [];
  const settings = brushSettings(brush);
  eachItem(doc, (item, loc) => {
    if (item.type === "group" || (!selected.has(item.id) && !loc.ancestors.some((group) => selected.has(group.id)))) return;
    setPrimaryStroke(item, {
      ...paintedStroke(item),
      width: settings.size,
      cap: "round",
      join: "round",
    });
    item.brush = brushApplication(brush, { expanded: false, appliedAt: opts.appliedAt });
    applied.push(item.id);
  });
  return applied;
};

export const makeBrushApplication = brushApplication;
