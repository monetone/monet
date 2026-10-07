// ─────────────────────────────────────────────────────────────
// diffusion.ts — local, on-device text-to-image (Stable Diffusion)
// via onnxruntime-web. A real CLIP tokenizer + text-encoder → CFG UNet
// DDIM denoise loop → VAE decode pipeline. Nothing is sent to a server;
// the ONNX models load from /models/sd (or a user-supplied local folder).
//
// Ships wired to a tiny placeholder model so the feature runs out of the
// box (abstract output). Drop real Stable-Diffusion-1.5 / SDXL-Turbo ONNX
// weights into /models/sd — same component layout + I/O contract — for
// photographic generation. See public/models/MODELS.md.
// ─────────────────────────────────────────────────────────────
import * as ort from "onnxruntime-web";
import { engine, store } from "../state/app";
import type { MlProgress } from "./onnx";
import { resolveSdBase, webgpuAvailable } from "./modelSource";
import { similarOpts } from "./genMeta";
import { throwIfCancelled } from "./mlJob";
import { createSession } from "./ortEnv";

const WEBGPU_GATE_MSG =
  "Real SD-1.5 needs WebGPU, which isn't available in this browser/webview. A separately installed local demo or MI-GAN model may still work; see Filter ▸ Neural Filters ▸ Manage AI Models.";

// Resolve the SD base, but gate the real weight set behind WebGPU: the ~2.2 GB
// fp16 models don't fit wasm32's 4 GB heap, so without a GPU adapter ort-web
// would fall back to wasm and OOM. An explicit opts.modelBase opts out (tests /
// user-supplied folders take responsibility for their own weights).
async function sdBaseOrGate(modelBase: string | undefined): Promise<{ base: string } | { gated: string }> {
  if (modelBase) return { base: modelBase };
  const r = await resolveSdBase();
  if (r.kind === "real" && !(await webgpuAvailable())) return { gated: WEBGPU_GATE_MSG };
  return { base: r.base };
}

const _sessions = new Map<string, Promise<ort.InferenceSession>>();
function session(url: string): Promise<ort.InferenceSession> {
  let s = _sessions.get(url);
  if (!s) {
    // WebGPU when available (diffusion is heavy), wasm fallback everywhere else.
    // createSession keeps wasm inference on ORT's proxy worker so a 50-step
    // generation doesn't freeze the canvas (see ortEnv.ts).
    const created = createSession(url, { executionProviders: ["webgpu", "wasm"], graphOptimizationLevel: "all" });
    created.catch(() => { if (_sessions.get(url) === created) _sessions.delete(url); });
    s = created;
    _sessions.set(url, created);
  }
  return s;
}

// The diffusion timestep is a scalar integer, but different SD ONNX exports
// declare its input as int64 (the tiny demo) or float32 (the real
// optimum/onnx-community SD-1.5). Feed whichever the loaded UNet expects — the
// value is identical either way.
function timestepTensor(unet: ort.InferenceSession, t: number): ort.Tensor {
  const meta = unet.inputMetadata?.find((m) => m.name === "timestep");
  return meta?.isTensor && meta.type === "int64"
    ? new ort.Tensor("int64", BigInt64Array.from([BigInt(t)]), [1])
    : new ort.Tensor("float32", Float32Array.from([t]), [1]);
}

// The DDIM timestep schedule, 999 → 0 over `steps` denoise steps. steps=1 is a
// permitted input (every clamp floors at 1 and MCP forwards 1..50), and the
// (steps−1) denominator turned it into 0/0 = NaN — an all-NaN latent decoded to a
// solid-black document, or BigInt(NaN) throwing on an int64-timestep UNet. One
// step samples once at the noisiest timestep instead. (#22)
export function timestepSchedule(steps: number): number[] {
  if (steps <= 1) return [999];
  return Array.from({ length: steps }, (_, i) => Math.round((999 * (steps - 1 - i)) / (steps - 1)));
}

// ── CLIP byte-level BPE tokenizer ──────────────────────────────
function bytesToUnicode(): Record<number, string> {
  const bs: number[] = [];
  for (let i = 33; i <= 126; i++) bs.push(i);
  for (let i = 161; i <= 172; i++) bs.push(i);
  for (let i = 174; i <= 255; i++) bs.push(i);
  const cs = bs.slice();
  let n = 0;
  for (let b = 0; b < 256; b++) if (!bs.includes(b)) { bs.push(b); cs.push(256 + n++); }
  const map: Record<number, string> = {};
  bs.forEach((b, i) => (map[b] = String.fromCharCode(cs[i])));
  return map;
}

