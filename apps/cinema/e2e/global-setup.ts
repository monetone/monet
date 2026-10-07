// Playwright globalSetup — ensure the e2e prerequisites exist before the dev
// server (and the page) load. The wasm engine (`engine/pkg`) and the shared
// Monet UI dist are build artifacts; `pnpm install` builds the libs via their
// prepare scripts, but a fresh checkout won't have the wasm engine yet. Build
// whatever is missing (no-op when present, so it doesn't slow normal runs).

import { execSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function ensure(label: string, marker: string, build: string): void {
  if (existsSync(join(root, marker))) return;
  console.log(`[e2e setup] building ${label} (${marker} missing)…`);
  execSync(build, { cwd: root, stdio: "inherit" });
}

export default function globalSetup(): void {
  ensure("Monet UI libs", "../../packages/monet-ui/packages/monet-react/dist/index.js", "pnpm run build:libs");
  ensure("wasm engine", "engine/pkg/cinema_engine.js", "pnpm run engine:build");
}
