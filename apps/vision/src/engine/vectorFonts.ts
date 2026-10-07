// vectorFonts: host-side font provisioning for native vector text.
// The WASM engine cannot enumerate OS fonts. In the desktop app we can inspect
// common font directories through Tauri, ask the engine for reliable face
// metadata, and register a bounded set of known UI/vector family stacks.

import { isTauri } from "@tauri-apps/api/core";
import type { EngineClient } from "./EngineClient";
import { FONTS as VISION_FONTS, fontFaceAlias } from "../text/spec";

export interface VectorFontFaceInfo {
  family: string;
  subfamily?: string | null;
  fullName?: string | null;
  postscriptName?: string | null;
  faceIndex: number;
  weight: number;
  italic: boolean;
  /** `fvar` axes, present only on a variable face (see readVariationAxes). */
  axes?: FontAxis[];
}

/** One variable-font design axis, as the face's `fvar` table declares it. */
export interface FontAxis { tag: string; min: number; def: number; max: number }

const loadedFaceAliases = new Set<string>();

/** A unique CSS family bound to the actual local face, including TTC subfaces.
 *  Weight alone cannot distinguish Bold from Condensed Bold or Book from Roman. */
export async function provisionCssFontFaces(faces: readonly VectorFontFaceInfo[]): Promise<void> {
  if (typeof FontFace === "undefined" || typeof document === "undefined" || !document.fonts) return;
  await Promise.all(faces.map(async (face) => {
    const name = face.postscriptName?.trim() || face.fullName?.trim();
    if (!name || loadedFaceAliases.has(name)) return;
    const weight = face.axes?.find((axis) => axis.tag === "wght");
    const sources = [face.postscriptName, face.fullName].filter((value): value is string => !!value)
      .map((value) => `local(${JSON.stringify(value)})`).join(", ");
    try {
      const font = new FontFace(fontFaceAlias(name), sources, {
        weight: weight ? `${weight.min} ${weight.max}` : String(face.weight),
        style: face.italic ? "italic" : "normal",
      });
      await font.load();
      document.fonts.add(font);
      loadedFaceAliases.add(name);
    } catch { /* The platform may not expose a scanned face to CSS; the original stack remains the fallback. */ }
  }));
}

export interface VectorFontProvisioningSummary {
  status: "registered" | "unavailable" | "inactive" | "empty";
  scannedFiles: number;
  inspectedFaces: number;
  registeredFaces: number;
  registeredFamilies: string[];
  discoveredFamilies: string[];
  skippedFiles: number;
}

interface FontDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface FontFs {
  readDir(path: string): Promise<FontDirEntry[]>;
  readFile(path: string): Promise<Uint8Array>;
  join(...paths: string[]): Promise<string>;
}

export interface VectorFontProvisioningOptions {
  maxDepth?: number;
  maxFiles?: number;
  maxFileBytes?: number;
  maxTotalBytes?: number;
  maxRegisteredFaces?: number;
  roots?: string[];
  targetStacks?: string[];
  documentFontStacks?: string[];
  onFontsChanged?: () => void;
  onFamiliesDiscovered?: (families: string[]) => void;
  /** Every inspected face, with its real weight/italic and variable axes — what
   *  the Character panel's Style dropdown and axis sliders list. Fired once per
   *  scan, just before onFamiliesDiscovered. */
  onFacesDiscovered?: (faces: VectorFontFaceInfo[]) => void;
}

const FONT_FILE_RE = /\.(ttf|otf|ttc|otc)$/i;
const GENERIC_FAMILIES = new Set([
  "serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui", "emoji", "math", "fangsong",
  // CSS Fonts 4 generic keywords — not concrete families, so never try to register them.
  "ui-serif", "ui-sans-serif", "ui-monospace", "ui-rounded",
]);