type Tokenize = (text: string, maxLen?: number) => number[];
const _tokenizers = new Map<string, Promise<Tokenize>>();
function tokenizer(base: string): Promise<Tokenize> {
  const cached = _tokenizers.get(base);
  if (cached) return cached;
  const created = (async () => {
    const [vocabRes, mergesRes] = await Promise.all([
      fetch(`${base}/tokenizer/vocab.json`),
      fetch(`${base}/tokenizer/merges.txt`),
    ]);
    if (!vocabRes.ok || !mergesRes.ok) throw new Error("tokenizer files not found");
    const vocab: Record<string, number> = await vocabRes.json();
    const merges = (await mergesRes.text()).split("\n").slice(1).filter(Boolean);
    const ranks: Record<string, number> = {};
    merges.forEach((m, i) => (ranks[m] = i));
    const byteEnc = bytesToUnicode();
    const bos = vocab["<|startoftext|>"] ?? 49406;
    const eos = vocab["<|endoftext|>"] ?? 49407;
    const pat = /<\|startoftext\|>|<\|endoftext\|>|'s|'t|'re|'ve|'m|'ll|'d|[\p{L}]+|[\p{N}]|[^\s\p{L}\p{N}]+/giu;
    const cache: Record<string, string[]> = {};
    const bpe = (token: string): string[] => {
      if (cache[token]) return cache[token];
      let word = token.split("");
      word[word.length - 1] += "</w>";
      const pairs = () => { const s = new Set<string>(); for (let i = 0; i < word.length - 1; i++) s.add(`${word[i]} ${word[i + 1]}`); return s; };
      let ps = pairs();
      while (ps.size) {
        let best: string | null = null, bestRank = Infinity;
        for (const p of ps) { const r = ranks[p]; if (r !== undefined && r < bestRank) { bestRank = r; best = p; } }
        if (best === null) break;
        const [a, b] = best.split(" ");
        const nw: string[] = []; let i = 0;
        while (i < word.length) {
          if (word[i] === a && i < word.length - 1 && word[i + 1] === b) { nw.push(a + b); i += 2; }
          else { nw.push(word[i]); i += 1; }
        }
        word = nw;
        if (word.length === 1) break;
        ps = pairs();
      }
      cache[token] = word;
      return word;
    };
    const utf8 = new TextEncoder();
    return (text: string, maxLen = 77): number[] => {
      const ids = [bos];
      const clean = text.toLowerCase().trim().replace(/\s+/g, " ");
      for (const m of clean.matchAll(pat)) {
        // CLIP is byte-level BPE: map each UTF-8 BYTE through the byte table, not
        // each code point. Code points above U+00FF had no byteEnc entry, fell
        // through raw, missed the vocab and were silently dropped (a CJK/emoji
        // prompt tokenized to just BOS/EOS); U+00A1..U+00FF ('é', 'ü') were sent
        // as one byte instead of their two UTF-8 bytes. All 256 byte tokens exist
        // in the vocab, so every character is now representable. (#23)
        const piece = Array.from(utf8.encode(m[0]), (b) => byteEnc[b]).join("");
        for (const t of bpe(piece)) if (vocab[t] !== undefined) ids.push(vocab[t]);
      }
      ids.push(eos);
      const out = ids.slice(0, maxLen);
      while (out.length < maxLen) out.push(eos);
      return out;
    };
  })();
  created.catch(() => { if (_tokenizers.get(base) === created) _tokenizers.delete(base); });
  _tokenizers.set(base, created);
  return created;
}

// ── DDIM scheduler (epsilon prediction, scaled_linear betas) ───
function alphasCumprod(numTrain = 1000, betaStart = 0.00085, betaEnd = 0.012): Float64Array {
  const a = new Float64Array(numTrain);
  let acc = 1;
  const sa = Math.sqrt(betaStart), sb = Math.sqrt(betaEnd);
  for (let i = 0; i < numTrain; i++) {
    const beta = Math.pow(sa + (sb - sa) * (i / (numTrain - 1)), 2);
    acc *= 1 - beta;
    a[i] = acc;
  }
  return a;
}

