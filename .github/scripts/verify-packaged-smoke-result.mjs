import { createHash } from "node:crypto";
import { closeSync, createReadStream, openSync, readFileSync, readSync, realpathSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

// External host adapters emit schemaVersion 3. Every required check must own a
// different, non-empty evidence file inside the fresh evidence root and bind it
// with a lowercase SHA-256. The pinned signing identity owns distinct evidence,
// and the artifact is bound the same way to the fresh bundle root; an absent
// adapter, identity, or check is therefore a hard failure.
const REQUIRED_COMMON_CHECKS = [
  "packaged-launch",
  "shipping-mcp-and-tauri",
  "open-edit-save-reopen-export",
  "crash-recovery-relaunch",
  "mcp-transport-lifecycle",
  "linked-smart-object-package-failures",
  "optional-model-success",
  "stylus-pressure",
  "print-to-pdf",
  "multi-monitor-dpi",
  "collaboration-two-client",
  "international-ime-text",
  "no-panic-or-crash",
  "release-hook-absent",
  "production-csp",
  "filesystem-boundary",
  "clean-shutdown",
  "artifact-semantics",
];

const REQUIRED_PLATFORM_CHECKS = {
  macos: [
    "macos-accessibility-xcuitest",
    "macos-menu-dispatch",
    "macos-shortcuts",
    "macos-native-dialogs",
    "macos-drag-drop",
    "macos-file-associations",
    "macos-clipboard",
    "macos-host-fonts",
    "macos-heic",
    "macos-c2pa",
    "macos-os-file-pickers",
    "macos-oldest-supported-os-webview",
    "macos-newest-supported-os-webview",
  ],
  windows: [
    "windows-native-menus",
    "windows-native-shortcuts",
    "windows-native-dialogs",
    "windows-drag-drop",
    "windows-file-associations",
    "windows-clipboard",
    "windows-host-fonts",
    "windows-codecs",
    "windows-c2pa",
    "windows-filesystem-permissions",
    "windows-oldest-supported-webview2-runtime",
    "windows-newest-supported-webview2-runtime",
  ],
};

function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("error", reject)
      .on("data", (chunk) => hash.update(chunk))
      .on("end", () => resolve(hash.digest("hex")));
  });
}

function requireValue(condition, message) {
  if (!condition) throw new Error(message);
}

function containedFile(root, file, label) {
  const relative = path.relative(root, file);
  requireValue(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), `${label} is outside its fresh evidence root`);
  requireValue(statSync(file).isFile(), `${label} must be a file`);
  return relative;
}

function readBytes(file, length, position, label) {
  const descriptor = openSync(file, "r");
  try {
    const bytes = Buffer.alloc(length);
    requireValue(readSync(descriptor, bytes, 0, length, position) === length, `${label} is truncated`);
    return bytes;
  } finally {
    closeSync(descriptor);
  }
}

function verifyPackageFormat(file, platform) {
  const size = statSync(file).size;
  const extension = path.extname(file).toLowerCase();
  if (platform === "macos") {
    requireValue(extension === ".dmg", "packaged macOS artifact must be a DMG");
    requireValue(size >= 512, "packaged macOS DMG is truncated");
    requireValue(readBytes(file, 4, size - 512, "packaged macOS DMG").equals(Buffer.from("koly")), "packaged macOS artifact lacks a valid DMG trailer");
    return;
  }

  if (extension === ".msi") {
    const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    requireValue(size >= oleHeader.length && readBytes(file, oleHeader.length, 0, "packaged Windows MSI").equals(oleHeader), "packaged Windows artifact lacks a valid MSI header");
    return;
  }

  requireValue(extension === ".exe", "packaged Windows artifact must be an MSI or EXE");
  requireValue(size >= 64, "packaged Windows EXE is truncated");
  const dosHeader = readBytes(file, 64, 0, "packaged Windows EXE");
  requireValue(dosHeader.subarray(0, 2).equals(Buffer.from("MZ")), "packaged Windows artifact lacks an MZ header");
  const peOffset = dosHeader.readUInt32LE(0x3c);
  requireValue(peOffset + 4 <= size && readBytes(file, 4, peOffset, "packaged Windows EXE").equals(Buffer.from([0x50, 0x45, 0, 0])), "packaged Windows artifact lacks a PE signature");
}

