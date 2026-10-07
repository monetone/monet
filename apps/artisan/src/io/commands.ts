// ─────────────────────────────────────────────────────────────
// io/commands — file actions (save / open / export) bound to the store
// ─────────────────────────────────────────────────────────────
// Everything goes through io/files, which picks the native (Tauri dialog + fs)
// or browser backend. Save writes in place once the document has a path;
// failures surface as a toast (or a native message dialog before the app is
// mounted), never console-only — a save that silently did nothing is how work
// gets lost.
//
// Two document homes: `.artisan` JSON, and the universal Monet container —
// `.mart` when Artisan writes one, but ANY of the seven extensions when another
// app did (docs/plans/11-universal-container.md). Dispatch is on the manifest,
// never on the file name.
//
// The container path carries TWO couriers, because Artisan understands only a
// slice of what a container can hold:
//   • the loaded wasm Engine re-emits the graphics document and its out-of-line
//     pixel/mask/channel blobs, so Vision's raster layers survive a round trip;
//   • the `MonetContainer` this document was read from keeps every OTHER entry
//     byte-for-byte — a Rythme timeline, a Galerie catalog — plus unknown
//     manifest fields (rule 2).

import { type DialogFilter, message } from "@monet-ui/monet-react";
import {
  CONTAINER_APPS,
  containerAppForExtension,
  createContainer,
  initMonetFormat,
  type MonetContainer,
  readContainer,
  removeEntry,
  setEntry,
  writeContainer,
} from "@monet-ui/monet-format";
import {
  type AseSwatch,
  aseSwatchFromHex,
  buildAseSwatches,
  isActLength,
  parseAco,
  parseAct,
  parseAseSwatches,
  MAX_ACO_IMPORT_BYTES,
  MAX_ASE_IMPORT_BYTES,
} from "@monet-ui/monet-imageio";
import {
  exportForScreensManifestOptions,
  fromHex,
  type ArtisanStore,
  IO,
  makeDocument,
  type Paint,
  processPaint,
  solid,
  spotPaint,
  toHex,
} from "../engine";
import { commands } from "../commands";
import type { GraphicsContainer } from "../engine-rs/EngineClient";
import { confirmDiscard } from "../state/app";
import { baseName, downloadText, pickDirectory, pickFile, readBytesFrom, saveBytesFile, saveDataURLFile, saveTextFile, svgToPngDataURL, writeBytesTo, writeTextTo } from "./files";
import { buildExportForScreensManifest } from "./compatibility";
import { detectFormat, importFile } from "./import";

/** The seven container extensions, dotless — every one of them opens here. */
const CONTAINER_EXTS = CONTAINER_APPS.map((row) => row.ext.slice(1));

const IMPORT_ACCEPT = `.artisan,${CONTAINER_APPS.map((row) => row.ext).join(",")},.svg,.svgz,.ai,.eps,.ps,.pdf,.cdr,application/json,image/svg+xml,application/pdf`;

const IMPORT_FILTERS: DialogFilter[] = [
  { name: "All Supported", extensions: ["artisan", ...CONTAINER_EXTS, "svg", "svgz", "ai", "eps", "ps", "pdf", "cdr"] },
  { name: "Monet Artisan", extensions: ["mart"] },
  { name: "Monet Document", extensions: CONTAINER_EXTS },
  { name: "Artisan Document (JSON)", extensions: ["artisan"] },
  { name: "SVG", extensions: ["svg", "svgz"] },
  { name: "Illustrator / PostScript", extensions: ["ai", "eps", "ps"] },
  { name: "PDF", extensions: ["pdf"] },
  { name: "CorelDRAW", extensions: ["cdr"] },
];
const MART_FILTERS: DialogFilter[] = [{ name: "Monet Artisan", extensions: ["mart"] }];
const SVG_FILTERS: DialogFilter[] = [{ name: "SVG", extensions: ["svg"] }];
const PNG_FILTERS: DialogFilter[] = [{ name: "PNG", extensions: ["png"] }];
const JSON_FILTERS: DialogFilter[] = [{ name: "JSON", extensions: ["json"] }];
const SWATCH_FILTERS: DialogFilter[] = [{ name: "Adobe Swatches", extensions: ["aco", "ase", "act"] }];
const SWATCH_ACCEPT = ".aco,.ase,.act,application/octet-stream";
const ASE_FILTERS: DialogFilter[] = [{ name: "Adobe Swatch Exchange", extensions: ["ase"] }];
const CONTAINER_MIME = "application/vnd.monet.container";

