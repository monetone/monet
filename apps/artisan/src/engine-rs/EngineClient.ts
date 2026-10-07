// ─────────────────────────────────────────────────────────────
// EngineClient — TS bridge to the Rust/WASM vector rendering engine
// ─────────────────────────────────────────────────────────────
// Owns the wasm `Engine`, the document <canvas>, and the blit path: it sets the
// serialized document + view on the engine, asks it to rasterize, then copies
// the engine's straight-alpha RGBA buffer straight out of wasm linear memory
// into the canvas via putImageData. Same shape as Monet Vision's EngineClient,
// adapted from raster layers to a vector scene.

import init, { Engine, type InitOutput } from "@engine";

let wasm: InitOutput | null = null;
let booting: Promise<void> | null = null;

/** Load the wasm module once. Safe to call repeatedly. */
export async function initEngine(): Promise<void> {
  if (wasm) return;
  booting ??= init().then((output) => { wasm = output; }).finally(() => { booting = null; });
  await booting;
}

// DEV-only hook so the e2e suite can drive the wasm Engine API directly
// (hit_test, ops, undo, document_json …). Tree-shaken out of production builds.
if (import.meta.env.DEV) {
  (window as unknown as { __engineWasm?: { init: typeof init; Engine: typeof Engine } }).__engineWasm = { init, Engine };
}

export function engineReady(): boolean {
  return wasm !== null;
}

// ── `.monetgfx` container courier ────────────────────────────────────
// Artisan authors one vector scene, but a `.monetgfx` routinely carries layers
// it cannot author at all: Vision raster layers, adjustments, masks, document
// channels. The COURIER RULE says those must survive a load+save round trip
// untouched — so we never decompose the container in TS. The loaded wasm
// `Engine` stays alive for as long as the document is open, we swap only its
// vector layer, and the very same Rust writer that produced the file produces
// it again. Both entry points are compiled into this app's engine/pkg already
// (`loadGraphicsContainer` / `trySaveGraphicsContainer`); this is the wiring.

/** Raster/adjustment/text layer kinds are 0/1/2…; a vector scene is kind 3. */
const LAYER_KIND_VECTOR = 3;

export interface GraphicsContainer {
  /** Canonical `.artisan` JSON of the container's vector layer, or `""` when it
   *  carries none (a pure-raster document out of Vision / Galerie). */
  readonly scene: string;
  /** Re-serialize the container with `sceneJson` as its vector layer. Every
   *  other layer is re-emitted byte-faithfully by the Rust writer. */
  save(sceneJson: string): Uint8Array;
  /** Release the held wasm Engine. The container is unusable afterwards. */
  dispose(): void;
}

function requireWasm(): void {
  if (!wasm) throw new Error("The rendering engine is still loading — try again in a moment.");
}

/** Open a `.monetgfx` container, keeping its Engine alive as the courier.
 *  Throws (loudly) when the bytes are not a container. */
export function openGraphicsContainer(bytes: Uint8Array): GraphicsContainer {
  requireWasm();
  const engine = Engine.loadGraphicsContainer(bytes);
  // ponytail: the first vector layer is Artisan's document; extra vector layers
  // ride along untouched. A layer picker is the upgrade path if that stops being
  // enough.
  let vectorId: number | null = null;
  for (let i = 0; i < engine.layer_count(); i++) {
    const id = engine.layer_id_at(i);
    if (engine.layer_kind(id) === LAYER_KIND_VECTOR) {
      vectorId = id;
      break;
    }
  }
  return {
    scene: vectorId === null ? "" : engine.vector_scene_json(vectorId),
    save(sceneJson: string): Uint8Array {
      if (vectorId === null) {
        // Layer ids start at 1, so 0 is the engine's "edit refused" answer
        // (an imported-Photoshop container is read-only).
        const id = engine.add_vector_layer(sceneJson, "Artisan");
        if (!id) throw new Error("This container does not accept a vector layer.");
        vectorId = id;
      } else {
        engine.vector_set_scene(vectorId, sceneJson);
      }
      // `try…` throws instead of returning empty bytes — an empty save is how a
      // document silently becomes nothing.
      return engine.trySaveGraphicsContainer();
    },
    dispose(): void {
      engine.free();
    },
  };
}

