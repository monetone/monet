import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The DDIM/tokenizer/VAE math is proven end-to-end against the real tiny SD
// model (see the PIPELINE_OK verification). These tests cover the app-side
// orchestration: model load → encode → loop → decode → open, plus the graceful
// path when the local models are absent.

const app = vi.hoisted(() => ({
  engine: { docGen: 1, commit: vi.fn(), e: {} },
  store: { openImage: vi.fn(), stampGenMeta: vi.fn(), activeGenMeta: vi.fn(() => null) },
}));

// Token ids fed to the text encoder, per call — lets the tokenizer tests assert
// what the prompt actually became.
const promptIds = vi.hoisted(() => ({ calls: [] as number[][] }));

// Timesteps fed to the UNet, per run — lets the schedule tests assert what the
// denoise loop actually sampled at (a NaN schedule is only visible here). (#22)
const unetSteps = vi.hoisted(() => ({ t: [] as number[] }));

const ort = vi.hoisted(() => ({
  env: { wasm: { wasmPaths: "", numThreads: 0, proxy: true } },
  Tensor: class Tensor {
    constructor(public readonly type: string, public readonly data: unknown, public readonly dims: number[]) {}
  },
  InferenceSession: {
    create: vi.fn(async (url: string) => ({
      inputNames: ["x"],
      outputNames: ["y"],
      run: vi.fn(async (feeds?: { input_ids?: { data: Int32Array }; timestep?: { data: ArrayLike<number> } }) => {
        if (url.includes("text_encoder") && feeds?.input_ids) promptIds.calls.push(Array.from(feeds.input_ids.data));
        if (url.includes("unet") && feeds?.timestep) unetSteps.t.push(Number(feeds.timestep.data[0]));
        if (url.includes("text_encoder")) return { last_hidden_state: { data: new Float32Array(1 * 77 * 32), dims: [1, 77, 32] } };
        if (url.includes("unet")) return { out_sample: { data: new Float32Array(2 * 4 * 64 * 64), dims: [2, 4, 64, 64] } };
        if (url.includes("vae_encoder")) return { latent_sample: { data: new Float32Array(1 * 4 * 64 * 64), dims: [1, 4, 64, 64] } };
        return { sample: { data: new Float32Array(1 * 3 * 128 * 128), dims: [1, 3, 128, 128] } };
      }),
    })),
  },
}));

vi.mock("../state/app", () => app);
vi.mock("onnxruntime-web", () => ort);

function installDom(present: boolean, webgpu = true, encodeFails = false) {
  vi.stubGlobal("fetch", vi.fn(async (url: string): Promise<{ ok: boolean; json: () => Promise<unknown>; text: () => Promise<string> }> => {
    if (!present) return { ok: false, json: async () => ({}), text: async () => "" };
    if (url.includes("vocab.json")) return { ok: true, json: async () => ({ "<|startoftext|>": 0, "<|endoftext|>": 1, "a</w>": 2, "cat</w>": 3 }), text: async () => "" };
    return { ok: true, json: async () => ({}), text: async () => "#version\n" };
  }));
  // Real weights only run on WebGPU; the gate probes navigator.gpu. Default the
  // stub to present so the pipeline tests exercise generation; pass false to
  // exercise the no-WebGPU gate.
  vi.stubGlobal("navigator", { gpu: webgpu ? { requestAdapter: async () => ({}) } : undefined });
  vi.stubGlobal("document", {
    createElement: () => ({
      width: 0, height: 0,
      getContext: () => ({ createImageData: (w: number, h: number) => ({ data: new Uint8ClampedArray(w * h * 4) }), putImageData: vi.fn() }),
      toBlob: (cb: (b: Blob | null) => void, type?: string) => cb(encodeFails ? null : new Blob([new Uint8Array([1])], { type })),
    }),
  });
}

