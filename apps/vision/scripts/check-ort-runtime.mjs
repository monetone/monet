import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const files = [
  "ort-wasm-simd-threaded.jsep.mjs",
  "ort-wasm-simd-threaded.jsep.wasm",
];

const mismatches = files.filter((file) => {
  const shipped = readFileSync(fileURLToPath(new URL(`../public/ort/${file}`, import.meta.url)));
  const installed = readFileSync(fileURLToPath(new URL(`../node_modules/onnxruntime-web/dist/${file}`, import.meta.url)));
  return !shipped.equals(installed);
});

if (mismatches.length) {
  console.error(`check:ort FAILED — public runtime differs from installed onnxruntime-web: ${mismatches.join(", ")}`);
  process.exit(1);
}
console.log(`check:ort OK — ${files.length} external runtime files match installed onnxruntime-web.`);
