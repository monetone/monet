import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("../", import.meta.url));
const runtimePath = "apps/vision/public/ort/ort-wasm-simd-threaded.jsep.mjs";

async function filteredRuntime(t, includeAttributes) {
  const directory = await mkdtemp(path.join(tmpdir(), "monet-ort-autocrlf-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const runtime = path.join(directory, runtimePath);
  await mkdir(path.dirname(runtime), { recursive: true });
  await copyFile(path.join(root, runtimePath), runtime);
  if (includeAttributes) await copyFile(path.join(root, ".gitattributes"), path.join(directory, ".gitattributes"));

  // Inherited repository locators/config must never redirect this disposable
  // index into the source checkout or supply unrelated attribute rules.
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.toUpperCase().startsWith("GIT_")));
  const globalConfig = path.join(directory, "empty.gitconfig");
  await writeFile(globalConfig, "");
  Object.assign(env, { GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: globalConfig, GIT_ATTR_NOSYSTEM: "1" });
  const git = (...args) => execFileSync("git", [
    "-C", directory,
    "-c", "core.autocrlf=true",
    "-c", "core.safecrlf=false",
    "-c", "core.attributesfile=",
    "-c", "init.defaultBranch=main",
    ...args,
  ], { env, stdio: ["ignore", "pipe", "pipe"] });

  git("init", "--quiet");
  git("add", "--", ...(includeAttributes ? [".gitattributes"] : []), runtimePath);
  const blob = git("rev-parse", `:${runtimePath}`).toString("utf8").trim();
  const indexed = git("cat-file", "blob", blob);
  const filtered = git("cat-file", "--filters", `--path=${runtimePath}`, blob);
  await rm(runtime);
  git("checkout-index", "--force", "--", runtimePath);
  return { indexed, filtered, checkedOut: await readFile(runtime) };
}

test("the byte-pinned ONNX runtime survives Git checkout with Windows autocrlf", async (t) => {
  const original = await readFile(path.join(root, runtimePath));
  const protectedRuntime = await filteredRuntime(t, true);
  assert.ok(protectedRuntime.indexed.equals(original), "the indexed runtime must retain the upstream bytes");
  assert.ok(protectedRuntime.filtered.equals(original), "Windows checkout filtering must retain the upstream bytes");
  assert.ok(protectedRuntime.checkedOut.equals(original), "a fresh Windows checkout must retain the upstream bytes");

  // Prove this exercises the failure mode: without the real attributes file,
  // Git adds CRLF bytes even though its indexed upstream blob remains intact.
  const unprotectedRuntime = await filteredRuntime(t, false);
  assert.ok(unprotectedRuntime.indexed.equals(original), "the control index must contain the canonical upstream blob");
  assert.ok(!unprotectedRuntime.filtered.equals(original), "the control must reproduce line-ending conversion without attributes");
  assert.ok(unprotectedRuntime.filtered.includes(Buffer.from("\r\n")));
  assert.ok(unprotectedRuntime.checkedOut.equals(unprotectedRuntime.filtered), "the control checkout must apply the damaging filter");
});
