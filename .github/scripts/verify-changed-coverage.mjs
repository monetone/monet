import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

const LINES_MINIMUM = 90;
const BRANCHES_MINIMUM = 85;
const VISION_SOURCE = "apps/vision/src/";

export function selectChangedVisionSourceFiles(paths) {
  return paths.filter((path) => path.startsWith(VISION_SOURCE)
    && /\.tsx?$/.test(path)
    && !/\.(?:test|spec)\.tsx?$/.test(path)
    && !path.endsWith(".d.ts")
    && !path.endsWith("/mcp.generated.ts"));
}

function percentage(metric) {
  if (!metric || typeof metric.total !== "number") return 0;
  if (metric.total === 0) return 100;
  return Number(metric.pct) || 0;
}

function summaryFor(summary, repositoryPath) {
  const suffixes = [repositoryPath, repositoryPath.slice("apps/vision/".length)];
  return Object.entries(summary).find(([key]) =>
    key !== "total" && suffixes.some((suffix) => key.replaceAll("\\", "/").endsWith(suffix)))?.[1];
}

export function evaluateChangedCoverage(files, summary) {
  return files.flatMap((path) => {
    const entry = summaryFor(summary, path);
    const lines = percentage(entry?.lines);
    const branches = percentage(entry?.branches);
    return lines >= LINES_MINIMUM && branches >= BRANCHES_MINIMUM
      ? []
      : [{ path, lines, branches }];
  });
}

function changedFiles(base) {
  const result = spawnSync("git", ["diff", "--name-only", "--diff-filter=ACMR", `${base}...HEAD`, "--", "apps/vision/src"], { encoding: "utf8" });
  if (result.status !== 0) throw new Error(result.stderr || `git diff failed for ${base}`);
  return result.stdout.trim().split("\n").filter(Boolean);
}

export function main([base, summaryPath = "apps/vision/coverage/coverage-summary.json"] = process.argv.slice(2)) {
  if (!base) throw new Error("usage: verify-changed-coverage.mjs <base-revision> [coverage-summary.json]");
  const files = selectChangedVisionSourceFiles(changedFiles(base));
  if (!files.length) {
    console.log("Coverage ratchet: no changed Vision source modules.");
    return;
  }

  const failures = evaluateChangedCoverage(files, JSON.parse(readFileSync(summaryPath, "utf8")));
  if (failures.length) {
    for (const failure of failures) {
      console.error(`::error file=${failure.path}::changed-module coverage is ${failure.lines}% lines/${failure.branches}% branches; required ${LINES_MINIMUM}%/${BRANCHES_MINIMUM}%`);
    }
    process.exitCode = 1;
    return;
  }
  console.log(`Coverage ratchet passed for ${files.length} changed Vision source module(s).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
