// ─────────────────────────────────────────────────────────────
// model/brushes — document-level Brushes panel definitions
// ─────────────────────────────────────────────────────────────

import { cloneDeep } from "../clone";
import type {
  BrushApplication,
  BrushDefinition,
  CalligraphicBrushDefinition,
  CalligraphicBrushSettings,
  ID,
} from "./types";

export const DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS: CalligraphicBrushSettings = {
  size: 10,
  angle: -45,
  roundness: 1,
  paintSource: "stroke",
};

const finite = (value: number, fallback: number): number =>
  Number.isFinite(value) ? value : fallback;

const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const normalizeCalligraphicBrushSettings = (
  settings: Partial<CalligraphicBrushSettings> = {},
): CalligraphicBrushSettings => ({
  size: clamp(finite(settings.size ?? DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.size, DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.size), 0.1, 500),
  angle: finite(settings.angle ?? DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.angle, DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.angle),
  roundness: clamp(finite(settings.roundness ?? DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.roundness, DEFAULT_CALLIGRAPHIC_BRUSH_SETTINGS.roundness), 0.01, 1),
  paintSource: settings.paintSource === "fill" ? "fill" : "stroke",
});

export const makeCalligraphicBrushDefinition = (
  id: ID,
  name = "Basic Calligraphic",
  settings: Partial<CalligraphicBrushSettings> = {},
  opts: { createdAt?: string; updatedAt?: string } = {},
): CalligraphicBrushDefinition => ({
  id,
  name,
  kind: "calligraphic",
  ...normalizeCalligraphicBrushSettings(settings),
  ...(opts.createdAt ? { createdAt: opts.createdAt } : {}),
  ...(opts.updatedAt ? { updatedAt: opts.updatedAt } : {}),
});

export const cloneBrushDefinition = <T extends BrushDefinition>(brush: T): T => cloneDeep(brush);

export const brushSettings = (brush: BrushDefinition): CalligraphicBrushSettings =>
  normalizeCalligraphicBrushSettings(brush);

export const brushApplication = (
  brush: BrushDefinition,
  opts: { expanded?: boolean; appliedAt?: string } = {},
): BrushApplication => ({
  brushId: brush.id,
  brushName: brush.name,
  kind: brush.kind,
  settings: brushSettings(brush),
  ...(opts.expanded !== undefined ? { expanded: opts.expanded } : {}),
  ...(opts.appliedAt ? { appliedAt: opts.appliedAt } : {}),
});
