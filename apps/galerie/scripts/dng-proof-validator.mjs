export const PINNED_FIXTURE_URL =
  "https://raw.pixls.us/getfile.php/1022/nice/Adobe%20DNG%20Converter%20-%20Canon%20EOS%205D%20Mark%20III%20-%2016bit%2016bit%20uncompressed%20(3:2).DNG";
export const PINNED_COLOR_MATRIX = [
  [3134112, 1000000], [-1617392, 1000000], [-490633, 1000000],
  [-978787, 1000000], [1916280, 1000000], [33455, 1000000],
  [71983, 1000000], [-228986, 1000000], [1405385, 1000000],
];
export const PINNED_LIMITS = {
  ifds: 256,
  depth: 8,
  entriesPerIfd: 4096,
  totalEntries: 16384,
  subIfds: 64,
  chunks: 131072,
  cfaCells: 256,
  privateDigestBytes: 268435456,
  streamBuffer: 1048576,
};
export const PINNED_CATEGORIES = ["parser", "publisher", "managed", "writer", "lifecycle"];

// Exact pinned source (fixture 1022) storage evidence: one strip, exact
// offsets/byte counts — not merely "storage exists."
export const PINNED_SOURCE_STORAGE = {
  kind: "strip",
  chunkCount: 1,
  totalBytes: 46768000,
  firstOffset: 1614640,
  lastEnd: 48382640,
};

// Exact pinned derivative contract. `totalBytes` (132710400) is a pure
// function of pixel count (5760 * 3840 * 3 samples * 2 bytes) and is
// independent of any incidental container/provenance byte length.
// `firstOffset`/`lastEnd`/the derivative's own `bytes`/`sha256` additionally
// depend on the exact header + IFD + embedded-provenance-JSON length this
// build produces; they are pinned to this build's own genuinely
// reproducible output (confirmed bit-identical across repeated runs).
export const PINNED_DERIVATIVE = {
  width: 5760,
  height: 3840,
  bytes: 132711288,
  sha256: "87d3fc21a82325142c7a67e063458df7e0d092112c91dffebfc0b8bbec8222c6",
  storage: {
    kind: "strip",
    chunkCount: 8,
    totalBytes: 132710400,
    firstOffset: 888,
    lastEnd: 132711288,
  },
  rowsPerStrip: 485,
  stripCount: 8,
  recipeSha256: "e4cf902b1034d48597f14794c65b33862cf6d5c62de3d5149cf862ac75c447dc",
};
export const PINNED_PIXEL_DIGEST = "2bd7e0e0ed0aa58dcd63ebcc78cddb9c4511980528cb6a750234024d2ee65485";
export const PINNED_PIXEL_SAMPLE_COUNT = 66355200;
export const PINNED_CORE_REVISION = "monet-galerie-dng-core-1";
export const PINNED_DECODER_REVISION = "2";

