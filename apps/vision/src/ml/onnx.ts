// ─────────────────────────────────────────────────────────────
// onnx.ts — REAL ML neural filters. Runs genuine pretrained ONNX
// models in-browser via onnxruntime-web (wasm backend). No
// approximations: these are the actual trained networks.
//
//   • Style Transfer  — fast-neural-style (Johnson et al.), 5 styles
//   • Super-Resolution — sub-pixel CNN (ESPCN), 3× upscale, tiled
//   • Select Subject / Remove Background — U²-Net salient-object net
//
// Models live in /public/models, the ORT wasm runtime in /public/ort.
// ─────────────────────────────────────────────────────────────

import * as ort from "onnxruntime-web";
import { engine, store } from "../state/app";
import { generateRGBA, generateInpaintRGBA, generateImageFromReference, type GenControls } from "./diffusion";
import { bestUnit, filePresent, resolveModelUrl } from "./modelSource";
import { MODEL_REGISTRY, type ModelDef } from "./modelRegistry";
import { blendStyle, type StyleBlendOpts } from "./styleBlend";
import { throwIfCancelled } from "./mlJob";
import { createSession } from "./ortEnv";
import { tileFilter } from "./tiling";
import { matteComposite } from "../state/matteComposite";
import { docChanged as editStampChanged, editStamp as captureEditStamp } from "./editStamp";

export const STYLES = ["candy", "mosaic", "rain-princess", "udnie", "pointilism"] as const;
const STYLE_FILE: Record<string, string> = {
  candy: "candy.onnx",
  mosaic: "mosaic.onnx",
  "rain-princess": "rain.onnx",
  udnie: "udnie.onnx",
  pointilism: "pointilism.onnx",
};

const _sessions = new Map<string, Promise<ort.InferenceSession>>();
export const clearSessionCache = (): void => { _sessions.clear(); };
function session(url: string): Promise<ort.InferenceSession> {
  let s = _sessions.get(url);
  if (!s) {
    const created = createSession(url, { executionProviders: ["wasm"], graphOptimizationLevel: "all" });
    // Evict a rejected create so a one-off failure (transient fetch error, ORT
    // init hiccup, model not yet in place) doesn't poison the URL for the whole
    // app session — the next invocation retries. The original promise is still
    // what callers get, so the first caller still sees the real error. (#14)
    created.catch(() => { if (_sessions.get(url) === created) _sessions.delete(url); });
    s = created;
    _sessions.set(url, s);
  }
  return s;
}

function model(id: ModelDef["id"]): ModelDef {
  return MODEL_REGISTRY.find((def) => def.id === id)!;
}

async function modelSession(id: ModelDef["id"], rel: string): Promise<ort.InferenceSession> {
  return session(await resolveModelUrl(model(id), rel));
}

// Load the best available unit for a capability (its imported quality-tier
// alternate, else the base) — same ONNX contract, so callers are unchanged.
async function bestSession(baseId: ModelDef["id"]): Promise<ort.InferenceSession> {
  const unit = await bestUnit(baseId);
  return session(await resolveModelUrl(unit, unit.files[0].rel));
}

// ── canvas helpers ─────────────────────────────────────────────
function cvs(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  return [c, c.getContext("2d", { willReadFrequently: true })!];
}
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}
/** Current composite as straight RGBA8 (via the engine's PNG encoder). */
async function composite(): Promise<{ data: Uint8ClampedArray; w: number; h: number }> {
  const png = engine.e.export_png();
  const blob = new Blob([png as unknown as BlobPart], { type: "image/png" });
  const url = URL.createObjectURL(blob);
  try {
    const img = await loadImage(url);
    const w = img.naturalWidth, h = img.naturalHeight;
    const [, cx] = cvs(w, h);
    cx.drawImage(img, 0, 0);
    return previewDownscale(cx.getImageData(0, 0, w, h).data, w, h);
  } finally { URL.revokeObjectURL(url); }
}
function resize(data: Uint8ClampedArray, w: number, h: number, tw: number, th: number): Uint8ClampedArray {
  const [sc, scx] = cvs(w, h);
  const id = scx.createImageData(w, h); id.data.set(data); scx.putImageData(id, 0, 0);
  const [, dcx] = cvs(tw, th);
  dcx.imageSmoothingEnabled = true; dcx.imageSmoothingQuality = "high";
  dcx.drawImage(sc, 0, 0, tw, th);
  return dcx.getImageData(0, 0, tw, th).data;
}
async function toPng(data: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const [c, cx] = cvs(w, h);
  const id = cx.createImageData(w, h); id.data.set(data); cx.putImageData(id, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(`PNG encode failed (${w}×${h})`);
  return new Uint8Array(await blob.arrayBuffer());
}
const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
const u8view = (a: Uint8ClampedArray) => new Uint8Array(a.buffer, a.byteOffset, a.byteLength);

export type MlProgress = (msg: string) => void;

// A document swap/resize during a model's awaits invalidates the captured
// pixels; jobs capture the stamp up front and bail before applying if it
// changed, so results never land on a document the user has since replaced.
// docGen alone only moves on swap/resize — a plain content edit (adjustment,
// brush stroke, MCP tool) during a minutes-long job left the guard blind, and
// the job then buried that edit under an opaque full-canvas stamp of pre-edit
// pixels while reporting success. `undo_pushes()` is monotonic and advances on
// every committed edit, so pairing the two also catches content changes. (#59)
const editStamp = (): string => captureEditStamp(engine);
const docChanged = (stamp: string): boolean => editStampChanged(engine, stamp);

// ── Live before/after preview ──────────────────────────────────
// The dialog used to make the user pick a style/amount blind, apply, look, undo.
// Preview reuses the REAL filter — same model, same post-blend — with two hooks:
// composite() hands it a downscaled document and the stamp lands in a buffer
// instead of the layer stack. So every stamp-style filter is previewable without
// a per-filter preview path, and the preview can never mutate the document.
//
// ponytail: a downscaled proof (PREVIEW_MAX_SIDE longest side), not a
// full-resolution render — the models run at their own fixed input size anyway,
// so what changes is the post-blend/resample resolution. Tile-accurate
// full-res previews are the upgrade if anyone needs to judge grain.
export const PREVIEW_MAX_SIDE = 256;
export interface MlPreviewResult { before: Uint8ClampedArray; after: Uint8ClampedArray; w: number; h: number }
interface PreviewJob { max: number; scale: number; before: Uint8ClampedArray | null; after: Uint8ClampedArray | null; w: number; h: number }
let _preview: PreviewJob | null = null;

/** How much smaller the previewed document is than the real one (1 = not previewing).
 *  Pixel-radius effects have to scale with it or the preview lies. */
const previewScale = () => _preview?.scale ?? 1;

function previewDownscale(data: Uint8ClampedArray, w: number, h: number): { data: Uint8ClampedArray; w: number; h: number } {
  if (!_preview) return { data, w, h };
  const s = Math.min(1, _preview.max / Math.max(w, h, 1));
  const pw = Math.max(1, Math.round(w * s)), ph = Math.max(1, Math.round(h * s));
  const small = s < 1 ? resize(data, w, h, pw, ph) : data;
  _preview.scale = s < 1 ? s : 1;
  _preview.before = new Uint8ClampedArray(small);
  return { data: small, w: s < 1 ? pw : w, h: s < 1 ? ph : h };
}

/** Land a full-document result: a new stamped layer, or — under previewFilter —
 *  the preview buffer. False means the job was abandoned (document changed). */
function stampResult(rgba: Uint8ClampedArray, w: number, h: number, gen: string, onProgress?: MlProgress): boolean {
  throwIfCancelled();
  if (_preview) { _preview.after = rgba; _preview.w = w; _preview.h = h; return true; }
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return false; }
  engine.e.select_none(); // whole-document result — never clip to a selection changed while the model ran
  store.addLayer();
  engine.e.stamp_image(0, 0, w, h, u8view(rgba));
  engine.commit();
  return true;
}

/** Jobs that apply themselves some other way than stampResult (a new document, a
 *  selection, a warp, a masked fill) have no preview path, so they must refuse
 *  one instead of quietly mutating the document at preview resolution. */
