// ─────────────────────────────────────────────────────────────
// io/files — file open / save + SVG→PNG rasterization
// ─────────────────────────────────────────────────────────────
// Two backends behind one set of helpers: inside a Tauri webview the native
// dialog plugin picks a real path and tauri-plugin-fs reads/writes it (so
// documents have a filePath and Save can write in place); in a plain browser
// the classic <input type=file> / blob-anchor path still works.

import { atomicWriteBytes, type DialogFilter, isTauri, openFile, saveFile } from "@monet-ui/monet-react";

/** Outcome of a native-or-browser save: `null` when the user cancelled the
 *  native dialog, otherwise the written path — `undefined` for the browser
 *  download fallback, which has no path to save back to. */
export type SaveOutcome = { path?: string } | null;

/** Last path component, tolerating both separators (Windows paths included). */
export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** Write text to an already-known path. Native only — throws outside Tauri,
 *  since there is no in-place write in a browser. Durable: see
 *  {@link writeBytesTo}. */
export async function writeTextTo(path: string, text: string): Promise<void> {
  await writeBytesTo(path, new TextEncoder().encode(text));
}

/** Ask for a destination and write `text` there (native), or download it
 *  (browser). See {@link SaveOutcome} for the three possible results. */
export async function saveTextFile(filename: string, text: string, filters: DialogFilter[], mime = "text/plain"): Promise<SaveOutcome> {
  if (!isTauri()) {
    downloadText(filename, text, mime);
    return {};
  }
  const path = await saveFile({ title: "Save", defaultPath: filename, filters });
  if (!path) return null;
  await writeTextTo(path, text);
  return { path };
}

/** Write bytes to an already-known path. Native only, same as {@link writeTextTo}.
 *
 *  Goes through the shared durable write: a fully-synced sibling file is renamed
 *  over the destination. A plain `writeFile` truncates the destination first, so
 *  an interrupted Save destroyed BOTH the old document and the new one. */
export async function writeBytesTo(path: string, bytes: Uint8Array): Promise<void> {
  await atomicWriteBytes(path, bytes);
}

/** Read an already-known path's bytes (native drag-and-drop hands us paths, not
 *  `File`s). Native only — throws outside Tauri. */
export async function readBytesFrom(path: string): Promise<Uint8Array> {
  const { readFile } = await import("@tauri-apps/plugin-fs");
  return readFile(path);
}

/** Binary counterpart of {@link saveTextFile} — used by the `.mart` container
 *  save, which is a zip and has no text form. */
export async function saveBytesFile(filename: string, bytes: Uint8Array, filters: DialogFilter[], mime = "application/octet-stream", title = "Save"): Promise<SaveOutcome> {
  if (!isTauri()) {
    downloadBytes(filename, bytes, mime);
    return {};
  }
  const path = await saveFile({ title, defaultPath: filename, filters });
  if (!path) return null;
  await writeBytesTo(path, bytes);
  return { path };
}

/** Same as {@link saveTextFile} for a `data:` URL (PNG export). */
export function saveDataURLFile(filename: string, dataURL: string, filters: DialogFilter[]): Promise<SaveOutcome> {
  return saveBytesFile(filename, dataURLBytes(dataURL), filters, "image/png", "Export");
}

/** Decode the base64 payload of a `data:` URL into bytes. */
export function dataURLBytes(dataURL: string): Uint8Array {
  const binary = atob(dataURL.slice(dataURL.indexOf(",") + 1));
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** Pick a file and read its bytes. Native picks a real path (returned as
 *  `path`); the browser fallback has none. `null` if cancelled. */
export async function pickFile(filters: DialogFilter[], accept: string): Promise<{ name: string; bytes: Uint8Array; path?: string } | null> {
  if (!isTauri()) return openBinaryFile(accept);
  const selected = await openFile({ title: "Open", filters, multiple: false });
  const path = Array.isArray(selected) ? selected[0] : selected;
  if (!path) return null;
  return { name: baseName(path), bytes: await readBytesFrom(path), path };
}

/** Pick a destination directory: cancelled, browser fallback, or native path. */
export async function pickDirectory(): Promise<SaveOutcome> {
  if (!isTauri()) return {};
  const selected = await openFile({ title: "Export to Folder", directory: true });
  const path = Array.isArray(selected) ? selected[0] : selected;
  return path ? { path } : null;
}

export function downloadText(filename: string, text: string, mime = "text/plain"): void {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadBytes(filename: string, bytes: Uint8Array, mime = "application/octet-stream"): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(filename, url);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadDataURL(filename: string, dataURL: string): void {
  triggerDownload(filename, dataURL);
}

function triggerDownload(filename: string, url: string): void {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
}

/** Prompt for a text file and resolve its contents (null if cancelled). */
export function openTextFile(accept = ".artisan,.json,application/json"): Promise<{ name: string; text: string } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, text: String(reader.result ?? "") });
      reader.onerror = () => resolve(null);
      reader.readAsText(file);
    };
    input.click();
  });
}

/** Prompt for any file and resolve its raw bytes (null if cancelled). */
export function openBinaryFile(accept: string): Promise<{ name: string; bytes: Uint8Array } | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.oncancel = () => resolve(null);
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) {
        resolve(null);
        return;
      }
      const reader = new FileReader();
      reader.onload = () => resolve({ name: file.name, bytes: new Uint8Array(reader.result as ArrayBuffer) });
      reader.onerror = () => resolve(null);
      reader.readAsArrayBuffer(file);
    };
    input.click();
  });
}

/** Rasterize an SVG string to a PNG data URL at the given pixel size + scale. */
export function svgToPngDataURL(svg: string, width: number, height: number, scale = 2): Promise<string> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const svgUrl = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const cx = canvas.getContext("2d");
      if (!cx) {
        reject(new Error("no 2d context"));
        return;
      }
      cx.drawImage(img, 0, 0, canvas.width, canvas.height);
      resolve(canvas.toDataURL("image/png"));
    };
    img.onerror = () => reject(new Error("failed to rasterize SVG"));
    img.src = svgUrl;
  });
}