export async function verifyPackagedSmokeResult(
  resultPath,
  expectedPlatform,
  expectedCommit,
  bundleRoot,
  evidenceRoot,
  expectedSigningIdentity,
) {
  requireValue(["macos", "windows"].includes(expectedPlatform), "expected platform must be macos or windows");
  requireValue(/^[a-f0-9]{40}$/.test(expectedCommit), "expected commit must be a lowercase 40-character git SHA");
  if (expectedPlatform === "macos") {
    requireValue(
      /^[A-Z0-9]{10}$/.test(expectedSigningIdentity?.teamId ?? "")
        && typeof expectedSigningIdentity?.authority === "string"
        && expectedSigningIdentity.authority.trim().length > 0,
      "expected macOS signing identity requires a 10-character Team ID and exact codesign authority",
    );
  } else {
    requireValue(
      /^[A-F0-9]{40}$/.test(expectedSigningIdentity?.certificateThumbprint ?? ""),
      "expected Windows signing identity requires an uppercase 40-character certificate thumbprint",
    );
  }

  const result = JSON.parse(readFileSync(resultPath, "utf8"));
  requireValue(result.schemaVersion === 3, "packaged smoke result requires schemaVersion 3");
  requireValue(result.platform === expectedPlatform, `packaged smoke result platform must be ${expectedPlatform}`);
  requireValue(result.commit === expectedCommit, `packaged smoke result commit must be ${expectedCommit}`);
  requireValue(result.status === "pass", "packaged smoke result status must be pass");

  const evidenceBase = realpathSync(evidenceRoot);
  const evidenceFiles = new Set();
  for (const check of [...REQUIRED_COMMON_CHECKS, ...REQUIRED_PLATFORM_CHECKS[expectedPlatform]]) {
    const entry = result.checks?.[check];
    requireValue(entry?.status === "pass", `packaged smoke result requires ${check}.status=pass with hash-bound evidence`);
    requireValue(typeof entry.evidence?.path === "string" && path.isAbsolute(entry.evidence.path), `${check} evidence path must be absolute`);
    requireValue(/^[a-f0-9]{64}$/.test(entry.evidence?.sha256 ?? ""), `${check} evidence requires a lowercase SHA-256`);
    const evidence = realpathSync(entry.evidence.path);
    containedFile(evidenceBase, evidence, `${check} evidence`);
    requireValue(statSync(evidence).size > 0, `${check} evidence must not be empty`);
    requireValue(!evidenceFiles.has(evidence), `${check} evidence must be distinct from every other native checklist artifact`);
    evidenceFiles.add(evidence);
    requireValue(await hashFile(evidence) === entry.evidence.sha256, `${check} evidence SHA-256 mismatch`);
  }

  const signingIdentity = result.signingIdentity;
  if (expectedPlatform === "macos") {
    requireValue(signingIdentity?.teamId === expectedSigningIdentity.teamId, "packaged macOS signing Team ID does not match the pinned identity");
    requireValue(signingIdentity?.authority === expectedSigningIdentity.authority, "packaged macOS signing authority does not match the pinned identity");
  } else {
    requireValue(
      signingIdentity?.certificateThumbprint === expectedSigningIdentity.certificateThumbprint,
      "packaged Windows certificate thumbprint does not match the pinned identity",
    );
  }
  requireValue(typeof signingIdentity?.evidence?.path === "string" && path.isAbsolute(signingIdentity.evidence.path), "signing identity evidence path must be absolute");
  requireValue(/^[a-f0-9]{64}$/.test(signingIdentity.evidence?.sha256 ?? ""), "signing identity evidence requires a lowercase SHA-256");
  const signingEvidence = realpathSync(signingIdentity.evidence.path);
  containedFile(evidenceBase, signingEvidence, "signing identity evidence");
  requireValue(statSync(signingEvidence).size > 0, "signing identity evidence must not be empty");
  requireValue(!evidenceFiles.has(signingEvidence), "signing identity evidence must be distinct from every native checklist artifact");
  requireValue(await hashFile(signingEvidence) === signingIdentity.evidence.sha256, "signing identity evidence SHA-256 mismatch");

  requireValue(typeof result.artifact?.path === "string" && path.isAbsolute(result.artifact.path), "packaged smoke artifact path must be absolute");
  requireValue(/^[a-f0-9]{64}$/.test(result.artifact?.sha256 ?? ""), "packaged smoke artifact requires a lowercase SHA-256");
  const root = realpathSync(bundleRoot);
  const artifact = realpathSync(result.artifact.path);
  const relative = path.relative(root, artifact);
  requireValue(relative && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative), "packaged smoke artifact is outside the fresh Tauri bundle");
  requireValue(statSync(artifact).isFile(), "packaged smoke artifact must be a packaged file");
  requireValue(await hashFile(artifact) === result.artifact.sha256, "packaged smoke artifact SHA-256 mismatch");
  verifyPackageFormat(artifact, expectedPlatform);

  console.log(`Packaged ${expectedPlatform} smoke passed for ${expectedCommit} (${relative}).`);
}

export async function main([
  resultPath,
  expectedPlatform,
  expectedCommit,
  bundleRoot,
  evidenceRoot,
  expectedPrimaryIdentity,
  expectedAuthority,
] = process.argv.slice(2)) {
  if (!resultPath || !expectedPlatform || !expectedCommit || !bundleRoot || !evidenceRoot || !expectedPrimaryIdentity
    || (expectedPlatform === "macos" && !expectedAuthority)) {
    throw new Error("usage: verify-packaged-smoke-result.mjs <result.json> <macos|windows> <commit> <bundle-root> <evidence-root> <team-id|certificate-thumbprint> [codesign-authority]");
  }
  const expectedSigningIdentity = expectedPlatform === "macos"
    ? { teamId: expectedPrimaryIdentity, authority: expectedAuthority }
    : { certificateThumbprint: expectedPrimaryIdentity };
  await verifyPackagedSmokeResult(resultPath, expectedPlatform, expectedCommit, bundleRoot, evidenceRoot, expectedSigningIdentity);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
