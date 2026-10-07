// ─────────────────────────────────────────────────────────────
// e2e/desktop-tauri — REAL desktop window + tool action via WebDriver
// ─────────────────────────────────────────────────────────────
// Drives the actual packaged Tauri app through `tauri-driver`, which bridges W3C
// WebDriver to the platform webview driver. It asserts the native window's title,
// that the frontend boots inside the Tauri shell, and that a basic tool action
// (Rectangle ▸ drag) actually draws a shape — the one path the headless-Chrome
// suite can't exercise because it never runs inside a Tauri window.
//
// PLATFORM: Linux ONLY. tauri-driver has no macOS backend (no WebDriver server for
// WKWebView), so this cannot run on the macOS dev machine or macOS CI. It runs in
// the `desktop-linux` CI job (Ubuntu + webkit2gtk-driver + xvfb). The macOS target
// is covered instead by desktop-smoke.mjs (clean-launch) + the 72/72 web e2e.
//
// Prereqs (see .github/workflows/ci.yml): `cargo install tauri-driver`, the app
// built at src-tauri/target/debug/Artisan, and (headless) an X server (xvfb).
//   xvfb-run -a node scripts/e2e/desktop-tauri.mjs

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Builder, By, Capabilities, until } from "selenium-webdriver";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const BIN = resolve(ROOT, "src-tauri/target/debug/Artisan");
const PORT = Number(process.env.TAURI_DRIVER_PORT || 4444);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform === "darwin" || process.platform === "win32") {
  console.error(`[desktop-tauri] tauri-driver has no ${process.platform} backend — run this on Linux. Use desktop-smoke.mjs locally.`);
  process.exit(2);
}
if (!existsSync(BIN)) {
  console.error(`[desktop-tauri] binary not found: ${BIN} — run \`pnpm build && cargo build --manifest-path src-tauri/Cargo.toml\` first.`);
  process.exit(2);
}

// tauri-driver proxies WebDriver → WebKitWebDriver and spawns the app binary
// declared in the `tauri:options.application` capability.
const tauriDriver = spawn("tauri-driver", ["--port", String(PORT)], { stdio: "inherit" });
const killDriver = () => {
  try {
    tauriDriver.kill();
  } catch {
    /* already gone */
  }
};
process.on("exit", killDriver);
process.on("SIGINT", () => (killDriver(), process.exit(1)));

const failures = [];
const check = (name, cond, detail) => {
  console.log(`${cond ? "✅" : "❌"} ${name}${detail != null ? "  " + JSON.stringify(detail) : ""}`);
  if (!cond) failures.push(name);
};

let driver;
try {
  await sleep(2000); // let tauri-driver bind the port + the native driver come up

  // Canonical Tauri WebDriver capabilities: the `wry` webview + the binary to run.
  const caps = new Capabilities();
  caps.set("tauri:options", { application: BIN });
  caps.setBrowserName("wry");
  driver = await new Builder().usingServer(`http://127.0.0.1:${PORT}`).withCapabilities(caps).build();

  // 1. The native window exists with the configured title (main.rs .title("…")).
  const title = await driver.getTitle();
  check("window title is 'Monet Artisan'", /Monet Artisan/.test(title), { title });

  // 2. The frontend bundle booted inside the Tauri webview.
  await driver.wait(until.elementLocated(By.css("svg.artisan-canvas")), 20000);
  const canvas = await driver.findElement(By.css("svg.artisan-canvas"));
  check("frontend booted (svg.artisan-canvas present)", !!canvas);

  const shapeCount = async () => (await driver.findElements(By.css("svg.artisan-canvas [data-id]"))).length;
  const before = await shapeCount();

  // 3. Basic tool action: pick the Rectangle tool and drag on the canvas.
  const rectBtn = await driver.wait(until.elementLocated(By.css('.monet-tool[aria-label="Rectangle"]')), 10000);
  await rectBtn.click();
  await sleep(200);

  // Element-origin offsets are relative to the canvas's in-view centre.
  await driver
    .actions()
    .move({ origin: canvas, x: -80, y: -60 })
    .press()
    .move({ origin: canvas, x: 80, y: 60 })
    .release()
    .perform();
  await sleep(500);

  const after = await shapeCount();
  check("Rectangle tool drew a new shape", after > before, { before, after });
} catch (e) {
  check("desktop tauri e2e ran without error", false, String(e).slice(0, 240));
} finally {
  if (driver) await driver.quit().catch(() => {});
  killDriver();
}

console.log(`\n${failures.length ? "FAILED: " + failures.join(", ") : "✅ desktop tauri e2e passed (window + Rectangle tool action)"}`);
process.exit(failures.length ? 1 : 0);
