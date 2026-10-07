// ─────────────────────────────────────────────────────────────
// files.ts — project save / open + Phaser export. Uses native Tauri dialogs +
// fs in the webview, and browser download / file-input fallbacks under the vite
// dev server. (De)serialisation + code generation are pure (io/jouer, io/
// export-phaser); this module is just the I/O plumbing.
// ─────────────────────────────────────────────────────────────

import { isTauri } from "@tauri-apps/api/core";
import {
  CONTAINER_APPS,
  initMonetFormat,
  isContainer,
  readContainer,
  writeContainer,
  type MonetContainer,
} from "@monet-ui/monet-format";
import { store } from "../state/app";
import { addImageAsset } from "../commands";
import { containerReport, projectFromContainer, projectToContainer } from "./jouer";
import { exportGameJs, exportStandaloneHtml } from "./export-phaser";

function downloadBlob(name: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.oncancel = () => resolve(null);
    input.click();
  });
}

async function writeBytes(defaultName: string, bytes: Uint8Array, ext: string, mime: string): Promise<string | null> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { atomicWriteBytes } = await import("@monet-ui/monet-react");
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return null;
    // Durable save (shared): fully-synced sibling renamed over the destination.
    await atomicWriteBytes(path, bytes);
    return path;
  }
  // Copied into a plain ArrayBuffer-backed view — what `Blob` accepts.
  downloadBlob(defaultName, new Blob([new Uint8Array(bytes)], { type: mime }));
  return defaultName;
}

function writeTextFile(defaultName: string, contents: string, ext: string, mime: string): Promise<string | null> {
  return writeBytes(defaultName, new TextEncoder().encode(contents), ext, mime);
}

function safeName(s: string): string {
  return s.replace(/\s+/g, "_").replace(/[^A-Za-z0-9_-]/g, "") || "Untitled";
}

// ── project save / open ──────────────────────────────────────
/** Jouer's own extension. Every Monet container opens here whatever it is named. */
const EXT = "mjou";

/** The container the open document came from, so every entry and manifest field
 *  Jouer does not own is written back out on save (design doc 11 rule 2).
 *  ponytail: module-scoped, cleared only by the next open — File ▸ New leaves the
 *  store's `filePath` in place too, so a New-then-Save inherits the previous
 *  document's foreign entries. Hang it off the store's document when that bites. */
let opened: MonetContainer | null = null;

export async function saveProject(): Promise<void> {
  const project = store.getProject();
  await initMonetFormat();
  const bytes = writeContainer(projectToContainer(project, opened));
  const path = await writeBytes(`${safeName(project.name)}.${EXT}`, bytes, EXT, "application/zip");
  if (path) store.markClean(path);
}

function reportOpenFailure(e: unknown): void {
  console.error("Failed to open project:", e);
  alert(`Could not open project: ${e instanceof Error ? e.message : String(e)}`);
}

/** Open any Monet container — dispatch is on the MANIFEST, never the file name,
 *  so a `.mcin` renamed `.mjou` still opens as what it really is. */
async function openContainerBytes(bytes: Uint8Array, path: string | null): Promise<void> {
  await initMonetFormat();
  if (!isContainer(bytes)) throw new Error("Not a Monet document (no manifest.json).");
  const container = readContainer(bytes);
  const project = projectFromContainer(container);
  opened = container;
  store.replaceProject(project, { dirty: false, filePath: path });
  // Rule 1: what Jouer ignored is reported where the user can see it.
  const report = containerReport(container);
  if (report) alert(report);
}

/** Open a project from an absolute OS path, no dialog (MCP automation). Throws
 *  — the caller reports it, so a failed open can't look like a successful one. */
export async function openProjectPath(path: string): Promise<void> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  await openContainerBytes(await readFile(path), path);
}

export async function openProject(): Promise<void> {
  const exts = CONTAINER_APPS.map((a) => a.ext.slice(1));
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: [{ name: "Monet Document", extensions: exts }] });
    if (typeof sel !== "string") return;
    try { await openProjectPath(sel); } catch (e) { reportOpenFailure(e); }
    return;
  }
  const picked = await pickFile(CONTAINER_APPS.map((a) => a.ext).join(","));
  if (!picked) return;
  try {
    await openContainerBytes(new Uint8Array(await picked.arrayBuffer()), null);
  } catch (e) {
    reportOpenFailure(e);
  }
}

