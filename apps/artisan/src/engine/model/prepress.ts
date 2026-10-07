// ─────────────────────────────────────────────────────────────
// model/prepress — ink and separation helpers
// ─────────────────────────────────────────────────────────────
// Pure model helpers for print/prepress metadata. Rendering remains RGB/SVG;
// these functions provide a separation-preview view over the document model.

import { BLACK, rgba, rgbToCmyk, type RGBA } from "../color";
import { hasExplicitAppearance, appearancePaints } from "./appearance";
import type { ID, InkKind, Item, Paint, PrepressSettings, PrintSettings, ProcessInkName, SeparationInk } from "./types";

export interface PaintSeparationContribution {
  id: string;
  name: ProcessInkName | string;
  kind: InkKind;
  color: RGBA;
  coverage: number;
  tint?: number;
}

const PROCESS_INK_COLORS: Record<ProcessInkName, RGBA> = {
  Cyan: rgba(0, 174, 239),
  Magenta: rgba(236, 0, 140),
  Yellow: rgba(255, 242, 0),
  Black: BLACK,
};

const PROCESS_COMPONENTS: Array<{ key: "c" | "m" | "y" | "k"; name: ProcessInkName }> = [
  { key: "c", name: "Cyan" },
  { key: "m", name: "Magenta" },
  { key: "y", name: "Yellow" },
  { key: "k", name: "Black" },
];

const clampPercent = (value: number): number => Math.max(0, Math.min(100, value));
const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));
const clampPositive = (value: number, fallback: number): number =>
  Number.isFinite(value) ? Math.max(0, value) : fallback;

export const defaultPrintSettings = (): PrintSettings => ({
  target: "active-artboard",
  pageSize: "artboard",
  orientation: "auto",
  scaleMode: "fit",
  scale: 100,
  tileArtwork: false,
  marks: {
    trim: false,
    registration: false,
    colorBars: false,
    pageInfo: false,
  },
  bleed: {
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
  },
  preserveSpotColors: true,
  flattenTransparency: false,
  pdfPreset: "artisan-editable",
});

export const resolvedPrintSettings = (settings?: Partial<PrintSettings>): PrintSettings => {
  const base = defaultPrintSettings();
  const bleed = { ...base.bleed, ...(settings?.bleed ?? {}) };
  return {
    ...base,
    ...settings,
    scale: clampPositive(settings?.scale ?? base.scale, base.scale),
    tileArtwork: settings?.tileArtwork ?? base.tileArtwork,
    marks: { ...base.marks, ...(settings?.marks ?? {}) },
    bleed: {
      top: clampPositive(bleed.top, base.bleed.top),
      right: clampPositive(bleed.right, base.bleed.right),
      bottom: clampPositive(bleed.bottom, base.bleed.bottom),
      left: clampPositive(bleed.left, base.bleed.left),
    },
    preserveSpotColors: settings?.preserveSpotColors ?? base.preserveSpotColors,
    flattenTransparency: settings?.flattenTransparency ?? base.flattenTransparency,
  };
};

export const processInkId = (name: ProcessInkName): string => `process:${name}`;

export const defaultProcessInks = (): SeparationInk[] =>
  (Object.keys(PROCESS_INK_COLORS) as ProcessInkName[]).map((name) => ({
    id: processInkId(name),
    name,
    kind: "process",
    color: { ...PROCESS_INK_COLORS[name] },
    enabled: true,
  }));

export const spotInk = (name: string, color: RGBA, id: ID = `spot:${name}`): SeparationInk => ({
  id,
  name,
  kind: "spot",
  color: { ...color },
  enabled: true,
});

export const spotPaint = (
  name: string,
  color: RGBA,
  opts: { id?: ID; tint?: number; color?: RGBA } = {},
): Paint => ({
  type: "solid",
  color: { ...color },
  ink: {
    id: opts.id,
    name,
    kind: "spot",
    color: { ...(opts.color ?? color) },
    tint: opts.tint ?? 100,
  },
});

