// Exercises the three check:models failure modes + the passing case on fixture
// strings, so the test never touches the real public/models tree.
import { describe, it, expect } from "vitest";
// @ts-expect-error — plain .mjs CLI, no type declarations (kept outside tsconfig `src`).
import { auditModels, modelReleaseExcludes } from "./check-model-licenses.mjs";

const CHECKSUMS = [
  `${"a".repeat(64)}  public/models/migan.onnx`,
  `${"b".repeat(64)}  public/models/candy.onnx`,
].join("\n");

const GITIGNORE = ["# too big for GitHub", "drunet_color.onnx", ""].join("\n");

const LICENSE_DOC = [
  "## public/models/migan.onnx",
  "License: MIT",
  "",
  "## public/models/candy.onnx",
  "License: BSD-3-Clause",
  "",
  "## public/models/drunet_color.onnx",
  "License: BSD-3-Clause",
  "",
].join("\n");

const GOOD_FILES = ["public/models/migan.onnx", "public/models/candy.onnx"];

describe("auditModels", () => {
  it("passes on a fully registered tree", () => {
    const { errors } = auditModels({
      modelFiles: GOOD_FILES,
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
    });
    expect(errors).toEqual([]);
  });

  it("errors on an empty modelFiles input (vacuous-pass guard, rule 0)", () => {
    const { errors } = auditModels({
      modelFiles: [],
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
    });
    expect(errors.length).toBeGreaterThan(0);
    expect(errors.some((e: string) => /walker/.test(e))).toBe(true);
  });

  it("flags a release model missing from checksums.txt (rule 1)", () => {
    const { errors } = auditModels({
      modelFiles: [...GOOD_FILES, "public/models/rogue.onnx"],
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      // registered so only rule 1 can fire for the rogue file
      licenseDoc: LICENSE_DOC + "\n## public/models/rogue.onnx\nLicense: MIT\n",
    });
    expect(errors.some((e: string) => e.includes("public/models/rogue.onnx") && /checksums/.test(e))).toBe(true);
  });

  it("flags release model bytes that do not match their pinned SHA-256", () => {
    const { errors } = auditModels({
      modelFiles: GOOD_FILES,
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
      actualHashes: {
        "public/models/migan.onnx": "changed",
        "public/models/candy.onnx": "b".repeat(64),
      },
    });
    expect(errors).toContain(`public/models/migan.onnx: SHA-256 mismatch (expected ${"a".repeat(64)}, got changed)`);
  });

  it("flags a checksum-pinned release model that disappeared from the tree", () => {
    const { errors } = auditModels({
      modelFiles: ["public/models/migan.onnx"],
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
    });
    expect(errors).toContain("public/models/candy.onnx: listed in checksums.txt but absent from the release model tree");
  });

  it("rejects malformed and duplicate checksum rows", () => {
    const { errors } = auditModels({
      modelFiles: GOOD_FILES,
      checksumsText: `${CHECKSUMS}\nnot-a-checksum\n${"c".repeat(64)}  public/models/candy.onnx`,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
    });
    expect(errors.some((error: string) => error.includes("expected \"<64-char SHA-256>"))).toBe(true);
    expect(errors.some((error: string) => error.includes("duplicate path public/models/candy.onnx"))).toBe(true);
  });

  it("flags a model with no License entry in the registry (rule 2)", () => {
    const { errors } = auditModels({
      modelFiles: [...GOOD_FILES, "public/models/u2netp.onnx"],
      // pinned so only rule 2 can fire for u2netp
      checksumsText: CHECKSUMS + "\nccc  public/models/u2netp.onnx",
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC,
    });
    expect(errors.some((e: string) => e.includes("public/models/u2netp.onnx") && /License/.test(e))).toBe(true);
  });

  it("does not treat an empty License field as registration", () => {
    const { errors } = auditModels({
      modelFiles: GOOD_FILES,
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC.replace("License: BSD-3-Clause", "License:   "),
    });
    expect(errors.some((error: string) => error.startsWith("public/models/candy.onnx: no"))).toBe(true);
  });

  it("rejects a non-redistributable license status for a release model", () => {
    const { errors } = auditModels({
      modelFiles: GOOD_FILES,
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE,
      licenseDoc: LICENSE_DOC.replace("License: BSD-3-Clause", "License: No upstream license tag"),
    });
    expect(errors).toContain("public/models/candy.onnx: release license is not an approved SPDX id (No upstream license tag)");
  });

  it("excludes local-only ignored weights from the release audit", () => {
    const { errors, auditedFiles } = auditModels({
      modelFiles: [
        ...GOOD_FILES,
        "public/models/drunet_color.onnx",
        "public/models/sd15/unet/model.onnx",
      ],
      checksumsText: CHECKSUMS,
      gitignoreText: GITIGNORE + "sd15/\n",
      licenseDoc: LICENSE_DOC,
    });
    expect(errors).toEqual([]);
    expect(auditedFiles).toEqual(GOOD_FILES);
  });

  it("rejects exclusions that could escape or glob the model output directory", () => {
    for (const entry of ["../secret", "/absolute", "*.onnx", "sub\\file", ".", "foo/./bar", "foo//bar"])
      expect(() => modelReleaseExcludes(entry)).toThrow("unsupported model release exclusion");
  });
});
