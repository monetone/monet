// ─────────────────────────────────────────────────────────────
// modelRegistry.ts — the compiled-in catalog of every AI model the app can
// load, typed and versioned with the code that consumes it (plan 02 D1). Not a
// fetched JSON: the list only changes with an app release, so a TS const is
// typed, tree-shaken, and vitest-testable against public/models/checksums.txt.
//
// `files` are the REAL weights for a unit (rel paths under models/). `bundled`
// is true ⇔ every one of those files ships in public/models. The sd15 unit
// is a local-only ~2.1 GB weight set (`files`, gitignored / built locally — see
// docs/build-sd15-weights.md). The unlicensed tiny HF test placeholder under
// /models/sd is excluded from release output and therefore from this registry.
// The lockstep test asserts bundled `files` ⇔ checksums.txt exactly.
//
// Native provisioning is implemented, but a row is downloadable only when all
// its files have an approved HTTPS URL + SHA-256 and its license is cleared.
// Current production candidates pin the exact local artifact hashes below, but
// carry no URL until those bytes are hosted; the Manager stays manual-only.
// ─────────────────────────────────────────────────────────────

export interface ModelFile {
  rel: string;
  url?: string;
  sha256: string;
  bytes: number;
}

export interface ModelDef {
  id:
    | "styles"
    | "u2netp"
    | "super-res"
    | "migan"
    | "drunet"
    | "sd15"
    // Tier-2 neural-filter drops (plan 06): wiring shipped, weights user-supplied,
    // license rows PENDING verification (plan 01) — not bundled, not enabled by
    // default until their license is confirmed.
    | "colorizer"
    | "midas"
    | "harmonizer"
    | "fbcnn"
    | "font-classifier"
    | "face-landmarks"
    | "lama";
  label: string;
  role: string;
  /** The real weights for this unit (rel paths under models/). */
  files: ModelFile[];
  /** True ⇔ every file in `files` ships in public/models (pinned in checksums.txt). */
  bundled: boolean;
  /** When set, the in-app downloader must present this license text and get
   *  explicit acceptance before fetching (e.g. CreativeML OpenRAIL-M §4). */
  licenseAcceptance?: { name: string; textPath: string };
  /** SPDX id or short ref; full text + provenance in public/models/MODELS.md. */
  license: string;
  hw?: { webgpu?: boolean; minGpuBufferMB?: number; minDeviceMemoryGB?: number };
  /** Quality-tier slot: when set, this unit is a higher-quality drop-in
   *  alternate for the base unit with this id. `bestUnit(baseId)` prefers it
   *  once it is imported, so a sourced HQ model supersedes the default with no
   *  call-site change. The alternate MUST share the base's ONNX I/O contract
   *  (e.g. a denoiser [1,3,T,T]→[1,3,T,T], an SR [1,1,224²]→[1,1,672²]). */
  qualityTierFor?: ModelDef["id"];
}

const STYLE = (rel: string, sha256: string): ModelFile => ({ rel, sha256, bytes: 6728029 });

