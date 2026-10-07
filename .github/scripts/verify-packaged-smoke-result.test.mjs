import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { verifyPackagedSmokeResult as verifyResult } from "./verify-packaged-smoke-result.mjs";

const commit = "a".repeat(40);
const signingIdentities = {
  macos: {
    teamId: "ABCDE12345",
    authority: "Developer ID Application: Monet Labs (ABCDE12345)",
  },
  windows: {
    certificateThumbprint: "A".repeat(40),
  },
};

function verifyPackagedSmokeResult(resultPath, platform, expectedCommit, bundleRoot, evidenceRoot) {
  return verifyResult(resultPath, platform, expectedCommit, bundleRoot, evidenceRoot, signingIdentities[platform]);
}
const commonChecks = [
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

const platformChecks = {
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

function requiredChecks(platform) {
  return [...commonChecks, ...platformChecks[platform]];
}

function fixture(overrides = {}) {
  const platform = overrides.platform ?? "macos";
  const root = mkdtempSync(path.join(tmpdir(), "vision-packaged-smoke-"));
  const bundleRoot = path.join(root, "bundle");
  mkdirSync(bundleRoot);
  const artifactPath = path.join(bundleRoot, platform === "windows" ? "Monet-Vision.msi" : "Monet-Vision.dmg");
  const artifact = platform === "windows"
    ? Buffer.concat([Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]), Buffer.from("signed candidate")])
    : Buffer.alloc(512);
  if (platform === "macos") {
    artifact.write("signed candidate", 16, "utf8");
    artifact.write("koly", 0, "ascii");
  }
  writeFileSync(artifactPath, artifact);
  const artifactSha256 = createHash("sha256").update(artifact).digest("hex");
  const evidenceRoot = path.join(root, "evidence");
  mkdirSync(evidenceRoot);
  const checks = Object.fromEntries(requiredChecks(platform).map((check) => {
    const evidencePath = path.join(evidenceRoot, `${check}.log`);
    const content = `native harness evidence for ${check}\n`;
    writeFileSync(evidencePath, content);
    return [check, {
      status: "pass",
      evidence: {
        path: evidencePath,
        sha256: createHash("sha256").update(content).digest("hex"),
      },
    }];
  }));
  const signingEvidencePath = path.join(evidenceRoot, `${platform}-signing-identity.log`);
  const signingEvidence = `native signing identity evidence for ${platform}\n`;
  writeFileSync(signingEvidencePath, signingEvidence);
  const resultPath = path.join(root, "result.json");
  const result = {
    schemaVersion: 3,
    platform,
    commit,
    status: "pass",
    artifact: { path: artifactPath, sha256: artifactSha256 },
    signingIdentity: {
      ...signingIdentities[platform],
      evidence: {
        path: signingEvidencePath,
        sha256: createHash("sha256").update(signingEvidence).digest("hex"),
      },
    },
    checks,
    ...overrides,
  };
  writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
  return { root, bundleRoot, artifactPath, evidenceRoot, resultPath };
}

async function withFixture(overrides, assertion) {
  const value = fixture(overrides);
  try {
    await assertion(value);
  } finally {
    rmSync(value.root, { recursive: true, force: true });
  }
}

test("accepts a candidate-bound packaged smoke result with every required check", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.doesNotReject(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot));
  });
});

test("accepts a Windows MSI with candidate-bound native checklist evidence", async () => {
  await withFixture({ platform: "windows" }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.doesNotReject(verifyPackagedSmokeResult(resultPath, "windows", commit, bundleRoot, evidenceRoot));
  });
});

test("rejects missing expected macOS signing identity configuration", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.rejects(
      verifyResult(resultPath, "macos", commit, bundleRoot, evidenceRoot),
      /expected macOS signing identity/,
    );
  });
});

test("rejects a macOS package signed by a different Team ID", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.signingIdentity.teamId = "ZZZZZ99999";
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(
      verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot),
      /Team ID/,
    );
  });
});

test("rejects a macOS package signed by a different authority", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.signingIdentity.authority = "Developer ID Application: Impostor (ZZZZZ99999)";
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(
      verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot),
      /authority/,
    );
  });
});