describe("local diffusion (Stable Diffusion, ONNX)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); app.engine.docGen = 1; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("upscales the opened document toward the requested output size", async () => {
    installDom(true);
    const canSr = vi.fn(() => true), sr = vi.fn(() => true);
    (app.engine as { e: unknown }).e = { can_super_resolution: canSr, super_resolution: sr };
    try {
      const { generateImage } = await import("./diffusion");
      // Test pipeline renders 128px; target 512 → exactly two ×2 passes.
      const r = await generateImage({ prompt: "a cat", steps: 2, outputSize: 512 });
      expect(r.ok).toBe(true);
      expect(sr).toHaveBeenCalledTimes(2);
      // Without a target, super-resolution never runs.
      sr.mockClear();
      await generateImage({ prompt: "a cat", steps: 2 });
      expect(sr).not.toHaveBeenCalled();
    } finally {
      (app.engine as { e: unknown }).e = {};
    }
  });

  it("runs the pipeline and opens the generated image as a new document", async () => {
    installDom(true);
    const { generateImage } = await import("./diffusion");
    const result = await generateImage({ prompt: "a cat", steps: 3 });
    expect(result.ok).toBe(true);
    expect(result.w).toBe(128);
    expect(result.h).toBe(128);
    expect(app.store.openImage).toHaveBeenCalledTimes(1);
  });

  it("rejects when the browser cannot encode the generated canvas", async () => {
    installDom(true, true, true);
    const { generateImage } = await import("./diffusion");

    await expect(generateImage({ prompt: "a cat", steps: 2 })).rejects.toThrow("PNG encode failed (128×128)");
    expect(app.store.openImage).not.toHaveBeenCalled();
  });

  it("caches the tokenizer per base URL (no cross-base bleed)", async () => {
    installDom(true);
    const fetchMock = globalThis.fetch as unknown as { mock: { calls: unknown[][] } };
    const { generateImage } = await import("./diffusion");
    // Two runs against different weight folders in the same session: each must
    // fetch its OWN tokenizer (the old singleton cache reused the first forever,
    // feeding demo token ids into real weights).
    await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/A" });
    await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/B" });
    const vocabUrls = fetchMock.mock.calls.map((c) => c[0] as string).filter((u) => u.includes("vocab.json"));
    expect(vocabUrls.some((u) => u.includes("/models/A/"))).toBe(true);
    expect(vocabUrls.some((u) => u.includes("/models/B/"))).toBe(true);
  });

  it("reports missing models without throwing when weights are absent", async () => {
    installDom(false);
    const { generateImage } = await import("./diffusion");
    const msgs: string[] = [];
    const result = await generateImage({ prompt: "a cat", steps: 3 }, (m) => msgs.push(m));
    expect(result.ok).toBe(false);
    expect(app.store.openImage).not.toHaveBeenCalled();
    expect(msgs.some((m) => m.includes("MODELS.md"))).toBe(true);
  });

  it("retries a diffusion session whose creation failed once", async () => {
    installDom(true);
    ort.InferenceSession.create.mockRejectedValueOnce(new Error("fetch failed"));
    const { generateImage } = await import("./diffusion");

    expect((await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/retry" })).ok).toBe(false);
    expect((await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/retry" })).ok).toBe(true);

    const urls = ort.InferenceSession.create.mock.calls.map(([url]) => url);
    expect(urls.filter((url) => url.includes("text_encoder")).length).toBe(2);
    expect(urls.filter((url) => url.includes("unet")).length).toBe(1);
    expect(urls.filter((url) => url.includes("vae_decoder")).length).toBe(1);
  });

  it("retries tokenizer files after a transient fetch failure", async () => {
    installDom(true);
    vi.mocked(globalThis.fetch).mockRejectedValueOnce(new Error("fetch failed"));
    const { generateImage } = await import("./diffusion");

    expect((await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/tokenizer-retry" })).ok).toBe(false);
    expect((await generateImage({ prompt: "a cat", steps: 2, modelBase: "/models/tokenizer-retry" })).ok).toBe(true);

    const urls = vi.mocked(globalThis.fetch).mock.calls.map(([url]) => String(url));
    expect(urls.filter((url) => url.includes("tokenizer-retry/tokenizer/vocab.json"))).toHaveLength(2);
  });

  it("gates real weights when WebGPU is unavailable instead of OOMing on wasm", async () => {
    installDom(true, false); // real weights present, but no WebGPU adapter
    const { generateImage } = await import("./diffusion");
    const msgs: string[] = [];
    const result = await generateImage({ prompt: "a cat", steps: 3 }, (m) => msgs.push(m));
    expect(result.ok).toBe(false);
    expect(app.store.openImage).not.toHaveBeenCalled();
    expect(msgs.some((m) => /WebGPU/i.test(m))).toBe(true);
  });

  it("skips the WebGPU gate when an explicit modelBase is supplied", async () => {
    installDom(true, false); // no WebGPU, but caller owns the weight folder
    const { generateImage } = await import("./diffusion");
    const result = await generateImage({ prompt: "a cat", steps: 3, modelBase: "/models/A" });
    expect(result.ok).toBe(true);
  });
});

describe("img2img (reference-image conditioning)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); app.engine.docGen = 1; });
  afterEach(() => { vi.unstubAllGlobals(); });

  const refImage = () => new Uint8ClampedArray(512 * 512 * 4).fill(120); // 512² → latent 64

  it("restyles the reference image and opens it as a new document", async () => {
    installDom(true);
    const { generateImageFromReference } = await import("./diffusion");
    const r = await generateImageFromReference(refImage(), { prompt: "a cat", steps: 4, strength: 0.6 });
    expect(r.ok).toBe(true);
    expect(r.w).toBe(128);
    expect(app.store.openImage).toHaveBeenCalledTimes(1);
  });

  it("strength truncates the denoise tail (fewer steps for a lower strength)", async () => {
    installDom(true);
    const { generateImg2ImgRGBA } = await import("./diffusion");
    const count = async (strength: number) => {
      const msgs: string[] = [];
      await generateImg2ImgRGBA(refImage(), { prompt: "a cat", steps: 8, strength }, (m) => msgs.push(m));
      return msgs.filter((m) => /Restyling/.test(m)).length;
    };
    expect(await count(1)).toBe(8); // full schedule ≈ txt2img
    expect(await count(0.5)).toBe(4); // half the tail
    expect(await count(0.05)).toBe(1); // floored at ≥1 step
  });

  it("reports missing models (needs a vae_encoder) without throwing", async () => {
    installDom(false);
    const { generateImageFromReference } = await import("./diffusion");
    const msgs: string[] = [];
    const r = await generateImageFromReference(refImage(), { prompt: "a cat", steps: 4 }, (m) => msgs.push(m));
    expect(r.ok).toBe(false);
    expect(app.store.openImage).not.toHaveBeenCalled();
    expect(msgs.some((m) => m.includes("MODELS.md"))).toBe(true);
  });
});

describe("blended latent diffusion (prompt-driven inpaint)", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); app.engine.docGen = 1; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("downsampleMaskToLatent average-pools a hole mask to latent resolution", async () => {
    const { downsampleMaskToLatent } = await import("./diffusion");
    // 4×4 mask: left two columns are the hole (255), right two are keep (0)
    const hole = new Uint8Array(16);
    for (let y = 0; y < 4; y++) for (let x = 0; x < 2; x++) hole[y * 4 + x] = 255;
    const m = downsampleMaskToLatent(hole, 4, 2); // → 2×2 in [0,1]
    expect(Array.from(m)).toEqual([1, 0, 1, 0]);
  });

  it("blendLatent keeps the hole generated and pins the known region to the noised original", async () => {
    const { blendLatent } = await import("./diffusion");
    const gen = new Float32Array([1, 1, 1, 1]);
    const x0 = new Float32Array([10, 20, 30, 40]);
    const noise = new Float32Array([2, 2, 2, 2]);
    const mask = new Float32Array([1, 0, 0, 1]); // hole, keep, keep, hole
    const out = blendLatent(gen, x0, noise, mask, 1, 2, 1 /*sqrtAPrev*/, 0.5 /*sqrt1APrev*/);
    // hole → gen (1); keep → sqrtAPrev·x0 + sqrt1APrev·noise = x0 + 1
    expect(Array.from(out)).toEqual([1, 21, 31, 1]);
  });

  it("runs the inpaint pipeline and returns the decoded fill", async () => {
    installDom(true);
    const { generateInpaintRGBA } = await import("./diffusion");
    const image = new Uint8ClampedArray(512 * 512 * 4).fill(128);
    const hole = new Uint8Array(512 * 512);
    for (let i = 0; i < 256 * 512; i++) hole[i] = 255; // top half is the hole
    const r = await generateInpaintRGBA(image, hole, { prompt: "a cat", steps: 3 });
    expect(r.ok).toBe(true);
    expect(r.w).toBe(128);
    expect(r.h).toBe(128);
    expect(r.rgba.length).toBe(128 * 128 * 4);
  });

  it("reports missing inpaint weights without throwing", async () => {
    installDom(false);
    const { generateInpaintRGBA } = await import("./diffusion");
    const msgs: string[] = [];
    const image = new Uint8ClampedArray(512 * 512 * 4);
    const hole = new Uint8Array(512 * 512).fill(255);
    const r = await generateInpaintRGBA(image, hole, { prompt: "a cat", steps: 3 }, (m) => msgs.push(m));
    expect(r.ok).toBe(false);
    expect(msgs.some((m) => m.includes("MODELS.md"))).toBe(true);
  });

  it("gates the inpaint pipeline too when WebGPU is unavailable", async () => {
    installDom(true, false); // real weights present, no WebGPU adapter
    const { generateInpaintRGBA } = await import("./diffusion");
    const msgs: string[] = [];
    const image = new Uint8ClampedArray(512 * 512 * 4);
    const hole = new Uint8Array(512 * 512).fill(255);
    const r = await generateInpaintRGBA(image, hole, { prompt: "a cat", steps: 3 }, (m) => msgs.push(m));
    expect(r.ok).toBe(false);
    expect(msgs.some((m) => /WebGPU/i.test(m))).toBe(true);
  });
});

// steps=1 is a permitted input on every pipeline (each clamps with Math.max(1, …)
// and the MCP surface documents + forwards 1..50), but the (steps−1) denominator
// made the schedule 0/0 = NaN: alphas[NaN] is undefined, the whole latent turns
// NaN and the run "succeeds" with a solid-black image — or BigInt(NaN) throws on
// an int64-timestep UNet. (#22)
describe("DDIM timestep schedule", () => {
  beforeEach(() => { vi.clearAllMocks(); vi.resetModules(); app.engine.docGen = 1; unetSteps.t.length = 0; });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("spans 999→0, and a single step samples at the noisiest timestep", async () => {
    const { timestepSchedule } = await import("./diffusion");
    expect(timestepSchedule(4)).toEqual([999, 666, 333, 0]);
    expect(timestepSchedule(1)).toEqual([999]);
  });

  it("denoises once at t=999 for steps:1 (txt2img)", async () => {
    installDom(true);
    const { generateRGBA } = await import("./diffusion");
    const r = await generateRGBA({ prompt: "a cat", steps: 1 });
    expect(r.ok).toBe(true);
    expect(unetSteps.t).toEqual([999]);
  });

  it("denoises once at t=999 for steps:1 (inpaint)", async () => {
    installDom(true);
    const { generateInpaintRGBA } = await import("./diffusion");
    const image = new Uint8ClampedArray(512 * 512 * 4).fill(128);
    const hole = new Uint8Array(512 * 512).fill(255);
    const r = await generateInpaintRGBA(image, hole, { prompt: "a cat", steps: 1 });
    expect(r.ok).toBe(true);
    expect(unetSteps.t).toEqual([999]);
  });

  it("denoises once at t=999 for steps:1 (img2img)", async () => {
    installDom(true);
    const { generateImg2ImgRGBA } = await import("./diffusion");
    const ref = new Uint8ClampedArray(512 * 512 * 4).fill(120);
    const r = await generateImg2ImgRGBA(ref, { prompt: "a cat", steps: 1, strength: 0.6 });
    expect(r.ok).toBe(true);
    expect(unetSteps.t).toEqual([999]);
  });
});

// CLIP is byte-level BPE: the text is UTF-8 encoded and every BYTE goes through
// the bytes-to-unicode table. Mapping each CHARACTER's code point instead left
// everything above U+00FF unmapped — it fell through raw, missed the vocab and
// was silently dropped (a CJK/emoji prompt became BOS/EOS, i.e. unconditioned
// generation with no error) — while U+00A1..U+00FF ('é') was sent as one byte
// instead of its two UTF-8 bytes. (#23)
describe("CLIP tokenizer (byte-level BPE)", () => {
  // bytesToUnicode(), mirrored from diffusion.ts — the reference table.
  const byteEnc = (() => {
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
  })();
  const BOS = 0, EOS = 1;
  // A real CLIP vocab holds every byte token in both plain and word-final form.
  const vocab: Record<string, number> = { "<|startoftext|>": BOS, "<|endoftext|>": EOS };
  for (let b = 0; b < 256; b++) { vocab[byteEnc[b]] = 2 + b * 2; vocab[`${byteEnc[b]}</w>`] = 3 + b * 2; }

  /** Ids the tokenizer must emit for a single-word prompt: one per UTF-8 byte. */
  const expectedIds = (word: string): number[] => {
    const bytes = Array.from(new TextEncoder().encode(word));
    return bytes.map((b, i) => vocab[i === bytes.length - 1 ? `${byteEnc[b]}</w>` : byteEnc[b]]);
  };

  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    promptIds.calls.length = 0;
    installDom(true);
    vi.stubGlobal("fetch", vi.fn(async (url: string) => (url.includes("vocab.json")
      ? { ok: true, json: async () => vocab, text: async () => "" }
      : { ok: true, json: async () => ({}), text: async () => "#version\n" })));
  });
  afterEach(() => { vi.unstubAllGlobals(); });

  it("encodes non-ASCII prompts as UTF-8 bytes instead of dropping them", async () => {
    const { generateRGBA } = await import("./diffusion");

    // 猫 = 3 UTF-8 bytes; é = 2. Before the fix both prompts tokenized to nothing
    // but BOS/EOS (猫) or a single wrong byte (é).
    const r = await generateRGBA({ prompt: "猫 é", steps: 2, modelBase: "/models/A" });

    expect(r.ok).toBe(true);
    const ids = promptIds.calls[0]; // first encode = the conditional prompt
    expect(ids.slice(0, 1 + 3 + 2)).toEqual([BOS, ...expectedIds("猫"), ...expectedIds("é")]);
    expect(ids[1 + 3 + 2]).toBe(EOS);
    expect(ids).toHaveLength(77);
  });
});