// Deterministic seeded Gaussian (mulberry-style LCG + Box–Muller) so a seed
// reproduces an image without depending on Math.random.
function seededGauss(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  return () => { let u = 0, v = 0; while (!u) u = rnd(); while (!v) v = rnd(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
}

export interface GenerateOpts {
  prompt: string;
  negativePrompt?: string;
  steps?: number;
  guidance?: number;
  seed?: number;
  /** Latent side (image = latent × VAE factor). 64 → 512px on SD-1.5. */
  latent?: number;
  modelBase?: string;
  /** img2img denoise strength 0..1: how far the reference is noised before the
   *  denoise tail runs. 1 ≈ ignore the reference (txt2img), low ≈ keep its
   *  structure. Only consulted by the reference-image path. */
  strength?: number;
  /** See GenControls.outputSize. */
  outputSize?: number;
}

/** Post-generation upscale: double the just-opened document with the engine's
 *  super-resolution until the target long side is reached (≤2 passes — e.g.
 *  512 → 1024 → 2048). Bounded claim: SR-upscaled generation, not native-res
 *  diffusion — the pipeline is dim-agnostic, so larger SD variants get native
 *  size with no code change. */
async function upscaleToTarget(target: number | undefined, produced: number, onProgress?: MlProgress): Promise<void> {
  if (!target) return;
  let size = produced;
  for (let pass = 0; pass < 2 && size * 2 <= target; pass++) {
    if (!engine.e.can_super_resolution()) break;
    onProgress?.(`Upscaling ${size} → ${size * 2}…`);
    if (!engine.e.super_resolution()) break;
    engine.commit();
    size *= 2;
  }
}

/**
 * The prompt-independent diffusion knobs the UI exposes (negative prompt, CFG
 * guidance, seed) — shared by every generative entry point (Generate Image,
 * Generate Background, prompt-driven Fill) so they thread identically. The
 * generateRGBA/generateInpaintRGBA backends already consume all three.
 */
export interface GenControls {
  negativePrompt?: string;
  guidance?: number;
  seed?: number;
  /** Target long side for the opened document; above the native render it is
   *  reached with engine super-resolution passes (2× each, ≤2 passes). */
  outputSize?: number;
}

const clamp8 = (v: number) => (v < 0 ? 0 : v > 255 ? 255 : v);
async function rgbaToPng(data: Uint8ClampedArray, w: number, h: number): Promise<Uint8Array> {
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  const cx = c.getContext("2d")!;
  const id = cx.createImageData(w, h); id.data.set(data); cx.putImageData(id, 0, 0);
  const blob = await new Promise<Blob | null>((resolve) => c.toBlob(resolve, "image/png"));
  if (!blob) throw new Error(`PNG encode failed (${w}×${h})`);
  return new Uint8Array(await blob.arrayBuffer());
}

/**
 * Run the diffusion pipeline and return straight RGBA8 pixels — no document side
 * effects. Returns ok:false (with a surfaced message) if the models/tokenizer are
 * missing. Shared by Generate Image (→ new document) and Generate Background
 * (→ composited behind the subject).
 */
export async function generateRGBA(opts: GenerateOpts, onProgress?: MlProgress): Promise<{ ok: boolean; rgba: Uint8ClampedArray; w: number; h: number }> {
  const gate = await sdBaseOrGate(opts.modelBase);
  if ("gated" in gate) { onProgress?.(gate.gated); return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 }; }
  const base = gate.base;
  const steps = Math.max(1, Math.min(50, opts.steps ?? 20));
  const guidance = opts.guidance ?? 7.5;
  const S = opts.latent ?? 64, C = 4;

  onProgress?.("Loading models…");
  let tok: Tokenize, te: ort.InferenceSession, unet: ort.InferenceSession, vae: ort.InferenceSession;
  try {
    [tok, te, unet, vae] = await Promise.all([
      tokenizer(base),
      session(`${base}/text_encoder/model.onnx`),
      session(`${base}/unet/model.onnx`),
      session(`${base}/vae_decoder/model.onnx`),
    ]);
  } catch {
    onProgress?.(`No Stable Diffusion models at ${base}. See public/models/MODELS.md to install local ONNX weights.`);
    return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 };
  }

  onProgress?.("Encoding prompt…");
  const encode = async (text: string) => {
    const ids = tok(text);
    const r = await te.run({ input_ids: new ort.Tensor("int32", Int32Array.from(ids), [1, ids.length]) });
    return r.last_hidden_state;
  };
  const cond = await encode(opts.prompt);
  const uncond = await encode(opts.negativePrompt ?? "");
  const [, seq, dim] = cond.dims as number[];
  const hidden = new Float32Array(2 * seq * dim);
  hidden.set(uncond.data as Float32Array, 0);
  hidden.set(cond.data as Float32Array, seq * dim);
  // ORT's proxy worker TRANSFERS every input buffer to the worker, so a tensor
  // reused across denoise steps is detached after the first run. Hand each step
  // its own copy of the (constant) text embedding.
  const hiddenT = () => new ort.Tensor("float32", hidden.slice(), [2, seq, dim]);

  const alphas = alphasCumprod();
  const timesteps = timestepSchedule(steps);
  const g = seededGauss(opts.seed ?? 42);
  let latent = new Float32Array(C * S * S);
  for (let i = 0; i < latent.length; i++) latent[i] = g();
  const n = C * S * S;

  for (let si = 0; si < timesteps.length; si++) {
    throwIfCancelled();
    onProgress?.(`Diffusing… step ${si + 1}/${steps}`);
    const t = timesteps[si];
    const tPrev = si + 1 < timesteps.length ? timesteps[si + 1] : 0;
    const sample = new Float32Array(2 * n);
    sample.set(latent, 0); sample.set(latent, n);
    const out = await unet.run({
      sample: new ort.Tensor("float32", sample, [2, C, S, S]),
      timestep: timestepTensor(unet, t),
      encoder_hidden_states: hiddenT(),
    });
    const noise = out.out_sample.data as Float32Array;
    const aT = alphas[t], aPrev = tPrev > 0 ? alphas[tPrev] : 1;
    const sqrtAT = Math.sqrt(aT), sqrt1AT = Math.sqrt(1 - aT), sqrtAPrev = Math.sqrt(aPrev), sqrt1APrev = Math.sqrt(1 - aPrev);
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const eps = noise[i] + guidance * (noise[n + i] - noise[i]); // classifier-free guidance
      const x0 = (latent[i] - sqrt1AT * eps) / sqrtAT;
      next[i] = sqrtAPrev * x0 + sqrt1APrev * eps;
    }
    latent = next;
  }

  onProgress?.("Decoding image…");
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = latent[i] / 0.18215;
  const dec = await vae.run({ latent_sample: new ort.Tensor("float32", scaled, [1, C, S, S]) });
  const img = dec.sample.data as Float32Array;
  const [, , H, W] = dec.sample.dims as number[];
  const plane = H * W;
  const rgba = new Uint8ClampedArray(plane * 4);
  for (let p = 0; p < plane; p++) {
    rgba[p * 4] = clamp8(((img[p] + 1) / 2) * 255);
    rgba[p * 4 + 1] = clamp8(((img[plane + p] + 1) / 2) * 255);
    rgba[p * 4 + 2] = clamp8(((img[2 * plane + p] + 1) / 2) * 255);
    rgba[p * 4 + 3] = 255;
  }
  return { ok: true, rgba, w: W, h: H };
}

