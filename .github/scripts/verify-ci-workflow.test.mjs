import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const workflow = readFileSync(new URL("../workflows/ci.yml", import.meta.url), "utf8");
const rootPackage = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
const monetFormatPackage = JSON.parse(readFileSync(new URL("../../packages/monet-ui/packages/monet-format/package.json", import.meta.url), "utf8"));
const workspaceEvents = "if: github.event_name == 'pull_request' || github.event_name == 'push' || github.event_name == 'workflow_dispatch'";
const mergeEvents = "if: github.event_name == 'push' || github.event_name == 'workflow_dispatch'";
const binaryEvents = "if: github.event_name == 'workflow_dispatch' && inputs.packaged_smoke";

function jobSection(job, nextJob) {
  return workflow.slice(workflow.indexOf(`  ${job}:`), workflow.indexOf(`  ${nextJob}:`));
}

function exact(text) {
  return new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
}

test("root build:engines generates every app engine required by monorepo typecheck", () => {
  const command = rootPackage.scripts?.["build:engines"] ?? "";
  for (const app of ["monet-artisan", "monet-cinema", "monet-vision", "monet-galerie"]) {
    assert.match(command, new RegExp(`pnpm --filter ${app} run engine:build:release`));
  }
});

test("monet-format WASM build uses a portable crate-relative output path", () => {
  const command = monetFormatPackage.scripts?.["build:wasm"] ?? "";
  assert.match(command, /--out-dir "\.\.\/\.\.\/packages\/monet-format\/wasm"/);
  assert.doesNotMatch(command, /\$\(/);
});

test("Artisan engine builds use a portable path to the app's generated bindings", () => {
  const pkg = JSON.parse(readFileSync(new URL("../../apps/artisan/package.json", import.meta.url), "utf8"));
  const crate = fileURLToPath(new URL("../../packages/engine/", import.meta.url));
  const expected = fileURLToPath(new URL("../../apps/artisan/engine/pkg", import.meta.url));
  for (const script of ["engine:build", "engine:build:release"]) {
    const command = pkg.scripts[script];
    assert.doesNotMatch(command, /\$PWD|\$\(/);
    const output = command.match(/--out-dir (\S+)/)?.[1];
    assert.ok(output, `${script} must specify its generated output directory`);
    assert.equal(resolve(crate, output), expected, `${script} must write the bindings the app imports`);
  }
});

test("root test aggregate includes recursive units and documentation contracts", () => {
  const command = rootPackage.scripts?.test ?? "";
  assert.match(command, /pnpm -r --if-present run test:unit/);
  assert.match(command, /pnpm run test:docs/);
});

test("workspace static builds all app engines before monorepo typecheck", () => {
  const job = jobSection("pr-static", "pr-unit");
  const engines = job.indexOf("- run: pnpm run build:engines");
  const typecheck = job.indexOf("- name: Monorepo typecheck");
  assert.ok(engines >= 0, "workspace static must run the root all-engine build");
  assert.ok(typecheck > engines, "workspace static must generate all ignored @engine packages before root typecheck");
});

test("workspace static checks all seven app MCP manifests", () => {
  assert.match(jobSection("pr-static", "pr-unit"), /run: pnpm run mcp:check/);
  assert.match(rootPackage.scripts["mcp:check"], /pnpm -r --if-present run mcp:check/);
  for (const app of ["anime", "artisan", "cinema", "galerie", "jouer", "rythme", "vision"]) {
    const pkg = JSON.parse(readFileSync(new URL(`../../apps/${app}/package.json`, import.meta.url), "utf8"));
    assert.ok(pkg.scripts["mcp:check"], `${app} must participate in the root MCP gate`);
  }
});

test("all CI Node installations use the contributor default in .nvmrc", () => {
  const version = readFileSync(new URL("../../.nvmrc", import.meta.url), "utf8").trim();
  const installs = [...workflow.matchAll(/node-version: (\d+)/g)].map((match) => match[1]);
  assert.ok(installs.length > 0, "CI must install Node");
  assert.ok(installs.every((installed) => installed === version), "CI must test the documented Node version");
});

test("workspace static checks run for pull requests, main pushes, and manual dispatches", () => {
  assert.match(jobSection("pr-static", "pr-unit"), new RegExp(workspaceEvents.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("workspace unit checks run for pull requests, main pushes, and manual dispatches", () => {
  assert.match(jobSection("pr-unit", "pr-product-smoke"), new RegExp(workspaceEvents.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
});

test("workspace unit runs the root test aggregate including documentation contracts", () => {
  const job = jobSection("pr-unit", "pr-product-smoke");
  const engines = job.indexOf("- run: pnpm run build:engines");
  const tests = job.indexOf("run: pnpm run test");
  assert.ok(engines >= 0, "workspace unit must run the root all-engine build");
  assert.ok(tests > engines, "workspace unit must generate all ignored @engine packages before recursive tests");
  assert.match(job, /run: pnpm run test(?:\n|$)/);
});

test("changed-file coverage ratchet runs only when a pull-request base SHA exists", () => {
  const job = jobSection("pr-unit", "pr-product-smoke");
  const step = job.slice(job.indexOf("- name: Ratchet changed Vision source coverage"), job.indexOf("- name: Full locked engine tests"));
  assert.match(step, /if: github\.event_name == 'pull_request'/);
  assert.match(step, /github\.event\.pull_request\.base\.sha/);
});

test("workflow exposes PR, main-push, and manual runs without retired dedicated lanes", () => {
  assert.match(workflow, /pull_request: \{\}/);
  assert.match(workflow, /push:\n\s+branches: \[main\]/);
  assert.match(workflow, /workflow_dispatch:\n\s+inputs:\n\s+packaged_smoke:/);
  assert.doesNotMatch(workflow, /schedule:|nightly-dedicated-host|release-oracle/);
});

test("PR product smoke runs Vision smoke and fast Artisan engine regressions", () => {
  const job = jobSection("pr-product-smoke", "merge-full-browser");
  assert.match(job, /CHROME_BIN: \/usr\/bin\/google-chrome/);
  assert.match(job, /playwright install --with-deps chromium webkit/);
  assert.match(job, /playwright test e2e\/feature-regressions\.spec\.ts --project=chromium/);
  assert.match(job, /playwright test e2e\/webkit-smoke\.spec\.ts --project=webkit/);
  assert.match(job, /playwright test --project=desktop/);
  assert.match(job, /pnpm --filter monet-artisan run engine:build:release/);
  assert.match(job, /pnpm --filter monet-artisan run e2e:raster/);
  assert.match(job, /pnpm --filter monet-artisan run e2e:svg/);
});

test("merge browser, Artisan, desktop, and native jobs run only on protected merge events", () => {
  assert.match(jobSection("merge-full-browser", "merge-full-artisan"), exact(mergeEvents));
  assert.match(jobSection("merge-full-artisan", "merge-full-desktop-release"), exact(mergeEvents));
  assert.match(jobSection("merge-full-desktop-release", "merge-full-native"), exact(mergeEvents));
  assert.match(jobSection("merge-full-native", "self-hosted-source"), exact(mergeEvents));
});

test("merge browser, Artisan, desktop, and native jobs execute their required gates", () => {
  assert.match(jobSection("merge-full-browser", "merge-full-artisan"), /playwright test --project=chromium --shard=/);
  const artisan = jobSection("merge-full-artisan", "merge-full-desktop-release");
  assert.match(artisan, /CHROME_BIN: \/usr\/bin\/google-chrome/);
  assert.match(artisan, /run: pnpm --filter monet-artisan run engine:build:release/);
  assert.match(artisan, /run: pnpm --filter monet-artisan run e2e:all/);
  const desktop = jobSection("merge-full-desktop-release", "merge-full-native");
  assert.match(desktop, /run: pnpm --filter monet-vision run verify:release/);
  assert.match(desktop, /playwright install chromium webkit/);
  assert.match(desktop, /playwright test e2e\/webkit-smoke\.spec\.ts e2e\/system-font-faces\.spec\.ts --project=webkit/);
  assert.match(desktop, /playwright test --project=desktop/);
  assert.match(jobSection("merge-full-native", "self-hosted-source"), /run: pnpm --filter monet-vision run test:native/);
});

test("hosted source gate validates an exact main or release ancestor", () => {
  const job = jobSection("self-hosted-source", "merge-full-packaged-smoke-preflight");
  assert.match(job, /runs-on: ubuntu-latest/);
  assert.match(job, /validated_sha: \$\{\{ steps\.validate\.outputs\.validated_sha \}\}/);
  assert.match(job, /REQUESTED_SHA: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(job, /candidate_commit/);
  assert.match(job, /git merge-base --is-ancestor "\$requested" "origin\/main"/);
  assert.match(job, /refs\/remotes\/origin\/release/);
  assert.match(job, /validated_sha=%s/);
});

test("packaged binary jobs require an explicit manual request while source gates remain unconditional", () => {
  assert.match(workflow, /packaged_smoke:\n\s+description:[^\n]+\n\s+type: boolean\n\s+required: false\n\s+default: false/);
  for (const [jobName, nextJob] of [
    ["self-hosted-source", "merge-full-packaged-smoke-preflight"],
    ["merge-full-packaged-smoke-preflight", "merge-full-packaged-smoke-macos"],
    ["merge-full-packaged-smoke-macos", "merge-full-packaged-smoke-windows"],
    ["merge-full-packaged-smoke-windows", ""],
  ]) {
    const job = nextJob ? jobSection(jobName, nextJob) : workflow.slice(workflow.indexOf(`  ${jobName}:`));
    assert.match(job, exact(binaryEvents));
  }
  const sourceJobs = workflow.slice(workflow.indexOf("  pr-static:"), workflow.indexOf("  self-hosted-source:"));
  assert.doesNotMatch(sourceJobs, /inputs\.packaged_smoke|continue-on-error:/);
});

for (const [jobName, nextJob, prerequisite, environment] of [
  ["merge-full-packaged-smoke-macos", "merge-full-packaged-smoke-windows", "merge-full-packaged-smoke-preflight", "monet-vision-packaged-smoke"],
  ["merge-full-packaged-smoke-windows", "", "merge-full-packaged-smoke-preflight", "monet-vision-packaged-smoke"],
]) {
  test(`${jobName} consumes only the hosted-validated SHA behind a protected environment`, () => {
    const job = nextJob ? jobSection(jobName, nextJob) : workflow.slice(workflow.indexOf(`  ${jobName}:`));
    assert.match(job, new RegExp(`needs: \\[self-hosted-source, ${prerequisite}\\]`));
    assert.match(job, new RegExp(`environment: ${environment}`));
    assert.match(job, /ref: \$\{\{ needs\.self-hosted-source\.outputs\.validated_sha \}\}/);
    const verification = job.indexOf("Verify hosted-validated checkout before repository code");
    assert.ok(verification >= 0, "validated checkout must be verified on the self-hosted runner");
    assert.ok(job.indexOf("pnpm install --frozen-lockfile") > verification, "repository-controlled install must follow source verification");
  });
}

test("packaged smoke preflight requires pinned Apple and Windows signer identities", () => {
  const job = jobSection("merge-full-packaged-smoke-preflight", "merge-full-packaged-smoke-macos");
  for (const variable of [
    "MONET_PACKAGED_SMOKE_APPLE_TEAM_ID",
    "MONET_PACKAGED_SMOKE_APPLE_SIGNING_AUTHORITY",
    "MONET_PACKAGED_SMOKE_WINDOWS_CERTIFICATE_THUMBPRINT",
  ]) {
    assert.match(job, new RegExp(variable));
  }
  assert.match(job, /10-character Apple Team ID/);
  assert.match(job, /exact trusted codesign Authority/);
  assert.match(job, /40-character certificate thumbprint/);
});

test("packaged macOS smoke pins signer identity and archives its attestation", () => {
  const job = jobSection("merge-full-packaged-smoke-macos", "merge-full-packaged-smoke-windows");
  assert.match(job, /TeamIdentifier=/);
  assert.match(job, /Authority=\$MONET_PACKAGED_SMOKE_APPLE_SIGNING_AUTHORITY/);
  assert.match(job, /MONET_PACKAGED_SMOKE_SIGNATURE_ATTESTATION/);
  assert.match(job, /vision-packaged-smoke-macos-signature/);
});

test("packaged Windows smoke pins certificate identity and archives its attestation", () => {
  const job = workflow.slice(workflow.indexOf("  merge-full-packaged-smoke-windows:"));
  assert.match(job, /SignerCertificate\.Thumbprint/);
  assert.match(job, /MONET_PACKAGED_SMOKE_WINDOWS_CERTIFICATE_THUMBPRINT/);
  assert.match(job, /MONET_PACKAGED_SMOKE_SIGNATURE_ATTESTATION/);
  assert.match(job, /vision-packaged-smoke-windows-signature/);
});

test("packaged verifier receives the exact pinned signer identity", () => {
  const macos = jobSection("merge-full-packaged-smoke-macos", "merge-full-packaged-smoke-windows");
  assert.match(macos, /verify-packaged-smoke-result\.mjs[^\n]+\$MONET_PACKAGED_SMOKE_APPLE_TEAM_ID[^\n]+\$MONET_PACKAGED_SMOKE_APPLE_SIGNING_AUTHORITY/);
  const windows = workflow.slice(workflow.indexOf("  merge-full-packaged-smoke-windows:"));
  assert.match(windows, /verify-packaged-smoke-result\.mjs[^\n]+\$env:MONET_PACKAGED_SMOKE_WINDOWS_CERTIFICATE_THUMBPRINT/);
});

test("workspace static enforces helper tests and the no-skip policy", () => {
  const job = jobSection("pr-static", "pr-unit");
  assert.match(job, /node --test \.github\/scripts\/\*\.test\.mjs/);
  assert.match(job, /node \.github\/scripts\/verify-no-test-skips\.mjs/);
});