const EXTRA_VECTOR_FONT_STACKS = [
  "Helvetica, Arial, sans-serif",
  '"Helvetica Neue", Helvetica, Arial, sans-serif',
  "Arial, Helvetica, sans-serif",
  "Verdana, Geneva, sans-serif",
  "Tahoma, Geneva, sans-serif",
  '"Trebuchet MS", Helvetica, sans-serif',
  '"Gill Sans", "Gill Sans MT", Calibri, sans-serif',
  'Futura, "Trebuchet MS", Arial, sans-serif',
  '"Avenir Next", Avenir, "Segoe UI", sans-serif',
  'Optima, Candara, "Segoe UI", sans-serif',
  'Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif',
  '"Times New Roman", Times, serif',
  "Georgia, Cambria, serif",
  'Garamond, Baskerville, "Times New Roman", serif',
  'Baskerville, "Goudy Old Style", Garamond, serif',
  'Palatino, "Palatino Linotype", "Book Antiqua", serif',
  '"Courier New", Courier, monospace',
  'Menlo, Monaco, Consolas, "Courier New", monospace',
  '"Brush Script MT", "Comic Sans MS", cursive',
];
export const DEFAULT_VECTOR_FONT_STACKS = [...VISION_FONTS, ...EXTRA_VECTOR_FONT_STACKS];

const DEFAULT_MAX_DEPTH = 4;
const DEFAULT_MAX_FILES = 256;
// 48 MB per file so common CJK TrueType collections (PingFang, Songti, SimSun,
// Yu Gothic) are not always skipped. The registry copies a font's bytes per
// registered face, so overall memory stays bounded by maxRegisteredFaces below.
const DEFAULT_MAX_FILE_BYTES = 48 * 1024 * 1024;
const DEFAULT_MAX_TOTAL_BYTES = 96 * 1024 * 1024;
const DEFAULT_MAX_REGISTERED_FACES = 128;

export function isSupportedFontFile(name: string): boolean {
  return FONT_FILE_RE.test(name);
}

export function fontFamilyNames(stack: string): string[] {
  return stack
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter((part) => part.length > 0 && !GENERIC_FAMILIES.has(part.toLowerCase()));
}

export function normalizedFontFamily(value: string): string {
  return value.replace(/^["']|["']$/g, "").replace(/\s+/g, " ").trim().toLowerCase();
}

export function targetFontFamilies(stacks: string[] = DEFAULT_VECTOR_FONT_STACKS): Set<string> {
  const out = new Set<string>();
  for (const stack of stacks) {
    for (const family of fontFamilyNames(stack)) out.add(normalizedFontFamily(family));
  }
  return out;
}

function addFontStack(value: unknown, out: Set<string>) {
  if (typeof value !== "string") return;
  const stack = value.trim();
  if (!stack || fontFamilyNames(stack).length === 0) return;
  out.add(stack);
}

export function vectorFontStacksFromSceneJson(sceneJson: string): string[] {
  let root: unknown;
  try {
    root = JSON.parse(sceneJson);
  } catch {
    return [];
  }

  const out = new Set<string>();
  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      for (const child of value) visit(child);
      return;
    }

    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (key === "fontFamily") addFontStack(child, out);
      visit(child);
    }
  };
  visit(root);
  return [...out].sort((a, b) => a.localeCompare(b));
}

export function shouldRegisterFace(face: VectorFontFaceInfo, targets: Set<string>): boolean {
  if (targets.has(normalizedFontFamily(face.family))) return true;
  if (face.fullName && targets.has(normalizedFontFamily(face.fullName))) return true;
  if (face.postscriptName && targets.has(normalizedFontFamily(face.postscriptName))) return true;
  return false;
}

/** The offset of one sfnt table, or -1. `base` is the face's offset table (0 for
 *  a plain .ttf/.otf, the per-face offset inside a .ttc). */