function refusePreview(what: string): void {
  if (_preview) throw new Error(`${what} cannot be previewed.`);
}

/** Run a filter against a downscaled composite and hand back its before/after
 *  pixels instead of applying it. `run` is the ordinary filter call. */
export async function previewFilter(
  run: (onProgress?: MlProgress) => Promise<unknown>,
  onProgress?: MlProgress,
  maxSide = PREVIEW_MAX_SIDE,
): Promise<MlPreviewResult> {
  if (_preview) throw new Error("A preview is already running.");
  _preview = { max: maxSide, scale: 1, before: null, after: null, w: 0, h: 0 };
  try {
    await run(onProgress);
    const { before, after, w, h } = _preview;
    if (!before || !after) throw new Error("This filter has no previewable result.");
    return { before, after, w, h };
  } finally { _preview = null; }
}

// ── Style transfer (fast-neural-style) ─────────────────────────
// The ONNX-zoo fast-neural-style nets take a fixed 224×224 NCHW float32
// RGB tensor in [0,255] and emit the same. We run at 224², then resample
// the stylized result back to the document and stamp it as a new layer.
// Strength / Preserve Color / Style Opacity are post-blends against the
// pre-filter composite (see styleBlend.ts) — the nets take no such input.
const STYLE_SIZE = 224;
export async function styleTransfer(name: string, _maxSide = 0, onProgress?: MlProgress, opts?: StyleBlendOpts): Promise<{ ok: boolean; w: number; h: number; style: string }> {
  const gen = editStamp();
  onProgress?.(`Loading ${name} model…`);
  const s = await modelSession("styles", STYLE_FILE[name] ?? STYLE_FILE.candy);
  const { data, w, h } = await composite();
  const N = STYLE_SIZE, plane = N * N;
  const rd = resize(data, w, h, N, N);
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = rd[p * 4];
    chw[plane + p] = rd[p * 4 + 1];
    chw[2 * plane + p] = rd[p * 4 + 2];
  }
  onProgress?.("Running style network…");
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const out = await s.run({ [inName]: new ort.Tensor("float32", chw, [1, 3, N, N]) });
  const o = out[outName].data as Float32Array;
  const rgba = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) {
    rgba[p * 4] = clamp8(o[p]);
    rgba[p * 4 + 1] = clamp8(o[plane + p]);
    rgba[p * 4 + 2] = clamp8(o[2 * plane + p]);
    rgba[p * 4 + 3] = 255;
  }
  const full = blendStyle(resize(rgba, N, N, w, h), data, opts);
  if (!stampResult(full, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, style: name };
  // Style Opacity stays a live layer property so it can be re-dialled after the
  // fact — there is no layer under a preview, so the preview shows it at 100%.
  const styleOpacity = opts?.styleOpacity ?? 1;
  if (styleOpacity < 1 && !_preview) store.setLayerOpacity(engine.e.active_layer_id(), styleOpacity * 100);
  onProgress?.("Done.");
  return { ok: true, w, h, style: name };
}

// ── Super-Resolution (sub-pixel CNN / ESPCN) ───────────────────
// The net takes a 224×224 luma tile → 672×672 (3×). We tile the whole
// image through it for true 3× SR on the Y channel, bicubic-upscale
// chroma, recombine YCbCr→RGB, and open the result as a new document.
export async function superResolution(onProgress?: MlProgress): Promise<{ ok: boolean; inW: number; inH: number; outW: number; outH: number }> {
  refusePreview("Super-Resolution");
  const gen = editStamp();
  onProgress?.("Loading super-resolution model…");
  const s = await bestSession("super-res");
  const { data, w, h } = await composite();
  const TS = 224, OT = 672;
  const outW = w * 3, outH = h * 3;
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const bigY = new Float32Array(outW * outH);
  const tilesX = Math.ceil(w / TS), tilesY = Math.ceil(h / TS);
  for (let ty = 0; ty < tilesY; ty++) {
    for (let tx = 0; tx < tilesX; tx++) {
      throwIfCancelled();
      onProgress?.(`Super-resolving tile ${ty * tilesX + tx + 1}/${tilesX * tilesY}…`);
      const yt = new Float32Array(TS * TS);
      for (let j = 0; j < TS; j++) {
        const sy = Math.min(h - 1, ty * TS + j);
        for (let i = 0; i < TS; i++) {
          const sx = Math.min(w - 1, tx * TS + i);
          const p = (sy * w + sx) * 4;
          yt[j * TS + i] = (0.299 * data[p] + 0.587 * data[p + 1] + 0.114 * data[p + 2]) / 255;
        }
      }
      const out = await s.run({ [inName]: new ort.Tensor("float32", yt, [1, 1, TS, TS]) });
      const oy = out[outName].data as Float32Array;
      for (let j = 0; j < OT; j++) {
        const dy = ty * OT + j; if (dy >= outH) break;
        for (let i = 0; i < OT; i++) {
          const dx = tx * OT + i; if (dx >= outW) break;
          bigY[dy * outW + dx] = clamp8(oy[j * OT + i] * 255);
        }
      }
    }
  }
  // chroma: bicubic-upscale the source and pull Cb/Cr from it
  const up = resize(data, w, h, outW, outH);
  const rgba = new Uint8ClampedArray(outW * outH * 4);
  for (let p = 0; p < outW * outH; p++) {
    const R0 = up[p * 4], G0 = up[p * 4 + 1], B0 = up[p * 4 + 2];
    const Cb = 128 - 0.168736 * R0 - 0.331264 * G0 + 0.5 * B0;
    const Cr = 128 + 0.5 * R0 - 0.418688 * G0 - 0.081312 * B0;
    const Y = bigY[p];
    rgba[p * 4] = clamp8(Y + 1.402 * (Cr - 128));
    rgba[p * 4 + 1] = clamp8(Y - 0.344136 * (Cb - 128) - 0.714136 * (Cr - 128));
    rgba[p * 4 + 2] = clamp8(Y + 1.772 * (Cb - 128));
    rgba[p * 4 + 3] = 255;
  }
  onProgress?.("Assembling result…");
  const png = await toPng(rgba, outW, outH);
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, inW: 0, inH: 0, outW: 0, outH: 0 }; }
  store.openImage(png, `Super-Resolution ${outW}×${outH}`);
  return { ok: true, inW: w, inH: h, outW, outH };
}

// ── U²-Net salient-object segmentation ─────────────────────────
/** Camera Raw "Subject" mask: run U2-Net once, persist the matte's outline
 *  into the develop recipe (mask kind 7) so replay never re-runs the model.
 *  Null when the model is absent or the matte is degenerate. */
export async function subjectOutline(): Promise<{ x: number; y: number; pressure: number }[] | null> {
  const { matteToOutline } = await import("../state/matteOutline");
  const { mask, w, h } = await segMask();
  const outline = matteToOutline(mask, w, h);
  return outline?.map((p) => ({ x: p.x, y: p.y, pressure: 1 })) ?? null;
}

async function segMask(onProgress?: MlProgress): Promise<{ mask: Uint8Array; w: number; h: number; comp: Uint8ClampedArray }> {
  onProgress?.("Loading segmentation model…");
  const s = await modelSession("u2netp", "u2netp.onnx");
  const { data, w, h } = await composite();
  const N = 320;
  const rd = resize(data, w, h, N, N);
  const plane = N * N;
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = (rd[p * 4] / 255 - mean[0]) / std[0];
    chw[plane + p] = (rd[p * 4 + 1] / 255 - mean[1]) / std[1];
    chw[2 * plane + p] = (rd[p * 4 + 2] / 255 - mean[2]) / std[2];
  }
  onProgress?.("Detecting subject…");
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const out = await s.run({ [inName]: new ort.Tensor("float32", chw, [1, 3, N, N]) });
  const d1 = out[outName].data as Float32Array;
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < plane; i++) { if (d1[i] < mn) mn = d1[i]; if (d1[i] > mx) mx = d1[i]; }
  const rng = mx - mn || 1;
  const small = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) {
    const v = clamp8(Math.round(((d1[i] - mn) / rng) * 255));
    small[i * 4] = v; small[i * 4 + 1] = v; small[i * 4 + 2] = v; small[i * 4 + 3] = 255;
  }
  const upm = resize(small, N, N, w, h);
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) mask[i] = upm[i * 4];
  return { mask, w, h, comp: data };
}

