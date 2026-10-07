import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { extname, resolve } from "node:path";

import { assertPinnedManifest } from "./shared-core-proof-contract.mjs";

const app = resolve(import.meta.dirname, "..");
const repo = resolve(app, "../..");
const fixtures = JSON.parse(readFileSync(resolve(app, "proofs/raw-fixtures.json"), "utf8"));
const expected = JSON.parse(readFileSync(resolve(app, "proofs/raw-orientation.json"), "utf8"));
const fixture = fixtures.fixtures.find(({ id }) => id === expected.fixtureId);
if (!fixture) throw new Error(`orientation fixture ${expected.fixtureId} is not in the CC0 manifest`);
if (fixtures.license !== expected.license || fixture.orientation === 1) {
  throw new Error("orientation fixture is not a pinned CC0 non-1 source");
}

const source = resolve(app, expected.source);
if (extname(source).toLowerCase() !== `.${fixture.format.toLowerCase()}`) {
  throw new Error("orientation fixture format/path mismatch");
}
const sourceDigest = createHash("sha256").update(readFileSync(source)).digest("hex");
if (sourceDigest !== fixture.sha256) throw new Error("orientation fixture SHA-256 mismatch");

const output = resolve(app, "src-tauri/target/raw-orientation-product-proof");
const native = spawnSync(
  "cargo",
  [
    "run",
    "--quiet",
    "--manifest-path",
    resolve(app, "src-tauri/Cargo.toml"),
    "--bin",
    "shared_core_fixture",
    "--",
    source,
    resolve(app, "proofs/shared-core/recipe-v2.json"),
    output,
  ],
  { cwd: repo, encoding: "utf8" },
);
if (native.status !== 0) {
  throw new Error(`native orientation proof failed:\n${native.stderr || native.stdout}`);
}
const report = JSON.parse(native.stdout);
const packed = readFileSync(resolve(output, "decoded.mdev16"));
const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
const headerLength = view.getUint16(6, true);
const metadataLength = view.getUint32(28, true);
const metadata = JSON.parse(
  packed.subarray(headerLength, headerLength + metadataLength).toString("utf8"),
);
assert.deepEqual(report.probe, {
  decoderBackend: metadata.decoderBackend,
  backendRevision: metadata.backendRevision,
  decoderVersion: metadata.decoderVersion,
  osBuild: metadata.osBuild,
  nativeWidth: metadata.nativeWidth,
  nativeHeight: metadata.nativeHeight,
  activeArea: metadata.activeArea,
  sourceOrientation: metadata.sourceOrientation,
  outputOrientation: metadata.outputOrientation,
  orientationApplied: metadata.orientationApplied,
  workingProfileDigest: metadata.workingProfileDigest,
  outputWidth: metadata.outputWidth,
  outputHeight: metadata.outputHeight,
  scaleNumerator: metadata.scaleNumerator,
  scaleDenominator: metadata.scaleDenominator,
});
if (
  packed.subarray(0, 4).toString() !== "MGRW" ||
  view.getUint16(4, true) !== 3 ||
  packed[24] !== fixture.orientation ||
  view.getUint16(26, true) !== 7
) {
  throw new Error("native orientation envelope did not carry the applied orientation");
}

const actual = {
  version: 1,
  fixtureId: fixture.id,
  source: expected.source,
  sourceDigest: report.sourceDigest,
  license: fixtures.license,
  testedOsBuild: metadata.osBuild,
  decoderBackend: metadata.decoderBackend,
  backendRevision: metadata.backendRevision,
  decoderVersion: metadata.decoderVersion,
  maxEdge: 1024,
  nativeWidth: metadata.nativeWidth,
  nativeHeight: metadata.nativeHeight,
  inputWidth: report.inputWidth,
  inputHeight: report.inputHeight,
  sourceOrientation: metadata.sourceOrientation,
  outputOrientation: metadata.outputOrientation,
  orientationApplied: metadata.orientationApplied,
  activeArea: metadata.activeArea,
  scaleNumerator: metadata.scaleNumerator,
  scaleDenominator: metadata.scaleDenominator,
  workingProfileDigest: metadata.workingProfileDigest,
  decodeIntentDigest: metadata.decodeIntentDigest,
  decodedInputDigest: report.decodedInputDigest,
  provenanceDigest: metadata.provenanceDigest,
};
assertPinnedManifest(actual, expected);
if (
  actual.sourceOrientation === 1 ||
  actual.outputOrientation !== 1 ||
  !actual.orientationApplied ||
  actual.nativeWidth <= actual.nativeHeight ||
  actual.inputWidth >= actual.inputHeight ||
  actual.activeArea[2] === 0 ||
  actual.activeArea[3] === 0 ||
  actual.activeArea[0] + actual.activeArea[2] > actual.nativeWidth ||
  actual.activeArea[1] + actual.activeArea[3] > actual.nativeHeight ||
  JSON.stringify(actual.activeArea) ===
    JSON.stringify([0, 0, actual.inputWidth, actual.inputHeight])
) {
  throw new Error("native orientation geometry semantics are invalid");
}

console.log(JSON.stringify({ pass: true, ...actual }));
