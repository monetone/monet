#!/usr/bin/env python3
"""Reproduce the Match Font model (Type ▸ Match Font, image AI) as ONNX.

Pure-local policy: the app never downloads weights. This documents how the pinned
`font_classifier.onnx` (registered in src/ml/modelRegistry.ts) was produced so
any user can rebuild the exact artifact and Import it.

Source model: gaborcselle/font-identifier (MIT) — a microsoft/resnet-18 fine-tuned
to classify 49 fonts. This is NOT a DeepFont gray model: the checkpoint's own
preprocessor_config.json declares do_convert_rgb + do_normalize (ImageNet
mean/std) at 224², so the wired matchFontML was swapped from the [1,1,105,105]
gray stub to this architecture in lockstep.

Contract the app wires (src/ml/onnx.ts `matchFontML`):
    input  "input"  float32 [1, 3, 224, 224]  RGB, ImageNet-normalized
    output "logits" float32 [1, 49]           class scores (id2label index order)
FONT_CLASSES in onnx.ts is the checkpoint's id2label in index order.

Steps (scratch venv):

    python3 -m venv venv && . venv/bin/activate
    pip install torch transformers onnx onnxsim onnxruntime safetensors numpy

    # 1. Pinned weights + config (MIT), revision 31f4fc6ac302c2c6beede9822737de00f0e2fdad:
    #    huggingface.co/gaborcselle/font-identifier
    #    model.safetensors   sha256 b928a5e6d8b9bc888fa263180f1f56b06e65b3de046d94453f8e1072f131fec4
    # Arrange a local dir with config.json + model.safetensors + preprocessor_config.json.

    # 2. Export:
    python3 convert-font-classifier.py ./font_model font_classifier.onnx

Verified artifact (pin in modelRegistry.ts):
    sha256 c3448d4439e109bb613f9407b41e6395ebe908910939c8b375448c753a7279ad
    bytes  44801677
"""
import sys

import numpy as np
import torch
import torch.nn as nn


def export(model_dir: str, out: str) -> None:
    from transformers import AutoModelForImageClassification

    m = AutoModelForImageClassification.from_pretrained(model_dir).eval()
    assert m.config.num_labels == 49, m.config.num_labels

    class Font(nn.Module):
        def __init__(self, m):
            super().__init__()
            self.m = m
        def forward(self, x):
            return self.m(pixel_values=x).logits

    x = torch.rand(1, 3, 224, 224)
    torch.onnx.export(
        Font(m).eval(), (x,), out,
        opset_version=17, input_names=["input"], output_names=["logits"], dynamo=False,
    )
    try:
        import onnx, onnxsim
        mm, ok = onnxsim.simplify(onnx.load(out))
        assert ok
        onnx.save(mm, out)
    except Exception as e:  # noqa: BLE001
        print("simplify skipped:", e)

    import onnxruntime as ort
    s = ort.InferenceSession(out, providers=["CPUExecutionProvider"])
    o = s.run(None, {"input": np.random.rand(1, 3, 224, 224).astype(np.float32)})[0]
    assert o.shape == (1, 49), o.shape
    print(f"OK  {out}: logits {o.shape}")


if __name__ == "__main__":
    export(
        sys.argv[1] if len(sys.argv) > 1 else "font_model",
        sys.argv[2] if len(sys.argv) > 2 else "font_classifier.onnx",
    )