// Set the document selection to the detected subject.
export async function selectSubject(onProgress?: MlProgress): Promise<{ ok: boolean; coverage: number }> {
  refusePreview("Select Subject");
  const gen = editStamp();
  const { mask, w, h } = await segMask(onProgress);
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, coverage: 0 }; }
  engine.e.set_selection_mask(mask);
  engine.commit();
  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) on++;
  onProgress?.("Done.");
  return { ok: true, coverage: on / (w * h) };
}

// ── Generative Fill (MI-GAN inpainting) ────────────────────────
// A real GAN inpainting network fills the current selection with
// synthesized content. MI-GAN I/O (verified empirically): uint8
// image[1,3,H,W] (raw RGB) + uint8 mask[1,1,H,W] where 255=known,
// 0=hole; uint8 RGB out, known region preserved exactly. We crop the
// selection's bbox with surrounding context, run at 512², resample
// back, and composite the fill onto a new layer through the selection.
function grayToRgba(g: Uint8Array, w: number, h: number): Uint8ClampedArray {
  const a = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) { a[i * 4] = g[i]; a[i * 4 + 1] = g[i]; a[i * 4 + 2] = g[i]; a[i * 4 + 3] = 255; }
  return a;
}

/** The document selection resampled to the composite a filter is working on —
 *  identity at document resolution, downscaled under previewFilter. Indexing a
 *  doc-resolution mask by preview pixels would read the top-left corner. */
function selectionMaskAt(w: number, h: number): Uint8Array {
  const m = engine.e.get_selection_mask() as Uint8Array;
  if (m.length === w * h) return m;
  const sw = engine.e.width(), sh = engine.e.height();
  if (m.length !== sw * sh) return m;
  const r = resize(grayToRgba(m, sw, sh), sw, sh, w, h);
  const out = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = r[i * 4];
  return out;
}

// The selection's bbox padded with surrounding context (so the fill model sees
// what it's blending into), cropped from the composite. Shared by both fillers.
interface FillCrop { crop: Uint8ClampedArray; cropSel: Uint8Array; cx0: number; cy0: number; cw: number; ch: number; holePx: number; }
function selectionBBoxCrop(data: Uint8ClampedArray, w: number, h: number, sel: Uint8Array): FillCrop {
  let minx = w, miny = h, maxx = -1, maxy = -1, holePx = 0;
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (sel[y * w + x] > 127) { holePx++; if (x < minx) minx = x; if (x > maxx) maxx = x; if (y < miny) miny = y; if (y > maxy) maxy = y; }
  }
  if (holePx === 0) return { crop: new Uint8ClampedArray(0), cropSel: new Uint8Array(0), cx0: 0, cy0: 0, cw: 0, ch: 0, holePx: 0 };
  const pad = Math.round(Math.max(maxx - minx + 1, maxy - miny + 1) * 0.6) + 8;
  const cx0 = Math.max(0, minx - pad), cy0 = Math.max(0, miny - pad);
  const cx1 = Math.min(w - 1, maxx + pad), cy1 = Math.min(h - 1, maxy + pad);
  const cw = cx1 - cx0 + 1, ch = cy1 - cy0 + 1;
  const crop = new Uint8ClampedArray(cw * ch * 4);
  const cropSel = new Uint8Array(cw * ch);
  for (let y = 0; y < ch; y++) for (let x = 0; x < cw; x++) {
    const sp = ((cy0 + y) * w + (cx0 + x)) * 4, dp = (y * cw + x) * 4;
    crop[dp] = data[sp]; crop[dp + 1] = data[sp + 1]; crop[dp + 2] = data[sp + 2]; crop[dp + 3] = 255;
    cropSel[y * cw + x] = sel[(cy0 + y) * w + (cx0 + x)];
  }
  return { crop, cropSel, cx0, cy0, cw, ch, holePx };
}

// Stamp a filled crop onto a new layer through the mask CAPTURED AT JOB START —
// non-destructive, original preserved outside the hole.
//
// The mask rides in the stamp buffer's ALPHA and the live selection is cleared
// first, which is load-bearing twice over:
//  • the model runs for seconds-to-minutes while the user keeps working, so
//    stamp_image's own selection clipping would mask the result with whatever is
//    selected NOW — dropping the fill, resurrecting stale pre-job pixels over
//    live edits, and (with nothing selected, coverage 1.0 everywhere) stamping
//    the whole stale composite across the document. (#20)
//  • blending by the mask in JS AND letting stamp_image multiply by it again put
//    a feathered fill down at a², haloing every Generative Fill / Remove. (#21)
function compositeFillOntoNewLayer(outCrop: Uint8ClampedArray, c: FillCrop, w: number, h: number): void {
  refusePreview("Generative fill");
  const full = new Uint8ClampedArray(w * h * 4); // transparent outside the hole
  for (let y = 0; y < c.ch; y++) for (let x = 0; x < c.cw; x++) {
    const a = c.cropSel[y * c.cw + x];
    if (a <= 0) continue;
    const dp = ((c.cy0 + y) * w + (c.cx0 + x)) * 4, cp = (y * c.cw + x) * 4;
    full[dp] = outCrop[cp];
    full[dp + 1] = outCrop[cp + 1];
    full[dp + 2] = outCrop[cp + 2];
    full[dp + 3] = a; // the captured mask, applied exactly once
  }
  store.addLayer();
  engine.e.select_none();
  engine.e.stamp_image(0, 0, w, h, u8view(full));
  // Content Credentials: these pixels were synthesized, so the manifest must say
  // so. Marked HERE rather than in each caller — Generative Fill, the diffusion
  // fill and Generative Expand all land through this one helper, and
  // under-disclosing AI is the failure that actually matters.
  engine.e.mark_ai_generated();
  engine.commit();
}

export async function generativeFillML(onProgress?: MlProgress): Promise<{ ok: boolean; w: number; h: number; holePx: number; box: number[] }> {
  if (!engine.e.has_selection()) throw new Error("Make a selection to fill first.");
  const miganUrl = await resolveModelUrl(model("migan"), "migan.onnx");
  if (!(await filePresent(miganUrl)))
    throw new Error("MI-GAN is not installed; add a licensed local model or install Stable Diffusion weights (see public/models/MODELS.md).");
  const gen = editStamp();
  onProgress?.("Loading inpainting model…");
  const s = await session(miganUrl);
  const { data, w, h } = await composite();
  const sel = engine.e.get_selection_mask() as Uint8Array; // 255 = selected (hole)
  const c = selectionBBoxCrop(data, w, h, sel);
  if (c.holePx === 0) throw new Error("Make a selection to fill first.");
  const M = 512, plane = M * M;
  const img512 = resize(c.crop, c.cw, c.ch, M, M);
  const sel512 = resize(grayToRgba(c.cropSel, c.cw, c.ch), c.cw, c.ch, M, M);
  const imgCHW = new Uint8Array(3 * plane);
  const maskArr = new Uint8Array(plane);
  for (let p = 0; p < plane; p++) {
    imgCHW[p] = img512[p * 4]; imgCHW[plane + p] = img512[p * 4 + 1]; imgCHW[2 * plane + p] = img512[p * 4 + 2];
    maskArr[p] = sel512[p * 4] > 127 ? 0 : 255; // selected -> hole(0), known -> 255
  }
  onProgress?.("Synthesizing fill…");
  const inName = s.inputNames, outName = s.outputNames[0];
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inName[0]] = new ort.Tensor("uint8", imgCHW, [1, 3, M, M]);
  feeds[inName[1]] = new ort.Tensor("uint8", maskArr, [1, 1, M, M]);
  const res = await s.run(feeds);
  const o = res[outName].data as Uint8Array; // CHW 0..255
  const outRGBA = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) { outRGBA[p * 4] = o[p]; outRGBA[p * 4 + 1] = o[plane + p]; outRGBA[p * 4 + 2] = o[2 * plane + p]; outRGBA[p * 4 + 3] = 255; }
  const outCrop = resize(outRGBA, M, M, c.cw, c.ch);
  // stamp onto a new layer (the captured mask is its alpha → non-destructive)
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0, holePx: 0, box: [] }; }
  compositeFillOntoNewLayer(outCrop, c, w, h);
  onProgress?.("Done.");
  return { ok: true, w, h, holePx: c.holePx, box: [c.cx0, c.cy0, c.cw, c.ch] };
}

