export interface MeasureScale {
  px: number;
  units: number;
  unit: string;
}

export interface MeasureScalePreset extends MeasureScale {
  name: string;
}

export const DEFAULT_MEASURE_SCALE: Readonly<MeasureScale> = { px: 1, units: 1, unit: "px" };
const MAX_MEASURE_SCALE_UNIT_LENGTH = 80;
const MAX_MEASURE_SCALE_PRESET_NAME_LENGTH = 80;
export const MAX_MEASURE_SCALE_PRESETS = 64;

/** Normalize document metadata loaded from an untrusted project envelope. */
export function normalizeMeasureScale(value: unknown): MeasureScale {
  const raw = value && typeof value === "object" ? value as Partial<MeasureScale> : {};
  const px = typeof raw.px === "number" && Number.isFinite(raw.px) && raw.px > 0
    ? raw.px
    : DEFAULT_MEASURE_SCALE.px;
  const units = typeof raw.units === "number" && Number.isFinite(raw.units) && raw.units > 0
    ? raw.units
    : DEFAULT_MEASURE_SCALE.units;
  const unit = typeof raw.unit === "string"
    ? raw.unit.trim().slice(0, MAX_MEASURE_SCALE_UNIT_LENGTH) || DEFAULT_MEASURE_SCALE.unit
    : DEFAULT_MEASURE_SCALE.unit;
  return { px, units, unit };
}

export function isDefaultMeasureScale(scale: MeasureScale): boolean {
  return scale.px === DEFAULT_MEASURE_SCALE.px
    && scale.units === DEFAULT_MEASURE_SCALE.units
    && scale.unit === DEFAULT_MEASURE_SCALE.unit;
}

export function normalizeMeasureScalePresets(value: unknown): MeasureScalePreset[] {
  if (!Array.isArray(value)) return [];
  const result: MeasureScalePreset[] = [];
  const names = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<MeasureScalePreset>;
    const name = typeof item.name === "string" ? item.name.trim().slice(0, MAX_MEASURE_SCALE_PRESET_NAME_LENGTH) : "";
    if (!name || typeof item.px !== "number" || !Number.isFinite(item.px) || item.px <= 0
      || typeof item.units !== "number" || !Number.isFinite(item.units) || item.units <= 0
      || typeof item.unit !== "string" || !item.unit.trim()) continue;
    const key = name.toLocaleLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    result.push({ name, ...normalizeMeasureScale(item) });
    if (result.length === MAX_MEASURE_SCALE_PRESETS) break;
  }
  return result;
}

export function saveMeasureScalePreset(
  presets: readonly MeasureScalePreset[],
  nameValue: unknown,
  scale: MeasureScale,
): MeasureScalePreset[] {
  const name = typeof nameValue === "string" ? nameValue.trim().slice(0, MAX_MEASURE_SCALE_PRESET_NAME_LENGTH) : "";
  if (!name || !Number.isFinite(scale.px) || scale.px <= 0 || !Number.isFinite(scale.units) || scale.units <= 0 || !scale.unit.trim()) {
    return normalizeMeasureScalePresets(presets);
  }
  const key = name.toLocaleLowerCase();
  const next = normalizeMeasureScalePresets(presets).filter((preset) => preset.name.toLocaleLowerCase() !== key);
  next.push({ name, ...normalizeMeasureScale(scale) });
  return next.slice(-MAX_MEASURE_SCALE_PRESETS);
}

export function deleteMeasureScalePreset(presets: readonly MeasureScalePreset[], nameValue: unknown): MeasureScalePreset[] {
  const key = typeof nameValue === "string" ? nameValue.trim().toLocaleLowerCase() : "";
  return normalizeMeasureScalePresets(presets).filter((preset) => preset.name.toLocaleLowerCase() !== key);
}
