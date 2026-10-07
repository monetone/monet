use serde::Deserialize;
use serde_json::{json, Map, Value};
use sha2::{Digest, Sha256};
use std::{collections::HashSet, error::Error, fmt};

pub const PROCESS_VERSION: u64 = 6;
const PARAMS_LEN: usize = 1086;

#[derive(Clone, Debug, PartialEq)]
pub struct DevelopRecipeV2(Value);

impl DevelopRecipeV2 {
    pub fn value(&self) -> &Value {
        &self.0
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RecipeDigest(pub [u8; 32]);

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct RecipeError(pub String);

impl fmt::Display for RecipeError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(&self.0)
    }
}
impl Error for RecipeError {}

fn err(message: impl Into<String>) -> RecipeError {
    RecipeError(message.into())
}

macro_rules! record {
    ($name:ident { $($field:ident : $ty:ty),* $(,)? }) => {
        #[derive(Debug, Deserialize)]
        #[serde(rename_all = "camelCase", deny_unknown_fields)]
        struct $name {
            $( $field: $ty, )*
        }
    };
}

record!(RawDecode {
    mode: String,
    x: Option<f64>,
    y: Option<f64>,
    derivation_digest: Option<String>,
});
record!(ProfileSourceCamera {
    camera_to_xyz: Vec<f64>,
    white_balance: Vec<f64>,
});
record!(Profile {
    // Stable profile identity (drives the develop profile code, engine p[1088]).
    // Optional for backward compatibility: recipes persisted before the Profile
    // feature have no `id`; the TS codec backfills "camera-default" (code 0) so
    // they render unchanged. New recipes always carry it (mirrors Vision's ids).
    id: Option<String>,
    name: String,
    group: String,
    amount: f64,
    // Which DNG camera profile an embedded/custom id names (#446): the
    // renderer's 32-hex-digit fingerprint. Native develops have no profile
    // registry, so those ids render as Camera Default here.
    digest: Option<String>,
    // The image's as-shot white in kelvin the profile's illuminants are
    // interpolated at (the wasm renderer's V6 tail).
    as_shot_kelvin: Option<f64>,
    source_camera: Option<ProfileSourceCamera>,
});
record!(CropRect {
    top: f64,
    left: f64,
    bottom: f64,
    right: f64,
});
record!(Crop {
    rect: CropRect,
    angle: f64,
    orientation: u8,
    constrain_aspect: Option<f64>,
});
record!(Basic {
    wb_mode: String,
    temp: f64,
    tint: f64,
    exposure: f64,
    contrast: f64,
    highlights: f64,
    shadows: f64,
    whites: f64,
    blacks: f64,
    texture: f64,
    clarity: f64,
    dehaze: f64,
    vibrance: f64,
    saturation: f64,
});
record!(CurvePoint { x: f64, y: f64 });
record!(Parametric {
    highlights: f64,
    lights: f64,
    darks: f64,
    shadows: f64,
});
record!(ToneCurve {
    parametric: Parametric,
    parametric_splits: [f64; 3],
    point: Vec<CurvePoint>,
    red: Vec<CurvePoint>,
    green: Vec<CurvePoint>,
    blue: Vec<CurvePoint>,
    target_adjust: bool,
});
record!(ColorMixer {
    mode: String,
    hue: [f64; 8],
    saturation: [f64; 8],
    luminance: [f64; 8],
    gray: [f64; 8],
    target_adjust: bool,
});
record!(PointColorSample {
    src_hue: f64,
    src_sat: f64,
    src_lum: f64,
    hue: f64,
    sat: f64,
    lum: f64,
    range: f64,
});
record!(PointColor {
    samples: Vec<PointColorSample>,
});
record!(HealSpot {
    mode: String,
    x: f64,
    y: f64,
    source_x: f64,
    source_y: f64,
    radius: f64,
    feather: f64,
    opacity: f64,
});
record!(Heal {
    spots: Vec<HealSpot>,
});
record!(GradeWheel {
    hue: f64,
    sat: f64,
    lum: f64,
});
record!(ColorGrading {
    shadows: GradeWheel,
    midtones: GradeWheel,
    highlights: GradeWheel,
    global: GradeWheel,
    blending: f64,
    balance: f64,
});
record!(Detail {
    sharpen_amount: f64,
    sharpen_radius: f64,
    sharpen_detail: f64,
    sharpen_masking: f64,
    nr_luminance: f64,
    nr_luminance_detail: f64,
    nr_luminance_contrast: f64,
    nr_color: f64,
    nr_color_detail: f64,
    nr_color_smoothness: f64,
});
record!(LensCalibration {
    profile_id: String,
    distortion: [f64; 4],
    red: [f64; 3],
    blue: [f64; 3],
    vignette: [f64; 3],
});
record!(Optics {
    // Canonical continuous CA amount (engine p[1051]). Optional so recipes
    // serialized with the legacy boolean below still parse; the params builder
    // (develop::recipe_to_legacy_params) migrates bool→f32 when this is absent.
    aberration: Option<f32>,
    // Legacy boolean CA toggle — kept optional so OLD recipes (which carry this
    // instead of `aberration`) still satisfy deny_unknown_fields.
    remove_chromatic_aberration: Option<bool>,
    enable_profile_corrections: bool,
    profile_name: Option<String>,
    profile_id: Option<String>,
    profile_distortion_amount: Option<f64>,
    profile_vignetting_amount: Option<f64>,
    profile_focal_length_mm: Option<f64>,
    profile_aperture: Option<f64>,
    profile_crop_factor: Option<f64>,
    profile_calibration: Option<LensCalibration>,
    distortion_amount: f64,
    vignetting_amount: f64,
    defringe_purple_amount: f64,
    defringe_purple_hue: [f64; 2],
    defringe_green_amount: f64,
    defringe_green_hue: [f64; 2],
});
record!(Transform {
    upright: String,
    vertical: f64,
    horizontal: f64,
    rotate: f64,
    scale: f64,
    x_offset: f64,
    y_offset: f64,
    aspect: f64,
});
record!(Effects {
    vignette_amount: f64,
    vignette_midpoint: f64,
    vignette_roundness: f64,
    vignette_feather: f64,
    vignette_highlights: f64,
    grain_amount: f64,
    grain_size: f64,
    grain_roughness: f64,
});
record!(Calibration {
    shadow_tint: f64,
    red_hue: f64,
    red_sat: f64,
    green_hue: f64,
    green_sat: f64,
    blue_hue: f64,
    blue_sat: f64,
});
record!(Hdr { enabled: bool });
record!(PanelEnable {
    basic: bool,
    tone_curve: bool,
    color_mixer: bool,
    point_color: bool,
    color_grading: bool,
    detail: bool,
    optics: bool,
    transform: bool,
    effects: bool,
    calibration: bool,
});
record!(Metadata {
    created_with: String,
    model_versions: std::collections::BTreeMap<String, String>,
});
record!(MaskGraph { masks: Vec<Mask> });
record!(Mask {
    id: String,
    name: String,
    enabled: bool,
    inverted: bool,
    opacity: f64,
    components: Vec<Value>,
    adjustments: LocalAdjustments,
});
record!(LocalAdjustments {
    exposure: f64,
    contrast: f64,
    highlights: f64,
    shadows: f64,
    whites: f64,
    blacks: f64,
    texture: f64,
    clarity: f64,
    dehaze: f64,
    saturation: f64,
    temp: f64,
    tint: f64,
    sharpness: f64,
    noise: f64,
    moire: f64,
    defringe: f64,
});
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct ComponentBase {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
}
record!(BrushDab {
    x: f64,
    y: f64,
    radius: f64,
    flow: f64,
    density: f64,
    erase: bool,
});
record!(BrushComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    dabs: Vec<BrushDab>,
    auto_mask: bool,
});
record!(LinearGradientComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    x1: f64,
    y1: f64,
    x2: f64,
    y2: f64,
});
record!(RadialGradientComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    cx: f64,
    cy: f64,
    rx: f64,
    ry: f64,
    angle: f64,
    feather: f64,
});
record!(ColorSample {
    r: f64,
    g: f64,
    b: f64
});
record!(ColorRangeComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    samples: Vec<ColorSample>,
    refine: f64,
});
record!(LuminanceRangeComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    min: f64,
    max: f64,
    smoothness: f64,
});
record!(DepthRangeComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    near: f64,
    far: f64,
    // Optional: graphs persisted before the band feather existed carry no
    // `smoothness` and must keep parsing (deny_unknown_fields cuts both ways).
    smoothness: Option<f64>,
});
record!(AiComponent {
    id: String,
    kind: String,
    combine: String,
    invert: bool,
    model: String,
    cache_id: Option<String>,
});

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Recipe {
    version: u8,
    process_version: u64,
    raw_decode: RawDecode,
    profile: Profile,
    crop: Crop,
    basic: Basic,
    tone_curve: ToneCurve,
    color_mixer: ColorMixer,
    point_color: PointColor,
    color_grading: ColorGrading,
    detail: Detail,
    optics: Optics,
    transform: Transform,
    effects: Effects,
    calibration: Calibration,
    hdr: Hdr,
    // Optional so recipes persisted before the heal field existed keep parsing
    // (and keep their stored canonical bytes); absent means no spots.
    heal: Option<Heal>,
    enabled: PanelEnable,
    masks: MaskGraph,
    metadata: Metadata,
}

