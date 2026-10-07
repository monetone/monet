// ---------------------------------------------------------------------------
// io/compatibility -- import/export fidelity contracts
// ---------------------------------------------------------------------------
// These types make best-effort Illustrator-class IO explicit. Importers may
// still recover partial artwork, but unsupported fidelity must be represented
// as structured issues instead of disappearing behind an empty warnings array.

import type { Artboard, Document, Slice } from "../engine";

export type ImportFormat = "artisan" | "svg" | "pdf" | "ai" | "cdr" | "zip" | "unknown";
export type ExportFormat = "svg" | "pdf" | "png" | "jpeg" | "webp" | "tiff";

export type CompatibilitySeverity = "info" | "warning" | "loss" | "unsupported";

export interface CompatibilityIssue {
  code: string;
  severity: CompatibilitySeverity;
  message: string;
  feature?: string;
  format?: ImportFormat | ExportFormat;
}

export type ImportCompatibilityTier = "native" | "editable-vector" | "vector-subset" | "geometry-subset" | "unsupported";

export interface ImportCompatibilityReport {
  kind: "import";
  format: ImportFormat;
  tier: ImportCompatibilityTier;
  sourceName?: string;
  issues: CompatibilityIssue[];
}

export type ExportCompatibilityTier = "native-vector" | "browser-raster" | "planned";

export interface ExportCapability {
  format: ExportFormat;
  label: string;
  mimeType: string;
  extension: string;
  tier: ExportCompatibilityTier;
  supported: boolean;
  reason?: string;
}

export interface SvgExportContractOptions {
  format: "svg";
  artboardIndex?: number;
  background?: boolean;
  includeHidden?: boolean;
  preserveEditability?: boolean;
}

export interface PdfExportContractOptions {
  format: "pdf";
  artboardIndex?: number;
  background?: boolean;
  compatibility?: "pdf-1.4" | "pdf-1.7";
  preserveEditability?: boolean;
}

export interface PngExportContractOptions {
  format: "png";
  scale?: number;
  dpi?: number;
  background?: boolean;
  transparent?: boolean;
}

export interface JpegExportContractOptions {
  format: "jpeg";
  scale?: number;
  dpi?: number;
  background?: boolean;
  quality?: number;
}

export interface WebpExportContractOptions {
  format: "webp";
  scale?: number;
  dpi?: number;
  background?: boolean;
  quality?: number;
}

export interface TiffExportContractOptions {
  format: "tiff";
  scale?: number;
  dpi?: number;
  background?: boolean;
  compression?: "none" | "lzw" | "zip";
}

export type ExportContractOptions =
  | SvgExportContractOptions
  | PdfExportContractOptions
  | PngExportContractOptions
  | JpegExportContractOptions
  | WebpExportContractOptions
  | TiffExportContractOptions;

export interface ExportCompatibilityReport {
  kind: "export";
  format: ExportFormat;
  capability: ExportCapability;
  issues: CompatibilityIssue[];
}

export const EXPORT_CAPABILITIES: Record<ExportFormat, ExportCapability> = {
  svg: {
    format: "svg",
    label: "SVG",
    mimeType: "image/svg+xml",
    extension: "svg",
    tier: "native-vector",
    supported: true,
  },
  png: {
    format: "png",
    label: "PNG",
    mimeType: "image/png",
    extension: "png",
    tier: "browser-raster",
    supported: true,
  },
  pdf: {
    format: "pdf",
    label: "PDF",
    mimeType: "application/pdf",
    extension: "pdf",
    tier: "planned",
    supported: false,
    reason: "PDF export is not wired yet; use SVG or PNG export.",
  },
  jpeg: {
    format: "jpeg",
    label: "JPEG",
    mimeType: "image/jpeg",
    extension: "jpg",
    tier: "planned",
    supported: false,
    reason: "JPEG export options are modeled, but only PNG raster export is currently implemented.",
  },
  webp: {
    format: "webp",
    label: "WebP",
    mimeType: "image/webp",
    extension: "webp",
    tier: "planned",
    supported: false,
    reason: "WebP export options are modeled, but only PNG raster export is currently implemented.",
  },
  tiff: {
    format: "tiff",
    label: "TIFF",
    mimeType: "image/tiff",
    extension: "tif",
    tier: "planned",
    supported: false,
    reason: "TIFF export requires a native encoder and is not implemented yet.",
  },
};

