import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { assertPinnedManifest, differenceStats } from "./shared-core-proof-contract.mjs";

const app = resolve(import.meta.dirname, "..");
const repo = resolve(app, "../..");
const manifest = JSON.parse(readFileSync(resolve(app, "proofs/shared-core/manifest.json"), "utf8"));
const recipePath = resolve(app, "proofs/shared-core/recipe-v2.json");
const source = resolve(app, manifest.source);
const output = resolve(app, "src-tauri/target/shared-core-proof");
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");

if (hash(readFileSync(source)) !== manifest.sourceDigest) throw new Error("ColorChecker source digest mismatch");
const native = spawnSync(
  "cargo",
  [
    "run", "--quiet", "--manifest-path", resolve(app, "src-tauri/Cargo.toml"),
    "--bin", "shared_core_fixture", "--", source, recipePath, output,
  ],
  { cwd: repo, encoding: "utf8" },
);
if (native.status !== 0) throw new Error(`native product proof failed:\n${native.stderr || native.stdout}`);
const report = JSON.parse(native.stdout);

const packed = readFileSync(resolve(output, "decoded.mdev16"));
const view = new DataView(packed.buffer, packed.byteOffset, packed.byteLength);
if (packed.subarray(0, 4).toString() !== "MGRW" || view.getUint16(4, true) !== 3) {
  throw new Error("invalid decoded mdev16 envelope");
}
const headerLength = view.getUint16(6, true);
const width = view.getUint32(8, true);
const height = view.getUint32(12, true);
const orientation = packed[24];
const bitDepth = packed[25];
const metadataLength = view.getUint32(28, true);
const sampleCount = Number(view.getBigUint64(32, true));
const samplesStart = headerLength + metadataLength;
if (
  width !== manifest.inputWidth ||
  height !== manifest.inputHeight ||
  sampleCount !== width * height * 4 ||
  samplesStart + sampleCount * 2 !== packed.length
) throw new Error("decoded mdev16 dimensions/length mismatch");
const metadata = JSON.parse(packed.subarray(headerLength, samplesStart).toString("utf8"));
const pixels = new Uint16Array(sampleCount);
for (let i = 0; i < sampleCount; i++) pixels[i] = view.getUint16(samplesStart + i * 2, true);

const modulePath = resolve(app, "engine/pkg/monet_render_engine.js");
const wasmPath = resolve(app, "engine/pkg/monet_render_engine_bg.wasm");
const { default: init, Engine } = await import(modulePath);
await init({ module_or_path: readFileSync(wasmPath) });
const provenance = JSON.stringify({
  sourceDigest: report.provenance.sourceDigest,
  backend: report.provenance.backend,
  backendRevision: report.provenance.backendRevision,
  decoderVersion: report.provenance.decoderVersion,
  activeArea: report.provenance.activeArea,
  workingProfileDigest: report.provenance.workingProfileDigest,
  decodeIntentDigest: report.provenance.decodeIntentDigest,
  alphaMode: "opaque",
});
const engine = Engine.fromDevelopRgba16(width, height, pixels, true, orientation, provenance);
const canonical = Engine.canonicalizeDevelopRecipe(readFileSync(recipePath, "utf8"));
engine.developRecipe(canonical, metadata.scaleNumerator, metadata.scaleDenominator);
const wasm = engine.developedRgba16();
const wasmWidth = engine.width();
const wasmHeight = engine.height();
engine.free();
if (wasmWidth !== manifest.outputWidth || wasmHeight !== manifest.outputHeight) {
  throw new Error("native/WASM output dimensions differ");
}

const nativeBytes = readFileSync(resolve(output, "native.rgba16le"));
if (nativeBytes.length !== wasm.length * 2) {
  throw new Error("native/WASM output byte lengths differ");
}
const nativeSamples = new Uint16Array(wasm.length);
const nativeView = new DataView(nativeBytes.buffer, nativeBytes.byteOffset, nativeBytes.byteLength);
for (let i = 0; i < nativeSamples.length; i++) nativeSamples[i] = nativeView.getUint16(i * 2, true);
const { maxDifference, samplesOverOne, p99Difference } = differenceStats(wasm, nativeSamples);
const wasmBytes = Buffer.allocUnsafe(wasm.length * 2);
const display = Buffer.allocUnsafe(wasm.length);
for (let i = 0; i < wasm.length; i++) {
  wasmBytes.writeUInt16LE(wasm[i], i * 2);
  display[i] = Math.floor((wasm[i] + 128) / 257);
}
const wasmDigest = hash(wasmBytes);
const displayDigest = hash(display);
if (report.nativeDisplayDigest !== displayDigest) {
  throw new Error("native/WASM rounded-display digests differ");
}
const actualManifest = {
  version: 1,
  source: manifest.source,
  sourceDigest: report.sourceDigest,
  decodeIntent: report.decodeIntent,
  testedOsBuild: report.metadata.osBuild,
  decoderBackend: report.metadata.decoderBackend,
  backendRevision: report.metadata.backendRevision,
  decoderVersion: report.metadata.decoderVersion,
  decodedInputDigest: report.decodedInputDigest,
  decodedInputPayloadByteLength: sampleCount * 2,
  inputWidth: width,
  inputHeight: height,
  bitDepth,
  encoding: report.encoding,
  transfer: metadata.transfer,
  range: metadata.range,
  sourceOrientation: orientation,
  outputOrientation: metadata.outputOrientation,
  activeArea: metadata.activeArea,
  workingProfileDigest: metadata.workingProfileDigest,
  baseRendering: metadata.baseRendering,
  provenanceDigest: metadata.provenanceDigest,
  recipeDigest: report.recipeDigest,
  outputWidth: wasmWidth,
  outputHeight: wasmHeight,
  nativeOutputDigest: report.nativeOutputDigest,
  nativeOutputByteLength: nativeBytes.length,
  wasmOutputDigest: wasmDigest,
  wasmOutputByteLength: wasmBytes.length,
  displayDigest,
  displayByteLength: display.length,
  maxDifference,
  samplesOverOne,
  p99Difference,
};
assertPinnedManifest(actualManifest, manifest);
if (maxDifference > 1 || samplesOverOne !== 0 || p99Difference !== 0) {
  throw new Error(
    `native/WASM mismatch: max=${maxDifference} overOne=${samplesOverOne} p99=${p99Difference}`,
  );
}

console.log(JSON.stringify({
  pass: true,
  sourceDigest: report.sourceDigest,
  decodedInputDigest: report.decodedInputDigest,
  decodedInputPayloadByteLength: sampleCount * 2,
  recipeDigest: report.recipeDigest,
  dimensions: [wasmWidth, wasmHeight],
  nativeOutputDigest: report.nativeOutputDigest,
  nativeOutputByteLength: nativeBytes.length,
  wasmOutputDigest: wasmDigest,
  wasmOutputByteLength: wasmBytes.length,
  displayDigest,
  displayByteLength: display.length,
  maxDifference,
  samplesOverOne,
  p99Difference,
  provenanceDigest: report.metadata.provenanceDigest,
  osBuild: report.metadata.osBuild,
  decoderVersion: report.metadata.decoderVersion,
}));
