// exportPresets — save/load named Export-dialog configurations, plus the
// built-in presets that ship with the app (LR's Lightroom Presets folder).
// User presets are a UI-workflow convenience (not catalog data), so they live in
// localStorage under one JSON key rather than the catalog's SQLite preset
// tables. Storage is injectable so the pure list/save/delete logic unit-tests
// without a DOM.
//
// ponytail: localStorage means user presets can't be shared, backed up, or
// ridden along in the .mgal container — move the user list to the catalog's
// preset tables when presets need to travel. Built-ins need no storage at all.

import type { ExportColorSpace } from "../engine";
import type { AfterExportAction } from "./afterExport";
import type { ResizeMode, ResizeUnit } from "./exportImage";
import type { MetadataInclude } from "./exportMetadata";
import type { SharpenAmount, SharpenMedia } from "./outputSharpen";
import type { WatermarkAnchor } from "./watermark";

/** The full set of Export-dialog choices a preset restores (mirrors the dialog's
 *  own state). All fields are JSON-serializable primitives. */
export interface ExportConfig {
  format: "jpeg" | "png" | "tiff8" | "tiff16" | "psd" | "linearDng16" | "original";
  /** Optional: presets saved before the wide-format work omit these. */
  tiffCompression?: "none" | "zip";
  limitSize?: boolean;
  limitKB?: number;
  profile: ExportColorSpace;
  quality: number;
  /** Legacy long-edge-preset sizing; presets saved since Resize to Fit landed
   *  carry the resize* fields below instead. */
  longEdge?: number | null;
  /** Image Sizing — "full" (or absent with no longEdge) = no resize. */
  resizeMode?: ResizeMode | "full";
  sizeW?: number;
  sizeH?: number;
  sizeUnit?: ResizeUnit;
  dontEnlarge?: boolean;
  ppi?: number;
  namingIdx: number;
  customText: string;
  startNumber: number;
  sharpenFor: SharpenMedia | "off";
  sharpenAmount: SharpenAmount;
  wmText: string;
  wmPos: WatermarkAnchor;
  wmOpacity: number;
  wmSize: number;
  /** Optional: presets saved before these knobs existed omit them. */
  wmInset?: number;
  metaInclude?: MetadataInclude;
  metaRemoveLocation?: boolean;
  /** Write dc:subject as an lr:hierarchicalSubject tree. Absent = LR's default, on. */
  metaHierarchy?: boolean;
  /** Post-Processing ▸ After Export. Absent/"" = Do Nothing. */
  afterExport?: AfterExportAction;
  /** LR's Content Credentials (Beta). Absent = off, presets saved before it
   *  existed included. */
  contentCredentials?: boolean;
}

export interface ExportPreset {
  name: string;
  config: ExportConfig;
  /** Ships with the app: always listed, never removable. A user preset saved
   *  under the same name shadows it, and deleting that one reveals it again. */
  builtIn?: boolean;
}

/** The subset of the Web Storage API used here (so tests can inject a fake). */
export interface PresetStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const KEY = "galerie.exportPresets";

/** The Export dialog's own defaults, so each built-in states only what it
 *  changes and a new dialog knob doesn't have to be repeated four times. */
const DEFAULTS: ExportConfig = {
  format: "jpeg",
  profile: "srgb",
  quality: 90,
  tiffCompression: "none",
  limitSize: false,
  limitKB: 2048,
  resizeMode: "full",
  sizeW: 2048,
  sizeH: 2048,
  sizeUnit: "px",
  dontEnlarge: true,
  ppi: 240,
  namingIdx: 0,
  customText: "",
  startNumber: 1,
  sharpenFor: "off",
  sharpenAmount: "standard",
  wmText: "",
  wmPos: "bottom-right",
  wmOpacity: 70,
  wmSize: 4,
  wmInset: 2,
  metaInclude: "all",
  metaRemoveLocation: false,
  metaHierarchy: true,
  afterExport: "",
};

/** LR's built-in export presets. An empty preset menu was the whole reason a new
 *  user had nothing to pick, so these ship seeded rather than being written into
 *  storage on first run (nothing to migrate, nothing to corrupt).
 *
 *  ponytail: LR's fourth built-in, plain "For Email", differs only by transport
 *  (attach to a mail draft instead of writing a folder); export.ts is Hard Drive
 *  only, so shipping it would be a second identical row that lies about mailing.
 *  It lands with the email transport. */
export const BUILT_IN_EXPORT_PRESETS: readonly ExportPreset[] = [
  {
    // LR burns these to disc; we have no burn session, so the honest tail is
    // revealing the folder the full-sized JPEGs landed in.
    name: "Burn Full-Sized JPEGs",
    builtIn: true,
    config: { ...DEFAULTS, quality: 100, afterExport: "showInFinder" },
  },
  {
    // LR writes a plain DNG copy; ours is the linear 16-bit DNG the develop
    // pipeline can actually produce, which is the same "keep the raw data" job.
    name: "Export to DNG",
    builtIn: true,
    config: { ...DEFAULTS, format: "linearDng16", quality: 100 },
  },
  {
    name: "For Email (Hard Drive)",
    builtIn: true,
    config: {
      ...DEFAULTS,
      quality: 60,
      resizeMode: "widthHeight",
      sizeW: 640,
      sizeH: 640,
      ppi: 72,
      sharpenFor: "screen",
      afterExport: "showInFinder",
    },
  },
];

/** localStorage, or null where it's unavailable (SSR, locked-down contexts). */
function defaultStorage(): PresetStorage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // access itself can throw when storage is blocked
  }
}

/** Just the user's saved presets. Missing/malformed storage → []. */
function readUserPresets(storage: PresetStorage | null): ExportPreset[] {
  if (!storage) return [];
  try {
    const raw = storage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as ExportPreset[])
      .filter((p) => p && typeof p.name === "string" && p.config != null)
      .map((p) => ({ name: p.name, config: p.config })); // never trust a stored builtIn flag
  } catch {
    return []; // corrupt JSON — behave as if there are no user presets
  }
}

/** Every export preset the menu offers — built-ins plus the user's, sorted by
 *  name. A same-named user preset shadows the built-in it overrides. */
export function listExportPresets(storage: PresetStorage | null = defaultStorage()): ExportPreset[] {
  const user = readUserPresets(storage);
  const shadowed = new Set(user.map((p) => p.name));
  return [...user, ...BUILT_IN_EXPORT_PRESETS.filter((b) => !shadowed.has(b.name))]
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** Upsert a preset by name (trimmed); returns the updated list. Blank name or
 *  unavailable storage is a no-op that returns the current list. */
export function saveExportPreset(
  name: string,
  config: ExportConfig,
  storage: PresetStorage | null = defaultStorage(),
): ExportPreset[] {
  const trimmed = name.trim();
  if (!trimmed || !storage) return listExportPresets(storage);
  const next = readUserPresets(storage).filter((p) => p.name !== trimmed);
  next.push({ name: trimmed, config });
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // storage full / unavailable — the caller still gets the intended list
  }
  return listExportPresets(storage);
}

/** Remove a user preset by name; returns the updated list. A built-in can't be
 *  deleted — removing a user preset that shadowed one reveals the built-in. */
export function deleteExportPreset(
  name: string,
  storage: PresetStorage | null = defaultStorage(),
): ExportPreset[] {
  if (!storage) return listExportPresets(storage);
  const next = readUserPresets(storage).filter((p) => p.name !== name);
  try {
    storage.setItem(KEY, JSON.stringify(next));
  } catch {
    // ignore write failure — next read just returns the prior contents
  }
  return listExportPresets(storage);
}