// Every criterion-5-critical parser/publisher/managed-transaction/writer/
// lifecycle test, by full name. The validator rejects a proof whose
// `negativeCaseMatrix.results` is missing any one of these — deleting or
// renaming a required case must fail validation, not silently shrink the
// matrix. Generated from a full `cargo test --lib` run of this exact tree;
// see the executor result report for the regeneration command.
export const REQUIRED_DNG_CASES = [
  "atomic_publish::tests::create_in_uses_the_supplied_directory_descriptor_without_reopening_by_path",
  "atomic_publish::tests::drop_never_removes_a_temp_name_reused_by_something_else",
  "atomic_publish::tests::drop_removes_only_the_still_owned_unpublished_temp",
  "atomic_publish::tests::eexist_with_different_bytes_is_a_hard_error_and_leaves_object_untouched",
  "atomic_publish::tests::eexist_with_identical_bytes_reuses_and_leaves_object_untouched",
  "atomic_publish::tests::ensure_dir_nofollow_creates_idempotently_and_fixes_permissions",
  "atomic_publish::tests::ensure_dir_nofollow_rejects_a_symlink_in_place_of_the_directory",
  "atomic_publish::tests::final_guard_failure_publishes_nothing",
  "atomic_publish::tests::final_guard_runs_after_validate_and_can_observe_shared_state",
  "atomic_publish::tests::parent_replaced_before_publish_is_rejected_before_rename",
  "atomic_publish::tests::parent_sync_failure_is_committed_with_warning",
  "atomic_publish::tests::post_publish_digest_failure_is_committed_with_warning",
  "atomic_publish::tests::post_publish_reopen_failure_is_committed_with_warning",
  "atomic_publish::tests::post_rename_reopen_failure_still_reports_committed_with_warning",
  "atomic_publish::tests::published_sync_failure_is_committed_with_warning",
  "atomic_publish::tests::publishes_without_clobber",
  "atomic_publish::tests::rename_step_failure_publishes_nothing",
  "atomic_publish::tests::staged_reopen_failure_publishes_nothing",
  "atomic_publish::tests::staged_sync_failure_publishes_nothing",
  "atomic_publish::tests::validate_failure_publishes_nothing",
  "catalog::tests::a_real_post_visibility_publish_warning_refuses_a_row_and_leaves_a_reclaimable_orphan",
  "catalog::tests::cleanup_never_follows_a_symlinked_shard",
  "catalog::tests::cleanup_removes_only_stale_unreferenced_objects_and_owned_temps",
  "catalog::tests::cleanup_respects_the_exact_24_hour_cutoff_boundary",
  "catalog::tests::db_commit_failure_after_durable_publish_leaves_a_reclaimable_orphan",
  "catalog::tests::final_guard_rejects_a_named_source_file_replaced_before_rename",
  "catalog::tests::final_guard_rejects_a_parent_swap_that_preserves_the_named_components_own_identity",
  "catalog::tests::final_guard_rejects_a_same_inode_same_size_byte_mutation_before_rename",
  "catalog::tests::final_guard_rejects_a_source_parent_replaced_immediately_before_publication",
  "catalog::tests::final_guard_rejects_the_final_component_replaced_by_a_symlink_before_rename",
  "catalog::tests::interrupted_copy_source_truncated_mid_copy_is_rejected",
  "catalog::tests::managed_dng_survives_catalog_reopen_byte_for_byte",
  "catalog::tests::permission_sync_failure_leaves_no_catalog_row_and_a_reclaimable_orphan",
  "catalog::tests::pre_commit_revalidation_rejects_a_named_source_file_replaced_after_publication",
  "catalog::tests::pre_commit_revalidation_rejects_a_source_byte_mutation_after_publication",
  "catalog::tests::pre_commit_revalidation_rejects_a_source_parent_replaced_after_publication",
  "catalog::tests::rejects_a_classification_failure_with_a_valid_preflight_digest",
  "catalog::tests::rejects_a_preflight_digest_mismatch_before_any_copy",
  "catalog::tests::rejects_a_symlink_at_the_final_source_component",
  "catalog::tests::same_digest_reimport_is_idempotent_and_reuses_the_managed_object",
  "catalog::tests::same_path_different_digest_is_rejected_without_mutating_the_existing_row",
  "develop_job::tests::active_id_cleanup_survives_worker_panic_and_terminal_state_is_observable",
  "develop_job::tests::active_job_drop_does_not_clobber_a_state_already_made_terminal_by_run",
  "develop_job::tests::active_job_drop_transitions_to_failed_when_worker_is_abandoned",
  "develop_job::tests::execute_started_is_the_exact_shared_boundary_used_by_command_and_proof",
  "develop_job::tests::native_command_binding_rejects_every_swapped_catalog_value",
  "develop_job::tests::native_command_binding_uses_managed_read_path_not_display_path",
  "develop_job::tests::queued_command_cancellation_is_observable_with_terminal_error",
  "develop_job::tests::stale_terminal_queue_entries_never_remove_an_active_record",
  "develop_job::tests::start_allows_reuse_of_a_job_id_once_the_prior_run_reached_a_terminal_state",
  "develop_job::tests::start_rejects_a_duplicate_active_job_id",
  "develop_job::tests::state_history_is_bounded_and_terminal_errors_are_retained",
  "develop_job::tests::terminal_id_reuse_cannot_be_evicted_while_active",
  "dng::tests::classifies_minimal_cfa_both_byte_orders",
  "dng::tests::fixture_1022",
  "dng::tests::rejects_bigtiff_magic",
  "dng::tests::rejects_bits_per_sample_arity_mismatch",
  "dng::tests::rejects_cfa_cells_over_cap",
  "dng::tests::rejects_cfa_missing_pattern_dim",
  "dng::tests::rejects_cfa_tags_on_non_raw_photometric",
  "dng::tests::rejects_cyclic_subifd_offset",
  "dng::tests::rejects_duplicate_subifd_offset_across_siblings",
  "dng::tests::rejects_duplicate_tag_within_ifd",
  "dng::tests::rejects_entries_per_ifd_over_cap_before_reading_entries",
  "dng::tests::rejects_ifd_count_over_cap_before_reading_final_ifd",
  "dng::tests::rejects_ifd_offset_outside_file",
  "dng::tests::rejects_image_chunk_count_over_cap",
  "dng::tests::rejects_invalid_byte_order_marker",
  "dng::tests::rejects_linear_raw_with_cfa_tags",
  "dng::tests::rejects_neither_strip_nor_tile_present",
  "dng::tests::rejects_orientation_value_that_would_wrap_into_range",
  "dng::tests::rejects_overlapping_image_chunks",
  "dng::tests::rejects_photometric_value_out_of_u16_range",
  "dng::tests::rejects_storage_smaller_than_declared_geometry",
  "dng::tests::rejects_strip_and_tile_both_present",
  "dng::tests::rejects_subifd_count_over_cap",
  "dng::tests::rejects_subifd_depth_over_cap",
  "dng::tests::rejects_total_entries_over_cap_before_reading_final_ifd",
  "dng::tests::selects_higher_resolution_candidate_by_descending_score",
  "dng::tests::selects_lexicographically_smaller_path_on_score_tie",
  "linear_dng::tests::independent_validation_catches_a_corrupted_strip",
  "linear_dng::tests::independent_validation_never_reads_more_than_the_documented_chunk_bound",
  "linear_dng::tests::linear_dng_reopens",
  "linear_dng::tests::per_strip_cancellation_stops_the_write_between_strips",
  "linear_dng::tests::plan_strip_offsets_accepts_a_layout_exactly_at_the_u32_max_boundary",
  "linear_dng::tests::plan_strip_offsets_rejects_a_running_total_over_u32_max_without_wrapping",
  "linear_dng::tests::plan_strip_offsets_rejects_checked_add_overflow_of_the_u64_running_total",
  "linear_dng::tests::plan_strip_offsets_rejects_checked_narrowing_instead_of_wrapping",
  "linear_dng::tests::plan_strips_produces_a_valid_boundary_layout",
  "linear_dng::tests::plan_strips_rejects_a_row_over_the_strip_cap",
  "linear_dng::tests::plan_strips_rejects_zero_width",
  "linear_dng::tests::rejects_a_classic_tiff_file_size_over_u32_max_before_touching_pixel_data",
  "linear_dng::tests::rejects_a_row_wider_than_the_strip_bound_instead_of_emitting_an_oversized_strip",
];

