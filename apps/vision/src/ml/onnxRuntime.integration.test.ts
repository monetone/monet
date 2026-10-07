// Real onnxruntime-web integration test. Every other ML test (onnx.test.ts)
// mocks onnxruntime-web entirely, so the actual wasm-backend tensor plumbing the
// BYO models rely on — float32 [1,3,H,W] image + [1,1,H,W] mask feeds, session
// run, output reshape — is never exercised in CI. This runs a tiny committed
// SYNTHETIC ONNX (src/ml/__fixtures__/tiny-inpaint.onnx, no trained weights, see
// scripts/gen-onnx-test-fixture.py) through the REAL runtime to catch a
// dtype/shape/name/polarity regression that the mocks structurally cannot.
//
// The fixture computes `output = image * (1 - mask)`, so it doubles as an
// executable proof that mask 1 = HOLE (zeroed) / 0 = KEEP — the LaMa convention
// (inverted vs MI-GAN) that lamaFillML in onnx.ts depends on.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import * as ort from "onnxruntime-web";

const FIXTURE = readFileSync(new URL("./__fixtures__/tiny-inpaint.onnx", import.meta.url));

describe("onnxruntime-web real inference contract", () => {
  let session: ort.InferenceSession;

  beforeAll(async () => {
    ort.env.wasm.numThreads = 1; // single-thread → deterministic, no worker setup in CI
    session = await ort.InferenceSession.create(FIXTURE, { executionProviders: ["wasm"] });
  }, 30_000);

  it("accepts the LaMa image+mask float32 contract and treats mask=1 as the hole", async () => {
    expect(session.inputNames).toEqual(["image", "mask"]);
    const N = 512, plane = N * N; // the real LaMa working resolution
    const image = new Float32Array(3 * plane).fill(0.5);
    const mask = new Float32Array(plane);
    for (let i = 0; i < plane; i++) mask[i] = (i % N) < N / 2 ? 1 : 0; // left half = hole

    const out = await session.run({
      image: new ort.Tensor("float32", image, [1, 3, N, N]),
      mask: new ort.Tensor("float32", mask, [1, 1, N, N]),
    });
    const o = out[session.outputNames[0]];
    expect(o.dims).toEqual([1, 3, N, N]);
    expect(o.type).toBe("float32");
    const data = o.data as Float32Array;
    // Left column (mask=1) is the hole → zeroed; right column (mask=0) is kept.
    // This is the polarity lamaFillML sends (1=hole); a flip here would surface.
    expect(data[0]).toBe(0);
    expect(data[N - 1]).toBeCloseTo(0.5, 6);
  });

  it("accepts the denoise-shaped [1,3,T,T] float32 contract (all-keep mask → identity)", async () => {
    const T = 256, plane = T * T; // the aiDenoise tile size
    const image = Float32Array.from({ length: 3 * plane }, (_, i) => (i % 255) / 255);
    const mask = new Float32Array(plane); // all 0 → keep everything
    const out = await session.run({
      image: new ort.Tensor("float32", image, [1, 3, T, T]),
      mask: new ort.Tensor("float32", mask, [1, 1, T, T]),
    });
    const o = out[session.outputNames[0]];
    expect(o.dims).toEqual([1, 3, T, T]);
    expect((o.data as Float32Array)[100]).toBeCloseTo(image[100], 5);
  });

});