// ── Phaser export ────────────────────────────────────────────
export async function exportHtml(): Promise<void> {
  const project = store.getProject();
  // Lazy like the Tauri plugin imports below — keeps Phaser (and its `window`
  // requirement) out of this module's import graph until an export runs.
  const { activeEngine } = await import("../phaser/engines");
  // Pin the CDN to the engine version you're currently testing in.
  const html = exportStandaloneHtml(project, activeEngine().version);
  await writeTextFile(`${safeName(project.name)}.html`, html, "html", "text/html");
}

export async function exportJs(): Promise<void> {
  const project = store.getProject();
  const js = exportGameJs(project);
  await writeTextFile(`${safeName(project.name)}.game.js`, js, "js", "text/javascript");
}

// ── asset import (image / spritesheet as a self-contained data URL) ──
export interface ImportedImage { name: string; dataUrl: string; width: number; height: number }

/** The image types Jouer can turn into a sprite asset. */
export const IMAGE_EXTS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/** A droppable image: a native OS path (Tauri) or a `File` (browser). Both
 *  arrive from `useFileDrop`, and both are also what the dialogs hand back. */
export type ImageSource = string | File;

function sourceName(src: ImageSource): string {
  return typeof src === "string" ? (src.split(/[\\/]/).pop() ?? "image") : src.name;
}

/** Keep only the dropped items Jouer can import, in drop order. */
export function imageDrops<T extends ImageSource>(items: T[]): T[] {
  return items.filter((i) => IMAGE_EXTS.includes(extOf(sourceName(i))));
}

/** Read one image — from an OS path or a `File` — into an asset payload. */
export async function importImage(src: ImageSource): Promise<ImportedImage> {
  const name = sourceName(src);
  let dataUrl: string;
  if (typeof src === "string") {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    dataUrl = `data:${mimeForExt(name)};base64,${base64FromBytes(await readFile(src))}`;
  } else {
    dataUrl = await dataUrlFromFile(src);
  }
  const dims = await imageSize(dataUrl);
  return { name: name.replace(/\.[^.]+$/, ""), dataUrl, width: dims.width, height: dims.height };
}

/** Prompt for an image file and return its name + data URL + intrinsic size. */
export async function importImageFile(): Promise<ImportedImage | null> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const sel = await open({ multiple: false, filters: [{ name: "Image", extensions: IMAGE_EXTS }] });
    if (typeof sel !== "string") return null;
    return importImage(sel);
  }
  const picked = await pickFile("image/*");
  return picked ? importImage(picked) : null;
}

/** Drop handler: every dropped image becomes an asset in the library, ready to
 *  drag into the scene. A drop carrying nothing importable says so rather than
 *  looking like it worked.
 *  ponytail: assets only — placing a sprite at the drop point needs canvas
 *  coordinates the window-scoped `useFileDrop` doesn't carry; add a target
 *  param there when a caller needs the position. */
export async function importDroppedImages(items: ImageSource[]): Promise<void> {
  const images = imageDrops(items);
  if (!images.length) {
    alert(`Jouer imports images only (${IMAGE_EXTS.join(", ")}).`);
    return;
  }
  for (const src of images) {
    try {
      const img = await importImage(src);
      addImageAsset(img.name, img.dataUrl, "image", { width: img.width, height: img.height });
    } catch (e) {
      console.error("Failed to import dropped image:", e);
      alert(`Could not import ${sourceName(src)}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }
}

function dataUrlFromFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error(`Could not read ${file.name}`));
    reader.readAsDataURL(file);
  });
}

function extOf(name: string): string {
  const dot = name.lastIndexOf("."); // no dot → no extension (not the whole name)
  return dot < 0 ? "" : name.slice(dot + 1).toLowerCase();
}

function mimeForExt(name: string): string {
  return ({ png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", bmp: "image/bmp" } as Record<string, string>)[extOf(name)] ?? "image/png";
}

function base64FromBytes(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}

function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => resolve({ width: 64, height: 64 });
    img.src = src;
  });
}
