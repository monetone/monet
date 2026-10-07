// subjectMask — Select Subject inference. Runs U²-Net (u2netp) over the current
// develop render to produce a saliency coverage field for an AI mask. The
// session + WASM live here; the tensor math is the pure, tested u2net.ts.
// Ported from Vision's proven segMask pipeline (apps/vision/src/ml/onnx.ts),
// decoupled from Vision's store/engine. The 320×320 coverage is cached by the
// AI mask component's cacheId — and persisted under app-data so AI masks
// survive a relaunch (GAL-MASK-06) — the composite loop resamples it per render.
//
// Runtime-gated: onnxruntime-web loads WASM + the 4.5 MB model at first use, so
// this path is exercised only in the desktop app, not in unit tests. The
// algorithmic core (u2net.ts) is unit-tested independently.

import { isTauri } from "@tauri-apps/api/core";
import { postprocessU2Net, preprocessU2Net, U2NET_SIZE } from "@monet-ui/monet-scopes";

const MODEL_URL = "/models/u2netp.onnx";

/** 320×320 saliency coverage keyed by an AI mask component's cacheId. In-memory
 *  cache over the persisted mattes below, so the sync render paths (preview /
 *  export / print) stay a plain Map lookup. */
const coverageCache = new Map<string, Float32Array>();

export function getSubjectCoverage(cacheId: string): Float32Array | undefined {
  return coverageCache.get(cacheId);
}

// ── Coverage persistence (GAL-MASK-06) ──────────────────────────────────────
// LR keeps AI-mask pixel data in the .lrcat-data companion so masks survive
// relaunch; ours is one Uint8-quantized 320×320 matte per cacheId under
// <appDataDir>/ai-masks/. Everything hydrates in one pass at startup, well
// before the catalog opens and a photo decodes for the first develop render.
// ponytail: hydrate-all keeps every persisted matte in RAM (~100 KB each) and
// orphans from deleted masks are never swept; move to per-cacheId lazy loads
// plus a catalog-driven GC if mask counts grow.

const COVERAGE_DIR = "ai-masks";

async function coverageDir(): Promise<string> {
  const { appDataDir, join } = await import("@tauri-apps/api/path");
  return join(await appDataDir(), COVERAGE_DIR);
}

function quantize(coverage: Float32Array): Uint8Array {
  const out = new Uint8Array(coverage.length);
  for (let i = 0; i < coverage.length; i++) {
    out[i] = Math.round(Math.max(0, Math.min(1, coverage[i])) * 255);
  }
  return out;
}

function dequantize(bytes: Uint8Array): Float32Array {
  const out = new Float32Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) out[i] = bytes[i] / 255;
  return out;
}

/** Cache coverage under `cacheId` and persist it (best-effort, fire-and-forget:
 *  on write failure the mask degrades to session-only — stale after relaunch,
 *  surfaced by maskComposite's missingAiCoverage — instead of failing the
 *  Select Subject that just succeeded). */
export function storeSubjectCoverage(cacheId: string, coverage: Float32Array): void {
  coverageCache.set(cacheId, coverage);
  void (async () => {
    try {
      if (!isTauri()) return; // browser: session cache only
      const { mkdir, writeFile } = await import("@tauri-apps/plugin-fs");
      const { join } = await import("@tauri-apps/api/path");
      const dir = await coverageDir();
      await mkdir(dir, { recursive: true });
      await writeFile(await join(dir, `${cacheId}.bin`), quantize(coverage));
    } catch (err) {
      console.warn("subjectMask: coverage persist failed", err);
    }
  })();
}

let hydrated: Promise<void> | null = null;

/** Load every persisted coverage into the session cache. Idempotent; kicked
 *  off at module load so mattes are in place before the first develop render.
 *  Await it where a hard guarantee is needed. */
export function hydrateSubjectCoverage(): Promise<void> {
  hydrated ??= (async () => {
    try {
      if (!isTauri()) return;
      const { readDir, readFile } = await import("@tauri-apps/plugin-fs");
      const { join } = await import("@tauri-apps/api/path");
      const dir = await coverageDir();
      const entries = await readDir(dir).catch(() => []); // no dir yet → nothing persisted
      for (const e of entries) {
        if (!e.name.endsWith(".bin")) continue;
        const id = e.name.slice(0, -".bin".length);
        if (coverageCache.has(id)) continue;
        const bytes = await readFile(await join(dir, e.name)).catch(() => null);
        // Length-checked so a truncated file degrades to "stale mask", not garbage.
        if (bytes?.length === U2NET_SIZE * U2NET_SIZE) coverageCache.set(id, dequantize(bytes));
      }
    } catch (err) {
      console.warn("subjectMask: coverage hydrate failed", err);
    }
  })();
  return hydrated;
}
void hydrateSubjectCoverage();

// Lazy so importing this module never eagerly loads onnxruntime-web's WASM.
type OrtModule = typeof import("onnxruntime-web");
let ortP: Promise<OrtModule> | null = null;
let sessionP: Promise<import("onnxruntime-web").InferenceSession> | null = null;

async function session() {
  if (!sessionP) {
    ortP ??= import("onnxruntime-web");
    sessionP = ortP.then((ort) => {
      ort.env.wasm.wasmPaths = "/ort/";
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      return ort.InferenceSession.create(MODEL_URL, {
        executionProviders: ["wasm"],
        graphOptimizationLevel: "all",
      });
    });
  }
  return { ort: await ortP!, session: await sessionP };
}

/** Run Select Subject on an RGBA render; store its coverage under `cacheId`.
 *  Returns the fraction of the frame selected (for a status readout). */
export async function computeSubjectMask(
  cacheId: string,
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Promise<number> {
  const { ort, session: s } = await session();
  const chw = preprocessU2Net(rgba, width, height);
  const out = await s.run({
    [s.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, U2NET_SIZE, U2NET_SIZE]),
  });
  const coverage = postprocessU2Net(out[s.outputNames[0]].data as Float32Array);
  storeSubjectCoverage(cacheId, coverage);
  let sum = 0;
  for (let i = 0; i < coverage.length; i++) sum += coverage[i];
  return sum / coverage.length;
}
