export interface ExportScaleRow {
  scale: number;
  suffix: string;
}

export type ExportScaleExtension = "png" | "jpg" | "gif";

export const EXPORT_SCALE_MIN = 0.05;
export const EXPORT_SCALE_MAX = 8;
export const DEFAULT_EXPORT_SCALE_ROW: ExportScaleRow = { scale: 1, suffix: "" };
const MAX_EXPORT_DIMENSION = 32_767;
const MAX_EXPORT_PIXELS = 80_000_000;

function safeExportSuffix(value: string): string {
  return [...value].map((character) => {
    const code = character.charCodeAt(0);
    return code < 32 || code === 127 || character === "/" || character === "\\" ? "_" : character;
  }).join("");
}

export function normalizeExportScaleRow(row: Partial<ExportScaleRow>): ExportScaleRow {
  const scale = Number.isFinite(row.scale) ? row.scale! : 1;
  return {
    scale: Math.min(EXPORT_SCALE_MAX, Math.max(EXPORT_SCALE_MIN, Math.round(scale * 100) / 100)),
    suffix: typeof row.suffix === "string" ? safeExportSuffix(row.suffix) : "",
  };
}

export function normalizeExportScaleRows(rows: readonly Partial<ExportScaleRow>[]): ExportScaleRow[] {
  return (rows.length ? rows : [DEFAULT_EXPORT_SCALE_ROW]).map(normalizeExportScaleRow);
}

export function exportScaleFilename(baseName: string, extension: ExportScaleExtension, row: ExportScaleRow): string {
  const stem = baseName.replace(/\.[^.]+$/, "");
  return `${stem}${row.suffix}.${extension}`;
}

export function exportScaleTargetFilename(baseName: string, extension: ExportScaleExtension, row: ExportScaleRow): string {
  return `${baseName}${row.suffix}.${extension}`;
}

export function duplicateExportScaleFilename(
  baseName: string,
  extension: ExportScaleExtension,
  rows: readonly ExportScaleRow[],
): string | null {
  const seen = new Set<string>();
  for (const row of rows) {
    const filename = exportScaleFilename(baseName, extension, row);
    const key = filename.toLowerCase();
    if (seen.has(key)) return filename;
    seen.add(key);
  }
  return null;
}

export function duplicateExportScaleTargetFilename(
  baseNames: readonly string[],
  extension: ExportScaleExtension,
  rows: readonly ExportScaleRow[],
): string | null {
  const seen = new Set<string>();
  for (const baseName of baseNames) {
    for (const row of rows) {
      const filename = exportScaleTargetFilename(baseName, extension, row);
      const key = filename.toLowerCase();
      if (seen.has(key)) return filename;
      seen.add(key);
    }
  }
  return null;
}

export function exportScaleDimensions(width: number, height: number, scale: number): [number, number] {
  const wasmScale = Math.fround(scale);
  return [
    Math.max(1, Math.round(Math.fround(width * wasmScale))),
    Math.max(1, Math.round(Math.fround(height * wasmScale))),
  ];
}

export function exportScaleFits(width: number, height: number, scale: number): boolean {
  const [scaledWidth, scaledHeight] = exportScaleDimensions(width, height, scale);
  return scaledWidth <= MAX_EXPORT_DIMENSION
    && scaledHeight <= MAX_EXPORT_DIMENSION
    && scaledWidth * scaledHeight <= MAX_EXPORT_PIXELS;
}