// ── Remove tool: LaMa large-model inpaint tier ─────────────────
// LaMa (big-lama, Carve/LaMa-ONNX) is the higher-capacity alternate to MI-GAN
// for the Remove tool. Same selection-crop plumbing as generativeFillML, but
// LaMa's ONNX contract differs on two axes that MUST stay right or it inpaints
// garbage: float32 image in [0,1] (not uint8), and mask polarity 1 = hole /
// 0 = keep (INVERTED vs MI-GAN's 255 = known). The Carve export is a static
// 512² graph, so — like MI-GAN — we run the padded selection crop at 512².
// Contract VERIFIED 2026-07-20 against the Carve-Photos export notebook + ORT
// usage (inputs "image"[1,3,512,512] RGB [0,1] / "mask"[1,1,512,512] 1=hole,
// output "output"[1,3,512,512] range [0,255] — the ×255 clamp is baked into the
// graph; see MODELS.md). Output range is still auto-detected so a re-export
// that emits [0,1] also renders correctly.
export async function lamaFillML(onProgress?: MlProgress): Promise<{ ok: boolean; w: number; h: number; holePx: number; box: number[] }> {
  if (!engine.e.has_selection()) throw new Error("Make a selection to fill first.");
  const lamaUrl = await resolveModelUrl(model("lama"), "lama_fp32.onnx");
  if (!(await filePresent(lamaUrl)))
    throw new Error("LaMa is not installed; import lama_fp32.onnx via the Model Manager (see public/models/MODELS.md).");
  const gen = editStamp();
  onProgress?.("Loading LaMa inpainting model…");
  const s = await session(lamaUrl);
  const { data, w, h } = await composite();
  const sel = engine.e.get_selection_mask() as Uint8Array; // 255 = selected (hole)
  const c = selectionBBoxCrop(data, w, h, sel);
  if (c.holePx === 0) throw new Error("Make a selection to fill first.");
  const M = 512, plane = M * M;
  const img512 = resize(c.crop, c.cw, c.ch, M, M);
  const sel512 = resize(grayToRgba(c.cropSel, c.cw, c.ch), c.cw, c.ch, M, M);
  const imgCHW = new Float32Array(3 * plane);
  const maskArr = new Float32Array(plane);
  for (let p = 0; p < plane; p++) {
    imgCHW[p] = img512[p * 4] / 255; imgCHW[plane + p] = img512[p * 4 + 1] / 255; imgCHW[2 * plane + p] = img512[p * 4 + 2] / 255;
    maskArr[p] = sel512[p * 4] > 127 ? 1 : 0; // LaMa: 1 = hole (inpaint), 0 = keep — inverted vs MI-GAN
  }
  onProgress?.("Synthesizing fill…");
  const inName = s.inputNames, outName = s.outputNames[0];
  const feeds: Record<string, ort.Tensor> = {};
  feeds[inName[0]] = new ort.Tensor("float32", imgCHW, [1, 3, M, M]);
  feeds[inName[1]] = new ort.Tensor("float32", maskArr, [1, 1, M, M]);
  const res = await s.run(feeds);
  const o = res[outName].data as Float32Array; // CHW; [0,1] or [0,255] per export
  let omax = 0;
  for (let i = 0; i < o.length; i++) if (o[i] > omax) omax = o[i];
  const oscale = omax <= 1.5 ? 255 : 1; // auto-detect the output range
  const outRGBA = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) { outRGBA[p * 4] = clamp8(o[p] * oscale); outRGBA[p * 4 + 1] = clamp8(o[plane + p] * oscale); outRGBA[p * 4 + 2] = clamp8(o[2 * plane + p] * oscale); outRGBA[p * 4 + 3] = 255; }
  const outCrop = resize(outRGBA, M, M, c.cw, c.ch);
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0, holePx: 0, box: [] }; }
  compositeFillOntoNewLayer(outCrop, c, w, h);
  onProgress?.("Done.");
  return { ok: true, w, h, holePx: c.holePx, box: [c.cx0, c.cy0, c.cw, c.ch] };
}

// ── Generative Fill (prompt-driven, diffusion inpaint) ─────────
// Photoshop's Generative Fill is conditioned on a TEXT PROMPT; MI-GAN is not.
// This routes the selection through blended latent diffusion (generateInpaintRGBA)
// so a prompt drives the fill, conditioned on the surrounding pixels. With no
// prompt — or when the SD/vae_encoder weights aren't installed — it tries the
// optional prompt-free MI-GAN path. If neither local model is installed, the
// caller gets a clear error. Returns which model actually ran.
export async function generativeFillDiffusion(
  prompt: string, steps: number, onProgress?: MlProgress, ctrl?: GenControls,
): Promise<{ ok: boolean; w: number; h: number; holePx: number; box: number[]; model: "diffusion" | "mi-gan" }> {
  if (!engine.e.has_selection()) throw new Error("Make a selection to fill first.");
  if (!prompt.trim()) return { ...(await generativeFillML(onProgress)), model: "mi-gan" };
  const gen = editStamp();
  const { data, w, h } = await composite();
  const sel = engine.e.get_selection_mask() as Uint8Array;
  const c = selectionBBoxCrop(data, w, h, sel);
  if (c.holePx === 0) throw new Error("Make a selection to fill first.");
  const M = 512;
  const img512 = resize(c.crop, c.cw, c.ch, M, M);
  const sel512 = resize(grayToRgba(c.cropSel, c.cw, c.ch), c.cw, c.ch, M, M);
  const hole = new Uint8Array(M * M);
  for (let p = 0; p < M * M; p++) hole[p] = sel512[p * 4] > 127 ? 255 : 0; // selected → generate
  const r = await generateInpaintRGBA(img512, hole, { prompt, steps, ...ctrl }, onProgress);
  if (!r.ok) {
    onProgress?.("No SD inpaint weights — using MI-GAN (prompt ignored).");
    return { ...(await generativeFillML(onProgress)), model: "mi-gan" };
  }
  const outCrop = resize(r.rgba, r.w, r.h, c.cw, c.ch);
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0, holePx: 0, box: [], model: "diffusion" }; }
  compositeFillOntoNewLayer(outCrop, c, w, h);
  onProgress?.("Done.");
  return { ok: true, w, h, holePx: c.holePx, box: [c.cx0, c.cy0, c.cw, c.ch], model: "diffusion" };
}

// ── Generative Expand (outpainting) ────────────────────────────
// Photoshop's Generative Expand = enlarge the canvas, then generatively
// synthesize the new border from the surrounding content. We reuse the
// MI-GAN inpaint path: grow the canvas (original re-anchored at dx,dy),
// select the new frame as the "hole", and hand off to generativeFillML —
// which conditions the fill on the preserved original pixels and stamps it
// onto a new layer. One MI-GAN pass, entirely on-device.
// ponytail: MI-GAN infers at 512², so a thin border around a large canvas
// fills at low res — swap in a diffusion outpaint model for HD borders.
export async function generativeExpandML(
  nw: number, nh: number, dx: number, dy: number,
  onProgress?: MlProgress,
): Promise<{ ok: boolean; w: number; h: number; holePx: number; box: number[] }> {
  refusePreview("Generative Expand");
  const e = engine.e;
  const w = e.width(), h = e.height();
  nw = Math.round(nw); nh = Math.round(nh); dx = Math.max(0, Math.round(dx)); dy = Math.max(0, Math.round(dy));
  if (nw <= w && nh <= h) throw new Error("Set an expansion amount first.");
  if (dx + w > nw || dy + h > nh) throw new Error("Expansion offset places the image outside the new canvas.");
  onProgress?.("Expanding canvas…");
  e.resize_canvas(nw, nh, dx, dy);  // original → (dx,dy); the new border is transparent
  if (engine.commit() === false) {
    onProgress?.("Expansion blocked — convert the document to 16 or 8 bits/channel first.");
    return { ok: false, w, h, holePx: 0, box: [] };
  }
  e.select_rect(0, 0, nw, nh, 0);   // select all…
  e.select_rect(dx, dy, w, h, 2);   // …minus the original → the new frame is the hole
  const r = await generativeFillML(onProgress); // inpaints the frame onto a new layer
  store.requestFit();               // the canvas grew — refit the view
  return r;
}

