use crate::{
    color::encode_linear_srgb_rgba16, recipe::get_f32, CoverageView, DevelopFrame, DevelopRecipeV2,
    PixelEncoding,
};

pub struct RenderContext<'a> {
    pub scale_numerator: u32,
    pub scale_denominator: u32,
    pub coverage: CoverageView<'a>,
}

pub fn validate_develop_scale(numerator: u32, denominator: u32) -> Result<(), &'static str> {
    if numerator == 0 || denominator == 0 {
        return Err("develop scale must be a positive exact rational");
    }
    Ok(())
}

pub struct ScratchArena {
    frame: Vec<u16>,
}

impl Default for ScratchArena {
    fn default() -> Self {
        Self { frame: Vec::new() }
    }
}

impl ScratchArena {
    fn prepare(&mut self, samples: usize) {
        self.frame.resize(samples, 0);
    }

    pub fn allocated_samples(&self) -> usize {
        self.frame.len()
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct RenderReport {
    pub process_version: u64,
    pub stages: usize,
}

fn curve_lut(points: &serde_json::Value) -> [f32; 256] {
    let mut out = [0.0; 256];
    let points = points.as_array().expect("validated curve");
    let mut segment = 0;
    for (i, slot) in out.iter_mut().enumerate() {
        let x = i as f64 / 255.0;
        while segment + 1 < points.len() - 1 && points[segment + 1]["x"].as_f64().unwrap() < x {
            segment += 1;
        }
        let a = &points[segment];
        let b = &points[segment + 1];
        let ax = a["x"].as_f64().unwrap();
        let bx = b["x"].as_f64().unwrap();
        let t = if bx == ax { 0.0 } else { (x - ax) / (bx - ax) };
        *slot = ((a["y"].as_f64().unwrap()
            + (b["y"].as_f64().unwrap() - a["y"].as_f64().unwrap()) * t)
            * 255.0) as f32;
    }
    out
}

pub fn recipe_to_legacy_params(recipe: &DevelopRecipeV2, scale: f32) -> Vec<f32> {
    let r = recipe.value();
    let mut p = vec![0.0; 1086];
    p[0] = 1.0;
    p[1] = scale;
    for (i, key) in [
        "temp",
        "tint",
        "exposure",
        "contrast",
        "highlights",
        "shadows",
        "whites",
        "blacks",
        "texture",
        "clarity",
        "dehaze",
        "vibrance",
        "saturation",
    ]
    .iter()
    .enumerate()
    {
        p[2 + i] = get_f32(r, &["basic", key]);
    }
    for (i, key) in [
        "sharpenAmount",
        "sharpenRadius",
        "nrLuminance",
        "nrColor",
        "nrLuminanceDetail",
    ]
    .iter()
    .enumerate()
    {
        p[15 + i] = get_f32(r, &["detail", key]);
    }
    for (i, key) in [
        "grainAmount",
        "grainRoughness",
        "grainSize",
        "vignetteAmount",
        "vignetteMidpoint",
    ]
    .iter()
    .enumerate()
    {
        p[20 + i] = get_f32(r, &["effects", key]);
    }
    p[25] = r["enabled"]["toneCurve"].as_bool().unwrap_or(false) as u8 as f32;
    for (channel, key) in ["point", "red", "green", "blue"].iter().enumerate() {
        p[26 + channel * 256..26 + (channel + 1) * 256]
            .copy_from_slice(&curve_lut(&r["toneCurve"][key]));
    }
    p[1050] = get_f32(r, &["optics", "distortionAmount"]);
    // Continuous CA (p[1051] is continuous). `aberration` is canonical; fall back
    // to the legacy boolean for recipes serialized before it existed.
    p[1051] = r["optics"]["aberration"]
        .as_f64()
        .map(|v| v as f32)
        .unwrap_or_else(|| {
            r["optics"]["removeChromaticAberration"]
                .as_bool()
                .unwrap_or(false) as u8 as f32
        });
    p[1052] = get_f32(r, &["optics", "defringePurpleAmount"]);
    for (offset, key) in [(1053, "hue"), (1061, "saturation"), (1069, "luminance")] {
        for i in 0..8 {
            p[offset + i] = r["colorMixer"][key][i].as_f64().unwrap_or(0.0) as f32;
        }
    }
    for (offset, region) in [(1077, "shadows"), (1079, "midtones"), (1081, "highlights")] {
        p[offset] = get_f32(r, &["colorGrading", region, "hue"]);
        p[offset + 1] = get_f32(r, &["colorGrading", region, "sat"]);
    }
    for (offset, key) in [(1083, "vertical"), (1084, "horizontal"), (1085, "rotate")] {
        p[offset] = get_f32(r, &["transform", key]);
    }
    p
}

pub fn develop_in_place(
    frame: &mut DevelopFrame,
    recipe: &DevelopRecipeV2,
    context: &RenderContext<'_>,
    scratch: &mut ScratchArena,
) -> Result<RenderReport, &'static str> {
    develop_with_control(frame, recipe, context, scratch, |_| Ok(()))
}

pub fn develop_with_control(
    frame: &mut DevelopFrame,
    recipe: &DevelopRecipeV2,
    context: &RenderContext<'_>,
    scratch: &mut ScratchArena,
    mut checkpoint: impl FnMut(&'static str) -> Result<(), &'static str>,
) -> Result<RenderReport, &'static str> {
    context.coverage.validate()?;
    if context.coverage.width != frame.width || context.coverage.height != frame.height {
        return Err("coverage dimensions do not match frame");
    }
    validate_develop_scale(context.scale_numerator, context.scale_denominator)?;
    scratch.prepare(frame.pixels.len());
    checkpoint("encode")?;
    if frame.encoding == PixelEncoding::LinearSrgbU16Full {
        encode_linear_srgb_rgba16(&mut frame.pixels);
        frame.encoding = PixelEncoding::SrgbEncodedU16Full;
    }
    crate::develop_advanced::develop_profile_calibration(
        &mut frame.pixels,
        crate::develop_advanced::profile_from_recipe(recipe.value()),
    );
    let scale = context.scale_numerator as f32 / context.scale_denominator.max(1) as f32;
    // Point Color runs at wasm step 12.5 — AFTER color-grading, BEFORE geometry
    // — on the un-warped pixels. apply_bounded's LAST stage is geometry (slots
    // 1083..1086), so run it with geometry ZEROED (does exactly steps 1-12),
    // then apply Point Color, then geometry, then heal. Zero-then-run-after is
    // byte-identical to running geometry inside apply_bounded when no Point Color
    // is present, so the basic develop stays unperturbed.
    let params = recipe_to_legacy_params(recipe, scale);
    let (geo_v, geo_h, geo_rot) = (params[1083], params[1084], params[1085]);
    let mut params_no_geo = params;
    params_no_geo[1083] = 0.0;
    params_no_geo[1084] = 0.0;
    params_no_geo[1085] = 0.0;
    let stages = crate::kernels::apply_bounded(
        &mut frame.pixels,
        &mut scratch.frame,
        frame.width,
        frame.height,
        context.coverage,
        &params_no_geo,
        &mut checkpoint,
    )?;
    let point_colors = crate::develop_advanced::point_colors_from_recipe(recipe.value());
    if !point_colors.is_empty() {
        crate::develop_advanced::point_color(&mut frame.pixels, &point_colors);
    }
    // Geometry: keystone + straighten. Same neutral guard as wasm develop_buf's
    // step 13, relocated to run after Point Color. Uses the VERBATIM port of the
    // engine's geometry_keystone_buf (NOT kernels' bounded_geometry, which is
    // algebraically equal but diverges by 1 ULP) so the full-res export matches
    // the wasm preview bit-for-bit.
    if geo_v != 0.0 || geo_h != 0.0 || geo_rot != 0.0 {
        // Geometry used to checkpoint inside apply_bounded's gated stage; relocating
        // it (to run after Point Color) must keep that cancellation point for a
        // non-neutral transform. The neutral canonical fixture skips this, so the
        // checkpoint sequence the cancellation test pins is unchanged.
        checkpoint("geometry")?;
        crate::develop_advanced::geometry_keystone_buf(
            &mut frame.pixels,
            frame.width,
            frame.height,
            geo_v,
            geo_h,
            geo_rot,
        );
    }
    // Heal / clone-spot retouch. developParams.ts emits heal spots into the tail
    // but zeroes crop, so wasm always heals through a DISABLED crop_map — build
    // the same disabled map here so native full-res export matches bit-for-bit.
    let disabled_crop_map = crate::develop_advanced::DevelopCropMap::new(
        crate::develop_advanced::DevelopCrop {
            enabled: false,
            x: 0.0,
            y: 0.0,
            width: 1.0,
            height: 1.0,
            angle: 0.0,
            constrain_aspect: false,
            aspect_ratio: 1.0,
            flip_h: false,
            flip_v: false,
        },
        frame.width,
        frame.height,
    );
    crate::develop_advanced::develop_heal_spots(
        &mut frame.pixels,
        frame.width,
        frame.height,
        &crate::develop_advanced::heals_from_recipe(recipe.value()),
        disabled_crop_map,
        scale,
    );
    Ok(RenderReport {
        process_version: 6,
        stages,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{parse_recipe_json, AlphaMode, DecodeProvenance, OrientationState, PixelEncoding};

    #[test]
    fn develop_scale_requires_positive_rational_parts() {
        assert_eq!(
            validate_develop_scale(0, 1),
            Err("develop scale must be a positive exact rational")
        );
        assert_eq!(
            validate_develop_scale(1, 0),
            Err("develop scale must be a positive exact rational")
        );
        assert_eq!(validate_develop_scale(1, 1), Ok(()));
    }

    #[test]
    fn develop_uses_one_reusable_full_frame_scratch() {
        let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../../monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
        ))
        .unwrap();
        let recipe = parse_recipe_json(serde_json::to_vec(&fixture["recipe"]).unwrap()).unwrap();
        let pixels = [100, 200, 300, u16::MAX].repeat(4);
        let mut frame = DevelopFrame::new(
            2,
            2,
            pixels,
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "fixture".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 2, 2],
                working_profile_digest: "11".repeat(32),
                decode_intent_digest: "22".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        )
        .unwrap();
        let mut scratch = ScratchArena::default();
        develop_in_place(
            &mut frame,
            &recipe,
            &RenderContext {
                scale_numerator: 1,
                scale_denominator: 1,
                coverage: CoverageView {
                    width: 2,
                    height: 2,
                    coverage: None,
                },
            },
            &mut scratch,
        )
        .unwrap();
        assert_eq!(scratch.allocated_samples(), frame.pixels.len());
    }

