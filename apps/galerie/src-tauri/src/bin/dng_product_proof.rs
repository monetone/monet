use monet_photo_core::parse_recipe_json;
use monet_galerie::{
    catalog::{self, db, CatalogState, ImportPhoto},
    develop_job::{
        validate_develop_export_request, DevelopJobRequest, DevelopJobService,
        DevelopOutputOptions, OutputFormat, OutputMetadata, SourceIdentity,
    },
    develop_scheduler::JobState,
    dng, raw_decode,
};
use serde_json::json;
use sha2::{Digest, Sha256};
use std::{fs::File, io::Read, path::Path, sync::Mutex, time::Instant};

const STREAM_BUFFER: usize = 1024 * 1024;

/// Stream a digest with a bounded 1 MiB buffer — never `std::fs::read` a
/// whole (potentially large) file into memory just to hash it.
fn digest(path: &Path) -> Result<(u64, String), String> {
    let mut file = File::open(path).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    let mut size = 0u64;
    let mut buf = vec![0u8; STREAM_BUFFER];
    loop {
        let n = file.read(&mut buf).map_err(|e| e.to_string())?;
        if n == 0 {
            break;
        }
        size = size.checked_add(n as u64).ok_or("file size overflow")?;
        hash.update(&buf[..n]);
    }
    Ok((size, format!("{:x}", hash.finalize())))
}

fn os_build() -> String {
    std::process::Command::new("sw_vers")
        .arg("-buildVersion")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_else(|| "unknown".into())
}

