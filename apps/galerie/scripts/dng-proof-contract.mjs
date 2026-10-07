import test from "node:test";
import assert from "node:assert/strict";
import * as nodeFs from "node:fs";
import { readFileSync, mkdtempSync, rmSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import {
  validateDngProof,
  PINNED_FIXTURE_URL,
  PINNED_COLOR_MATRIX,
  PINNED_LIMITS,
  PINNED_CATEGORIES,
  PINNED_SOURCE_STORAGE,
  PINNED_DERIVATIVE,
  PINNED_PIXEL_DIGEST,
  PINNED_PIXEL_SAMPLE_COUNT,
  PINNED_CORE_REVISION,
  PINNED_DECODER_REVISION,
  REQUIRED_DNG_CASES,
  REQUIRED_POSITIVE_CASES,
  categoryFor,
  deriveExistingObjectModified,
} from "./dng-proof-validator.mjs";
import { writeJsonAtomicSync } from "./atomic-write-json.mjs";

/** Build a `negativeCaseMatrix` whose `results` covers every required case
 * (each `ok`) plus any `extra` results, with `categories`/`passed`/`failed`/
 * `ignored` *derived* from that exact `results` array — never hand-picked
 * numbers that could silently drift from what the validator itself
 * recomputes. */
function validMatrix(extraResults = []) {
  const results = [
    ...REQUIRED_DNG_CASES.map((name) => ({
      name,
      status: "ok",
      category: categoryFor(name),
      existingObjectModified: deriveExistingObjectModified(name, "ok"),
    })),
    ...extraResults,
  ];
  const categories = Object.fromEntries(
    [...PINNED_CATEGORIES, "other"].map((c) => [c, { passed: 0, failed: 0, ignored: 0 }]),
  );
  let passed = 0, failed = 0, ignored = 0;
  for (const r of results) {
    const bucket = categories[r.category];
    if (r.status === "ok") { bucket.passed += 1; passed += 1; }
    else if (r.status === "ignored") { bucket.ignored += 1; ignored += 1; }
    else { bucket.failed += 1; failed += 1; }
  }
  return { pinnedCategories: PINNED_CATEGORIES, categories, results, passed, failed, ignored };
}

function validPositiveCases() {
  return REQUIRED_POSITIVE_CASES.map((name) => ({ name, status: "ok" }));
}

/** A minimal, fully-valid proof shape — every mutation test below flips
 * exactly one field away from this baseline to prove the validator's
 * specific branch (and only that branch) catches it. */
function validProof() {
  const matrix = validMatrix();
  const positiveCases = validPositiveCases();
  return {
    pass: true,
    fixture: {
      id: "dng-mosaic-canon-5d3",
      source: PINNED_FIXTURE_URL,
      license: "CC0",
      sha256: "95dc76a2f255e623acaa5149b320389f7da7c995da890c3e0d511c0ff681b2e1",
      bytes: 48382640,
    },
    sourceEvidence: {
      byteOrder: "littleEndian",
      class: "cfa",
      width: 5920,
      height: 3950,
      photometric: 32803,
      samplesPerPixel: 1,
      sampleFormat: [1],
      bitsPerSample: [16],
      newSubfileType: 0,
      orientation: 1,
      cfaDimensions: [2, 2],
      cfaPattern: [0, 1, 1, 2],
      storage: PINNED_SOURCE_STORAGE,
      privateData: [
        {
          ifdPath: "ifd[0]",
          fieldType: 1,
          count: 68560,
          valueBytes: 68560,
          sha256: "8d5074476c6a3ff2148b6b6fb9372313a5066e032a7958e368fd75f2ed19fc62",
        },
      ],
      dngVersion: [1, 4, 0, 0],
      backwardVersion: [1, 1, 0, 0],
      selectedIfdPath: "ifd[0]/subifd[0]",
      selectedIfdOffset: 196558,
    },
    catalog: {
      reopened: true,
      fullByteEquality: true,
      managedPath: "/catalog-assets/managed-originals/sha256/95/x.dng",
      readPath: "/catalog-assets/managed-originals/sha256/95/x.dng",
      originalPath: "/original/on-device.dng",
      photoId: 1,
    },
    managedEvidence: {
      byteOrder: "littleEndian",
      class: "cfa",
      width: 5920,
      height: 3950,
      photometric: 32803,
      samplesPerPixel: 1,
      sampleFormat: [1],
      bitsPerSample: [16],
      newSubfileType: 0,
      orientation: 1,
      cfaDimensions: [2, 2],
      cfaPattern: [0, 1, 1, 2],
      storage: PINNED_SOURCE_STORAGE,
      privateData: [
        {
          ifdPath: "ifd[0]",
          fieldType: 1,
          count: 68560,
          valueBytes: 68560,
          sha256: "8d5074476c6a3ff2148b6b6fb9372313a5066e032a7958e368fd75f2ed19fc62",
        },
      ],
      dngVersion: [1, 4, 0, 0],
      backwardVersion: [1, 1, 0, 0],
      selectedIfdPath: "ifd[0]/subifd[0]",
      selectedIfdOffset: 196558,
    },
    derivative: {
      terminalState: "completed",
      durabilityError: null,
      sha256: PINNED_DERIVATIVE.sha256,
      bytes: PINNED_DERIVATIVE.bytes,
      evidence: {
        byteOrder: "littleEndian",
        class: "linearRaw",
        width: PINNED_DERIVATIVE.width,
        height: PINNED_DERIVATIVE.height,
        photometric: 34892,
        bitsPerSample: [16, 16, 16],
        sampleFormat: [1, 1, 1],
        samplesPerPixel: 3,
        newSubfileType: 0,
        orientation: 1,
        cfaDimensions: null,
        cfaPattern: null,
        privateData: [],
        dngVersion: [1, 2, 0, 0],
        backwardVersion: [1, 2, 0, 0],
        selectedIfdPath: "ifd[0]",
        selectedIfdOffset: 8,
        storage: PINNED_DERIVATIVE.storage,
      },
      metadata: {
        width: PINNED_DERIVATIVE.width,
        height: PINNED_DERIVATIVE.height,
        bitsPerSample: 16,
        samplesPerPixel: 3,
        orientation: 1,
        photometric: 34892,
        outputDigest: PINNED_DERIVATIVE.sha256,
        bytes: PINNED_DERIVATIVE.bytes,
        stripCount: PINNED_DERIVATIVE.stripCount,
        rowsPerStrip: PINNED_DERIVATIVE.rowsPerStrip,
        colorMatrix: PINNED_COLOR_MATRIX,
        provenance: {
          schema: "monet-linear-dng-v1",
          sourceSha256: "95dc76a2f255e623acaa5149b320389f7da7c995da890c3e0d511c0ff681b2e1",
          recipeSha256: PINNED_DERIVATIVE.recipeSha256,
          coreRevision: PINNED_CORE_REVISION,
          workingSpace: "linear-srgb",
          colorimetricReference: "output-referred",
        },
        expectedPixelDigest: PINNED_PIXEL_DIGEST,
      },
      coreImageReopen: true,
      pixels: {
        expectedPixelDigest: PINNED_PIXEL_DIGEST,
        decodedPixelDigest: PINNED_PIXEL_DIGEST,
        maximumLsbDifference: 0,
        countOverOneLsb: 0,
        sampleCount: PINNED_PIXEL_SAMPLE_COUNT,
      },
    },
    immutability: {
      sourceBefore: "s",
      sourceAfter: "s",
      managedBefore: "s",
      managedAfter: "s",
    },
    limits: PINNED_LIMITS,
    positiveCases,
    counts: { passed: positiveCases.length + matrix.passed, failed: 0, skipped: 0, todo: 0 },
    elapsedMilliseconds: 100,
    peakRssBytes: 12345,
    environment: {
      os: "macos",
      arch: "aarch64",
      osBuild: "25E246",
      packageVersion: "0.1.0",
      coreRevision: PINNED_CORE_REVISION,
      decoderRevision: PINNED_DECODER_REVISION,
    },
    negativeCaseMatrix: matrix,
  };
}

test("a fully valid proof passes", () => {
  assert.doesNotThrow(() => validateDngProof(validProof()));
});

test("validator rejects absent proof fields", () =>
  assert.throws(() => validateDngProof({ pass: true }), /fixture/));
test("validator rejects skipped tests", () =>
  assert.throws(() => validateDngProof({ pass: true, fixture: {} }), /fixture/));

test("rejects pass !== true", () =>
  assert.throws(() => validateDngProof({ ...validProof(), pass: false }), /pass/));

test("rejects a wrong fixture digest", () => {
  const p = validProof();
  p.fixture = { ...p.fixture, sha256: "wrong" };
  assert.throws(() => validateDngProof(p), /fixture/);
});

test("rejects a wrong fixture source URL", () => {
  const p = validProof();
  p.fixture = { ...p.fixture, source: "https://example.com/not-the-pinned-fixture" };
  assert.throws(() => validateDngProof(p), /fixture source URL/);
});

test("rejects mismatched source evidence", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, width: 1 };
  assert.throws(() => validateDngProof(p), /source evidence/);
});