const IMPORT_TIERS: Record<ImportFormat, ImportCompatibilityTier> = {
  artisan: "native",
  svg: "editable-vector",
  pdf: "vector-subset",
  ai: "vector-subset",
  cdr: "geometry-subset",
  zip: "geometry-subset",
  unknown: "unsupported",
};

const issueKey = (issue: CompatibilityIssue): string => `${issue.format ?? ""}:${issue.code}:${issue.feature ?? ""}:${issue.message}`;

export function uniqueIssues(issues: CompatibilityIssue[]): CompatibilityIssue[] {
  const seen = new Set<string>();
  const out: CompatibilityIssue[] = [];
  for (const issue of issues) {
    const key = issueKey(issue);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(issue);
  }
  return out;
}

export function createImportCompatibilityReport(
  format: ImportFormat,
  opts: { sourceName?: string; issues?: CompatibilityIssue[] } = {},
): ImportCompatibilityReport {
  return {
    kind: "import",
    format,
    tier: IMPORT_TIERS[format],
    sourceName: opts.sourceName,
    issues: uniqueIssues(opts.issues ?? []),
  };
}

export function compatibilityWarnings(report: { issues: CompatibilityIssue[] }): string[] {
  return report.issues
    .filter((issue) => issue.severity !== "info")
    .map((issue) => issue.message);
}

export function mergeCompatibilityWarnings(existing: string[], report: { issues: CompatibilityIssue[] }): string[] {
  const out = [...existing];
  const seen = new Set(out);
  for (const warning of compatibilityWarnings(report)) {
    if (!seen.has(warning)) {
      seen.add(warning);
      out.push(warning);
    }
  }
  return out;
}

const quotedAttr = (tag: string, name: string): string | undefined => {
  const quoted = new RegExp(`\\b${name}\\s*=\\s*(['"])(.*?)\\1`, "i").exec(tag);
  if (quoted) return quoted[2];
  const bare = new RegExp(`\\b${name}\\s*=\\s*([^\\s>]+)`, "i").exec(tag);
  return bare?.[1];
};

const safeInlineImageHref = (raw: string): boolean => {
  const v = raw.trim();
  return v.startsWith("#") || /^data:image\/(png|jpe?g|gif|webp|svg\+xml|avif|bmp);/i.test(v);
};

export function analyzeSvgImportCompatibility(source: string, sourceName?: string): ImportCompatibilityReport {
  const issues: CompatibilityIssue[] = [];
  const add = (issue: Omit<CompatibilityIssue, "format">) => issues.push({ ...issue, format: "svg" });

  if (/<\s*script(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-script-dropped",
      severity: "unsupported",
      feature: "script",
      message: "SVG script elements are not imported or executed.",
    });
  }
  if (/<\s*foreignObject(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-foreignobject-dropped",
      severity: "loss",
      feature: "foreignObject",
      message: "SVG foreignObject content is not imported.",
    });
  }
  if (/<\s*switch(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-switch-conditions-approximated",
      severity: "warning",
      feature: "switch",
      message: "SVG switch conditions are approximated by importing the first supported branch.",
    });
  }
  if (/<\s*style(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-stylesheet-rules-ignored",
      severity: "loss",
      feature: "css",
      message: "SVG stylesheet rules are ignored; inline presentation attributes and style attributes are supported.",
    });
  }
  if (/<\s*textPath(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-textpath-flattened",
      severity: "loss",
      feature: "textPath",
      message: "SVG textPath content is not reconstructed as editable path text.",
    });
  }
  if (/<\s*mesh(?:gradient|patch|row)(?:\s|>|\/)/i.test(source)) {
    add({
      code: "svg-mesh-gradient-dropped",
      severity: "loss",
      feature: "gradient-mesh",
      message: "SVG mesh gradients are not imported.",
    });
  }

  for (const match of source.matchAll(/<\s*image\b[^>]*>/gi)) {
    const tag = match[0];
    const href = quotedAttr(tag, "href") ?? quotedAttr(tag, "xlink:href");
    if (!href) {
      add({
        code: "svg-image-missing-href-dropped",
        severity: "loss",
        feature: "image",
        message: "SVG image elements without href data are dropped.",
      });
    } else if (!safeInlineImageHref(href)) {
      add({
        code: "svg-external-image-dropped",
        severity: "unsupported",
        feature: "image",
        message: "SVG external, file, blob, or script image links are blocked and dropped.",
      });
    }
  }

  const supportedFilterPrimitives = new Set(["fegaussianblur", "fedropshadow", "feflood", "fecomposite", "femerge", "femergenode"]);
  const unsupportedFilterPrimitives = new Set<string>();
  for (const match of source.matchAll(/<\s*(fe[a-zA-Z]+)\b[^>]*>/g)) {
    const tag = match[1].toLowerCase();
    if (!supportedFilterPrimitives.has(tag)) unsupportedFilterPrimitives.add(tag);
  }
  if (unsupportedFilterPrimitives.size) {
    add({
      code: "svg-filter-primitive-dropped",
      severity: "loss",
      feature: "filter",
      message: `Unsupported SVG filter primitives are ignored: ${Array.from(unsupportedFilterPrimitives).sort().join(", ")}.`,
    });
  }

  return createImportCompatibilityReport("svg", { sourceName, issues });
}

