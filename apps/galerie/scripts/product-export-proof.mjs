import { createHash } from "node:crypto";
import { closeSync, fstatSync, mkdtempSync, openSync, readFileSync, readSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { parseChild, validateProxy, validateTier } from "./product-export-validator.mjs";

const app = join(dirname(fileURLToPath(import.meta.url)), "..");
const root = join(app, "../..");
const tauri = join(app, "src-tauri");
const manifest = JSON.parse(readFileSync(join(app, "proofs/raw-fixtures.json"), "utf8"));

function run(command, args, options = {}) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    timeout: 180_000,
    maxBuffer: 10 * 1024 * 1024,
    ...options,
  });
}

function runChecked(command, args, options = {}) {
  const result = run(command, args, options);
  if (result.status !== 0) throw new Error(`${command} failed:\n${result.stderr || result.stdout}`);
  return result;
}

function sourcePath(fixture) {
  return join(tauri, "target/raw-fixtures", `${fixture.id}${extname(new URL(fixture.url).pathname)}`);
}

function digest(path) {
  return createHash("sha256").update(readFileSync(path)).digest("hex");
}

function measureOutputFile(path) {
  const fd = openSync(path, "r");
  const hash = createHash("sha256");
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  try {
    for (let bytesRead; (bytesRead = readSync(fd, buffer, 0, buffer.length, null)) > 0;) {
      hash.update(buffer.subarray(0, bytesRead));
    }
    return { digest: hash.digest("hex"), bytes: fstatSync(fd).size };
  } finally {
    closeSync(fd);
  }
}

runChecked("cargo", [
  "build", "--release", "--manifest-path", join(tauri, "Cargo.toml"),
  "--bin", "product_proof", "--bin", "proxy_proof",
]);

const binary = join(tauri, "target/release/product_proof");
const outputDirectory = mkdtempSync(join(tmpdir(), "galerie-product-proof-"));
const gates = {
  45: { seconds: 30, rss: 2.5 * 1024 ** 3, profile: "srgb" },
  60: { seconds: 45, rss: 3 * 1024 ** 3, profile: "display-p3" },
  100: { seconds: 90, rss: 4 * 1024 ** 3, profile: "srgb" },
};
const tiers = [];
try {
  for (const fixture of manifest.fixtures.filter(({ benchmarkTier }) => benchmarkTier)) {
    const source = sourcePath(fixture);
    if (digest(source) !== fixture.sha256) throw new Error(`${fixture.id}: source digest mismatch`);
    const gate = gates[fixture.benchmarkTier];
    const output = join(outputDirectory, `product-proof-${fixture.benchmarkTier}.tiff`);
    const result = run("/usr/bin/time", ["-l", binary, source, output, gate.profile]);
    const seconds = Number(result.stderr.match(/([0-9.]+)\s+real/)?.[1]);
    const peakResidentBytes = Number(result.stderr.match(/(\d+)\s+maximum resident set size/)?.[1]);
    const payload = parseChild(result, fixture.id);
    const published = measureOutputFile(output);
    tiers.push(validateTier({
      fixture,
      gate,
      seconds,
      peakResidentBytes,
      payload,
      sourceDigestAfter: digest(source),
      actualOutputDigest: published.digest,
      actualOutputBytes: published.bytes,
    }));
  }

  const proxyFixture = manifest.fixtures.find(({ benchmarkTier }) => benchmarkTier === 45);
  const proxyResult = run(join(tauri, "target/release/proxy_proof"), [sourcePath(proxyFixture)]);
  const proxy = validateProxy(parseChild(proxyResult, "proxy"), proxyFixture.sha256);
  process.stdout.write(`${JSON.stringify({ pass: true, proxy, tiers })}\n`);
} finally {
  rmSync(outputDirectory, { recursive: true });
}
