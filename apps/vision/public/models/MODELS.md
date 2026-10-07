# ONNX model inventory

The seven root-level models listed in `checksums.txt` ship inside the app and
run on-device through onnxruntime-web. Optional rows below are local inputs or
future candidates; entries in `.gitignore` are deterministically removed from
release input before copying. Verify release completeness, SHA-256 bytes, and license entries
with:

```sh
pnpm run check:models
```

**Provisioning is pure-local: the app never downloads model weights.** The
desktop Model Manager installs optional models exclusively via
**Install from Disk… (Import)**: obtain the file yourself from the verified
source in the "Getting models" table below (or rebuild it with the linked
conversion recipe), and the import streams it into bounded partials under
`appDataDir/models/`, activating the unit only after every registered size and
SHA-256 checksum matches its `modelRegistry.ts` pin. Installed bytes are
rehashed natively before first use, then cached until an import or delete
invalidates the result. Rows with a license-acceptance term (SD-1.5's
CreativeML OpenRAIL-M) present the license text for acceptance before the
import proceeds. The app never guesses an upstream URL or accepts an unpinned
model.

## Inventory

| File | Size | Used for | Model family |
| --- | --- | --- | --- |
| `candy.onnx` | 6.7 MB | Neural style transfer | fast-neural-style (Johnson et al.) |
| `mosaic.onnx` | 6.7 MB | Neural style transfer | fast-neural-style |
| `pointilism.onnx` | 6.7 MB | Neural style transfer | fast-neural-style |
| `rain.onnx` | 6.7 MB | Neural style transfer | fast-neural-style |
| `udnie.onnx` | 6.7 MB | Neural style transfer | fast-neural-style |
| `u2netp.onnx` | 4.6 MB | Select Subject / Remove Background | U²-Net (small) salient-object detection |
| `super-res.onnx` | 0.24 MB | Super-Resolution 3× | sub-pixel super-resolution (ESPCN-style) |
| `migan.onnx` | 29.5 MB | Optional local Generative Fill; **not shipped** | MI-GAN weights licence not directly confirmed |
| `drunet_color.onnx` | 130 MB | AI Denoise (Filter ▸ Neural Filters) | DRUNet (Zhang et al.), **BSD-3-Clause** |
| `sd/…` | ~8 MB | Optional local wiring demo; **not tracked or released** | tiny-stable-diffusion (untagged HF test artifact, random weights; tokenizer = OpenAI CLIP, **MIT**) |
| `colorizer.onnx` | 214 MB | Neural Filters ▸ Colorize | DDColor tiny (piddnad), **Apache-2.0** |
| `midas.onnx` | 67 MB | Neural Filters ▸ Depth Blur | MiDaS small (Intel ISL), **MIT** |
| `harmonizer.onnx` | 19 MB | Neural Filters ▸ Harmonize | PCT-Net ViT (rakutentech), **MPL-2.0** |
| `fbcnn.onnx` | 288 MB | Neural Filters ▸ Photo Restoration | FBCNN color (jiaxi-jiang), **Apache-2.0** |
| `font_classifier.onnx` | 45 MB | Type ▸ Match Font (Image AI) | font-identifier (gaborcselle, resnet-18, 49 fonts), **MIT** |
| `face_landmarks.onnx` | 13.5 MB | Liquify ▸ Face-Aware (AI) | OpenSeeFace lm_model3 (68-point face alignment), **BSD-2-Clause** |

> **Tier-2 neural-filter drops (plan 06) — wiring shipped, weights user-built.**
> The six rows above are **gitignored** and **not shipped**: the on-device wiring
> lives in `src/ml/onnx.ts` (`colorizeML`, `depthBlurML`, `harmonizeML`,
> `restoreML`, `matchFontML`, `faceAwareLiquifyML`) and each mirrors the local
> sd15/drunet pattern — it only **runs** once the ONNX file is installed via
> Import (validated against the registry pin); until then the feature throws a
> clean *"model not installed"* message (Colorize and Photo Restoration
> additionally fall back to their classic heuristic / deblock path). As of the
> 2026-07-16 conversion batch every row has a verified license and an exact
> sha256/bytes pin in `modelRegistry.ts`; get each model from the "Getting
> models" table below (verified download or `scripts/convert-<unit>.py` recipe).
> The exact input tensor contract is documented at each function in `onnx.ts`.

