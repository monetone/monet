import { isTauri } from "@tauri-apps/api/core";
import type { ModelDef } from "./modelRegistry";

const SHA256_RE = /^[0-9a-f]{64}$/i;

/** A local artifact is eligible only when its license, size, and bytes are pinned. */
export function modelLocalImportReady(def: ModelDef): boolean {
  return !def.bundled
    && !/^(?:TBD|Unverified|Unlicensed)\b/i.test(def.license)
    && def.files.length > 0
    && def.files.every((file) => SHA256_RE.test(file.sha256)
      && Number.isSafeInteger(file.bytes)
      && file.bytes > 0);
}

/** A model is installable only when every byte has a pinned HTTPS source. */
export function modelDownloadReady(def: ModelDef): boolean {
  return modelLocalImportReady(def)
    // Multi-file units require one native stage/transaction, not per-file activation.
    && def.files.length === 1
    && def.files.every((file) => !!file.url
      && file.url.startsWith("https://")
      && SHA256_RE.test(file.sha256));
}

export interface ModelDownloadProgress {
  file: string;
  received: number;
  total: number;
  state: "downloading" | "verifying" | "done";
}

type NativeEvent =
  | { type: "progress"; received: number; total: number }
  | { type: "verifying" }
  | { type: "done" };

async function resetModelCaches(): Promise<void> {
  const [{ resetModelSourceCache }, { clearSessionCache }] = await Promise.all([
    import("./modelSource"), import("./onnx"),
  ]);
  resetModelSourceCache();
  clearSessionCache();
}

export async function downloadModel(
  def: ModelDef,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal,
  opts: { licenseAccepted?: boolean } = {},
): Promise<void> {
  // Pure-local provisioning policy (2026-07-16): the app never fetches model
  // weights. MODELS.md documents each unit's verified upstream + hash; the
  // Import path installs and sha-validates the user's local copy.
  void onProgress; void signal; void opts;
  throw new Error(
    `Model downloads are disabled — download ${def.label} from the verified source in MODELS.md, then use Import.`,
  );
  // Retained below for API shape reference (unreachable after the throw above).
  if (!isTauri()) throw new Error("Model downloads are available in the desktop app.");
  if (!modelDownloadReady(def)) throw new Error(`${def.label} has no approved, checksum-pinned download source.`);

  const { Channel, invoke } = await import("@tauri-apps/api/core");
  let completed = 0;
  const total = def.files.reduce((sum, file) => sum + file.bytes, 0);
  for (const file of def.files) {
    if (signal?.aborted) throw new DOMException("Download cancelled", "AbortError");
    const channel = new Channel<NativeEvent>((event) => {
      const received = event.type === "progress" ? Math.min(event.received, file.bytes) : file.bytes;
      onProgress?.({
        file: file.rel,
        received: completed + received,
        total,
        state: event.type === "progress" ? "downloading" : event.type,
      });
    });
    const cancel = () => { void invoke("plugin:models|cancel_download", { rel: file.rel }); };
    signal?.addEventListener("abort", cancel, { once: true });
    try {
      await invoke("plugin:models|download_model", {
        rel: file.rel,
        url: file.url,
        sha256: file.sha256,
        bytes: file.bytes,
        onEvent: channel,
      });
      completed += file.bytes;
    } finally {
      signal?.removeEventListener("abort", cancel);
    }
  }
  await resetModelCaches();
}

/** Copy a user-selected, registry-pinned artifact entirely in native code. */
export async function importModel(
  def: ModelDef,
  onProgress?: (progress: ModelDownloadProgress) => void,
  signal?: AbortSignal,
  opts: { licenseAccepted?: boolean } = {},
): Promise<boolean> {
  // License gate first (platform-independent): OpenRAIL-class licenses require
  // presenting the terms at provision time — with pure-local provisioning,
  // Import IS the provision step.
  if (def.licenseAcceptance && !opts.licenseAccepted) {
    throw new Error(`${def.label} requires accepting the ${def.licenseAcceptance.name} license before installation.`);
  }
  if (!isTauri()) throw new Error("Local model installation is available in the desktop app.");
  if (!modelLocalImportReady(def)) throw new Error(`${def.label} is not approved for local installation.`);

  const { open } = await import("@tauri-apps/plugin-dialog");
  const single = def.files.length === 1;
  const extension = single ? def.files[0].rel.split(".").pop() : undefined;
  const selected = await open({
    multiple: false,
    directory: !single,
    title: single ? `Select ${def.files[0].rel}` : `Select the ${def.id} model folder`,
    ...(single && extension ? { filters: [{ name: def.label, extensions: [extension] }] } : {}),
  });
  if (!selected) return false;
  if (signal?.aborted) throw new DOMException("Installation cancelled", "AbortError");

  const { Channel, invoke } = await import("@tauri-apps/api/core");
  const total = def.files.reduce((sum, file) => sum + file.bytes, 0);
  const channel = new Channel<NativeEvent>((event) => {
    onProgress?.({
      file: def.files[0].rel,
      received: event.type === "progress" ? Math.min(event.received, total) : total,
      total,
      state: event.type === "progress" ? "downloading" : event.type,
    });
  });
  const cancel = () => { void invoke("plugin:models|cancel_import", { id: def.id }); };
  signal?.addEventListener("abort", cancel, { once: true });
  try {
    await invoke("plugin:models|import_model", {
      id: def.id,
      source: selected,
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
      onEvent: channel,
    });
  } finally {
    signal?.removeEventListener("abort", cancel);
  }
  await resetModelCaches();
  return true;
}

export async function removeModel(def: ModelDef): Promise<void> {
  if (!isTauri()) return;
  const { invoke } = await import("@tauri-apps/api/core");
  try {
    await invoke("plugin:models|remove_model", {
      id: def.id,
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
    });
  } finally {
    await resetModelCaches();
  }
}
