// ─────────────────────────────────────────────────────────────
// files.ts — project save / open + EDL / frame export. Uses native Tauri
// dialogs + fs when in the webview, and browser download / file-input fallbacks
// under the vite dev server. Project (de)serialization is pure (timeline/io).
// ─────────────────────────────────────────────────────────────

import { isTauri } from "@tauri-apps/api/core";
import { CONTAINER_APPS, isContainer, type MonetContainer } from "@monet-ui/monet-format";
import { engine, store } from "../state/app";
import { importFromPath, importFromUrl } from "../media/import";
import { relinkProjectMedia } from "../media/resolve";
import { activeSequence } from "../timeline/model/query";
import { projectFromContainer, projectToContainer, type OpenedContainer } from "../timeline/io/cinema";
import type { Project } from "../timeline/model/types";
import { exportEdl as buildEdl } from "../timeline/io/edl";
import { exportVideo } from "../playback/export";

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

async function writeFile(defaultName: string, contents: string | Uint8Array, ext: string, mime: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { atomicWriteBytes } = await import("@monet-ui/monet-react");
    const path = await save({ defaultPath: defaultName, filters: [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (!path) return false;
    // Durable save (shared): a fully-synced sibling renamed over the destination,
    // so an interrupted write cannot destroy an existing project file.
    await atomicWriteBytes(path, typeof contents === "string" ? new TextEncoder().encode(contents) : contents);
    return true;
  }
  downloadBlob(defaultName, new Blob([contents as BlobPart], { type: mime }));
  return true;
}

/**
 * A visible, non-blocking notice. Rule 1 says report what we ignored to the
 * USER, not the console.
 *
 * ponytail: a bare live region, because Cinema's shell has no `<ToastProvider>`;
 * swap it for @monet-ui/monet-react's `useToast` once App.tsx mounts one.
 */
function notify(message: string): void {
  console.info(message);
  const el = document.createElement("div");
  el.setAttribute("role", "status");
  el.style.cssText =
    "position:fixed;left:50%;bottom:24px;transform:translateX(-50%);z-index:9999;max-width:min(680px,90vw);" +
    "padding:10px 14px;border-radius:8px;background:rgba(20,20,24,.92);color:#fff;" +
    "font:13px/1.4 system-ui,sans-serif;box-shadow:0 6px 24px rgba(0,0,0,.35)";
  el.textContent = message;
  document.body.append(el);
  setTimeout(() => el.remove(), 8000);
}

/**
 * The container the open document came from, so a save couriers every entry
 * Cinema did not consume (rule 2). It survives editing because sequences keep
 * their ids through the store's clone-on-write; File ▸ New mints fresh ones, so
 * its document does not inherit someone else's cargo.
 *
 * ponytail: id lineage, not real document identity — move the container onto the
 * store once the store owns one. Ceiling: delete every opened sequence and the
 * next save starts a clean container.
 */
let source: { container: MonetContainer; seqIds: string[] } | undefined;

function sourceFor(project: Project): MonetContainer | undefined {
  const src = source;
  return src && project.sequences.some((s) => src.seqIds.includes(s.id)) ? src.container : undefined;
}

export async function saveProject(): Promise<void> {
  const project = store.getProject();
  const bytes = projectToContainer(project, sourceFor(project));
  const name = `${project.name.replace(/\s+/g, "_") || "Untitled"}.mcin`;
  const ok = await writeFile(name, bytes, "mcin", "application/zip");
  if (ok) store.markSaved();
}

/** Every Monet container extension — Cinema opens all seven. This only routes a
 *  drop (document vs media); what actually loads is decided by the manifest. */
const PROJECT_EXTS = CONTAINER_APPS.map((row) => row.ext.slice(1));

/** True for a path or filename Cinema should open as a project, not import. */
export function isProjectFile(name: string): boolean {
  return PROJECT_EXTS.includes(name.toLowerCase().split(".").pop() ?? "");
}

/** Replace the document with any Monet container, dispatching on its MANIFEST —
 *  a `.mcin` renamed `.mvis` opens the same, and a Rythme `.mryt` opens as far as
 *  Cinema understands it. Everything unread is kept for the next save. */
async function loadContainer(bytes: Uint8Array, label: string): Promise<void> {
  if (!isContainer(bytes)) return notify(`${label} is not a Monet document.`);
  let opened: OpenedContainer;
  try {
    opened = projectFromContainer(bytes);
  } catch (e) {
    return notify(`Could not open ${label}: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!opened.project) {
    return notify(`${label} is a ${opened.app} document with no timeline — Cinema has nothing to open from it.`);
  }
  source = { container: opened.container, seqIds: opened.project.sequences.map((s) => s.id) };
  store.replaceProject(opened.project, { dirty: false });
  if (opened.ignored.length > 0) {
    notify(
      `Opened a ${opened.app} document. Cinema doesn't read ${opened.ignored.length} of its parts ` +
        `(${opened.ignored.join(", ")}) — they are kept when you save.`,
    );
  }
  // Media handles live outside the document: re-read every source (or decode a
  // Rythme PCM embed) so the opened project actually plays.
  await relinkProjectMedia(store.getProject(), opened.json ?? undefined);
}

export async function openProject(): Promise<void> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const sel = await open({ multiple: false, filters: [{ name: "Monet Document", extensions: PROJECT_EXTS }] });
    if (typeof sel === "string") await loadContainer(await readFile(sel), sel);
    return;
  }
  const f = await pickFile(PROJECT_EXTS.map((e) => `.${e}`).join(","));
  if (f) await loadContainer(new Uint8Array(await f.arrayBuffer()), f.name);
}