fn finite(value: f64, path: &str) -> Result<f64, RecipeError> {
    value
        .is_finite()
        .then_some(value)
        .ok_or_else(|| err(format!("{path} must be finite")))
}

fn range(value: f64, min: f64, max: f64, path: &str) -> Result<(), RecipeError> {
    let value = finite(value, path)?;
    if (min..=max).contains(&value) {
        Ok(())
    } else {
        Err(err(format!("{path} must be in {min}..={max}")))
    }
}

fn nonempty(value: &str, path: &str) -> Result<(), RecipeError> {
    if value.trim().is_empty() || value.len() > 1024 {
        Err(err(format!("{path} must be a non-empty bounded string")))
    } else {
        Ok(())
    }
}

fn id(value: &str, path: &str) -> Result<(), RecipeError> {
    if value.is_empty()
        || value.len() > 256
        || !value.bytes().all(|byte| {
            byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_' | b'.' | b':' | b'/')
        })
    {
        Err(err(format!("{path} is not a valid id")))
    } else {
        Ok(())
    }
}

fn digest(value: &str, path: &str) -> Result<(), RecipeError> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(err(format!("{path} must be a SHA-256 hex digest")))
    }
}

fn one_of(value: &str, allowed: &[&str], path: &str) -> Result<(), RecipeError> {
    if allowed.contains(&value) {
        Ok(())
    } else {
        Err(err(format!("invalid {path}")))
    }
}

fn validate_points(points: &[CurvePoint], path: &str) -> Result<(), RecipeError> {
    if !(2..=256).contains(&points.len()) {
        return Err(err(format!("{path} has invalid length")));
    }
    let mut previous = -1.0;
    for (index, point) in points.iter().enumerate() {
        range(point.x, 0.0, 1.0, &format!("{path}[{index}].x"))?;
        range(point.y, 0.0, 1.0, &format!("{path}[{index}].y"))?;
        if point.x <= previous {
            return Err(err(format!("{path} x values must be strictly increasing")));
        }
        previous = point.x;
    }
    if points.first().map(|point| point.x) != Some(0.0)
        || points.last().map(|point| point.x) != Some(1.0)
    {
        return Err(err(format!("{path} must span 0..1")));
    }
    Ok(())
}

fn validate_local(local: &LocalAdjustments, path: &str) -> Result<(), RecipeError> {
    for (name, value) in [
        ("exposure", local.exposure),
        ("contrast", local.contrast),
        ("highlights", local.highlights),
        ("shadows", local.shadows),
        ("whites", local.whites),
        ("blacks", local.blacks),
        ("texture", local.texture),
        ("clarity", local.clarity),
        ("dehaze", local.dehaze),
        ("saturation", local.saturation),
        ("temp", local.temp),
        ("tint", local.tint),
        ("sharpness", local.sharpness),
        ("noise", local.noise),
        ("moire", local.moire),
        ("defringe", local.defringe),
    ] {
        range(value, -100.0, 100.0, &format!("{path}.{name}"))?;
    }
    Ok(())
}

