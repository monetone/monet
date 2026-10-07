import { spawnSync } from "node:child_process";
import { readdirSync, statSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const app = resolve(import.meta.dirname, "..");
const repo = resolve(app, "../..");
const manifest = resolve(repo, "packages/engine/Cargo.toml");
const outputDir = resolve(app, "engine/pkg");
export const ENGINE_OUTPUT_NAMES = [
  "monet_render_engine.js",
  "monet_render_engine_bg.wasm",
  "monet_render_engine.d.ts",
  "monet_render_engine_bg.wasm.d.ts",
  "package.json",
];

function walk(root, found = []) {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (entry.name === "target" || entry.name === "pkg" || entry.name.startsWith(".")) continue;
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) walk(path, found);
    else if (
      extname(entry.name) === ".rs" ||
      entry.name === "Cargo.toml" ||
      entry.name === "Cargo.lock" ||
      entry.name.startsWith("rust-toolchain")
    ) found.push(path);
  }
  return found;
}

export function discoverEngineInputs() {
  const result = spawnSync(
    "cargo",
    ["metadata", "--format-version", "1", "--manifest-path", manifest],
    { cwd: repo, encoding: "utf8" },
  );
  if (result.status !== 0) throw new Error(`cargo metadata failed:\n${result.stderr || result.stdout}`);
  const metadata = JSON.parse(result.stdout);
  const roots = new Set(
    metadata.packages
      .filter((pkg) => pkg.source == null && pkg.manifest_path.startsWith(`${repo}/`))
      .map((pkg) => dirname(pkg.manifest_path)),
  );
  const inputs = [...roots].flatMap((root) => walk(root));
  inputs.push(resolve(repo, "packages/engine/Cargo.lock"));
  return [...new Set(inputs)].sort();
}

export function requireFreshEngine(inputs, outputs) {
  let oldestOutput = Infinity;
  for (const output of outputs) {
    let modified;
    try {
      modified = statSync(output).mtimeMs;
    } catch {
      throw new Error("Galerie engine package is missing; run pnpm --filter monet-galerie engine:build");
    }
    oldestOutput = Math.min(oldestOutput, modified);
  }
  const stale = inputs.find((input) => statSync(input).mtimeMs > oldestOutput);
  if (stale) {
    throw new Error(
      `Galerie engine package is stale (${stale}); run pnpm --filter monet-galerie engine:build`,
    );
  }
}

export function main() {
  requireFreshEngine(
    discoverEngineInputs(),
    ENGINE_OUTPUT_NAMES.map((name) => resolve(outputDir, name)),
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
