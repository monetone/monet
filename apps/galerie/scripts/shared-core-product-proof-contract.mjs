import assert from "node:assert/strict";
import test from "node:test";

import { assertPinnedManifest, differenceStats } from "./shared-core-proof-contract.mjs";

test("every manifest key is enforced", () => {
  const manifest = {
    version: 1,
    source: "fixture.raw",
    sourceDigest: "a",
    decodeIntent: { mode: "asShot" },
    testedOsBuild: "os",
    decoderBackend: "backend",
    backendRevision: "revision",
    decoderVersion: "decoder",
    decodedInputDigest: "b",
    decodedInputPayloadByteLength: 8,
    inputWidth: 1,
    inputHeight: 1,
    bitDepth: 16,
    encoding: "linearSrgbU16Full",
    transfer: "linear",
    range: "full",
    sourceOrientation: 1,
    outputOrientation: 1,
    activeArea: [0, 0, 1, 1],
    workingProfileDigest: "c",
    baseRendering: "profile",
    provenanceDigest: "d",
    recipeDigest: "e",
    outputWidth: 1,
    outputHeight: 1,
    nativeOutputDigest: "f",
    nativeOutputByteLength: 8,
    wasmOutputDigest: "f",
    wasmOutputByteLength: 8,
    displayDigest: "g",
    displayByteLength: 4,
    maxDifference: 0,
    samplesOverOne: 0,
    p99Difference: 0,
  };
  assert.doesNotThrow(() => assertPinnedManifest(structuredClone(manifest), manifest));
  for (const key of Object.keys(manifest)) {
    const changed = structuredClone(manifest);
    changed[key] = typeof changed[key] === "number" ? changed[key] + 1 : `${JSON.stringify(changed[key])}x`;
    assert.throws(() => assertPinnedManifest(changed, manifest), new RegExp(key));
  }
});

test("p99 retains differences above 255", () => {
  const actual = new Uint16Array(100).fill(1000);
  const expected = new Uint16Array(100);
  assert.deepEqual(differenceStats(actual, expected), {
    maxDifference: 1000,
    samplesOverOne: 100,
    p99Difference: 1000,
  });
});
