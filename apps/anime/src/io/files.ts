// io/files — save/open the project as a Monet container (`.mani`), and bring
// images in as image layers. Native dialogs + fs in Tauri; download/upload
// fallback in a plain browser.
//
// Every Monet app writes the SAME container and opens every extension: which
// app a file belongs to is decided by its manifest, never by its name (design
// doc 11). The extension list below only picks *candidates* out of a drop or a
// file dialog — what a file IS is settled by `projectFromContainer`.

import { CONTAINER_APPS, type MonetContainer } from "@monet-ui/monet-format";
import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
// Durable save: a truncating writeFile loses the old document too if it is
// interrupted. Shared with every Monet app.
import { atomicWriteBytes } from "@monet-ui/monet-react";
import { addImageLayer, setLayerProps } from "../commands";
import { store } from "../state/store";
import { newContainer, projectFromContainer, projectToContainer } from "./anime";

/** Anime's own extension; a Save As with no name picked lands here. */
const DOC_EXTENSION = "mani";
/** All seven Monet extensions — Anime opens (and can save over) any of them. */
const DOC_EXTENSIONS = CONTAINER_APPS.map((row) => row.ext.slice(1));

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/**
 * The container the open document came from, kept so a save can courier every
 * entry Anime never consumed (rule 2). Keyed by the path it was opened from, so
 * File → New (path `null`) starts from a fresh container instead of inheriting
 * the last file's cargo.
 *
 * ponytail: one slot, since Anime edits one document at a time; and in the
 * browser fallback (no paths at all) a New Project after an open shares the
 * `null` key and would inherit that cargo. Extra bytes, never lost bytes — the
 * fix is a document id on the store, worth it only if Anime grows tabs.
 */
let source: { path: string | null; container: MonetContainer } | null = null;

export async function saveProject(forceDialog = false): Promise<void> {
  const s = store.getState();
  // Write into the container this document was opened from, so every entry
  // Anime never consumed rides along untouched.
  const container = source?.path === s.filePath ? source.container : newContainer();
  const bytes = projectToContainer(s.project, container);
  const name = s.project.name || "Untitled";
  if (isTauri()) {
    let path = forceDialog ? null : s.filePath;
    if (!path) {
      path = await save({ defaultPath: `${name}.${DOC_EXTENSION}`, filters: [{ name: "Monet", extensions: DOC_EXTENSIONS }] });
    }
    if (!path) return;
    await atomicWriteBytes(path, bytes);
    source = { path, container }; // Save As re-keys the cargo to the new file
    store.markClean(path);
  } else {
    downloadBytes(bytes, `${name}.${DOC_EXTENSION}`);
    source = { path: null, container };
    store.markClean();
  }
}

export function saveProjectAs(): Promise<void> {
  return saveProject(true);
}

/** Adopt container bytes as the current project and report — visibly — whatever
 *  Anime could not read (rule 1). Throws on bytes that are not a Monet
 *  container, so the MCP path can turn that into a real tool error. */
function adopt(bytes: Uint8Array, filePath?: string): void {
  const { project, container, hasTimeline, ignored } = projectFromContainer(bytes);
  source = { path: filePath ?? null, container };
  store.replaceProject(project, { ...(filePath ? { filePath } : {}), markClean: true });
  if (!hasTimeline) {
    notify(`No timeline in this document — nothing for Anime to show. Its ${ignored.length} entr${ignored.length === 1 ? "y is" : "ies are"} kept if you save.`, "warn");
  } else if (ignored.length > 0) {
    notify(`Opened. ${ignored.length} entr${ignored.length === 1 ? "y" : "ies"} Anime doesn't read (${ignored.join(", ")}) will be preserved on save.`);
  }
}

/** Same, but a bad file becomes a visible message rather than an unhandled
 *  rejection the user never sees. */
function adoptOrReport(bytes: Uint8Array, filePath?: string): void {
  try {
    adopt(bytes, filePath);
  } catch (e) {
    notify(`Could not open this document — ${e instanceof Error ? e.message : String(e)}`, "error");
  }
}