test("rejects a Windows package signed by a different certificate", async () => {
  await withFixture({ platform: "windows" }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.signingIdentity.certificateThumbprint = "B".repeat(40);
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(
      verifyPackagedSmokeResult(resultPath, "windows", commit, bundleRoot, evidenceRoot),
      /certificate thumbprint/,
    );
  });
});

test("rejects signing identity without hash-bound evidence", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    delete result.signingIdentity.evidence;
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(
      verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot),
      /signing identity evidence/,
    );
  });
});

test("rejects a packaged smoke result for a different commit", async () => {
  await withFixture({ commit: "b".repeat(40) }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /commit/);
  });
});

test("rejects a boolean-only packaged smoke result without candidate artifact evidence", async () => {
  await withFixture({ artifact: undefined }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /artifact path/);
  });
});

test("rejects pass strings without hash-bound native checklist evidence", async () => {
  const checks = Object.fromEntries(requiredChecks("macos").map((check) => [check, "pass"]));
  await withFixture({ checks }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /evidence/);
  });
});

test("rejects a packaged smoke result whose artifact is outside the build bundle", async () => {
  await withFixture({}, async ({ root, artifactPath, resultPath, bundleRoot, evidenceRoot }) => {
    const outside = path.join(root, "unrelated.dmg");
    writeFileSync(outside, readFileSync(artifactPath));
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.artifact.path = outside;
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /outside the fresh Tauri bundle/);
  });
});

test("rejects a packaged smoke result with an incorrect artifact hash", async () => {
  await withFixture({ artifact: { path: "replaced below", sha256: "0".repeat(64) } }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.artifact.path = path.join(bundleRoot, "Monet-Vision.dmg");
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /SHA-256/);
  });
});

test("rejects arbitrary text named as a macOS disk image", async () => {
  await withFixture({}, async ({ artifactPath, resultPath, bundleRoot, evidenceRoot }) => {
    writeFileSync(artifactPath, "not a disk image");
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.artifact.sha256 = createHash("sha256").update("not a disk image").digest("hex");
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /DMG/);
  });
});

test("rejects checklist evidence whose hash does not match", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.checks["packaged-launch"].evidence.sha256 = "0".repeat(64);
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /packaged-launch evidence SHA-256 mismatch/);
  });
});

test("rejects a platform-native check whose evidence hash does not match", async () => {
  await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.checks["macos-host-fonts"].evidence.sha256 = "0".repeat(64);
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), /macos-host-fonts evidence SHA-256 mismatch/);
  });
});

test("rejects platform-native checks that reuse another check's evidence file", async () => {
  await withFixture({ platform: "windows" }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
    const result = JSON.parse(readFileSync(resultPath, "utf8"));
    result.checks["windows-native-shortcuts"].evidence = result.checks["windows-native-menus"].evidence;
    writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
    await assert.rejects(verifyPackagedSmokeResult(resultPath, "windows", commit, bundleRoot, evidenceRoot), /windows-native-shortcuts evidence must be distinct/);
  });
});

for (const check of platformChecks.macos) {
  test(`rejects a macOS packaged smoke result without ${check}`, async () => {
    await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      delete result.checks[check];
      writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
      await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), new RegExp(check));
    });
  });
}

for (const check of commonChecks) {
  test(`rejects a packaged smoke result without ${check}`, async () => {
    await withFixture({}, async ({ resultPath, bundleRoot, evidenceRoot }) => {
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      delete result.checks[check];
      writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
      await assert.rejects(verifyPackagedSmokeResult(resultPath, "macos", commit, bundleRoot, evidenceRoot), new RegExp(check));
    });
  });
}

for (const check of platformChecks.windows) {
  test(`rejects a Windows packaged smoke result without ${check}`, async () => {
    await withFixture({ platform: "windows" }, async ({ resultPath, bundleRoot, evidenceRoot }) => {
      const result = JSON.parse(readFileSync(resultPath, "utf8"));
      delete result.checks[check];
      writeFileSync(resultPath, `${JSON.stringify(result)}\n`);
      await assert.rejects(verifyPackagedSmokeResult(resultPath, "windows", commit, bundleRoot, evidenceRoot), new RegExp(check));
    });
  });
}