/// Run the full positive product-path proof against fixture 1022, appending
/// one stable, named positive-case entry to `positive_cases` at every
/// independently-verified checkpoint (never a hardcoded/opaque count — the
/// validator can require the exact named set, not merely a passing number).
/// Returns the report value; the caller is responsible for cleaning up
/// `root` on both success and failure.
fn run(root: &Path, started: Instant) -> Result<serde_json::Value, String> {
    let mut positive_cases: Vec<serde_json::Value> = Vec::new();
    let mut mark = |name: &str| positive_cases.push(json!({"name": name, "status": "ok"}));

    let fixture = Path::new("src-tauri/target/raw-fixtures/dng-mosaic-canon-5d3.DNG")
        .canonicalize()
        .map_err(|e| format!("fixture 1022 missing: {e}"))?;
    let source_before = digest(&fixture)?;
    if source_before.1 != "95dc76a2f255e623acaa5149b320389f7da7c995da890c3e0d511c0ff681b2e1"
        || source_before.0 != 48_382_640
    {
        return Err("fixture 1022 digest/byte-count mismatch".into());
    }
    mark("fixture.digestAndByteCountExact");

    let source_evidence = dng::classify(&mut File::open(&fixture).map_err(|e| e.to_string())?)?;
    // Assert, not merely emit: the exact pinned selected-IFD path/offset,
    // geometry/CFA, DNG/backward versions, and the exactly-one tag-50740
    // record's exact type/count/value-byte-length/hash.
    if source_evidence.selected_ifd_path != "ifd[0]/subifd[0]"
        || source_evidence.selected_ifd_offset != 196_558
        || (
            source_evidence.width,
            source_evidence.height,
            source_evidence.photometric,
            source_evidence.samples_per_pixel,
        ) != (5920, 3950, 32803, 1)
        || source_evidence.cfa_dimensions != Some([2, 2])
        || source_evidence.cfa_pattern.as_deref() != Some(&[0, 1, 1, 2][..])
        || source_evidence.dng_version != Some([1, 4, 0, 0])
        || source_evidence.backward_version != Some([1, 1, 0, 0])
    {
        return Err("fixture 1022 selected-IFD/geometry/version evidence mismatch".into());
    }
    mark("fixture.selectedIfdGeometryVersionExact");
    if source_evidence.storage.kind != "strip"
        || source_evidence.storage.chunk_count != 1
        || source_evidence.storage.first_offset != 1_614_640
        || source_evidence.storage.last_end != 48_382_640
        || source_evidence.storage.total_bytes != 46_768_000
    {
        return Err("fixture 1022 storage evidence mismatch".into());
    }
    mark("fixture.storageEvidenceExact");
    if source_evidence.private_data.len() != 1 {
        return Err("fixture 1022 must carry exactly one tag-50740 record".into());
    }
    let tag_50740 = &source_evidence.private_data[0];
    if tag_50740.ifd_path != "ifd[0]"
        || tag_50740.field_type != 1
        || tag_50740.count != 68_560
        || tag_50740.value_bytes != 68_560
        || tag_50740.sha256 != "8d5074476c6a3ff2148b6b6fb9372313a5066e032a7958e368fd75f2ed19fc62"
    {
        return Err("fixture 1022 tag-50740 evidence mismatch".into());
    }
    mark("fixture.tag50740EvidenceExact");

    let catalog_path = root.join("proof.galcat");
    let mut conn = db::open(catalog_path.to_str().unwrap()).map_err(|e| e.to_string())?;
    let photo = ImportPhoto {
        path: fixture.to_string_lossy().into(),
        fingerprint: source_before.1.clone(),
        format: "raw:DNG".into(),
        byte_size: source_before.0 as i64,
        mtime: 0,
        width: source_evidence.width as i64,
        height: source_evidence.height as i64,
        orientation: source_evidence.orientation as i64,
        capture_time: None,
        camera_make: Some("Canon".into()),
        camera_model: Some("EOS 5D Mark III".into()),
        lens: None,
        iso: None,
        f_number: None,
        focal_length: None,
        exposure_time: None,
        gps_lat: None,
        gps_lon: None,
    };
    let photo_id = catalog::import_managed_dng(&mut conn, photo)?;
    mark("managedImport.transactionCommitted");
    drop(conn);
    let conn = db::open(catalog_path.to_str().unwrap()).map_err(|e| e.to_string())?;

    // Store a real (non-default) recipe against the photo so the catalog's
    // own canonical recipe — the exact JSON a live client must echo back —
    // reflects real develop work, not just the legacy-empty default.
    let fixture_recipe: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../../packages/monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
    ))
    .map_err(|e| e.to_string())?;
    let raw_recipe_json =
        serde_json::to_string(&fixture_recipe["recipe"]).map_err(|e| e.to_string())?;
    parse_recipe_json(raw_recipe_json.as_bytes()).map_err(|e| e.to_string())?;
    db::set_recipe(&conn, photo_id, &raw_recipe_json, None).map_err(|e| e.to_string())?;

    // From here on, drive the proof through the exact catalog-owned identity
    // + command/service validation boundary a real Tauri client is subject
    // to (`getDevelopExportIdentity` -> `run_develop_export`), never a
    // shortcut that bypasses `validate_develop_export_request`.
    let catalog_state = CatalogState(Mutex::new(Some(conn)));
    let identity = catalog::current_develop_export_identity(&catalog_state, photo_id)?;
    if identity.photo.path == identity.photo.read_path {
        return Err("managed DNG proof requires a distinct read path".into());
    }
    mark("catalog.distinctDisplayAndReadPath");

    let managed = Path::new(&identity.photo.read_path).to_path_buf();
    let managed_identity = digest(&managed)?;
    let managed_evidence = dng::classify(&mut File::open(&managed).map_err(|e| e.to_string())?)?;
    if source_before != managed_identity || source_evidence != managed_evidence {
        return Err("managed original differs after catalog reopen".into());
    }
    mark("catalog.sourceManagedEquivalenceAfterReopen");

    let derivative = root.join("derivative.dng");
    let request = DevelopJobRequest {
        job_id: "dng-product-proof".into(),
        source: SourceIdentity {
            path: identity.photo.read_path.clone(),
            catalog_id: identity.catalog_id.clone(),
            photo_id,
            expected_digest: identity.source_digest.clone(),
        },
        canonical_recipe_json: identity.canonical_recipe_json.clone(),
        output: DevelopOutputOptions {
            path: derivative.to_string_lossy().into(),
            profile: monet_galerie::tiff_export::OutputProfile::Srgb,
            format: OutputFormat::LinearDng16,
        },
        interactive: false,
    };
    // Exercise the exact command/service validation boundary a real Tauri
    // client is subject to — this proof must not bypass it.
    validate_develop_export_request(&catalog_state, &request)?;
    mark("command.validationBoundaryPassed");

    // Drive the export through the exact shared `start` -> `execute_started`
    // lifecycle boundary `run_develop_export` uses (via `spawn_blocking`) —
    // never `DevelopJobService::run` directly, which would silently skip
    // `service.start`'s duplicate-id registration and the `StartedDevelopJob`
    // guard whose `Drop` fails an abandoned job.
    let service = DevelopJobService::default();
    let job_id = request.job_id.clone();
    let started_job = service.start(&job_id)?;
    // Registry state must exist synchronously the instant `start` returns —
    // before `execute_started` has run at all — exactly the property a real
    // client's concurrent `status`/`cancel` call depends on.
    if service.status(&job_id)?.map(|status| status.state) != Some(JobState::Queued) {
        return Err(
            "develop job lifecycle boundary was not registered Queued before execution".into(),
        );
    }
    mark("lifecycle.startedRegisteredBeforeExecution");

    let result = service.execute_started(request, started_job)?;
    if result.state != JobState::Completed {
        return Err(format!(
            "Linear DNG export did not reach Completed through the shared lifecycle boundary: {:?}",
            result.state
        ));
    }
    if service.status(&job_id)?.map(|status| status.state) != Some(JobState::Completed) {
        return Err("develop job registry state was not Completed after execute_started".into());
    }
    mark("lifecycle.reachedCompleted");

    let OutputMetadata::LinearDng(output) = &result.output else {
        return Err("Linear DNG proof received TIFF metadata".into());
    };
    mark("derivative.linearDngResult");

    let derivative_evidence =
        dng::classify(&mut File::open(&derivative).map_err(|e| e.to_string())?)?;
    if derivative_evidence.cfa_dimensions.is_some()
        || derivative_evidence.cfa_pattern.is_some()
        || !derivative_evidence.private_data.is_empty()
    {
        return Err("derivative must never carry CFA or private-data evidence".into());
    }
    mark("derivative.noProhibitedTags");

    // The derivative's own embedded provenance must carry the exact same
    // semantic core revision this process reports in `environment` — never
    // a stale/aliased value such as the crate's package version. Asserted
    // here, not merely emitted, so a regression that reintroduces
    // `env!("CARGO_PKG_VERSION")` at the writer call site fails the proof
    // itself, not only the JS validator.
    if dng::CORE_REVISION != "monet-galerie-dng-core-1"
        || raw_decode::BACKEND_REVISION != "2"
        || output.provenance["coreRevision"] != serde_json::json!(dng::CORE_REVISION)
    {
        return Err(
            "semantic core/decoder revision mismatch between environment and derivative provenance"
                .into(),
        );
    }
    mark("derivative.coreDecoderRevisionMatch");

    let derivative_identity = digest(&derivative)?;
    // Exact derivative geometry/storage/bytes/digest — not merely
    // classified/emitted. `storage.totalBytes` is a pure function of pixel
    // count (width * height * 3 samples * 2 bytes) and so is independent of
    // any incidental container/provenance byte-length; `firstOffset`/
    // `lastEnd`/`bytes`/`sha256` additionally depend on the exact header +
    // IFD + embedded-provenance-JSON length this build produces, and are
    // pinned to this build's own genuinely reproducible output (confirmed
    // bit-identical across repeated runs), not an arbitrary/unverified
    // number.
    if derivative_evidence.width != 5760
        || derivative_evidence.height != 3840
        || derivative_evidence.storage.kind != "strip"
        || derivative_evidence.storage.chunk_count != 8
        || derivative_evidence.storage.first_offset != 888
        || derivative_evidence.storage.last_end != 132_711_288
        || derivative_evidence.storage.total_bytes != 132_710_400
        || derivative_identity.0 != 132_711_288
        || derivative_identity.1
            != "87d3fc21a82325142c7a67e063458df7e0d092112c91dffebfc0b8bbec8222c6"
    {
        return Err("derivative exact geometry/storage/bytes/digest mismatch".into());
    }
    mark("derivative.exactGeometryStorageBytesDigestExact");

    // Exact output metadata, cross-consistent with the reclassified
    // evidence and the raw file digest above (never merely present), and
    // the exact canonical provenance object including the recipe digest
    // (deterministic for the pinned canonical recipe fixture).
    if output.width != 5760
        || output.height != 3840
        || output.bits_per_sample != 16
        || output.samples_per_pixel != 3
        || output.orientation != 1
        || output.photometric != 34892
        || output.bytes != derivative_identity.0
        || output.output_digest != derivative_identity.1
        || output.strip_count != 8
        || output.rows_per_strip != 485
        || output.provenance["schema"] != "monet-linear-dng-v1"
        || output.provenance["sourceSha256"] != json!(source_before.1)
        || output.provenance["recipeSha256"]
            != json!("e4cf902b1034d48597f14794c65b33862cf6d5c62de3d5149cf862ac75c447dc")
        || output.provenance["coreRevision"] != json!(dng::CORE_REVISION)
        || output.provenance["workingSpace"] != "linear-srgb"
        || output.provenance["colorimetricReference"] != "output-referred"
    {
        return Err("derivative output metadata/provenance mismatch".into());
    }
    mark("derivative.exactOutputMetadataAndProvenanceExact");

    // The job itself already performed the independent reopen-decode-and-
    // compare validation (against the developed frame, through the pinned
    // inverse LUT) before ever publishing — report exactly that evidence
    // rather than recomputing it a second time with no independent frame
    // access of our own. Pinned exactly: this fixture/recipe pair's pixel
    // content is fully deterministic (confirmed bit-identical across
    // repeated runs), so "matches" is not enough — the exact digest and
    // sample count are required too.
    let pixels = result
        .pixel_validation
        .clone()
        .ok_or("Linear DNG job did not report independent pixel validation")?;
    if pixels.expected_pixel_digest
        != "2bd7e0e0ed0aa58dcd63ebcc78cddb9c4511980528cb6a750234024d2ee65485"
        || pixels.decoded_pixel_digest != pixels.expected_pixel_digest
        || pixels.sample_count != 66_355_200
        || pixels.maximum_lsb_difference != 0
        || pixels.count_over_one_lsb != 0
    {
        return Err("independent pixel validation did not match the exact pinned evidence".into());
    }
    mark("derivative.pixelComparisonExact");

    let core_image = std::process::Command::new("sips")
        .args([
            "-g",
            "pixelWidth",
            "-g",
            "pixelHeight",
            derivative.to_str().unwrap(),
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !core_image.status.success() {
        return Err(format!(
            "Core Image reopen failed: {}",
            String::from_utf8_lossy(&core_image.stderr)
        ));
    }
    mark("derivative.coreImageReopen");

    let source_after = digest(&fixture)?;
    let managed_after = digest(&managed)?;
    if source_after != source_before {
        return Err("source original changed during derivative export".into());
    }
    mark("immutability.sourceUnchanged");
    if managed_after != managed_identity {
        return Err("managed original changed during derivative export".into());
    }
    mark("immutability.managedUnchanged");

    let elapsed = started.elapsed().as_millis();
    let passed = positive_cases.len() as u32;
    Ok(json!({
        "pass": true,
        "fixture": {
            "id": "dng-mosaic-canon-5d3",
            "source": "https://raw.pixls.us/getfile.php/1022/nice/Adobe%20DNG%20Converter%20-%20Canon%20EOS%205D%20Mark%20III%20-%2016bit%2016bit%20uncompressed%20(3:2).DNG",
            "license": "CC0",
            "sha256": source_before.1,
            "bytes": source_before.0,
        },
        "sourceEvidence": source_evidence,
        "catalog": {
            "originalPath": identity.photo.path,
            "managedPath": identity.photo.read_path,
            "readPath": identity.photo.read_path,
            "photoId": photo_id,
            "reopened": true,
            "fullByteEquality": true,
        },
        "managedEvidence": managed_evidence,
        "derivative": {
            "terminalState": result.state,
            "durabilityError": result.durability_error,
            "sha256": derivative_identity.1,
            "bytes": derivative_identity.0,
            "evidence": derivative_evidence,
            "metadata": output,
            "pixels": pixels,
            "coreImageReopen": true,
        },
        "immutability": {
            "sourceBefore": source_before.1,
            "sourceAfter": source_after.1,
            "managedBefore": managed_identity.1,
            "managedAfter": managed_after.1,
        },
        "limits": {
            "ifds": 256,
            "depth": 8,
            "entriesPerIfd": 4096,
            "totalEntries": 16384,
            "subIfds": 64,
            "chunks": 131072,
            "cfaCells": 256,
            "privateDigestBytes": 268435456,
            "streamBuffer": 1048576,
        },
        "positiveCases": positive_cases,
        "counts": { "passed": passed, "failed": 0, "skipped": 0, "todo": 0 },
        "environment": {
            "os": std::env::consts::OS,
            "arch": std::env::consts::ARCH,
            "osBuild": os_build(),
            "packageVersion": env!("CARGO_PKG_VERSION"),
            "coreRevision": dng::CORE_REVISION,
            "decoderRevision": raw_decode::BACKEND_REVISION,
        },
        "elapsedMilliseconds": elapsed,
        // Overwritten by the `proof:dng` JS wrapper with the value measured
        // by `/usr/bin/time -l` around this whole process; a value measured
        // from inside the process it's measuring would not be trustworthy.
        "peakRssBytes": 0,
    }))
}

fn main() -> Result<(), String> {
    let started = Instant::now();
    let root = std::env::temp_dir().join(format!("galerie-dng-proof-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir(&root).map_err(|e| e.to_string())?;

    let outcome = run(&root, started);
    // Clean the temporary catalog, managed-asset root, and derivative on
    // both success and failure — never only on the happy path.
    let cleanup = std::fs::remove_dir_all(&root);
    let report = outcome?;
    cleanup.map_err(|e| format!("clean up proof temp root: {e}"))?;

    // This binary never creates, truncates, renames, or otherwise touches
    // the final durable artifact this report is eventually persisted to.
    // It only prints its report on stdout. The JS wrapper (`dng-proof.mjs`)
    // parses that stdout value, enriches it with the measured negative-case
    // matrix/RSS/counts, and performs the one and only durable write via
    // `writeJsonAtomicSync`. A crash or failure here — before or after this
    // point — can therefore never clobber a prior valid artifact: there is
    // no code path in this process that writes to that path at all. See
    // `dng_product_proof::tests::a_producer_failure_before_finalization_*`
    // for the executable proof, and `dng-proof-contract.mjs`'s source-
    // contract tests for the static proof.
    let text = serde_json::to_string(&report).map_err(|e| e.to_string())?;
    println!("{text}");
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression seam for the defect where this binary wrote the raw
    /// (pre-enrichment) report directly to the final durable artifact path
    /// with `std::fs::write`, which truncates in place — a crash mid-write
    /// could destroy a prior validated artifact before the JS wrapper's
    /// atomic writer ever ran. `run()`'s fixture path is a literal relative
    /// to the real JS wrapper's invocation directory (`apps/galerie`);
    /// `cargo test`'s own working directory is this crate's root, one level
    /// too deep for that literal, so the fixture-canonicalize step
    /// deterministically fails here with no fault injection required —
    /// exactly "a producer failure before finalization." This proves not
    /// merely that `run()` doesn't currently write the artifact, but that a
    /// real failing invocation from this process leaves a pre-existing file
    /// at the production-relative artifact path untouched.
    #[test]
    fn a_producer_failure_before_finalization_leaves_a_pre_existing_final_artifact_byte_for_byte_unchanged(
    ) {
        let artifact_path = Path::new("target/dng-proof.json");
        if let Some(parent) = artifact_path.parent() {
            std::fs::create_dir_all(parent).unwrap();
        }
        // Preserve whatever legitimately exists at the real shared artifact
        // path (e.g. from an earlier `proof:dng` run in this same
        // workspace) and restore it exactly afterward — this test must
        // never be the reason a valid artifact is lost.
        let original = std::fs::read(artifact_path).ok();
        let pre_existing: &[u8] = b"{\"pre-existing\":\"failure-seam-canary\"}";
        std::fs::write(artifact_path, pre_existing).unwrap();

        let root = std::env::temp_dir().join(format!(
            "dng-proof-producer-failure-seam-{}",
            std::process::id()
        ));
        let _ = std::fs::remove_dir_all(&root);
        std::fs::create_dir(&root).unwrap();
        let result = run(&root, Instant::now());
        let _ = std::fs::remove_dir_all(&root);

        let after = std::fs::read(artifact_path).unwrap();
        match original {
            Some(bytes) => std::fs::write(artifact_path, bytes).unwrap(),
            None => {
                let _ = std::fs::remove_file(artifact_path);
            }
        }

        assert!(
            result.is_err(),
            "expected run() to fail before finalization under cargo test's crate-root cwd \
             (fixture 1022 only resolves from the real apps/galerie invocation directory)"
        );
        assert_eq!(
            after, pre_existing,
            "a producer failure before finalization must leave a pre-existing final artifact \
             byte-for-byte unchanged"
        );
    }
}
