# Building the real SD-1.5 weights (`public/models/sd15/`)

Monet Vision's local text-to-image (Generate Image) and prompt-guided Generative
Fill run Stable-Diffusion-1.5 entirely on-device via `onnxruntime-web`. The tiny
`public/models/sd/` set is a random-weight **placeholder** (abstract output); the
real ~2.1 GB weight set lives at `public/models/sd15/`, is **gitignored** (size),
and is preferred at runtime whenever present (`src/ml/modelSource.ts`). This doc
reproduces that set. It is the SD analogue of the DRUNet recipe in
[`public/models/MODELS.md`](../apps/vision/public/models/MODELS.md).

## Why we build our own instead of downloading an fp16 export

Off-the-shelf fp16 SD-1.5 ONNX exports on Hugging Face (e.g. `*-onnx-cuda-fp16`,
`*-onnx-directml-fp16`) are optimized for the CUDA/DirectML execution providers
and use the Microsoft contrib op **`com.microsoft.NhwcConv`**, which
onnxruntime-web's kernel set does not implement — they fail to load with *"Failed
to find kernel for com.microsoft.NhwcConv"*. The only ort-web-compatible base is
the **standard-ops fp32** export (`onnx-community/stable-diffusion-v1-5-ONNX`),
which we convert to fp16 ourselves with plain-ONNX ops preserved.

Two more wrinkles the recipe handles:

- **`keep_io_types=True`** keeps the graph inputs/outputs fp32 (fp16 only
  internally), so `src/ml/diffusion.ts` feeds ordinary `Float32Array`s unchanged.
- The fp16 converter leaves inconsistent "precision-free" Cast nodes around
  attention blocks that ort-web's strict type checker rejects. Running the model
  once through onnxruntime's **BASIC graph optimizer** eliminates them (no contrib
  fusions at that level). The VAEs stay **fp32** — SD's fp16 VAE is numerically
  unstable (the "black image" bug) and it's only ~165 MB more.

Result per component (all standard ops, no contrib, IO fp32):

| Component | Precision | Size |
| --- | --- | --- |
| `text_encoder` | fp16 | ~246 MB |
| `unet` | fp16 | ~1.72 GB |
| `vae_decoder` | fp32 | ~198 MB |
| `vae_encoder` | fp32 | ~137 MB |
| `tokenizer` (real CLIP) | — | ~1.6 MB |

## Steps

Prerequisites: Python 3.11 (`onnx`/`onnxruntime` have no 3.14 wheels yet) and
`curl`. Work in a scratch dir.

```sh
python3.11 -m venv venv && ./venv/bin/pip install onnx onnxruntime onnxconverter-common numpy

BASE="https://huggingface.co/onnx-community/stable-diffusion-v1-5-ONNX/resolve/main"
mkdir -p fp32/text_encoder fp32/unet fp32/vae_decoder fp32/vae_encoder
# fresh -o downloads (never -C - onto existing files — it corrupts by appending)
curl -sL --fail "$BASE/text_encoder/model.onnx" -o fp32/text_encoder/model.onnx
curl -sL --fail "$BASE/unet/model.onnx"         -o fp32/unet/model.onnx
curl -sL --fail "$BASE/unet/weights.pb"         -o fp32/unet/weights.pb        # 3.4 GB external data
curl -sL --fail "$BASE/vae_decoder/model.onnx"  -o fp32/vae_decoder/model.onnx
curl -sL --fail "$BASE/vae_encoder/model.onnx"  -o fp32/vae_encoder/model.onnx

# convert (produces out/<component>/model.onnx)
./venv/bin/python /path/to/apps/vision/scripts/convert-sd15-fp16.py

# real CLIP tokenizer (the demo tokenizer is a 15 KB truncation — wrong token ids)
mkdir -p out/tokenizer
curl -sL --fail "$BASE/tokenizer/vocab.json" -o out/tokenizer/vocab.json   # 49,408 entries
curl -sL --fail "$BASE/tokenizer/merges.txt" -o out/tokenizer/merges.txt

# install into the app (gitignored)
cp -R out/* /path/to/apps/vision/public/models/sd15/
```

## Verify

- Each `out/*/model.onnx` loads in onnxruntime-web with `executionProviders:
  ["wasm"]` (text_encoder + VAEs also *run* on wasm; the 1.7 GB UNet **loads** on
  wasm but needs **WebGPU** to run — wasm32's 4 GB heap can't hold all components
  at once, which is why `diffusion.ts` requests `["webgpu","wasm"]`).
- Full pipeline in onnxruntime (Python CPU) produces finite, varied output
  (`NaN=0`, decode `std > 0.05`) — no fp16 overflow.
- In-app: Generate Image reports real (non-abstract) output; `sdAvailable()`
  returns `"real"`.