test("rejects a wrong source DNG version", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, dngVersion: [1, 2, 0, 0] };
  assert.throws(() => validateDngProof(p), /source version\/selection evidence/);
});

test("rejects a wrong source backward version", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, backwardVersion: [1, 0, 0, 0] };
  assert.throws(() => validateDngProof(p), /source version\/selection evidence/);
});

test("rejects a wrong selected IFD path", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, selectedIfdPath: "ifd[0]" };
  assert.throws(() => validateDngProof(p), /source version\/selection evidence/);
});

test("rejects a wrong selected IFD offset", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, selectedIfdOffset: 0 };
  assert.throws(() => validateDngProof(p), /source version\/selection evidence/);
});

test("rejects more than one tag-50740 record", () => {
  const p = validProof();
  p.sourceEvidence = {
    ...p.sourceEvidence,
    privateData: [...p.sourceEvidence.privateData, p.sourceEvidence.privateData[0]],
  };
  assert.throws(() => validateDngProof(p), /exact tag-50740 evidence/);
});

test("rejects a wrong tag-50740 hash", () => {
  const p = validProof();
  p.sourceEvidence = {
    ...p.sourceEvidence,
    privateData: [{ ...p.sourceEvidence.privateData[0], sha256: "wrong" }],
  };
  assert.throws(() => validateDngProof(p), /exact tag-50740 evidence/);
});

