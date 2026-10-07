// u2net — pure pre/post-processing for the U²-Net (u2netp) salient-object
// segmentation model used by the Select Subject mask. The ONNX session +
// inference live in subjectMask.ts (runtime, WASM); this is the DOM-free,
// unit-tested math: build the model's input tensor from an RGBA image, and
// turn its raw output into a 0..1 coverage field. Faithful to Vision's proven
// segMask pipeline (apps/vision/src/ml/onnx.ts): 320×320, ImageNet
// normalization, min-max output normalization.

/** U²-Net input side length (square). */
export const U2NET_SIZE = 320;
const MEAN = [0.485, 0.456, 0.406];
const STD = [0.229, 0.224, 0.225];

/** Nearest-neighbour resample of an RGBA image to dw×dh (pure, allocation-only). */
export function resampleRgba(
  src: Uint8ClampedArray,
  sw: number,
  sh: number,
  dw: number,
  dh: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(dw * dh * 4);
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(sh - 1, Math.floor((y * sh) / dh));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(sw - 1, Math.floor((x * sw) / dw));
      const s = (sy * sw + sx) * 4;
      const d = (y * dw + x) * 4;
      out[d] = src[s];
      out[d + 1] = src[s + 1];
      out[d + 2] = src[s + 2];
      out[d + 3] = src[s + 3];
    }
  }
  return out;
}

/** Resize an RGBA image to 320×320 and pack it as an ImageNet-normalized NCHW
 *  float32 tensor (`[1,3,320,320]` worth of data). */
export function preprocessU2Net(
  rgba: Uint8ClampedArray,
  width: number,
  height: number,
): Float32Array {
  const n = U2NET_SIZE;
  const plane = n * n;
  const rd = resampleRgba(rgba, width, height, n, n);
  const chw = new Float32Array(3 * plane);
  for (let p = 0; p < plane; p++) {
    chw[p] = (rd[p * 4] / 255 - MEAN[0]) / STD[0];
    chw[plane + p] = (rd[p * 4 + 1] / 255 - MEAN[1]) / STD[1];
    chw[2 * plane + p] = (rd[p * 4 + 2] / 255 - MEAN[2]) / STD[2];
  }
  return chw;
}

/** Min-max normalize the model's 320×320 saliency output to a 0..1 coverage
 *  field (constant output → all zeros, i.e. no selection). */
export function postprocessU2Net(output: Float32Array): Float32Array {
  const plane = U2NET_SIZE * U2NET_SIZE;
  let mn = Infinity;
  let mx = -Infinity;
  for (let i = 0; i < plane; i++) {
    const v = output[i];
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const range = mx - mn;
  const cov = new Float32Array(plane);
  if (range <= 0) return cov;
  for (let i = 0; i < plane; i++) cov[i] = (output[i] - mn) / range;
  return cov;
}

/** Resample a 320×320 coverage field to width×height (nearest neighbour). */
export function resampleCoverage(
  coverage: Float32Array,
  width: number,
  height: number,
): Float32Array {
  const n = U2NET_SIZE;
  const out = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    const sy = Math.min(n - 1, Math.floor((y * n) / height));
    for (let x = 0; x < width; x++) {
      const sx = Math.min(n - 1, Math.floor((x * n) / width));
      out[y * width + x] = coverage[sy * n + sx];
    }
  }
  return out;
}
