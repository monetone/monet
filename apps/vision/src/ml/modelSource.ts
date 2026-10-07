// ─────────────────────────────────────────────────────────────
// modelSource.ts — resolve which Stable Diffusion weight set to load.
//
// Two byte sets live under /models: the real SD-1.5 weights at /models/sd15
// (locally built fp16 UNet/text_encoder + fp32 VAEs + real CLIP tokenizer,
// gitignored, ~2.1 GB — see MODELS.md) and an optional local-development demo
// at /models/sd. The real set is preferred whenever every file is present. The
// demo is used only when its complete core is actually present; release builds
// strip it because its upstream artifact has no redistribution license.
//
// Downloaded, checksum-verified model units live under appData/models and are
// resolved through Tauri's scoped asset protocol. The whole unit must be
// installed before any file is selected, so incompatible partial SD sets can
// never mix with bundled/local files.
// ─────────────────────────────────────────────────────────────

import { convertFileSrc, invoke, isTauri } from "@tauri-apps/api/core";
import { appDataDir, join } from "@tauri-apps/api/path";
import { MODEL_REGISTRY, type ModelDef } from "./modelRegistry";
import { modelLocalImportReady } from "./modelDownload";

export const SD15_BASE = "/models/sd15";
export const SD_DEMO_BASE = "/models/sd";

// Files that must all be present for the real weight set to be usable. The
// vae_encoder is only needed for prompt-guided Generative Fill (inpaint).
const SD15_CORE = [
  "text_encoder/model.onnx",
  "unet/model.onnx",
  "vae_decoder/model.onnx",
  "tokenizer/vocab.json",
  "tokenizer/merges.txt",
];
const SD15_INPAINT = "vae_encoder/model.onnx";

export type ModelStatus = "bundled" | "downloaded" | "local" | "demo" | "missing";

const installed = new Map<ModelDef["id"], Promise<boolean>>();

async function installRoot(): Promise<string> {
  return join(await appDataDir(), "models");
}

async function installedPath(rel: string): Promise<string> {
  return join(await installRoot(), rel);
}

async function unitInstalled(def: ModelDef): Promise<boolean> {
  if (!isTauri() || !modelLocalImportReady(def)) return false;
  let cached = installed.get(def.id);
  if (!cached) {
    // A rejection is "could not verify" (symlinked models dir, transient IO
    // error, unreadable file), NOT "not installed" — caching it reported a
    // correctly installed unit as missing for the rest of the app session with
    // no recovery short of a restart. Still answer false for this probe, but
    // drop the entry so the next one retries. (#130)
    const probe: Promise<boolean> = invoke<boolean>("plugin:models|verify_model_unit", {
      files: def.files.map(({ rel, sha256, bytes }) => ({ rel, sha256, bytes })),
    }).catch(() => {
      if (installed.get(def.id) === probe) installed.delete(def.id);
      return false;
    });
    cached = probe;
    installed.set(def.id, cached);
  }
  return cached;
}

export function resetModelSourceCache(): void {
  installed.clear();
  _resolved = null;
}

/** Pure tier selection: prefer the quality-tier alternate when it is installed,
 *  otherwise the base unit. Exported for direct testing of the choice. */
export function pickTierUnit(base: ModelDef, alt: ModelDef | undefined, altInstalled: boolean): ModelDef {
  return alt && altInstalled ? alt : base;
}

/** Pick the best available unit for a base capability: its quality-tier
 *  alternate (a registry row with `qualityTierFor === baseId`) when that
 *  alternate is fully installed, otherwise the base unit itself. Lets an
 *  imported higher-quality model transparently supersede the default with no
 *  call-site changes (installed ⇒ preferred; uninstall is the opt-out). */
export async function bestUnit(baseId: ModelDef["id"]): Promise<ModelDef> {
  const base = MODEL_REGISTRY.find((def) => def.id === baseId)!;
  const alt = MODEL_REGISTRY.find((def) => def.qualityTierFor === baseId);
  return pickTierUnit(base, alt, alt ? await unitInstalled(alt) : false);
}

/** Resolve a registry file, preferring a complete verified app-data install. */
export async function resolveModelUrl(def: ModelDef, rel: string): Promise<string> {
  if (!def.files.some((file) => file.rel === rel)) throw new Error(`${rel} is not registered for ${def.id}`);
  if (await unitInstalled(def)) return convertFileSrc(await installedPath(rel));
  return `/models/${rel}`;
}