fn validate_component(
    value: &Value,
    path: &str,
    ids: &mut HashSet<String>,
) -> Result<(), RecipeError> {
    let base: ComponentBase =
        serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
    id(&base.id, &format!("{path}.id"))?;
    if !ids.insert(base.id.clone()) {
        return Err(err(format!("duplicate mask/component id {}", base.id)));
    }
    one_of(
        &base.combine,
        &["add", "subtract", "intersect"],
        &format!("{path}.combine"),
    )?;
    let _ = base.invert;
    match base.kind.as_str() {
        "brush" => {
            let component: BrushComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            if component.kind != "brush"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
            {
                return Err(err(format!("invalid {path}")));
            }
            if component.dabs.len() > 1_000_000 {
                return Err(err("brush component exceeds checked-size limit"));
            }
            let _ = component.auto_mask;
            for (index, dab) in component.dabs.iter().enumerate() {
                for (name, sample) in [
                    ("x", dab.x),
                    ("y", dab.y),
                    ("flow", dab.flow),
                    ("density", dab.density),
                ] {
                    range(sample, 0.0, 1.0, &format!("{path}.dabs[{index}].{name}"))?;
                }
                range(
                    dab.radius,
                    f64::MIN_POSITIVE,
                    2.0,
                    &format!("{path}.dabs[{index}].radius"),
                )?;
                let _ = dab.erase;
            }
        }
        "linearGradient" => {
            let component: LinearGradientComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            for (name, sample) in [
                ("x1", component.x1),
                ("y1", component.y1),
                ("x2", component.x2),
                ("y2", component.y2),
            ] {
                range(sample, 0.0, 1.0, &format!("{path}.{name}"))?;
            }
            if component.kind != "linearGradient"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
                || (component.x1 == component.x2 && component.y1 == component.y2)
            {
                return Err(err(format!("invalid {path}")));
            }
        }
        "radialGradient" => {
            let component: RadialGradientComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            for (name, sample) in [
                ("cx", component.cx),
                ("cy", component.cy),
                ("feather", component.feather),
            ] {
                range(sample, 0.0, 1.0, &format!("{path}.{name}"))?;
            }
            range(component.rx, f64::MIN_POSITIVE, 2.0, &format!("{path}.rx"))?;
            range(component.ry, f64::MIN_POSITIVE, 2.0, &format!("{path}.ry"))?;
            range(
                component.angle,
                -std::f64::consts::TAU,
                std::f64::consts::TAU,
                &format!("{path}.angle"),
            )?;
            if component.kind != "radialGradient"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
            {
                return Err(err(format!("invalid {path}")));
            }
        }
        "rangeColor" => {
            let component: ColorRangeComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            if component.kind != "rangeColor"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
                || component.samples.is_empty()
                || component.samples.len() > 32
            {
                return Err(err(format!("invalid {path}")));
            }
            range(component.refine, 0.0, 1.0, &format!("{path}.refine"))?;
            for (index, sample) in component.samples.iter().enumerate() {
                for (name, channel) in [("r", sample.r), ("g", sample.g), ("b", sample.b)] {
                    range(
                        channel,
                        0.0,
                        1.0,
                        &format!("{path}.samples[{index}].{name}"),
                    )?;
                }
            }
        }
        "rangeLuminance" => {
            let component: LuminanceRangeComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            range(component.min, 0.0, 1.0, &format!("{path}.min"))?;
            range(component.max, 0.0, 1.0, &format!("{path}.max"))?;
            range(
                component.smoothness,
                0.0,
                1.0,
                &format!("{path}.smoothness"),
            )?;
            if component.kind != "rangeLuminance"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
                || component.min > component.max
            {
                return Err(err(format!("invalid {path}")));
            }
        }
        "rangeDepth" => {
            let component: DepthRangeComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            range(component.near, 0.0, 1.0, &format!("{path}.near"))?;
            range(component.far, 0.0, 1.0, &format!("{path}.far"))?;
            if let Some(smoothness) = component.smoothness {
                range(smoothness, 0.0, 1.0, &format!("{path}.smoothness"))?;
            }
            if component.kind != "rangeDepth"
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
                || component.near > component.far
            {
                return Err(err(format!("invalid {path}")));
            }
        }
        "aiSubject" | "aiSky" | "aiBackground" | "aiObjects" | "aiPeople" | "aiLandscape" => {
            let component: AiComponent =
                serde_json::from_value(value.clone()).map_err(|e| err(format!("{path}: {e}")))?;
            nonempty(&component.model, &format!("{path}.model"))?;
            if let Some(cache_id) = &component.cache_id {
                id(cache_id, &format!("{path}.cacheId"))?;
            }
            if component.kind != base.kind
                || component.id != base.id
                || component.combine != base.combine
                || component.invert != base.invert
            {
                return Err(err(format!("invalid {path}")));
            }
        }
        _ => return Err(err(format!("invalid {path}.kind"))),
    }
    Ok(())
}