/**
 * Generate an image from a text prompt entirely on-device and open it as a new
 * document. Returns ok:false (without opening) if the document was swapped mid-run
 * or the models/tokenizer are missing.
 */
export async function generateImage(opts: GenerateOpts, onProgress?: MlProgress): Promise<{ ok: boolean; w: number; h: number }> {
  const gen = engine.docGen;
  const r = await generateRGBA(opts, onProgress);
  if (!r.ok) return { ok: false, w: 0, h: 0 };
  if (engine.docGen !== gen) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0 }; }
  const png = await rgbaToPng(r.rgba, r.w, r.h);
  store.openImage(png, `Generated ${r.w}×${r.h}`);
  store.stampGenMeta(opts); // lets "Generate Similar" re-roll this document
  await upscaleToTarget(opts.outputSize, Math.max(r.w, r.h), onProgress);
  onProgress?.("Done.");
  return { ok: true, w: r.w, h: r.h };
}

/**
 * "Generate Similar" (Photoshop's variation re-roll on generated content):
 * regenerate the active document's image from its stamped settings with a
 * fresh seed. No-ops with a message on documents that weren't generated.
 */
export async function generateSimilar(onProgress?: MlProgress): Promise<{ ok: boolean; w: number; h: number }> {
  const o = similarOpts(store.activeGenMeta());
  if (!o) {
    onProgress?.("No generation settings on this document — use Generate Image first.");
    return { ok: false, w: 0, h: 0 };
  }
  return generateImage(o, onProgress);
}