test("rejects a wrong tag-50740 count", () => {
  const p = validProof();
  p.sourceEvidence = {
    ...p.sourceEvidence,
    privateData: [{ ...p.sourceEvidence.privateData[0], count: 1 }],
  };
  assert.throws(() => validateDngProof(p), /exact tag-50740 evidence/);
});

test("rejects a managed path that does not match the read path", () => {
  const p = validProof();
  p.catalog = { ...p.catalog, managedPath: "/somewhere/else.dng" };
  assert.throws(() => validateDngProof(p), /catalog paths/);
});

test("rejects a managed read path equal to the original display path", () => {
  const p = validProof();
  p.catalog = { ...p.catalog, originalPath: p.catalog.readPath };
  assert.throws(() => validateDngProof(p), /catalog paths/);
});

test("rejects a non-completed terminal state", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, terminalState: "failed" };
  assert.throws(() => validateDngProof(p), /derivative/);
});

test("rejects a nonzero durability error", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, durabilityError: "sync failed" };
  assert.throws(() => validateDngProof(p), /derivative/);
});

test("rejects a derivative that leaked CFA dimensions", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, cfaDimensions: [2, 2] },
  };
  assert.throws(() => validateDngProof(p), /prohibited/);
});

test("rejects a derivative that leaked source private-data evidence", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, privateData: [{ sha256: "leaked" }] },
  };
  assert.throws(() => validateDngProof(p), /prohibited/);
});

test("rejects a derivative DNG version other than 1.2.0.0", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, dngVersion: [1, 4, 0, 0] },
  };
  assert.throws(() => validateDngProof(p), /dngVersion\/backwardVersion/);
});

test("rejects a derivative backward version other than 1.2.0.0", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, backwardVersion: [1, 1, 0, 0] },
  };
  assert.throws(() => validateDngProof(p), /dngVersion\/backwardVersion/);
});

test("rejects a wrong D50 color matrix", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: { ...p.derivative.metadata, colorMatrix: [[1, 1]] },
  };
  assert.throws(() => validateDngProof(p), /colorMatrix/);
});

test("rejects a provenance with the wrong schema", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, schema: "other" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a provenance missing sourceSha256", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, sourceSha256: "" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a provenance missing recipeSha256", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, recipeSha256: "" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a provenance missing coreRevision", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, coreRevision: "" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a provenance with the wrong working space", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, workingSpace: "srgb" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a provenance with the wrong colorimetric reference", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, colorimetricReference: "scene-referred" },
    },
  };
  assert.throws(() => validateDngProof(p), /provenance/);
});

test("rejects a pixel digest mismatch", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    pixels: { ...p.derivative.pixels, decodedPixelDigest: "different" },
  };
  assert.throws(() => validateDngProof(p), /pixels/);
});

test("rejects a maximum LSB difference over one", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    pixels: { ...p.derivative.pixels, maximumLsbDifference: 2 },
  };
  assert.throws(() => validateDngProof(p), /pixels/);
});

test("rejects a source digest that changed across the run", () => {
  const p = validProof();
  p.immutability = { ...p.immutability, sourceAfter: "changed" };
  assert.throws(() => validateDngProof(p), /immutability/);
});

test("rejects a managed-original digest that changed across the run", () => {
  const p = validProof();
  p.immutability = { ...p.immutability, managedAfter: "changed" };
  assert.throws(() => validateDngProof(p), /immutability/);
});

test("rejects a nonzero failed count", () => {
  const p = validProof();
  p.counts = { ...p.counts, failed: 1 };
  assert.throws(() => validateDngProof(p), /counts/);
});

test("rejects a nonzero skipped count", () => {
  const p = validProof();
  p.counts = { ...p.counts, skipped: 1 };
  assert.throws(() => validateDngProof(p), /counts/);
});

test("rejects a nonzero todo count", () => {
  const p = validProof();
  p.counts = { ...p.counts, todo: 1 };
  assert.throws(() => validateDngProof(p), /counts/);
});

test("rejects a zero passed count", () => {
  const p = validProof();
  p.counts = { ...p.counts, passed: 0 };
  assert.throws(() => validateDngProof(p), /counts/);
});

test("rejects a missing peak RSS", () => {
  const p = validProof();
  p.peakRssBytes = 0;
  assert.throws(() => validateDngProof(p), /environment/);
});

test("rejects a missing environment field", () => {
  const p = validProof();
  p.environment = { ...p.environment, os: undefined };
  assert.throws(() => validateDngProof(p), /environment/);
});

test("rejects a missing core revision", () => {
  const p = validProof();
  p.environment = { ...p.environment, coreRevision: "" };
  // Caught by the derivative-provenance cross-consistency check first
  // (`provenance.coreRevision` no longer equals the mutated
  // `environment.coreRevision`) — a stronger, earlier check than the
  // standalone exact-value check below.
  assert.throws(() => validateDngProof(p), /derivative provenance/);
});

test("rejects a core revision that aliases the package version", () => {
  const p = validProof();
  p.environment = { ...p.environment, coreRevision: p.environment.packageVersion };
  assert.throws(() => validateDngProof(p), /derivative provenance/);
});

