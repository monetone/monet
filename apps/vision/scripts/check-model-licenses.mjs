// Release gate: every bundled model weight (public/models/**/*.onnx) and the CLIP
// tokenizer files must be (a) pinned in checksums.txt and (b) carry a
// `## <path>` + `License:` entry in
// public/THIRD-PARTY-LICENSES.md. Guards against a vacuous pass (zero files
// discovered = broken walker). Local-only files listed in public/models/.gitignore
// are excluded here and from release output. Node stdlib only; run via
// `pnpm run check:models`.
import { readdirSync, statSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const SENTINEL = "public/models/candy.onnx";
const TOKENIZER_FILES = new Set(["vocab.json", "merges.txt"]);
const RELEASE_LICENSES = new Set(["MIT", "BSD-3-Clause", "Apache-2.0"]);

// public/models/.gitignore doubles as the release exclusion list. Keep it to
// root-relative literal paths so both the audit and Vite can apply it exactly.
export function modelReleaseExcludes(gitignoreText) {
  return gitignoreText
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .map((line) => {
      const entry = line.replace(/\/$/, "");
      const segments = entry.split("/");
      if (!entry || entry.startsWith("/") || entry.includes("\\") || segments.some((segment) => !segment || segment === "." || segment === "..") || /[!*?[\]]/.test(entry)) {
        throw new Error(`unsupported model release exclusion: ${line}`);
      }
      return entry;
    });
}

export function releaseModelFiles(modelFiles, gitignoreText) {
  const excludes = modelReleaseExcludes(gitignoreText);
  return modelFiles.filter((file) => {
    const rel = file.replace(/^public\/models\//, "");
    return !excludes.some((entry) => rel === entry || rel.startsWith(`${entry}/`));
  });
}

function parseChecksums(checksumsText) {
  const checksums = new Map();
  const errors = [];
  for (const [index, raw] of checksumsText.split("\n").entries()) {
    const line = raw.trim();
    if (!line) continue;
    const match = line.match(/^([a-f\d]{64})\s+(.+)$/i);
    if (!match) {
      errors.push(`checksums.txt line ${index + 1}: expected "<64-char SHA-256>  <path>"`);
      continue;
    }
    const [, hash, file] = match;
    if (checksums.has(file)) {
      errors.push(`checksums.txt line ${index + 1}: duplicate path ${file}`);
      continue;
    }
    checksums.set(file, hash.toLowerCase());
  }
  return { checksums, errors };
}

// Pure core, exported for the vitest. Inputs are raw file text so tests need no
// real tree. `modelFiles` are vision-root-relative POSIX paths.
export function auditModels({ modelFiles, checksumsText, gitignoreText, licenseDoc, actualHashes }) {
  const parsed = parseChecksums(checksumsText);
  const errors = [...parsed.errors];
  const auditedFiles = releaseModelFiles(modelFiles, gitignoreText);
  const auditedSet = new Set(auditedFiles);
  // rule 0: vacuous-pass guard.
  if (auditedFiles.length === 0) {
    errors.push("no model files discovered — walker broken? (expected public/models/**/*.onnx + tokenizer files)");
    return { errors, auditedFiles };
  }
  if (!auditedFiles.includes(SENTINEL)) {
    errors.push(`sentinel ${SENTINEL} not in walked set — wrong-directory walk?`);
  }

  for (const file of parsed.checksums.keys()) {
    if (!auditedSet.has(file)) errors.push(`${file}: listed in checksums.txt but absent from the release model tree`);
  }

  for (const file of auditedFiles) {
    // rule 1: every file that can ship must be pinned in checksums.txt.
    const expectedHash = parsed.checksums.get(file);
    if (!expectedHash) {
      errors.push(`${file}: absent from checksums.txt`);
    } else if (actualHashes && actualHashes[file] !== expectedHash) {
      errors.push(`${file}: SHA-256 mismatch (expected ${expectedHash}, got ${actualHashes[file] ?? "missing"})`);
    }
    // rule 2: registered with a License line in THIRD-PARTY-LICENSES.md.
    const license = licenseEntry(licenseDoc, file);
    if (!license) {
      errors.push(`${file}: no "## ${file}" heading with a "License:" line in THIRD-PARTY-LICENSES.md`);
    } else if (!RELEASE_LICENSES.has(license)) {
      errors.push(`${file}: release license is not an approved SPDX id (${license})`);
    }
  }

  return { errors, auditedFiles };
}

function licenseEntry(doc, file) {
  const lines = doc.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (lines[i].trim() !== `## ${file}`) continue;
    for (let j = i + 1; j < lines.length; j++) {
      if (lines[j].startsWith("## ")) break;
      const match = lines[j].trim().match(/^License:\s*(\S(?:.*\S)?)\s*$/i);
      if (match) return match[1];
    }
  }
  return "";
}

// CLI wrapper. Only runs when executed directly (not when imported by the test).
if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const visionRoot = path.resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
  const modelsDir = path.join(visionRoot, "public", "models");

  const modelFiles = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const abs = path.join(dir, name);
      if (statSync(abs).isDirectory()) {
        walk(abs);
      } else if (name.endsWith(".onnx") || TOKENIZER_FILES.has(name)) {
        modelFiles.push(path.relative(visionRoot, abs).split(path.sep).join("/"));
      }
    }
  };
  walk(modelsDir);

  const gitignoreText = readFileSync(path.join(modelsDir, ".gitignore"), "utf8");
  const auditedFiles = releaseModelFiles(modelFiles, gitignoreText);
  const actualHashes = Object.fromEntries(auditedFiles.map((file) => [
    file,
    createHash("sha256").update(readFileSync(path.join(visionRoot, file))).digest("hex"),
  ]));
  const { errors } = auditModels({
    modelFiles: modelFiles.sort(),
    checksumsText: readFileSync(path.join(modelsDir, "checksums.txt"), "utf8"),
    gitignoreText,
    licenseDoc: readFileSync(path.join(visionRoot, "public", "THIRD-PARTY-LICENSES.md"), "utf8"),
    actualHashes,
  });

  if (errors.length > 0) {
    console.error(`check:models FAILED (${errors.length} problem${errors.length === 1 ? "" : "s"}):`);
    for (const e of errors) console.error(`  - ${e}`);
    process.exit(1);
  }
  console.log(`check:models OK — ${auditedFiles.length} release model/tokenizer files all pinned + registered (${modelFiles.length - auditedFiles.length} local-only excluded).`);
}