/** Serialize an Artisan document as a fresh `.monetgfx` (the export path — there
 *  are no foreign layers to carry, so the Engine is transient). */
export function graphicsContainerFrom(sceneJson: string, width: number, height: number): Uint8Array {
  requireWasm();
  const engine = new Engine(Math.max(1, Math.round(width)), Math.max(1, Math.round(height)));
  try {
    engine.set_document(sceneJson);
    return engine.trySaveGraphicsContainer();
  } finally {
    engine.free();
  }
}

export class EngineClient {
  private engine: Engine | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;
  /** Device-pixel surface size (cssSize * dpr). */
  width = 0;
  height = 0;
  private dpr = 1;

  private get mem(): WebAssembly.Memory {
    return (wasm as InitOutput).memory;
  }

  private ensure(): Engine | null {
    if (!this.engine && wasm) this.engine = new Engine(1, 1);
    return this.engine;
  }

  setCanvas(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d", { willReadFrequently: false });
  }

  /** Size the surface to the CSS viewport at the given device-pixel ratio. */
  resize(cssWidth: number, cssHeight: number, dpr = 1): void {
    const w = Math.max(1, Math.round(cssWidth * dpr));
    const h = Math.max(1, Math.round(cssHeight * dpr));
    this.dpr = dpr;
    if (w === this.width && h === this.height) return;
    this.width = w;
    this.height = h;
    this.ensure()?.resize(w, h);
    if (this.canvas) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.canvas.style.width = `${cssWidth}px`;
      this.canvas.style.height = `${cssHeight}px`;
    }
    if (this.ctx) this.imageData = this.ctx.createImageData(w, h);
  }

  /** Load a serialized `.artisan` document into the engine. */
  setDocument(json: string): void {
    const e = this.ensure();
    if (!e) return;
    try {
      e.set_document(json);
    } catch (err) {
      console.error("[Artisan] engine.set_document failed:", err);
    }
  }

  /** Set the world→screen view (CSS units; scaled to device pixels internally). */
  setView(tx: number, ty: number, zoom: number, angle: number): void {
    this.ensure()?.set_view(tx * this.dpr, ty * this.dpr, zoom * this.dpr, angle);
  }

  /** Rasterize + blit the current document/view onto the canvas. */
  render(): void {
    const e = this.engine;
    if (!e || !this.ctx || !this.imageData) return;
    e.render();
    const ptr = e.output_ptr();
    const len = this.width * this.height * 4;
    // WASM memory can relocate on growth — always build the view fresh.
    const buf = new Uint8Array(this.mem.buffer, ptr, len);
    this.imageData.data.set(buf);
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  /** Vectorscope: an n×n hue/saturation density grid (row-major, log-normalized
   *  0..1) of the last rendered composite. Uses the SHARED engine op
   *  (packages/engine) — the same op monet-vision calls — so both apps render an
   *  identical scope. Reads whatever `render()` last composited into the engine
   *  output; returns zeros when no engine has rendered yet. */
  vectorscope(n = 128): Float32Array {
    const e = this.engine;
    if (!e) return new Float32Array(n * n);
    return e.vectorscope(n);
  }

  /** Luma waveform: a `cols`×`rows` density grid (row-major, log-normalized
   *  0..1, white at the top) of the last rendered composite. Shared engine op
   *  (packages/engine) — identical to monet-vision. Zeros when nothing rendered. */
  waveform(cols = 176, rows = 128): Float32Array {
    const e = this.engine;
    if (!e) return new Float32Array(cols * rows);
    return e.waveform(cols, rows);
  }

  /** RGB waveform: three stacked `cols`×`rows` per-channel density grids
   *  (R, G, B). Shared engine op. Zeros when nothing rendered. */
  waveformRgb(cols = 176, rows = 128): Float32Array {
    const e = this.engine;
    if (!e) return new Float32Array(cols * rows * 3);
    return e.waveform_rgb(cols, rows);
  }

  dispose(): void {
    this.engine?.free();
    this.engine = null;
  }
}
