#!/usr/bin/env python3
"""Reproduce the Photo Restoration model (Neural Filters ▸ Photo Restoration) as ONNX.

Pure-local policy: the app never downloads weights. This documents how the pinned
`fbcnn.onnx` (registered in src/ml/modelRegistry.ts) was produced so any user can
rebuild the exact artifact and Import it.

Source model: FBCNN color (jiaxi-jiang/FBCNN, Apache-2.0). We export the
IMAGE-ONLY path — FBCNN's forward returns (restored_image, quality_factor); the
wired restoreML needs only the restored image, so the QF output is dropped and
qf_input is left None (the net estimates it internally).

Contract the app wires (src/ml/onnx.ts `restoreML`):
    input  "input"  float32 [1, 3, 256, 256]  composite RGB, [0,1]
    output "output" float32 [1, 3, 256, 256]  restored RGB (clamped app-side)

Steps (scratch venv):

    python3 -m venv venv && . venv/bin/activate
    pip install torch onnx onnxsim onnxruntime numpy

    # 1. Pinned checkpoint (Apache-2.0):
    curl -L -o fbcnn_color.pth \
      https://github.com/jiaxi-jiang/FBCNN/releases/download/v1.0/fbcnn_color.pth
    #   sha256 8b0e4ef23d59cf7ac934a342cb31a17619e4fa4a0b3374a9d78c5174312387e8

    # 2. Pinned architecture:
    git clone https://github.com/jiaxi-jiang/FBCNN.git fbcnn_repo
    git -C fbcnn_repo checkout 54d1831927506b3247e2d4d245abb4f4dab1a1cd

    # 3. Export:
    python3 convert-fbcnn.py fbcnn_color.pth fbcnn_repo fbcnn.onnx

Verified artifact (pin in modelRegistry.ts):
    sha256 23914bc9d91d535255559b03fc296f5dd21243f2e82632da7761d4dcb67bb8e8
    bytes  287702220
"""
import sys

import numpy as np
import torch
import torch.nn as nn


class Restore(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net
    def forward(self, x):
        y = self.net(x)  # (img_E, QF); qf_input=None => QF estimated internally
        return y[0] if isinstance(y, (tuple, list)) else y


def export(ckpt: str, repo: str, out: str) -> None:
    sys.path.insert(0, repo)
    from models.network_fbcnn import FBCNN  # noqa: E402

    net = FBCNN(in_nc=3, out_nc=3, nc=[64, 128, 256, 512], nb=4, act_mode="R")
    net.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True), strict=True)
    net.eval()

    wrap = Restore(net).eval()
    x = torch.rand(1, 3, 256, 256)
    torch.onnx.export(
        wrap, (x,), out,
        opset_version=17, input_names=["input"], output_names=["output"], dynamo=False,
    )
    try:
        import onnx, onnxsim
        m, ok = onnxsim.simplify(onnx.load(out))
        assert ok
        onnx.save(m, out)
    except Exception as e:  # noqa: BLE001
        print("simplify skipped:", e)

    import onnxruntime as ort
    s = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    o = s.run(None, {"input": np.random.rand(1, 3, 256, 256).astype(np.float32)})[0]
    assert o.shape == (1, 3, 256, 256), o.shape
    print(f"OK  {out}: output {o.shape}, range [{o.min():.3f}, {o.max():.3f}]")


if __name__ == "__main__":
    export(
        sys.argv[1] if len(sys.argv) > 1 else "fbcnn_color.pth",
        sys.argv[2] if len(sys.argv) > 2 else "fbcnn_repo",
        sys.argv[3] if len(sys.argv) > 3 else "fbcnn.onnx",
    )