// ── Generate Background (subject + diffusion backdrop) ─────────
// Photoshop's Generate Background = keep the subject, synthesize a new scene
// behind it. We reuse the pieces already here: U²-Net segments the subject
// (segMask), the local diffusion pipeline (generateRGBA) paints a fresh
// backdrop from the prompt, and we matte the subject over it onto a new layer.
// Fully on-device; needs the same SD ONNX weights as Generate Image (ships with
// a placeholder → abstract backdrop until real weights are dropped in — see
// MODELS.md). Returns ok:false if those weights are absent.
export async function generateBackgroundML(
  prompt: string, steps: number, onProgress?: MlProgress, ctrl?: GenControls,
): Promise<{ ok: boolean; w: number; h: number; coverage: number }> {
  refusePreview("Generate Background");
  const gen = editStamp();
  const { mask, w, h, comp } = await segMask(onProgress); // mask: 255 = subject
  const bg = await generateRGBA({ prompt, steps, ...ctrl }, onProgress);
  if (!bg.ok) return { ok: false, w: 0, h: 0, coverage: 0 }; // message already surfaced
  onProgress?.("Compositing…");
  const bgFull = resize(bg.rgba, bg.w, bg.h, w, h); // scale the backdrop to the canvas
  const full = matteComposite(comp, bgFull, mask, w, h); // subject over the new backdrop
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0, coverage: 0 }; }
  engine.e.select_none(); // whole-image op — stamp_image clips to any active selection, so clear it first
  store.addLayer();
  engine.e.stamp_image(0, 0, w, h, u8view(full));
  engine.e.mark_ai_generated(); // the backdrop is generated — disclose it
  engine.commit();
  let on = 0;
  for (let i = 0; i < mask.length; i++) if (mask[i] > 127) on++;
  onProgress?.("Done.");
  return { ok: true, w, h, coverage: on / (w * h) };
}

// ── img2img (reference-image conditioning) ─────────────────────
// Restyle the CURRENT composite by a prompt: the whole frame is regenerated on
// the local SD pipeline but anchored to the document's structure (init latent =
// VAE-encoded composite, forward-diffused by `strength`). strength 1 ≈ txt2img,
// low ≈ subtle restyle. Reuses the same SD ONNX weights (incl. vae_encoder) as
// Generate Image; the reference is stretched to the model's native 512². Opens
// the result as a new document (via generateImageFromReference).
export async function generateImageReference(
  prompt: string, steps: number, strength: number, onProgress?: MlProgress, ctrl?: GenControls,
): Promise<{ ok: boolean; w: number; h: number }> {
  refusePreview("Generate Image (reference)");
  const N = 512; // SD-1.5 native (latent 64)
  const { data, w, h } = await composite();
  const ref = resize(data, w, h, N, N);
  return generateImageFromReference(ref, { prompt, steps, strength, ...ctrl }, onProgress);
}

// ── AI Denoise (DRUNet) ────────────────────────────────────────
// A real learned blind Gaussian denoiser (DRUNet, Zhang et al.; BSD-3). The net
// is fully convolutional but memory scales with tile area, so we run the image
// through it in overlapping native-resolution windows (see tiling.ts) and
// feather-blend the results — avoids both wasm OOM on large photos and visible
// tile seams. Result → new layer.
export async function aiDenoise(onProgress?: MlProgress, amount = 1): Promise<{ ok: boolean; w: number; h: number; tiles: number }> {
  const gen = editStamp();
  onProgress?.("Loading AI Denoise model…");
  const s = await bestSession("drunet");
  const { data, w, h } = await composite();
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const { rgba: denoised, tiles } = await tileFilter(data, w, h, async ({ img, tile }) => {
    const out = await s.run({ [inName]: new ort.Tensor("float32", img, [1, 3, tile, tile]) });
    return out[outName].data as Float32Array;
  }, { onTile: (i, n) => onProgress?.(`Denoising tile ${i}/${n}…`) });
  // `amount` (0..1) blends the denoised result back toward the original — 1 =
  // full denoise (default, back-compatible), 0.5 = half strength, 0 = untouched.
  // Lets the user dial back over-smoothing without changing the model.
  const rgba = blendAmount(data, denoised, w, h, amount);
  if (!stampResult(rgba, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, tiles: 0 };
  onProgress?.("Done.");
  return { ok: true, w, h, tiles };
}

/** Blend a filter result back toward the original composite by `amount` (0..1),
 *  optionally weighted per pixel by a 0..255 region mask. */
function blendAmount(
  data: Uint8ClampedArray,
  result: Uint8ClampedArray,
  w: number,
  h: number,
  amount: number,
  mask?: Uint8Array | null,
): Uint8ClampedArray {
  const a = Math.max(0, Math.min(1, amount));
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const m = mask ? (mask[p] / 255) * a : a;
    for (let c = 0; c < 3; c++) rgba[p * 4 + c] = data[p * 4 + c] + (result[p * 4 + c] - data[p * 4 + c]) * m;
    rgba[p * 4 + 3] = 255;
  }
  return rgba;
}

// Isolate the subject onto a new transparent layer (alpha = saliency).
export async function removeBackground(onProgress?: MlProgress): Promise<{ ok: boolean }> {
  refusePreview("Remove Background");
  const gen = editStamp();
  const { mask, w, h, comp } = await segMask(onProgress);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    rgba[i * 4] = comp[i * 4];
    rgba[i * 4 + 1] = comp[i * 4 + 1];
    rgba[i * 4 + 2] = comp[i * 4 + 2];
    rgba[i * 4 + 3] = mask[i];
  }
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false }; }
  engine.e.select_none(); // apply to the whole document
  store.addLayer();
  engine.e.stamp_image(0, 0, w, h, u8view(rgba));
  engine.commit();
  onProgress?.("Done.");
  return { ok: true };
}

// ─────────────────────────────────────────────────────────────
// Tier-2 on-device neural-filter drops (plan 06). Each mirrors the shipped
// sd15/drunet pattern: the WIRING is the deliverable; the weights are user-
// supplied / gitignored (see public/models/MODELS.md) and only RUN once
// installed. Until then `requireModel` throws a clean "not installed" message
// that the toast/runMl layer surfaces — never an unhandled ORT rejection.
// ─────────────────────────────────────────────────────────────

/** Load a model, turning a 404/backend failure into a clear install hint. */
async function requireModel(id: ModelDef["id"], rel: string, human: string): Promise<ort.InferenceSession> {
  const url = await resolveModelUrl(model(id), rel);
  try {
    return await session(url);
  } catch {
    throw new Error(`${human} model not installed — place its weights at ${url} (see public/models/MODELS.md).`);
  }
}

