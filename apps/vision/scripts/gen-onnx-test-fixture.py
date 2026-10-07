# Regenerates src/ml/__fixtures__/tiny-inpaint.onnx — a ~200-byte SYNTHETIC ONNX
# (no trained weights) used by src/ml/onnxRuntime.integration.test.ts to exercise
# the REAL onnxruntime-web tensor path in CI (every other ML test mocks ORT).
#
# The graph computes `output = image * (1 - mask)` for a float32 image[1,3,H,W]
# + mask[1,1,H,W] (dynamic H/W), so the test both validates the LaMa I/O contract
# (names/dtypes/shapes) and asserts, executably, that mask 1 = HOLE (zeroed) and
# 0 = KEEP — the polarity lamaFillML depends on (inverted vs MI-GAN).
#
# Reproduce:  python -m venv venv && venv/bin/pip install onnx numpy
#             venv/bin/python scripts/gen-onnx-test-fixture.py
import os
import numpy as np
import onnx
from onnx import helper, numpy_helper, TensorProto

OUT = os.path.join(os.path.dirname(__file__), "..", "src", "ml", "__fixtures__", "tiny-inpaint.onnx")

image = helper.make_tensor_value_info("image", TensorProto.FLOAT, [1, 3, "H", "W"])
mask = helper.make_tensor_value_info("mask", TensorProto.FLOAT, [1, 1, "H", "W"])
output = helper.make_tensor_value_info("output", TensorProto.FLOAT, [1, 3, "H", "W"])
one = numpy_helper.from_array(np.array([1.0], dtype=np.float32), name="one")
nodes = [
    helper.make_node("Sub", ["one", "mask"], ["keep"]),   # keep = 1 - mask
    helper.make_node("Mul", ["image", "keep"], ["output"]),  # broadcast [1,1,H,W] over [1,3,H,W]
]
graph = helper.make_graph(nodes, "tiny_inpaint", [image, mask], [output], initializer=[one])
model = helper.make_model(graph, opset_imports=[helper.make_opsetid("", 13)])
model.ir_version = 9
onnx.checker.check_model(model)
onnx.save(model, OUT)
print("wrote", os.path.relpath(OUT), os.path.getsize(OUT), "bytes")