// ─────────────────────────────────────────────────────────────
// Prompt-driven Generative Fill (blended latent diffusion / RePaint)
//
// Photoshop's Generative Fill conditions the fill on a TEXT PROMPT; MI-GAN
// (generativeFillML) can only hallucinate from surrounding pixels. This closes
// that gap by reusing the SAME txt2img UNet + VAE as Generate Image — no new base
// model. VAE-encode the masked context, then at every DDIM step keep the known
// region pinned to the (forward-diffused) original and let the network generate
// only the hole, steered by the prompt (CFG) and the surrounding latents. Needs a
// vae_encoder (present in standard SD-1.5 ONNX exports) on top of the Generate-
// Image weights; returns ok:false so the caller can fall back to MI-GAN.
// ─────────────────────────────────────────────────────────────

/** Average-pool a px×px hole mask (255 = generate here) down to S×S latent resolution, in [0,1]. */
export function downsampleMaskToLatent(hole: Uint8Array, px: number, S: number): Float32Array {
  const out = new Float32Array(S * S);
  const scale = px / S; // integer for SD (px = 8·S), but tolerate non-integer
  for (let ly = 0; ly < S; ly++) {
    for (let lx = 0; lx < S; lx++) {
      const x0 = Math.floor(lx * scale), x1 = Math.max(x0 + 1, Math.floor((lx + 1) * scale));
      const y0 = Math.floor(ly * scale), y1 = Math.max(y0 + 1, Math.floor((ly + 1) * scale));
      let acc = 0, cnt = 0;
      for (let y = y0; y < y1 && y < px; y++) for (let x = x0; x < x1 && x < px; x++) { acc += hole[y * px + x]; cnt++; }
      out[ly * S + lx] = cnt ? acc / (cnt * 255) : 0;
    }
  }
  return out;
}

/**
 * Blend one denoise step: the hole (maskLatent≈1) keeps the freshly generated
 * latent; the known region (maskLatent≈0) is pinned to the original latent
 * forward-diffused to this step. maskLatent is S×S, broadcast over C channels.
 */
export function blendLatent(
  gen: Float32Array, x0: Float32Array, noise: Float32Array, maskLatent: Float32Array,
  C: number, S: number, sqrtAPrev: number, sqrt1APrev: number,
): Float32Array {
  const plane = S * S;
  const out = new Float32Array(C * plane);
  for (let c = 0; c < C; c++) {
    for (let i = 0; i < plane; i++) {
      const idx = c * plane + i;
      const known = sqrtAPrev * x0[idx] + sqrt1APrev * noise[idx];
      const m = maskLatent[i];
      out[idx] = m * gen[idx] + (1 - m) * known;
    }
  }
  return out;
}

/**
 * Inpaint a square RGBA image at the model's native size (px = 8·latent). `hole`
 * (px·px, 255 = generate / 0 = keep) marks the region to fill from the prompt.
 * Returns straight RGBA8 with the known region ≈ original and the hole generated.
 * ok:false (message surfaced) if the SD models, tokenizer, or a vae_encoder are
 * missing — the caller then falls back to MI-GAN.
 */