> **`sd/` — local text-to-image (Generate Image).** The `src/ml/diffusion.ts`
> pipeline (CLIP tokenizer → text encoder → classifier-free-guidance UNet DDIM
> loop → VAE decode) runs entirely on-device via onnxruntime-web (WebGPU when
> available, wasm fallback). It expects the standard diffusers ONNX layout under
> `/models/sd`: `text_encoder/model.onnx`, `unet/model.onnx`,
> `vae_decoder/model.onnx`, and `tokenizer/{vocab.json,merges.txt}`.
>
> **Prompt-driven Generative Fill** (`generateInpaintRGBA`, blended latent
> diffusion) reuses these same weights plus a **`vae_encoder/model.onnx`** — also
> part of the standard `optimum-cli export onnx` output. When it (or any SD weight)
> is absent, the UI offers a prompt-free MI-GAN fallback only when a licensed
> local `migan.onnx` is actually installed.
>
> Developers may separately obtain
> `optimum-internal-testing/tiny-stable-diffusion-onnx`, a ~8 MB random-weight
> placeholder useful for local wiring tests. Its upstream artifact has no
> redistribution licence, so it is neither tracked nor released; `.gitignore`
> keeps a local `/models/sd` install out of every bundle. Release users see the
> model as missing until a licensed real set is installed.
>
> **Real photographic generation** uses the ~2.1 GB **`sd15/`** weight set —
> locally-built fp16 UNet/text_encoder + fp32 VAEs + the real CLIP tokenizer —
> which is **local-only** (size) and loaded in preference to this placeholder
> whenever present (`src/ml/modelSource.ts` resolves `/models/sd15` → `/models/sd`
> → missing). Rebuild it with [`docs/build-sd15-weights.md`](../../../../docs/build-sd15-weights.md)
> (`scripts/convert-sd15-fp16.py`); it is CreativeML OpenRAIL-M — **verify the
> license before distributing**. SDXL-Turbo is **not** drop-in (dual text encoder
> + `text_embeds`/`time_ids` the pipeline doesn't feed). The pipeline is
> `cross_attention_dim`-agnostic and needs no code change for SD-1.5-class weights;
> `diffusion.ts` feeds `timestep` as int64 (demo) or float32 (real) per the loaded
> UNet's declared input type.

> **`drunet_color.onnx` is NOT committed to git** — at 130 MB (fp32) it exceeds
> GitHub's 100 MB per-file limit, so it is gitignored and must be built locally
> (recipe below) or distributed via Git LFS / an fp16 (~65 MB) re-export. AI
> Denoise degrades gracefully (an error toast) when the file is absent.
>
> **`drunet_color.onnx` provenance & size.** Exported from the BSD-3-Clause
> weights at `huggingface.co/deepinv/drunet`'s sibling DRUNet checkpoint via the
> `deepinv` library, baking a fixed noise level (σ=0.10) into a single
> image→image graph. Reproduce: `pip install deepinv onnx onnxscript`, then
> `deepinv.models.DRUNet(3,3,pretrained="download")` → `torch.onnx.export(..,
> opset 17, dynamic h/w)` → inline external data with `onnx.save_model(m, out,
> save_as_external_data=False)`. It is by far the largest model here (fp32); it
> can be swapped for a lighter denoiser or fp16-quantized (~65 MB) if repo size
> matters — the `aiDenoise()` tiling loop in `src/ml/onnx.ts` is model-agnostic
> as long as the I/O stays `[1,3,H,W]` float32 in [0,1]. Runs on-device (tiled
> 256² windows, feather-blended); nothing is fetched at runtime.

## Release licensing (reviewed 2026-07-15)

Every released weight is identified below with its upstream repo, approved SPDX
license, weights source, and provenance proof. Optional local-only artifacts are
called out separately and are not represented as redistributable. Attribution
requirements (copyright notices + full license texts) are satisfied by
[`public/THIRD-PARTY-LICENSES.md`](../THIRD-PARTY-LICENSES.md), which ships in the
bundle (`public/` → `dist/`), plus the adjacent complete Apache-2.0 text. The
`pnpm run check:models` release gate hashes the exact non-excluded model tree and
fails on missing, extra, malformed, or unapproved entries, so this licensing
status is enforced, not just documented. Artifacts without direct
redistribution evidence, including MI-GAN and the tiny SD demo, are excluded.

| Artifact / release status | Upstream code | Code license | Weights provenance & license |
|---|---|---|---|
| `migan.onnx` — local-only | github.com/Picsart-AI-Research/MI-GAN | Code is **MIT** | The available first-author HF weights repo has no licence tag, and the MIT project's README links a different `migan_pipeline_v2.onnx` artifact. The 29.5 MB `migan.onnx` blob is therefore not tracked or shipped pending direct confirmation. |
| `candy/mosaic/rain/udnie/pointilism.onnx` | github.com/onnx/models `validated/vision/style_transfer/fast_neural_style` ← pytorch/examples | **BSD-3-Clause** (stated on the zoo model page; exported from pytorch/examples) | ONNX Model Zoo redistributions (~6.7 MB each); zoo repo itself Apache-2.0 |
| `u2netp.onnx` | github.com/xuebinqin/U-2-Net | **Apache-2.0** (GitHub API) | Community ONNX export of the u2netp checkpoint (rembg-style); upstream weights released in the Apache-2.0 repo — include the Apache NOTICE |
| `super-res.onnx` | github.com/onnx/models `validated/vision/super_resolution/sub_pixel_cnn_2016` ← pytorch/examples tutorial | pytorch/examples **BSD-3-Clause**; zoo page lists no per-model license → also covered by onnx/models **Apache-2.0** repo license | `super-resolution-10.onnx`, 240 KB (size matches exactly); trained on BSD300 |
| `drunet_color.onnx` — local-only | github.com/deepinv/deepinv | **BSD-3-Clause** | huggingface.co/deepinv/drunet carries an explicit **bsd-3-clause** license tag; export recipe above |
| `sd/` placeholder — source-checkout only, release-excluded | huggingface.co/optimum-internal-testing/tiny-stable-diffusion-onnx | **No redistribution license** (HF internal-testing artifact, random untrained weights) | Not released. `tokenizer/vocab.json` + `merges.txt` are OpenAI CLIP BPE data under **MIT**, but the directory is excluded as one unit. |

**Why MI-GAN is excluded.** The previous file's SHA-256 tied it to
`huggingface.co/andraniksargsyan/migan`, but that weights repo has no licence tag
and the MIT project links only the sibling `migan_pipeline_v2.onnx`. Author
identity and graph compatibility are provenance evidence, not redistribution
permission. Runtime support remains for a user-supplied licensed model.

**Additional MI-GAN context.** MI-GAN-512 is trained on Places2/Places365, and
its training repository vendors StyleGAN2-ADA-derived `torch_utils/ops`.
Vision ships neither those sources nor MI-GAN weights, so these provenance
questions do not affect the current release set.

## Getting models (verified sources — manual download, then Import)

Monet Vision provisions models **locally**: the app never downloads weights.
Fetch each file yourself from its verified upstream below, then use
Filter ▸ Neural Filters ▸ Manage Models ▸ Import — the import validates the
file against the pinned sha256 before installing it.

| Unit | Get it from | sha256 | Bytes |
|---|---|---|---|
| MiDaS (Depth Blur) | https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx → import as `midas.onnx` | `2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58` | 66,764,249 |
| Face landmarks (Face-Aware Liquify) | https://raw.githubusercontent.com/emilianavt/OpenSeeFace/85aa70fc67582d046e771ea73625182a0d8f7475/models/lm_model3_opt.onnx → import as `face_landmarks.onnx` | `5aa0ab2594acaf2e1d3916a8de592cffeb1f1a7a7f778cad2f37948bff6549d1` | 13,500,226 |
| LaMa (Remove tool, large tier) | https://huggingface.co/Carve/LaMa-ONNX/resolve/main/lama_fp32.onnx → import as `lama_fp32.onnx` | `1faef5301d78db7dda502fe59966957ec4b79dd64e16f03ed96913c7a4eb68d6` | 208,044,816 |
<!-- LaMa tensor contract — VERIFIED 2026-07-20 against the Carve-Photos export
notebook (export_LaMa_to_onnx.ipynb) + community ORT usage, cross-checked over
5 sources. Wired in onnx.ts lamaFillML. Inputs (named): "image" = float32
[1,3,512,512] RGB in [0,1] (ToTensor only, NO ImageNet normalization); "mask" =
float32 [1,1,512,512] with 1 = hole/inpaint, 0 = keep (INVERTED vs MI-GAN's
uint8 255 = known). Output: "output" = float32 [1,3,512,512], range [0,255] —
the ×255 clamp is baked into the graph, so do NOT scale again (the code's
range auto-detect leaves it as-is). Spatial dims fixed at 512² (batch dim is the
only dynamic axis). Once imported it is preferred over MI-GAN for the Remove
tool. -->

| MI-GAN (prompt-free inpaint) | BYO only — weights license unstated upstream; if you have a legitimately obtained `migan.onnx`, Import validates it | `593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae` | 29,546,882 |
| Stable Diffusion 1.5 | build per `docs/build-sd15-weights.md` (fp16 recipe); Import presents the CreativeML OpenRAIL-M license for acceptance | per-file (see registry) | ~2.1 GB |
| DRUNet (AI Denoise) | build per the recipe above in this file (deepinv BSD-3 weights → ONNX export) | `b5b2f6155eaceeafa76e085cfd3e32eb4b3116d3394c3cc3488fedcb6cfcbe9c` | 130,594,542 |
| Colorizer (Colorize) | build per `apps/vision/scripts/convert-colorizer.py` (DDColor tiny Apache-2.0 → ONNX; official `export_onnx.py` at pinned commit) → import as `colorizer.onnx` | `2d8107d875ef4e0c0df3516e28bfb74e7ecb1dabb0633735000b48b6d4843d1c` | 223,887,597 |
| Harmonizer (Harmonize) | build per `apps/vision/scripts/convert-harmonizer.py` (PCT-Net ViT MPL-2.0 → ONNX, low-res branch, pinned commit) → import as `harmonizer.onnx` | `9971c1fe428c07e53c6eaac94170299c20ba1cc536595e57f1f6f6762534cead` | 19,412,185 |
| FBCNN (Photo Restoration) | build per `apps/vision/scripts/convert-fbcnn.py` (FBCNN color Apache-2.0 → ONNX, image-only path, pinned commit) → import as `fbcnn.onnx` | `23914bc9d91d535255559b03fc296f5dd21243f2e82632da7761d4dcb67bb8e8` | 287,702,220 |
| Font classifier (Match Font) | build per `apps/vision/scripts/convert-font-classifier.py` (gaborcselle/font-identifier MIT resnet-18 → ONNX, rev-pinned) → import as `font_classifier.onnx` | `c3448d4439e109bb613f9407b41e6395ebe908910939c8b375448c753a7279ad` | 44,801,677 |

### Quality tiers (higher-quality drop-in models)

Super Resolution and AI Denoise resolve their model through `bestUnit(baseId)`
(`modelSource.ts`): if a registry row carries `qualityTierFor: "<baseId>"` and is
imported, it is used in place of the default with **no code change**. To add an
HQ tier, add one `MODEL_REGISTRY` row with `qualityTierFor` set to the base id
(`"drunet"` for AI Denoise, `"super-res"` for Super Resolution), a verified
license, and the pinned `sha256`/`bytes`, then add its provenance row above. The
alternate MUST share the base's ONNX I/O contract — a denoiser
`[1,3,T,T]→[1,3,T,T]` (e.g. SCUNet/NAFNet-class) drops straight into the tiling
loop; an SR model must keep the ESPCN `[1,1,224²]→[1,1,672²]` luma contract. A
different-architecture SR (e.g. RGB 4× Real-ESRGAN) needs its own inference path
and is out of scope for the drop-in slot. Model **sourcing + license
verification is a decision** — until a row is added, `bestUnit` returns the base.
