import { spawnSync } from "node:child_process";
import { readFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateDngProof } from "./dng-proof-validator.mjs";
import { writeJsonAtomicSync } from "./atomic-write-json.mjs";

const cwd = new URL("..", import.meta.url);

// Every criterion-5-relevant negative/regression case lives in the Rust
// library's unit tests (`#[cfg(test)] mod tests` inside each source file).
// A single parsed `cargo test --lib` run — rather than several substring
// `cargo test -- <filter>` invocations — is the only way to report an
// auditable per-case result with no risk of double-counting: cargo's test
// filter is a plain substring match, so (for example) a `"dng::"` filter
// also matches every `linear_dng::tests::*` test, and separate filters for
// overlapping prefixes would double-count. Parsing the full run's own
// per-test result lines and keying by the exact fully-qualified test name
// avoids that entirely, and is also strictly faster than four separate
// compile+run cycles.
const PINNED_CATEGORIES = ["parser", "publisher", "managed", "writer", "lifecycle"];

function categoryFor(name) {
  if (name.startsWith("dng::")) return "parser";
  if (name.startsWith("atomic_publish::")) return "publisher";
  if (name.startsWith("catalog::")) return "managed";
  if (name.startsWith("linear_dng::")) return "writer";
  if (name.startsWith("develop_job::")) return "lifecycle";
  return "other";
}

// A test whose own name asserts an object-preservation contract (the
// architecture's "make object-preservation outcomes explicit for
// collision/failure cases") reports that outcome as `existingObjectModified`:
// `false` when it passed (its own assertions verified non-modification),
// `true` when it failed (the contract cannot be vouched for), `null` when
// the test makes no such claim. This is derived, not separately measured —
// documented here rather than fabricated as an independent signal. Widened
// past bare "untouched"/"unchanged"/"preserv" to the exact patterns the
// architecture names (`without_mutating`, `does_not_clobber`) plus every
// currently-required case making an equivalent claim (`reuse`,
// `byte_for_byte`) — kept in sync with `dng-proof-validator.mjs`'s own copy,
// which independently recomputes this rather than trusting it verbatim.
const PRESERVATION_NAME = /untouched|unchanged|preserv|reuse|without_mutating|does_not_clobber|byte_for_byte/i;
function existingObjectModified(name, status) {
  if (!PRESERVATION_NAME.test(name)) return null;
  return status !== "ok";
}

/** Run the full Rust library unit-test suite once, parse every per-test
 * result line, and bucket results into the pinned criterion-5 categories.
 * Throws if the run itself fails to complete (a compile error, a harness
 * crash) or if zero tests were discovered — a silent empty matrix must not
 * be reported as passing. Individual test failures are NOT thrown here:
 * they are represented explicitly in the matrix and rejected later by
 * `validateDngProof`, so the report can state exactly which case failed.
 */
function runLibTestMatrix() {
  const run = spawnSync(
    "cargo",
    ["test", "--manifest-path", "src-tauri/Cargo.toml", "--lib", "--", "--test-threads=1"],
    { cwd, encoding: "utf8", maxBuffer: 32 * 1024 * 1024 },
  );
  const output = `${run.stdout}\n${run.stderr}`;
  if (run.error) {
    throw new Error(`cargo test --lib did not run: ${run.error}`);
  }
  const lineRe = /^test (\S+) \.\.\. (ok|FAILED|ignored)\b/gm;
  const results = new Map(); // full test name -> {name, status, category, existingObjectModified}
  for (const m of output.matchAll(lineRe)) {
    const [, name, rawStatus] = m;
    const status = rawStatus === "ok" ? "ok" : rawStatus === "ignored" ? "ignored" : "failed";
    results.set(name, {
      name,
      status,
      category: categoryFor(name),
      existingObjectModified: existingObjectModified(name, status),
    });
  }
  if (results.size === 0) {
    throw new Error(`cargo test --lib reported no per-test result lines:\n${output}`);
  }
  // A hard crash (segfault, harness panic) can exit nonzero without every
  // individual test line disagreeing — surface that distinctly from an
  // ordinary reported test failure, which is instead caught by the
  // structured per-case `failed` count below.
  const anyFailed = [...results.values()].some((r) => r.status === "failed");
  if (run.status !== 0 && !anyFailed) {
    throw new Error(`cargo test --lib exited ${run.status} with no reported test failure:\n${output}`);
  }
  return [...results.values()];
}

