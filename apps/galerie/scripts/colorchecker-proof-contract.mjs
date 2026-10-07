import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { spawnSync } from "node:child_process";
import test, { after } from "node:test";
import { fileURLToPath } from "node:url";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const repo = join(app, "../..");
const manifest = JSON.parse(readFileSync(join(app, "proofs/raw-fixtures.json"), "utf8"));
const fixtureRecord = manifest.fixtures.find(({ id }) => id === "colorchecker-sony-ilce-7m2");
const fixture = fixtureRecord && join(app, "src-tauri/target/raw-fixtures", `${fixtureRecord.id}${extname(new URL(fixtureRecord.url).pathname)}`);
const sourceConfig = join(app, "proofs/colorchecker-967.json");
const binary = join(app, "src-tauri/target/debug/colorchecker_proof");
const temporary = mkdtempSync(join(tmpdir(), "monet-colorchecker-proof-"));
const expectedHash = "3db3047b3eaefe701c46ab3a6d4927071e9299cff3365e4c51e1b3390ce389f7";

function execute(command, args, cwd = repo) {
  return spawnSync(command, args, { cwd, encoding: null, stdio: ["ignore", "pipe", "pipe"] });
}

function parseFailure(result, status) {
  assert.notEqual(result.status, 0);
  const artifact = JSON.parse(result.stdout.toString("utf8"));
  assert.equal(artifact.status, status);
  return artifact;
}

function direct(config, input = fixture) {
  return execute(binary, [config, input]);
}

function writeConfig(name, mutate) {
  const config = JSON.parse(readFileSync(sourceConfig, "utf8"));
  mutate(config);
  const path = join(temporary, name);
  writeFileSync(path, JSON.stringify(config));
  return path;
}

after(() => rmSync(temporary, { recursive: true, force: true }));

test("ColorChecker proof command contract", async (t) => {
  assert.ok(fixtureRecord, "fixture manifest entry must exist");
  assert.ok(existsSync(fixture), "pinned fixture is missing; run proof:raw-acquire");

  const build = execute("cargo", [
    "build", "--quiet", "--manifest-path", join(app, "src-tauri/Cargo.toml"),
    "--features", "colorchecker-proof", "--bin", "colorchecker_proof",
  ]);
  assert.equal(build.status, 0, build.stderr.toString("utf8"));

  await t.test("missing fixture is parseable fail with nonzero status", () => {
    parseFailure(direct(sourceConfig, join(temporary, "missing.arw")), "fail");
  });

  await t.test("fixture SHA drift is parseable fail with nonzero status", () => {
    const wrong = join(temporary, "wrong.arw");
    writeFileSync(wrong, "not the pinned fixture");
    parseFailure(direct(sourceConfig, wrong), "fail");
  });

  await t.test("malformed geometry is parseable fail with nonzero status", () => {
    const config = writeConfig("geometry.json", (value) => {
      value.productGeometry.rows[1] = value.productGeometry.rows[0];
    });
    parseFailure(direct(config), "fail");
  });

  await t.test("reference digest drift is parseable fail with nonzero status", () => {
    const config = writeConfig("reference.json", (value) => {
      value.canonicalDigests.referenceTuplesSha256 = "0".repeat(64);
    });
    parseFailure(direct(config), "fail");
  });

  await t.test("config digest drift is parseable fail with nonzero status", () => {
    const config = writeConfig("config.json", (value) => {
      value.source.id = "drifted";
    });
    parseFailure(direct(config), "fail");
  });

  await t.test("accepted environment drift requires rebaseline and nonzero status", () => {
    const config = writeConfig("environment.json", (value) => {
      value.acceptedEnvironment.osBuild = "drifted";
      value.canonicalDigests.configSha256 = "5266102a17cec035099940a937259dd9e69d406a765544486725514aa8b2c88b";
    });
    parseFailure(direct(config), "rebaseline-required");
  });

  let accepted;
  await t.test("two valid runs retain exact green artifact bytes and measurements", () => {
    const first = direct(sourceConfig);
    const second = direct(sourceConfig);
    accepted = first.stdout;
    assert.equal(first.status, 0, first.stdout.toString("utf8"));
    assert.equal(second.status, 0);
    assert.deepEqual(second.stdout, first.stdout);
    assert.equal(createHash("sha256").update(first.stdout).digest("hex"), expectedHash);
    const artifact = JSON.parse(first.stdout.toString("utf8"));
    assert.equal(artifact.status, "pass");
    assert.deepEqual(artifact.failures, []);
    assert.equal(artifact.patches.length, 24);
    assert.equal(artifact.summary.chromaticMean, 1.8455400956242431);
    assert.equal(artifact.summary.p95AllNearestRank, 3.573451177457577);
    assert.equal(artifact.summary.neutralMax, 1.788961874556431);
    assert.equal(artifact.patches.slice(18).filter(({ deltaE00 }) => deltaE00 > 2.5).length, 0);
    const calibration = artifact.neutral.calibration;
    // The calibrated intent is auditable: the seed evaluation reproduces the
    // pre-calibration failure, the solved objective is exactly the gated
    // neutralMax of the final render, and the full trace is retained.
    assert.equal(calibration.seedNeutralMaxDeltaE00, 10.833707080545038);
    assert.equal(calibration.solvedNeutralMaxDeltaE00, artifact.summary.neutralMax);
    assert.equal(calibration.evaluationsUsed, calibration.evaluations.length);
    assert.deepEqual(calibration.evaluations[0].chromaticity, artifact.neutral.seedChromaticity);
  });

  await t.test("package wrapper preserves the green status and exact JSON bytes", () => {
    const wrapped = execute("pnpm", ["--silent", "--filter", "monet-galerie", "proof:colorchecker"]);
    assert.equal(wrapped.status, 0);
    assert.deepEqual(wrapped.stdout, accepted);
    assert.equal(JSON.parse(wrapped.stdout.toString("utf8")).status, "pass");
  });
});