export async function generateInpaintRGBA(
  image: Uint8ClampedArray, hole: Uint8Array, opts: GenerateOpts, onProgress?: MlProgress,
): Promise<{ ok: boolean; rgba: Uint8ClampedArray; w: number; h: number }> {
  const gate = await sdBaseOrGate(opts.modelBase);
  if ("gated" in gate) { onProgress?.(gate.gated); return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 }; }
  const base = gate.base;
  const steps = Math.max(1, Math.min(50, opts.steps ?? 20));
  const guidance = opts.guidance ?? 7.5;
  const px = Math.round(Math.sqrt(image.length / 4));
  const S = Math.max(1, Math.round(px / 8)), C = 4, n = C * S * S;

  onProgress?.("Loading models…");
  let tok: Tokenize, te: ort.InferenceSession, unet: ort.InferenceSession, vae: ort.InferenceSession, enc: ort.InferenceSession;
  try {
    [tok, te, unet, vae, enc] = await Promise.all([
      tokenizer(base),
      session(`${base}/text_encoder/model.onnx`),
      session(`${base}/unet/model.onnx`),
      session(`${base}/vae_decoder/model.onnx`),
      session(`${base}/vae_encoder/model.onnx`),
    ]);
  } catch {
    onProgress?.(`No Stable Diffusion inpaint models at ${base} (needs a vae_encoder). See public/models/MODELS.md.`);
    return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 };
  }

  onProgress?.("Encoding prompt…");
  const encodeText = async (text: string) => {
    const ids = tok(text);
    const r = await te.run({ input_ids: new ort.Tensor("int32", Int32Array.from(ids), [1, ids.length]) });
    return r.last_hidden_state;
  };
  const cond = await encodeText(opts.prompt);
  const uncond = await encodeText(opts.negativePrompt ?? "");
  const [, seq, dim] = cond.dims as number[];
  const hidden = new Float32Array(2 * seq * dim);
  hidden.set(uncond.data as Float32Array, 0);
  hidden.set(cond.data as Float32Array, seq * dim);
  // ORT's proxy worker TRANSFERS every input buffer to the worker, so a tensor
  // reused across denoise steps is detached after the first run. Hand each step
  // its own copy of the (constant) text embedding.
  const hiddenT = () => new ort.Tensor("float32", hidden.slice(), [2, seq, dim]);

  // VAE-encode the context image → x0 latent (SD pixel convention: 2·x−1).
  onProgress?.("Encoding image…");
  const plane = px * px;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = (image[p * 4] / 255) * 2 - 1;
    chw[plane + p] = (image[p * 4 + 1] / 255) * 2 - 1;
    chw[2 * plane + p] = (image[p * 4 + 2] / 255) * 2 - 1;
  }
  const encOut = await enc.run({ sample: new ort.Tensor("float32", chw, [1, 3, px, px]) });
  const encT = encOut.latent_sample ?? encOut[enc.outputNames[0]];
  const encData = encT.data as Float32Array;
  const x0 = new Float32Array(n);
  // vae_encoder emits either the latent [1,4,S,S] or moments [1,8,S,S] (mean+logvar,
  // contiguous CHW) — the first 4·S·S values are the mean either way.
  for (let i = 0; i < n; i++) x0[i] = encData[i] * 0.18215;

  const maskLatent = downsampleMaskToLatent(hole, px, S);

  const alphas = alphasCumprod();
  const timesteps = timestepSchedule(steps);
  const g = seededGauss(opts.seed ?? 42);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = g();

  // start: hole from noise, known region from its original forward-diffused to t0
  const t0 = timesteps[0], a0 = alphas[t0], s0 = Math.sqrt(a0), s1 = Math.sqrt(1 - a0);
  let latent: Float32Array = new Float32Array(n);
  for (let c = 0; c < C; c++) for (let i = 0; i < S * S; i++) {
    const idx = c * S * S + i, m = maskLatent[i];
    latent[idx] = m * noise[idx] + (1 - m) * (s0 * x0[idx] + s1 * noise[idx]);
  }

  for (let si = 0; si < timesteps.length; si++) {
    throwIfCancelled();
    onProgress?.(`Filling… step ${si + 1}/${steps}`);
    const t = timesteps[si];
    const tPrev = si + 1 < timesteps.length ? timesteps[si + 1] : 0;
    const sample = new Float32Array(2 * n);
    sample.set(latent, 0); sample.set(latent, n);
    const out = await unet.run({
      sample: new ort.Tensor("float32", sample, [2, C, S, S]),
      timestep: timestepTensor(unet, t),
      encoder_hidden_states: hiddenT(),
    });
    const noiseOut = out.out_sample.data as Float32Array;
    const aT = alphas[t], aPrev = tPrev > 0 ? alphas[tPrev] : 1;
    const sqrtAT = Math.sqrt(aT), sqrt1AT = Math.sqrt(1 - aT), sqrtAPrev = Math.sqrt(aPrev), sqrt1APrev = Math.sqrt(1 - aPrev);
    const genLatent = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const eps = noiseOut[i] + guidance * (noiseOut[n + i] - noiseOut[i]); // classifier-free guidance
      const x0p = (latent[i] - sqrt1AT * eps) / sqrtAT;
      genLatent[i] = sqrtAPrev * x0p + sqrt1APrev * eps;
    }
    // pin the known region to the original (final step tPrev=0 → exactly x0)
    latent = blendLatent(genLatent, x0, noise, maskLatent, C, S, sqrtAPrev, sqrt1APrev);
  }

  onProgress?.("Decoding fill…");
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = latent[i] / 0.18215;
  const dec = await vae.run({ latent_sample: new ort.Tensor("float32", scaled, [1, C, S, S]) });
  const img = dec.sample.data as Float32Array;
  const [, , H, W] = dec.sample.dims as number[];
  const dp = H * W;
  const rgba = new Uint8ClampedArray(dp * 4);
  for (let p = 0; p < dp; p++) {
    rgba[p * 4] = clamp8(((img[p] + 1) / 2) * 255);
    rgba[p * 4 + 1] = clamp8(((img[dp + p] + 1) / 2) * 255);
    rgba[p * 4 + 2] = clamp8(((img[2 * dp + p] + 1) / 2) * 255);
    rgba[p * 4 + 3] = 255;
  }
  return { ok: true, rgba, w: W, h: H };
}

