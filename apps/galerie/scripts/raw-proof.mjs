import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const manifest = JSON.parse(readFileSync(join(root, "proofs/raw-fixtures.json"), "utf8"));
const cache = join(root, "src-tauri/target/raw-fixtures");
const helper = join(root, "src-tauri/target/raw-proof");

function pathFor(fixture) {
  return join(cache, `${fixture.id}${extname(new URL(fixture.url).pathname)}`);
}

function run(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function verify(fixture) {
  const file = pathFor(fixture);
  if (!existsSync(file)) throw new Error(`${fixture.id}: missing; run acquire first`);
  const actual = createHash("sha256").update(readFileSync(file)).digest("hex");
  if (actual !== fixture.sha256) throw new Error(`${fixture.id}: SHA-256 ${actual}, expected ${fixture.sha256}`);
  return file;
}

function acquire() {
  mkdirSync(cache, { recursive: true });
  for (const fixture of manifest.fixtures) {
    const file = pathFor(fixture);
    if (!existsSync(file)) {
      process.stdout.write(`download ${fixture.id}\n`);
      const partial = `${file}.download`;
      rmSync(partial, { force: true });
      try {
        run("curl", [
          "-fL",
          "--retry", "2",
          "--connect-timeout", "5",
          "--max-time", "120",
          "-o", partial,
          fixture.url,
        ]);
        const actual = createHash("sha256").update(readFileSync(partial)).digest("hex");
        if (actual !== fixture.sha256) {
          throw new Error(`${fixture.id}: downloaded SHA-256 ${actual}, expected ${fixture.sha256}`);
        }
        renameSync(partial, file);
      } finally {
        rmSync(partial, { force: true });
      }
    }
    verify(fixture);
    process.stdout.write(`OK ${fixture.id} ${fixture.sha256}\n`);
  }
}

function buildHelper() {
  run("xcrun", ["swiftc", "-O", "-framework", "CoreImage", "-framework", "ImageIO", "-o", helper, join(root, "scripts/raw-proof.swift")]);
}

function measure(fixture, maxEdge) {
  const file = verify(fixture);
  const before = createHash("sha256").update(readFileSync(file)).digest("hex");
  const result = spawnSync("/usr/bin/time", ["-l", helper, file, maxEdge], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) throw new Error(`${fixture.id} failed:\n${result.stderr || result.stdout}`);
  const peak = result.stderr.match(/(\d+)\s+maximum resident set size/);
  if (!peak) throw new Error(`${fixture.id}: /usr/bin/time did not report peak RSS`);
  const after = createHash("sha256").update(readFileSync(file)).digest("hex");
  return {
    ...JSON.parse(result.stdout),
    peakResidentBytes: Number(peak[1]),
    sourceUnchanged: before === after && after === fixture.sha256,
  };
}

function prove() {
  buildHelper();
  const results = [];
  for (const fixture of manifest.fixtures) {
    const maxEdge = fixture.benchmarkTier ? "0" : "1024";
    results.push({ id: fixture.id, format: fixture.format, camera: fixture.camera, ...measure(fixture, maxEdge) });
  }
  process.stdout.write(`${JSON.stringify({ source: manifest.source, license: manifest.license, results }, null, 2)}\n`);
}

function color() {
  const fixture = manifest.fixtures.find(({ id }) => id === "colorchecker-sony-ilce-7m2");
  if (!fixture) throw new Error("ColorChecker fixture is absent from raw-fixtures.json");
  const file = verify(fixture);
  const result = spawnSync("cargo", [
    "run",
    "--quiet",
    "--manifest-path", join(root, "src-tauri/Cargo.toml"),
    "--features", "colorchecker-proof",
    "--bin", "colorchecker_proof",
    "--",
    join(root, "proofs/colorchecker-967.json"),
    file,
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  process.stdout.write(result.stdout);
  process.stderr.write(result.stderr);
  try {
    const artifact = JSON.parse(result.stdout);
    if (result.status !== 0 || artifact.status !== "pass") process.exitCode = result.status || 1;
  } catch {
    process.exitCode = result.status || 1;
  }
}

const command = process.argv[2];
if (command === "acquire") acquire();
else if (command === "verify") {
  for (const fixture of manifest.fixtures) process.stdout.write(`OK ${fixture.id} ${verify(fixture)}\n`);
} else if (command === "prove") prove();
else if (command === "color") color();
else throw new Error(`usage: ${basename(process.argv[1])} acquire|verify|prove|color`);