test("rejects an environment core revision other than the exact pinned value", () => {
  const p = validProof();
  // Keeping `provenance.coreRevision` in sync with the mutated
  // `environment.coreRevision` still fails: the derivative-provenance
  // check independently pins `provenance.coreRevision` to the exact
  // literal too, so a value that is merely *consistent* between the two
  // fields but not the actual pinned revision is still caught there first
  // — the later standalone `environment.coreRevision` check is genuinely
  // unreachable in isolation once that stronger check exists.
  p.environment = { ...p.environment, coreRevision: "some-other-revision" };
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, coreRevision: "some-other-revision" },
    },
  };
  assert.throws(() => validateDngProof(p), /derivative provenance/);
});

test("rejects a decoder revision other than the exact pinned value", () => {
  const p = validProof();
  p.environment = { ...p.environment, decoderRevision: "1" };
  assert.throws(() => validateDngProof(p), /environment decoderRevision/);
});

test("rejects a derivative provenance core revision that does not match environment.coreRevision", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    metadata: {
      ...p.derivative.metadata,
      provenance: { ...p.derivative.metadata.provenance, coreRevision: "monet-galerie-dng-core-1-stale" },
    },
  };
  assert.throws(() => validateDngProof(p), /derivative provenance/);
});

test("rejects a wrong parser/writer limit constant", () => {
  const p = validProof();
  p.limits = { ...p.limits, chunks: 1 };
  assert.throws(() => validateDngProof(p), /limits/);
});

test("rejects a missing negative-case matrix", () => {
  const p = validProof();
  delete p.negativeCaseMatrix;
  assert.throws(() => validateDngProof(p), /negativeCaseMatrix/);
});

test("rejects a negative-case matrix missing a pinned category", () => {
  const p = validProof();
  p.negativeCaseMatrix = {
    ...p.negativeCaseMatrix,
    pinnedCategories: PINNED_CATEGORIES.slice(0, 4),
  };
  assert.throws(() => validateDngProof(p), /pinnedCategories/);
});

test("rejects a negative-case matrix with an empty results array", () => {
  const p = validProof();
  p.negativeCaseMatrix = { ...p.negativeCaseMatrix, results: [] };
  assert.throws(() => validateDngProof(p), /results/);
});

test("rejects a negative-case matrix with a duplicate test name", () => {
  const p = validProof();
  const dup = p.negativeCaseMatrix.results[0];
  p.negativeCaseMatrix = {
    ...p.negativeCaseMatrix,
    results: [...p.negativeCaseMatrix.results, dup],
  };
  assert.throws(() => validateDngProof(p), /duplicate test name/);
});

test("rejects a negative-case matrix result with an invalid status", () => {
  const p = validProof();
  p.negativeCaseMatrix = {
    ...p.negativeCaseMatrix,
    results: [{ name: "dng::tests::x", status: "weird" }],
  };
  assert.throws(() => validateDngProof(p), /result status/);
});

// Corrupting only the self-reported `categories` bucket (without touching
// `results` to match) is caught by the independent recompute-from-results
// cross-check, before ever reaching the per-category real-bucket check —
// proving that cross-check works. Also proves the now-unreachable-in-
// isolation "zero passed" case: once every pinned category's required
// cases must all be present and `ok` (checked earlier), a category can
// never legitimately show zero passed while still satisfying that — so
// removing a category's results here is caught by the *required-case*
// check, not the category-bucket check, and that's the correct, more
// specific failure to report.
for (const category of PINNED_CATEGORIES) {
  test(`rejects a self-reported ${category} category bucket that disagrees with results`, () => {
    const p = validProof();
    p.negativeCaseMatrix = {
      ...p.negativeCaseMatrix,
      categories: { ...p.negativeCaseMatrix.categories, [category]: { passed: 0, failed: 0, ignored: 0 } },
    };
    assert.throws(() => validateDngProof(p), /categories do not match recomputed tallies/);
  });

  test(`rejects removing every required case from the ${category} category`, () => {
    const p = validProof();
    const removed = p.negativeCaseMatrix.results.filter((r) => r.category === category).length;
    p.negativeCaseMatrix = {
      ...p.negativeCaseMatrix,
      results: p.negativeCaseMatrix.results.filter((r) => r.category !== category),
      categories: { ...p.negativeCaseMatrix.categories, [category]: { passed: 0, failed: 0, ignored: 0 } },
      passed: p.negativeCaseMatrix.passed - removed,
    };
    // Whichever check reaches the missing name first: the preservation-
    // required-case check (if this category happens to contain one of the
    // explicit preservation-claiming required cases) or the general
    // required-case-presence check (otherwise) — both correctly reject the
    // same underlying defect (a required case silently disappeared).
    assert.throws(() => validateDngProof(p), /missing required case|must report existingObjectModified/);
  });
}

/** The module-name prefix `categoryFor` actually keys off of, so a
 * synthetic extra result lands in the intended category for real (not
 * "other"). */
const CATEGORY_MODULE_PREFIX = {
  parser: "dng::",
  publisher: "atomic_publish::",
  managed: "catalog::",
  writer: "linear_dng::",
  lifecycle: "develop_job::",
};