// Every checkpoint the product proof binary itself must independently
// verify and report by name (never only an opaque `passed: N` counter) —
// see `bin/dng_product_proof.rs`'s `mark(...)` calls. Deleting or renaming
// one must fail validation.
export const REQUIRED_POSITIVE_CASES = [
  "fixture.digestAndByteCountExact",
  "fixture.selectedIfdGeometryVersionExact",
  "fixture.storageEvidenceExact",
  "fixture.tag50740EvidenceExact",
  "managedImport.transactionCommitted",
  "catalog.distinctDisplayAndReadPath",
  "catalog.sourceManagedEquivalenceAfterReopen",
  "command.validationBoundaryPassed",
  "lifecycle.startedRegisteredBeforeExecution",
  "lifecycle.reachedCompleted",
  "derivative.linearDngResult",
  "derivative.noProhibitedTags",
  "derivative.coreDecoderRevisionMatch",
  "derivative.exactGeometryStorageBytesDigestExact",
  "derivative.exactOutputMetadataAndProvenanceExact",
  "derivative.pixelComparisonExact",
  "derivative.coreImageReopen",
  "immutability.sourceUnchanged",
  "immutability.managedUnchanged",
];

export function categoryFor(name) {
  if (name.startsWith("dng::")) return "parser";
  if (name.startsWith("atomic_publish::")) return "publisher";
  if (name.startsWith("catalog::")) return "managed";
  if (name.startsWith("linear_dng::")) return "writer";
  if (name.startsWith("develop_job::")) return "lifecycle";
  return "other";
}

