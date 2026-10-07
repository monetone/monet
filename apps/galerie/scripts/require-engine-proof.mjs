import assert from "node:assert/strict";
import { mkdirSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

import {
  discoverEngineInputs,
  ENGINE_OUTPUT_NAMES,
  requireFreshEngine,
} from "./require-engine.mjs";

test("discovers all local Rust/path-dependency inputs", () => {
  const inputs = discoverEngineInputs();
  for (const suffix of [
    "packages/engine/Cargo.toml",
    "packages/engine/Cargo.lock",
    "packages/engine/src/lib.rs",
    "packages/engine/src/raster/adjust.rs",
    "packages/engine/crates/monet-photo-core/src/cache_identity.rs",
    "packages/monet-ui/crates/monet-format/Cargo.toml",
    "packages/monet-ui/crates/monet-format/src/lib.rs",
  ]) {
    assert(inputs.some((input) => input.endsWith(suffix)), suffix);
  }
});

test("every generated output is required and freshness-checked", () => {
  const root = join(tmpdir(), `galerie-engine-freshness-${process.pid}-${Date.now()}`);
  mkdirSync(root);
  const input = join(root, "input.rs");
  const outputs = ENGINE_OUTPUT_NAMES.map((name) => join(root, name));
  writeFileSync(input, "");
  const now = new Date();
  const old = new Date(now.getTime() - 10_000);
  for (const output of outputs) writeFileSync(output, "");
  for (const output of outputs) {
    const remaining = outputs.filter((candidate) => candidate !== output);
    assert.throws(() => requireFreshEngine([input], remaining.concat(output + ".missing")), /missing/);
    utimesSync(output, old, old);
    assert.throws(() => requireFreshEngine([input], outputs), /stale/);
    utimesSync(output, now, now);
  }
  utimesSync(input, old, old);
  assert.doesNotThrow(() => requireFreshEngine([input], outputs));
});

test("Tauri release builds the engine then runs the ordinary build once", () => {
  const app = resolve(import.meta.dirname, "..");
  const packageJson = JSON.parse(readFileSync(resolve(app, "package.json"), "utf8"));
  const tauriConfig = JSON.parse(readFileSync(resolve(app, "src-tauri/tauri.conf.json"), "utf8"));

  assert.equal(packageJson.scripts.build, "pnpm engine:require && tsc --noEmit && vite build");
  assert.equal(
    tauriConfig.build.beforeBuildCommand,
    "pnpm engine:build:release && pnpm build",
  );
  assert.equal(packageJson.scripts.build.match(/\bvite build\b/g)?.length, 1);
});
