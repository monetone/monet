import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "../../..");
const engine = resolve(root, "packages/engine");
const fixturePath = resolve(engine, "fixtures/mvsn-v15-historical.mvision");
const manifest = JSON.parse(
  readFileSync(resolve(engine, "fixtures/mvsn-v15-historical.json"), "utf8"),
);
const generator = readFileSync(
  resolve(engine, "fixtures/mvsn-v15-provenance-generator.rs"),
  "utf8",
);
const temporary = mkdtempSync(join(tmpdir(), "monet-mvsn-v15-"));
const worktree = join(temporary, "worktree");
const generatedPath = join(temporary, "generated.mvision");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed:\n${result.stderr || result.stdout}`,
    );
  }
  return result;
}

try {
  run("git", ["worktree", "add", "--detach", worktree, manifest.generatorCommit]);
  appendFileSync(resolve(worktree, "packages/engine/src/raster/mod.rs"), `\n${generator}`);
  run(
    "cargo",
    [
      "test",
      "--manifest-path",
      resolve(worktree, "packages/engine/Cargo.toml"),
      "mvsn_v15_provenance_generator::write_historical_fixture",
    ],
    {
      cwd: worktree,
      env: { ...process.env, MVSN_FIXTURE_OUTPUT: generatedPath },
    },
  );

  const generated = readFileSync(generatedPath);
  const checked = readFileSync(fixturePath);
  const sha256 = createHash("sha256").update(generated).digest("hex");
  if (generated.length !== 4756 || generated.length !== checked.length) {
    throw new Error(
      `fixture length mismatch: generated ${generated.length}, checked ${checked.length}`,
    );
  }
  if (sha256 !== manifest.sha256) {
    throw new Error(`fixture SHA-256 mismatch: ${sha256}`);
  }
  if (!generated.equals(checked)) {
    throw new Error("historical writer output differs from the checked fixture");
  }
  console.log(
    JSON.stringify({
      pass: true,
      generatorCommit: manifest.generatorCommit,
      bytes: generated.length,
      sha256,
    }),
  );
} finally {
  const removal = spawnSync("git", ["worktree", "remove", "--force", worktree], {
    cwd: root,
    encoding: "utf8",
  });
  rmSync(temporary, { recursive: true, force: true });
  if (removal.status !== 0) {
    const prune = spawnSync("git", ["worktree", "prune"], {
      cwd: root,
      encoding: "utf8",
    });
    if (prune.status !== 0) {
      // eslint-disable-next-line no-unsafe-finally -- proof harness: a cleanup failure must surface
      throw new Error(`temporary worktree cleanup failed:\n${removal.stderr}${prune.stderr}`);
    }
  }
}
