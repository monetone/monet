#!/usr/bin/env node
// create-monet-app — a zero-dependency scaffolder for Monet liquid-glass
// desktop apps (Tauri 2 + React + Rust). Uses only Node builtins.
//
//   npx create-monet-app <target-dir> [--accent raster|vector|audio|motion]
//
// It copies the bundled `template/` directory into <target-dir>, substituting
// the app name (derived from the directory) and the chosen accent into the
// placeholder tokens baked into the template files.

import { cp, readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const TEMPLATE_DIR = path.join(HERE, "template");

const ACCENTS = ["raster", "vector", "audio", "motion"];

// File extensions we treat as text (placeholder substitution + line endings).
// Anything else (icons, fonts) is copied verbatim as a binary.
const TEXT_EXT = new Set([
  ".json", ".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx",
  ".rs", ".toml", ".html", ".css", ".md", ".txt", ".conf",
]);
// Text files that have no extension (matched by basename).
const TEXT_NAMES = new Set(["build.rs"]);

// Files in the template that must be renamed on the way out, so they don't get
// picked up by tooling (npm, git) while they live inside this package's tree.
const RENAME = new Map([
  ["_gitignore", ".gitignore"],
  ["_pnpm-workspace.yaml", "pnpm-workspace.yaml"],
]);

function die(msg) {
  process.stderr.write(`\ncreate-monet-app: ${msg}\n\n`);
  process.exit(1);
}

function parseArgs(argv) {
  const args = { target: undefined, accent: "raster" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--accent" || a === "-a") {
      args.accent = String(argv[++i] ?? "").toLowerCase();
    } else if (a.startsWith("--accent=")) {
      args.accent = a.slice("--accent=".length).toLowerCase();
    } else if (a === "--help" || a === "-h") {
      args.help = true;
    } else if (!a.startsWith("-") && args.target === undefined) {
      args.target = a;
    }
  }
  return args;
}

function usage() {
  return [
    "create-monet-app — scaffold a Monet liquid-glass desktop app (Tauri 2).",
    "",
    "Usage:",
    "  npx create-monet-app <target-dir> [--accent raster|vector|audio|motion]",
    "",
    "Example:",
    "  npx create-monet-app my-studio --accent vector",
    "",
    "After scaffolding (Monet is consumed from a git submodule, not a registry):",
    "  cd <target-dir>",
    "  git init && git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui",
    "  pnpm -C vendor/monet-ui install   # build the Monet packages (dist/)",
    "  pnpm install && pnpm tauri dev",
    "",
  ].join("\n");
}

// "my-cool-app" → "My Cool App"
function titleCase(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

// "My Cool App" → "MyCoolApp" (for the App() component nothing depends on this,
// but it keeps the substitution complete + valid).
function pascalCase(name) {
  return name
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join("");
}

// Sanitize an arbitrary directory name into a valid npm package name segment.
function npmName(name) {
  const cleaned = name
    .toLowerCase()
    .replace(/[^a-z0-9-_.]+/g, "-")
    .replace(/^[-_.]+|[-_.]+$/g, "");
  return cleaned || "monet-app";
}

// Sanitize into a Cargo crate name (snake_case, no leading digit).
function crateName(name) {
  let s = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  if (!s || /^[0-9]/.test(s)) s = `app_${s}`;
  return s;
}

// Reverse-DNS-ish bundle identifier.
function bundleId(name) {
  const seg = name.toLowerCase().replace(/[^a-z0-9]+/g, "").replace(/^[0-9]+/, "");
  return `dev.monet.${seg || "app"}`;
}

function isTextFile(filePath) {
  if (TEXT_NAMES.has(path.basename(filePath))) return true;
  return TEXT_EXT.has(path.extname(filePath).toLowerCase());
}

function substitute(contents, vars) {
  return contents
    .replaceAll("__APP_NAME__", vars.appName)
    .replaceAll("__APP_PRODUCT_NAME__", vars.productName)
    .replaceAll("__APP_CRATE__", vars.crate)
    .replaceAll("__APP_IDENTIFIER__", vars.identifier)
    .replaceAll("__APP_ACCENT_PASCAL__", vars.accentPascal)
    .replaceAll("__APP_ACCENT__", vars.accent);
}

async function copyTree(srcDir, destDir, vars) {
  const entries = await readdir(srcDir, { withFileTypes: true });
  await mkdir(destDir, { recursive: true });
  for (const entry of entries) {
    const srcPath = path.join(srcDir, entry.name);
    const outName = RENAME.get(entry.name) ?? entry.name;
    const destPath = path.join(destDir, outName);
    if (entry.isDirectory()) {
      await copyTree(srcPath, destPath, vars);
    } else if (entry.isFile()) {
      if (isTextFile(srcPath)) {
        const raw = await readFile(srcPath, "utf8");
        await writeFile(destPath, substitute(raw, vars), "utf8");
      } else {
        await cp(srcPath, destPath); // binary verbatim (icons, etc.)
      }
    }
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  if (args.help || !args.target) {
    process.stdout.write(usage());
    process.exit(args.help ? 0 : 1);
  }

  if (!ACCENTS.includes(args.accent)) {
    die(`unknown accent "${args.accent}". Choose one of: ${ACCENTS.join(", ")}.`);
  }

  if (!existsSync(TEMPLATE_DIR)) {
    die(`bundled template not found at ${TEMPLATE_DIR}. This is a packaging bug.`);
  }

  const targetDir = path.resolve(process.cwd(), args.target);
  const dirName = path.basename(targetDir);

  if (existsSync(targetDir)) {
    const contents = await readdir(targetDir).catch(() => []);
    if (contents.length > 0) {
      die(`target directory "${args.target}" already exists and is not empty.`);
    }
  }

  const productName = titleCase(dirName);
  const accentPascal = args.accent.charAt(0).toUpperCase() + args.accent.slice(1);
  const vars = {
    appName: npmName(dirName),
    productName,
    crate: crateName(dirName),
    identifier: bundleId(dirName),
    accent: args.accent,
    accentPascal,
  };

  process.stdout.write(`\nScaffolding Monet app "${productName}" (accent: ${args.accent})\n`);
  process.stdout.write(`  → ${targetDir}\n`);

  await copyTree(TEMPLATE_DIR, targetDir, vars);

  process.stdout.write(
    [
      "",
      "Done. Next steps:",
      "",
      `  cd ${args.target}`,
      "  git init",
      "  git submodule add https://github.com/Legoless/monet-ui vendor/monet-ui",
      "  pnpm -C vendor/monet-ui install   # builds the Monet packages (dist/)",
      "  pnpm install                      # links @monet-ui/* from the submodule",
      "  pnpm tauri dev                    # launches the Monet desktop app",
      "",
      "Build a bundle with: pnpm tauri build",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  die(err && err.stack ? err.stack : String(err));
});