for (const category of PINNED_CATEGORIES) {
  test(`rejects a real failed test in the ${category} category`, () => {
    const p = validProof();
    const before = p.negativeCaseMatrix.categories[category];
    p.negativeCaseMatrix = {
      ...p.negativeCaseMatrix,
      results: [
        ...p.negativeCaseMatrix.results,
        {
          name: `${CATEGORY_MODULE_PREFIX[category]}tests::synthetic_failed_case`,
          status: "failed",
          category,
          existingObjectModified: null,
        },
      ],
      categories: { ...p.negativeCaseMatrix.categories, [category]: { ...before, failed: before.failed + 1 } },
      failed: p.negativeCaseMatrix.failed + 1,
    };
    assert.throws(() => validateDngProof(p), new RegExp(`category ${category}`));
  });

  test(`rejects a real ignored test in the ${category} category`, () => {
    const p = validProof();
    const before = p.negativeCaseMatrix.categories[category];
    p.negativeCaseMatrix = {
      ...p.negativeCaseMatrix,
      results: [
        ...p.negativeCaseMatrix.results,
        {
          name: `${CATEGORY_MODULE_PREFIX[category]}tests::synthetic_ignored_case`,
          status: "ignored",
          category,
          existingObjectModified: null,
        },
      ],
      categories: { ...p.negativeCaseMatrix.categories, [category]: { ...before, ignored: before.ignored + 1 } },
      ignored: p.negativeCaseMatrix.ignored + 1,
    };
    assert.throws(() => validateDngProof(p), new RegExp(`category ${category}`));
  });
}

test("rejects a negative-case matrix with a nonzero failed total", () => {
  const p = validProof();
  p.negativeCaseMatrix = { ...p.negativeCaseMatrix, failed: 1 };
  assert.throws(() => validateDngProof(p), /negativeCaseMatrix totals/);
});

test("rejects a negative-case matrix with a nonzero ignored total", () => {
  const p = validProof();
  p.negativeCaseMatrix = { ...p.negativeCaseMatrix, ignored: 1 };
  assert.throws(() => validateDngProof(p), /negativeCaseMatrix totals/);
});

test("rejects a negative-case matrix with a zero passed total", () => {
  const p = validProof();
  p.negativeCaseMatrix = { ...p.negativeCaseMatrix, passed: 0 };
  assert.throws(() => validateDngProof(p), /negativeCaseMatrix totals/);
});

// --- exact required-key enforcement (`exactKeys`) --------------------------

test("rejects a top-level proof object with an unexpected extra key", () => {
  const p = validProof();
  p.unexpectedExtra = true;
  assert.throws(() => validateDngProof(p), /top-level keys/);
});

test("rejects a top-level proof object missing a required key", () => {
  const p = validProof();
  delete p.limits;
  assert.throws(() => validateDngProof(p), /top-level keys/);
});

test("rejects a fixture object with an unexpected extra key", () => {
  const p = validProof();
  p.fixture = { ...p.fixture, extra: 1 };
  assert.throws(() => validateDngProof(p), /fixture keys/);
});

test("rejects a sourceEvidence object missing a required key", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence };
  delete p.sourceEvidence.byteOrder;
  assert.throws(() => validateDngProof(p), /sourceEvidence keys/);
});

test("rejects a sourceEvidence.storage object with an unexpected extra key", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, storage: { ...p.sourceEvidence.storage, extra: 1 } };
  assert.throws(() => validateDngProof(p), /sourceEvidence\.storage keys/);
});

test("rejects a catalog object with an unexpected extra key", () => {
  const p = validProof();
  p.catalog = { ...p.catalog, extra: 1 };
  assert.throws(() => validateDngProof(p), /catalog keys/);
});

test("rejects a derivative object missing a required key", () => {
  const p = validProof();
  p.derivative = { ...p.derivative };
  delete p.derivative.coreImageReopen;
  assert.throws(() => validateDngProof(p), /derivative keys/);
});

test("rejects a derivative.evidence.storage object with an unexpected extra key", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, storage: { ...p.derivative.evidence.storage, extra: 1 } },
  };
  assert.throws(() => validateDngProof(p), /derivative\.evidence\.storage keys/);
});

test("rejects a derivative.metadata object with an unexpected extra key", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, extra: 1 } };
  assert.throws(() => validateDngProof(p), /derivative\.metadata keys/);
});

test("rejects a derivative.metadata.provenance object missing a required key", () => {
  const p = validProof();
  const provenance = { ...p.derivative.metadata.provenance };
  delete provenance.workingSpace;
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, provenance } };
  assert.throws(() => validateDngProof(p), /derivative\.metadata\.provenance keys/);
});

test("rejects a derivative.pixels object with an unexpected extra key", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, pixels: { ...p.derivative.pixels, extra: 1 } };
  assert.throws(() => validateDngProof(p), /derivative\.pixels keys/);
});

test("rejects an immutability object missing a required key", () => {
  const p = validProof();
  const immutability = { ...p.immutability };
  delete immutability.managedAfter;
  p.immutability = immutability;
  assert.throws(() => validateDngProof(p), /immutability keys/);
});

test("rejects a counts object with an unexpected extra key", () => {
  const p = validProof();
  p.counts = { ...p.counts, extra: 1 };
  assert.throws(() => validateDngProof(p), /counts keys/);
});

test("rejects an environment object missing a required key", () => {
  const p = validProof();
  const environment = { ...p.environment };
  delete environment.osBuild;
  p.environment = environment;
  assert.throws(() => validateDngProof(p), /environment keys/);
});

