// model/appearance - Illustrator-style appearance stack helpers

import { cloneDeep } from "../clone";
import type { AppearanceEntry, Effect, Item, Paint, Stroke } from "./types";

const visibleEntry = (entry: AppearanceEntry): boolean => entry.visible !== false;

const cloneStroke = (stroke: Stroke): Stroke => ({
  paint: cloneDeep(stroke.paint),
  width: stroke.width,
  cap: stroke.cap,
  join: stroke.join,
  miterLimit: stroke.miterLimit,
  dash: [...stroke.dash],
  dashOffset: stroke.dashOffset,
  align: stroke.align,
  ...(stroke.widthProfile ? { widthProfile: [...stroke.widthProfile] } : {}),
  ...(stroke.startArrow ? { startArrow: stroke.startArrow } : {}),
  ...(stroke.endArrow ? { endArrow: stroke.endArrow } : {}),
});

const last = <T>(values: T[]): T | undefined => values[values.length - 1];

/** True when an item carries an explicit ordered Appearance stack. */
export const hasExplicitAppearance = (item: Item): boolean => !!item.appearance?.entries.length;

/** Legacy fill/stroke as a stack-shaped view, used when no explicit stack exists. */
export const legacyAppearanceEntries = (item: Item): AppearanceEntry[] => [
  { id: `${item.id}:fill`, kind: "fill", paint: item.fill },
  { id: `${item.id}:stroke`, kind: "stroke", stroke: item.stroke },
];

/** Visible paint entries in bottom-to-top order. */
export const appearanceEntries = (item: Item): AppearanceEntry[] =>
  hasExplicitAppearance(item) ? item.appearance!.entries.filter(visibleEntry) : legacyAppearanceEntries(item);

/** Paints referenced by the visible appearance, in paint order. */
export const appearancePaints = (item: Item): Paint[] =>
  appearanceEntries(item).map((entry) => (entry.kind === "fill" ? entry.paint : entry.stroke.paint));

/** Topmost visible fill that actually paints. */
export const paintedFill = (item: Item): Paint => {
  let paint: Paint | undefined;
  for (const entry of appearanceEntries(item)) {
    if (entry.kind === "fill" && entry.paint.type !== "none") paint = entry.paint;
  }
  return paint ?? (hasExplicitAppearance(item) ? { type: "none" } : item.fill);
};

/** Topmost visible stroke that actually paints. */
export const paintedStroke = (item: Item): Stroke => {
  let stroke: Stroke | undefined;
  for (const entry of appearanceEntries(item)) {
    if (entry.kind === "stroke" && entry.stroke.paint.type !== "none") stroke = entry.stroke;
  }
  return stroke ?? (hasExplicitAppearance(item) ? { ...item.stroke, paint: { type: "none" } } : item.stroke);
};

/** Entry-level effects, including placement metadata that targets this entry. */
export const appearanceEntryEffects = (item: Item, entry: AppearanceEntry): Effect[] => {
  const placed =
    item.appearance?.effectPlacements
      ?.filter((placement) => placement.scope === "entry" && placement.entryId === entry.id)
      .map((placement) => placement.effect) ?? [];
  return [...(entry.effects ?? []), ...placed];
};

export const setPrimaryFill = (item: Item, paint: Paint): void => {
  item.fill = cloneDeep(paint);
  if (!hasExplicitAppearance(item)) return;
  const fills = item.appearance!.entries.filter((e): e is Extract<AppearanceEntry, { kind: "fill" }> => e.kind === "fill");
  const entry = last(fills.filter((e) => visibleEntry(e) && e.paint.type !== "none")) ?? last(fills.filter(visibleEntry)) ?? fills[0];
  if (entry) entry.paint = cloneDeep(paint);
  else item.appearance!.entries.unshift({ id: `${item.id}:fill`, kind: "fill", paint: cloneDeep(paint) });
};

export const setPrimaryStroke = (item: Item, stroke: Stroke): void => {
  item.stroke = cloneStroke(stroke);
  if (!hasExplicitAppearance(item)) return;
  const strokes = item.appearance!.entries.filter((e): e is Extract<AppearanceEntry, { kind: "stroke" }> => e.kind === "stroke");
  const entry = last(strokes.filter((e) => visibleEntry(e) && e.stroke.paint.type !== "none")) ?? last(strokes.filter(visibleEntry)) ?? strokes[0];
  if (entry) entry.stroke = cloneStroke(stroke);
  else item.appearance!.entries.push({ id: `${item.id}:stroke`, kind: "stroke", stroke: cloneStroke(stroke) });
};

/** Keep legacy primary fields aligned to the topmost visible painted entries. */
export const syncPrimaryFromAppearance = (item: Item): void => {
  if (!hasExplicitAppearance(item)) return;
  const fills = item.appearance!.entries.filter((e): e is Extract<AppearanceEntry, { kind: "fill" }> => e.kind === "fill");
  const strokes = item.appearance!.entries.filter((e): e is Extract<AppearanceEntry, { kind: "stroke" }> => e.kind === "stroke");
  const fill = last(fills.filter((e) => visibleEntry(e) && e.paint.type !== "none")) ?? last(fills.filter(visibleEntry)) ?? fills[0];
  const stroke = last(strokes.filter((e) => visibleEntry(e) && e.stroke.paint.type !== "none")) ?? last(strokes.filter(visibleEntry)) ?? strokes[0];
  if (fill) item.fill = cloneDeep(fill.paint);
  if (stroke) item.stroke = cloneStroke(stroke.stroke);
};