/**
 * Native (Tauri) window drop: absolute OS paths. A dropped project is opened
 * first — it replaces the document — then everything else lands in the bin of
 * whatever project is now open. One bad file never kills the rest of the drop.
 */
export async function openDroppedPaths(paths: string[]): Promise<void> {
  const doc = paths.find(isProjectFile);
  if (doc) {
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      await loadContainer(await readFile(doc), doc);
    } catch (e) {
      console.error("Cinema: could not read dropped project", doc, e);
    }
  }
  for (const path of paths.filter((p) => !isProjectFile(p))) {
    try {
      await importFromPath(path);
    } catch (e) {
      console.error("Cinema: could not import dropped file", path, e);
    }
  }
}

/** Browser window drop (vite dev / e2e): `File` objects instead of paths. */
export async function openDroppedFiles(files: File[]): Promise<void> {
  const doc = files.find((f) => isProjectFile(f.name));
  if (doc) await loadContainer(new Uint8Array(await doc.arrayBuffer()), doc.name);
  for (const f of files.filter((f) => !isProjectFile(f.name))) {
    // ponytail: no path here, so these import as browser media — they cannot be
    // relinked after a save+reopen. That is the browser fallback's ceiling.
    await importFromUrl(f.name, URL.createObjectURL(f));
  }
}

export async function exportEdl(): Promise<void> {
  const project = store.getProject();
  const seq = activeSequence(project);
  if (!seq) return;
  const edl = buildEdl(seq);
  const name = `${seq.name.replace(/\s+/g, "_") || "sequence"}.edl`;
  await writeFile(name, edl, "edl", "text/plain");
}

/** Render the active sequence to an MP4 (Export ▸ Video). */
export async function exportVideoFile(): Promise<void> {
  let blob: Blob | null;
  try {
    blob = await exportVideo((p) => {
      if (p.frame % 12 === 0) console.info(`Export ${Math.round((p.frame / p.total) * 100)}%`);
    });
  } catch (e) {
    console.error("Video export failed:", e);
    return;
  }
  if (!blob) return;
  const name = `${store.getProject().name.replace(/\s+/g, "_") || "export"}.mp4`;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile: writeBin } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name, filters: [{ name: "MP4", extensions: ["mp4"] }] });
    if (path) await writeBin(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    downloadBlob(name, blob);
  }
}

/** Export the current program frame as a PNG (Export ▸ Frame). */
export async function exportFrame(): Promise<void> {
  const rgba = engine.readOutput();
  if (rgba.length === 0) return;
  const c = document.createElement("canvas");
  c.width = engine.width;
  c.height = engine.height;
  const cx = c.getContext("2d")!;
  const img = cx.createImageData(engine.width, engine.height);
  img.data.set(rgba);
  cx.putImageData(img, 0, 0);
  const blob: Blob | null = await new Promise((res) => c.toBlob(res, "image/png"));
  if (!blob) return;
  const name = `${store.getProject().name.replace(/\s+/g, "_") || "frame"}.png`;
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile: writeBin } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: name, filters: [{ name: "PNG", extensions: ["png"] }] });
    if (path) await writeBin(path, new Uint8Array(await blob.arrayBuffer()));
  } else {
    downloadBlob(name, blob);
  }
}