/** Who wrote it last (manifest `app`).
 *  ponytail: the version is pinned by hand — wire it to package.json the day a
 *  reader needs to branch on it. */
const ARTISAN_APP = { name: "monet-artisan", version: "0.1.0" };

/** The roles the wasm Engine reads AND re-emits: the graphics document plus its
 *  out-of-line blobs. Everything else in a container is ignored on open and
 *  couriered on save (rules 1 and 2). */
const ENGINE_ROLES = new Set(["graphics", "pixels", "masks", "channels"]);

// ── user-visible reporting ───────────────────────────────────────────
// IO problems belong on screen, not in the console: a save that silently did
// nothing is how work gets lost. App.tsx installs the toast sink; the native
// message dialog stays as the headless / pre-mount fallback so an error can
// never end up console-only.

export interface IoNotice {
  title?: string;
  message: string;
  variant?: "info" | "warn" | "error";
  duration?: number | null;
}

let notify: ((notice: IoNotice) => void) | null = null;

/** Install (or clear) the toast sink these commands report through. */
export function setIoNotifier(sink: ((notice: IoNotice) => void) | null): void {
  notify = sink;
}

/** Report a failed IO action loudly (toast, or native dialog) plus the console. */
async function fail(what: string, e: unknown): Promise<void> {
  const detail = e instanceof Error ? e.message : String(e);
  console.error(`[Artisan] ${what} failed:`, e);
  if (notify) notify({ title: `${what} failed`, message: detail, variant: "error", duration: null });
  else await message(`${what} failed: ${detail}`, { title: "Monet Artisan", kind: "error" });
}

/** Report something the user should know but that did not fail the action. */
function notice(text: string, variant: "info" | "warn" = "warn"): void {
  console.info(`[Artisan] ${text}`);
  notify?.({ message: text, variant });
}

// ── container courier ────────────────────────────────────────────────
// What the open document came from, held so everything Artisan cannot author
// survives save: the wasm `engine` re-emits the graphics family, `container`
// holds every other entry (and every unknown manifest field) verbatim.
interface Courier {
  /** The container as read, minus nothing — the byte-for-byte courier. */
  container: MonetContainer;
  /** Live Engine for the graphics entry; `null` when the file carried none. */
  engine: GraphicsContainer | null;
}

const couriers = new WeakMap<ArtisanStore, Courier>();

function setCourier(s: ArtisanStore, next: Courier | null): void {
  const previous = couriers.get(s);
  if (previous?.engine && previous.engine !== next?.engine) previous.engine.dispose();
  if (next) couriers.set(s, next);
  else couriers.delete(s);
}

const courierFor = (s: ArtisanStore): Courier | null => couriers.get(s) ?? null;

/**
 * Fold the Engine's freshly written graphics container into `base`, replacing
 * ONLY the entries the Engine owns. Every other entry of `base` — and its
 * manifest's unknown fields and `kind` — is left exactly as it was read.
 * This is rule 2, and it is the whole reason a Rythme timeline survives a save
 * from Artisan.
 */
export function mergeGraphics(base: MonetContainer, engineBytes: Uint8Array): MonetContainer {
  const inner = readContainer(engineBytes);
  for (const entry of [...base.manifest.entries]) {
    if (ENGINE_ROLES.has(entry.role)) removeEntry(base, entry.path);
  }
  for (const entry of inner.entries) {
    const role = inner.manifest.entries.find((e) => e.path === entry.path)?.role ?? "asset";
    setEntry(base, entry.path, role, entry.data);
  }
  base.manifest.app = ARTISAN_APP; // who wrote it last
  return base;
}

/** Container bytes for the current document: the courier's own container with
 *  our graphics entries refreshed, else a fresh single-vector-layer `.mart`. */
async function containerBytes(s: ArtisanStore): Promise<Uint8Array> {
  await initMonetFormat();
  const json = IO.serializeDocument(s.doc);
  const held = courierFor(s);
  let engineBytes: Uint8Array;
  if (held?.engine) {
    engineBytes = held.engine.save(json);
  } else {
    // `initMonetFormat()` above boots the CONTAINER wasm; the graphics writer is
    // a different module (the render engine) and throws "the rendering engine is
    // still loading" until it is booted too. Nothing else on the Save path does
    // that, so saving before the canvas had rendered failed and the document was
    // never marked clean — the user's work looked unsaved and dirty.
    const { graphicsContainerFrom, initEngine } = await import("../engine-rs/EngineClient");
    await initEngine();
    const ab = s.doc.artboards[s.doc.activeArtboard] ?? s.doc.artboards[0];
    engineBytes = graphicsContainerFrom(json, ab?.width ?? 1, ab?.height ?? 1);
  }
  return writeContainer(mergeGraphics(held?.container ?? createContainer(ARTISAN_APP, "graphics"), engineBytes));
}

