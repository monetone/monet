// developWorker — the Develop render thread (PERF-03). Hosts its own instance
// of the shared WASM engine so the per-slider develop pass (camera_raw_develop
// + composite, one pass per active mask) never blocks the UI thread — LR's
// "interactive develop work never runs on the UI thread". engine.ts's
// openDevelopWorkerSession is the main-thread client and owns the protocol's
// other half.
//
// Byte sources build their engine here (createEngine's byte path is pure wasm —
// in a worker isTauri() is false, so it can never wander into Tauri IPC).
// Native RAW decodes on the main thread (Tauri IPC is unavailable in a worker;
// the decode itself already runs in the native process, off-thread) and ships
// scene-linear RGBA16 over as a transfer.

import type { DevelopRecipeV2 } from "@monet-ui/monet-photo";

import { Engine } from "@engine";

import { createEngine, developPass, loadEngine } from "./engine";

export type DevelopWorkerRequest =
  | { t: "openBytes"; bytes: Uint8Array; raw: boolean; maxEdge: number }
  | { t: "openPixels"; width: number; height: number; pixels: Uint16Array; proxyScale: number }
  /** One message = one batch: every engine pass a frame needs (base + masks)
   *  rides a single round trip, so a frame costs one postMessage latency. */
  | { t: "render"; seq: number; recipes: DevelopRecipeV2[] };

export type DevelopWorkerResponse =
  | { t: "ready"; width: number; height: number }
  | { t: "frames"; seq: number; frames: { width: number; height: number; rgba: Uint8Array }[] }
  | { t: "error"; seq?: number; message: string };

// The worker global, typed minimally — the app tsconfig compiles against the
// DOM lib, so DedicatedWorkerGlobalScope isn't in scope here.
const ctx = self as unknown as {
  onmessage: ((e: MessageEvent) => void) | null;
  postMessage(msg: DevelopWorkerResponse, transfer?: Transferable[]): void;
};

let engine: Engine | null = null;
let proxyScale = 1;
const state = { applied: false };

ctx.onmessage = async (e: MessageEvent) => {
  const m = e.data as DevelopWorkerRequest;
  try {
    if (m.t === "openBytes") {
      // sourcePath deliberately omitted: the native-RAW branch is main-thread-only.
      ({ engine, proxyScale } = await createEngine(m.bytes, m.raw, undefined, m.maxEdge, undefined));
      ctx.postMessage({ t: "ready", width: engine.width(), height: engine.height() });
    } else if (m.t === "openPixels") {
      await loadEngine();
      engine = Engine.fromRgba16(m.width, m.height, m.pixels, true);
      proxyScale = m.proxyScale;
      ctx.postMessage({ t: "ready", width: engine.width(), height: engine.height() });
    } else {
      if (!engine) throw new Error("render before open");
      const eng = engine;
      const frames = m.recipes.map((r) => developPass(eng, state, r, proxyScale));
      // active_layer_rgba8 copies out of wasm memory, so every buffer is a
      // fresh, transferable ArrayBuffer — hand them over without a second copy.
      ctx.postMessage(
        { t: "frames", seq: m.seq, frames },
        frames.map((f) => f.rgba.buffer as ArrayBuffer),
      );
    }
  } catch (err) {
    ctx.postMessage({ t: "error", seq: m.t === "render" ? m.seq : undefined, message: String(err) });
  }
};