export function analyzePdfLikeImportCompatibility(format: "pdf" | "ai", source: string, sourceName?: string): ImportCompatibilityReport {
  const issues: CompatibilityIssue[] = [
    {
      code: `${format}-vector-subset-import`,
      severity: "warning",
      feature: "import-tier",
      format,
      message: `${format.toUpperCase()} import uses the vector-subset parser; unsupported fidelity is reported in this compatibility report.`,
    },
  ];
  const add = (issue: Omit<CompatibilityIssue, "format">) => issues.push({ ...issue, format });

  if (format === "ai") {
    add({
      code: "ai-native-edit-data-not-imported",
      severity: "loss",
      feature: "native-edit-data",
      message: "Illustrator private edit data is not decoded; only PDF/EPS vector operators are imported.",
    });
  }
  if (/\b(BT|Tj|TJ|Tf|ET)\b|\b(show|ashow|widthshow|glyphshow)\b/.test(source)) {
    add({
      code: `${format}-text-operators-dropped`,
      severity: "loss",
      feature: "text",
      message: `${format.toUpperCase()} text operators are detected but editable text reconstruction is not implemented.`,
    });
  }
  if (/\bDo\b|\b(image|imagemask|colorimage)\b/.test(source)) {
    add({
      code: `${format}-image-operators-dropped`,
      severity: "loss",
      feature: "image",
      message: `${format.toUpperCase()} image/XObject operators are detected but raster image extraction is not implemented.`,
    });
  }
  if (/(^|[\s])W\*?([\s]|$)|\b(clip|eoclip)\b/.test(source)) {
    add({
      code: `${format}-clipping-operators-dropped`,
      severity: "loss",
      feature: "clipping",
      message: `${format.toUpperCase()} clipping operators are detected but clip reconstruction is not implemented.`,
    });
  }
  if (/\/SMask\b|\/BM\b|\/ca\b|\/CA\b|\/ExtGState\b|(^|[\s])gs([\s]|$)/.test(source)) {
    add({
      code: `${format}-transparency-dropped`,
      severity: "loss",
      feature: "transparency",
      message: `${format.toUpperCase()} transparency, blend, or ExtGState data is detected but not reconstructed.`,
    });
  }
  if (/\/Pattern\b|\bsh\b/.test(source)) {
    add({
      code: `${format}-pattern-shading-dropped`,
      severity: "loss",
      feature: "pattern",
      message: `${format.toUpperCase()} pattern or shading data is detected but not reconstructed.`,
    });
  }

  return createImportCompatibilityReport(format, { sourceName, issues });
}

export function createCdrImportCompatibilityReport(sourceName?: string, extraWarnings: string[] = []): ImportCompatibilityReport {
  const issues: CompatibilityIssue[] = [
    {
      code: "cdr-geometry-subset-import",
      severity: "warning",
      feature: "import-tier",
      format: "cdr",
      message: "CorelDRAW import is geometry-only; fills, strokes, effects, and document metadata may be defaulted.",
    },
    ...extraWarnings.map((message, i): CompatibilityIssue => ({
      code: `cdr-warning-${i + 1}`,
      severity: "warning",
      feature: "cdr",
      format: "cdr",
      message,
    })),
  ];
  return createImportCompatibilityReport("cdr", { sourceName, issues });
}

