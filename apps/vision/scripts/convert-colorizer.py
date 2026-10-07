#!/usr/bin/env python3
"""Reproduce the Colorize model (Neural Filters ▸ Colorize) as ONNX.

Pure-local policy: the app never downloads weights. This script documents how
the pinned `colorizer.onnx` (registered in src/ml/modelRegistry.ts) was produced
so any user can rebuild the exact artifact and Import it.

Source model: DDColor tiny (piddnad/DDColor, Apache-2.0). We export from the
authoritative checkpoint using the project's OWN export script rather than
mirroring a third-party community ONNX.

Contract the app wires (src/ml/onnx.ts `colorizeML`):
    input  "input"  float32 [1, 3, 512, 512]  neutral-gray RGB, lab2rgb([L,0,0]), [0,1]
    output "output" float32 [1, 2, 512, 512]  CIELAB ab chroma
The checkpoint is exported with do_normalize=False, so no ImageNet norm is baked
in — the TS wrapper feeds raw [0,1] gray-RGB and recombines the returned ab with
the full-resolution L.

Steps (run in a scratch venv; ~200 MB download, fp32 output ~214 MB):

    python3 -m venv venv && . venv/bin/activate
    pip install torch onnx onnxsim onnxruntime opencv-python-headless timm

    # 1. Pinned checkpoint (Apache-2.0):
    curl -L -o ddcolor_paper_tiny.pth \
      https://huggingface.co/piddnad/DDColor-models/resolve/main/ddcolor_paper_tiny.pth
    #   sha256 81dd643904f4664c3718513e3320ae3db0c567f0d3e18398606659adee7bfc17

    # 2. Pinned architecture + export script:
    git clone https://github.com/piddnad/DDColor.git ddcolor_repo
    git -C ddcolor_repo checkout 2adb63f2656ac41cbdf7b894cddd94121a3faf13

    # 3. Export (their script; convnext-t, MultiScaleColorDecoder, num_queries=100):
    python ddcolor_repo/scripts/export_onnx.py \
      --model_path ddcolor_paper_tiny.pth --model_size tiny \
      --decoder_type MultiScaleColorDecoder \
      --input_size 512 --batch_size 1 --opset 17 \
      --export_path colorizer.onnx
    #   onnxsim simplifies + bumps to opset 18; result has no ort-web-unsupported ops.

Verified artifact (pin in modelRegistry.ts):
    sha256 2d8107d875ef4e0c0df3516e28bfb74e7ecb1dabb0633735000b48b6d4843d1c
    bytes  223887597

This module runs the same verification the pin relies on: shape + op-set check
and a real gray→ab colorization asserting non-degenerate chroma.
"""
import sys

import numpy as np
import onnx
import onnxruntime as ort

ORT_WEB_UNSUPPORTED = {
    "NhwcConv", "GridSample", "RoiAlign", "NonMaxSuppression", "DeformConv",
    "Col2Im", "STFT",
}


def verify(path: str) -> None:
    m = onnx.load(path)

    def shape(t):
        return [d.dim_value or d.dim_param for d in t.type.tensor_type.shape.dim]

    (inp,), (out,) = m.graph.input, m.graph.output
    assert shape(inp) == [1, 3, 512, 512], f"input shape {shape(inp)}"
    assert shape(out) == [1, 2, 512, 512], f"output shape {shape(out)}"

    bad = {n.op_type for n in m.graph.node} & ORT_WEB_UNSUPPORTED
    assert not bad, f"ort-web-unsupported ops present: {bad}"

    import cv2

    img = np.zeros((512, 512, 3), np.float32)
    img[:, :, 2] = np.linspace(0, 1, 512)[None, :]
    img[:, :, 1] = np.linspace(0, 1, 512)[:, None]
    img[:, :, 0] = 0.4
    L = cv2.cvtColor(img, cv2.COLOR_BGR2Lab)[:, :, :1]
    gray = cv2.cvtColor(
        np.concatenate([L, np.zeros_like(L), np.zeros_like(L)], -1), cv2.COLOR_LAB2RGB
    )
    feed = gray.transpose(2, 0, 1)[None].astype(np.float32)

    s = ort.InferenceSession(path, providers=["CPUExecutionProvider"])
    ab = s.run(None, {s.get_inputs()[0].name: feed})[0]
    assert ab.shape == (1, 2, 512, 512), ab.shape
    assert float(ab.std()) > 3.0, f"chroma degenerate (std={ab.std():.2f})"
    print(f"OK  {path}: IO + op-set valid, ab std={ab.std():.2f} (non-degenerate)")


if __name__ == "__main__":
    verify(sys.argv[1] if len(sys.argv) > 1 else "colorizer.onnx")