function sfntTableOffset(v: DataView, base: number, tag: string): number {
  const count = v.getUint16(base + 4);
  for (let i = 0; i < count; i++) {
    const rec = base + 12 + i * 16;
    let t = "";
    for (let k = 0; k < 4; k++) t += String.fromCharCode(v.getUint8(rec + k));
    if (t === tag) return v.getUint32(rec + 8);
  }
  return -1;
}

/**
 * The variable-font design axes a face declares, straight out of its `fvar`
 * table — empty for a static face, and empty (never a throw) for anything
 * malformed: these are arbitrary files off the user's disk, and one bad font
 * must not abort the scan.
 *
 * ponytail: read here rather than through the engine's inspect call — the bytes
 * are already in hand, `fvar` is a fixed-layout table, and it keeps the fix out
 * of the WASM build. Move it into inspect_font_faces if the axis *names* (a
 * `name`-table lookup per axisNameID) are ever wanted.
 */
export function readVariationAxes(bytes: Uint8Array, faceIndex = 0): FontAxis[] {
  try {
    const v = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let base = 0;
    if (v.getUint32(0) === 0x74746366) { // 'ttcf' — a collection: index the face's own header
      if (faceIndex >= v.getUint32(8)) return [];
      base = v.getUint32(12 + faceIndex * 4);
    }
    const fvar = sfntTableOffset(v, base, "fvar");
    if (fvar < 0) return [];
    const axes = fvar + v.getUint16(fvar + 4); // axesArrayOffset, from the table start
    const count = v.getUint16(fvar + 8);
    const size = v.getUint16(fvar + 10); // axisSize: 20 today, may grow
    const out: FontAxis[] = [];
    for (let i = 0; i < count && i < 64; i++) {
      const r = axes + i * size;
      let tag = "";
      for (let k = 0; k < 4; k++) tag += String.fromCharCode(v.getUint8(r + k));
      // Axis values are 16.16 fixed point.
      out.push({ tag, min: v.getInt32(r + 4) / 65536, def: v.getInt32(r + 8) / 65536, max: v.getInt32(r + 12) / 65536 });
    }
    return out;
  } catch {
    return [];
  }
}

export function fontSearchRoots(platform: string, home: string | null, userFontDir: string | null): string[] {
  const roots = new Set<string>();
  if (userFontDir) roots.add(userFontDir);
  const p = platform.toLowerCase();
  if (p.includes("mac") || p.includes("darwin")) {
    roots.add("/System/Library/Fonts");
    roots.add("/Library/Fonts");
    if (home) roots.add(`${home}/Library/Fonts`);
  } else if (p.includes("win")) {
    roots.add("C:\\Windows\\Fonts");
  } else {
    roots.add("/usr/share/fonts");
    roots.add("/usr/local/share/fonts");
    if (home) {
      roots.add(`${home}/.local/share/fonts`);
      roots.add(`${home}/.fonts`);
    }
  }
  return [...roots];
}

export async function collectFontFilePaths(
  roots: string[],
  fs: Pick<FontFs, "readDir" | "join">,
  options: Pick<VectorFontProvisioningOptions, "maxDepth" | "maxFiles"> = {},
): Promise<string[]> {
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const out: string[] = [];
  const seen = new Set<string>();
  const queue = roots.map((root) => ({ path: root, depth: 0 }));

  while (queue.length && out.length < maxFiles) {
    const cur = queue.shift()!;
    if (seen.has(cur.path) || cur.depth > maxDepth) continue;
    seen.add(cur.path);

    let entries: FontDirEntry[];
    try {
      entries = await fs.readDir(cur.path);
    } catch {
      continue;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const child = await fs.join(cur.path, entry.name);
      if (entry.isDirectory) {
        if (cur.depth < maxDepth) queue.push({ path: child, depth: cur.depth + 1 });
      } else if (entry.isFile && isSupportedFontFile(entry.name)) {
        out.push(child);
        if (out.length >= maxFiles) break;
      }
    }
  }

  return out;
}