export function exportCapability(format: ExportFormat): ExportCapability {
  return EXPORT_CAPABILITIES[format];
}

export function createExportCompatibilityReport(options: ExportContractOptions): ExportCompatibilityReport {
  const capability = exportCapability(options.format);
  const issues: CompatibilityIssue[] = capability.supported
    ? []
    : [{
      code: `${options.format}-export-unsupported`,
      severity: "unsupported",
      feature: "export",
      format: options.format,
      message: capability.reason ?? `${capability.label} export is not implemented.`,
    }];
  return { kind: "export", format: options.format, capability, issues };
}

export interface ExportForScreensFile {
  format: ExportFormat;
  filename: string;
  mimeType: string;
  supported: boolean;
  reason?: string;
}

export interface ExportForScreensEntry {
  source: "artboard" | "slice";
  id: string;
  name: string;
  region: { x: number; y: number; width: number; height: number };
  files: ExportForScreensFile[];
}

export interface ExportForScreensManifestOptions {
  formats?: ExportFormat[];
  includeArtboards?: boolean;
  includeSlices?: boolean;
  baseName?: string;
  scale?: number;
  generatedAt?: string;
}

export interface ExportForScreensManifest {
  version: 1;
  documentId: string;
  documentName: string;
  manifestPath: string;
  generatedAt: string;
  scale: number;
  entries: ExportForScreensEntry[];
  issues: CompatibilityIssue[];
}

const cleanFilePart = (value: string): string => {
  const cleaned = value
    .trim()
    .replace(/[\\/:*?"<>|#%{}$!`&=+@]/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || "export";
};

const artboardRegion = (ab: Artboard) => ({ x: ab.x, y: ab.y, width: ab.width, height: ab.height });
const sliceRegion = (slice: Slice) => ({ x: slice.x, y: slice.y, width: slice.width, height: slice.height });

export function buildExportForScreensManifest(doc: Document, opts: ExportForScreensManifestOptions = {}): ExportForScreensManifest {
  const formats = opts.formats ?? ["svg", "png"];
  const scale = opts.scale ?? 1;
  const baseName = cleanFilePart(opts.baseName ?? doc.name);
  const includeSlices = opts.includeSlices ?? true;
  const includeArtboards = opts.includeArtboards ?? !(doc.slices?.length);
  const targets: Array<{ source: "artboard" | "slice"; id: string; name: string; region: { x: number; y: number; width: number; height: number } }> = [];

  if (includeArtboards) {
    doc.artboards.forEach((ab, index) => {
      targets.push({ source: "artboard", id: ab.id, name: ab.name || `Artboard ${index + 1}`, region: artboardRegion(ab) });
    });
  }
  if (includeSlices) {
    (doc.slices ?? []).forEach((slice, index) => {
      targets.push({ source: "slice", id: slice.id, name: slice.name || `Slice ${index + 1}`, region: sliceRegion(slice) });
    });
  }

  const issues: CompatibilityIssue[] = [];
  const scaleSuffix = scale === 1 ? "" : `@${scale}x`;
  const entries = targets.map((target, targetIndex): ExportForScreensEntry => {
    const targetName = cleanFilePart(target.name);
    const files = formats.map((format): ExportForScreensFile => {
      const capability = exportCapability(format);
      const report = createExportCompatibilityReport({ format } as ExportContractOptions);
      issues.push(...report.issues);
      const filename = `${baseName}-${target.source}-${targetName}-${String(targetIndex + 1).padStart(2, "0")}${scaleSuffix}.${capability.extension}`;
      return {
        format,
        filename,
        mimeType: capability.mimeType,
        supported: capability.supported,
        reason: capability.reason,
      };
    });
    return {
      source: target.source,
      id: target.id,
      name: target.name,
      region: target.region,
      files,
    };
  });

  return {
    version: 1,
    documentId: doc.id,
    documentName: doc.name,
    manifestPath: `${baseName}-export-for-screens.json`,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    scale,
    entries,
    issues: uniqueIssues(issues),
  };
}