test("rejects a negativeCaseMatrix object with an unexpected extra key", () => {
  const p = validProof();
  p.negativeCaseMatrix = { ...p.negativeCaseMatrix, extra: 1 };
  assert.throws(() => validateDngProof(p), /negativeCaseMatrix keys/);
});

// --- managed/source evidence equality, exact source storage ---------------

test("rejects managedEvidence that differs from sourceEvidence", () => {
  const p = validProof();
  p.managedEvidence = { ...p.managedEvidence, width: 1 };
  assert.throws(() => validateDngProof(p), /managedEvidence must equal sourceEvidence/);
});

test("rejects a source storage chunk count other than exactly one strip", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, storage: { ...p.sourceEvidence.storage, chunkCount: 2 } };
  assert.throws(() => validateDngProof(p), /source storage evidence/);
});

test("rejects a source storage first offset other than the exact pinned value", () => {
  const p = validProof();
  p.sourceEvidence = { ...p.sourceEvidence, storage: { ...p.sourceEvidence.storage, firstOffset: 1 } };
  assert.throws(() => validateDngProof(p), /source storage evidence/);
});

// --- exact derivative dimensions/storage/bytes/sha256 ----------------------

test("rejects a derivative width other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, evidence: { ...p.derivative.evidence, width: 1 } };
  assert.throws(() => validateDngProof(p), /derivative exact dimensions\/storage\/bytes\/sha256/);
});

test("rejects a derivative bytes count other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, bytes: 1 };
  assert.throws(() => validateDngProof(p), /derivative exact dimensions\/storage\/bytes\/sha256/);
});

test("rejects a derivative sha256 other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, sha256: "0".repeat(64) };
  assert.throws(() => validateDngProof(p), /derivative exact dimensions\/storage\/bytes\/sha256/);
});

test("rejects a derivative storage first offset other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, storage: { ...p.derivative.evidence.storage, firstOffset: 1 } },
  };
  assert.throws(() => validateDngProof(p), /derivative exact dimensions\/storage\/bytes\/sha256/);
});

test("rejects a derivative storage total bytes other than the exact pixel-count-derived value", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    evidence: { ...p.derivative.evidence, storage: { ...p.derivative.evidence.storage, totalBytes: 1 } },
  };
  assert.throws(() => validateDngProof(p), /derivative exact dimensions\/storage\/bytes\/sha256/);
});

// --- output metadata exactness / cross-consistency --------------------------

test("rejects derivative.metadata.bytes that disagrees with derivative.bytes", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, bytes: p.derivative.bytes + 1 } };
  assert.throws(() => validateDngProof(p), /output metadata exact\/cross-consistency/);
});

test("rejects derivative.metadata.outputDigest that disagrees with derivative.sha256", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, outputDigest: "0".repeat(64) } };
  assert.throws(() => validateDngProof(p), /output metadata exact\/cross-consistency/);
});

test("rejects a derivative.metadata.stripCount other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, stripCount: 1 } };
  assert.throws(() => validateDngProof(p), /output metadata exact\/cross-consistency/);
});

test("rejects a derivative.metadata.rowsPerStrip other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, rowsPerStrip: 1 } };
  assert.throws(() => validateDngProof(p), /output metadata exact\/cross-consistency/);
});

test("rejects a derivative.metadata.expectedPixelDigest other than the exact pinned pixel digest", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, metadata: { ...p.derivative.metadata, expectedPixelDigest: "0".repeat(64) } };
  assert.throws(() => validateDngProof(p), /output metadata exact\/cross-consistency/);
});

test("rejects a pixel sample count other than the exact pinned value", () => {
  const p = validProof();
  p.derivative = { ...p.derivative, pixels: { ...p.derivative.pixels, sampleCount: 1 } };
  assert.throws(() => validateDngProof(p), /pixels/);
});

test("rejects a pixel digest other than the exact pinned value even when expected===decoded", () => {
  const p = validProof();
  p.derivative = {
    ...p.derivative,
    pixels: { ...p.derivative.pixels, expectedPixelDigest: "0".repeat(64), decodedPixelDigest: "0".repeat(64) },
  };
  assert.throws(() => validateDngProof(p), /pixels/);
});

// --- named positive cases ---------------------------------------------------

test("rejects a missing positiveCases array", () => {
  const p = validProof();
  delete p.positiveCases;
  assert.throws(() => validateDngProof(p), /top-level keys|positiveCases/);
});

test("rejects an empty positiveCases array", () => {
  const p = validProof();
  p.positiveCases = [];
  p.counts = { ...p.counts, passed: 0 + p.negativeCaseMatrix.passed };
  assert.throws(() => validateDngProof(p), /positiveCases/);
});

test("rejects a duplicate positiveCases name", () => {
  const p = validProof();
  p.positiveCases = [...p.positiveCases, p.positiveCases[0]];
  assert.throws(() => validateDngProof(p), /positiveCases duplicate name/);
});

test("rejects a positiveCases entry with a non-ok status", () => {
  const p = validProof();
  p.positiveCases = [...p.positiveCases];
  p.positiveCases[0] = { ...p.positiveCases[0], status: "failed" };
  assert.throws(() => validateDngProof(p), /positiveCases entry status/);
});

