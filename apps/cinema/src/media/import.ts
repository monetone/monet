// ─────────────────────────────────────────────────────────────
// import.ts — bring files into the project bin. Works in the Tauri webview
// (native open dialog → readFile → Blob URL) and in the browser dev server
// (<input type=file>). Each file becomes a serializable MediaItem plus a
// runtime MediaHandle (objectUrl + a hidden element) in the registry.
// ─────────────────────────────────────────────────────────────

import { isTauri } from "@tauri-apps/api/core";
import { store } from "../state/app";
import { createMedia } from "../timeline/model/factory";
import type { MediaItem, MediaKind } from "../timeline/model/types";
import { setHandle } from "./registry";
import { kindForName, probe, type ProbeKind } from "./probe";
import { generateThumb } from "./thumbnails";
import { generatePeaks } from "./waveform";

interface Picked {
  name: string;
  url: string;
  kind: ProbeKind;
  /** Absolute filesystem path when we have one — what relink resolves against. */
  path?: string;
}

const MEDIA_EXTS = ["mp4", "mov", "m4v", "webm", "mkv", "ogv", "mp3", "wav", "aac", "m4a", "flac", "ogg", "png", "jpg", "jpeg", "gif", "webp"];

export function mimeFor(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  const map: Record<string, string> = {
    mp4: "video/mp4", mov: "video/quicktime", m4v: "video/mp4", webm: "video/webm", mkv: "video/x-matroska", ogv: "video/ogg",
    mp3: "audio/mpeg", wav: "audio/wav", aac: "audio/aac", m4a: "audio/mp4", flac: "audio/flac", ogg: "audio/ogg",
    png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp",
  };
  return map[ext] ?? "application/octet-stream";
}

async function pickFiles(): Promise<Picked[]> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const sel = await open({ multiple: true, filters: [{ name: "Media", extensions: MEDIA_EXTS }] });
    const paths = Array.isArray(sel) ? sel : sel ? [sel] : [];
    const out: Picked[] = [];
    for (const path of paths) {
      const name = path.split(/[\\/]/).pop() ?? path;
      const bytes = await readFile(path);
      const blob = new Blob([bytes], { type: mimeFor(name) });
      out.push({ name, url: URL.createObjectURL(blob), kind: kindForName(name), path });
    }
    return out;
  }
  return pickFilesBrowser();
}

function pickFilesBrowser(): Promise<Picked[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.multiple = true;
    input.accept = "video/*,audio/*,image/*";
    input.onchange = () => {
      const files = Array.from(input.files ?? []);
      resolve(files.map((f) => ({ name: f.name, url: URL.createObjectURL(f), kind: kindForName(f.name) })));
    };
    input.oncancel = () => resolve([]);
    input.click();
  });
}

/** Open the picker and import every chosen file. Returns the new MediaItems. */
export async function importMediaInteractive(): Promise<MediaItem[]> {
  const picked = await pickFiles();
  const out: MediaItem[] = [];
  for (const p of picked) {
    const media = await addImportedFile(p.name, p.url, p.kind, p.path);
    if (media) out.push(media);
  }
  return out;
}

/** Import from an already-built object/asset URL — the browser drop path
 *  (io/files.ts `openDroppedFiles`), which has a `File` but no path. */
export function importFromUrl(name: string, url: string, kind?: ProbeKind): Promise<MediaItem | null> {
  return addImportedFile(name, url, kind ?? kindForName(name));
}

/** Import from raw bytes — wraps them in a Blob URL first (used by e2e). */
export function importFromBytes(name: string, bytes: Uint8Array, mime?: string): Promise<MediaItem | null> {
  const blob = new Blob([bytes as BlobPart], { type: mime ?? mimeFor(name) });
  const url = URL.createObjectURL(blob);
  const kind: ProbeKind = mime?.startsWith("audio") ? "audio" : mime?.startsWith("image") ? "image" : kindForName(name);
  return addImportedFile(name, url, kind);
}

/**
 * Import a media file from an absolute filesystem path (native/Tauri only).
 * Mirrors the native picker: readFile → Blob URL → bin. Used by the MCP surface
 * so an MCP client can import without going through the open dialog.
 */
export async function importFromPath(path: string): Promise<MediaItem | null> {
  if (!isTauri()) throw new Error("importFromPath is only available in the native app");
  const { readFile } = await import("@tauri-apps/plugin-fs");
  const name = path.split(/[\\/]/).pop() ?? path;
  const bytes = await readFile(path);
  const blob = new Blob([bytes as BlobPart], { type: mimeFor(name) });
  const url = URL.createObjectURL(blob);
  return addImportedFile(name, url, kindForName(name), path);
}

/**
 * Register the runtime handle (hidden element + derived thumb/peaks) for a
 * media item. Shared by import and by the relink pass, so a project opened from
 * disk gets exactly the same runtime rigging as a freshly imported file.
 */
export function attachHandle(media: MediaItem, url: string, kind: ProbeKind, hasAudio: boolean): void {
  let el: HTMLVideoElement | HTMLAudioElement | undefined;
  if (kind === "video") {
    const v = document.createElement("video");
    v.preload = "auto";
    v.muted = true;
    v.playsInline = true;
    v.src = url;
    el = v;
  } else if (kind === "audio") {
    const a = document.createElement("audio");
    a.preload = "auto";
    a.src = url;
    el = a;
  }
  setHandle(media.id, { objectUrl: url, el, loaded: false });

  // Fire-and-forget derived assets.
  void generateThumb(media, url, kind);
  if (hasAudio || kind === "audio") void generatePeaks(media, url);
}

async function addImportedFile(name: string, url: string, kind: ProbeKind, path?: string): Promise<MediaItem | null> {
  let info;
  try {
    info = await probe(url, kind);
  } catch (e) {
    console.error("Import probe failed for", name, e);
    URL.revokeObjectURL(url);
    return null;
  }

  const fps = store.getProject().fps || 24;
  const durationFrames = info.durationSeconds > 0 ? Math.max(1, Math.round(info.durationSeconds * fps)) : 0;
  const media = createMedia({
    name,
    // A resolvable absolute path when we have one (native picker / MCP), so the
    // relink pass can re-read the bytes after a save+reopen. The browser
    // fallback only ever sees a bare filename.
    path: path ?? name,
    kind: kind as MediaKind,
    durationFrames,
    fps,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
  });

  // Runtime handle: a persistent element for seek-decode + audio playback.
  attachHandle(media, url, kind, info.hasAudio);

  store.mutate("Import Media", (p) => {
    p.media.push(media);
  });

  return media;
}
