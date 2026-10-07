// ─────────────────────────────────────────────────────────────
// ui/io-web — file open & save helpers (native first, web fallback)
// ─────────────────────────────────────────────────────────────
// Inside the Tauri webview these go through the native dialog + plugin-fs, so
// opening keeps the real path's bytes and saving writes where the user asked.
// In the dev browser (or if the plugins are missing) they degrade to the old
// hidden <input type=file> / Blob+anchor download. Callers see one shape either
// way: PickedFile{name,bytes} in, downloadBytes/downloadText out.

import { openFile, saveFile, message } from "@monet-ui/monet-react";

export interface PickedFile {
  name: string;
  bytes: Uint8Array;
}

/** An extension filter for the native dialogs. */
interface DialogFilter {
  name: string;
  extensions: string[];
}

function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in (window as unknown as Record<string, unknown>);
}

/** Last path segment of a native path, on either separator. */
export function basenameOf(path: string): string {
  const segments = path.split(/[\\/]/).filter(Boolean);
  return segments.length ? segments[segments.length - 1] : path;
}

/** Turn an `<input accept>` list into native dialog filters.
 *  MIME entries (`audio/*`) carry no extension list, so only the `.ext` tokens
 *  survive; a compound token like `.rythme-shortcuts.json` contributes `json`.
 *  An accept list with no `.ext` token yields no filter — i.e. "All Files". */
export function acceptToFilters(accept: string): DialogFilter[] {
  const extensions: string[] = [];
  for (const token of accept.split(",")) {
    const trimmed = token.trim();
    if (!trimmed.startsWith(".")) continue;
    const ext = trimmed.slice(1).split(".").pop()?.toLowerCase();
    if (ext && !extensions.includes(ext)) extensions.push(ext);
  }
  return extensions.length ? [{ name: "Supported Files", extensions }] : [];
}

/** Prompt the user to pick one or more files; resolves with their bytes. */
export async function pickFiles(accept: string, multiple = true): Promise<PickedFile[]> {
  if (isTauriRuntime()) {
    const picked = await pickNativeFiles(accept, multiple);
    // `null` means the native path is unavailable — a cancelled dialog is `[]`,
    // which must NOT fall through to a second (web) picker.
    if (picked) return picked;
  }
  return pickWebFiles(accept, multiple);
}

/** Native open dialog + plugin-fs read. `null` if the plugin is unavailable. */
async function pickNativeFiles(accept: string, multiple: boolean): Promise<PickedFile[] | null> {
  let readFile: (path: string) => Promise<Uint8Array>;
  try {
    ({ readFile } = await import("@tauri-apps/plugin-fs"));
  } catch {
    return null;
  }
  const filters = acceptToFilters(accept);
  const selected = await openFile({ multiple, ...(filters.length ? { filters } : {}) });
  const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
  return Promise.all(
    paths.map(async (path) => ({ name: basenameOf(path), bytes: await readFile(path) })),
  );
}

/** Read native OS paths as PickedFiles — the drop payload's `paths[]`, but any
 *  path source works. Unlike the picker, a path that cannot be read (a dropped
 *  folder, a file we lack access to) is logged and skipped instead of failing
 *  the whole batch; callers report an empty result to the user. */
export async function readPaths(paths: string[]): Promise<PickedFile[]> {
  let readFile: (path: string) => Promise<Uint8Array>;
  try {
    ({ readFile } = await import("@tauri-apps/plugin-fs"));
  } catch {
    return [];
  }
  const out: PickedFile[] = [];
  for (const path of paths) {
    try {
      out.push({ name: basenameOf(path), bytes: await readFile(path) });
    } catch (err) {
      console.error("read failed", path, err);
    }
  }
  return out;
}

/** Read browser `File` objects (an `<input>` selection or an HTML5 drop). */
export async function readFiles(files: File[]): Promise<PickedFile[]> {
  const out: PickedFile[] = [];
  for (const f of files) out.push({ name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) });
  return out;
}

function pickWebFiles(accept: string, multiple: boolean): Promise<PickedFile[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = accept;
    input.multiple = multiple;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const out = await readFiles(Array.from(input.files ?? []));
      input.remove();
      resolve(out);
    });
    // a cancelled dialog never fires change; clean up on window focus
    window.addEventListener(
      "focus",
      () => setTimeout(() => input.parentElement && input.remove(), 500),
      { once: true },
    );
    document.body.appendChild(input);
    input.click();
  });
}

/** Write binary data, asking the user where. Resolves `false` if they cancel.
 *  Callers that must not lose state (Save Session clearing the dirty flag)
 *  await this; fire-and-forget exports use {@link downloadBytes}. */
export async function saveBytes(name: string, bytes: Uint8Array, mime = "application/octet-stream"): Promise<boolean> {
  if (isTauriRuntime()) {
    const saved = await saveNativeBytes(name, bytes);
    if (saved !== null) return saved;
  }
  downloadBlob(name, bytes, mime);
  return true;
}

/** Write text, asking the user where. Resolves `false` if they cancel. */
export function saveText(name: string, text: string, mime = "application/json"): Promise<boolean> {
  return saveBytes(name, new TextEncoder().encode(text), mime);
}

/** Native save dialog + plugin-fs write. `null` if the plugin is unavailable;
 *  a failed write rejects rather than silently falling back to a download. */
async function saveNativeBytes(name: string, bytes: Uint8Array): Promise<boolean | null> {
  let writeFile: (path: string, data: Uint8Array) => Promise<void>;
  try {
    ({ atomicWriteBytes: writeFile } = await import("@monet-ui/monet-react"));
  } catch {
    return null;
  }
  const path = await saveFile({ defaultPath: name });
  if (!path) return false;
  // Durable save (shared): fully-synced sibling renamed over the destination.
  await writeFile(path, bytes);
  return true;
}

// Saves are serialized: a batch export calls downloadBytes in a loop, and N
// native save dialogs racing each other is unusable.
// ponytail: one dialog per file. Upgrade path is a single directory picker for
// batch exports, which needs exportBatch to become async.
let saveQueue: Promise<unknown> = Promise.resolve();

/** Queue a save of binary data with the given file name (fire-and-forget). */
export function downloadBytes(name: string, bytes: Uint8Array, mime = "application/octet-stream"): void {
  saveQueue = saveQueue
    .then(() => saveBytes(name, bytes, mime))
    .catch((err) => reportSaveFailure(name, err));
}

/** Queue a save of a text file (fire-and-forget). */
export function downloadText(name: string, text: string, mime = "application/json"): void {
  downloadBytes(name, new TextEncoder().encode(text), mime);
}

/** A failed export must be visible — a silent no-op reads as "it saved". */
function reportSaveFailure(name: string, err: unknown): void {
  console.error(`save failed: ${name}`, err);
  void message(`Could not save “${name}”: ${err instanceof Error ? err.message : String(err)}`, {
    title: "Save Failed",
    kind: "error",
  });
}

/** Browser download: Blob + anchor. Used outside Tauri. */
function downloadBlob(name: string, bytes: Uint8Array, mime: string): void {
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  const blob = new Blob([ab], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    a.remove();
    URL.revokeObjectURL(url);
  }, 1000);
}