// Duplicated (not imported) from `dng-proof.mjs` on purpose: the validator
// must independently recompute what the derivation *should* produce and
// compare it against what was reported, rather than trusting the producer's
// own computation of its own contract. A test name asserting an
// object/row-preservation contract must never report `existingObjectModified:
// null` when it passed — widened past bare "untouched"/"unchanged"/"preserv"
// to the exact patterns the architecture names (`without_mutating`,
// `does_not_clobber`) plus every currently-required case that makes an
// equivalent claim (`reuse`, `byte_for_byte`).
export const PRESERVATION_NAME = /untouched|unchanged|preserv|reuse|without_mutating|does_not_clobber|byte_for_byte/i;
export function deriveExistingObjectModified(name, status) {
  if (!PRESERVATION_NAME.test(name)) return null;
  return status !== "ok";
}

// A key-order-independent structural comparison — Rust's `serde_json::json!`
// does not guarantee object key order matches source order (it's a
// `BTreeMap`, i.e. alphabetical), so a naive `JSON.stringify` comparison
// would spuriously reject a structurally identical value.
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical(value[k])]));
  }
  return value;
}
function sameJson(a, b) {
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}

/** Reject an object carrying any key outside `keys`, or missing any key in
 * `keys` — a missing or renamed/aliased field must fail exactly like a
 * wrong value, not pass silently because the check only probed a subset. */
function exactKeys(obj, keys, label, fail) {
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) fail(`${label} missing`);
  const actual = Object.keys(obj).sort();
  const expected = [...keys].sort();
  if (!sameJson(actual, expected)) {
    fail(`${label} keys: expected exactly [${expected.join(",")}], got [${actual.join(",")}]`);
  }
}