    #[test]
    fn every_develop_stage_observes_cancellation() {
        let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
            "../../../../monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
        ))
        .unwrap();
        let recipe = parse_recipe_json(serde_json::to_vec(&fixture["recipe"]).unwrap()).unwrap();
        let make_frame = || {
            DevelopFrame::new(
                2,
                2,
                [100, 200, 300, u16::MAX].repeat(4),
                PixelEncoding::LinearSrgbU16Full,
                OrientationState {
                    source_exif: 1,
                    output_exif: 1,
                },
                DecodeProvenance {
                    source_digest: "00".repeat(32),
                    backend: "fixture".into(),
                    backend_revision: "1".into(),
                    decoder_version: "1".into(),
                    active_area: [0, 0, 2, 2],
                    working_profile_digest: "11".repeat(32),
                    decode_intent_digest: "22".repeat(32),
                    alpha_mode: AlphaMode::Opaque,
                },
            )
            .unwrap()
        };
        let context = RenderContext {
            scale_numerator: 1,
            scale_denominator: 1,
            coverage: CoverageView {
                width: 2,
                height: 2,
                coverage: None,
            },
        };
        let mut stages = Vec::new();
        develop_with_control(
            &mut make_frame(),
            &recipe,
            &context,
            &mut ScratchArena::default(),
            |stage| {
                stages.push(stage);
                Ok(())
            },
        )
        .unwrap();
        assert!(!stages.is_empty());
        for cancelled_stage in stages {
            let mut visited = Vec::new();
            let result = develop_with_control(
                &mut make_frame(),
                &recipe,
                &context,
                &mut ScratchArena::default(),
                |stage| {
                    visited.push(stage);
                    if stage == cancelled_stage {
                        Err("cancelled")
                    } else {
                        Ok(())
                    }
                },
            );
            assert_eq!(result, Err("cancelled"));
            assert_eq!(visited.last().copied(), Some(cancelled_stage));
        }
    }
}
