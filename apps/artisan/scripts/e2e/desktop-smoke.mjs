// ─────────────────────────────────────────────────────────────
// e2e/desktop-smoke — launch the REAL packaged desktop binary
// ─────────────────────────────────────────────────────────────
// Builds the production frontend + the native `Artisan` Tauri binary, then
// launches it and asserts a CLEAN startup: the process survives the window-creating
// `.setup()` (a failed `MonetWindow::builder(...).build()?` aborts via `.expect`),
// no panic / fatal error is printed, and it stays alive. After the watch window it
// is terminated.
//
// Why this exists (and why not tauri-driver here): tauri-driver has NO macOS
// WebDriver backend, so it can't drive the WKWebView on the macOS dev/CI target.
// This covers the Tauri SHELL the headless-Chrome suite can't reach — config parse,
// asset embedding, window creation, plugin + invoke-handler registration. Tool
// BEHAVIOUR is already covered 72/72 by scripts/e2e/tools.mjs against the identical
// frontend bundle; the real window + tool-action path is covered on Linux CI by
// scripts/e2e/desktop-tauri.mjs.
//
//   node scripts/e2e/desktop-smoke.mjs        # builds if needed, then smoke-tests

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = resolve(ROOT, `src-tauri/target/debug/Artisan${process.platform === "win32" ? ".exe" : ""}`);
const DIST = resolve(ROOT, "dist/index.html");
const ALIVE_MS = Number(process.env.DESKTOP_SMOKE_ALIVE_MS || 6000);

const run = (cmd, args) => {
  console.log(`[desktop-smoke] $ ${cmd} ${args.join(" ")}`);
  const r = spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
  if (r.status !== 0) {
    console.error(`[desktop-smoke] '${cmd} ${args.join(" ")}' failed (status ${r.status})`);
    process.exit(1);
  }
};

// 1. Production frontend bundle (embedded into the binary by `tauri::generate_context!`).
if (!existsSync(DIST)) run("pnpm", ["build"]);
// 2. (Re)build the desktop binary against the current dist.
run("cargo", ["build", "--manifest-path", "src-tauri/Cargo.toml"]);
if (!existsSync(BIN)) {
  console.error(`[desktop-smoke] binary not found after build: ${BIN}`);
  process.exit(1);
}

// 3. Launch and watch for a clean startup.
console.log(`[desktop-smoke] launching ${BIN} (watching ${ALIVE_MS}ms for a clean start)`);
let out = "";
const child = spawn(BIN, [], { cwd: ROOT, env: { ...process.env } });
child.stdout.on("data", (d) => ((out += d), process.stdout.write(d)));
child.stderr.on("data", (d) => ((out += d), process.stderr.write(d)));

let exited = null;
child.on("exit", (code, signal) => (exited = { code, signal }));

await new Promise((r) => setTimeout(r, ALIVE_MS));

const PANIC = /panicked|error while running|thread '.*' panicked|fatal runtime|Segmentation fault/i;
const fail = (msg) => {
  console.error(`\n❌ desktop-smoke: ${msg}`);
  try {
    child.kill("SIGKILL");
  } catch {
    /* already gone */
  }
  process.exit(1);
};

if (exited) fail(`app exited during startup (code=${exited.code} signal=${exited.signal}) — window/setup likely panicked`);
if (PANIC.test(out)) fail("panic / fatal error detected in startup output");

// Survived the window-creating setup with no panic → clean launch.
child.kill("SIGTERM");
await new Promise((r) => setTimeout(r, 500));
try {
  child.kill("SIGKILL");
} catch {
  /* already exited on SIGTERM */
}
console.log("\n✅ desktop-smoke: app launched cleanly (window created, no panic, stayed alive)");
process.exit(0);