export function validateDngProof(value) {
  const fail = (message) => { throw new Error(`invalid DNG proof: ${message}`); };
  if (!value || value.pass !== true) fail("pass");

  exactKeys(
    value,
    [
      "pass", "fixture", "sourceEvidence", "catalog", "managedEvidence", "derivative",
      "immutability", "limits", "positiveCases", "counts", "environment",
      "elapsedMilliseconds", "peakRssBytes", "negativeCaseMatrix",
    ],
    "top-level",
    fail,
  );

  exactKeys(value.fixture, ["id", "source", "license", "sha256", "bytes"], "fixture", fail);
  if (
    value.fixture?.id !== "dng-mosaic-canon-5d3" ||
    value.fixture?.license !== "CC0" ||
    value.fixture?.sha256 !== "95dc76a2f255e623acaa5149b320389f7da7c995da890c3e0d511c0ff681b2e1" ||
    value.fixture?.bytes !== 48382640
  ) fail("fixture");
  if (value.fixture?.source !== PINNED_FIXTURE_URL) fail("fixture source URL");

  const source = value.sourceEvidence;
  exactKeys(
    source,
    [
      "byteOrder", "dngVersion", "backwardVersion", "selectedIfdPath", "selectedIfdOffset",
      "class", "width", "height", "bitsPerSample", "samplesPerPixel", "sampleFormat",
      "photometric", "newSubfileType", "orientation", "cfaDimensions", "cfaPattern",
      "storage", "privateData",
    ],
    "sourceEvidence",
    fail,
  );
  if (source?.class !== "cfa" || source?.width !== 5920 || source?.height !== 3950 || source?.photometric !== 32803 || source?.samplesPerPixel !== 1 || source?.bitsPerSample?.[0] !== 16 || String(source?.cfaDimensions) !== "2,2" || String(source?.cfaPattern) !== "0,1,1,2" || !source?.privateData?.length) fail("source evidence");
  if (String(source?.dngVersion) !== "1,4,0,0" || String(source?.backwardVersion) !== "1,1,0,0" || source?.selectedIfdPath !== "ifd[0]/subifd[0]" || source?.selectedIfdOffset !== 196558) fail("source version/selection evidence");
  // Exact source storage evidence — one strip, exact offsets/byte counts.
  exactKeys(source?.storage, ["kind", "chunkCount", "totalBytes", "firstOffset", "lastEnd"], "sourceEvidence.storage", fail);
  if (!sameJson(source?.storage, PINNED_SOURCE_STORAGE)) fail("source storage evidence");
  // Exactly one tag-50740 record, with its exact path/type/count/
  // value-byte-length/hash — not merely "some private data exists."
  const tag50740 = source?.privateData;
  if (
    !Array.isArray(tag50740) || tag50740.length !== 1 ||
    tag50740[0]?.ifdPath !== "ifd[0]" ||
    tag50740[0]?.fieldType !== 1 ||
    tag50740[0]?.count !== 68560 ||
    tag50740[0]?.valueBytes !== 68560 ||
    tag50740[0]?.sha256 !== "8d5074476c6a3ff2148b6b6fb9372313a5066e032a7958e368fd75f2ed19fc62"
  ) fail("exact tag-50740 evidence");

  if (!value.catalog?.reopened || !value.catalog?.fullByteEquality || value.catalog?.managedPath !== value.catalog?.readPath || value.catalog?.originalPath === value.catalog?.readPath) fail("catalog paths");
  exactKeys(value.catalog, ["originalPath", "managedPath", "readPath", "photoId", "reopened", "fullByteEquality"], "catalog", fail);

  // The managed original's own classified evidence must be structurally
  // identical to the source's — not merely present.
  if (!sameJson(value.managedEvidence, value.sourceEvidence)) fail("managedEvidence must equal sourceEvidence");

  const derivative = value.derivative;
  exactKeys(
    derivative,
    ["terminalState", "durabilityError", "sha256", "bytes", "evidence", "metadata", "pixels", "coreImageReopen"],
    "derivative",
    fail,
  );
  if (derivative?.terminalState !== "completed" || derivative?.durabilityError !== null || derivative?.evidence?.class !== "linearRaw" || derivative?.evidence?.photometric !== 34892 || derivative?.evidence?.bitsPerSample?.some((n) => n !== 16) || derivative?.evidence?.samplesPerPixel !== 3 || derivative?.evidence?.orientation !== 1 || !derivative?.coreImageReopen) fail("derivative");
  // Prohibited-tag absence: a LinearRaw derivative must never carry CFA
  // layout or source private/MakerNote evidence.
  if (derivative?.evidence?.cfaDimensions != null || derivative?.evidence?.cfaPattern != null || derivative?.evidence?.privateData?.length) fail("derivative prohibited tags");
  // Exact DNG 1.2 versions — required so a derivative can never silently
  // regress to claiming source (1.4) or unrelated version evidence.
  if (String(derivative?.evidence?.dngVersion) !== "1,2,0,0" || String(derivative?.evidence?.backwardVersion) !== "1,2,0,0") fail("derivative dngVersion/backwardVersion");
  // Exact derivative dimensions/storage/bytes/SHA — pinned to this build's
  // own confirmed-reproducible output (see the `PINNED_DERIVATIVE` comment).
  exactKeys(derivative?.evidence?.storage, ["kind", "chunkCount", "totalBytes", "firstOffset", "lastEnd"], "derivative.evidence.storage", fail);
  if (
    derivative?.evidence?.width !== PINNED_DERIVATIVE.width ||
    derivative?.evidence?.height !== PINNED_DERIVATIVE.height ||
    derivative?.bytes !== PINNED_DERIVATIVE.bytes ||
    derivative?.sha256 !== PINNED_DERIVATIVE.sha256 ||
    !sameJson(derivative?.evidence?.storage, PINNED_DERIVATIVE.storage)
  ) fail("derivative exact dimensions/storage/bytes/sha256");
  // Exact pinned D50 ColorMatrix1 rationals.
  if (!sameJson(derivative?.metadata?.colorMatrix, PINNED_COLOR_MATRIX)) fail("derivative colorMatrix");
  // Output metadata: exact fields, and cross-consistent with the
  // independently reclassified `evidence` and the raw file digest above —
  // never merely present.
  exactKeys(
    derivative?.metadata,
    [
      "width", "height", "bitsPerSample", "samplesPerPixel", "orientation", "photometric",
      "outputDigest", "bytes", "stripCount", "rowsPerStrip", "colorMatrix", "provenance",
      "expectedPixelDigest",
    ],
    "derivative.metadata",
    fail,
  );
  if (
    derivative?.metadata?.width !== PINNED_DERIVATIVE.width ||
    derivative?.metadata?.height !== PINNED_DERIVATIVE.height ||
    derivative?.metadata?.bitsPerSample !== 16 ||
    derivative?.metadata?.samplesPerPixel !== 3 ||
    derivative?.metadata?.orientation !== 1 ||
    derivative?.metadata?.photometric !== 34892 ||
    derivative?.metadata?.bytes !== derivative?.bytes ||
    derivative?.metadata?.outputDigest !== derivative?.sha256 ||
    derivative?.metadata?.stripCount !== PINNED_DERIVATIVE.stripCount ||
    derivative?.metadata?.rowsPerStrip !== PINNED_DERIVATIVE.rowsPerStrip ||
    derivative?.metadata?.expectedPixelDigest !== PINNED_PIXEL_DIGEST
  ) fail("derivative output metadata exact/cross-consistency");
  // Canonical provenance schema — every key the architecture pins, and no
  // fewer: an absent or renamed key must fail the same as a wrong value.
  // `coreRevision` must equal `environment.coreRevision` exactly (never
  // merely non-empty/distinct-from-packageVersion) and `recipeSha256` is
  // pinned exactly (deterministic for the pinned canonical recipe fixture).
  const provenance = derivative?.metadata?.provenance;
  exactKeys(
    provenance,
    ["schema", "sourceSha256", "recipeSha256", "coreRevision", "workingSpace", "colorimetricReference"],
    "derivative.metadata.provenance",
    fail,
  );
  if (
    provenance?.schema !== "monet-linear-dng-v1" ||
    provenance?.sourceSha256 !== value.fixture?.sha256 ||
    provenance?.recipeSha256 !== PINNED_DERIVATIVE.recipeSha256 ||
    provenance?.coreRevision !== PINNED_CORE_REVISION ||
    provenance?.coreRevision !== value.environment?.coreRevision ||
    provenance?.workingSpace !== "linear-srgb" ||
    provenance?.colorimetricReference !== "output-referred"
  ) fail("derivative provenance");
  // Exact pixel digest/count/error metrics — "matches" is not enough for a
  // fully deterministic fixture/recipe pair.
  exactKeys(
    derivative?.pixels,
    ["sampleCount", "expectedPixelDigest", "decodedPixelDigest", "maximumLsbDifference", "countOverOneLsb"],
    "derivative.pixels",
    fail,
  );
  if (
    derivative?.pixels?.expectedPixelDigest !== PINNED_PIXEL_DIGEST ||
    derivative?.pixels?.decodedPixelDigest !== PINNED_PIXEL_DIGEST ||
    derivative?.pixels?.sampleCount !== PINNED_PIXEL_SAMPLE_COUNT ||
    derivative?.pixels?.maximumLsbDifference !== 0 ||
    derivative?.pixels?.countOverOneLsb !== 0
  ) fail("pixels");

  exactKeys(value.immutability, ["sourceBefore", "sourceAfter", "managedBefore", "managedAfter"], "immutability", fail);
  if (value.immutability?.sourceBefore !== value.immutability?.sourceAfter || value.immutability?.managedBefore !== value.immutability?.managedAfter || value.immutability?.sourceBefore !== value.immutability?.managedBefore) fail("immutability");

  exactKeys(value.counts, ["passed", "failed", "skipped", "todo"], "counts", fail);
  if (value.counts?.failed !== 0 || value.counts?.skipped !== 0 || value.counts?.todo !== 0 || !(value.counts?.passed > 0)) fail("counts");

  exactKeys(
    value.environment,
    ["os", "arch", "osBuild", "packageVersion", "coreRevision", "decoderRevision"],
    "environment",
    fail,
  );
  if (!(value.elapsedMilliseconds >= 0) || !(value.peakRssBytes > 0) || !value.environment?.os || !value.environment?.arch || !value.environment?.packageVersion) fail("environment");
  // `coreRevision`/`decoderRevision` must equal the exact pinned semantic
  // revisions — not merely "non-empty and distinct from packageVersion."
  if (value.environment?.coreRevision !== PINNED_CORE_REVISION) fail("environment coreRevision");
  if (value.environment?.decoderRevision !== PINNED_DECODER_REVISION) fail("environment decoderRevision");
  // Exact pinned parser/writer bound constants.
  if (!sameJson(value.limits, PINNED_LIMITS)) fail("limits");

  // Named positive-case set: the exact set the producer must report, never
  // a bare opaque count. Duplicate/unknown-status/missing/extra names all
  // fail.
  if (!Array.isArray(value.positiveCases) || value.positiveCases.length === 0) fail("positiveCases");
  const positiveNames = new Set();
  for (const c of value.positiveCases) {
    if (typeof c?.name !== "string" || !c.name) fail("positiveCases entry name");
    if (positiveNames.has(c.name)) fail("positiveCases duplicate name");
    positiveNames.add(c.name);
    if (c?.status !== "ok") fail("positiveCases entry status");
  }
  if (
    positiveNames.size !== REQUIRED_POSITIVE_CASES.length ||
    !REQUIRED_POSITIVE_CASES.every((n) => positiveNames.has(n))
  ) fail("positiveCases exact required set");

  // The positive end-to-end proof alone does not establish the required
  // negative/acceptance-matrix coverage (parser bounds, publication
  // ownership/collision, managed-transaction descriptor safety, writer
  // arithmetic/cancellation, job/command lifecycle) — reject a proof that
  // didn't also report a complete, per-case, non-overlapping matrix built
  // from every one of the pinned criterion-5 categories.
  const matrix = value.negativeCaseMatrix;
  exactKeys(
    matrix,
    ["pinnedCategories", "categories", "results", "passed", "failed", "ignored"],
    "negativeCaseMatrix",
    fail,
  );
  if (
    !Array.isArray(matrix?.pinnedCategories) ||
    matrix.pinnedCategories.length !== PINNED_CATEGORIES.length ||
    !PINNED_CATEGORIES.every((c) => matrix.pinnedCategories.includes(c))
  ) fail("negativeCaseMatrix pinnedCategories");
  if (!Array.isArray(matrix?.results) || matrix.results.length === 0) fail("negativeCaseMatrix results");

  const seenNames = new Set();
  // Independently recomputed (never trusted from the producer's own
  // self-report): per-category tallies, `existingObjectModified` per name,
  // and the required-case presence/status check.
  const recomputedCategories = Object.fromEntries(
    PINNED_CATEGORIES.map((c) => [c, { passed: 0, failed: 0, ignored: 0 }]),
  );
  recomputedCategories.other = { passed: 0, failed: 0, ignored: 0 };
  let recomputedPassed = 0;
  let recomputedFailed = 0;
  let recomputedIgnored = 0;
  for (const r of matrix.results) {
    if (typeof r?.name !== "string" || !r.name) fail("negativeCaseMatrix result name");
    if (seenNames.has(r.name)) fail("negativeCaseMatrix duplicate test name");
    seenNames.add(r.name);
    if (!["ok", "ignored", "failed"].includes(r?.status)) fail("negativeCaseMatrix result status");
    const expectedCategory = categoryFor(r.name);
    if (r?.category !== expectedCategory) fail(`negativeCaseMatrix result category for ${r.name}`);
    const expectedModified = deriveExistingObjectModified(r.name, r.status);
    if (r?.existingObjectModified !== expectedModified) {
      fail(`negativeCaseMatrix existingObjectModified for ${r.name}`);
    }
    const bucket = recomputedCategories[expectedCategory];
    if (r.status === "ok") { bucket.passed += 1; recomputedPassed += 1; }
    else if (r.status === "ignored") { bucket.ignored += 1; recomputedIgnored += 1; }
    else { bucket.failed += 1; recomputedFailed += 1; }
  }
  // Every explicit collision/reuse/replacement-preservation required case
  // must have actually reported `existingObjectModified === false` — never
  // `null` (i.e. it must be recognized as a preservation claim at all) and
  // never `true` (which would mean it failed).
  for (const name of REQUIRED_DNG_CASES) {
    if (!PRESERVATION_NAME.test(name)) continue;
    const result = matrix.results.find((r) => r.name === name);
    if (!result || result.existingObjectModified !== false) {
      fail(`required preservation case ${name} must report existingObjectModified === false`);
    }
  }
  // Reject removal or renaming of any required case: every one of them
  // must be present, with status "ok".
  for (const name of REQUIRED_DNG_CASES) {
    const result = matrix.results.find((r) => r.name === name);
    if (!result) fail(`negativeCaseMatrix missing required case: ${name}`);
    if (result.status !== "ok") fail(`required case ${name} did not pass`);
  }
  // Recomputed category/total tallies must exactly equal what was
  // reported — never merely "categories look plausible."
  if (!sameJson(matrix.categories, recomputedCategories)) fail("negativeCaseMatrix categories do not match recomputed tallies");
  if (matrix.passed !== recomputedPassed || matrix.failed !== recomputedFailed || matrix.ignored !== recomputedIgnored) {
    fail("negativeCaseMatrix totals do not match recomputed tallies");
  }
  for (const category of PINNED_CATEGORIES) {
    const bucket = matrix.categories?.[category];
    if (!bucket || !(bucket.passed > 0) || bucket.failed !== 0 || bucket.ignored !== 0) {
      fail(`negativeCaseMatrix category ${category}`);
    }
  }
  if (matrix?.failed !== 0 || matrix?.ignored !== 0 || !(matrix?.passed > 0)) fail("negativeCaseMatrix totals");

  // The top-level `counts.passed` must itself be recomputed from the named
  // positive cases plus the matrix's own passed total — never a
  // hardcoded/independently-tracked number that could drift from the two
  // sources that actually justify it.
  if (value.counts.passed !== value.positiveCases.length + matrix.passed) {
    fail("counts.passed is not recomputed from positiveCases.length + negativeCaseMatrix.passed");
  }

  return value;
}