const results = runLibTestMatrix();
const categories = Object.fromEntries(
  PINNED_CATEGORIES.map((cat) => [cat, { passed: 0, failed: 0, ignored: 0 }]),
);
categories.other = { passed: 0, failed: 0, ignored: 0 };
for (const r of results) {
  const bucket = categories[r.category];
  if (r.status === "ok") bucket.passed += 1;
  else if (r.status === "ignored") bucket.ignored += 1;
  else bucket.failed += 1;
}
const matrix = {
  pinnedCategories: PINNED_CATEGORIES,
  categories,
  results,
  passed: results.filter((r) => r.status === "ok").length,
  failed: results.filter((r) => r.status === "failed").length,
  ignored: results.filter((r) => r.status === "ignored").length,
};
if (matrix.failed > 0) {
  const failedNames = results.filter((r) => r.status === "failed").map((r) => r.name);
  throw new Error(`cargo test --lib reported failing tests: ${failedNames.join(", ")}`);
}

const run = spawnSync("/usr/bin/time", ["-l", "cargo", "run", "--quiet", "--manifest-path", "src-tauri/Cargo.toml", "--bin", "dng_product_proof"], { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
if (run.status !== 0) throw new Error(run.stderr || run.stdout || `proof exited ${run.status}`);
const proofValue = JSON.parse(run.stdout.trim().split("\n").at(-1));
const rss = run.stderr.match(/(\d+)\s+maximum resident set size/);
if (!rss) throw new Error("DNG proof did not report peak RSS");
proofValue.peakRssBytes = Number(rss[1]);

proofValue.negativeCaseMatrix = matrix;
proofValue.counts = {
  passed: proofValue.counts.passed + matrix.passed,
  failed: proofValue.counts.failed + matrix.failed,
  skipped: proofValue.counts.skipped + matrix.ignored,
  todo: proofValue.counts.todo,
};

const proof = validateDngProof(proofValue);

// The Rust producer never creates, truncates, renames, or otherwise
// touches the final durable artifact — it only prints its base report on
// stdout (`dng_product_proof.rs::main`). This wrapper performs the one and
// only write: build the enriched final object directly from the parsed,
// already-validated stdout value above (never by re-reading a possibly
// stale, or on a first run nonexistent, prior artifact off disk — that
// disk-based patch was the wrapper half of the very defect this comment
// replaces). Ensure the containing directory exists first; a recursive
// mkdir on an already-existing directory is a no-op and never touches any
// file inside it, so a prior valid artifact is never disturbed by this
// step.
const artifactUrl = new URL("../src-tauri/target/dng-proof.json", import.meta.url);
const artifactPath = fileURLToPath(artifactUrl);
mkdirSync(dirname(artifactPath), { recursive: true });
const intendedBytes = JSON.stringify(proof);
// Atomic write: sibling temp (exclusive create) -> write -> fsync file ->
// rename over the artifact -> fsync the containing directory. This can
// never leave the artifact truncated or partially written — the file on
// disk is either the prior bytes or the full new bytes, never a partial
// write caught mid-flight. See `atomic-write-json.mjs` for the full
// contract and its own deterministic failure-injection tests.
writeJsonAtomicSync(artifactPath, intendedBytes);
// Reread the EXACT persisted bytes (a fresh `readFileSync`, not the
// in-memory `intendedBytes` string) and fail if they differ from what was
// just written/validated — a write that silently truncated, got buffered
// by another writer, or landed on a different filesystem path must not be
// reported as a durable, valid artifact.
const persistedBytes = readFileSync(artifactPath, "utf8");
if (persistedBytes !== intendedBytes) {
  throw new Error("DNG proof durable artifact bytes differ from what was written");
}
const persisted = JSON.parse(persistedBytes);
validateDngProof(persisted);

console.log(JSON.stringify(proof));