// ── CIE Lab ⇄ sRGB (D65), for colorization's L / ab split ──────
function rgb2lab(r: number, g: number, b: number): [number, number, number] {
  const f = (c: number) => { c /= 255; return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047;
  let y = R * 0.2126 + G * 0.7152 + B * 0.0722;
  let z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const g2 = (t: number) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = g2(x); y = g2(y); z = g2(z);
  return [116 * y - 16, 500 * (x - y), 200 * (y - z)];
}
function lab2rgb(L: number, a: number, b: number): [number, number, number] {
  const fy = (L + 16) / 116, fx = fy + a / 500, fz = fy - b / 200;
  const gi = (t: number) => { const t3 = t ** 3; return t3 > 0.008856 ? t3 : (t - 16 / 116) / 7.787; };
  const x = gi(fx) * 0.95047, y = gi(fy), z = gi(fz) * 1.08883;
  const R = x * 3.2406 - y * 1.5372 - z * 0.4986;
  const G = -x * 0.9689 + y * 1.8758 + z * 0.0415;
  const B = x * 0.0557 - y * 0.204 + z * 1.057;
  const toS = (c: number) => 255 * (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);
  return [toS(R), toS(G), toS(B)];
}

// ── #3 Learned Colorize (DDColor tiny) ─────────────────────────
// DDColor predicts the ab chroma from a grayscale image expressed as RGB.
// Contract (piddnad/DDColor `ColorizationPipeline`): resize to 512², take L,
// feed the neutral-gray RGB `lab2rgb([L,0,0])` as [1,3,512,512] in [0,1]
// (the checkpoint is exported with `do_normalize=False`); the model returns
// ab as [1,2,512,512] in native CIELAB range. We upsample ab and recombine it
// with the FULL-RES L so luminance stays exact. `amount` scales the predicted
// chroma (0 = stay grayscale, 1 = full color) so the dialog slider can fade
// the colorization without touching luminance.
const COLORIZE_SIZE = 512;
export async function colorizeML(onProgress?: MlProgress, amount = 1): Promise<{ ok: boolean; w: number; h: number; model: "colorizer" }> {
  const mix = Math.max(0, Math.min(1, amount));
  const gen = editStamp();
  onProgress?.("Loading colorize model…");
  const s = await requireModel("colorizer", "colorizer.onnx", "Colorize");
  const { data, w, h } = await composite();
  const N = COLORIZE_SIZE, plane = N * N;
  const rd = resize(data, w, h, N, N);
  // Neutral-gray RGB (a=b=0) at each pixel's L, channel-planar (CHW), [0,1].
  const inp = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    const L = rgb2lab(rd[p * 4], rd[p * 4 + 1], rd[p * 4 + 2])[0];
    const gray = lab2rgb(L, 0, 0)[0] / 255; // a=b=0 ⇒ R=G=B
    inp[p] = gray; inp[plane + p] = gray; inp[2 * plane + p] = gray;
  }
  onProgress?.("Colorizing…");
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const out = await s.run({ [inName]: new ort.Tensor("float32", inp, [1, 3, N, N]) });
  const ab = out[outName].data as Float32Array; // [1,2,N,N]
  // Pack ab into an RGBA (offset +128 to survive the u8 resize) then upsample.
  const abSmall = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) {
    abSmall[p * 4] = clamp8(ab[p] + 128);
    abSmall[p * 4 + 1] = clamp8(ab[plane + p] + 128);
    abSmall[p * 4 + 3] = 255;
  }
  const abFull = resize(abSmall, N, N, w, h);
  const rgba = new Uint8ClampedArray(w * h * 4);
  for (let p = 0; p < w * h; p++) {
    const L = rgb2lab(data[p * 4], data[p * 4 + 1], data[p * 4 + 2])[0];
    const [r, g, b] = lab2rgb(L, (abFull[p * 4] - 128) * mix, (abFull[p * 4 + 1] - 128) * mix);
    rgba[p * 4] = clamp8(r); rgba[p * 4 + 1] = clamp8(g); rgba[p * 4 + 2] = clamp8(b); rgba[p * 4 + 3] = 255;
  }
  if (!stampResult(rgba, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, model: "colorizer" };
  onProgress?.("Done.");
  return { ok: true, w, h, model: "colorizer" };
}

// Per-pixel box blur whose window radius comes from a field (depth-of-field).
// ponytail: naive O(n·r²) gather, bounded by maxR; a summed-area table is the
// upgrade if it's ever run on large images with big radii.
function variableBlur(data: Uint8ClampedArray, w: number, h: number, rad: Float32Array, maxR: number): Uint8ClampedArray {
  void maxR;
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x, r = Math.round(rad[p]);
      if (r < 1) {
        out[p * 4] = data[p * 4]; out[p * 4 + 1] = data[p * 4 + 1]; out[p * 4 + 2] = data[p * 4 + 2]; out[p * 4 + 3] = 255;
        continue;
      }
      let R = 0, G = 0, B = 0, n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = y + dy; if (yy < 0 || yy >= h) continue;
        for (let dx = -r; dx <= r; dx++) {
          const xx = x + dx; if (xx < 0 || xx >= w) continue;
          const q = (yy * w + xx) * 4; R += data[q]; G += data[q + 1]; B += data[q + 2]; n++;
        }
      }
      out[p * 4] = R / n; out[p * 4 + 1] = G / n; out[p * 4 + 2] = B / n; out[p * 4 + 3] = 255;
    }
  }
  return out;
}

// ── #2 Depth-aware Depth Blur ──────────────────────────────────
// A monocular-depth net (candidate: MiDaS small) estimates per-pixel depth; the
// blur radius grows with |depth − focal|, so the focal plane stays sharp and
// everything else defocuses — a depth-driven bokeh over the existing blur idea.
const DEPTH_SIZE = 256;
const DEPTH_MAX_RADIUS = 16;
export async function depthBlurML(focal = 0.5, strength = 1, onProgress?: MlProgress): Promise<{ ok: boolean; w: number; h: number; model: "midas" }> {
  const gen = editStamp();
  onProgress?.("Loading depth model…");
  const s = await requireModel("midas", "midas.onnx", "Depth Blur");
  const { data, w, h } = await composite();
  const N = DEPTH_SIZE, plane = N * N;
  const rd = resize(data, w, h, N, N);
  const mean = [0.485, 0.456, 0.406], std = [0.229, 0.224, 0.225];
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = (rd[p * 4] / 255 - mean[0]) / std[0];
    chw[plane + p] = (rd[p * 4 + 1] / 255 - mean[1]) / std[1];
    chw[2 * plane + p] = (rd[p * 4 + 2] / 255 - mean[2]) / std[2];
  }
  onProgress?.("Estimating depth…");
  const inName = s.inputNames[0], outName = s.outputNames[0];
  const out = await s.run({ [inName]: new ort.Tensor("float32", chw, [1, 3, N, N]) });
  const d = out[outName].data as Float32Array; // inverse depth, N×N
  let mn = Infinity, mx = -Infinity;
  for (let i = 0; i < plane; i++) { if (d[i] < mn) mn = d[i]; if (d[i] > mx) mx = d[i]; }
  const rng = mx - mn || 1;
  const dsm = new Uint8ClampedArray(plane * 4);
  for (let i = 0; i < plane; i++) { dsm[i * 4] = clamp8(((d[i] - mn) / rng) * 255); dsm[i * 4 + 3] = 255; }
  const dfull = resize(dsm, N, N, w, h);
  const str = Math.max(0, strength);
  // Blur is a pixel radius, so a downscaled preview has to shrink it by the same
  // factor or the preview shows far more bokeh than the apply will.
  const maxR = DEPTH_MAX_RADIUS * previewScale();
  const rad = new Float32Array(w * h);
  for (let p = 0; p < w * h; p++) rad[p] = Math.min(maxR, Math.abs(dfull[p * 4] / 255 - focal) * str * maxR);
  onProgress?.("Applying depth blur…");
  const rgba = variableBlur(data, w, h, rad, maxR);
  if (!stampResult(rgba, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, model: "midas" };
  onProgress?.("Done.");
  return { ok: true, w, h, model: "midas" };
}