function currentPlatform(): string {
  if (typeof navigator === "undefined") return "";
  return navigator.platform || navigator.userAgent || "";
}

function emptySummary(status: VectorFontProvisioningSummary["status"]): VectorFontProvisioningSummary {
  return {
    status,
    scannedFiles: 0,
    inspectedFaces: 0,
    registeredFaces: 0,
    registeredFamilies: [],
    discoveredFamilies: [],
    skippedFiles: 0,
  };
}

export async function provisionSystemVectorFonts(
  client: EngineClient,
  options: VectorFontProvisioningOptions = {},
): Promise<VectorFontProvisioningSummary> {
  if (!isTauri()) return emptySummary("unavailable");
  if (!client.engine) return emptySummary("inactive");

  const [{ readDir, readFile }, pathApi] = await Promise.all([
    import("@tauri-apps/plugin-fs"),
    import("@tauri-apps/api/path"),
  ]);
  const fs: FontFs = {
    readDir,
    readFile,
    join: pathApi.join,
  };
  const [home, userFontDir] = await Promise.all([
    pathApi.homeDir().catch(() => null),
    pathApi.fontDir().catch(() => null),
  ]);
  const roots = options.roots ?? fontSearchRoots(currentPlatform(), home, userFontDir);
  const files = await collectFontFilePaths(roots, fs, options);
  // Prioritize families the open documents actually request over the default
  // UI/vector stacks, so a font-heavy system cannot exhaust the registration
  // budget on defaults before the document's own fonts are registered.
  const documentTargets = targetFontFamilies(options.documentFontStacks ?? []);
  const defaultTargets = targetFontFamilies(options.targetStacks ?? DEFAULT_VECTOR_FONT_STACKS);
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;
  const maxRegisteredFaces = options.maxRegisteredFaces ?? DEFAULT_MAX_REGISTERED_FACES;
  const registeredFamilies = new Set<string>();
  const discoveredFamilies = new Set<string>();

  let inspectedFaces = 0;
  let registeredFaces = 0;
  let skippedFiles = 0;
  let totalBytes = 0;

  // First pass: read and inspect each file once (bounded by the byte caps),
  // bucketing matching faces by priority. Registration is deferred to the second
  // pass so document-requested faces can claim the face budget first.
  const documentCandidates: Array<{ face: VectorFontFaceInfo; bytes: Uint8Array }> = [];
  const defaultCandidates: Array<{ face: VectorFontFaceInfo; bytes: Uint8Array }> = [];
  const discoveredFaces: VectorFontFaceInfo[] = [];
  for (const file of files) {
    if (totalBytes >= maxTotalBytes) break;
    let bytes: Uint8Array;
    try {
      bytes = await fs.readFile(file);
    } catch {
      skippedFiles++;
      continue;
    }
    if (bytes.byteLength > maxFileBytes || totalBytes + bytes.byteLength > maxTotalBytes) {
      skippedFiles++;
      continue;
    }
    totalBytes += bytes.byteLength;

    // The document may have been torn down during the awaited read; stop before
    // touching client.e (which throws "Engine not ready") and keep what registered.
    if (!client.engine) break;

    let faces: VectorFontFaceInfo[];
    try {
      faces = JSON.parse(client.e.inspectVectorFontFaces(bytes)) as VectorFontFaceInfo[];
    } catch {
      skippedFiles++;
      continue;
    }
    inspectedFaces += faces.length;
    for (const face of faces) {
      if (face.family.trim()) {
        discoveredFamilies.add(face.family.trim());
        // The style picker lists every family the scan saw, registered or not,
        // so the axes are read for every face, not only the registered ones.
        discoveredFaces.push({ ...face, axes: readVariationAxes(bytes, face.faceIndex) });
      }
      if (shouldRegisterFace(face, documentTargets)) documentCandidates.push({ face, bytes });
      else if (shouldRegisterFace(face, defaultTargets)) defaultCandidates.push({ face, bytes });
    }
  }

  // Second pass: register document-requested faces first, then defaults, under
  // the face cap — so on font-heavy systems the document's fonts win the budget.
  // Bracket the registrations in a font batch so open vector layers rerender once
  // instead of once per face.
  const candidates = [...documentCandidates, ...defaultCandidates];
  if (candidates.length && client.engine) {
    client.e.beginVectorFontBatch();
    try {
      for (const { face, bytes } of candidates) {
        if (registeredFaces >= maxRegisteredFaces) break;
        try {
          client.e.registerVectorFontFace(face.family, bytes, face.faceIndex, face.weight, face.italic);
          registeredFaces++;
          registeredFamilies.add(face.family);
        } catch {
          // A bad face should not abort provisioning of the rest of the font set.
        }
      }
    } finally {
      client.e.endVectorFontBatch();
    }
  }

  // Publish the style choices only after local aliases can actually render.
  await provisionCssFontFaces(discoveredFaces);
  if (registeredFaces > 0) options.onFontsChanged?.();
  const discovered = [...discoveredFamilies].sort((a, b) => a.localeCompare(b));
  // Faces first: the families callback is what repaints the type UI, and it must
  // repaint with this scan's styles already registered.
  if (discoveredFaces.length) options.onFacesDiscovered?.(discoveredFaces);
  if (discovered.length) options.onFamiliesDiscovered?.(discovered);
  return {
    status: !client.engine ? "inactive" : registeredFaces > 0 ? "registered" : "empty",
    scannedFiles: files.length,
    inspectedFaces,
    registeredFaces,
    registeredFamilies: [...registeredFamilies].sort((a, b) => a.localeCompare(b)),
    discoveredFamilies: discovered,
    skippedFiles,
  };
}

