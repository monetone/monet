# 08 — Open items: conversions, trust anchor, encoder, BPC

Authored 2026-07-16, this plan covers the bounded product follow-ups listed in
[README.md](README.md), nothing else. All anchors below were read from the code
the same day.

## Goal & gates

Done means each item is **implemented + tested to a bounded claim**, or completed
as a runbook the user executes (cert purchase, hardware probe), or explicitly
re-deferred with rationale. House gates: `pnpm typecheck && pnpm lint && pnpm build`,
`pnpm test:unit`, `cargo test` in `packages/engine` where engine code changes,
`pnpm test:e2e`, `pnpm run check:models` when the registry changes; no skipped tests.

## Priority table

| # | Item | Actor | Effort | Status |
|---|------|-------|--------|--------|
| 1 | ONNX conversion batch (4 units) | agent | S-M each | **DONE** — Colorize/Harmonize/Photo-Restoration/Match-Font each have a reproducible recipe + validated registry pin |
| 2 | C2PA production-cert runbook | user buys, agent documents+verifies | S | **DONE (runbook)** — `docs/c2pa-signing.md`; cert purchase is the user's step |
| 3 | WebCodecs hardware probe → encoder swap | user probes, agent swaps | S + M | **Probe doc DONE** — `docs/webcodecs-probe.md`; swap waits on the user's probe result |
| 4 | Black Point Compensation | agent | M | **DONE** — proof and RGB conversion paths shipped; §4 |
| 5 | Video clip layers | — (decision) | — | Deferred; build only on explicit demand |

The remaining actions are external: certificate acquisition in item 2 and the
one-minute hardware probe in item 3.

---

## 1. ONNX conversion batch

**DONE (2026-07-16).** All four units converted from their authoritative pinned
checkpoints, validated under onnxruntime (correct IO, no ort-web-unsupported ops,
real output), and pinned in `modelRegistry.ts` with a reproducible
`apps/vision/scripts/convert-<unit>.py` recipe + MODELS.md row + license entry:

| Unit | Source (license) | Contract outcome | Artifact |
|---|---|---|---|
| colorizer | DDColor tiny (Apache-2.0) | wired stub was wrong ([1,1,256²] L−50); corrected `colorizeML` to DDColor's real [1,3,512²] gray-RGB → [1,2,512²] ab | `2d8107d8…` / 223,887,597 |
| harmonizer | PCT-Net ViT (MPL-2.0) | wired contract already correct (RGB config, no ImageNet norm); exported the low-res branch [image,mask]→[1,3,256²] | `9971c1fe…` / 19,412,185 |
| fbcnn | FBCNN color (Apache-2.0) | wired contract already correct; exported image-only path [1,3,256²]→[1,3,256²] | `23914bc9…` / 287,702,220 |
| font-classifier | gaborcselle/font-identifier (MIT) | M swap as predicted: resnet-18 [1,3,224²] ImageNet-norm → 49 logits; rewrote `matchFontML` + real labels + tests | `c3448d44…` / 44,801,677 |

Original planning notes below (kept for the contract detail).

Four registry rows await artifacts. Pure-local policy applies: conversions produce
**gitignored local artifacts** (like `drunet_color.onnx` / `sd15/`); the repo
deliverable is the conversion script + verified hash + docs, so any user can
reproduce the artifact and Import validates it.

**Shared harness** (established pattern — see `apps/vision/scripts/convert-sd15-fp16.py` and
the DRUNet recipe in MODELS.md): a scratch python venv (`torch`, `onnx`,
`onnxscript`), then node-side verification by actually running the artifact under
`onnxruntime-web` (copy the `.mjs` runner into `apps/vision` so `node_modules`
resolves), then `shasum -a 256` + byte size into `modelRegistry.ts`, a
"Getting models" row in MODELS.md, and a THIRD-PARTY-LICENSES.md entry.