// ── #5 Neural Harmonize ────────────────────────────────────────
// An image-harmonization net (candidate: Harmonizer / PCT-Net) takes the
// composite + a region mask and relights/recolours the region to match the
// backdrop. The region is the current selection (or the whole image if none);
// the harmonized pixels replace the original inside the mask on a new layer.
// `amount` blends the harmonized result back toward the original (0..1).
// Runs at native resolution in overlapping tiles (tiling.ts) — the region mask
// is tiled alongside the image so each window gets its own mask plane.
export async function harmonizeML(onProgress?: MlProgress, amount = 1): Promise<{ ok: boolean; w: number; h: number; model: "harmonizer" }> {
  const gen = editStamp();
  onProgress?.("Loading harmonize model…");
  const s = await requireModel("harmonizer", "harmonizer.onnx", "Harmonize");
  const { data, w, h } = await composite();
  const selMask = selectionMaskAt(w, h);
  const anySel = selMask.some((v) => v >= 128);
  // No selection → the whole image is the region.
  const region = anySel ? selMask : new Uint8Array(w * h).fill(255);
  const { rgba: harmonized } = await tileFilter(data, w, h, async ({ img, mask, tile }) => {
    const feed: Record<string, ort.Tensor> = { [s.inputNames[0]]: new ort.Tensor("float32", img, [1, 3, tile, tile]) };
    if (s.inputNames[1]) feed[s.inputNames[1]] = new ort.Tensor("float32", mask!, [1, 1, tile, tile]);
    const out = await s.run(feed);
    return out[s.outputNames[0]].data as Float32Array; // [1,3,tile,tile]
  }, { mask: region, onTile: (i, n) => onProgress?.(`Harmonizing tile ${i}/${n}…`) });
  // Composite harmonized pixels only inside the region; keep the rest original.
  const rgba = blendAmount(data, harmonized, w, h, amount, region);
  if (!stampResult(rgba, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, model: "harmonizer" };
  onProgress?.("Done.");
  return { ok: true, w, h, model: "harmonizer" };
}

// ── #6 Neural Photo Restoration / JPEG-artifact removal ─────────
// A learned restorer (candidate: FBCNN for JPEG artifacts) cleans the composite.
// Runs at native resolution in overlapping tiles (tiling.ts): squashing the whole
// photo to 256² and blowing the result back up destroyed more detail than the
// JPEG artifacts it removed.
// `amount` blends the restored result back toward the original (0..1).
export async function restoreML(onProgress?: MlProgress, amount = 1): Promise<{ ok: boolean; w: number; h: number; model: "fbcnn" }> {
  const gen = editStamp();
  onProgress?.("Loading restoration model…");
  const s = await requireModel("fbcnn", "fbcnn.onnx", "Photo Restoration");
  const { data, w, h } = await composite();
  const { rgba: restored } = await tileFilter(data, w, h, async ({ img, tile }) => {
    const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", img, [1, 3, tile, tile]) });
    return out[s.outputNames[0]].data as Float32Array;
  }, { onTile: (i, n) => onProgress?.(`Restoring tile ${i}/${n}…`) });
  const rgba = blendAmount(data, restored, w, h, amount);
  if (!stampResult(rgba, w, h, gen, onProgress)) return { ok: false, w: 0, h: 0, model: "fbcnn" };
  onProgress?.("Done.");
  return { ok: true, w, h, model: "fbcnn" };
}

// ── #7 Image-based Match Font ──────────────────────────────────
// gaborcselle/font-identifier: a microsoft/resnet-18 fine-tuned on 49 fonts.
// Classifies a text raster into a font and returns a ranked family list; does
// not mutate the document (the caller lists candidates). The model's own
// preprocessor (config: do_convert_rgb + do_normalize) dictates the contract:
// [1,3,224,224] RGB, ImageNet-normalized. Labels are the checkpoint's id2label
// in index order; `cleanFontName` strips the "-Regular" convention for display.
const FONT_CLASSES = [
  "Agbalumo-Regular", "AlfaSlabOne-Regular", "ArchitectsDaughter-Regular", "Arial",
  "Arial Black", "Arial Bold", "Arial Bold Italic", "Avenir", "Bangers-Regular",
  "BlackOpsOne-Regular", "Courier", "Georgia", "Helvetica", "IBMPlexSans-Regular",
  "Inter-Regular", "KaushanScript-Regular", "Lato-Regular", "Lobster-Regular",
  "Lora-Regular", "Merriweather-Regular", "Niconne-Regular", "OpenSans-Bold",
  "OpenSans-Italic", "OpenSans-Light", "Pacifico-Regular", "PixelifySans-Regular",
  "PlayfairDisplay-Regular", "Poppins-Regular", "Rakkas-Regular", "Roboto-Regular",
  "RobotoMono-Regular", "RobotoSlab-Regular", "Rubik-Regular", "SpaceMono-Regular",
  "Tahoma", "Tahoma Bold", "Times New Roman", "Times New Roman Bold",
  "Times New Roman Bold Italic", "Times New Roman Italic", "TitilliumWeb-Regular",
  "Trebuchet MS", "Trebuchet MS Bold", "Trebuchet MS Bold Italic",
  "Trebuchet MS Italic", "Verdana", "Verdana Bold", "Verdana Bold Italic",
  "Verdana Italic",
] as const;
const FONT_SIZE = 224;
const FONT_MEAN = [0.485, 0.456, 0.406];
const FONT_STD = [0.229, 0.224, 0.225];
function cleanFontName(label: string): string {
  return label.replace(/-Regular$/, "").replace(/-/g, " ");
}
export async function matchFontML(onProgress?: MlProgress): Promise<{ ok: boolean; ranking: string[]; model: "font-classifier" }> {
  onProgress?.("Loading font model…");
  const s = await requireModel("font-classifier", "font_classifier.onnx", "Match Font");
  const { data, w, h } = await composite();
  const N = FONT_SIZE, plane = N * N;
  const rd = resize(data, w, h, N, N);
  // RGB planar, ImageNet-normalized (the model's preprocessor: convert-to-RGB + normalize).
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++)
    for (let c = 0; c < 3; c++) chw[c * plane + p] = (rd[p * 4 + c] / 255 - FONT_MEAN[c]) / FONT_STD[c];
  onProgress?.("Recognizing font…");
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, N, N]) });
  const logits = out[s.outputNames[0]].data as Float32Array;
  const ranking = [...logits.keys()]
    .sort((a, b) => logits[b] - logits[a])
    .slice(0, 5)
    .map((i) => cleanFontName(FONT_CLASSES[i]));
  onProgress?.("Done.");
  return { ok: true, ranking, model: "font-classifier" };
}

// ── #4 Face-Aware Liquify ──────────────────────────────────────
// A 68-point face-landmark model (candidate: a face-alignment export) locates
// every feature anchor (jaw 0-16, brows 17-26, nose 27-35, eyes 36-47, lips
// 48-67); the full Photoshop control set drives parametric Liquify warps at
// those points through the existing engine liquify mesh. A model emitting
// several 68-point blocks ([F,136]) is treated as multi-face: `faceIndex`
// picks the target, and `detectFaceLandmarksML` exposes every face so the UI
// can offer a face picker and on-canvas feature handles.
const FACE_SIZE = 192;
const FACE_LM = 68;

/** Photoshop-parity Face-Aware Liquify controls; each is −1..1, 0 = no change. */
export type FaceLiquifyParams = {
  faceIndex?: number;
  // Eyes — linked left/right. ponytail: Photoshop's per-eye unlink toggle is a
  // UI concern; split each into [left, right] tuples when the dialog grows it.
  eyeSize?: number; eyeHeight?: number; eyeWidth?: number; eyeTilt?: number; eyeDistance?: number;
  // Nose
  noseHeight?: number; noseWidth?: number;
  // Mouth
  smile?: number; upperLip?: number; lowerLip?: number; mouthWidth?: number; mouthHeight?: number;
  // Face shape
  forehead?: number; chinHeight?: number; jawline?: number; faceWidth?: number;
};

