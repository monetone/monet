// ─────────────────────────────────────────────────────────────
// EngineClient — the TS bridge to the Rust/WASM compositing engine.
//
// Owns the wasm `Engine` instance and the program <canvas>, and the blit path:
// it copies the engine's composited RGBA output straight out of wasm linear
// memory into the canvas (the Monet Vision blit pattern). The playback
// compositor (playback/compositor.ts) drives it each displayed frame: set the
// layer count, write each visible clip's decoded pixels into a layer source,
// set per-layer transform / blend / color / wipe, `composite()`, then `blit()`.
//
// WASM memory can relocate on growth — always rebuild the `Uint8Array` view
// from `mem.buffer` per use; never cache it across an `alloc_source`.
// ─────────────────────────────────────────────────────────────

import init, { Engine, type InitOutput } from "@engine";
import type { CubeLut } from "@monet-ui/monet-photo";

let wasm: InitOutput | null = null;

/** Load the wasm module once. Safe to await repeatedly. */
export async function initEngine(): Promise<void> {
  if (!wasm) wasm = await init();
}

export class EngineClient {
  engine: Engine | null = null;
  width = 0;
  height = 0;
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private imageData: ImageData | null = null;
  /** What we last pushed to each layer's Look slot; `undefined` = layer is fresh.
   *  `resolveLut` memoises, so identity comparison is a sound change test. */
  private lutUploaded: (CubeLut | null | undefined)[] = [];

  /** The active wasm Engine, asserted present (clear error if used pre-boot). */
  get e(): Engine {
    if (!this.engine) throw new Error("Engine not ready");
    return this.engine;
  }

  get mem(): WebAssembly.Memory {
    return (wasm as InitOutput).memory;
  }

  /** Create the engine at a given program (preview) resolution. */
  ensure(width: number, height: number): void {
    const w = Math.max(1, Math.round(width));
    const h = Math.max(1, Math.round(height));
    if (!this.engine) {
      this.engine = new Engine(w, h);
      this.width = w;
      this.height = h;
      this.makeImageData();
      // The canvas may have been attached (setCanvas) before the engine existed,
      // when width/height were still 0 — size its backing store to match now, or
      // the program monitor stays 0×0 and blit() paints nothing.
      this.resizeCanvasEl();
      return;
    }
    if (w !== this.width || h !== this.height) {
      this.engine.resize(w, h);
      this.width = w;
      this.height = h;
      this.makeImageData();
      this.resizeCanvasEl();
    }
  }

  setCanvas(canvas: HTMLCanvasElement | null): void {
    this.canvas = canvas;
    this.ctx = canvas ? canvas.getContext("2d", { willReadFrequently: false }) : null;
    this.resizeCanvasEl();
    if (this.engine) this.blit();
  }

  private makeImageData(): void {
    this.imageData = new ImageData(this.width, this.height);
  }

  private resizeCanvasEl(): void {
    if (!this.canvas) return;
    if (this.canvas.width !== this.width || this.canvas.height !== this.height) {
      this.canvas.width = this.width;
      this.canvas.height = this.height;
    }
  }

  // ── per-frame layer programming ───────────────────────────────
  setBackground(r: number, g: number, b: number): void {
    this.e.set_background(r, g, b);
  }

  setLayerCount(n: number): void {
    this.e.set_layer_count(n);
    // A layer the engine just (re)created has no LUT — forget what we uploaded
    // for that index, or the dedupe in `setLut` would skip re-uploading it.
    if (n < this.lutUploaded.length) this.lutUploaded.length = n;
    while (this.lutUploaded.length < n) this.lutUploaded.push(undefined);
  }

  layerCount(): number {
    return this.engine ? this.engine.layer_count() : 0;
  }

  /** Copy a decoded RGBA8 frame into layer `idx`'s source buffer (zero-copy). */
  writeSource(idx: number, rgba: Uint8Array | Uint8ClampedArray, w: number, h: number): void {
    const ptr = this.e.alloc_source(idx, w, h);
    if (!ptr) return;
    const view = new Uint8Array(this.mem.buffer, ptr, w * h * 4);
    view.set(rgba instanceof Uint8Array ? rgba : new Uint8Array(rgba.buffer, rgba.byteOffset, rgba.byteLength));
  }

  setVisible(idx: number, v: boolean): void {
    this.e.set_visible(idx, v);
  }
  setOpacity(idx: number, opacity01: number): void {
    this.e.set_opacity(idx, opacity01);
  }
  setBlend(idx: number, modeIndex: number): void {
    this.e.set_blend(idx, modeIndex);
  }
  setTransform(idx: number, tx: number, ty: number, sx: number, sy: number, rotRad: number, ax: number, ay: number): void {
    this.e.set_transform(idx, tx, ty, sx, sy, rotRad, ax, ay);
  }
  setCrop(idx: number, l: number, t: number, r: number, b: number): void {
    this.e.set_crop(idx, l, t, r, b);
  }
  setColor(idx: number, params: Float32Array): void {
    this.e.set_color(idx, params);
  }

  /** Set (or clear, with null) layer `idx`'s creative-Look 3D LUT. The lattice
   *  is a few hundred KB, so it is uploaded only when it actually changes —
   *  intensity lives in the per-frame grade block instead. */
  setLut(idx: number, lut: CubeLut | null): void {
    if (this.lutUploaded[idx] === lut) return;
    this.lutUploaded[idx] = lut;
    if (lut) {
      const [nr, ng, nb] = lut.domainMin;
      const [xr, xg, xb] = lut.domainMax;
      this.e.set_lut(idx, lut.size, lut.data, nr, ng, nb, xr, xg, xb);
    } else {
      this.e.clear_lut(idx);
    }
  }
  setWipe(idx: number, kind: number, progress: number, angleRad: number): void {
    this.e.set_wipe(idx, kind, progress, angleRad);
  }

  composite(): void {
    this.e.composite();
  }

  /** Paint the composited program frame onto the canvas. */
  blit(): void {
    if (!this.engine || !this.ctx || !this.imageData) return;
    const ptr = this.engine.output_ptr();
    const len = this.width * this.height * 4;
    const buf = new Uint8Array(this.mem.buffer, ptr, len);
    this.imageData.data.set(buf);
    this.ctx.putImageData(this.imageData, 0, 0);
  }

  /** A fresh copy of the composited output (RGBA8), for export/encode. */
  readOutput(): Uint8Array {
    const ptr = this.e.output_ptr();
    const len = this.width * this.height * 4;
    return new Uint8Array(this.mem.buffer, ptr, len).slice();
  }

  // ── scopes ────────────────────────────────────────────────────
  histogram(bins = 64): Float32Array {
    return this.engine ? this.engine.histogram(bins) : new Float32Array(bins);
  }
  waveform(cols = 256): Float32Array {
    return this.engine ? this.engine.waveform(cols) : new Float32Array(cols);
  }
  vectorscope(n = 64): Float32Array {
    return this.engine ? this.engine.vectorscope(n) : new Float32Array(n * n);
  }

  /** A data-URL thumbnail of the current program frame. */
  thumbUrl(tw = 160, th = 90): string {
    if (!this.engine) return "";
    const px = this.engine.thumb(tw, th);
    const c = document.createElement("canvas");
    c.width = tw;
    c.height = th;
    const cx = c.getContext("2d")!;
    const img = cx.createImageData(tw, th);
    img.data.set(px);
    cx.putImageData(img, 0, 0);
    return c.toDataURL();
  }
}