fn validate_recipe(value: &Value) -> Result<(), RecipeError> {
    let recipe: Recipe =
        serde_json::from_value(value.clone()).map_err(|e| err(format!("invalid recipe: {e}")))?;
    if recipe.version != 2 {
        return Err(err("unsupported recipe version"));
    }
    if recipe.process_version != PROCESS_VERSION {
        return Err(err("unsupported process version"));
    }
    match recipe.raw_decode.mode.as_str() {
        "asShot"
            if recipe.raw_decode.x.is_none()
                && recipe.raw_decode.y.is_none()
                && recipe.raw_decode.derivation_digest.is_none() => {}
        "neutralChromaticity" => {
            let x = recipe
                .raw_decode
                .x
                .ok_or_else(|| err("missing rawDecode.x"))?;
            let y = recipe
                .raw_decode
                .y
                .ok_or_else(|| err("missing rawDecode.y"))?;
            range(x, f64::MIN_POSITIVE, 1.0, "rawDecode.x")?;
            range(y, f64::MIN_POSITIVE, 1.0, "rawDecode.y")?;
            if x + y >= 1.0 {
                return Err(err("invalid neutral chromaticity"));
            }
            digest(
                recipe
                    .raw_decode
                    .derivation_digest
                    .as_deref()
                    .ok_or_else(|| err("missing rawDecode.derivationDigest"))?,
                "rawDecode.derivationDigest",
            )?;
        }
        _ => return Err(err("invalid rawDecode mode or fields")),
    }

    if let Some(id) = &recipe.profile.id {
        nonempty(id, "profile.id")?;
    }
    nonempty(&recipe.profile.name, "profile.name")?;
    nonempty(&recipe.profile.group, "profile.group")?;
    range(recipe.profile.amount, 0.0, 2.0, "profile.amount")?;
    if let Some(digest) = &recipe.profile.digest {
        if digest.len() != 32 || !digest.bytes().all(|b| b.is_ascii_digit() || (b'A'..=b'F').contains(&b)) {
            return Err(err("profile.digest must be 32 uppercase hex digits"));
        }
    }
    if let Some(kelvin) = recipe.profile.as_shot_kelvin {
        range(kelvin, 1000.0, 100_000.0, "profile.asShotKelvin")?;
    }
    if let Some(source) = &recipe.profile.source_camera {
        if source.camera_to_xyz.len() != 9 || source.white_balance.len() != 3 {
            return Err(err("profile.sourceCamera needs a 3x3 matrix and three WB gains"));
        }
        for v in &source.camera_to_xyz { range(*v, -1000.0, 1000.0, "profile.sourceCamera.cameraToXyz")?; }
        for v in &source.white_balance {
            range(*v, f64::MIN_POSITIVE, 1_000_000.0, "profile.sourceCamera.whiteBalance")?;
        }
        let m = &source.camera_to_xyz;
        let det = m[0] * (m[4] * m[8] - m[5] * m[7]) - m[1] * (m[3] * m[8] - m[5] * m[6]) + m[2] * (m[3] * m[7] - m[4] * m[6]);
        if det.abs() <= 1e-12 { return Err(err("profile.sourceCamera matrix is singular")); }
    }
    for (name, coordinate) in [
        ("top", recipe.crop.rect.top),
        ("left", recipe.crop.rect.left),
        ("bottom", recipe.crop.rect.bottom),
        ("right", recipe.crop.rect.right),
    ] {
        range(coordinate, 0.0, 1.0, &format!("crop.rect.{name}"))?;
    }
    if recipe.crop.rect.top >= recipe.crop.rect.bottom
        || recipe.crop.rect.left >= recipe.crop.rect.right
    {
        return Err(err("invalid crop geometry"));
    }
    range(recipe.crop.angle, -180.0, 180.0, "crop.angle")?;
    if !(1..=8).contains(&recipe.crop.orientation) {
        return Err(err("invalid crop orientation"));
    }
    if let Some(aspect) = recipe.crop.constrain_aspect {
        range(aspect, f64::MIN_POSITIVE, 1000.0, "crop.constrainAspect")?;
    }

    one_of(
        &recipe.basic.wb_mode,
        &["asShot", "auto", "custom"],
        "basic.wbMode",
    )?;
    range(recipe.basic.exposure, -20.0, 20.0, "basic.exposure")?;
    for (name, value) in [
        ("temp", recipe.basic.temp),
        ("tint", recipe.basic.tint),
        ("contrast", recipe.basic.contrast),
        ("highlights", recipe.basic.highlights),
        ("shadows", recipe.basic.shadows),
        ("whites", recipe.basic.whites),
        ("blacks", recipe.basic.blacks),
        ("texture", recipe.basic.texture),
        ("clarity", recipe.basic.clarity),
        ("dehaze", recipe.basic.dehaze),
        ("vibrance", recipe.basic.vibrance),
        ("saturation", recipe.basic.saturation),
    ] {
        range(value, -100.0, 100.0, &format!("basic.{name}"))?;
    }

    for (name, value) in [
        ("highlights", recipe.tone_curve.parametric.highlights),
        ("lights", recipe.tone_curve.parametric.lights),
        ("darks", recipe.tone_curve.parametric.darks),
        ("shadows", recipe.tone_curve.parametric.shadows),
    ] {
        range(
            value,
            -100.0,
            100.0,
            &format!("toneCurve.parametric.{name}"),
        )?;
    }
    let splits = recipe.tone_curve.parametric_splits;
    for (index, split) in splits.iter().enumerate() {
        range(
            *split,
            0.0,
            1.0,
            &format!("toneCurve.parametricSplits[{index}]"),
        )?;
    }
    if !(splits[0] < splits[1] && splits[1] < splits[2]) {
        return Err(err("toneCurve.parametricSplits must be ordered"));
    }
    for (name, points) in [
        ("point", &recipe.tone_curve.point),
        ("red", &recipe.tone_curve.red),
        ("green", &recipe.tone_curve.green),
        ("blue", &recipe.tone_curve.blue),
    ] {
        validate_points(points, &format!("toneCurve.{name}"))?;
    }
    let _ = recipe.tone_curve.target_adjust;

    one_of(
        &recipe.color_mixer.mode,
        &["hsl", "color", "bw"],
        "colorMixer.mode",
    )?;
    for (name, values) in [
        ("hue", recipe.color_mixer.hue),
        ("saturation", recipe.color_mixer.saturation),
        ("luminance", recipe.color_mixer.luminance),
        ("gray", recipe.color_mixer.gray),
    ] {
        for (index, value) in values.iter().enumerate() {
            range(
                *value,
                -100.0,
                100.0,
                &format!("colorMixer.{name}[{index}]"),
            )?;
        }
    }
    let _ = recipe.color_mixer.target_adjust;

    if recipe.point_color.samples.len() > 256 {
        return Err(err("pointColor.samples exceeds checked-size limit"));
    }
    for (index, sample) in recipe.point_color.samples.iter().enumerate() {
        range(
            sample.src_hue,
            0.0,
            360.0,
            &format!("pointColor.samples[{index}].srcHue"),
        )?;
        range(
            sample.src_sat,
            0.0,
            1.0,
            &format!("pointColor.samples[{index}].srcSat"),
        )?;
        range(
            sample.src_lum,
            0.0,
            1.0,
            &format!("pointColor.samples[{index}].srcLum"),
        )?;
        range(
            sample.hue,
            -180.0,
            180.0,
            &format!("pointColor.samples[{index}].hue"),
        )?;
        range(
            sample.sat,
            -100.0,
            100.0,
            &format!("pointColor.samples[{index}].sat"),
        )?;
        range(
            sample.lum,
            -100.0,
            100.0,
            &format!("pointColor.samples[{index}].lum"),
        )?;
        range(
            sample.range,
            0.0,
            1.0,
            &format!("pointColor.samples[{index}].range"),
        )?;
    }

    if let Some(heal) = &recipe.heal {
        // The engine renders at most DEV_MAX_HEALS = 64 spots per recipe.
        if heal.spots.len() > 64 {
            return Err(err("heal.spots exceeds checked-size limit"));
        }
        for (index, spot) in heal.spots.iter().enumerate() {
            if spot.mode != "heal" && spot.mode != "clone" {
                return Err(err(format!(
                    "heal.spots[{index}].mode must be \"heal\" or \"clone\""
                )));
            }
            range(spot.x, 0.0, 1.0, &format!("heal.spots[{index}].x"))?;
            range(spot.y, 0.0, 1.0, &format!("heal.spots[{index}].y"))?;
            range(
                spot.source_x,
                0.0,
                1.0,
                &format!("heal.spots[{index}].sourceX"),
            )?;
            range(
                spot.source_y,
                0.0,
                1.0,
                &format!("heal.spots[{index}].sourceY"),
            )?;
            range(spot.radius, 0.0, 1.0, &format!("heal.spots[{index}].radius"))?;
            range(
                spot.feather,
                0.0,
                1.0,
                &format!("heal.spots[{index}].feather"),
            )?;
            range(
                spot.opacity,
                0.0,
                1.0,
                &format!("heal.spots[{index}].opacity"),
            )?;
        }
    }

    for (name, wheel) in [
        ("shadows", &recipe.color_grading.shadows),
        ("midtones", &recipe.color_grading.midtones),
        ("highlights", &recipe.color_grading.highlights),
        ("global", &recipe.color_grading.global),
    ] {
        range(wheel.hue, 0.0, 360.0, &format!("colorGrading.{name}.hue"))?;
        range(wheel.sat, 0.0, 100.0, &format!("colorGrading.{name}.sat"))?;
        range(
            wheel.lum,
            -100.0,
            100.0,
            &format!("colorGrading.{name}.lum"),
        )?;
    }
    range(
        recipe.color_grading.blending,
        0.0,
        100.0,
        "colorGrading.blending",
    )?;
    range(
        recipe.color_grading.balance,
        -100.0,
        100.0,
        "colorGrading.balance",
    )?;

    for (name, value) in [
        ("sharpenAmount", recipe.detail.sharpen_amount),
        ("sharpenDetail", recipe.detail.sharpen_detail),
        ("sharpenMasking", recipe.detail.sharpen_masking),
        ("nrLuminance", recipe.detail.nr_luminance),
        ("nrLuminanceDetail", recipe.detail.nr_luminance_detail),
        ("nrLuminanceContrast", recipe.detail.nr_luminance_contrast),
        ("nrColor", recipe.detail.nr_color),
        ("nrColorDetail", recipe.detail.nr_color_detail),
        ("nrColorSmoothness", recipe.detail.nr_color_smoothness),
    ] {
        range(value, 0.0, 100.0, &format!("detail.{name}"))?;
    }
    range(
        recipe.detail.sharpen_radius,
        0.0,
        5.0,
        "detail.sharpenRadius",
    )?;

    if let Some(profile_name) = &recipe.optics.profile_name {
        nonempty(profile_name, "optics.profileName")?;
    }
    let lens_id = |id: &str| -> Result<(), RecipeError> {
        if id.len() == 32 && id.bytes().all(|b| b.is_ascii_hexdigit()) { Ok(()) }
        else { Err(err("lens profile identity must be 32 hex digits")) }
    };
    if let Some(id) = &recipe.optics.profile_id { lens_id(id)?; }
    for v in [recipe.optics.profile_distortion_amount, recipe.optics.profile_vignetting_amount].into_iter().flatten() {
        range(v, 0.0, 2.0, "lens profile amount")?;
    }
    for v in [recipe.optics.profile_focal_length_mm, recipe.optics.profile_aperture, recipe.optics.profile_crop_factor].into_iter().flatten() {
        range(v, f64::MIN_POSITIVE, 1_000_000.0, "lens capture override")?;
    }
    if let Some(c) = &recipe.optics.profile_calibration {
        lens_id(&c.profile_id)?;
        for v in c.distortion.iter().chain(&c.red).chain(&c.blue).chain(&c.vignette) {
            range(*v, -1000.0, 1000.0, "lens calibration coefficient")?;
        }
    }
    for (name, value) in [
        ("distortionAmount", recipe.optics.distortion_amount),
        ("vignettingAmount", recipe.optics.vignetting_amount),
        ("defringePurpleAmount", recipe.optics.defringe_purple_amount),
        ("defringeGreenAmount", recipe.optics.defringe_green_amount),
    ] {
        range(value, -100.0, 100.0, &format!("optics.{name}"))?;
    }
    for (name, hues) in [
        ("defringePurpleHue", recipe.optics.defringe_purple_hue),
        ("defringeGreenHue", recipe.optics.defringe_green_hue),
    ] {
        range(hues[0], 0.0, 360.0, &format!("optics.{name}[0]"))?;
        range(hues[1], 0.0, 360.0, &format!("optics.{name}[1]"))?;
        if hues[0] > hues[1] {
            return Err(err(format!("optics.{name} must be ordered")));
        }
    }
    let _ = (
        recipe.optics.aberration,
        recipe.optics.remove_chromatic_aberration,
        recipe.optics.enable_profile_corrections,
    );

    one_of(
        &recipe.transform.upright,
        &["off", "auto", "level", "vertical", "full", "guided"],
        "transform.upright",
    )?;
    for (name, value) in [
        ("vertical", recipe.transform.vertical),
        ("horizontal", recipe.transform.horizontal),
        ("xOffset", recipe.transform.x_offset),
        ("yOffset", recipe.transform.y_offset),
        ("aspect", recipe.transform.aspect),
    ] {
        range(value, -100.0, 100.0, &format!("transform.{name}"))?;
    }
    range(recipe.transform.rotate, -180.0, 180.0, "transform.rotate")?;
    range(recipe.transform.scale, 0.01, 10.0, "transform.scale")?;

    for (name, value, min, max) in [
        (
            "vignetteAmount",
            recipe.effects.vignette_amount,
            -100.0,
            100.0,
        ),
        (
            "vignetteMidpoint",
            recipe.effects.vignette_midpoint,
            0.0,
            100.0,
        ),
        (
            "vignetteRoundness",
            recipe.effects.vignette_roundness,
            -100.0,
            100.0,
        ),
        (
            "vignetteFeather",
            recipe.effects.vignette_feather,
            0.0,
            100.0,
        ),
        (
            "vignetteHighlights",
            recipe.effects.vignette_highlights,
            0.0,
            100.0,
        ),
        ("grainAmount", recipe.effects.grain_amount, 0.0, 100.0),
        ("grainSize", recipe.effects.grain_size, 0.0, 100.0),
        ("grainRoughness", recipe.effects.grain_roughness, 0.0, 100.0),
    ] {
        range(value, min, max, &format!("effects.{name}"))?;
    }
    for (name, value) in [
        ("shadowTint", recipe.calibration.shadow_tint),
        ("redHue", recipe.calibration.red_hue),
        ("redSat", recipe.calibration.red_sat),
        ("greenHue", recipe.calibration.green_hue),
        ("greenSat", recipe.calibration.green_sat),
        ("blueHue", recipe.calibration.blue_hue),
        ("blueSat", recipe.calibration.blue_sat),
    ] {
        range(value, -100.0, 100.0, &format!("calibration.{name}"))?;
    }
    let _ = recipe.hdr.enabled;
    let _ = (
        recipe.enabled.basic,
        recipe.enabled.tone_curve,
        recipe.enabled.color_mixer,
        recipe.enabled.point_color,
        recipe.enabled.color_grading,
        recipe.enabled.detail,
        recipe.enabled.optics,
        recipe.enabled.transform,
        recipe.enabled.effects,
        recipe.enabled.calibration,
    );

    if recipe.masks.masks.len() > 10_000 {
        return Err(err("mask graph exceeds checked-size limit"));
    }
    let mut ids = HashSet::new();
    for (mask_index, mask) in recipe.masks.masks.iter().enumerate() {
        let path = format!("masks.masks[{mask_index}]");
        id(&mask.id, &format!("{path}.id"))?;
        if !ids.insert(mask.id.clone()) {
            return Err(err(format!("duplicate mask/component id {}", mask.id)));
        }
        nonempty(&mask.name, &format!("{path}.name"))?;
        range(mask.opacity, 0.0, 1.0, &format!("{path}.opacity"))?;
        if mask.components.is_empty() || mask.components.len() > 100_000 {
            return Err(err(format!("{path}.components has invalid length")));
        }
        for (component_index, component) in mask.components.iter().enumerate() {
            validate_component(
                component,
                &format!("{path}.components[{component_index}]"),
                &mut ids,
            )?;
        }
        validate_local(&mask.adjustments, &format!("{path}.adjustments"))?;
        let _ = (mask.enabled, mask.inverted);
    }

    nonempty(&recipe.metadata.created_with, "metadata.createdWith")?;
    if recipe.metadata.model_versions.len() > 10_000 {
        return Err(err("metadata.modelVersions exceeds checked-size limit"));
    }
    for (model, version) in &recipe.metadata.model_versions {
        id(model, "metadata.modelVersions key")?;
        nonempty(version, &format!("metadata.modelVersions.{model}"))?;
    }
    Ok(())
}