// Shared landmark pass: composite → model → per-face document-pixel points.
async function faceLandmarks(onProgress?: MlProgress): Promise<{ gen: string; faces: [number, number][][]; w: number; h: number }> {
  const gen = editStamp();
  onProgress?.("Loading face model…");
  const s = await requireModel("face-landmarks", "face_landmarks.onnx", "Face-Aware Liquify");
  const { data, w, h } = await composite();
  const N = FACE_SIZE, plane = N * N;
  const rd = resize(data, w, h, N, N);
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) { chw[p] = rd[p * 4] / 255; chw[plane + p] = rd[p * 4 + 1] / 255; chw[2 * plane + p] = rd[p * 4 + 2] / 255; }
  onProgress?.("Detecting face…");
  const out = await s.run({ [s.inputNames[0]]: new ort.Tensor("float32", chw, [1, 3, N, N]) });
  const lm = out[s.outputNames[0]].data as Float32Array; // normalized [x,y] × 68 per face
  const count = Math.floor(lm.length / (FACE_LM * 2));
  if (count < 1) throw new Error("Face-Aware Liquify needs a 68-point landmark model.");
  const faces: [number, number][][] = [];
  for (let f = 0; f < count; f++) {
    const base = f * FACE_LM * 2;
    faces.push(Array.from({ length: FACE_LM }, (_, i): [number, number] => [lm[base + i * 2] * w, lm[base + i * 2 + 1] * h]));
  }
  return { gen, faces, w, h };
}

/** Every detected face's 68 landmarks in document pixels — feeds the UI's face picker and on-canvas handles. */
export async function detectFaceLandmarksML(onProgress?: MlProgress): Promise<{ ok: boolean; faces: [number, number][][]; w: number; h: number; model: "face-landmarks" }> {
  const { faces, w, h } = await faceLandmarks(onProgress);
  onProgress?.("Done.");
  return { ok: true, faces, w, h, model: "face-landmarks" };
}

export async function faceAwareLiquifyML(params?: FaceLiquifyParams, onProgress?: MlProgress): Promise<{ ok: boolean; dabs: number; faces: number; model: "face-landmarks" }>;
export async function faceAwareLiquifyML(eyes?: number, smile?: number, width?: number, onProgress?: MlProgress): Promise<{ ok: boolean; dabs: number; faces: number; model: "face-landmarks" }>;
export async function faceAwareLiquifyML(
  a: FaceLiquifyParams | number = {},
  b?: number | MlProgress,
  width = 0,
  d?: MlProgress,
): Promise<{ ok: boolean; dabs: number; faces: number; model: "face-landmarks" }> {
  // Legacy 3-slider call (eyes, smile, width) maps onto the full control set.
  refusePreview("Face-Aware Liquify");
  const legacy = typeof a === "number";
  const p: FaceLiquifyParams = legacy ? { eyeSize: a, smile: (b as number) ?? 0, faceWidth: width } : a;
  const onProgress = legacy ? d : (b as MlProgress | undefined);
  const { gen, faces, w } = await faceLandmarks(onProgress);
  if (docChanged(gen)) { onProgress?.("Cancelled — document changed."); return { ok: false, dabs: 0, faces: faces.length, model: "face-landmarks" }; }
  const P = faces[Math.max(0, Math.min(p.faceIndex ?? 0, faces.length - 1))];
  const centroid = (a0: number, b0: number): [number, number] => {
    let x = 0, y = 0; for (let i = a0; i <= b0; i++) { x += P[i][0]; y += P[i][1]; }
    const n = b0 - a0 + 1; return [x / n, y / n];
  };
  onProgress?.("Shaping face…");
  if (!engine.e.liquify_begin()) {
    // Name the refusal (e.g. 32-bit) here and drain it, or the next unrelated commit fails with it.
    const refusal = engine.e.last_edit_error();
    engine.e.clear_last_edit_error();
    throw new Error(refusal || "Could not start Liquify.");
  }
  const r = Math.max(8, w * 0.04);
  let dabs = 0;
  const dab = (cx: number, cy: number, mode: number, strength: number, gx = 0, gy = 0) => {
    engine.e.liquify_dab(cx, cy, r, 0.5, mode, strength, gx, gy); dabs++;
  };
  // Each control: strength = |slider| clamped to 1, dir = its sign. In the
  // iBUG 68-point layout the "left" features (jaw 0-7, eye 36-41) sit at
  // image-left, so "outward" there is −x; screen y grows downward.
  const apply = (v: number | undefined, fn: (st: number, dir: number) => void) => {
    if (v) fn(Math.min(1, Math.abs(v)), v > 0 ? 1 : -1);
  };
  const eyes: [number, number][] = [centroid(36, 41), centroid(42, 47)];
  // Eyes
  apply(p.eyeSize, (st, dir) => { for (const [ex, ey] of eyes) dab(ex, ey, dir > 0 ? 1 : 2, st); }); // Bloat / Pucker
  apply(p.eyeHeight, (st, dir) => {
    for (const [ex, ey] of eyes) { dab(ex, ey - r * 0.4, 0, st, 0, -dir * r * 0.5); dab(ex, ey + r * 0.4, 0, st, 0, dir * r * 0.5); }
  });
  apply(p.eyeWidth, (st, dir) => {
    // Outer corners 36/45 move outward, inner corners 39/42 toward the nose.
    dab(P[36][0], P[36][1], 0, st, -dir * r * 0.5, 0); dab(P[39][0], P[39][1], 0, st, dir * r * 0.5, 0);
    dab(P[42][0], P[42][1], 0, st, -dir * r * 0.5, 0); dab(P[45][0], P[45][1], 0, st, dir * r * 0.5, 0);
  });
  apply(p.eyeTilt, (st, dir) => {
    // Positive raises the outer corners: mirrored twirls (mode 4 lifts the
    // left flank, mode 3 the right — screen coords, y down).
    dab(eyes[0][0], eyes[0][1], dir > 0 ? 4 : 3, st);
    dab(eyes[1][0], eyes[1][1], dir > 0 ? 3 : 4, st);
  });
  apply(p.eyeDistance, (st, dir) => {
    dab(eyes[0][0], eyes[0][1], 0, st, -dir * r * 0.6, 0); dab(eyes[1][0], eyes[1][1], 0, st, dir * r * 0.6, 0);
  });
  // Nose
  apply(p.noseHeight, (st, dir) => dab(P[33][0], P[33][1], 0, st, 0, dir * r * 0.5)); // + = longer (down)
  apply(p.noseWidth, (st, dir) => { dab(P[31][0], P[31][1], 0, st, -dir * r * 0.4, 0); dab(P[35][0], P[35][1], 0, st, dir * r * 0.4, 0); });
  // Mouth
  apply(p.smile, (st, dir) => { // corners up-and-out when smiling
    dab(P[48][0], P[48][1], 0, st, -r * 0.5, -dir * r * 0.5); dab(P[54][0], P[54][1], 0, st, r * 0.5, -dir * r * 0.5);
  });
  apply(p.upperLip, (st, dir) => dab(P[51][0], P[51][1], 0, st, 0, -dir * r * 0.35)); // + = fuller (up)
  apply(p.lowerLip, (st, dir) => dab(P[57][0], P[57][1], 0, st, 0, dir * r * 0.35)); // + = fuller (down)
  apply(p.mouthWidth, (st, dir) => { dab(P[48][0], P[48][1], 0, st, -dir * r * 0.5, 0); dab(P[54][0], P[54][1], 0, st, dir * r * 0.5, 0); });
  apply(p.mouthHeight, (st, dir) => { dab(P[51][0], P[51][1], 0, st, 0, -dir * r * 0.35); dab(P[57][0], P[57][1], 0, st, 0, dir * r * 0.35); });
  // Face shape
  apply(p.forehead, (st, dir) => { const [bx, by] = centroid(17, 26); dab(bx, by - r, 0, st, 0, -dir * r * 0.6); }); // + = taller
  apply(p.chinHeight, (st, dir) => dab(P[8][0], P[8][1], 0, st, 0, dir * r * 0.6)); // + = longer chin
  apply(p.jawline, (st, dir) => { dab(P[4][0], P[4][1], 0, st, -dir * r * 0.8, 0); dab(P[12][0], P[12][1], 0, st, dir * r * 0.8, 0); });
  apply(p.faceWidth, (st, dir) => { dab(P[2][0], P[2][1], 0, st, -dir * r, 0); dab(P[14][0], P[14][1], 0, st, dir * r, 0); });
  engine.e.liquify_end();
  engine.commit();
  onProgress?.("Done.");
  return { ok: true, dabs, faces: faces.length, model: "face-landmarks" };
}