/** The single open path — menu ▸ Open and OS drag-and-drop both land here.
 *  `path` is present only for native opens (a browser has none to save back to). */
async function openBytes(s: ArtisanStore, name: string, bytes: Uint8Array, path?: string): Promise<boolean> {
  if (detectFormat(name, bytes) === "container") return openContainer(s, name, bytes, path);
  // importFile throws on anything unreadable, and the document currently open is
  // still the user's. Dropping the courier first meant a FAILED open silently
  // stripped that document of every container entry Artisan does not author, so
  // the next Save wrote them away. Only release it once the new doc is in hand.
  const { doc, warnings, report } = await importFile(name, bytes);
  if (!(await confirmDiscard(s))) return false;
  setCourier(s, null);
  // Only a native Artisan document round-trips back to its own file; an
  // imported SVG/PDF/AI opens untitled so ⌘S can't clobber the source with
  // Artisan JSON.
  s.replaceDoc(doc, { markClean: true, filePath: report.format === "artisan" ? path : undefined });
  if (warnings.length) notice(`Import warnings: ${warnings.join(" · ")}`);
  return true;
}

/** Open ANY Monet container — the manifest decides what we get, never the
 *  extension. What Artisan does not understand is reported and couriered. */
async function openContainer(s: ArtisanStore, name: string, bytes: Uint8Array, path?: string): Promise<boolean> {
  await initMonetFormat();
  const container = readContainer(bytes);
  const hasGraphics = container.manifest.entries.some((e) => e.role === "graphics");

  let engine: GraphicsContainer | null = null;
  if (hasGraphics) {
    const { openGraphicsContainer } = await import("../engine-rs/EngineClient");
    engine = openGraphicsContainer(bytes);
  }
  const doc = engine?.scene ? IO.deserializeDocument(engine.scene) : makeDocument();
  doc.name = name.replace(/\.[^.]+$/, "") || "Untitled";
  if (!(await confirmDiscard(s))) {
    engine?.dispose();
    return false;
  }
  s.replaceDoc(doc, { markClean: true, filePath: path });
  setCourier(s, { container, engine: path ? engine : null });
  if (!path) engine?.dispose();
  reportIgnored(name, container, !!engine?.scene);
  return true;
}

/** Rule 1, the visible half: say what we loaded and what merely rode along.
 *  A container with no vector layer is NOT an error — but it must never look
 *  like a document that lost everything, so it is a warning, not a whisper. */
function reportIgnored(name: string, container: MonetContainer, hasScene: boolean): void {
  const ignored = container.manifest.entries.filter((e) => !ENGINE_ROLES.has(e.role));
  const list = ignored.slice(0, 3).map((e) => e.path).join(", ") + (ignored.length > 3 ? `, +${ignored.length - 3} more` : "");
  const carried = ignored.length
    ? ignored.length === 1
      ? ` 1 entry Artisan does not read (${list}) is kept and written back untouched.`
      : ` ${ignored.length} entries Artisan does not read (${list}) are kept and written back untouched.`
    : "";
  if (!hasScene) notice(`"${name}" (${container.manifest.app?.name ?? "unknown app"}) has no vector layer to edit — you are starting from an empty artboard.${carried}`);
  else if (ignored.length) notice(`Opened the vector layer of "${name}".${carried}`, "info");
}

const cmykComponents = (record: AseSwatch) => record.model === "CMYK" ? {
  c: record.components[0] * 100,
  m: record.components[1] * 100,
  y: record.components[2] * 100,
  k: record.components[3] * 100,
} : undefined;

export function paintFromAse(record: AseSwatch): Paint {
  const color = fromHex(record.hex);
  const components = cmykComponents(record);
  if (record.colorType === 1) {
    const paint = spotPaint(record.name, color);
    if (paint.type === "solid" && paint.ink && components) paint.ink.components = components;
    return paint;
  }
  if (components) {
    const paint = processPaint(color, components);
    if (paint.type === "solid" && paint.ink) paint.ink.name = record.name;
    return paint;
  }
  return solid(color);
}