pub fn parse_recipe_json(bytes: impl AsRef<[u8]>) -> Result<DevelopRecipeV2, RecipeError> {
    let value: Value = serde_json::from_slice(bytes.as_ref()).map_err(|e| err(e.to_string()))?;
    validate_recipe(&value)?;
    Ok(DevelopRecipeV2(value))
}

fn sorted(value: &Value) -> Value {
    match value {
        Value::Object(object) => {
            let mut entries: Vec<_> = object.iter().collect();
            entries.sort_by(|a, b| a.0.cmp(b.0));
            Value::Object(
                entries
                    .into_iter()
                    .map(|(key, value)| (key.clone(), sorted(value)))
                    .collect(),
            )
        }
        Value::Array(array) => Value::Array(array.iter().map(sorted).collect()),
        Value::Number(number) if number.as_f64() == Some(0.0) => json!(0),
        _ => value.clone(),
    }
}

pub fn canonical_recipe_json(recipe: &DevelopRecipeV2) -> Result<Vec<u8>, RecipeError> {
    validate_recipe(recipe.value())?;
    serde_json::to_vec(&sorted(recipe.value())).map_err(|e| err(e.to_string()))
}

pub fn recipe_digest(recipe: &DevelopRecipeV2) -> Result<RecipeDigest, RecipeError> {
    Ok(RecipeDigest(
        Sha256::digest(canonical_recipe_json(recipe)?).into(),
    ))
}

