use std::collections::BTreeMap;
use std::env;
use std::fs;
use std::path::Path;
use std::process::{Command, ExitCode};

use monet_galerie::raw_decode::{
    decode_to_frame, RawDecodeIntent, RawFrameMetadata, BACKEND, BACKEND_REVISION, WORKING_PROFILE,
};
use rawloader::{RawImage, RawImageData};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

const ANALYZER: &str = "rawloader";
const ANALYZER_VERSION: &str = "0.37.1";
const PRODUCT_MAX_EDGE: u32 = 1024;
const NEUTRAL_PATCHES: [usize; 4] = [20, 21, 22, 23];
const D50: [f64; 3] = [0.96422, 1.0, 0.82521];
// The neutral-WB intent is calibrated closed-loop through the product pipeline
// itself: the rawloader-matrix-derived chromaticity is only a seed, because the
// same xy means a different white balance in Apple's camera calibration than in
// rawloader's (measured 2026-07-17: the seed leaves rendered neutrals 16-32%
// high in blue while the mosaic's own neutral chromaticity is uniform). The
// solve owns exactly the two chromaticity degrees of freedom the intent already
// exposes, targets only the six pinned neutral references (never the 18
// chromatic patches), and contains no additive term, so scene flare cannot be
// absorbed by the fit.
const CALIBRATION_STEP_SCHEDULE: [f64; 5] = [0.016, 0.008, 0.004, 0.002, 0.001];
const CALIBRATION_MAX_EVALUATIONS: usize = 80;
#[cfg(test)]
const CIEDE2000_TEST_DATA: &str =
    "https://hajim.rochester.edu/ece/sites/gsharma/ciede2000/dataNprograms/ciede2000testdata.txt";

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Config {
    source: SourceConfig,
    accepted_environment: AcceptedEnvironment,
    mosaic_geometry: Geometry,
    product_geometry: ProductGeometry,
    reference: Reference,
    thresholds: Thresholds,
    canonical_digests: CanonicalDigests,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct SourceConfig {
    id: String,
    fixture_path_lookup_key: String,
    sha256: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AcceptedEnvironment {
    os_build: String,
    sdk: String,
    backend: String,
    backend_revision: String,
    decoder_version: String,
    rawloader_version: String,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Geometry {
    dimensions: [usize; 2],
    coordinate_space: String,
    order: String,
    columns: [f64; 6],
    rows: [f64; 4],
    roi_half_size: [f64; 2],
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ProductGeometry {
    native_dimensions: [u32; 2],
    coordinate_space: String,
    order: String,
    columns: [f64; 6],
    rows: [f64; 4],
    roi_half_size: [f64; 2],
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Reference {
    name: String,
    source_record: String,
    archive_filename: String,
    archive_md5: String,
    illuminant: String,
    observer: String,
    measurement_condition: String,
    edition: String,
    order: String,
    patches: Vec<ReferencePatch>,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ReferencePatch {
    id: String,
    lab_d50: [f64; 3],
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Thresholds {
    chromatic_mean: f64,
    p95_all_nearest_rank: f64,
    neutral_max: f64,
    patch_count: usize,
}

#[derive(Clone, Deserialize, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CanonicalDigests {
    reference_tuples_sha256: String,
    config_sha256: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
struct Roi {
    x0: usize,
    y0: usize,
    x1: usize,
    y1: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct MosaicPatch {
    id: String,
    roi: Roi,
    plane_medians: [f64; 3],
    upper_saturation_count: usize,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProductPatch {
    id: String,
    roi: Roi,
    rgb_linear_unscaled: [f64; 3],
    rgb_linear: [f64; 3],
    measured_lab_d50: [f64; 3],
    reference_lab_d50: [f64; 3],
    delta_e00: f64,
    clip_counts: BTreeMap<String, usize>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct CalibrationEvaluation {
    chromaticity: [f64; 2],
    neutral_max_delta_e00: f64,
}

/// Deterministic axis-aligned descent over the two neutral-chromaticity
/// degrees of freedom. Evaluates the seed, then for each step size in the
/// fixed schedule repeatedly probes the four axis neighbours of the current
/// best point (in the fixed order −x, +x, −y, +y) and moves while any probe
/// strictly improves the objective. Every distinct point is rendered at most
/// once (bit-exact cache) and the complete evaluation trace is returned for
/// the report and the derivation digest. Exceeding the evaluation budget is a
/// hard failure, never a silent truncation.
fn calibrate_chromaticity(
    seed: [f64; 2],
    objective: &mut dyn FnMut([f64; 2]) -> Result<f64, ProofError>,
) -> Result<(Vec<CalibrationEvaluation>, [f64; 2], f64), ProofError> {
    let mut trace: Vec<CalibrationEvaluation> = Vec::new();
    let mut cache: BTreeMap<[u64; 2], f64> = BTreeMap::new();
    let mut evaluate = |xy: [f64; 2],
                        trace: &mut Vec<CalibrationEvaluation>,
                        cache: &mut BTreeMap<[u64; 2], f64>|
     -> Result<f64, ProofError> {
        let key = xy.map(f64::to_bits);
        if let Some(&value) = cache.get(&key) {
            return Ok(value);
        }
        if trace.len() >= CALIBRATION_MAX_EVALUATIONS {
            return Err(ProofError::fail(
                "neutral calibration exceeded its evaluation budget",
            ));
        }
        let value = objective(xy)?;
        if !value.is_finite() {
            return Err(ProofError::fail(
                "neutral calibration objective is non-finite",
            ));
        }
        cache.insert(key, value);
        trace.push(CalibrationEvaluation {
            chromaticity: xy,
            neutral_max_delta_e00: value,
        });
        Ok(value)
    };
    let mut best_xy = seed;
    let mut best = evaluate(seed, &mut trace, &mut cache)?;
    for step in CALIBRATION_STEP_SCHEDULE {
        loop {
            let mut improved = false;
            for candidate in [
                [best_xy[0] - step, best_xy[1]],
                [best_xy[0] + step, best_xy[1]],
                [best_xy[0], best_xy[1] - step],
                [best_xy[0], best_xy[1] + step],
            ] {
                if candidate.into_iter().any(|v| !(v > 0.0 && v < 1.0)) {
                    continue;
                }
                let value = evaluate(candidate, &mut trace, &mut cache)?;
                if value < best {
                    best = value;
                    best_xy = candidate;
                    improved = true;
                }
            }
            if !improved {
                break;
            }
        }
    }
    Ok((trace, best_xy, best))
}

#[derive(Debug)]
struct ProofError {
    status: &'static str,
    message: String,
}

impl ProofError {
    fn fail(message: impl Into<String>) -> Self {
        Self {
            status: "fail",
            message: message.into(),
        }
    }

    fn rebaseline(message: impl Into<String>) -> Self {
        Self {
            status: "rebaseline-required",
            message: message.into(),
        }
    }
}

fn main() -> ExitCode {
    let args: Vec<String> = env::args().collect();
    let result = match args.as_slice() {
        [_, config, fixture] => run(Path::new(config), Path::new(fixture)),
        _ => Err(ProofError::fail(
            "usage: colorchecker_proof CONFIG_JSON FIXTURE_ARW",
        )),
    };
    match result {
        Ok(value) => {
            println!("{}", serde_json::to_string_pretty(&value).unwrap());
            if value["status"] == "pass" {
                ExitCode::SUCCESS
            } else {
                ExitCode::FAILURE
            }
        }
        Err(error) => {
            println!(
                "{}",
                serde_json::to_string_pretty(&json!({
                    "status": error.status,
                    "failures": [error.message],
                }))
                .unwrap()
            );
            ExitCode::FAILURE
        }
    }
}

fn run(config_path: &Path, fixture_path: &Path) -> Result<Value, ProofError> {
    let config_bytes =
        fs::read(config_path).map_err(|e| ProofError::fail(format!("read config: {e}")))?;
    let config: Config = serde_json::from_slice(&config_bytes)
        .map_err(|e| ProofError::fail(format!("parse config: {e}")))?;
    validate_config(&config)?;
    let source_sha256 = file_sha256(fixture_path)?;
    if source_sha256 != config.source.sha256 {
        return Err(ProofError::fail(format!(
            "fixture SHA-256 {source_sha256}, expected {}",
            config.source.sha256
        )));
    }

    let raw = rawloader::decode_file(fixture_path)
        .map_err(|e| ProofError::fail(format!("rawloader decode: {e:?}")))?;
    validate_raw(&config, &raw)?;
    let (mosaic_patches, combined, sensor_failures) = analyze_mosaic(&config, &raw)?;
    let gains = [combined[1] / combined[0], 1.0, combined[1] / combined[2]];
    if gains.into_iter().any(|v| !v.is_finite() || v <= 0.0) {
        return Err(ProofError::fail("derived neutral gains are invalid"));
    }

    let camera_to_xyz = raw.cam_to_xyz();
    let xyz = multiply_camera_to_xyz(camera_to_xyz, combined);
    if xyz.into_iter().any(|v| !v.is_finite()) || xyz[1] <= 0.0 {
        return Err(ProofError::fail("derived neutral XYZ is invalid"));
    }
    let neutral_xyz = [xyz[0] / xyz[1], 1.0, xyz[2] / xyz[1]];
    let xyz_sum = neutral_xyz.iter().sum::<f64>();
    let neutral_xy = [neutral_xyz[0] / xyz_sum, neutral_xyz[1] / xyz_sum];
    if neutral_xy
        .into_iter()
        .any(|v| !v.is_finite() || v <= 0.0 || v >= 1.0)
    {
        return Err(ProofError::fail("derived neutral chromaticity is invalid"));
    }

    let seed_derivation_digest = canonical_sha256(&json!({
        "analyzer": ANALYZER,
        "analyzerVersion": ANALYZER_VERSION,
        "cameraToXyz": camera_to_xyz,
        "configSha256": config.canonical_digests.config_sha256,
        "gains": gains,
        "neutralChromaticity": neutral_xy,
        "sourceSha256": source_sha256,
        "xyzToCamera": raw.xyz_to_cam,
    }))?;

    let fixture_str = fixture_path
        .to_str()
        .ok_or_else(|| ProofError::fail("fixture path is not UTF-8"))?;
    let sdk = sdk_version()?;
    let config_ref = &config;
    let mut validated = false;
    let mut objective = |xy: [f64; 2]| -> Result<f64, ProofError> {
        let probe_digest = canonical_sha256(&json!({
            "probeChromaticity": xy,
            "seedDerivation": seed_derivation_digest,
        }))?;
        let intent = RawDecodeIntent {
            mode: "neutralChromaticity".into(),
            x: Some(xy[0]),
            y: Some(xy[1]),
            derivation_digest: Some(probe_digest),
        };
        let decoded = decode_to_frame(fixture_str, PRODUCT_MAX_EDGE, &intent)
            .map_err(|e| ProofError::fail(format!("calibration decode: {e}")))?;
        if !validated {
            let environment_failures = environment_mismatches(config_ref, &decoded.metadata, &sdk);
            if !environment_failures.is_empty() {
                return Err(ProofError::rebaseline(environment_failures.join("; ")));
            }
            validate_product_metadata(config_ref, &decoded.metadata)?;
            validated = true;
        }
        let rois = geometry_rois(
            &config_ref.product_geometry.columns,
            &config_ref.product_geometry.rows,
            config_ref.product_geometry.roi_half_size,
            decoded.frame.width as usize,
            decoded.frame.height as usize,
        )?;
        let unscaled =
            product_medians(&decoded.frame.pixels, decoded.frame.width as usize, &rois)?;
        let exposure = median(neutral_exposure_ratios(&unscaled, config_ref)?.to_vec())?;
        let mut worst = f64::NEG_INFINITY;
        for index in 18..24 {
            let rgb = unscaled[index].map(|v| v * exposure);
            let lab = xyz_to_lab(bradford_d65_to_d50(linear_srgb_to_xyz_d65(rgb)));
            worst = worst.max(ciede2000(lab, config_ref.reference.patches[index].lab_d50));
        }
        Ok(worst)
    };
    let (calibration_trace, solved_xy, solved_objective) =
        calibrate_chromaticity(neutral_xy, &mut objective)?;
    let seed_objective = calibration_trace[0].neutral_max_delta_e00;

    let derivation_digest = canonical_sha256(&json!({
        "calibration": {
            "evaluations": calibration_trace,
            "maxEvaluations": CALIBRATION_MAX_EVALUATIONS,
            "objective": "max-neutral-deltaE00-A4-F4-after-C4F4-exposure-refit",
            "protocol": "deterministic-axis-descent",
            "stepSchedule": CALIBRATION_STEP_SCHEDULE,
        },
        "seedDerivation": seed_derivation_digest,
        "solvedChromaticity": solved_xy,
    }))?;
    let intent = RawDecodeIntent {
        mode: "neutralChromaticity".into(),
        x: Some(solved_xy[0]),
        y: Some(solved_xy[1]),
        derivation_digest: Some(derivation_digest.clone()),
    };
    let decoded = decode_to_frame(fixture_str, PRODUCT_MAX_EDGE, &intent)
        .map_err(|e| ProofError::fail(format!("product decode: {e}")))?;

    let environment_failures = environment_mismatches(&config, &decoded.metadata, &sdk);
    if !environment_failures.is_empty() {
        return Err(ProofError::rebaseline(environment_failures.join("; ")));
    }
    validate_product_metadata(&config, &decoded.metadata)?;
    if decoded
        .frame
        .pixels
        .chunks_exact(4)
        .any(|pixel| pixel[3] != u16::MAX)
    {
        return Err(ProofError::fail("product frame contains non-opaque alpha"));
    }
    let product_rois = geometry_rois(
        &config.product_geometry.columns,
        &config.product_geometry.rows,
        config.product_geometry.roi_half_size,
        decoded.frame.width as usize,
        decoded.frame.height as usize,
    )?;
    let product_width = decoded.frame.width as usize;
    let unscaled = product_medians(&decoded.frame.pixels, product_width, &product_rois)?;

    let exposure_ratios = neutral_exposure_ratios(&unscaled, &config)?;
    let exposure = median(exposure_ratios.to_vec())?;

    let mut failures = sensor_failures;
    let mut permitted_clamps = Vec::new();
    let mut patches = Vec::with_capacity(24);
    let mut delta_es = Vec::with_capacity(24);
    let neutral_luminances: Vec<_> = unscaled[18..]
        .iter()
        .map(|rgb| bradford_d65_to_d50(linear_srgb_to_xyz_d65(*rgb))[1])
        .collect();
    if !neutral_luminances.windows(2).all(|pair| pair[0] > pair[1]) {
        failures
            .push("product neutral-row luminance is not strictly descending A4 through F4".into());
    }
    for (index, reference) in config.reference.patches.iter().enumerate() {
        let rgb = unscaled[index].map(|v| v * exposure);
        let lab = xyz_to_lab(bradford_d65_to_d50(linear_srgb_to_xyz_d65(rgb)));
        let delta_e = ciede2000(lab, reference.lab_d50);
        delta_es.push(delta_e);
        let roi = product_rois[index];
        let clip_counts = output_clip_counts(&decoded.frame.pixels, product_width, roi);
        let reference_rgb = lab_d50_to_linear_srgb(reference.lab_d50);
        for channel in 0..3 {
            let channel_name = ["red", "green", "blue"][channel];
            let median_clipped = unscaled[index][channel] == 0.0 || unscaled[index][channel] == 1.0;
            if median_clipped {
                if !(0.0..=1.0).contains(&reference_rgb[channel]) {
                    permitted_clamps.push(json!({
                        "channel": channel_name,
                        "patch": reference.id,
                        "referenceLinearSrgb": reference_rgb[channel],
                        "renderedMedian": unscaled[index][channel],
                    }));
                } else {
                    failures.push(format!(
                        "{} {} output median clipped at {}",
                        reference.id, channel_name, unscaled[index][channel]
                    ));
                }
            }
        }
        patches.push(ProductPatch {
            id: reference.id.clone(),
            roi,
            rgb_linear_unscaled: unscaled[index],
            rgb_linear: rgb,
            measured_lab_d50: lab,
            reference_lab_d50: reference.lab_d50,
            delta_e00: delta_e,
            clip_counts,
        });
    }

    let chromatic_mean = delta_es[..18].iter().sum::<f64>() / 18.0;
    let p95 = nearest_rank(&delta_es, 0.95)?;
    let neutral_max = delta_es[18..]
        .iter()
        .copied()
        .fold(f64::NEG_INFINITY, f64::max);
    let maximum = delta_es.iter().copied().fold(f64::NEG_INFINITY, f64::max);
    if patches.len() != config.thresholds.patch_count {
        failures.push(format!(
            "{} patches present, expected {}",
            patches.len(),
            config.thresholds.patch_count
        ));
    }
    if chromatic_mean > config.thresholds.chromatic_mean {
        failures.push(format!(
            "chromatic mean ΔE00 {chromatic_mean:.9} exceeds {:.9}",
            config.thresholds.chromatic_mean
        ));
    }
    if p95 > config.thresholds.p95_all_nearest_rank {
        failures.push(format!(
            "nearest-rank p95 ΔE00 {p95:.9} exceeds {:.9}",
            config.thresholds.p95_all_nearest_rank
        ));
    }
    for index in 18..24 {
        if delta_es[index] > config.thresholds.neutral_max {
            failures.push(format!(
                "{} neutral ΔE00 {:.9} exceeds {:.9}",
                config.reference.patches[index].id, delta_es[index], config.thresholds.neutral_max
            ));
        }
    }
    let status = if failures.is_empty() { "pass" } else { "fail" };

    Ok(json!({
        "status": status,
        "environment": {
            "osBuild": decoded.metadata.os_build,
            "sdk": sdk,
            "backend": decoded.metadata.decoder_backend,
            "backendRevision": decoded.metadata.backend_revision,
            "decoderVersion": decoded.metadata.decoder_version,
            "rawloaderVersion": ANALYZER_VERSION,
        },
        "source": {
            "id": config.source.id,
            "fixturePathLookupKey": config.source.fixture_path_lookup_key,
            "sha256": source_sha256,
            "mosaicDimensions": [raw.width, raw.height],
            "nativeDimensions": [decoded.metadata.native_width, decoded.metadata.native_height],
        },
        "reference": {
            "name": config.reference.name,
            "sourceRecord": config.reference.source_record,
            "archiveFilename": config.reference.archive_filename,
            "archiveMd5": config.reference.archive_md5,
            "illuminant": config.reference.illuminant,
            "observer": config.reference.observer,
            "measurementCondition": config.reference.measurement_condition,
            "edition": config.reference.edition,
            "order": config.reference.order,
            "tupleDigest": config.canonical_digests.reference_tuples_sha256,
            "configDigest": config.canonical_digests.config_sha256,
        },
        "geometry": {
            "mosaic": config.mosaic_geometry,
            "product": config.product_geometry,
            "productOutputDimensions": [decoded.frame.width, decoded.frame.height],
        },
        "neutral": {
            "patches": ["C4", "D4", "E4", "F4"],
            "mosaicPatchMeasurements": mosaic_patches,
            "combinedPlaneMedians": combined,
            "blackLevels": raw.blacklevels,
            "whiteLevels": raw.whitelevels,
            "cfa": raw.cfa.name,
            "xyzToCameraMatrix": raw.xyz_to_cam,
            "cameraToXyzMatrix": camera_to_xyz,
            "gains": gains,
            "inferredNeutralXyzY1": neutral_xyz,
            "seedChromaticity": neutral_xy,
            "seedDerivationDigest": seed_derivation_digest,
            "calibration": {
                "objective": "max-neutral-deltaE00-A4-F4-after-C4F4-exposure-refit",
                "protocol": "deterministic-axis-descent",
                "stepSchedule": CALIBRATION_STEP_SCHEDULE,
                "maxEvaluations": CALIBRATION_MAX_EVALUATIONS,
                "evaluationsUsed": calibration_trace.len(),
                "evaluations": calibration_trace,
                "seedNeutralMaxDeltaE00": seed_objective,
                "solvedNeutralMaxDeltaE00": solved_objective,
                "chromaticHoldout": "patches A1 through F3 never enter the calibration objective",
            },
            "chromaticity": solved_xy,
            "derivationDigest": derivation_digest,
        },
        "productDecode": decoded.metadata,
        "renderContract": {
            "entryPoint": "decode_to_frame(path, 1024, intent)",
            "pixelEncoding": "unsigned-linear-srgb-rgba16-full-range",
            "workingProfile": WORKING_PROFILE,
            "intent": intent,
        },
        "exposureNormalization": {
            "method": "median-reference-Y-over-rendered-Y-C4-through-F4",
            "patchRatios": exposure_ratios,
            "factor": exposure,
        },
        "patches": patches,
        "summary": {
            "chromaticMean": chromatic_mean,
            "p95AllNearestRank": p95,
            "neutralMax": neutral_max,
            "maximum": maximum,
            "thresholds": config.thresholds,
        },
        "failures": failures,
        "permittedDestinationGamutClamps": permitted_clamps,
    }))
}

fn validate_config(config: &Config) -> Result<(), ProofError> {
    if config.reference.patches.len() != 24 || config.thresholds.patch_count != 24 {
        return Err(ProofError::fail("config must contain exactly 24 patches"));
    }
    for (index, patch) in config.reference.patches.iter().enumerate() {
        let expected = format!("{}{}", char::from(b'A' + (index % 6) as u8), index / 6 + 1);
        if patch.id != expected || patch.lab_d50.into_iter().any(|v| !v.is_finite()) {
            return Err(ProofError::fail(
                "reference patch order or value is invalid",
            ));
        }
    }
    geometry_rois(
        &config.mosaic_geometry.columns,
        &config.mosaic_geometry.rows,
        config.mosaic_geometry.roi_half_size,
        config.mosaic_geometry.dimensions[0],
        config.mosaic_geometry.dimensions[1],
    )?;
    geometry_rois(
        &config.product_geometry.columns,
        &config.product_geometry.rows,
        config.product_geometry.roi_half_size,
        config.product_geometry.native_dimensions[0] as usize,
        config.product_geometry.native_dimensions[1] as usize,
    )?;
    let tuples: Vec<_> = config
        .reference
        .patches
        .iter()
        .map(|patch| json!({"id": patch.id, "labD50": patch.lab_d50}))
        .collect();
    let tuple_digest = canonical_sha256(&Value::Array(tuples))?;
    if tuple_digest != config.canonical_digests.reference_tuples_sha256 {
        return Err(ProofError::fail("reference tuple digest mismatch"));
    }
    let mut value = serde_json::to_value(config)
        .map_err(|e| ProofError::fail(format!("serialize config: {e}")))?;
    value
        .as_object_mut()
        .ok_or_else(|| ProofError::fail("config is not an object"))?
        .remove("canonicalDigests");
    let config_digest = canonical_sha256(&value)?;
    if config_digest != config.canonical_digests.config_sha256 {
        return Err(ProofError::fail(format!(
            "config canonical digest {config_digest}, expected {}",
            config.canonical_digests.config_sha256
        )));
    }
    Ok(())
}

fn validate_raw(config: &Config, raw: &RawImage) -> Result<(), ProofError> {
    if [raw.width, raw.height] != config.mosaic_geometry.dimensions {
        return Err(ProofError::rebaseline(format!(
            "rawloader dimensions {}x{}, expected {}x{}",
            raw.width,
            raw.height,
            config.mosaic_geometry.dimensions[0],
            config.mosaic_geometry.dimensions[1]
        )));
    }
    if raw.cpp != 1 || raw.cfa.name != "RGGB" {
        return Err(ProofError::rebaseline(format!(
            "rawloader mosaic contract changed: cpp {}, CFA {}",
            raw.cpp, raw.cfa.name
        )));
    }
    if config.accepted_environment.rawloader_version != ANALYZER_VERSION {
        return Err(ProofError::rebaseline("rawloader version mismatch"));
    }
    Ok(())
}

fn analyze_mosaic(
    config: &Config,
    raw: &RawImage,
) -> Result<(Vec<MosaicPatch>, [f64; 3], Vec<String>), ProofError> {
    let data = match &raw.data {
        RawImageData::Integer(data) => data,
        RawImageData::Float(_) => return Err(ProofError::fail("fixture decoded as float mosaic")),
    };
    if data.len() != raw.width * raw.height {
        return Err(ProofError::fail("rawloader mosaic length mismatch"));
    }
    let rois = geometry_rois(
        &config.mosaic_geometry.columns,
        &config.mosaic_geometry.rows,
        config.mosaic_geometry.roi_half_size,
        raw.width,
        raw.height,
    )?;
    let mut patches = Vec::with_capacity(24);
    let mut failures = Vec::new();
    for (index, roi) in rois.iter().copied().enumerate() {
        let mut planes = [Vec::new(), Vec::new(), Vec::new()];
        let mut saturated = 0;
        for y in roi.y0..roi.y1 {
            for x in roi.x0..roi.x1 {
                let plane = raw.cfa.color_at(y, x);
                if plane > 2 {
                    return Err(ProofError::fail("unsupported CFA plane"));
                }
                let sample = data[y * raw.width + x];
                if sample >= raw.whitelevels[plane] {
                    saturated += 1;
                }
                let black = f64::from(raw.blacklevels[plane]);
                let white = f64::from(raw.whitelevels[plane]);
                if white <= black {
                    return Err(ProofError::fail("rawloader black/white levels are invalid"));
                }
                planes[plane].push((f64::from(sample) - black) / (white - black));
            }
        }
        let plane_medians = [
            median(std::mem::take(&mut planes[0]))?,
            median(std::mem::take(&mut planes[1]))?,
            median(std::mem::take(&mut planes[2]))?,
        ];
        if saturated != 0 {
            failures.push(format!(
                "{} sensor ROI has {saturated} upper-saturated samples",
                config.reference.patches[index].id
            ));
        }
        patches.push(MosaicPatch {
            id: config.reference.patches[index].id.clone(),
            roi,
            plane_medians,
            upper_saturation_count: saturated,
        });
    }
    let combined = [0, 1, 2].map(|plane| {
        median(
            NEUTRAL_PATCHES
                .iter()
                .map(|&index| patches[index].plane_medians[plane])
                .collect(),
        )
        .expect("four finite neutral medians")
    });
    Ok((patches, combined, failures))
}

fn neutral_exposure_ratios(unscaled: &[[f64; 3]], config: &Config) -> Result<[f64; 4], ProofError> {
    let ratios = NEUTRAL_PATCHES.map(|index| {
        let reference_y = lab_to_xyz(config.reference.patches[index].lab_d50)[1];
        let rendered_y = bradford_d65_to_d50(linear_srgb_to_xyz_d65(unscaled[index]))[1];
        reference_y / rendered_y
    });
    if ratios.into_iter().any(|v| !v.is_finite() || v <= 0.0) {
        return Err(ProofError::fail("exposure normalization is invalid"));
    }
    Ok(ratios)
}

fn multiply_camera_to_xyz(matrix: [[f32; 4]; 3], camera: [f64; 3]) -> [f64; 3] {
    [0, 1, 2].map(|row| {
        (0..3)
            .map(|column| f64::from(matrix[row][column]) * camera[column])
            .sum()
    })
}

fn validate_product_metadata(
    config: &Config,
    metadata: &RawFrameMetadata,
) -> Result<(), ProofError> {
    let expected = &config.product_geometry.native_dimensions;
    if [metadata.native_width, metadata.native_height] != *expected
        || metadata.source_orientation != 1
        || metadata.output_orientation != 1
        || metadata.orientation_applied
        || metadata.active_area != [0, 0, expected[0], expected[1]]
        || metadata.color_space != WORKING_PROFILE
        || metadata.sample_format != "uint16"
        || metadata.channel_order != "rgba"
        || metadata.color_model != "profiled-scene-linear-reference-rgb"
        || metadata.transfer != "linear"
        || metadata.range != "full"
        || metadata.alpha != "opaque"
        || metadata.base_rendering != "core-image-camera-profile"
        || metadata.white_balance_mode != "neutralChromaticity"
    {
        return Err(ProofError::rebaseline(
            "Core Image product metadata/geometry contract changed",
        ));
    }
    Ok(())
}

fn product_medians(
    pixels: &[u16],
    frame_width: usize,
    rois: &[Roi],
) -> Result<Vec<[f64; 3]>, ProofError> {
    rois.iter()
        .copied()
        .map(|roi| {
            let mut channels = [Vec::new(), Vec::new(), Vec::new()];
            for y in roi.y0..roi.y1 {
                for x in roi.x0..roi.x1 {
                    let offset = (y * frame_width + x) * 4;
                    if pixels[offset + 3] != u16::MAX {
                        return Err(ProofError::fail("product ROI contains non-opaque alpha"));
                    }
                    for channel in 0..3 {
                        channels[channel].push(f64::from(pixels[offset + channel]) / 65535.0);
                    }
                }
            }
            Ok([
                median(std::mem::take(&mut channels[0]))?,
                median(std::mem::take(&mut channels[1]))?,
                median(std::mem::take(&mut channels[2]))?,
            ])
        })
        .collect()
}

fn output_clip_counts(pixels: &[u16], width: usize, roi: Roi) -> BTreeMap<String, usize> {
    let mut counts = BTreeMap::new();
    for (channel, name) in ["red", "green", "blue"].iter().enumerate() {
        let mut low = 0;
        let mut high = 0;
        for y in roi.y0..roi.y1 {
            for x in roi.x0..roi.x1 {
                match pixels[(y * width + x) * 4 + channel] {
                    0 => low += 1,
                    u16::MAX => high += 1,
                    _ => {}
                }
            }
        }
        counts.insert(format!("{name}Zero"), low);
        counts.insert(format!("{name}One"), high);
    }
    counts
}

fn geometry_rois(
    columns: &[f64; 6],
    rows: &[f64; 4],
    half: [f64; 2],
    width: usize,
    height: usize,
) -> Result<Vec<Roi>, ProofError> {
    if width == 0
        || height == 0
        || half.into_iter().any(|v| !v.is_finite() || v <= 0.0)
        || columns
            .iter()
            .chain(rows)
            .any(|v| !v.is_finite() || *v <= 0.0 || *v >= 1.0)
        || !columns.windows(2).all(|v| v[0] < v[1])
        || !rows.windows(2).all(|v| v[0] < v[1])
    {
        return Err(ProofError::fail("geometry is malformed or degenerate"));
    }
    for (centers, radius) in [(&columns[..], half[0]), (&rows[..], half[1])] {
        for (index, center) in centers.iter().enumerate() {
            let low_border = if index == 0 {
                0.0
            } else {
                (centers[index - 1] + center) / 2.0
            };
            let high_border = if index + 1 == centers.len() {
                1.0
            } else {
                (center + centers[index + 1]) / 2.0
            };
            if center - radius <= low_border || center + radius >= high_border {
                return Err(ProofError::fail(
                    "geometry ROI overlaps or crosses a patch border",
                ));
            }
        }
    }
    let mut rois = Vec::with_capacity(24);
    for row in rows {
        for column in columns {
            let roi = Roi {
                x0: (((column - half[0]) * width as f64) + 1e-9).floor() as usize,
                y0: (((row - half[1]) * height as f64) + 1e-9).floor() as usize,
                x1: (((column + half[0]) * width as f64) - 1e-9).ceil() as usize,
                y1: (((row + half[1]) * height as f64) - 1e-9).ceil() as usize,
            };
            if roi.x0 >= roi.x1 || roi.y0 >= roi.y1 || roi.x1 > width || roi.y1 > height {
                return Err(ProofError::fail("geometry ROI is out of bounds or empty"));
            }
            if rois.iter().any(|other: &Roi| {
                roi.x0 < other.x1 && roi.x1 > other.x0 && roi.y0 < other.y1 && roi.y1 > other.y0
            }) {
                return Err(ProofError::fail("geometry ROIs overlap"));
            }
            rois.push(roi);
        }
    }
    Ok(rois)
}

fn environment_mismatches(config: &Config, metadata: &RawFrameMetadata, sdk: &str) -> Vec<String> {
    let expected = &config.accepted_environment;
    [
        (
            "OS build",
            metadata.os_build.as_str(),
            expected.os_build.as_str(),
        ),
        ("SDK", sdk, expected.sdk.as_str()),
        ("backend", BACKEND, expected.backend.as_str()),
        (
            "backend revision",
            BACKEND_REVISION,
            expected.backend_revision.as_str(),
        ),
        (
            "decoder version",
            metadata.decoder_version.as_str(),
            expected.decoder_version.as_str(),
        ),
        (
            "rawloader version",
            ANALYZER_VERSION,
            expected.rawloader_version.as_str(),
        ),
    ]
    .into_iter()
    .filter(|(_, actual, wanted)| actual != wanted)
    .map(|(name, actual, wanted)| format!("{name} {actual}, expected {wanted}"))
    .collect()
}

fn sdk_version() -> Result<String, ProofError> {
    let output = Command::new("xcrun")
        .arg("--show-sdk-version")
        .output()
        .map_err(|e| ProofError::rebaseline(format!("run xcrun: {e}")))?;
    if !output.status.success() {
        return Err(ProofError::rebaseline("xcrun --show-sdk-version failed"));
    }
    String::from_utf8(output.stdout)
        .map(|v| v.trim().to_owned())
        .map_err(|_| ProofError::rebaseline("SDK version is not UTF-8"))
}

fn file_sha256(path: &Path) -> Result<String, ProofError> {
    let bytes = fs::read(path).map_err(|e| ProofError::fail(format!("read fixture: {e}")))?;
    Ok(hex_sha256(&bytes))
}

fn canonical_sha256(value: &Value) -> Result<String, ProofError> {
    serde_json::to_vec(value)
        .map(|bytes| hex_sha256(&bytes))
        .map_err(|e| ProofError::fail(format!("canonical JSON serialization: {e}")))
}

fn hex_sha256(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn median(mut values: Vec<f64>) -> Result<f64, ProofError> {
    if values.is_empty() || values.iter().any(|v| !v.is_finite()) {
        return Err(ProofError::fail("median input is empty or non-finite"));
    }
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    Ok(if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    })
}

fn nearest_rank(values: &[f64], percentile: f64) -> Result<f64, ProofError> {
    if values.is_empty()
        || values.iter().any(|v| !v.is_finite())
        || !percentile.is_finite()
        || percentile <= 0.0
        || percentile > 1.0
    {
        return Err(ProofError::fail("nearest-rank input is invalid"));
    }
    let mut sorted = values.to_vec();
    sorted.sort_by(f64::total_cmp);
    Ok(sorted[(percentile * sorted.len() as f64).ceil() as usize - 1])
}

fn linear_srgb_to_xyz_d65(rgb: [f64; 3]) -> [f64; 3] {
    multiply3(
        [
            [0.4124564, 0.3575761, 0.1804375],
            [0.2126729, 0.7151522, 0.0721750],
            [0.0193339, 0.1191920, 0.9503041],
        ],
        rgb,
    )
}

fn xyz_d65_to_linear_srgb(xyz: [f64; 3]) -> [f64; 3] {
    multiply3(
        [
            [3.2404542, -1.5371385, -0.4985314],
            [-0.9692660, 1.8760108, 0.0415560],
            [0.0556434, -0.2040259, 1.0572252],
        ],
        xyz,
    )
}

fn bradford_d65_to_d50(xyz: [f64; 3]) -> [f64; 3] {
    multiply3(
        [
            [1.0478112, 0.0228866, -0.0501270],
            [0.0295424, 0.9904844, -0.0170491],
            [-0.0092345, 0.0150436, 0.7521316],
        ],
        xyz,
    )
}

fn bradford_d50_to_d65(xyz: [f64; 3]) -> [f64; 3] {
    multiply3(
        [
            [0.9555766, -0.0230393, 0.0631636],
            [-0.0282895, 1.0099416, 0.0210077],
            [0.0122982, -0.0204830, 1.3299098],
        ],
        xyz,
    )
}

fn multiply3(matrix: [[f64; 3]; 3], vector: [f64; 3]) -> [f64; 3] {
    matrix.map(|row| row.into_iter().zip(vector).map(|(a, b)| a * b).sum())
}

fn xyz_to_lab(xyz: [f64; 3]) -> [f64; 3] {
    let delta = 6.0 / 29.0;
    let f = |value: f64| {
        if value > delta * delta * delta {
            value.cbrt()
        } else {
            value / (3.0 * delta * delta) + 4.0 / 29.0
        }
    };
    let fx = f(xyz[0] / D50[0]);
    let fy = f(xyz[1] / D50[1]);
    let fz = f(xyz[2] / D50[2]);
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

fn lab_to_xyz(lab: [f64; 3]) -> [f64; 3] {
    let delta = 6.0 / 29.0;
    let inverse = |value: f64| {
        if value > delta {
            value.powi(3)
        } else {
            3.0 * delta * delta * (value - 4.0 / 29.0)
        }
    };
    let fy = (lab[0] + 16.0) / 116.0;
    let fx = fy + lab[1] / 500.0;
    let fz = fy - lab[2] / 200.0;
    [
        D50[0] * inverse(fx),
        D50[1] * inverse(fy),
        D50[2] * inverse(fz),
    ]
}

fn lab_d50_to_linear_srgb(lab: [f64; 3]) -> [f64; 3] {
    xyz_d65_to_linear_srgb(bradford_d50_to_d65(lab_to_xyz(lab)))
}

fn ciede2000(left: [f64; 3], right: [f64; 3]) -> f64 {
    let [l1, a1, b1] = left;
    let [l2, a2, b2] = right;
    let c1 = a1.hypot(b1);
    let c2 = a2.hypot(b2);
    let c_bar = (c1 + c2) / 2.0;
    let g = 0.5 * (1.0 - (c_bar.powi(7) / (c_bar.powi(7) + 25_f64.powi(7))).sqrt());
    let a1p = (1.0 + g) * a1;
    let a2p = (1.0 + g) * a2;
    let c1p = a1p.hypot(b1);
    let c2p = a2p.hypot(b2);
    let h = |a: f64, b: f64| {
        let degrees = b.atan2(a).to_degrees();
        if degrees < 0.0 {
            degrees + 360.0
        } else {
            degrees
        }
    };
    let h1p = h(a1p, b1);
    let h2p = h(a2p, b2);
    let delta_lp = l2 - l1;
    let delta_cp = c2p - c1p;
    let delta_h_degrees = if c1p * c2p == 0.0 {
        0.0
    } else if (h2p - h1p).abs() <= 180.0 {
        h2p - h1p
    } else if h2p <= h1p {
        h2p - h1p + 360.0
    } else {
        h2p - h1p - 360.0
    };
    let delta_hp = 2.0 * (c1p * c2p).sqrt() * (delta_h_degrees / 2.0).to_radians().sin();
    let l_bar = (l1 + l2) / 2.0;
    let c_bar_p = (c1p + c2p) / 2.0;
    let h_bar = if c1p * c2p == 0.0 {
        h1p + h2p
    } else if (h1p - h2p).abs() <= 180.0 {
        (h1p + h2p) / 2.0
    } else if h1p + h2p < 360.0 {
        (h1p + h2p + 360.0) / 2.0
    } else {
        (h1p + h2p - 360.0) / 2.0
    };
    let t = 1.0 - 0.17 * (h_bar - 30.0).to_radians().cos()
        + 0.24 * (2.0 * h_bar).to_radians().cos()
        + 0.32 * (3.0 * h_bar + 6.0).to_radians().cos()
        - 0.20 * (4.0 * h_bar - 63.0).to_radians().cos();
    let delta_theta = 30.0 * (-((h_bar - 275.0) / 25.0).powi(2)).exp();
    let r_c = 2.0 * (c_bar_p.powi(7) / (c_bar_p.powi(7) + 25_f64.powi(7))).sqrt();
    let s_l = 1.0 + 0.015 * (l_bar - 50.0).powi(2) / (20.0 + (l_bar - 50.0).powi(2)).sqrt();
    let s_c = 1.0 + 0.045 * c_bar_p;
    let s_h = 1.0 + 0.015 * c_bar_p * t;
    let r_t = -r_c * (2.0 * delta_theta).to_radians().sin();
    let l = delta_lp / s_l;
    let c = delta_cp / s_c;
    let h = delta_hp / s_h;
    (l * l + c * c + h * h + r_t * c * h).sqrt()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn published_ciede2000_vectors_match() {
        let vectors = [
            (
                [50.0000, 2.6772, -79.7751],
                [50.0000, 0.0000, -82.7485],
                2.0425,
            ),
            (
                [50.0000, 3.1571, -77.2803],
                [50.0000, 0.0000, -82.7485],
                2.8615,
            ),
            (
                [50.0000, 2.8361, -74.0200],
                [50.0000, 0.0000, -82.7485],
                3.4412,
            ),
            (
                [50.0000, -1.3802, -84.2814],
                [50.0000, 0.0000, -82.7485],
                1.0000,
            ),
            (
                [50.0000, -1.1848, -84.8006],
                [50.0000, 0.0000, -82.7485],
                1.0000,
            ),
            (
                [50.0000, -0.9009, -85.5211],
                [50.0000, 0.0000, -82.7485],
                1.0000,
            ),
            (
                [50.0000, 0.0000, 0.0000],
                [50.0000, -1.0000, 2.0000],
                2.3669,
            ),
            (
                [50.0000, -1.0000, 2.0000],
                [50.0000, 0.0000, 0.0000],
                2.3669,
            ),
            (
                [50.0000, 2.4900, -0.0010],
                [50.0000, -2.4900, 0.0009],
                7.1792,
            ),
            (
                [50.0000, 2.4900, -0.0010],
                [50.0000, -2.4900, 0.0010],
                7.1792,
            ),
            (
                [50.0000, 2.4900, -0.0010],
                [50.0000, -2.4900, 0.0011],
                7.2195,
            ),
            (
                [50.0000, 2.4900, -0.0010],
                [50.0000, -2.4900, 0.0012],
                7.2195,
            ),
            (
                [50.0000, -0.0010, 2.4900],
                [50.0000, 0.0009, -2.4900],
                4.8045,
            ),
            (
                [50.0000, -0.0010, 2.4900],
                [50.0000, 0.0010, -2.4900],
                4.8045,
            ),
            (
                [50.0000, -0.0010, 2.4900],
                [50.0000, 0.0011, -2.4900],
                4.7461,
            ),
            (
                [50.0000, 2.5000, 0.0000],
                [50.0000, 0.0000, -2.5000],
                4.3065,
            ),
            (
                [50.0000, 2.5000, 0.0000],
                [73.0000, 25.0000, -18.0000],
                27.1492,
            ),
            (
                [50.0000, 2.5000, 0.0000],
                [61.0000, -5.0000, 29.0000],
                22.8977,
            ),
            (
                [50.0000, 2.5000, 0.0000],
                [56.0000, -27.0000, -3.0000],
                31.9030,
            ),
            (
                [50.0000, 2.5000, 0.0000],
                [58.0000, 24.0000, 15.0000],
                19.4535,
            ),
            ([50.0000, 2.5000, 0.0000], [50.0000, 3.1736, 0.5854], 1.0000),
            ([50.0000, 2.5000, 0.0000], [50.0000, 3.2972, 0.0000], 1.0000),
            ([50.0000, 2.5000, 0.0000], [50.0000, 1.8634, 0.5757], 1.0000),
            ([50.0000, 2.5000, 0.0000], [50.0000, 3.2592, 0.3350], 1.0000),
            (
                [60.2574, -34.0099, 36.2677],
                [60.4626, -34.1751, 39.4387],
                1.2644,
            ),
            (
                [63.0109, -31.0961, -5.8663],
                [62.8187, -29.7946, -4.0864],
                1.2630,
            ),
            (
                [61.2901, 3.7196, -5.3901],
                [61.4292, 2.2480, -4.9620],
                1.8731,
            ),
            (
                [35.0831, -44.1164, 3.7933],
                [35.0232, -40.0716, 1.5901],
                1.8645,
            ),
            (
                [22.7233, 20.0904, -46.6940],
                [23.0331, 14.9730, -42.5619],
                2.0373,
            ),
            (
                [36.4612, 47.8580, 18.3852],
                [36.2715, 50.5065, 21.2231],
                1.4146,
            ),
            (
                [90.8027, -2.0831, 1.4410],
                [91.1528, -1.6435, 0.0447],
                1.4441,
            ),
            (
                [90.9257, -0.5406, -0.9208],
                [88.6381, -0.8985, -0.7239],
                1.5381,
            ),
            (
                [6.7747, -0.2908, -2.4247],
                [5.8714, -0.0985, -2.2286],
                0.6377,
            ),
            (
                [2.0776, 0.0795, -1.1350],
                [0.9033, -0.0636, -0.5514],
                0.9082,
            ),
        ];
        assert!(CIEDE2000_TEST_DATA.ends_with("ciede2000testdata.txt"));
        for (left, right, expected) in vectors {
            assert!(
                (ciede2000(left, right) - expected).abs() < 0.0001,
                "{left:?} → {right:?}"
            );
        }
    }

    #[test]
    fn adaptation_and_lab_endpoints_are_correct() {
        let d50 = bradford_d65_to_d50([0.95047, 1.0, 1.08883]);
        for (actual, expected) in d50.into_iter().zip(D50) {
            assert!((actual - expected).abs() < 0.0001);
        }
        let white = xyz_to_lab(D50);
        assert!(
            (white[0] - 100.0).abs() < 1e-12 && white[1].abs() < 1e-12 && white[2].abs() < 1e-12
        );
        assert_eq!(xyz_to_lab([0.0; 3]), [0.0; 3]);
    }

    #[test]
    fn nearest_rank_is_not_interpolated() {
        let values: Vec<f64> = (1..=24).map(f64::from).collect();
        assert_eq!(nearest_rank(&values, 0.95).unwrap(), 23.0);
    }

    #[test]
    fn normalized_top_left_roi_mapping_is_stable() {
        let rois = geometry_rois(
            &[0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
            &[0.2, 0.4, 0.6, 0.8],
            [0.01, 0.02],
            1000,
            500,
        )
        .unwrap();
        assert_eq!(
            rois[0],
            Roi {
                x0: 90,
                y0: 90,
                x1: 110,
                y1: 110
            }
        );
        assert_eq!(
            rois[23],
            Roi {
                x0: 590,
                y0: 390,
                x1: 610,
                y1: 410
            }
        );
    }

    #[test]
    fn canonical_hash_and_derivation_are_stable() {
        let a = json!({"z": 1, "a": [2, 3]});
        let b = json!({"a": [2, 3], "z": 1});
        assert_eq!(canonical_sha256(&a).unwrap(), canonical_sha256(&b).unwrap());
        assert_eq!(
            canonical_sha256(&json!({
                "analyzer": ANALYZER,
                "analyzerVersion": ANALYZER_VERSION,
                "cameraToXyz": [[1.0, 0.0, 0.0, 0.0], [0.0, 1.0, 0.0, 0.0], [0.0, 0.0, 1.0, 0.0]],
                "configSha256": "11".repeat(32),
                "gains": [2.0, 1.0, 1.5],
                "neutralChromaticity": [0.3127, 0.3290],
                "sourceSha256": "22".repeat(32),
                "xyzToCamera": [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0], [0.0, 0.0, 0.0]],
            }))
            .unwrap(),
            "b9b70b282938e60efecca30cc5e4d9ff11c3eaec7cfe20c08c519c257915a9b4"
        );
    }

    #[test]
    fn calibration_descends_to_a_synthetic_optimum_deterministically() {
        let optimum = [0.3457, 0.3585];
        let bowl = |xy: [f64; 2]| -> Result<f64, ProofError> {
            Ok(10.0 * ((xy[0] - optimum[0]).powi(2) + (xy[1] - optimum[1]).powi(2)).sqrt())
        };
        let seed = [0.3537, 0.3696];
        let (trace, solved, best) = calibrate_chromaticity(seed, &mut bowl.clone()).unwrap();
        // Seed is always the first evaluation; the solve must land within the
        // finest step of the optimum on each axis and strictly improve on it.
        assert_eq!(trace[0].chromaticity, seed);
        assert!((solved[0] - optimum[0]).abs() <= CALIBRATION_STEP_SCHEDULE[4]);
        assert!((solved[1] - optimum[1]).abs() <= CALIBRATION_STEP_SCHEDULE[4]);
        assert!(best < trace[0].neutral_max_delta_e00);
        assert!(trace.len() <= CALIBRATION_MAX_EVALUATIONS);
        let (second_trace, second_solved, second_best) =
            calibrate_chromaticity(seed, &mut bowl.clone()).unwrap();
        assert_eq!(second_solved, solved);
        assert_eq!(second_best, best);
        assert_eq!(second_trace.len(), trace.len());
        for (left, right) in trace.iter().zip(&second_trace) {
            assert_eq!(left.chromaticity, right.chromaticity);
            assert_eq!(left.neutral_max_delta_e00, right.neutral_max_delta_e00);
        }
    }

    #[test]
    fn calibration_never_evaluates_out_of_domain_and_enforces_its_budget() {
        let mut probed = Vec::new();
        let mut walker = |xy: [f64; 2]| -> Result<f64, ProofError> {
            probed.push(xy);
            assert!(xy[0] > 0.0 && xy[0] < 1.0 && xy[1] > 0.0 && xy[1] < 1.0);
            // Strictly decreasing in x forever: the descent walks toward the
            // domain edge and must stop probing outside (0, 1) without error.
            Ok(xy[0])
        };
        let (trace, solved, _) = calibrate_chromaticity([0.02, 0.5], &mut walker).unwrap();
        assert!(solved[0] > 0.0 && solved[0] < 0.02);
        assert!(trace.len() <= CALIBRATION_MAX_EVALUATIONS);

        let mut calls = 0_usize;
        let mut pathological = |xy: [f64; 2]| -> Result<f64, ProofError> {
            calls += 1;
            // Never converges: strictly better for every larger x.
            Ok(1.0 - xy[0])
        };
        let error = calibrate_chromaticity([0.001, 0.5], &mut pathological).unwrap_err();
        assert_eq!(error.status, "fail");
        assert!(error.message.contains("evaluation budget"));
        assert_eq!(calls, CALIBRATION_MAX_EVALUATIONS);
    }

    #[test]
    fn calibration_rejects_a_non_finite_objective() {
        let mut broken = |_: [f64; 2]| -> Result<f64, ProofError> { Ok(f64::NAN) };
        let error = calibrate_chromaticity([0.3, 0.3], &mut broken).unwrap_err();
        assert_eq!(error.status, "fail");
        assert!(error.message.contains("non-finite"));
    }

    #[test]
    fn committed_reference_and_config_hashes_validate() {
        let config: Config =
            serde_json::from_str(include_str!("../../../proofs/colorchecker-967.json")).unwrap();
        validate_config(&config).unwrap();
        assert_eq!(
            config.canonical_digests.reference_tuples_sha256,
            "81c47453e1127088f65dfcf768f999ba5819585e9c15a12b351ef4139b8a894a"
        );
        assert_eq!(
            config.canonical_digests.config_sha256,
            "4b60bbe2cd017c0f268604472b548141ca42b08ba6f49324b6c35449fd0d0633"
        );
    }

    #[test]
    fn geometry_rejects_malformed_out_of_bounds_overlap_and_border_crossing() {
        let valid_columns = [0.1, 0.2, 0.3, 0.4, 0.5, 0.6];
        let valid_rows = [0.2, 0.4, 0.6, 0.8];
        assert!(geometry_rois(&valid_columns, &valid_rows, [0.01, 0.02], 100, 100).is_ok());
        assert!(geometry_rois(&[0.1; 6], &valid_rows, [0.01, 0.02], 100, 100).is_err());
        assert!(geometry_rois(&valid_columns, &valid_rows, [0.0, 0.02], 100, 100).is_err());
        assert!(geometry_rois(&valid_columns, &valid_rows, [0.06, 0.02], 100, 100).is_err());
        assert!(geometry_rois(&valid_columns, &valid_rows, [0.01, 0.11], 100, 100).is_err());
        assert!(geometry_rois(
            &valid_columns,
            &[0.2, 0.4, 0.6, 0.99],
            [0.01, 0.02],
            100,
            100
        )
        .is_err());
    }

    #[test]
    fn fixture_missing_and_sha_mismatch_are_hard_failures() {
        let missing = env::temp_dir().join("monet-colorchecker-definitely-missing");
        assert_eq!(file_sha256(&missing).unwrap_err().status, "fail");
        let path = env::temp_dir().join(format!(
            "monet-colorchecker-{}",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::write(&path, b"wrong fixture").unwrap();
        assert_ne!(file_sha256(&path).unwrap(), "00".repeat(32));
        fs::remove_file(path).unwrap();
    }

    #[test]
    fn environment_mismatch_requires_rebaseline() {
        let config: Config =
            serde_json::from_str(include_str!("../../../proofs/colorchecker-967.json")).unwrap();
        let metadata: RawFrameMetadata = serde_json::from_value(json!({
            "nativeWidth": 6000, "nativeHeight": 4000, "sourceOrientation": 1,
            "outputWidth": 1024, "outputHeight": 683, "activeArea": [0,0,6000,4000],
            "outputOrientation": 1, "orientationApplied": false,
            "decoderBackend": BACKEND, "backendRevision": BACKEND_REVISION,
            "decoderVersion": "changed", "osBuild": config.accepted_environment.os_build,
            "colorSpace": WORKING_PROFILE, "sampleFormat": "uint16", "channelOrder": "rgba",
            "colorModel": "profiled-scene-linear-reference-rgb", "transfer": "linear",
            "range": "full", "alpha": "opaque", "baseRendering": "core-image-camera-profile",
            "whiteBalanceMode": "neutralChromaticity", "neutralTemperature": 5000.0,
            "neutralTint": 0.0, "scaleNumerator": 64, "scaleDenominator": 375,
            "provenanceDigest": "00", "sourceDigest": "00", "workingProfileDigest": "00",
            "decodeIntentDigest": "00"
        }))
        .unwrap();
        assert!(
            environment_mismatches(&config, &metadata, &config.accepted_environment.sdk)
                .iter()
                .any(|failure| failure.contains("decoder version"))
        );
    }
}