export function aseSwatchFromPaint(paint: Extract<Paint, { type: "solid" }>): AseSwatch {
  const fallback = aseSwatchFromHex(toHex(paint.color));
  if (!paint.ink) return fallback;
  const { components } = paint.ink;
  return {
    ...fallback,
    name: paint.ink.name,
    colorType: paint.ink.kind === "spot" ? 1 : 2,
    ...(components ? {
      model: "CMYK" as const,
      components: [components.c ?? 0, components.m ?? 0, components.y ?? 0, components.k ?? 0].map((value) => value / 100),
    } : {}),
  };
}

/** Decode .aco / .ase / .act bytes → document paints.
 *  Auto-detected: "ASEF" → .ase; an exact 768/772-byte length → .act (it
 *  carries no magic); otherwise .aco. */
function readSwatchLibrary(bytes: Uint8Array): Paint[] {
  const isAse = bytes.length >= 4 && bytes[0] === 0x41 && bytes[1] === 0x53 && bytes[2] === 0x45 && bytes[3] === 0x46; // "ASEF"
  if (isAse) {
    if (bytes.length > MAX_ASE_IMPORT_BYTES) throw new Error(`.ase files above ${MAX_ASE_IMPORT_BYTES >> 20} MB are not imported.`);
    return parseAseSwatches(bytes).map(paintFromAse);
  }
  if (isActLength(bytes.length)) return parseAct(bytes).map((hex) => solid(fromHex(hex)));
  if (bytes.length > MAX_ACO_IMPORT_BYTES) throw new Error(`.aco files above ${MAX_ACO_IMPORT_BYTES >> 20} MB are not imported.`);
  return parseAco(bytes).map((hex) => solid(fromHex(hex)));
}

/** Gradients/none have no single colour and Illustrator's .ase export drops them too. */
const solidSwatches = (s: ArtisanStore): Extract<Paint, { type: "solid" }>[] =>
  s.doc.swatches.filter((paint): paint is Extract<Paint, { type: "solid" }> => paint.type === "solid");