test("rejects a positiveCases array missing a required case", () => {
  const p = validProof();
  p.positiveCases = p.positiveCases.slice(1);
  p.counts = { ...p.counts, passed: p.counts.passed - 1 };
  assert.throws(() => validateDngProof(p), /positiveCases exact required set/);
});

test("rejects a positiveCases array with an unexpected extra case", () => {
  const p = validProof();
  p.positiveCases = [...p.positiveCases, { name: "unexpected.extra.case", status: "ok" }];
  p.counts = { ...p.counts, passed: p.counts.passed + 1 };
  assert.throws(() => validateDngProof(p), /positiveCases exact required set/);
});

// --- counts.passed recomputation, per-result category/preservation --------

test("rejects a counts.passed that is not positiveCases.length + negativeCaseMatrix.passed", () => {
  const p = validProof();
  p.counts = { ...p.counts, passed: p.counts.passed + 1 };
  assert.throws(() => validateDngProof(p), /counts\.passed is not recomputed/);
});

test("rejects a negativeCaseMatrix result whose category does not match its own name", () => {
  const p = validProof();
  p.negativeCaseMatrix = {
    ...p.negativeCaseMatrix,
    results: p.negativeCaseMatrix.results.map((r) =>
      r.name === "dng::tests::fixture_1022" ? { ...r, category: "writer" } : r,
    ),
  };
  assert.throws(() => validateDngProof(p), /result category/);
});

test("rejects a required preservation case reporting existingObjectModified: null", () => {
  const p = validProof();
  p.negativeCaseMatrix = {
    ...p.negativeCaseMatrix,
    results: p.negativeCaseMatrix.results.map((r) =>
      r.name === "catalog::tests::same_digest_reimport_is_idempotent_and_reuses_the_managed_object"
        ? { ...r, existingObjectModified: null }
        : r,
    ),
  };
  assert.throws(() => validateDngProof(p), /existingObjectModified/);
});

// --- Rust producer — no final-artifact write path ---------------------------
//
// Defect: `dng_product_proof.rs` used to write its raw (pre-enrichment)
// report directly to the final durable artifact path with `std::fs::write`
// (which truncates in place) before the JS wrapper's atomic writer ever
// ran. A kill or failure mid-write could destroy a prior valid artifact.
// The producer must emit its report on stdout only and never touch the
// final artifact under any outcome. Proven statically here (cheap, exact,
// and immune to the flakiness/slowness of spawning a real `cargo run` —
// the full `proof:dng` pipeline already exercises that end to end); the
// dynamic "a producer failure before finalization leaves a pre-existing
// artifact byte-for-byte unchanged" half of this contract is proven
// executably by the Rust unit test
// `dng_product_proof::tests::a_producer_failure_before_finalization_leaves_a_pre_existing_final_artifact_byte_for_byte_unchanged`.
const producerSource = readFileSync(
  fileURLToPath(new URL("../src-tauri/src/bin/dng_product_proof.rs", import.meta.url)),
  "utf8",
);
// Scope every static check below to the production code only (everything
// before the `#[cfg(test)]` module): the executable failure-seam test
// legitimately plants/restores a canary file at the real artifact path
// with a real `std::fs::write` to prove the *behavioral* half of this
// contract, which would otherwise trip a naive whole-file string search.
const testModuleStart = producerSource.indexOf("#[cfg(test)]");
assert.ok(testModuleStart > 0, "expected to find a #[cfg(test)] module boundary");
const productionSource = producerSource.slice(0, testModuleStart);

test("the Rust producer's production code never references the final artifact filename", () => {
  assert.equal(productionSource.includes("dng-proof.json"), false);
});