export const MODEL_REGISTRY: readonly ModelDef[] = [
  {
    id: "styles",
    label: "Neural Style Transfer",
    role: "Style Transfer",
    // ponytail: five nets, each baked to one style — the ceiling is a fixed
    // style browser (Strength / Style Opacity / Preserve Color are post-blends,
    // see ml/styleBlend.ts). A *custom* style image needs an arbitrary-style
    // net (AdaIN/WCT-class, style+content inputs); upgrade path is a new
    // registry unit with that two-input contract, not more baked styles.
    bundled: true,
    license: "BSD-3-Clause",
    files: [
      STYLE("candy.onnx", "9d11a3529d1e547da6ae07201d93484dbab2ec0a3614535752c8f40f0fe2968a"),
      STYLE("mosaic.onnx", "fa646dedade881243f8d5a2ceb7de2b93675b21fc24f7482894ac4851a9a0a47"),
      STYLE("pointilism.onnx", "5ee2b8d4d6bc60a777f54e0fe96a1b717360a004b79d56c67390d4a975b14d98"),
      STYLE("rain.onnx", "4162912e6f75fedef6f810ae989b9e10d3d5d43308dab34b027c850cf255e152"),
      STYLE("udnie.onnx", "8656b6ce7dec8f22ee13c2d557d6b67bd6f550dde88d0f2e7c9972aeb765cc0d"),
    ],
  },
  {
    id: "u2netp",
    label: "U²-Net (small)",
    role: "Select Subject / Remove Background",
    bundled: true,
    license: "Apache-2.0",
    files: [{ rel: "u2netp.onnx", sha256: "309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8", bytes: 4574861 }],
  },
  {
    id: "super-res",
    label: "Super-Resolution",
    role: "Super-Resolution 3×",
    bundled: true,
    license: "BSD-3-Clause / Apache-2.0",
    files: [{ rel: "super-res.onnx", sha256: "85f36ff88cc504a24af5e0602148bc56a8aa09a58eca8c0da2756f3e8186035e", bytes: 240078 }],
  },
  {
    id: "migan",
    label: "MI-GAN",
    role: "Generative Fill (prompt-free inpaint)",
    // License-sprint 2026-07-16 (adversarially verified): the CODE repo
    // (Picsart-AI-Research/MI-GAN) is MIT but vendors NVIDIA-proprietary
    // StyleGAN2-ADA ops, and the weights blob has no stated license — BYO
    // only, never redistribute. The sha validates a user-supplied file.
    // Upgrade path: an explicit author license statement → upstream pin.
    bundled: false,
    license: "BYO-only — code MIT (Picsart); weights license unstated",
    files: [{ rel: "migan.onnx", sha256: "593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae", bytes: 29546882 }],
  },
  {
    id: "lama",
    label: "LaMa (big-lama)",
    role: "Remove tool (large-model inpaint tier)",
    bundled: false,
    // License-sprint 2026-07-16: Apache-2.0 (LaMa, Samsung Research) — weights
    // license inferred with OpenCV's redistribution as precedent; accepted
    // as-is per review. Pure-local: verified source URL lives in MODELS.md.
    // Wired 2026-07-20: removeStroke → onnx.ts lamaFillML, preferred over
    // MI-GAN when imported (512² float32 image + 1=hole mask; see MODELS.md).
    license: "Apache-2.0 (LaMa, Samsung Research — weights license inferred, accepted 2026-07-16)",
    files: [{ rel: "lama_fp32.onnx", sha256: "1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6", bytes: 208044816 }],
  },
  {
    id: "drunet",
    label: "DRUNet (color)",
    role: "AI Denoise",
    // Gitignored (130 MB, fp32) — built locally per MODELS.md. License-sprint
    // 2026-07-16: attribution chain is Zhang et al. DPIR (MIT, architecture) →
    // deepinv retrained weights (BSD-3-Clause) → in-house torch.onnx export.
    // Pure-local: users rebuild via the MODELS.md recipe; no hosting.
    bundled: false,
    license: "BSD-3-Clause (deepinv retrained weights; in-house ONNX export)",
    files: [{ rel: "drunet_color.onnx", sha256: "b5b2f6155eaceeafa76e085cfd3e32eb4b3116d3394c3cc3488fedcb6cfcbe9c", bytes: 130594542 }],
  },
  {
    id: "sd15",
    label: "Stable Diffusion 1.5",
    role: "Prompted Generative Fill / Generate Image",
    // Real weights (~2.1 GB fp16) built and hash-pinned locally. Pure-local:
    // users rebuild per docs/build-sd15-weights.md; no hosting.
    bundled: false,
    license: "CreativeML OpenRAIL-M (fp16 conversion disclosed; download requires license acceptance)",
    licenseAcceptance: { name: "CreativeML Open RAIL-M", textPath: "/licenses/CreativeML-OpenRAIL-M.txt" },
    hw: { webgpu: true, minGpuBufferMB: 2048 },
    files: [
      { rel: "sd15/text_encoder/model.onnx", sha256: "241a3333f327c6ad3f3264ddd958bb9294e864547cdab81a8e30c8c60fe63115", bytes: 246418339 },
      { rel: "sd15/unet/model.onnx", sha256: "bee3f91b729b1b019e9488620a423a92996ff1c8ae5268a62808b30edcc2e965", bytes: 1720171730 },
      { rel: "sd15/vae_encoder/model.onnx", sha256: "313d56e981fdb5d731a3ba117e15b4cf15d86fd7ba4cc654f0fb2f24af5afdad", bytes: 136760348 },
      { rel: "sd15/vae_decoder/model.onnx", sha256: "c4b6ca4aebff4a8850e7c92b8982c7afbcfc5c5cdd32ba66389988b92dabb300", bytes: 198078223 },
      { rel: "sd15/tokenizer/vocab.json", sha256: "fd67774a869730a6b27bf53d3e434e72054f2a825873c7af3bece183bb1f791e", bytes: 1109372 },
      { rel: "sd15/tokenizer/merges.txt", sha256: "0bc7695944744789d6fd6d0ab754bcbbb9e36f1c182df0a006d619ce70a1e052", bytes: 573514 },
    ],
  },
  // ── Tier-2 neural-filter drops (plan 06) ──────────────────────
  // Wiring is shipped in src/ml/onnx.ts; the weights are user-built /
  // gitignored (rebuild per apps/vision/scripts/convert-<unit>.py, then Import —
  // see MODELS.md) and only RUN once installed. Every row carries a verified
  // license + exact sha256/bytes pin (2026-07-16 conversion batch). None appear
  // in checksums.txt (not bundled).
  {
    id: "colorizer",
    label: "Colorize (learned)",
    role: "Neural Filters ▸ Colorize",
    bundled: false,
    // In-house ONNX re-conversion (2026-07-16): exported from the pinned
    // ddcolor_paper_tiny.pth via piddnad/DDColor's own scripts/export_onnx.py
    // (opset 17→18 after onnxsim), fp32, contract [1,3,512,512]→[1,2,512,512].
    // Reproduce: apps/vision/scripts/convert-colorizer.py (recipe in MODELS.md).
    // Verified: runs under onnxruntime, no ort-web-unsupported ops, ab std≈18.7.
    license: "Apache-2.0 (DDColor tiny — piddnad, in-house ONNX re-conversion)",
    files: [{
      rel: "colorizer.onnx",
      sha256: "2d8107d875ef4e0c0df3516e28bfb74e7ecb1dabb0633735000b48b6d4843d1c",
      bytes: 223887597,
    }],
  },
  {
    id: "midas",
    label: "MiDaS (monocular depth)",
    role: "Neural Filters ▸ Depth Blur",
    bundled: false,
    // License-sprint 2026-07-16 (adversarially verified): MIT, Copyright (c)
    // 2019 Intel ISL — the release asset IS the weights. Pure-local policy:
    // no in-app download; the verified source URL + hash live in MODELS.md
    // and Import validates against this pin.
    license: "MIT (Intel ISL — isl-org/MiDaS)",
    files: [{
      rel: "midas.onnx",
      sha256: "2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58",
      bytes: 66764249,
    }],
  },
  {
    id: "harmonizer",
    label: "Image Harmonizer",
    role: "Neural Filters ▸ Harmonize",
    bundled: false,
    // In-house ONNX re-conversion (2026-07-16): exported from PCTNet_ViT.pth
    // (rakutentech PCT-Net, MPL-2.0) — the low-res branch of PCTNet(ViT_pct),
    // 2-input [image,mask] → harmonized [1,3,256,256] (RGB config: no ImageNet
    // norm, plain [0,1]; use_attn=False so the net composites inside the mask).
    // Reproduce: apps/vision/scripts/convert-harmonizer.py. Verified: runs under
    // onnxruntime, no ort-web-unsupported ops, region-only edit (Δ 0 outside mask).
    license: "MPL-2.0 (rakutentech PCT-Net — in-house ONNX re-conversion)",
    files: [{
      rel: "harmonizer.onnx",
      sha256: "9971c1fe428c07e53c6eaac94170299c20ba1cc536595e57f1f6f6762534cead",
      bytes: 19412185,
    }],
  },
  {
    id: "fbcnn",
    label: "FBCNN (restoration / JPEG artifacts)",
    role: "Neural Filters ▸ Photo Restoration",
    bundled: false,
    // In-house ONNX re-conversion (2026-07-16): exported from fbcnn_color.pth
    // (jiaxi-jiang/FBCNN, Apache-2.0) — image-only path [1,3,256,256] → restored
    // [1,3,256,256] in [0,1] (QF branch dropped). Reproduce: convert-fbcnn.py.
    // Verified: runs under onnxruntime, no ort-web-unsupported ops.
    license: "Apache-2.0 (jiaxi-jiang FBCNN — in-house ONNX re-conversion)",
    files: [{
      rel: "fbcnn.onnx",
      sha256: "23914bc9d91d535255559b03fc296f5dd21243f2e82632da7761d4dcb67bb8e8",
      bytes: 287702220,
    }],
  },
  {
    id: "font-classifier",
    label: "Font classifier",
    role: "Type ▸ Match Font (image)",
    bundled: false,
    // In-house ONNX re-conversion (2026-07-16): gaborcselle/font-identifier
    // (MIT), a microsoft/resnet-18 fine-tuned on 49 fonts. Contract per the
    // model's own preprocessor: [1,3,224,224] RGB, ImageNet-normalized → 49
    // logits. matchFontML was swapped from the DeepFont [1,1,105,105] gray stub
    // to this architecture in lockstep. Reproduce: convert-font-classifier.py.
    license: "MIT (gaborcselle/font-identifier — in-house ONNX re-conversion)",
    files: [{
      rel: "font_classifier.onnx",
      sha256: "c3448d4439e109bb613f9407b41e6395ebe908910939c8b375448c753a7279ad",
      bytes: 44801677,
    }],
  },
  {
    id: "face-landmarks",
    label: "Face landmarks (68-point)",
    role: "Liquify ▸ Face-Aware",
    bundled: false,
    // License-sprint 2026-07-16: BSD-2-Clause (Copyright (c) 2019, Emiliana);
    // the OpenSeeFace README grants code AND models. Pure-local policy: the
    // commit-pinned source URL lives in MODELS.md; Import validates the hash.
    license: "BSD-2-Clause (OpenSeeFace — emilianavt)",
    files: [{
      rel: "face_landmarks.onnx",
      sha256: "5aa0ab2594acaf2e1d3916a8de592cffeb1f1a7a7f778cad2f37948bff6549d1",
      bytes: 13500226,
    }],
  },
];

/** Total on-disk size of a unit's real weights, in bytes. */
export function modelBytes(def: ModelDef): number {
  return def.files.reduce((n, f) => n + f.bytes, 0);
}

/** Human-readable byte size (1 MB = 1e6 B, matching the MODELS.md convention). */
export function prettyBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${(bytes / 1e6).toFixed(1)} MB`;
  if (bytes >= 1e3) return `${(bytes / 1e3).toFixed(0)} KB`;
  return `${bytes} B`;
}