export const fileCommands = {
  async new(s: ArtisanStore): Promise<boolean> {
    if (!(await confirmDiscard(s))) return false;
    setCourier(s, null);
    s.replaceDoc(makeDocument(), { markClean: true });
    return true;
  },

  /** Save to the document's own path when it has one, else ask (Save As).
   *  A container home file is rewritten as a container — whichever of the seven
   *  extensions it wears — and a plain `.artisan` as JSON. */
  async save(s: ArtisanStore) {
    const path = s.filePath;
    if (!path) return fileCommands.saveAs(s);
    try {
      const revision = s.getState().revision;
      // The courier answers for a container renamed to something not in the
      // registry; the registry answers for one saved-as but never opened.
      if (courierFor(s) || containerAppForExtension(path)) await writeBytesTo(path, await containerBytes(s));
      else await writeTextTo(path, IO.serializeDocument(s.doc, true));
      s.markSavedAtRevision(revision, path);
    } catch (e) {
      await fail("Save", e);
    }
  },

  /** Write the document as a `.mart` — a v1 Monet container carrying Artisan's
   *  vector layer. Entries of a container the document was opened from ride
   *  along untouched (courier rule). */
  async saveAs(s: ArtisanStore) {
    try {
      const revision = s.getState().revision;
      const bytes = await containerBytes(s);
      const out = await saveBytesFile(`${s.doc.name}.mart`, bytes, MART_FILTERS, CONTAINER_MIME);
      if (!out) return; // user cancelled the native dialog — stay dirty
      const held = courierFor(s);
      s.markSavedAtRevision(revision, out.path);
      setCourier(s, { container: held?.container ?? readContainer(bytes), engine: held?.engine ?? null });
    } catch (e) {
      await fail("Save", e);
    }
  },

  async open(s: ArtisanStore) {
    const f = await pickFile(IMPORT_FILTERS, IMPORT_ACCEPT);
    if (!f) return false;
    try {
      return await openBytes(s, f.name, f.bytes, f.path);
    } catch (e) {
      await fail("Open", e);
      return false;
    }
  },

  // ponytail: Artisan is a single-document app, so the first dropped file wins.
  // Opening the rest needs a document-tab model first.

  /** Open one absolute path, no dialog. Throws — the caller reports it. Drops
   *  toast through `openPaths`; the MCP `doc.open` tool surfaces the error to
   *  its client instead, so it must not be swallowed here. */
  async openPath(s: ArtisanStore, path: string): Promise<boolean> {
    return openBytes(s, baseName(path), await readBytesFrom(path), path);
  },

  /** OS drag-and-drop inside the Tauri webview — absolute paths. */
  async openPaths(s: ArtisanStore, paths: string[]) {
    const path = paths[0];
    if (!path) return;
    try {
      await fileCommands.openPath(s, path);
    } catch (e) {
      await fail("Open", e);
    }
  },

  /** HTML5 drag-and-drop in a plain browser — `File` objects, no paths. */
  async openFiles(s: ArtisanStore, files: File[]) {
    const file = files[0];
    if (!file) return;
    try {
      await openBytes(s, file.name, new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      await fail("Open", e);
    }
  },

  async exportSvg(s: ArtisanStore) {
    const svg = IO.exportSVG(s.doc, { background: true });
    try {
      await saveTextFile(`${s.doc.name}.svg`, svg, SVG_FILTERS, "image/svg+xml");
    } catch (e) {
      await fail("SVG export", e);
    }
  },

  /** Native: pick one folder and write every slice into it. Browser: one
   *  download per slice (there is no folder to pick there). */
  async exportSlices(s: ArtisanStore) {
    const slices = s.doc.slices ?? [];
    if (!slices.length) {
      notice("No slices to export.", "info");
      return;
    }
    const files = slices.map((slice, i) => ({
      name: `${s.doc.name}-${slice.name || "slice"}-${String(i + 1).padStart(2, "0")}.svg`,
      svg: IO.exportSVG(s.doc, { background: true, region: slice }),
    }));
    try {
      const dir = await pickDirectory();
      if (!dir) return;
      if (!dir.path) {
        // ponytail: N separate downloads in the browser; zip them if the slice
        // counts ever get uncomfortable.
        for (const f of files) downloadText(f.name, f.svg, "image/svg+xml");
        return;
      }
      for (const f of files) await writeTextTo(`${dir.path}/${f.name}`, f.svg);
    } catch (e) {
      await fail("Slice export", e);
    }
  },

  async exportForScreensManifest(s: ArtisanStore) {
    const manifest = buildExportForScreensManifest(s.doc, exportForScreensManifestOptions(s.doc));
    try {
      await saveTextFile(manifest.manifestPath, JSON.stringify(manifest, null, 2), JSON_FILTERS, "application/json");
    } catch (e) {
      await fail("Manifest export", e);
    }
  },

  // ── Adobe swatch libraries (.aco / .ase / .act) ────────────────────
  // The palette half of interop: the same libraries Vision imports, so a
  // colour book moves between Monet apps and Illustrator/Photoshop unchanged.

  /** Merge an Adobe swatch library into the document's swatches. */
  async importSwatches(s: ArtisanStore) {
    const f = await pickFile(SWATCH_FILTERS, SWATCH_ACCEPT);
    if (!f) return;
    try {
      const paints = readSwatchLibrary(f.bytes);
      if (!paints.length) {
        // Loud, not plausible: an unreadable library must not look like an
        // empty one the user simply had nothing in.
        notice(`No colours found in "${f.name}" — it may not be a swatch file.`);
        return;
      }
      const added = commands.importSwatches(s, paints);
      notice(added ? `Imported ${added} of ${paints.length} colours from "${f.name}".` : `Every colour in "${f.name}" is already a swatch.`, "info");
    } catch (e) {
      await fail("Swatch import", e);
    }
  },

  /** Write the document's solid swatches as an .ase library. CMYK components
   *  and spot identity live on Paint.ink, so save/reopen does not flatten them.
   *  LAB/GRAY still export from their rendered RGB preview because Paint.ink
   *  has no carrier for those component models.
   *  ponytail: .ase only — Illustrator's native swatch format, which Photoshop
   *  also reads. Add .aco/.act writers here if a paletted-export workflow asks. */
  async exportSwatches(s: ArtisanStore) {
    const paints = solidSwatches(s);
    if (!paints.length) {
      notice("No solid swatches to export.", "info");
      return;
    }
    try {
      const records = paints.map(aseSwatchFromPaint);
      await saveBytesFile(`${s.doc.name}.ase`, buildAseSwatches(records), ASE_FILTERS, "application/octet-stream", "Export");
    } catch (e) {
      await fail("Swatch export", e);
    }
  },

  async exportPng(s: ArtisanStore) {
    const ab = s.doc.artboards[s.doc.activeArtboard] ?? s.doc.artboards[0];
    if (!ab) return;
    const svg = IO.exportSVG(s.doc, { background: true });
    try {
      const url = await svgToPngDataURL(svg, ab.width, ab.height, 2);
      await saveDataURLFile(`${s.doc.name}.png`, url, PNG_FILTERS);
    } catch (e) {
      await fail("PNG export", e);
    }
  },
};