pub fn raw_decode_intent_digest(value: &Value) -> Result<RecipeDigest, RecipeError> {
    let mut value = value.clone();
    if let Some(object) = value.as_object_mut() {
        object.retain(|_, value| !value.is_null());
    }
    let default = legacy_params_v1_to_recipe(&[])?;
    let mut root = default
        .value()
        .as_object()
        .ok_or_else(|| err("default recipe is not an object"))?
        .clone();
    root.insert("rawDecode".into(), value);
    let recipe = parse_recipe_json(
        serde_json::to_vec(&Value::Object(root)).map_err(|error| err(error.to_string()))?,
    )?;
    let canonical: Value = serde_json::from_slice(&canonical_recipe_json(&recipe)?)
        .map_err(|error| err(error.to_string()))?;
    Ok(RecipeDigest(
        Sha256::digest(
            serde_json::to_vec(&canonical["rawDecode"]).map_err(|error| err(error.to_string()))?,
        )
        .into(),
    ))
}

fn point_curve(params: &[f32], base: usize) -> Value {
    Value::Array(
        (0..256)
            .map(|i| json!({"x": i as f64 / 255.0, "y": params[base + i] as f64 / 255.0}))
            .collect(),
    )
}

pub fn legacy_params_v1_to_recipe(params: &[f32]) -> Result<DevelopRecipeV2, RecipeError> {
    if params.len() > PARAMS_LEN || params.iter().any(|v| !v.is_finite()) {
        return Err(err("legacy recipe must contain at most 1086 finite floats"));
    }
    if params.first().copied().unwrap_or(1.0) != 1.0 {
        return Err(err("unsupported legacy parameter version"));
    }
    let mut padded = vec![0.0; PARAMS_LEN];
    padded[..params.len()].copy_from_slice(params);
    if params.len() < 2 {
        padded[1] = 1.0;
    }
    let params = padded.as_slice();
    let band = |base: usize| Value::Array((0..8).map(|i| json!(params[base + i])).collect());
    let mut root = Map::new();
    root.insert("version".into(), json!(2));
    root.insert("processVersion".into(), json!(6));
    root.insert("rawDecode".into(), json!({"mode":"asShot"}));
    root.insert(
        "profile".into(),
        json!({"name":"Default","group":"Monet","amount":1.0}),
    );
    root.insert("crop".into(), json!({"rect":{"top":0.0,"left":0.0,"bottom":1.0,"right":1.0},"angle":0.0,"orientation":1,"constrainAspect":null}));
    root.insert("basic".into(), json!({"wbMode":"asShot","temp":params[2],"tint":params[3],"exposure":params[4],"contrast":params[5],"highlights":params[6],"shadows":params[7],"whites":params[8],"blacks":params[9],"texture":params[10],"clarity":params[11],"dehaze":params[12],"vibrance":params[13],"saturation":params[14]}));
    root.insert("toneCurve".into(), json!({"parametric":{"highlights":0.0,"lights":0.0,"darks":0.0,"shadows":0.0},"parametricSplits":[0.25,0.5,0.75],"point":point_curve(params,26),"red":point_curve(params,282),"green":point_curve(params,538),"blue":point_curve(params,794),"targetAdjust":false}));
    root.insert("colorMixer".into(), json!({"mode":"hsl","hue":band(1053),"saturation":band(1061),"luminance":band(1069),"gray":[0,0,0,0,0,0,0,0],"targetAdjust":false}));
    root.insert("pointColor".into(), json!({"samples":[]}));
    root.insert("heal".into(), json!({"spots":[]}));
    root.insert("colorGrading".into(), json!({"shadows":{"hue":params[1077],"sat":params[1078],"lum":0.0},"midtones":{"hue":params[1079],"sat":params[1080],"lum":0.0},"highlights":{"hue":params[1081],"sat":params[1082],"lum":0.0},"global":{"hue":0.0,"sat":0.0,"lum":0.0},"blending":50.0,"balance":0.0}));
    root.insert("detail".into(), json!({"sharpenAmount":params[15],"sharpenRadius":params[16],"sharpenDetail":25.0,"sharpenMasking":0.0,"nrLuminance":params[17],"nrLuminanceDetail":params[19],"nrLuminanceContrast":0.0,"nrColor":params[18],"nrColorDetail":50.0,"nrColorSmoothness":50.0}));
    root.insert("optics".into(), json!({"aberration":params[1051],"enableProfileCorrections":false,"profileName":null,"distortionAmount":params[1050],"vignettingAmount":0.0,"defringePurpleAmount":params[1052],"defringePurpleHue":[30.0,70.0],"defringeGreenAmount":0.0,"defringeGreenHue":[40.0,60.0]}));
    root.insert("transform".into(), json!({"upright":"off","vertical":params[1083],"horizontal":params[1084],"rotate":params[1085],"scale":1.0,"xOffset":0.0,"yOffset":0.0,"aspect":0.0}));
    root.insert("effects".into(), json!({"vignetteAmount":params[23],"vignetteMidpoint":params[24],"vignetteRoundness":0.0,"vignetteFeather":50.0,"vignetteHighlights":0.0,"grainAmount":params[20],"grainSize":params[22],"grainRoughness":params[21]}));
    root.insert("calibration".into(), json!({"shadowTint":0.0,"redHue":0.0,"redSat":0.0,"greenHue":0.0,"greenSat":0.0,"blueHue":0.0,"blueSat":0.0}));
    root.insert("hdr".into(), json!({"enabled":false}));
    root.insert("enabled".into(), json!({"basic":true,"toneCurve":params[25] >= 0.5,"colorMixer":true,"pointColor":true,"colorGrading":true,"detail":true,"optics":true,"transform":true,"effects":true,"calibration":true}));
    root.insert("masks".into(), json!({"masks":[]}));
    root.insert(
        "metadata".into(),
        json!({"createdWith":"monet-develop-core/1","modelVersions":{}}),
    );
    parse_recipe_json(serde_json::to_vec(&Value::Object(root)).map_err(|e| err(e.to_string()))?)
}