The wired tensor contracts these conversions MUST match, **including input
normalization** — the thing a converter gets wrong silently (read from
`src/ml/onnx.ts` 2026-07-16; corrected per the plan's critic review):

| Unit | Wired contract | Normalization | Upstream | Known risk |
|---|---|---|---|---|
| colorizer | in `float32 [1,1,N,N]` (L channel) → out ab-chroma, resized back | **L − 50 centred** (`onnx.ts:601`), D65 `rgb2lab` per `onnx.ts:566-576` — a graph-wrap must reproduce exactly this | DDColor `ddcolor_paper_tiny.pth` (Apache-2.0, piddnad) | DDColor's native interface is reportedly RGB-in at fixed 512 — NOT L-in. Step 1 is inspecting the checkpoint's real IO; then either graph-wrap to the wired L→ab contract or adapt `colorizeML` **and its mocked tests** to the model's contract. Do not assume. |
| harmonizer | in `[1,3,N,N]` image + `[1,1,N,N]` mask → composited RGB | 0..1 ranges; **shape verified, semantics NOT** — PCT-Net may expect ImageNet normalization and may emit a low-res colour transform rather than a full image. Verify both + mask polarity against `harmonizeML`'s mask build. | PCT-Net ViT `PCTNet_ViT.pth` (MPL-2.0, rakutentech) | Semantic mismatch → adapt `harmonizeML` + mocked tests, same escape hatch as colorizer. |
| fbcnn (restore) | in `[1,3,N,N]` RGB → restored RGB, **fixed 256² single pass** (`RESTORE_SIZE`, no tiling — `onnx.ts:751`) | 0..1 | `fbcnn_color.pth` (Apache-2.0, jiaxi-jiang) | Export the image-only path (FBCNN also has a QF input/output). Dynamic H/W axes are OPTIONAL future-proofing — the wired path doesn't tile; don't over-build. |
| font-classifier | in `[1,1,105,105]` gray ONLY (`FONT_SIZE`, `onnx.ts:783,793` — DeepFont convention; there is **no** `[1,3,N,N]` path today) → class scores | 0..1 gray | `gaborcselle/font-identifier` (MIT, rev-pinned safetensors) | **This unit is M, not S — it swaps the architecture, not just labels.** font-identifier is an RGB classifier (~48 real fonts, likely 224²): the work is `FONT_SIZE` change, gray→RGB `[1,3,N,N]` CHW preprocessing matching the model's size/normalization, `FONT_CLASSES` (`onnx.ts:782`) → the model's real label list + label→installed-family mapping, and the mocked unit tests updated in lockstep (they assert the current shape — they will NOT stay green unchanged). Registry row's `TBD` license resolves to MIT with the conversion. |

Per-unit definition of done: conversion script in `apps/vision/scripts/`
(`convert-<unit>.py`), node verification run recorded in the script header
(what was asserted), registry row gains `sha256` + exact `bytes` (Import then
validates), MODELS.md row moves from "recipes to follow" to a concrete recipe,
license entry added, mocked-ONNX unit tests green — updated in lockstep wherever
a real model's contract forces a shape/normalization change (font-classifier
certainly; colorizer/harmonizer if their escape hatches trigger) — and the
absent-model e2e paths unchanged. MPL note (harmonizer): with pure-local provisioning we do not distribute
the artifact, but the script header still links the MPL-2.0 source form.

## 2. C2PA production trust anchor

Code-complete import path (`c2pa_sign.rs`; Preferences ▸ Content Credentials).
Remaining work is a **runbook** in `docs/c2pa-signing.md`:

1. Requirements for a C2PA-conformant signing cert (X.509 key usages/EKU per the
   C2PA spec; ES256/ES384/PS256/Ed25519 — `detect_alg` already trial-signs).
2. Acquisition options (commercial CA vs. org-internal CA for internal
   verifiability) — the purchase itself is the user's action.
3. Import + verify checklist: Preferences import → `c2pa_signer_info` shows the
   issuer/serial → export a signed PNG → verify at contentcredentials.org/verify
   (dev cert shows *untrusted*; the CA cert must show verified).
4. Out of scope (unchanged ponytail note): cert-expiry surfacing needs an X.509
   parser dependency.

## 3. WebCodecs encoder (Render Video)

- **Probe (user, one minute):** run `pnpm tauri dev` on real hardware, open the
  devtools console, run `typeof VideoEncoder` and
  `await VideoEncoder.isConfigSupported({codec:"avc1.42001f", width:1280, height:720})`.
  Report both results.
- **Swap (agent, if supported):** implement a WebCodecs encoder behind the
  existing `recordVideo(fps, {from,to,bitrate})` signature (Render Video dialog
  unchanged): VideoEncoder → muxed via MediaRecorder-less path (mp4 boxing is the
  real work — evaluate a minimal mp4 muxer vs. keeping WebM via VideoEncoder+
  webm muxing; pick the smaller correct one). MediaRecorder remains the fallback
  and the browser-e2e path. Bounded claim: faster-than-realtime encode on
  supported hardware, identical dialog semantics.

## 4. Black Point Compensation — done

Both meaningful paths now implement BPC:

- `ProofTransform` measures the proof medium's black point and the proof LUT
  lifts source black while holding white fixed. Proof Setup exposes the option,
  default-on unless Preserve Numbers makes it inapplicable.
- `Rgba16Transform` measures a custom RGB destination's reproducible black in
  source space and applies the same shadow-preserving lift. Convert to Profile
  exposes an enabled, default-on checkbox and forwards it to the engine.

The behavioral tests cover a raised-black destination, shadow preservation,
fixed white, and the expected numeric no-op between bundled matrix RGB profiles,
which reproduce true zero black. ICC-driven RGB→CMYK export remains a separate
feature because the current CMYK exporter has no destination ICC transform.

## 5. Video clip layers — no change

Stays deferred; build only on explicit demand. Not scheduled here.

## User actions summarized

- Buy/issue the C2PA cert (item 2, step 2).
- Run the one-minute WebCodecs probe on real hardware (item 3).
- Everything else is agent-executable under the house gates.