/** Open a Monet document from an absolute OS path, no dialog (MCP automation).
 *  Unlike `adoptOrReport` this throws, so the caller gets a real error instead
 *  of a toast nobody scripted for. */
export async function openDocumentPath(path: string): Promise<void> {
  adopt(await readFile(path), path);
}

export async function openProject(): Promise<void> {
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: "Monet", extensions: DOC_EXTENSIONS }] });
    if (!path || Array.isArray(path)) return;
    adoptOrReport(await readFile(path), path);
  } else {
    pickFiles(DOC_EXTENSIONS.map((e) => `.${e}`).join(","), false, async ([file]) =>
      adoptOrReport(new Uint8Array(await file.arrayBuffer())),
    );
  }
}

// ── image ingestion ───────────────────────────────────────────
// Anime declares an `image` layer kind but had no way to fill its `src`. An
// image arrives as bytes (native path) or a File (browser) and becomes a
// self-contained data URL, so the layer survives save/load and travels inside
// `timeline.json` to the other Monet apps.
//
// This is foreign-format INGEST, not container I/O — a `.png` is another
// vendor's file, and nothing here changed with the container.

const IMAGE_MIME: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  bmp: "image/bmp",
  avif: "image/avif",
  svg: "image/svg+xml",
};

export const IMAGE_EXTENSIONS = Object.keys(IMAGE_MIME);

function extOf(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? "";
  const dot = base.lastIndexOf(".");
  return dot < 0 ? "" : base.slice(dot + 1).toLowerCase();
}

export function isImagePath(path: string): boolean {
  return extOf(path) in IMAGE_MIME;
}

/** Does this name LOOK like a Monet document? Used only to pick a candidate out
 *  of a drop or a dialog — every one of the seven extensions qualifies, and what
 *  the file actually is comes from its manifest. */
export function isDocumentPath(path: string): boolean {
  return DOC_EXTENSIONS.includes(extOf(path));
}

/** `foo/bar/Sunset.png` → `Sunset` — the layer name a dropped image gets. */
export function layerNameFor(path: string): string {
  const base = (path.split(/[\\/]/).pop() ?? "image").replace(/\.[^.]+$/, "");
  return base || "Image";
}

/** Wrap raw image bytes as a data URL, typed from the file extension. */
export function imageDataUrl(bytes: Uint8Array, path: string): string {
  const mime = IMAGE_MIME[extOf(path)] ?? "image/png";
  let bin = "";
  const chunk = 0x8000; // fromCharCode(...) blows the call stack on a whole photo
  for (let i = 0; i < bytes.length; i += chunk) bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return `data:${mime};base64,${btoa(bin)}`;
}

/** Natural size of a data URL, so a placed image isn't a 300×300 stub. */
function imageSize(src: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => resolve({ width: img.naturalWidth || 300, height: img.naturalHeight || 300 });
    img.onerror = () => resolve({ width: 300, height: 300 });
    img.src = src;
  });
}

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error ?? new Error("could not read file"));
    reader.readAsDataURL(file);
  });
}

/** Place a decoded image as a new front layer at its natural size. */
async function placeImage(name: string, dataUrl: string): Promise<void> {
  const { width, height } = await imageSize(dataUrl);
  addImageLayer(name, dataUrl, width, height);
}

/** Prompt for image files and add one image layer per pick. */
export async function importImages(): Promise<void> {
  if (isTauri()) {
    const picked = await open({ multiple: true, filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }] });
    if (!picked) return;
    for (const path of Array.isArray(picked) ? picked : [picked]) await importImagePath(path);
  } else {
    pickFiles("image/*", true, async (files) => {
      for (const f of files) await placeImage(layerNameFor(f.name), await readFileAsDataUrl(f));
    });
  }
}

/** Add an image layer from an absolute OS path (drop / MCP automation).
 *  Throws on a non-image path so a caller can surface a real error instead of
 *  quietly adding an empty layer. */
export async function importImagePath(path: string): Promise<void> {
  if (!isImagePath(path)) throw new Error(`Not an image file: ${path}`);
  await placeImage(layerNameFor(path), imageDataUrl(await readFile(path), path));
}

