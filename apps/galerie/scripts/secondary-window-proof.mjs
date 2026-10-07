import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const run = (command, args) => {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) process.exit(result.status ?? 1);
};

run("pnpm", ["tauri", "build", "--debug", "--no-bundle"]);

const proofDir = mkdtempSync(join(tmpdir(), "galerie-secondary-proof-"));
const output = join(proofDir, "result.json");
const binary = resolve(root, "src-tauri/target/debug/Galerie");
const child = spawn(binary, [], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    GALERIE_SECONDARY_PROOF_CATALOG: join(proofDir, "proof.galcat"),
    GALERIE_SECONDARY_PROOF_FIXTURE_ONE: resolve(root, "src-tauri/icons/32x32.png"),
    GALERIE_SECONDARY_PROOF_FIXTURE_TWO: resolve(root, "src-tauri/icons/64x64.png"),
    GALERIE_SECONDARY_PROOF_OUTPUT: output,
  },
});
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    child.kill("SIGTERM");
    process.exit(1);
  });
}

const deadline = Date.now() + 60_000;
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, 100));
  try {
    const report = JSON.parse(readFileSync(output, "utf8"));
    child.kill("SIGTERM");
    if (!report.pass) {
      console.error(JSON.stringify(report, null, 2));
      process.exit(1);
    }
    console.log(JSON.stringify(report, null, 2));
    process.exit(0);
  } catch (error) {
    if (error.code !== "ENOENT" && !(error instanceof SyntaxError)) throw error;
  }
  if (child.exitCode != null) {
    console.error(`Galerie exited before producing proof (status ${child.exitCode})`);
    process.exit(1);
  }
}

child.kill("SIGKILL");
console.error("Timed out waiting for the two-window proof");
process.exit(1);
