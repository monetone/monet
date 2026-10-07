#!/usr/bin/env python3
"""Reproduce the Harmonize model (Neural Filters ▸ Harmonize) as ONNX.

Pure-local policy: the app never downloads weights. This documents how the
pinned `harmonizer.onnx` (registered in src/ml/modelRegistry.ts) was produced so
any user can rebuild the exact artifact and Import it.

Source model: PCT-Net ViT (rakutentech/PCT-Net-Image-Harmonization, MPL-2.0). We
export the LOW-RES branch of PCTNet(ViT_pct) as a 2-input harmonizer.

Contract the app wires (src/ml/onnx.ts `harmonizeML`):
    input "image" float32 [1, 3, 256, 256]  composite RGB, [0,1]
    input "mask"  float32 [1, 1, 256, 256]  region mask, [0,1]
    output        float32 [1, 3, 256, 256]  harmonized RGB, [0,1]
The ViT_pct config uses input_normalization mean[0,0,0]/std[1,1,1] and color
space RGB, so NO ImageNet normalization is applied — the net runs on plain [0,1]
RGB. use_attn=False, so the net already composites the harmonized region inside
the mask and returns the untouched image outside it.

Notes on the export:
  - We reconstruct PCTNet's low-res forward in a thin wrapper and replace the
    library's `Linear_PCT.__call__` (which uses a per-batch in-place `out[n]=`
    that the ONNX tracer turns into an unexportable index_put_) with a vectorized
    batched matmul. The wrapper asserts byte-parity against the library PCT
    (max|Δ| < 1e-4) before exporting.
  - torch >= 2.9 defaults to the dynamo ONNX exporter, which guards on a
    data-dependent std check in torchvision's normalize; we force the legacy
    tracer with dynamo=False.

Steps (scratch venv):

    python3 -m venv venv && . venv/bin/activate
    pip install torch onnx onnxsim onnxruntime einops kornia timm

    # 1. Pinned checkpoint (MPL-2.0):
    curl -L -o PCTNet_ViT.pth \
      https://github.com/rakutentech/PCT-Net-Image-Harmonization/raw/main/pretrained_models/PCTNet_ViT.pth
    #   sha256 b2cf9260036f1e733d07a295f70f08d373593d64098727ff1798ddf2ff096aef

    # 2. Pinned architecture:
    git clone https://github.com/rakutentech/PCT-Net-Image-Harmonization.git pctnet_repo
    git -C pctnet_repo checkout 1572176ed1a72217dad7395391615329b98d30c7

    # 3. Export:
    python3 convert-harmonizer.py PCTNet_ViT.pth pctnet_repo harmonizer.onnx

Verified artifact (pin in modelRegistry.ts):
    sha256 9971c1fe428c07e53c6eaac94170299c20ba1cc536595e57f1f6f6762534cead
    bytes  19412185

MPL-2.0: with pure-local provisioning we do not distribute the artifact; the
MPL source form is the pinned upstream repo linked above.
"""
import sys

import numpy as np
import torch
import torch.nn as nn


def pct_linear(image, param):
    """Vectorized linear+affine PCT (dim=3, RGB ⇒ color_trf/norm identity).
    Row-major 3x3 from param[:9] + bias param[9:12], clamp 0..1. No in-place
    scatter (keeps the graph ONNX-exportable)."""
    N, _, H, W = image.shape
    x = image.permute(0, 2, 3, 1).reshape(N, H * W, 3, 1)
    M = param[:, :9].permute(0, 2, 3, 1).reshape(N, H * W, 3, 3)
    b = param[:, 9:12].permute(0, 2, 3, 1).reshape(N, H * W, 3, 1)
    y = torch.matmul(M, x) + b
    return torch.clamp(y.reshape(N, H, W, 3).permute(0, 3, 1, 2), 0, 1)


class Harmonize(nn.Module):
    def __init__(self, net):
        super().__init__()
        self.net = net

    def forward(self, image, mask):
        latent = self.net.encoder(torch.cat((image, mask), dim=1), None)
        out = pct_linear(image, self.net.get_params(latent))
        return out * mask + image * (1 - mask)


def export(ckpt: str, repo: str, out: str) -> None:
    sys.path.insert(0, repo)
    from iharm.model.base.pct_net import PCTNet  # noqa: E402

    net = PCTNet(
        backbone_type="ViT",
        input_normalization={"mean": [0, 0, 0], "std": [1, 1, 1]},
        dim=3, transform_type="linear", affine=True,
        clamp=True, color_space="RGB", use_attn=False,
    )
    net.load_state_dict(torch.load(ckpt, map_location="cpu", weights_only=True), strict=True)
    net.eval()

    wrap = Harmonize(net).eval()
    image = torch.rand(1, 3, 256, 256)
    mask = (torch.rand(1, 1, 256, 256) > 0.5).float()
    with torch.no_grad():
        ref = wrap(image, mask)
        param = net.get_params(net.encoder(torch.cat((image, mask), 1), None))
        lib = net.PCT(image, param) * mask + image * (1 - mask)
    err = (ref - lib).abs().max().item()
    assert err < 1e-4, f"vectorized PCT diverges from library: max|Δ|={err}"

    torch.onnx.export(
        wrap, (image, mask), out,
        opset_version=17,
        input_names=["image", "mask"], output_names=["output"],
        dynamo=False,
    )
    try:
        import onnx, onnxsim
        m, ok = onnxsim.simplify(onnx.load(out))
        assert ok
        onnx.save(m, out)
    except Exception as e:  # noqa: BLE001
        print("simplify skipped:", e)

    # Post-export check: region-only edit under onnxruntime.
    import onnxruntime as ort
    s = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    img = np.random.rand(1, 3, 256, 256).astype(np.float32)
    m2 = np.zeros((1, 1, 256, 256), np.float32); m2[:, :, 64:192, 64:192] = 1.0
    o = s.run(None, {"image": img, "mask": m2})[0]
    outside = float(np.abs(o - img)[:, :, :64, :64].mean())
    assert outside < 1e-5, f"pixels outside mask changed (Δ={outside})"
    print(f"OK  {out}: parity vs library max|Δ|={err:.2e}, region-only edit (outside Δ={outside:.1e})")


if __name__ == "__main__":
    export(
        sys.argv[1] if len(sys.argv) > 1 else "PCTNet_ViT.pth",
        sys.argv[2] if len(sys.argv) > 2 else "pctnet_repo",
        sys.argv[3] if len(sys.argv) > 3 else "harmonizer.onnx",
    )
