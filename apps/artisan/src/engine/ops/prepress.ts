// ─────────────────────────────────────────────────────────────
// ops/prepress — overprint and separation metadata edits
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import { resolvedPrepressSettings, resolvedPrintSettings, spotInk } from "../model/prepress";
import { eachItem } from "../model/query";
import type { Document, ID, Item, PrintBleed, PrintMarks, PrintSettings, SeparationInk } from "../model/types";

export type OverprintTarget = "fill" | "stroke" | "both";
export type PrintSettingsPatch = Partial<Omit<PrintSettings, "bleed" | "marks">> & {
  bleed?: Partial<PrintBleed>;
  marks?: Partial<PrintMarks>;
};

const applyToItem = (item: Item, fn: (it: Item) => void) => {
  if (item.type === "group") {
    item.children.forEach((child) => applyToItem(child, fn));
  } else {
    fn(item);
  }
};

const forSelection = (doc: Document, ids: Iterable<ID>, fn: (it: Item) => boolean): ID[] => {
  const selected = new Set(ids);
  const changed: ID[] = [];
  eachItem(doc, (item) => {
    if (!selected.has(item.id)) return;
    applyToItem(item, (leaf) => {
      if (fn(leaf)) changed.push(leaf.id);
    });
  });
  return changed;
};

export const setOverprint = (
  doc: Document,
  ids: Iterable<ID>,
  target: OverprintTarget,
  value: boolean,
): ID[] =>
  forSelection(doc, ids, (item) => {
    let changed = false;
    if ((target === "fill" || target === "both") && item.overprintFill !== value) {
      item.overprintFill = value;
      changed = true;
    }
    if ((target === "stroke" || target === "both") && item.overprintStroke !== value) {
      item.overprintStroke = value;
      changed = true;
    }
    return changed;
  });

export const setOverprintPreview = (doc: Document, value: boolean): void => {
  doc.prepress = {
    ...(doc.prepress ?? {}),
    overprintPreview: value,
  };
};

export const upsertSeparationInk = (doc: Document, ink: SeparationInk): void => {
  const next = cloneDeep(ink);
  doc.prepress = {
    ...(doc.prepress ?? { overprintPreview: false }),
    inks: [...(doc.prepress?.inks ?? []).filter((existing) => existing.id !== next.id), next],
  };
};

export const setInkEnabled = (doc: Document, id: ID, enabled: boolean): boolean => {
  const ink = resolvedPrepressSettings(doc.prepress).inks?.find((candidate) => candidate.id === id);
  if (!ink || ink.enabled === enabled) return false;
  upsertSeparationInk(doc, { ...ink, enabled });
  return true;
};

export const upsertSpotInk = (
  doc: Document,
  name: string,
  color: SeparationInk["color"],
  opts: Partial<Pick<SeparationInk, "id" | "enabled">> = {},
): SeparationInk => {
  const ink = {
    ...spotInk(name, color, opts.id),
    ...(opts.enabled !== undefined ? { enabled: opts.enabled } : {}),
  };
  upsertSeparationInk(doc, ink);
  return ink;
};

export const setPrintSettings = (doc: Document, patch: PrintSettingsPatch): PrintSettings => {
  const current = resolvedPrintSettings(doc.prepress?.print);
  const next = resolvedPrintSettings({
    ...current,
    ...patch,
    bleed: { ...current.bleed, ...(patch.bleed ?? {}) },
    marks: { ...current.marks, ...(patch.marks ?? {}) },
  });
  doc.prepress = {
    ...(doc.prepress ?? { overprintPreview: false }),
    print: next,
  };
  return next;
};
