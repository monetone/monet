// ─────────────────────────────────────────────────────────────
// atomic-write — durable document saves for every Monet app
// ─────────────────────────────────────────────────────────────
// A plain `writeFile` truncates the destination before the new bytes land, so an
// interrupted save destroys BOTH the old and the new document. Every Monet app
// writes its documents through this instead: a complete sibling file is written,
// synced to durable media, and then renamed over the destination — the rename is
// the only atomic step the filesystem gives us.
//
// Pair it with `monet_ui::atomic_save_plugin()` on the Rust side; without that
// plugin this still writes-then-renames (crash-safe) but cannot fsync, so it is
// not power-loss durable.

import { isTauri } from "@tauri-apps/api/core";
export interface AtomicWriteOperations {
  writeFile(path: string, bytes: Uint8Array, options: { createNew: true }): Promise<void>;
  rename(from: string, to: string): Promise<void>;
  remove(path: string): Promise<void>;
}

const sessionToken = typeof globalThis.crypto?.randomUUID === "function"
  ? globalThis.crypto.randomUUID()
  : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
let nextTempId = 0;

function uniqueSiblingTempPath(destination: string): string {
  const separator = Math.max(destination.lastIndexOf("/"), destination.lastIndexOf("\\"));
  const parent = separator < 0 ? "" : destination.slice(0, separator + 1);
  nextTempId += 1;
  return `${parent}monet-save-${sessionToken}-${nextTempId.toString(36)}.tmp`;
}

async function nativeOperations(): Promise<AtomicWriteOperations> {
  const { remove, rename, writeFile } = await import("@tauri-apps/plugin-fs");
  return {
    writeFile: (path, bytes, options) => writeFile(path, bytes, options),
    rename: (from, to) => rename(from, to),
    remove: (path) => remove(path),
  };
}

/** Durable native write: the `atomicsave` plugin fsyncs the temp file (F_FULLFSYNC
 *  on macOS) BEFORE renaming, then fsyncs the parent directory. tauri-plugin-fs
 *  cannot express that — it only does `write_all` and exposes no sync — so a power
 *  cut between the rename and the data reaching disk destroyed both the old and the
 *  new document. Falls back to the plugin-fs path when the command is unavailable
 *  (older shell, or a webview without it). (#4) */
let warnedNoPlugin = false;

async function durableNativeWrite(destination: string, bytes: Uint8Array): Promise<boolean> {
  try {
    const { invoke } = await import("@tauri-apps/api/core");
    // Raw IPC body: a JSON number array would inflate a 50 MB payload to a
    // ~475 MB JS array + ~179 MB JSON string on every save.
    await invoke("plugin:atomicsave|atomic_write", bytes, {
      headers: { "x-destination": encodeURIComponent(destination) },
    });
    return true;
  } catch (error) {
    // The fallback below is still crash-safe (write a sibling, then rename) but
    // NOT power-loss durable, so a silent catch would hide an app that forgot
    // `monet_ui::atomic_save_plugin()` — or a capability that does not allow it.
    // Say so once per session rather than never.
    if (!warnedNoPlugin) {
      warnedNoPlugin = true;
      console.warn("[monet] durable save unavailable — falling back to write+rename (no fsync).", error);
    }
    return false;
  }
}

/** Write a complete sibling file before atomically replacing `destination`.
 * `writeFile` owns and closes its native handle before resolving. On failure,
 * cleanup is deliberately limited to this invocation's unique temporary path. */
export async function atomicWriteBytes(
  destination: string,
  bytes: Uint8Array,
  injectedOperations?: AtomicWriteOperations,
): Promise<void> {
  // The durable native path owns its own temp file + fsync + rename, so it is
  // tried first whenever no operations were injected (tests inject; the app does
  // not). Anything else falls through to the plugin-fs write/rename below.
  if (!injectedOperations && isTauri() && await durableNativeWrite(destination, bytes)) return;
  const operations = injectedOperations ?? await nativeOperations();
  const temporary = uniqueSiblingTempPath(destination);
  try {
    await operations.writeFile(temporary, bytes, { createNew: true });
    await operations.rename(temporary, destination);
  } catch (error) {
    try { await operations.remove(temporary); } catch { /* preserve the write/rename failure */ }
    throw error;
  }
}