pub(crate) fn get_f32(value: &Value, path: &[&str]) -> f32 {
    path.iter()
        .try_fold(value, |value, key| value.get(*key))
        .and_then(Value::as_f64)
        .unwrap_or(0.0) as f32
}

#[cfg(test)]
mod tests {
    use super::*;

    fn neutral() -> Vec<f32> {
        let mut p = vec![0.0; PARAMS_LEN];
        p[0] = 1.0;
        p[1] = 1.0;
        p[16] = 1.0;
        for channel in 0..4 {
            for i in 0..256 {
                p[26 + channel * 256 + i] = i as f32;
            }
        }
        p
    }

    #[test]
    fn legacy_conversion_is_deterministic_and_canonical() {
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        assert_eq!(
            canonical_recipe_json(&recipe).unwrap(),
            canonical_recipe_json(&recipe).unwrap()
        );
        assert_eq!(
            recipe_digest(&recipe).unwrap(),
            recipe_digest(&recipe).unwrap()
        );
    }

    #[test]
    fn rejects_full_contract_failures() {
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        for mutate in [
            ("unsupported process", "/processVersion", json!(5)),
            ("string exposure", "/basic/exposure", json!("1")),
            (
                "non-string model version",
                "/metadata/modelVersions/model",
                json!(1),
            ),
            ("unknown root field", "/unexpected", json!(true)),
            ("unknown nested field", "/basic/unexpected", json!(true)),
            (
                "malformed point color",
                "/pointColor/samples/0",
                json!({"srcHue":0}),
            ),
        ] {
            let mut value = recipe.value().clone();
            let (label, pointer, replacement) = mutate;
            if pointer == "/metadata/modelVersions/model" {
                value["metadata"]["modelVersions"]["model"] = replacement;
            } else if pointer == "/unexpected" {
                value["unexpected"] = replacement;
            } else if pointer == "/basic/unexpected" {
                value["basic"]["unexpected"] = replacement;
            } else if pointer == "/pointColor/samples/0" {
                value["pointColor"]["samples"] = json!([replacement]);
            } else {
                *value.pointer_mut(pointer).unwrap() = replacement;
            }
            assert!(
                parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err(),
                "{label}"
            );
        }

        let mut value = recipe.value().clone();
        value["masks"] = json!({"masks":[{
            "id":"mask","name":"Mask","enabled":true,"inverted":false,"opacity":1,
            "components":[{"id":"component","kind":"linearGradient","combine":"bad","invert":false,"x1":0,"y1":0,"x2":1,"y2":1}],
            "adjustments":{"exposure":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"texture":0,"clarity":0,"dehaze":0,"saturation":0,"temp":0,"tint":0,"sharpness":0,"noise":0,"moire":0,"defringe":0}
        }]});
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn depth_range_component_smoothness_is_optional_and_range_checked() {
        // `smoothness` arrived after rangeDepth shipped, so a graph without it
        // must still parse (deny_unknown_fields also means one WITH it only
        // parses because the field is declared).
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        let with_depth = |component: Value| {
            let mut value = recipe.value().clone();
            value["masks"] = json!({"masks":[{
                "id":"mask","name":"Depth 1","enabled":true,"inverted":false,"opacity":1,
                "components":[component],
                "adjustments":{"exposure":0,"contrast":0,"highlights":0,"shadows":0,"whites":0,"blacks":0,"texture":0,"clarity":0,"dehaze":0,"saturation":0,"temp":0,"tint":0,"sharpness":0,"noise":0,"moire":0,"defringe":0}
            }]});
            parse_recipe_json(serde_json::to_vec(&value).unwrap())
        };
        let base = json!({"id":"c","kind":"rangeDepth","combine":"add","invert":false,"near":0.0,"far":0.5});
        assert!(with_depth(base.clone()).is_ok(), "legacy graph without smoothness");
        let mut smoothed = base.clone();
        smoothed["smoothness"] = json!(0.5);
        assert!(with_depth(smoothed).is_ok(), "graph with smoothness");
        for (label, bad) in [("above 1", json!(1.5)), ("negative", json!(-0.1)), ("not a number", json!("0.5"))] {
            let mut value = base.clone();
            value["smoothness"] = bad;
            assert!(with_depth(value).is_err(), "smoothness {label}");
        }
        let mut inverted = base.clone();
        inverted["near"] = json!(0.8); // near > far stays rejected
        assert!(with_depth(inverted).is_err(), "near > far");
    }

    #[test]
    fn canonical_json_normalizes_negative_zero() {
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        let mut value = recipe.value().clone();
        value["basic"]["exposure"] = json!(-0.0);
        let recipe = parse_recipe_json(serde_json::to_vec(&value).unwrap()).unwrap();
        let canonical = String::from_utf8(canonical_recipe_json(&recipe).unwrap()).unwrap();
        assert!(!canonical.contains("-0.0"));
        assert!(!canonical.contains("-0,"));
    }

    #[test]
    fn legacy_remove_chromatic_aberration_still_parses_and_migrates() {
        // OLD recipes carry the boolean `removeChromaticAberration`, not the new
        // continuous `aberration`. Under deny_unknown_fields they must still parse,
        // and the params builder must migrate true → 1.0 at p[1051].
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        let mut value = recipe.value().clone();
        value["optics"]
            .as_object_mut()
            .unwrap()
            .remove("aberration");
        value["optics"]["removeChromaticAberration"] = json!(true);
        let parsed = parse_recipe_json(serde_json::to_vec(&value).unwrap()).unwrap();
        let params = crate::develop::recipe_to_legacy_params(&parsed, 1.0);
        assert_eq!(params[1051], 1.0);
    }

    #[test]
    fn a_dcp_profile_selection_parses_and_a_bad_digest_is_refused() {
        // #446: Vision writes profile.digest for embedded/custom DNG profiles.
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        let mut value = recipe.value().clone();
        value["profile"] = json!({
            "id": "custom", "name": "Studio", "group": "Camera Matching", "amount": 1.0,
            "digest": "0123456789ABCDEF0123456789ABCDEF", "asShotKelvin": 2850.0,
        });
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_ok());
        value["profile"]["sourceCamera"] = json!({
            "cameraToXyz": [1,0,0,0,1,0,0,0,1], "whiteBalance": [2,1,1.5],
        });
        let parsed = parse_recipe_json(serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(parsed.value()["profile"]["sourceCamera"], value["profile"]["sourceCamera"]);
        value["profile"]["sourceCamera"]["whiteBalance"][1] = json!(0);
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err());
        value["profile"]["sourceCamera"]["whiteBalance"][1] = json!(1);
        value["profile"]["sourceCamera"]["cameraToXyz"] = json!(vec![0; 9]);
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err());
        value["profile"].as_object_mut().unwrap().remove("sourceCamera");
        value["profile"]["digest"] = json!("not-a-digest");
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn lens_profile_selection_and_calibration_validate_without_rewriting_the_snapshot() {
        let recipe = legacy_params_v1_to_recipe(&neutral()).unwrap();
        let mut value = recipe.value().clone();
        let optics = value["optics"].as_object_mut().unwrap();
        optics.insert("enableProfileCorrections".into(), json!(false));
        optics.insert("profileName".into(), json!("Published rectilinear profile"));
        optics.insert("profileId".into(), json!("0123456789abcdef0123456789abcdef"));
        optics.insert("profileDistortionAmount".into(), json!(1.5));
        optics.insert("profileVignettingAmount".into(), json!(0.5));
        optics.insert("profileFocalLengthMm".into(), json!(35));
        optics.insert("profileAperture".into(), json!(4));
        optics.insert("profileCropFactor".into(), json!(1.5));
        optics.insert("profileCalibration".into(), json!({
            "profileId":"0123456789abcdef0123456789abcdef", "distortion":[0,-0.02,0,0],
            "red":[1.001,0,0], "blue":[0.999,0,0], "vignette":[-0.2,0,0],
        }));
        let parsed = parse_recipe_json(serde_json::to_vec(&value).unwrap()).unwrap();
        assert_eq!(parsed.value()["optics"], value["optics"]);
        value["optics"]["profileCalibration"]["red"] = json!([1]);
        assert!(parse_recipe_json(serde_json::to_vec(&value).unwrap()).is_err());
    }

    #[test]
    fn shared_typescript_fixture_matches_pinned_canonical_bytes_and_digest() {
        let fixture: Value = serde_json::from_str(include_str!(
            "../../../../monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
        ))
        .unwrap();
        let recipe = parse_recipe_json(serde_json::to_vec(&fixture["recipe"]).unwrap()).unwrap();
        let expected = fixture["canonicalJson"].as_str().unwrap().as_bytes();
        let actual = canonical_recipe_json(&recipe).unwrap();
        assert_eq!(actual, expected);
        let hex = Sha256::digest(expected)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect::<String>();
        assert_eq!(hex, fixture["sha256"].as_str().unwrap());
        assert_eq!(
            recipe_digest(&recipe).unwrap().0.as_slice(),
            Sha256::digest(expected).as_slice()
        );
    }
}
