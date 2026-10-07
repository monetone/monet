import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { releaseModelFiles } from "./check-model-licenses.mjs";

const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
const dist = path.join(root, "dist");
const sourceModels = path.join(root, "public", "models");
const tokenizerFiles = new Set(["vocab.json", "merges.txt"]);

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    return statSync(file).isDirectory() ? walk(file) : [file];
  });
}

if (!existsSync(dist)) throw new Error("dist is missing; run the release build first");

for (const name of ["THIRD-PARTY-LICENSES.md", "LICENSE-APACHE-2.0", "LICENSE-OPENJPEG", "LICENSE-LENSFUN", "NOTICE-LENSFUN.md", "lensfun-attribution.json"]) {
  const source = path.join(root, "public", name);
  const bundled = path.join(dist, name);
  if (!existsSync(bundled) || !readFileSync(source).equals(readFileSync(bundled)))
    throw new Error(`${name} is missing or differs from the audited public copy`);
}

const textAssets = walk(dist).filter((file) => /\.(?:html|css|js|mjs)$/.test(file));
for (const file of textAssets) {
  if (/(^|[^$\w])__mv(?![$\w])/.test(readFileSync(file, "utf8")))
    throw new Error(`test hook identifier __mv is present in ${path.relative(dist, file)}`);
}

const sourceModelFiles = walk(sourceModels)
  .filter((file) => file.endsWith(".onnx") || tokenizerFiles.has(path.basename(file)))
  .map((file) => `public/models/${path.relative(sourceModels, file).split(path.sep).join("/")}`);
const excludes = readFileSync(path.join(sourceModels, ".gitignore"), "utf8");
const expectedModels = releaseModelFiles(sourceModelFiles, excludes).sort();
const actualModels = walk(path.join(dist, "models"))
  .filter((file) => file.endsWith(".onnx") || tokenizerFiles.has(path.basename(file)))
  .map((file) => `public/models/${path.relative(path.join(dist, "models"), file).split(path.sep).join("/")}`)
  .sort();
if (JSON.stringify(actualModels) !== JSON.stringify(expectedModels))
  throw new Error(`release model set differs from audit\nexpected: ${expectedModels.join(", ")}\nactual: ${actualModels.join(", ")}`);

const expectedOrt = ["ort-wasm-simd-threaded.jsep.mjs", "ort-wasm-simd-threaded.jsep.wasm"];
const actualOrt = walk(path.join(dist, "ort"))
  .filter((file) => path.basename(file).startsWith("ort-wasm"))
  .map((file) => path.basename(file))
  .sort();
if (JSON.stringify(actualOrt) !== JSON.stringify(expectedOrt))
  throw new Error(`release ORT runtime set is wrong: ${actualOrt.join(", ")}`);
const strayOrt = walk(path.join(dist, "assets")).filter((file) => path.basename(file).startsWith("ort-wasm"));
if (strayOrt.length) throw new Error(`duplicate ORT runtime emitted in assets: ${strayOrt.map(path.basename).join(", ")}`);

console.log(`verify:bundle OK — no test hook; ${actualModels.length} models and ${actualOrt.length} ORT runtime files exactly match release policy.`);