/**
 * Presence probe that never pulls the whole file: a 1-byte ranged GET whose body
 * is cancelled immediately (vite/preview may answer 200-with-full-body). Returns
 * true on 200/206, false on 404/network error.
 */
export async function filePresent(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { headers: { Range: "bytes=0-0" } });
    r.body?.cancel?.().catch(() => {});
    return r.ok || r.status === 206;
  } catch {
    return false;
  }
}

async function allPresent(base: string, rels: string[]): Promise<boolean> {
  const hits = await Promise.all(rels.map((rel) => filePresent(`${base}/${rel}`)));
  return hits.every(Boolean);
}

export type SdKind = "real" | "demo" | "missing";
export interface SdResolution {
  base: string;
  kind: SdKind;
  /** True when the resolved set includes a vae_encoder (prompt-guided fill). */
  inpaint: boolean;
}

let _resolved: Promise<SdResolution> | null = null;

/**
 * Resolve the SD base URL to load from, preferring the real /models/sd15 set.
 * Static probes and the native app-data integrity result are cached for the app
 * session. Downloads/deletes invalidate both through resetModelSourceCache().
 */
export function resolveSdBase(force = false): Promise<SdResolution> {
  if (force) resetModelSourceCache();
  return (async () => {
    const sd15 = MODEL_REGISTRY.find((def) => def.id === "sd15")!;
    // The first app-data resolution hashes the whole unit; later files reuse it.
    if (await unitInstalled(sd15)) {
      const root = await installRoot();
      return { base: convertFileSrc(await join(root, "sd15")), kind: "real" as const, inpaint: true };
    }
    if (!_resolved) {
      _resolved = (async () => {
        if (await allPresent(SD15_BASE, SD15_CORE)) {
          const inpaint = await filePresent(`${SD15_BASE}/${SD15_INPAINT}`);
          return { base: SD15_BASE, kind: "real" as const, inpaint };
        }
        if (await allPresent(SD_DEMO_BASE, SD15_CORE)) {
          const inpaint = await filePresent(`${SD_DEMO_BASE}/${SD15_INPAINT}`);
          return { base: SD_DEMO_BASE, kind: "demo" as const, inpaint };
        }
        return { base: SD_DEMO_BASE, kind: "missing" as const, inpaint: false };
      })();
    }
    return _resolved;
  })();
}

export async function modelStatus(def: ModelDef): Promise<ModelStatus> {
  if (await unitInstalled(def)) return "downloaded";
  if (def.bundled) return "bundled";
  if (def.id === "sd15") {
    const status = await resolveSdBase();
    return status.kind === "real" ? "local" : status.kind;
  }
  const present = await Promise.all(def.files.map((file) => filePresent(`/models/${file.rel}`)));
  return present.every(Boolean) ? "local" : "missing";
}

/**
 * Whether this environment can actually RUN the real fp16 SD-1.5 weights. The
 * ~2.2 GB weight set + activation buffers don't fit wasm32's 4 GB heap, so real
 * generation needs the WebGPU execution provider (weights → GPU buffers). With no
 * adapter, ort-web would fall back to wasm and OOM — callers gate on this instead.
 * The demo placeholder (~8 MB) runs fine on wasm and does not need WebGPU.
 * Cached for the session (adapter availability doesn't change); force to re-probe.
 */
let _webgpu: Promise<boolean> | null = null;
export function webgpuAvailable(force = false): Promise<boolean> {
  if (force) _webgpu = null;
  if (!_webgpu) {
    _webgpu = (async () => {
      try {
        const gpu = (navigator as unknown as { gpu?: { requestAdapter?: () => Promise<unknown> } }).gpu;
        if (!gpu?.requestAdapter) return false;
        return !!(await gpu.requestAdapter());
      } catch {
        return false;
      }
    })();
  }
  return _webgpu;
}

/**
 * What Generate Image / Generative Fill would do right now:
 *   "real"    — real SD-1.5 weights present (and, if inpaint, a vae_encoder too)
 *   "demo"    — a source-checkout-only placeholder is present (abstract output)
 *   "missing" — no complete generation set, or inpaint has no vae_encoder
 * Drives the no-silent-downgrade UX in NeuralAI.
 */
export async function sdAvailable(inpaint: boolean): Promise<"real" | "demo" | "missing"> {
  const r = await resolveSdBase();
  if (r.kind === "missing") return "missing";
  if (inpaint && !r.inpaint) return "missing";
  return r.kind;
}
