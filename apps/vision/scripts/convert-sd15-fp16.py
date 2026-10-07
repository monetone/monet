#!/usr/bin/env python
"""Build ort-web-compatible SD-1.5 weights from onnx-community fp32.

Recipe (validated): text_encoder + unet → fp16 via
onnxruntime.transformers.float16 (keep_io_types=True → fp32 graph IO, so
diffusion.ts is unchanged; standard ops, NO com.microsoft contrib ops), then
run through onnxruntime's BASIC graph optimizer which eliminates the inserted
precision-free casts that ort-web's strict type checker rejects. VAEs stay fp32
(SD's fp16 VAE is numerically unstable — the 'black image' bug — and it's only
~165MB more). Output → out/<comp>/model.onnx, all <2GB inline single files."""
import sys, os, shutil
import onnx
import onnxruntime as ort
from onnxruntime.transformers.float16 import convert_float_to_float16

SRC, OUT = "fp32", "out"
FP16 = ["text_encoder", "unet"]
FP32_COPY = ["vae_decoder", "vae_encoder"]
ET = {1: "f32", 10: "f16", 6: "i32", 7: "i64"}

def contrib_ops(m):
    return sorted({n.op_type for n in m.graph.node if (n.domain or "").startswith("com.microsoft")})

def ort_basic_optimize(in_path, out_path):
    so = ort.SessionOptions()
    so.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_BASIC
    so.optimized_model_filepath = out_path
    ort.InferenceSession(in_path, so, providers=["CPUExecutionProvider"])  # side effect: writes optimized model

def report(path, label):
    m = onnx.load(path)
    c = contrib_ops(m)
    assert not c, f"{label}: contrib ops present {c}"
    ins = [(i.name, ET.get(i.type.tensor_type.elem_type, i.type.tensor_type.elem_type)) for i in m.graph.input]
    outs = [(o.name, ET.get(o.type.tensor_type.elem_type, o.type.tensor_type.elem_type)) for o in m.graph.output]
    print(f"  {label}: {os.path.getsize(path)/1e6:.1f}MB  IN={ins}  OUT={outs}  contrib=NONE", flush=True)

def convert_fp16(comp):
    src = os.path.join(SRC, comp, "model.onnx")
    out_dir = os.path.join(OUT, comp); os.makedirs(out_dir, exist_ok=True)
    tmp = os.path.join(out_dir, "_fp16_raw.onnx")
    final = os.path.join(out_dir, "model.onnx")
    print(f"\n=== {comp} (fp16 + ORT optimize) ===", flush=True)
    if comp == "unet":
        # fp32 unet graph is >2GB → file-based shape inference before convert.
        shaped = os.path.join(SRC, comp, "_shaped.onnx")
        onnx.shape_inference.infer_shapes_path(src, shaped)
        m = onnx.load(shaped)
        m16 = convert_float_to_float16(m, keep_io_types=True, disable_shape_infer=True)
        os.remove(shaped)
    else:
        m = onnx.load(src)
        m16 = convert_float_to_float16(m, keep_io_types=True)
    m16.graph.ClearField("value_info")
    onnx.save(m16, tmp, save_as_external_data=False)
    print(f"  fp16 raw saved ({os.path.getsize(tmp)/1e6:.1f}MB) → ORT BASIC optimize…", flush=True)
    ort_basic_optimize(tmp, final)
    os.remove(tmp)
    report(final, comp)

def copy_fp32(comp):
    out_dir = os.path.join(OUT, comp); os.makedirs(out_dir, exist_ok=True)
    final = os.path.join(out_dir, "model.onnx")
    print(f"\n=== {comp} (fp32 copy) ===", flush=True)
    shutil.copy(os.path.join(SRC, comp, "model.onnx"), final)
    report(final, comp)

if __name__ == "__main__":
    comps = sys.argv[1:] or (FP16 + FP32_COPY)
    for c in comps:
        (convert_fp16 if c in FP16 else copy_fp32)(c)
    print("\nALL DONE", flush=True)
