// ops/export - document-backed export setup edits

import { resolvedExportForScreensSettings } from "../model/export";
import type { Document, ExportForScreensSettings } from "../model/types";

export type ExportForScreensSettingsPatch = Partial<ExportForScreensSettings>;

export const setExportForScreensSettings = (
  doc: Document,
  patch: ExportForScreensSettingsPatch,
): ExportForScreensSettings => {
  const current = resolvedExportForScreensSettings(doc.exportForScreens);
  const next = resolvedExportForScreensSettings({
    ...current,
    ...patch,
    formats: patch.formats ?? current.formats,
  });
  doc.exportForScreens = next;
  return next;
};
