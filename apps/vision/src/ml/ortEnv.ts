// ─────────────────────────────────────────────────────────────
// ortEnv.ts — the one place that configures the onnxruntime-web wasm
// backend, shared by the neural filters (onnx.ts) and diffusion.ts.
//
// Every model run used to happen ON the UI thread (`proxy = false`), so the
// canvas, the progress line and the Close button froze for the whole job —
// including multi-minute denoise/diffusion runs. `env.wasm.proxy = true` moves
// session creation and every `run()` into an ORT-owned worker, so the awaits in
// the filter loops actually yield and onProgress repaints.
//
// Three things the callers have to respect for that to be safe:
//   • the proxy TRANSFERS each input tensor's ArrayBuffer to the worker, so an
//     input buffer is detached after `run()` — never reuse or re-read one;
//   • ORT itself only proxies when `document` exists, so node (vitest) keeps
//     running in-process no matter what this module sets.
//   • proxy mode is fixed before ORT initializes and never changed afterward;
//     existing worker session ids cannot be used by a same-thread backend.
// ─────────────────────────────────────────────────────────────
import * as ort from "onnxruntime-web";

let _prepped = false;

/** Can this environment host ORT's proxy worker? ORT's own gate is
 *  `Worker` + `document`, and Tauri's CSP allows `worker-src blob:`. */
export function ortProxyAvailable(): boolean {
  return typeof Worker !== "undefined" && typeof document !== "undefined";
}

/** wasm threads need SharedArrayBuffer, which needs cross-origin isolation
 *  (COOP/COEP). Without it ORT falls back to one thread anyway, and asking for
 *  more only costs memory — so ask for more only when isolation is real. */
export function ortThreadCount(): number {
  const g = globalThis as { crossOriginIsolated?: boolean; navigator?: { hardwareConcurrency?: number } };
  if (!g.crossOriginIsolated || typeof SharedArrayBuffer === "undefined") return 1;
  return Math.max(1, Math.min(4, g.navigator?.hardwareConcurrency ?? 1));
}

/** Apply the wasm-backend settings once, before ORT initializes. Multiple
 *  concurrent session requests all observe the same immutable backend mode. */
export function prepOrt(): void {
  if (_prepped) return;
  ort.env.wasm.wasmPaths = "/ort/";
  ort.env.wasm.numThreads = ortThreadCount();
  ort.env.wasm.proxy = ortProxyAvailable();
  _prepped = true;
}

/** Create a session without changing backend mode after initialization. A
 *  failed create belongs to the caller; URL caches evict rejected promises. */
export function createSession(
  url: string,
  options: ort.InferenceSession.SessionOptions,
): Promise<ort.InferenceSession> {
  prepOrt();
  return ort.InferenceSession.create(url, options);
}
