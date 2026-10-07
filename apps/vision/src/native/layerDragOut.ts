import { invoke, isTauri } from "@tauri-apps/api/core";
import { join, tempDir } from "@tauri-apps/api/path";
import { mkdir, remove, writeFile } from "@tauri-apps/plugin-fs";

export function layerPngFilename(name: string): string {
  const base = name.replace(/[^\w.-]+/g, "_");
  return `${base && base !== "." && base !== ".." ? base.slice(0, 240) : "layer"}.png`;
}

/** Add a browser File, or start a real native file drag when Finder is the target. */
export function beginLayerPngDrag(
  transfer: DataTransfer,
  name: string,
  bytes: Uint8Array,
  preview: string,
): Promise<void> | undefined {
  const filename = layerPngFilename(name);
  if (!isTauri()) {
    transfer.effectAllowed = "copy";
    transfer.items.add(new File([bytes as BlobPart], filename, { type: "image/png" }));
    return;
  }
  return beginNativeDrag(filename, bytes, preview);
}

type Staged = { dir: string; path: string };

/** The staging area of the drag before this one. The plugin's session-end event
 *  means "my gesture ended", not "the receiver finished reading" — it writes a
 *  plain file URL to the pasteboard, so a destination that opens the path
 *  lazily hits ENOENT if we unlink on that event. Sweep the PREVIOUS drag when
 *  the next one starts instead; the last one goes with the OS temp directory. */
let priorDrag: Staged | null = null;

async function sweep({ dir, path }: Staged): Promise<void> {
  await remove(path).catch(() => {});
  await remove(dir).catch(() => {});
}

async function beginNativeDrag(filename: string, bytes: Uint8Array, preview: string): Promise<void> {
  const previous = priorDrag;
  priorDrag = null;
  if (previous) await sweep(previous);
  const unique = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const dir = await join(await tempDir(), `monet-vision-drag-${unique}`);
  const path = await join(dir, filename);
  const staged = { dir, path };
  try {
    await mkdir(dir);
    await writeFile(path, bytes, { createNew: true, mode: 0o600 });
    await invoke("plugin:drag|start_drag", {
      item: [path],
      image: preview || path,
      options: { mode: "copy" },
    });
  } catch (error) {
    await sweep(staged);
    throw error;
  }
  priorDrag = staged;
}