export interface VectorFontProvisionerConfig {
  /** Current document-requested font stacks (used as the dedup signature). */
  getDocumentFontStacks: () => string[];
  /** Runs one provisioning scan for the given document font stacks. */
  provision: (documentFontStacks: string[]) => Promise<VectorFontProvisioningSummary | void>;
  /** Called if a scan rejects; a failed scan does not poison later requests. */
  onError?: (error: unknown) => void;
  /**
   * Coalesce non-forced requests within this window (ms) so a burst of per-edit
   * notifications recomputes the document-font signature and scans at most once.
   * Forced requests (boot) are never debounced. 0 disables debouncing.
   */
  debounceMs?: number;
}

/**
 * Wrap font provisioning so overlapping requests never run concurrent disk
 * scans. Requests are serialized onto a single chain; a request whose document
 * font signature is unchanged (and is not forced) skips the scan entirely, and
 * non-forced requests are debounced. This coalesces the boot scan with document
 * open/mutate/revert notifications that would otherwise each walk every open
 * document's layers to recompute the signature.
 */
export function createVectorFontProvisioner(
  config: VectorFontProvisionerConfig,
): (force?: boolean) => Promise<void> {
  let tail: Promise<void> = Promise.resolve();
  let provisionedSignature: string | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;
  const debounceMs = config.debounceMs ?? 0;

  const runOnce = async (force: boolean): Promise<void> => {
    const documentFontStacks = config.getDocumentFontStacks();
    const signature = documentFontStacks.join("\n");
    if (!force && signature === provisionedSignature) return;
    try {
      const summary = await config.provision(documentFontStacks);
      // Home has no engine; the first document must retry even with no text.
      provisionedSignature = summary?.status === "inactive" ? null : signature;
    } catch (error) {
      config.onError?.(error);
    }
  };

  const enqueue = (force: boolean): Promise<void> => {
    tail = tail.then(() => runOnce(force));
    return tail;
  };

  return (force = false) => {
    if (force || debounceMs <= 0) {
      if (debounceTimer !== null) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
      }
      return enqueue(force);
    }
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      void enqueue(false);
    }, debounceMs);
    return tail;
  };
}
