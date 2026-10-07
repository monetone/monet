export interface PixelAspectPreset {
  name: string;
  ratio: number;
  builtin: boolean;
}

export const MIN_PIXEL_ASPECT = 0.1;
export const MAX_PIXEL_ASPECT = 10;
export const MAX_PIXEL_ASPECT_PRESETS = 64;
export const MAX_PIXEL_ASPECT_NAME = 80;

export const DEFAULT_PIXEL_ASPECT_PRESETS: readonly PixelAspectPreset[] = [
  { name: "Square", ratio: 1, builtin: true },
  { name: "D1/DV NTSC (0.91)", ratio: 0.91, builtin: true },
  { name: "D1/DV PAL (1.09)", ratio: 1.09, builtin: true },
  { name: "D1/DV NTSC Widescreen (1.21)", ratio: 1.21, builtin: true },
  { name: "HDV 1080/DVCPRO HD 720 (1.33)", ratio: 1.33, builtin: true },
  { name: "D1/DV PAL Widescreen (1.46)", ratio: 1.46, builtin: true },
  { name: "Anamorphic 2:1 (2)", ratio: 2, builtin: true },
  { name: "DVCPRO HD 1080 (1.5)", ratio: 1.5, builtin: true },
];

export function normalizePixelAspectRatio(value: unknown): number {
  const ratio = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(ratio)) return 1;
  return Math.max(MIN_PIXEL_ASPECT, Math.min(MAX_PIXEL_ASPECT, ratio));
}

export function normalizePixelAspectName(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, MAX_PIXEL_ASPECT_NAME) : "";
}

function cloneDefaults(): PixelAspectPreset[] {
  return DEFAULT_PIXEL_ASPECT_PRESETS.map((preset) => ({ ...preset }));
}

export function normalizePixelAspectPresets(value: unknown): PixelAspectPreset[] {
  if (!Array.isArray(value)) return cloneDefaults();
  const result: PixelAspectPreset[] = [];
  const names = new Set<string>();
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const item = raw as Partial<PixelAspectPreset>;
    const name = normalizePixelAspectName(item.name);
    if (!name || typeof item.ratio !== "number" || !Number.isFinite(item.ratio)) continue;
    const key = name.toLocaleLowerCase();
    if (names.has(key)) continue;
    names.add(key);
    result.push({ name, ratio: normalizePixelAspectRatio(item.ratio), builtin: item.builtin === true });
    if (result.length === MAX_PIXEL_ASPECT_PRESETS) break;
  }
  return result;
}

export function savePixelAspectPreset(
  presets: readonly PixelAspectPreset[],
  nameValue: unknown,
  ratioValue: unknown,
): PixelAspectPreset[] {
  const name = normalizePixelAspectName(nameValue);
  const numeric = typeof ratioValue === "number" ? ratioValue : Number(ratioValue);
  if (!name || !Number.isFinite(numeric)) return normalizePixelAspectPresets(presets);
  const key = name.toLocaleLowerCase();
  const next = normalizePixelAspectPresets(presets).filter((preset) => preset.name.toLocaleLowerCase() !== key);
  next.push({ name, ratio: normalizePixelAspectRatio(numeric), builtin: false });
  // A full library refuses the new preset (#155). The old tail-slice dropped
  // index 0 instead — silently destroying the head of the list, which in a
  // default-seeded library is the built-in "Square" (the neutral 1:1 entry).
  if (next.length > MAX_PIXEL_ASPECT_PRESETS) return normalizePixelAspectPresets(presets);
  return next;
}

export function deletePixelAspectPreset(presets: readonly PixelAspectPreset[], nameValue: unknown): PixelAspectPreset[] {
  const key = normalizePixelAspectName(nameValue).toLocaleLowerCase();
  return normalizePixelAspectPresets(presets).filter((preset) => preset.name.toLocaleLowerCase() !== key);
}

export function resetPixelAspectPresets(presets: readonly PixelAspectPreset[], append: boolean): PixelAspectPreset[] {
  if (!append) return cloneDefaults();
  const current = normalizePixelAspectPresets(presets);
  const names = new Set(current.map((preset) => preset.name.toLocaleLowerCase()));
  return [
    ...current,
    ...DEFAULT_PIXEL_ASPECT_PRESETS.filter((preset) => !names.has(preset.name.toLocaleLowerCase())).map((preset) => ({ ...preset })),
  ].slice(0, MAX_PIXEL_ASPECT_PRESETS);
}

export function defaultPixelAspectPresetName(presets: readonly PixelAspectPreset[]): string {
  const names = new Set(presets.map((preset) => preset.name.toLocaleLowerCase()));
  if (!names.has("custom")) return "Custom";
  for (let n = 2; n <= MAX_PIXEL_ASPECT_PRESETS + 1; n++) {
    const candidate = `Custom ${n}`;
    if (!names.has(candidate.toLocaleLowerCase())) return candidate;
  }
  return "Custom";
}
