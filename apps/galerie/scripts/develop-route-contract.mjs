import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const app = resolve(import.meta.dirname, "..");
const tauri = resolve(app, "src-tauri");
const read = (path) => readFileSync(resolve(app, path), "utf8");
const json = (path) => JSON.parse(readFileSync(resolve(tauri, path), "utf8"));

test("shipped develop route registration, ACL, commands, and wire values stay aligned", () => {
  const build = read("src-tauri/build.rs");
  const runtime = read("src-tauri/src/develop_job.rs");
  const main = read("src-tauri/src/main.rs");
  const frontend = read("src/export.ts");
  const capability = json("capabilities/default.json");
  const generatedCapabilities = json("gen/schemas/capabilities.json");
  const acl = json("gen/schemas/acl-manifests.json");
  const desktop = JSON.stringify(json("gen/schemas/desktop-schema.json"));
  const commands = [
    "run_develop_export",
    "cancel_develop_export",
    "get_develop_export_status",
  ];

  assert.match(build, /\.plugin\(\s*"develop-job"/s);
  for (const command of commands) {
    assert.match(build, new RegExp(`"${command}"`));
    assert.match(runtime, new RegExp(`\\b${command}\\b`));
    assert.ok(acl["develop-job"].default_permission.permissions.includes(
      `allow-${command.replaceAll("_", "-")}`,
    ));
    assert.match(desktop, new RegExp(command.replaceAll("_", "-")));
  }
  assert.match(main, /\.plugin\(develop_job::init\(\)\)/);
  assert.ok(capability.windows.includes("main"));
  assert.ok(capability.windows.includes("secondary"));
  assert.ok(capability.permissions.includes("develop-job:default"));
  assert.ok(generatedCapabilities.default.permissions.includes("develop-job:default"));
  assert.match(frontend, /plugin:develop-job\|run_develop_export/);
  const nativeRoute = frontend.match(/async function developNativeTiff[\s\S]*?\n}\n/)?.[0] ?? "";
  const nativeResult = runtime.match(/pub struct DevelopJobResult[\s\S]*?\n}\n/)?.[0] ?? "";
  assert.doesNotMatch(nativeRoute, /\b(?:rgba|pixels|bytes)\b/);
  assert.doesNotMatch(nativeResult, /\b(?:frame|pixels|bytes)\b/);
  assert.match(runtime, /current_develop_export_identity/);
  assert.match(runtime, /validate_catalog_binding/);
  for (const wireName of [
    "jobId",
    "catalogId",
    "photoId",
    "expectedDigest",
    "canonicalRecipeJson",
    "displayP3",
    "srgb",
  ]) {
    assert.match(frontend, new RegExp(`\\b${wireName}\\b`));
  }
  assert.match(runtime, /rename_all = "camelCase"/);
});