/** Swap the source of an existing image layer (Properties → Source → Replace). */
export async function replaceLayerImage(layerId: string): Promise<void> {
  // Resize to the new image's natural size — keeping the old box would stretch it.
  const apply = async (dataUrl: string) => {
    const { width, height } = await imageSize(dataUrl);
    setLayerProps(layerId, { src: dataUrl, width, height }, "Replace image");
  };
  if (isTauri()) {
    const path = await open({ multiple: false, filters: [{ name: "Image", extensions: IMAGE_EXTENSIONS }] });
    if (!path || Array.isArray(path)) return;
    await apply(imageDataUrl(await readFile(path), path));
  } else {
    pickFiles("image/*", false, async ([file]) => apply(await readFileAsDataUrl(file)));
  }
}

// ── drag & drop ───────────────────────────────────────────────
// A dropped Monet document replaces the whole project, so a mixed drop resolves
// to the document — image layers added first would just be thrown away. Anything
// Anime can't read is reported rather than silently ignored.

/** Native (Tauri) drop: absolute OS paths. */
export async function openDroppedPaths(paths: string[]): Promise<void> {
  const doc = paths.find(isDocumentPath);
  if (doc) {
    adoptOrReport(await readFile(doc), doc);
    return;
  }
  for (const path of paths) {
    if (isImagePath(path)) await importImagePath(path);
    else notify(`Can't open "${path}" — drop a Monet document or an image.`, "error");
  }
}

/** Browser drop: `File` objects (vite dev server / headless e2e). */
export async function openDroppedFiles(files: File[]): Promise<void> {
  const doc = files.find((f) => isDocumentPath(f.name));
  if (doc) {
    adoptOrReport(new Uint8Array(await doc.arrayBuffer()));
    return;
  }
  for (const f of files) {
    if (isImagePath(f.name)) await placeImage(layerNameFor(f.name), await readFileAsDataUrl(f));
    else notify(`Can't open "${f.name}" — drop a Monet document or an image.`, "error");
  }
}

// ── visible reporting ─────────────────────────────────────────
// Rule 1: what an app ignored must be reported VISIBLY, not to the console.
// Anime's tree has no <ToastProvider>, so this pushes a card straight into the
// DOM with monet-core's own toast classes — same look as monet-react's Toaster.
// ponytail: no action button, no manual stack cap; click or wait to dismiss.
// Delete it for `useToast()` the day Anime wraps <App> in a <ToastProvider>.

const NOTICE_MS = 9000;

function notify(message: string, variant: "info" | "warn" | "error" = "info"): void {
  if (typeof document === "undefined") {
    console.error(`Anime: ${message}`);
    return;
  }
  let host = document.querySelector<HTMLElement>(".monet-toaster");
  if (!host) {
    host = document.createElement("div");
    host.className = "monet-toaster monet-toaster--bottom-right";
    host.setAttribute("role", "region");
    host.setAttribute("aria-label", "Notifications");
    host.style.zIndex = "9000";
    document.body.appendChild(host);
  }
  const card = document.createElement("div");
  card.className = `monet-toast monet-toast--${variant}`;
  card.setAttribute("role", variant === "info" ? "status" : "alert");
  card.setAttribute("aria-live", variant === "info" ? "polite" : "assertive");
  const body = document.createElement("div");
  body.className = "monet-toast-message";
  body.textContent = message; // textContent: a file name is untrusted input
  card.appendChild(body);
  card.onclick = () => card.remove();
  host.appendChild(card);
  setTimeout(() => card.remove(), NOTICE_MS);
}

function downloadBytes(bytes: Uint8Array, filename: string): void {
  // `Uint8Array<ArrayBufferLike>` isn't a `BlobPart` to TS (it can't rule out a
  // SharedArrayBuffer); at runtime this one is always a plain ArrayBuffer.
  const blob = new Blob([bytes as unknown as BlobPart], { type: "application/zip" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Browser file picker. Empty picks (the user cancelled) never call back. */
function pickFiles(accept: string, multiple: boolean, cb: (files: File[]) => void | Promise<void>): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = accept;
  input.multiple = multiple;
  input.onchange = () => {
    const files = Array.from(input.files ?? []);
    if (files.length) void cb(files);
  };
  input.click();
}
