// model/export - Export for Screens defaults and normalization

import type { Document, ExportForScreensFormat, ExportForScreensSettings, ExportForScreensTarget } from "./types";

export const EXPORT_FOR_SCREENS_FORMATS: ExportForScreensFormat[] = ["svg", "png", "pdf", "jpeg", "webp", "tiff"];

const DEFAULT_FORMATS: ExportForScreensFormat[] = ["svg", "png"];

const isFormat = (value: string): value is ExportForScreensFormat =>
  (EXPORT_FOR_SCREENS_FORMATS as string[]).includes(value);

const isTarget = (value: string): value is ExportForScreensTarget =>
  value === "artboards" || value === "slices" || value === "artboards-and-slices";

const clampScale = (value: number | undefined, fallback: number): number => {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(0.01, Math.min(100, value as number));
};

const cleanFormats = (formats: readonly ExportForScreensFormat[] | undefined): ExportForScreensFormat[] => {
  const out: ExportForScreensFormat[] = [];
  for (const format of formats ?? DEFAULT_FORMATS) {
    if (!isFormat(format) || out.includes(format)) continue;
    out.push(format);
  }
  return out.length ? out : [...DEFAULT_FORMATS];
};

export const defaultExportForScreensSettings = (): ExportForScreensSettings => ({
  target: "artboards-and-slices",
  formats: [...DEFAULT_FORMATS],
  scale: 1,
  includeManifest: true,
});

export const resolvedExportForScreensSettings = (
  settings?: Partial<ExportForScreensSettings>,
): ExportForScreensSettings => {
  const base = defaultExportForScreensSettings();
  return {
    target: settings?.target && isTarget(settings.target) ? settings.target : base.target,
    formats: cleanFormats(settings?.formats),
    scale: clampScale(settings?.scale, base.scale),
    includeManifest: settings?.includeManifest ?? base.includeManifest,
    ...(settings?.baseName?.trim() ? { baseName: settings.baseName.trim() } : {}),
  };
};

export const exportForScreensManifestOptions = (
  doc: Document,
  settings?: Partial<ExportForScreensSettings>,
) => {
  const resolved = resolvedExportForScreensSettings(settings ?? doc.exportForScreens);
  return {
    formats: resolved.formats,
    includeArtboards: resolved.target === "artboards" || resolved.target === "artboards-and-slices",
    includeSlices: resolved.target === "slices" || resolved.target === "artboards-and-slices",
    baseName: resolved.baseName ?? doc.name,
    scale: resolved.scale,
  };
};