export const processPaint = (
  color: RGBA,
  components?: Partial<Record<"c" | "m" | "y" | "k", number>>,
): Paint => ({
  type: "solid",
  color: { ...color },
  ...(components ? { ink: { name: "Process", kind: "process", color: { ...color }, components } } : {}),
});

export const resolvedPrepressSettings = (settings?: PrepressSettings): PrepressSettings => {
  const inks = new Map(defaultProcessInks().map((ink) => [ink.id, ink]));
  for (const ink of settings?.inks ?? []) inks.set(ink.id, ink);
  return {
    overprintPreview: settings?.overprintPreview ?? false,
    inks: [...inks.values()],
    print: resolvedPrintSettings(settings?.print),
    ...(settings?.proofProfile ? { proofProfile: settings.proofProfile } : {}),
    ...(settings?.inkLimit !== undefined ? { inkLimit: settings.inkLimit } : {}),
  };
};

const processContributions = (
  components: Partial<Record<"c" | "m" | "y" | "k", number>>,
): PaintSeparationContribution[] =>
  PROCESS_COMPONENTS.flatMap(({ key, name }) => {
    const coverage = clampPercent(components[key] ?? 0);
    if (coverage <= 0) return [];
    return [{
      id: processInkId(name),
      name,
      kind: "process",
      color: { ...PROCESS_INK_COLORS[name] },
      coverage,
    }];
  });

const solidContributions = (paint: Extract<Paint, { type: "solid" }>): PaintSeparationContribution[] => {
  const ink = paint.ink;
  const alpha = clamp01(paint.color.a);
  if (ink?.kind === "spot") {
    const tint = clampPercent(ink.tint ?? 100);
    const coverage = tint * alpha;
    if (coverage <= 0) return [];
    return [{
      id: ink.id ?? `spot:${ink.name}`,
      name: ink.name,
      kind: "spot",
      color: { ...(ink.color ?? paint.color) },
      coverage,
      tint,
    }];
  }

  return processContributions(ink?.components ?? rgbToCmyk(paint.color)).map((contribution) => ({
    ...contribution,
    coverage: contribution.coverage * alpha,
  }));
};

const mergeContributions = (sets: PaintSeparationContribution[][]): PaintSeparationContribution[] => {
  const byId = new Map<string, PaintSeparationContribution>();
  for (const contribution of sets.flat()) {
    const existing = byId.get(contribution.id);
    if (!existing || contribution.coverage > existing.coverage) {
      byId.set(contribution.id, {
        ...contribution,
        color: { ...contribution.color },
      });
    }
  }
  return [...byId.values()];
};

const itemPaints = (item: Item): Paint[] => {
  const paints = hasExplicitAppearance(item) ? appearancePaints(item) : [item.fill, item.stroke.paint];
  if (item.type === "text" && item.runs) {
    for (const run of item.runs) if (run.fill) paints.push(run.fill);
  }
  return paints;
};

const patternContributions = (items: Item[], depth: number): PaintSeparationContribution[] => {
  if (depth > 4) return [];
  const sets: PaintSeparationContribution[][] = [];
  const walk = (item: Item) => {
    if (item.type === "group") {
      item.children.forEach(walk);
      return;
    }
    itemPaints(item).forEach((paint) => sets.push(paintSeparationContributions(paint, depth + 1)));
  };
  items.forEach(walk);
  return mergeContributions(sets);
};

export const paintSeparationContributions = (
  paint: Paint,
  depth = 0,
): PaintSeparationContribution[] => {
  if (paint.type === "none") return [];
  if (paint.type === "solid") return solidContributions(paint);
  if (paint.type === "gradient") {
    return mergeContributions(
      paint.gradient.stops.map((stop) => solidContributions({ type: "solid", color: stop.color })),
    );
  }
  return patternContributions(paint.pattern.tile, depth);
};
