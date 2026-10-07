# Third-Party Licenses & NOTICE

Monet Vision ships pretrained model weights and the onnxruntime-web runtime
produced by third parties. This file is the attribution NOTICE copied to
`dist/` and the Tauri bundle. It is also the machine-readable registry used by
`pnpm run check:models`: every release model must have a checksum and an
approved SPDX `License:` entry. Literal local-only paths in
`public/models/.gitignore` are never copied into release output.

The MIT and BSD-3-Clause texts appear once each in the
[Appendix](#appendix-full-license-texts). The complete Apache-2.0 text ships as
[`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0).

Reviewed 2026-07-15. See `public/models/MODELS.md` for the per-model matrix and
provenance narrative.

---

## openjpeg2-pure-rs 0.1.1
License: BSD-2-Clause
Upstream: https://crates.io/crates/openjpeg2-pure-rs/0.1.1
Used for: JPEG 2000 image import and export in the bundled WASM engine.
The complete upstream copyright notice and license ship as
[`LICENSE-OPENJPEG`](LICENSE-OPENJPEG).

## midas.onnx (user-imported — not bundled)
License: MIT
Upstream: https://github.com/isl-org/MiDaS
Weights: v2_1 release asset `model-small.onnx` (sha256 2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58, 66,764,249 bytes), user-downloaded from upstream and installed via Import (pure-local provisioning)
Copyright (c) 2019 Intel ISL (Intel Intelligent Systems Lab)
Note: repo archived 2025-08 — the sha pin is the integrity guarantee, and MIT
permits mirroring to the project model repo if the release asset disappears.
MIT text: see Appendix.

## face_landmarks.onnx (user-imported — not bundled)
License: BSD-2-Clause
Upstream: https://github.com/emilianavt/OpenSeeFace
Weights: `models/lm_model3_opt.onnx` at commit 85aa70fc (sha256 5aa0ab2594acaf2e1d3916a8de592cffeb1f1a7a7f778cad2f37948bff6549d1, 13,500,226 bytes); the README grants code AND models under BSD-2-Clause
Copyright (c) 2019, Emiliana
BSD-2-Clause text: see Appendix.

## public/profiles/ISOcoated_v2_300_eci.icc
License: Heidelberg ICC profile license (September 2003) — free redistribution,
unmodified, with this license shipped alongside, at no extra charge
Upstream: https://eci.org (ECI Offset 2009 package) — "ISO Coated v2 300% (ECI)", FOGRA39, 300% TAC
Copyright: (c) 2000-2006 Heidelberger Druckmaschinen AG (embedded cprt tag)
sha256: c6b4b62f0726243742eced8b9669476a6be89e581f50a7600ed8b6fcbb9cdab8 — bit-identical
to the copy Debian has redistributed in `icc-profiles` (non-free) for years.
License text: `public/profiles/LICENSE-ISOcoated_v2_300_eci.txt` (ships with the
profile per clause 2.2; clauses 3.1/3.2 prohibit charging for the profile itself).
Used for: View ▸ Proof Setup ▸ Working CMYK (real ICC soft proof) and
View ▸ Gamut Warning (round-trip gamut flags) via the engine's proof_lut.

## public/models/migan.onnx
License: Not shipped — upstream weights licence unconfirmed
Upstream: https://github.com/Picsart-AI-Research/MI-GAN
Weights: https://huggingface.co/andraniksargsyan/migan migan.onnx blob (sha256 593eba0b7e04730f1b61c0a3cbca68d97d8d6a7ff5c6a44a7b9d7fcd880fc5ae)
Copyright (c) 2024 Picsart AI Research (PAIR)
Provenance: The previous local blob's SHA-256 matched this first-author HF repo,
but the repo has no licence tag and the MIT project's README links only the
sibling `migan_pipeline_v2.onnx`. Runtime support remains, but `migan.onnx` is
not tracked or released pending direct redistribution permission.

## public/models/candy.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/style_transfer/fast_neural_style (← pytorch/examples)
Weights: ONNX Model Zoo redistribution (fast-neural-style, Johnson et al.); zoo repo itself Apache-2.0
Copyright: pytorch/examples contributors (fast_neural_style)
BSD-3-Clause text: see Appendix.

## public/models/mosaic.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/style_transfer/fast_neural_style (← pytorch/examples)
Weights: ONNX Model Zoo redistribution (fast-neural-style, Johnson et al.); zoo repo itself Apache-2.0
Copyright: pytorch/examples contributors (fast_neural_style)
BSD-3-Clause text: see Appendix.

## public/models/pointilism.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/style_transfer/fast_neural_style (← pytorch/examples)
Weights: ONNX Model Zoo redistribution (fast-neural-style, Johnson et al.); zoo repo itself Apache-2.0
Copyright: pytorch/examples contributors (fast_neural_style)
BSD-3-Clause text: see Appendix.

## public/models/rain.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/style_transfer/fast_neural_style (← pytorch/examples)
Weights: ONNX Model Zoo redistribution (fast-neural-style, Johnson et al.); zoo repo itself Apache-2.0
Copyright: pytorch/examples contributors (fast_neural_style)
BSD-3-Clause text: see Appendix.

## public/models/udnie.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/style_transfer/fast_neural_style (← pytorch/examples)
Weights: ONNX Model Zoo redistribution (fast-neural-style, Johnson et al.); zoo repo itself Apache-2.0
Copyright: pytorch/examples contributors (fast_neural_style)
BSD-3-Clause text: see Appendix.

## public/models/u2netp.onnx
License: Apache-2.0
Upstream: https://github.com/xuebinqin/U-2-Net
Weights: community ONNX export of the u2netp checkpoint (rembg-style); upstream weights released in the Apache-2.0 repo
Copyright: Xuebin Qin et al. (U²-Net)
NOTICE: Apache-2.0 requires preservation of copyright, this NOTICE, and the
license text; no NOTICE file is distributed upstream. The complete text ships
as `LICENSE-APACHE-2.0`.

## public/models/super-res.onnx
License: BSD-3-Clause
Upstream: https://github.com/onnx/models/tree/main/validated/vision/super_resolution/sub_pixel_cnn_2016 (← pytorch/examples sub-pixel CNN tutorial)
Weights: `super-resolution-10.onnx` (240 KB, size matches exactly); trained on BSD300. Source code is pytorch/examples BSD-3-Clause; the zoo page lists no per-model license, so the redistribution is additionally covered by the onnx/models Apache-2.0 repo license.
Copyright: pytorch/examples contributors (sub_pixel_cnn)
BSD-3-Clause text: see Appendix (Apache-2.0 also applies to the zoo redistribution).

## public/models/drunet_color.onnx
License: BSD-3-Clause
Upstream: https://github.com/deepinv/deepinv
Weights: https://huggingface.co/deepinv/drunet — explicit `bsd-3-clause` license tag; export recipe in `public/models/MODELS.md`
Copyright: deepinv contributors (DRUNet, Zhang et al.)
Note: the 130 MB fp32 binary is gitignored (exceeds GitHub's 100 MB per-file
limit) and built locally; this registry entry is required regardless of whether
the binary is present. BSD-3-Clause text: see Appendix.

## public/models/colorizer.onnx
License: Apache-2.0
Upstream: https://github.com/piddnad/DDColor
Weights: https://huggingface.co/piddnad/DDColor-models — `ddcolor_paper_tiny.pth`; ONNX export recipe in `apps/vision/scripts/convert-colorizer.py` (project's own `scripts/export_onnx.py` at pinned commit `2adb63f`).
Copyright: DDColor authors (Kang et al., piddnad)
Note: the ~214 MB fp32 binary is gitignored and built locally (pure-local
provisioning); this registry entry is required regardless of whether the binary
is present. Apache-2.0 text: see Appendix.

## public/models/harmonizer.onnx
License: MPL-2.0
Upstream: https://github.com/rakutentech/PCT-Net-Image-Harmonization
Weights: `PCTNet_ViT.pth` (pinned commit `1572176`); ONNX export recipe in `apps/vision/scripts/convert-harmonizer.py` (low-res branch of PCTNet(ViT_pct)).
Copyright: Rakuten Group, Inc. (PCT-Net authors)
Note: the ~19 MB binary is gitignored and built locally (pure-local
provisioning) — it is never distributed in the bundle, so MPL-2.0's obligation
is satisfied by the source form (the upstream repo linked above) rather than a
bundled license text. This registry entry is required regardless of whether the
binary is present. Full MPL-2.0 text: https://www.mozilla.org/en-US/MPL/2.0/.

## public/models/fbcnn.onnx
License: Apache-2.0
Upstream: https://github.com/jiaxi-jiang/FBCNN
Weights: `fbcnn_color.pth` (release v1.0, pinned commit `54d1831`); ONNX export recipe in `apps/vision/scripts/convert-fbcnn.py` (image-only path).
Copyright: FBCNN authors (Jiang et al.)
Note: the ~288 MB binary is gitignored and built locally (pure-local
provisioning); this registry entry is required regardless of whether the binary
is present. Apache-2.0 text: see Appendix.

## public/models/font_classifier.onnx
License: MIT
Upstream: https://huggingface.co/gaborcselle/font-identifier (rev `31f4fc6ac302c2c6beede9822737de00f0e2fdad`)
Weights: `model.safetensors` — microsoft/resnet-18 (Apache-2.0) fine-tuned on 49 fonts; ONNX export recipe in `apps/vision/scripts/convert-font-classifier.py`.
Copyright: Gabor Cselle (font-identifier); base arch © Microsoft (ResNet, Apache-2.0)
Note: the ~45 MB binary is gitignored and built locally (pure-local
provisioning); this registry entry is required regardless of whether the binary
is present. MIT text: see Appendix.

## public/models/sd/text_encoder/model.onnx
License: Not shipped — no upstream redistribution license
Upstream: https://huggingface.co/optimum-internal-testing/tiny-stable-diffusion-onnx
Weights: random, untrained tiny-stable-diffusion placeholder; copyright exposure ≈ nil (random weights + boilerplate configs)
Note: optional local development placeholder only; it is not tracked, and
`public/models/.gitignore` excludes the entire `sd/` directory from release input.

## public/models/sd/unet/model.onnx
License: Not shipped — no upstream redistribution license
Upstream: https://huggingface.co/optimum-internal-testing/tiny-stable-diffusion-onnx
Weights: random, untrained tiny-stable-diffusion placeholder; copyright exposure ≈ nil (random weights + boilerplate configs)
Note: optional local development placeholder only; not tracked or released.

## public/models/sd/vae_decoder/model.onnx
License: Not shipped — no upstream redistribution license
Upstream: https://huggingface.co/optimum-internal-testing/tiny-stable-diffusion-onnx
Weights: random, untrained tiny-stable-diffusion placeholder; copyright exposure ≈ nil (random weights + boilerplate configs)
Note: optional local development placeholder only; not tracked or released.

## public/models/sd/tokenizer/vocab.json
License: MIT
Upstream: https://github.com/openai/CLIP
Weights: OpenAI CLIP BPE vocabulary (the only non-random content in the sd/ placeholder)
Copyright (c) 2021 OpenAI
Note: excluded with the local-development `sd/` directory; MIT text: see Appendix.

## public/models/sd/tokenizer/merges.txt
License: MIT
Upstream: https://github.com/openai/CLIP
Weights: OpenAI CLIP BPE merges (the only non-random content in the sd/ placeholder)
Copyright (c) 2021 OpenAI
Note: excluded with the local-development `sd/` directory; MIT text: see Appendix.

## public/ort/
License: MIT
Upstream: https://github.com/microsoft/onnxruntime (onnxruntime-web)
Weights: prebuilt wasm runtime (`ort-wasm-simd-threaded*.{wasm,mjs}`) shipped alongside the models; loaded by `src/ml/onnx.ts`
Copyright (c) Microsoft Corporation
Note: not walked by `check:models` (registry entry kept for NOTICE completeness).
MIT text: see Appendix.

---

## Excluded artifacts and open provenance notes

- **MI-GAN HF weights repo untagged; README links a sibling artifact.** The
  uncertain `migan.onnx` blob is no longer tracked or shipped. Re-enable it only
  after upstream directly confirms redistribution terms for that exact blob.

- **Code provenance (NVIDIA-derived code in MI-GAN's *training* repo).** The
  MI-GAN training repo vendors StyleGAN2-ADA-derived `torch_utils/ops`
  (upfirdn2d, bias_act; NVIDIA-origin). Vision redistributes neither that code
  nor MI-GAN weights.

- **Dataset provenance (Places2/Places365).** MI-GAN-512 (and the leading LaMa
  replacement) are trained on Places2. "Weights as derivative works of training
  data" is an untested minority theory; MIT CSAIL itself releases Places-trained
  models under **CC BY** (github.com/CSAILVision/places365). No MI-GAN weights
  are in the current release.

---

## Appendix: full license texts

### MIT License

```
MIT License

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

Applies to the `onnxruntime-web` runtime under `public/ort/` (© Microsoft
Corporation). It also covers OpenAI CLIP tokenizer files if a developer installs
the local-only SD demo; those files are not tracked or released by Vision.

### BSD-3-Clause License

```
BSD 3-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice, this
   list of conditions and the following disclaimer.

2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

3. Neither the name of the copyright holder nor the names of its contributors
   may be used to endorse or promote products derived from this software
   without specific prior written permission.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS" AND
ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE IMPLIED
WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE ARE
DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE LIABLE
FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR CONSEQUENTIAL
DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF SUBSTITUTE GOODS OR
SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS INTERRUPTION) HOWEVER
CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN CONTRACT, STRICT LIABILITY,
OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE) ARISING IN ANY WAY OUT OF THE USE
OF THIS SOFTWARE, EVEN IF ADVISED OF THE POSSIBILITY OF SUCH DAMAGE.
```

Applies to: the five fast-neural-style nets (`candy`, `mosaic`, `pointilism`,
`rain`, `udnie` — © pytorch/examples contributors), `super-res.onnx`
(© pytorch/examples contributors), and `drunet_color.onnx` (© deepinv
contributors).

### BSD-2-Clause License

Redistribution and use in source and binary forms, with or without
modification, are permitted provided that the following conditions are met:

1. Redistributions of source code must retain the above copyright notice,
   this list of conditions and the following disclaimer.
2. Redistributions in binary form must reproduce the above copyright notice,
   this list of conditions and the following disclaimer in the documentation
   and/or other materials provided with the distribution.

THIS SOFTWARE IS PROVIDED BY THE COPYRIGHT HOLDERS AND CONTRIBUTORS "AS IS"
AND ANY EXPRESS OR IMPLIED WARRANTIES, INCLUDING, BUT NOT LIMITED TO, THE
IMPLIED WARRANTIES OF MERCHANTABILITY AND FITNESS FOR A PARTICULAR PURPOSE
ARE DISCLAIMED. IN NO EVENT SHALL THE COPYRIGHT HOLDER OR CONTRIBUTORS BE
LIABLE FOR ANY DIRECT, INDIRECT, INCIDENTAL, SPECIAL, EXEMPLARY, OR
CONSEQUENTIAL DAMAGES (INCLUDING, BUT NOT LIMITED TO, PROCUREMENT OF
SUBSTITUTE GOODS OR SERVICES; LOSS OF USE, DATA, OR PROFITS; OR BUSINESS
INTERRUPTION) HOWEVER CAUSED AND ON ANY THEORY OF LIABILITY, WHETHER IN
CONTRACT, STRICT LIABILITY, OR TORT (INCLUDING NEGLIGENCE OR OTHERWISE)
ARISING IN ANY WAY OUT OF THE USE OF THIS SOFTWARE, EVEN IF ADVISED OF THE
POSSIBILITY OF SUCH DAMAGE.

### Apache License 2.0

The complete canonical text is in [`LICENSE-APACHE-2.0`](LICENSE-APACHE-2.0),
which is copied into every release beside this NOTICE. Applies to:
`u2netp.onnx` (© Xuebin Qin et al.) and the onnx/models zoo redistribution
covering `super-res.onnx`.

## Lensfun calibration database

License: CC-BY-SA-3.0

Copyright © Lensfun database authors and contributors. Monet includes an adapted
rectilinear profile catalog from Lensfun revision
`84401750ea96c67db927801cca9be28139db1a50`. See `NOTICE-LENSFUN.md`,
`LICENSE-LENSFUN`, and `lensfun-attribution.json` for its source, modifications,
license, and author acknowledgements.
