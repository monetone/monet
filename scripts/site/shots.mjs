#!/usr/bin/env node
// Prepare app screenshots for the progress page.
//
//   node scripts/site/shots.mjs <source-dir>
//
// Screenshots are REAL captures of each app's built web bundle (the same React UI
// that runs inside the Tauri window), taken at 1920x1120 @2x. This step only
// resizes and re-encodes them — it never composites, retouches or invents content.
//
// Output: site/shots/<app>.webp, sized for the page's display width and lazy-loaded.

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(new URL(import.meta.url)));
const OUT = join(HERE, "..", "..", "site", "shots");

const SRC = process.argv[2];
if (!SRC || !existsSync(SRC)) {
  console.error("usage: node scripts/site/shots.mjs <source-dir-of-app-pngs>");
  process.exit(1);
}

// Displayed at ~620 CSS px in the app panel; 1440 gives a crisp 2x there and still
// holds up when opened full-size in a new tab.
const WIDTH = 1440;
const QUALITY = 78;

// WebP, not JPEG: these are UI screenshots — flat panels and small text, exactly
// where JPEG rings. macOS `sips` cannot write WebP, so cwebp does the work.
try {
  execFileSync("cwebp", ["-version"], { stdio: "pipe" });
} catch {
  console.error("cwebp not found. Install it with:  brew install webp");
  process.exit(1);
}

mkdirSync(OUT, { recursive: true });

const files = readdirSync(SRC).filter((f) => /^[a-z]+\.png$/.test(f));
if (!files.length) {
  console.error(`no <app>.png files in ${SRC}`);
  process.exit(1);
}

let total = 0;
for (const f of files.sort()) {
  const app = f.replace(/\.png$/, "");
  const src = join(SRC, f);
  const dst = join(OUT, `${app}.webp`);
  execFileSync("cwebp", ["-q", String(QUALITY), "-resize", String(WIDTH), "0",
                         "-quiet", src, "-o", dst], { stdio: "pipe" });
  const kb = statSync(dst).size / 1024;
  total += kb;
  console.log(`  ${app.padEnd(9)} ${WIDTH}px  ${kb.toFixed(0)}KB`);
}
console.log(`\n${files.length} shots -> site/shots/  (${(total / 1024).toFixed(2)}MB total)`);
