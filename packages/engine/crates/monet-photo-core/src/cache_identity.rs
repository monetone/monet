use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::{collections::HashSet, error::Error, fmt};

use crate::image::MAX_DIMENSION;
use crate::{
    canonical_recipe_json, legacy_params_v1_to_recipe, parse_recipe_json, recipe_digest,
    DevelopRecipeV2, PROCESS_VERSION,
};

// v2.3: previews/thumbnails now composite the recipe's local (parametric) masks
// (they were global-only before), so every preview cached under v2.2 is stale.
pub const SHARED_CORE_REVISION: &str = "preview-identity-v2.3";

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewIdentityV2 {
    pub identity_version: u8,
    pub source_digest: String,
    pub decoder_backend: String,
    pub backend_revision: String,
    pub decoder_version: String,
    pub os_build: String,
    pub decode_intent_digest: String,
    pub native_width: u32,
    pub native_height: u32,
    /// `[x, y, width, height]` in un-oriented native source coordinates.
    pub active_area: [u32; 4],
    pub source_orientation: u8,
    pub output_orientation: u8,
    pub orientation_applied: bool,
    pub recipe_digest: String,
    pub process_version: u32,
    pub mask_digest: String,
    pub model_versions: Vec<(String, String)>,
    pub working_profile_digest: String,
    pub core_revision: String,
    pub preview_kind: String,
    pub output_width: u32,
    pub output_height: u32,
    pub scale_numerator: u32,
    pub scale_denominator: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PreviewIdentityFactsV2 {
    pub decoder_backend: String,
    pub backend_revision: String,
    pub decoder_version: String,
    pub os_build: String,
    pub native_width: u32,
    pub native_height: u32,
    pub active_area: [u32; 4],
    pub source_orientation: u8,
    pub output_orientation: u8,
    pub orientation_applied: bool,
    pub working_profile_digest: String,
    pub output_width: u32,
    pub output_height: u32,
    pub scale_numerator: u32,
    pub scale_denominator: u32,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RenderProvenanceV2 {
    pub identity: PreviewIdentityV2,
    pub base_rendering: String,
    pub pixel_encoding: String,
    pub transfer: String,
    pub range: String,
    pub alpha_mode: String,
    pub provenance_digest: String,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct IdentityError(String);

impl fmt::Display for IdentityError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl Error for IdentityError {}

fn fail(message: impl Into<String>) -> IdentityError {
    IdentityError(message.into())
}

fn digest(value: &str, path: &str) -> Result<(), IdentityError> {
    if value.len() == 64
        && value
            .bytes()
            .all(|byte| byte.is_ascii_digit() || (b'a'..=b'f').contains(&byte))
    {
        Ok(())
    } else {
        Err(fail(format!("{path} must be a SHA-256 hex digest")))
    }
}

fn text(value: &str, path: &str) -> Result<(), IdentityError> {
    if value.trim().is_empty() || value.len() > 1024 {
        Err(fail(format!("{path} must be a non-empty bounded string")))
    } else {
        Ok(())
    }
}

fn gcd(mut a: u32, mut b: u32) -> u32 {
    while b != 0 {
        (a, b) = (b, a % b);
    }
    a
}

fn hex_digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn render_provenance_digest(provenance: &RenderProvenanceV2) -> Result<String, IdentityError> {
    let mut value = serde_json::to_value(provenance).map_err(|error| fail(error.to_string()))?;
    value
        .as_object_mut()
        .ok_or_else(|| fail("render provenance must be an object"))?
        .remove("provenanceDigest");
    Ok(hex_digest(
        &serde_json::to_vec(&value).map_err(|error| fail(error.to_string()))?,
    ))
}

fn recipe_or_default(recipe_json: Option<&str>) -> Result<DevelopRecipeV2, IdentityError> {
    match recipe_json {
        Some(recipe) => parse_recipe_json(recipe).map_err(|error| fail(error.to_string())),
        None => legacy_params_v1_to_recipe(&[]).map_err(|error| fail(error.to_string())),
    }
}

fn canonical_subvalue_digest(recipe: &DevelopRecipeV2, key: &str) -> Result<String, IdentityError> {
    let canonical = canonical_recipe_json(recipe).map_err(|error| fail(error.to_string()))?;
    let value: Value =
        serde_json::from_slice(&canonical).map_err(|error| fail(error.to_string()))?;
    let subvalue = value
        .get(key)
        .ok_or_else(|| fail(format!("canonical recipe is missing {key}")))?;
    Ok(hex_digest(
        &serde_json::to_vec(subvalue).map_err(|error| fail(error.to_string()))?,
    ))
}

fn canonical(identity: &PreviewIdentityV2) -> Result<PreviewIdentityV2, IdentityError> {
    if identity.identity_version != 2 {
        return Err(fail("unsupported preview identity version"));
    }
    for (path, value) in [
        ("sourceDigest", &identity.source_digest),
        ("decodeIntentDigest", &identity.decode_intent_digest),
        ("recipeDigest", &identity.recipe_digest),
        ("maskDigest", &identity.mask_digest),
        ("workingProfileDigest", &identity.working_profile_digest),
    ] {
        digest(value, path)?;
    }
    for (path, value) in [
        ("decoderBackend", &identity.decoder_backend),
        ("backendRevision", &identity.backend_revision),
        ("decoderVersion", &identity.decoder_version),
        ("osBuild", &identity.os_build),
        ("coreRevision", &identity.core_revision),
    ] {
        text(value, path)?;
    }
    if identity.core_revision != SHARED_CORE_REVISION {
        return Err(fail("unsupported shared-core revision"));
    }
    if identity.process_version != PROCESS_VERSION as u32 {
        return Err(fail("unsupported process version"));
    }
    if !(1..=8).contains(&identity.source_orientation) || identity.output_orientation != 1 {
        return Err(fail("invalid preview orientation"));
    }
    if identity.orientation_applied != (identity.source_orientation != identity.output_orientation)
    {
        return Err(fail("preview orientation application is inconsistent"));
    }
    if identity.native_width == 0
        || identity.native_height == 0
        || identity.active_area[2] == 0
        || identity.active_area[3] == 0
        || identity.output_width == 0
        || identity.output_height == 0
        || identity.scale_numerator == 0
        || identity.scale_denominator == 0
    {
        return Err(fail("identity dimensions and scale must be positive"));
    }
    let active_right = identity.active_area[0]
        .checked_add(identity.active_area[2])
        .ok_or_else(|| fail("active area overflows"))?;
    let active_bottom = identity.active_area[1]
        .checked_add(identity.active_area[3])
        .ok_or_else(|| fail("active area overflows"))?;
    if active_right > identity.native_width || active_bottom > identity.native_height {
        return Err(fail("active area exceeds native source dimensions"));
    }
    if identity.output_width > MAX_DIMENSION || identity.output_height > MAX_DIMENSION {
        return Err(fail("preview dimensions out of range"));
    }
    if gcd(identity.scale_numerator, identity.scale_denominator) != 1 {
        return Err(fail("preview scale must be reduced"));
    }
    if !matches!(
        identity.preview_kind.as_str(),
        "thumbnail" | "standard" | "develop" | "loupe" | "secondary"
    ) {
        return Err(fail("invalid preview kind"));
    }
    let mut canonical = identity.clone();
    canonical.model_versions.sort();
    let mut models = HashSet::new();
    for (model, version) in &canonical.model_versions {
        text(model, "modelVersions key")?;
        text(version, &format!("modelVersions.{model}"))?;
        if !models.insert(model) {
            return Err(fail(format!("duplicate model key {model}")));
        }
    }
    Ok(canonical)
}

pub fn build_preview_identity(
    source_digest: &str,
    recipe_json: Option<&str>,
    facts: PreviewIdentityFactsV2,
    preview_kind: &str,
) -> Result<PreviewIdentityV2, IdentityError> {
    let recipe = recipe_or_default(recipe_json)?;
    let recipe_value = recipe.value();
    let models = recipe_value["metadata"]["modelVersions"]
        .as_object()
        .ok_or_else(|| fail("canonical recipe model versions are invalid"))?
        .iter()
        .map(|(model, version)| {
            Ok((
                model.clone(),
                version
                    .as_str()
                    .ok_or_else(|| fail("canonical model version is not a string"))?
                    .to_owned(),
            ))
        })
        .collect::<Result<Vec<_>, IdentityError>>()?;
    let digest = recipe_digest(&recipe).map_err(|error| fail(error.to_string()))?;
    let identity = PreviewIdentityV2 {
        identity_version: 2,
        source_digest: source_digest.to_owned(),
        decoder_backend: facts.decoder_backend,
        backend_revision: facts.backend_revision,
        decoder_version: facts.decoder_version,
        os_build: facts.os_build,
        decode_intent_digest: crate::raw_decode_intent_digest(&recipe_value["rawDecode"])
            .map_err(|error| fail(error.to_string()))?
            .0
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        native_width: facts.native_width,
        native_height: facts.native_height,
        active_area: facts.active_area,
        source_orientation: facts.source_orientation,
        output_orientation: facts.output_orientation,
        orientation_applied: facts.orientation_applied,
        recipe_digest: digest.0.iter().map(|byte| format!("{byte:02x}")).collect(),
        process_version: PROCESS_VERSION as u32,
        mask_digest: canonical_subvalue_digest(&recipe, "masks")?,
        model_versions: models,
        working_profile_digest: facts.working_profile_digest,
        core_revision: SHARED_CORE_REVISION.into(),
        preview_kind: preview_kind.into(),
        output_width: facts.output_width,
        output_height: facts.output_height,
        scale_numerator: facts.scale_numerator,
        scale_denominator: facts.scale_denominator,
    };
    canonical(&identity)
}

pub fn build_render_provenance(
    identity: PreviewIdentityV2,
    base_rendering: String,
    pixel_encoding: String,
    transfer: String,
    range: String,
    alpha_mode: String,
) -> Result<RenderProvenanceV2, IdentityError> {
    let mut provenance = RenderProvenanceV2 {
        identity,
        base_rendering,
        pixel_encoding,
        transfer,
        range,
        alpha_mode,
        provenance_digest: String::new(),
    };
    provenance.provenance_digest = render_provenance_digest(&provenance)?;
    Ok(provenance)
}

pub fn preview_identity_digest(identity: &PreviewIdentityV2) -> Result<[u8; 32], IdentityError> {
    let canonical = canonical(identity)?;
    Ok(
        Sha256::digest(serde_json::to_vec(&canonical).map_err(|error| fail(error.to_string()))?)
            .into(),
    )
}

pub fn validate_render_provenance(
    expected: &PreviewIdentityV2,
    provenance: &RenderProvenanceV2,
) -> Result<(), IdentityError> {
    let expected = canonical(expected)?;
    let actual = canonical(&provenance.identity)?;
    if actual != expected {
        return Err(fail("render provenance identity mismatch"));
    }
    for (path, value) in [
        ("baseRendering", &provenance.base_rendering),
        ("pixelEncoding", &provenance.pixel_encoding),
        ("transfer", &provenance.transfer),
        ("range", &provenance.range),
        ("alphaMode", &provenance.alpha_mode),
    ] {
        text(value, path)?;
    }
    digest(&provenance.provenance_digest, "provenanceDigest")?;
    if render_provenance_digest(provenance)? != provenance.provenance_digest {
        return Err(fail("render provenance digest mismatch"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn facts() -> PreviewIdentityFactsV2 {
        PreviewIdentityFactsV2 {
            decoder_backend: "core-image".into(),
            backend_revision: "2".into(),
            decoder_version: "8".into(),
            os_build: "25E246".into(),
            native_width: 6000,
            native_height: 4000,
            active_area: [12, 8, 5960, 3970],
            source_orientation: 6,
            output_orientation: 1,
            orientation_applied: true,
            working_profile_digest: "44".repeat(32),
            output_width: 2048,
            output_height: 1365,
            scale_numerator: 128,
            scale_denominator: 375,
        }
    }

    fn identity() -> PreviewIdentityV2 {
        build_preview_identity(&"00".repeat(32), None, facts(), "develop").unwrap()
    }

    #[test]
    fn rust_builds_canonical_identity_and_normalizes_model_order() {
        let first = identity();
        assert_eq!(first.identity_version, 2);
        assert_eq!(first.core_revision, SHARED_CORE_REVISION);
        assert_eq!(first.output_orientation, 1);
        assert!(first.orientation_applied);
        assert_eq!(
            preview_identity_digest(&first).unwrap(),
            preview_identity_digest(&first).unwrap()
        );
    }

    #[test]
    fn every_identity_field_invalidates_the_digest() {
        let original = identity();
        let key = preview_identity_digest(&original).unwrap();
        let mutations: Vec<fn(&mut PreviewIdentityV2)> = vec![
            |v| v.identity_version = 3,
            |v| v.source_digest = "55".repeat(32),
            |v| v.decoder_backend.push('x'),
            |v| v.backend_revision.push('x'),
            |v| v.decoder_version.push('x'),
            |v| v.os_build.push('x'),
            |v| v.decode_intent_digest = "11".repeat(32),
            |v| v.native_width += 1,
            |v| v.native_height += 1,
            |v| v.active_area[0] = 1,
            |v| v.source_orientation = 8,
            |v| v.output_orientation = 2,
            |v| v.orientation_applied = false,
            |v| v.recipe_digest = "22".repeat(32),
            |v| v.process_version = 7,
            |v| v.mask_digest = "33".repeat(32),
            |v| v.model_versions.push(("subject".into(), "1".into())),
            |v| v.working_profile_digest = "88".repeat(32),
            |v| v.core_revision.push('x'),
            |v| v.preview_kind = "thumbnail".into(),
            |v| v.output_width -= 1,
            |v| v.output_height -= 1,
            |v| v.scale_numerator += 1,
            |v| v.scale_denominator += 1,
        ];
        for mutate in mutations {
            let mut changed = original.clone();
            mutate(&mut changed);
            match preview_identity_digest(&changed) {
                Ok(changed_key) => assert_ne!(key, changed_key),
                Err(_) => {}
            }
        }
    }

    #[test]
    fn complete_render_provenance_must_match_identity() {
        let expected = identity();
        let valid = build_render_provenance(
            expected.clone(),
            "core-image-camera-profile".into(),
            "linearSrgbU16Full".into(),
            "linear".into(),
            "full".into(),
            "opaque".into(),
        )
        .unwrap();
        validate_render_provenance(&expected, &valid).unwrap();
        let mut stale = valid.clone();
        stale.identity.decoder_version.push('x');
        assert!(validate_render_provenance(&expected, &stale).is_err());
        let mut arbitrary = valid;
        arbitrary.provenance_digest = "99".repeat(32);
        assert!(validate_render_provenance(&expected, &arbitrary).is_err());
    }
}