test("the Rust producer's production code contains no fs::write call anywhere", () => {
  assert.equal(/\bfs::write\s*\(/.test(productionSource), false);
});

test("the Rust producer's main function only ever emits its report via println!", () => {
  const mainMatch = productionSource.match(/fn main\(\)[\s\S]*?\n}\n/);
  assert.ok(mainMatch, "expected to find fn main() in the producer source");
  const mainBody = mainMatch[0];
  assert.match(mainBody, /println!\("\{text\}"\)/);
  assert.equal(/\bfs::write\s*\(/.test(mainBody), false);
});

// --- `writeJsonAtomicSync` — atomic durable-artifact write -----------------
//
// Deterministic fault injection via a small adapter over `node:fs`'s sync
// primitives (never a real disk fault, sleep, or filesystem-exhaustion
// trick): each test overrides exactly one step to throw and proves the
// contract at that specific boundary.

function withTempDir(fn) {
  const dir = mkdtempSync(join(tmpdir(), "galerie-atomic-write-json-"));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

/** Every owned-temp entry this call could have left behind, so a failure
 * test can assert none remain regardless of the exact temp name. */
function tempLeftovers(dir, targetName) {
  return readdirSync(dir).filter((name) => name !== targetName);
}

test("writeJsonAtomicSync writes bytes that are exactly readable back", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"a":1}');
    assert.equal(readFileSync(target, "utf8"), '{"a":1}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("writeJsonAtomicSync overwrites prior bytes exactly, leaving no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"a":1}');
    writeJsonAtomicSync(target, '{"a":2}');
    assert.equal(readFileSync(target, "utf8"), '{"a":2}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a write-step failure preserves the prior artifact and leaves no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    const impl = {
      ...nodeFs,
      writeSync: () => {
        throw new Error("simulated write failure");
      },
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /simulated write failure/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a file-fsync-step failure preserves the prior artifact and leaves no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    let fsyncCalls = 0;
    const impl = {
      ...nodeFs,
      fsyncSync: (fd) => {
        fsyncCalls += 1;
        if (fsyncCalls === 1) throw new Error("simulated file-fsync failure");
        nodeFs.fsyncSync(fd);
      },
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /simulated file-fsync failure/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a rename-step failure preserves the prior artifact and leaves no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    const impl = {
      ...nodeFs,
      renameSync: () => {
        throw new Error("simulated rename failure");
      },
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /simulated rename failure/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a directory-fsync-step failure is a committed write, not a failed one", () => {
  // The rename has already committed by the time only the trailing
  // directory-fsync fails — the new bytes are already visible on disk and
  // must never be reported as though nothing was written. The thrown
  // error is marked `committedWithWarning` so a caller can tell the two
  // failure classes apart.
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    let fsyncCalls = 0;
    const impl = {
      ...nodeFs,
      fsyncSync: (fd) => {
        fsyncCalls += 1;
        if (fsyncCalls === 2) throw new Error("simulated directory-fsync failure");
        nodeFs.fsyncSync(fd);
      },
    };
    let caught;
    try {
      writeJsonAtomicSync(target, '{"after":true}', impl);
      assert.fail("expected the directory-fsync failure to throw");
    } catch (error) {
      caught = error;
    }
    assert.match(caught.message, /simulated directory-fsync failure/);
    assert.equal(caught.committedWithWarning, true);
    // The write itself is already durable and visible — never rolled back.
    assert.equal(readFileSync(target, "utf8"), '{"after":true}');
  });
});

test("an open-step failure leaves no target and no temp when nothing existed before", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    const impl = {
      ...nodeFs,
      openSync: () => {
        throw new Error("simulated open failure");
      },
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /simulated open failure/,
    );
    assert.equal(existsSync(target), false);
    assert.deepEqual(readdirSync(dir), []);
  });
});

// --- `writeJsonAtomicSync` — short-write handling ---------------------------
//
// Defect: the write step called `writeSync` exactly once and ignored its
// returned byte count. Node's `fs.writeSync` may legally write fewer bytes
// than requested (a "short write"); trusting it blindly could publish
// truncated JSON as the durable artifact.

/** A `writeSync` replacement that always writes at most `chunkBytes` bytes
 * per call (a deterministic short write), delegating the actual bytes to
 * the real `node:fs` so the file ends up correct if the loop keeps calling
 * it. Counts calls so a test can prove more than one call was needed. */
function shortWriteImpl(chunkBytes) {
  let calls = 0;
  return {
    ...nodeFs,
    writeSync: (fd, buffer, offset, length, position) => {
      calls += 1;
      const n = Math.min(chunkBytes, length);
      return nodeFs.writeSync(fd, buffer, offset, n, position);
    },
    callCount: () => calls,
  };
}

test("writeJsonAtomicSync completes across several short writes: exact bytes, one rename, no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    const text = JSON.stringify({ a: "0123456789", b: "abcdefghij" });
    let renameCalls = 0;
    const impl = {
      ...shortWriteImpl(3),
      renameSync: (...args) => {
        renameCalls += 1;
        return nodeFs.renameSync(...args);
      },
    };
    writeJsonAtomicSync(target, text, impl);
    assert.equal(readFileSync(target, "utf8"), text);
    assert.equal(renameCalls, 1);
    assert.ok(impl.callCount() > 1, "expected more than one short writeSync call");
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a zero-progress write after a partial write is rejected: error, prior artifact unchanged, no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    let calls = 0;
    const impl = {
      ...nodeFs,
      writeSync: (fd, buffer, offset, length, position) => {
        calls += 1;
        if (calls === 1) return nodeFs.writeSync(fd, buffer, offset, Math.min(3, length), position);
        return 0; // zero progress on the second call
      },
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /invalid byte count/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("an oversized write count is rejected: error, prior artifact unchanged, no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    const impl = {
      ...nodeFs,
      // Claims more bytes were written than were actually requested.
      writeSync: (fd, buffer, offset, length) => length + 1,
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /invalid byte count/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a non-integer write count is rejected: error, prior artifact unchanged, no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    const impl = {
      ...nodeFs,
      // A non-integer count strictly between 0 and `length` — invalid
      // regardless of `length`'s parity.
      writeSync: (fd, buffer, offset, length) => length - 0.5,
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /invalid byte count/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});

test("a negative write count is rejected: error, prior artifact unchanged, no temp", () => {
  withTempDir((dir) => {
    const target = join(dir, "artifact.json");
    writeJsonAtomicSync(target, '{"before":true}');
    const impl = {
      ...nodeFs,
      writeSync: () => -1,
    };
    assert.throws(
      () => writeJsonAtomicSync(target, '{"after":true}', impl),
      /invalid byte count/,
    );
    assert.equal(readFileSync(target, "utf8"), '{"before":true}');
    assert.deepEqual(tempLeftovers(dir, "artifact.json"), []);
  });
});