// ─────────────────────────────────────────────────────────────
// img2img — reference-image conditioning (init latent via the VAE encoder)
//
// VAE-encode a square reference image → x0 latent, forward-diffuse it to a start
// timestep chosen by `strength`, then run only the DENOISE TAIL from there (no
// region pinning — the whole frame is regenerated, steered by the prompt but
// anchored to the reference's structure). strength 1 ≈ txt2img; low ≈ subtle
// restyle. Reuses the same vae_encoder standard SD-1.5 ONNX exports ship.
// ─────────────────────────────────────────────────────────────
export async function generateImg2ImgRGBA(
  image: Uint8ClampedArray, opts: GenerateOpts, onProgress?: MlProgress,
): Promise<{ ok: boolean; rgba: Uint8ClampedArray; w: number; h: number }> {
  const gate = await sdBaseOrGate(opts.modelBase);
  if ("gated" in gate) { onProgress?.(gate.gated); return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 }; }
  const base = gate.base;
  const steps = Math.max(1, Math.min(50, opts.steps ?? 20));
  const guidance = opts.guidance ?? 7.5;
  const strength = Math.max(0.05, Math.min(1, opts.strength ?? 0.6));
  const px = Math.round(Math.sqrt(image.length / 4));
  const S = Math.max(1, Math.round(px / 8)), C = 4, n = C * S * S;

  onProgress?.("Loading models…");
  let tok: Tokenize, te: ort.InferenceSession, unet: ort.InferenceSession, vae: ort.InferenceSession, enc: ort.InferenceSession;
  try {
    [tok, te, unet, vae, enc] = await Promise.all([
      tokenizer(base),
      session(`${base}/text_encoder/model.onnx`),
      session(`${base}/unet/model.onnx`),
      session(`${base}/vae_decoder/model.onnx`),
      session(`${base}/vae_encoder/model.onnx`),
    ]);
  } catch {
    onProgress?.(`No Stable Diffusion img2img models at ${base} (needs a vae_encoder). See public/models/MODELS.md.`);
    return { ok: false, rgba: new Uint8ClampedArray(0), w: 0, h: 0 };
  }

  onProgress?.("Encoding prompt…");
  const encodeText = async (text: string) => {
    const ids = tok(text);
    const r = await te.run({ input_ids: new ort.Tensor("int32", Int32Array.from(ids), [1, ids.length]) });
    return r.last_hidden_state;
  };
  const cond = await encodeText(opts.prompt);
  const uncond = await encodeText(opts.negativePrompt ?? "");
  const [, seq, dim] = cond.dims as number[];
  const hidden = new Float32Array(2 * seq * dim);
  hidden.set(uncond.data as Float32Array, 0);
  hidden.set(cond.data as Float32Array, seq * dim);
  // ORT's proxy worker TRANSFERS every input buffer to the worker, so a tensor
  // reused across denoise steps is detached after the first run. Hand each step
  // its own copy of the (constant) text embedding.
  const hiddenT = () => new ort.Tensor("float32", hidden.slice(), [2, seq, dim]);

  // VAE-encode the reference image → x0 latent (SD pixel convention: 2·x−1).
  onProgress?.("Encoding image…");
  const plane = px * px;
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = (image[p * 4] / 255) * 2 - 1;
    chw[plane + p] = (image[p * 4 + 1] / 255) * 2 - 1;
    chw[2 * plane + p] = (image[p * 4 + 2] / 255) * 2 - 1;
  }
  const encOut = await enc.run({ sample: new ort.Tensor("float32", chw, [1, 3, px, px]) });
  const encT = encOut.latent_sample ?? encOut[enc.outputNames[0]];
  const encData = encT.data as Float32Array;
  const x0 = new Float32Array(n);
  for (let i = 0; i < n; i++) x0[i] = encData[i] * 0.18215;

  // Denoise-tail schedule: keep only the last round(steps·strength) timesteps.
  const alphas = alphasCumprod();
  const full = timestepSchedule(steps);
  const nStep = Math.max(1, Math.min(steps, Math.round(steps * strength)));
  const timesteps = full.slice(steps - nStep);

  // Init: forward-diffuse x0 to the first (noisiest) tail timestep.
  const g = seededGauss(opts.seed ?? 42);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = g();
  const t0 = timesteps[0], a0 = alphas[t0], sa0 = Math.sqrt(a0), sb0 = Math.sqrt(1 - a0);
  let latent = new Float32Array(n);
  for (let i = 0; i < n; i++) latent[i] = sa0 * x0[i] + sb0 * noise[i];

  for (let si = 0; si < timesteps.length; si++) {
    throwIfCancelled();
    onProgress?.(`Restyling… step ${si + 1}/${nStep}`);
    const t = timesteps[si];
    const tPrev = si + 1 < timesteps.length ? timesteps[si + 1] : 0;
    const sample = new Float32Array(2 * n);
    sample.set(latent, 0); sample.set(latent, n);
    const out = await unet.run({
      sample: new ort.Tensor("float32", sample, [2, C, S, S]),
      timestep: timestepTensor(unet, t),
      encoder_hidden_states: hiddenT(),
    });
    const noiseOut = out.out_sample.data as Float32Array;
    const aT = alphas[t], aPrev = tPrev > 0 ? alphas[tPrev] : 1;
    const sqrtAT = Math.sqrt(aT), sqrt1AT = Math.sqrt(1 - aT), sqrtAPrev = Math.sqrt(aPrev), sqrt1APrev = Math.sqrt(1 - aPrev);
    const next = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const eps = noiseOut[i] + guidance * (noiseOut[n + i] - noiseOut[i]); // classifier-free guidance
      const x0p = (latent[i] - sqrt1AT * eps) / sqrtAT;
      next[i] = sqrtAPrev * x0p + sqrt1APrev * eps;
    }
    latent = next;
  }

  onProgress?.("Decoding image…");
  const scaled = new Float32Array(n);
  for (let i = 0; i < n; i++) scaled[i] = latent[i] / 0.18215;
  const dec = await vae.run({ latent_sample: new ort.Tensor("float32", scaled, [1, C, S, S]) });
  const img = dec.sample.data as Float32Array;
  const [, , H, W] = dec.sample.dims as number[];
  const dp = H * W;
  const rgba = new Uint8ClampedArray(dp * 4);
  for (let p = 0; p < dp; p++) {
    rgba[p * 4] = clamp8(((img[p] + 1) / 2) * 255);
    rgba[p * 4 + 1] = clamp8(((img[dp + p] + 1) / 2) * 255);
    rgba[p * 4 + 2] = clamp8(((img[2 * dp + p] + 1) / 2) * 255);
    rgba[p * 4 + 3] = 255;
  }
  return { ok: true, rgba, w: W, h: H };
}

/**
 * img2img → new document: restyle a square reference image by a text prompt and
 * open the result. Returns ok:false (without opening) if the document was swapped
 * mid-run or the models/tokenizer/vae_encoder are missing.
 */
export async function generateImageFromReference(
  image: Uint8ClampedArray, opts: GenerateOpts, onProgress?: MlProgress,
): Promise<{ ok: boolean; w: number; h: number }> {
  const gen = engine.docGen;
  const r = await generateImg2ImgRGBA(image, opts, onProgress);
  if (!r.ok) return { ok: false, w: 0, h: 0 };
  if (engine.docGen !== gen) { onProgress?.("Cancelled — document changed."); return { ok: false, w: 0, h: 0 }; }
  const png = await rgbaToPng(r.rgba, r.w, r.h);
  store.openImage(png, `Restyled ${r.w}×${r.h}`);
  await upscaleToTarget(opts.outputSize, Math.max(r.w, r.h), onProgress);
  onProgress?.("Done.");
  return { ok: true, w: r.w, h: r.h };
}
