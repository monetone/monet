// Camera Raw ▸ Develop module. Extracted verbatim from raster/mod.rs
// (Phase 6a pre-split); `use super::*` re-exposes the raster helpers this
// block calls. Behaviour is byte-identical to the inline version.
use super::*;

// Camera Raw ▸ Develop — the whole ACR-style recipe as one op. Parses a versioned,
// length-extensible flat `f32` array (see the layout table below) and chains the
// existing `adjust::`/`filters::` stage fns in ACR order inside a single buffer
// pass. Doubles as smart-filter fid 17 (params are already `Vec<f32>`), so a
// re-editable smart object stores the recipe verbatim. Every stage skips at its
// neutral default, so an all-neutral recipe is byte-identical to the input —
// required for Cancel and deterministic smart-filter re-render.
//
// Layout (missing tail entries default to 0.0 via `g`, so older/shorter arrays
// stay valid as later phases append segments):
//   [0] version   [1] proxyScale                                    header (2)
//   [2] temp  [3] tint  [4] exposure  [5] contrast  [6] highlights
//   [7] shadows  [8] whites  [9] blacks  [10] texture  [11] clarity
//   [12] dehaze  [13] vibrance  [14] saturation                     Basic (13)
//   [15] sharpenAmount  [16] sharpenRadius  [17] nrStrength
//   [18] nrColor  [19] nrDetail                                     Detail (5)
//   [20] grainAmount  [21] grainHighlight  [22] grainIntensity      grain (3)
//   [23] vignetteAmount  [24] vignetteMidpoint                      vignette (2)
//   [25] curveEnabled  [26..282] master[256]  [282..538] r[256]
//   [538..794] g[256]  [794..1050] b[256]                           curve (1025)
//   …phase-4 segments…  …phase-5 mask segment…
const DEV_TEXTURE_RADIUS: f32 = 12.0; // base texture blur radius (px, pre-proxyScale)
const DEV_GRAIN_SEED: u32 = 0x2545_F491; // fixed so re-render / fid-17 stay deterministic
const DEV_ADVANCED_BASE: usize = 1086;
pub(crate) const DEV_ADVANCED_MAGIC: f32 = 22026.0;
pub(crate) const DEV_ADVANCED_LEGACY_VERSION: f32 = 1.0;
pub(crate) const DEV_ADVANCED_VERSION: f32 = 2.0;
// V3 appends a Point Color block (up to 8 sampled colour sockets) after the V2
// curve-source payload. It is a recipe-tail version — NOT an MVSN file-format
// bump — so older apps that only know V2 reject the whole tail (as they already
// do for any newer tail), while the stable 1086-float prefix still renders.
pub(crate) const DEV_ADVANCED_V3: f32 = 3.0;
// V4 appends a 5-float Transform block [aspect, scale, xOffset, yOffset,
// constrainCrop] after the V3 payload (GAL-DEV-07). Same tail-version rules as
// V3: older parsers reject the whole tail, the 1086 prefix still renders.
pub(crate) const DEV_ADVANCED_V4: f32 = 4.0;
// V5 appends a 12-float extras block after the V4 transform block (#444): the
// Detail sub-sliders, lens Vignetting, the Defringe hue windows + green amount,
// and the Upright mode. Same tail-version rules as V3/V4.
pub(crate) const DEV_ADVANCED_V5: f32 = 5.0;
// V6 appends a 9-float profile identity after the V5 extras (#446): the
// digest of the DNG camera profile an Embedded (4) / Custom (5) profile code
// renders through, as eight 16-bit words, then the image's as-shot white in
// kelvin (0 = unknown) its illuminants are interpolated at. The profile's
// tables are found by digest (dcp.rs develop_profile); one that cannot be
// found renders as Camera Default. Same tail-version rules as V3..V5.
pub(crate) const DEV_ADVANCED_V6: f32 = 6.0;
// V7 appends the decoder camera→XYZ matrix (9) and white balance (3).
pub(crate) const DEV_ADVANCED_V7: f32 = 7.0;
// V8: counted optional DCP context, then bounded lens identity/calibration.
pub(crate) const DEV_ADVANCED_V8: f32 = 8.0;
const DEV_PROFILE_ID_LEN: usize = 9;

/// Hydrate legacy RAW recipes with the decoder basis before rendering. The
/// declared RAW source metadata is authoritative; ordinary RGB documents
/// never infer a camera basis from the document they happen to belong to.
pub(crate) fn with_profile_source(params: &[f32], source: Option<dcp::DcpSource>) -> Vec<f32> {
    let mut result = params.to_vec();
    if let Some(source) = source {
        if let Some(advanced) = parse_develop_advanced(params) {
            if matches!(advanced.profile.code, 4 | 5) && advanced.profile.digest.is_some() {
                if params[1087] == DEV_ADVANCED_V8 {
                    let start = advanced.profile_start;
                    result.truncate(start - 1); // the V8 DCP word count
                    result.push(21.0);
                    result.extend_from_slice(&params[start..start + 9]);
                    result.extend(source.words());
                    result.extend_from_slice(&params[start + advanced.profile_words..]);
                } else {
                    if params[1087] == DEV_ADVANCED_V7 { result.truncate(result.len() - 12); }
                    result[1087] = DEV_ADVANCED_V7;
                    result.extend(source.words());
                }
            }
        }
    }
    result
}
const DEV_MAX_UPRIGHT: usize = 5;
pub(crate) const DEV_MAX_POINT_COLORS: usize = 8;
const DEV_MAX_HEALS: usize = 64;
const DEV_MAX_MASKS: usize = 32;
const DEV_MAX_MASK_POINTS: usize = 4096;
const DEV_MAX_MASK_COLORS: usize = 64;
// Highest develop mask kind the coverage renderer supports (0=brush … 7=outline,
// 8=bidirectional gradient, ACR 18.4). The parser must accept up to this: a
// recipe using kind 8 otherwise drops its whole advanced tail (calibration,
// masks, etc.) even though `develop_mask_coverage` can render it.
const DEV_MAX_MASK_KIND: usize = 8;
pub(crate) const DEV_MAX_CURVE_POINTS: usize = 128;

/// Read the fixed Camera Raw prefix through the same semantic bounds enforced
/// by the TypeScript recipe normalizer. Smart-filter params are persisted as
/// floats, so this remains the final trust boundary for crafted project files.
/// In particular, the spatial cost multipliers must never reach filter loops
/// unbounded (proxy scale, sharpen radius, and defringe width).
fn develop_stable_value(params: &[f32], index: usize) -> f32 {
    let fallback = if index == 1 { 1.0 } else { 0.0 };
    let Some(&value) = params.get(index) else {
        return fallback;
    };
    if !value.is_finite() {
        return fallback;
    }
    match index {
        1 => {
            if value > 0.0 {
                value.min(1.0)
            } else {
                1.0
            }
        }
        2 | 3 | 5..=14 | 23 | 1050 | 1053..=1076 | 1083..=1085 => value.clamp(-1.0, 1.0),
        4 => value.clamp(-10.0, 10.0),
        15 | 17..=22 | 24 | 25 | 1051 | 1052 | 1078 | 1080 | 1082 => value.clamp(0.0, 1.0),
        16 => value.clamp(0.0, 3.0),
        26..=1049 => value.clamp(0.0, 255.0),
        1077 | 1079 | 1081 => value.clamp(0.0, 360.0),
        _ => fallback,
    }
}

#[derive(Clone)]
struct DevelopProfile {
    code: u8,
    amount: f32,
    shadow_tint: f32,
    primary: [[f32; 2]; 3], // red/green/blue × hue/saturation
    /// The DNG camera profile an Embedded / Custom code names (V6): its
    /// digest, and its tables when they could be found.
    digest: Option<String>,
    dcp: Option<std::rc::Rc<dcp::DcpProfile>>,
    /// White the profile's two calibration illuminants are interpolated at.
    kelvin: f32,
    source: Option<dcp::DcpSource>,
}

#[derive(Clone, Copy)]
struct DevelopCrop {
    enabled: bool,
    x: f32,
    y: f32,
    width: f32,
    height: f32,
    angle: f32,
    constrain_aspect: bool,
    aspect_ratio: f32,
    flip_h: bool,
    flip_v: bool,
}

#[derive(Clone, Copy)]
struct DevelopHeal {
    mode: u8,
    x: f32,
    y: f32,
    source_x: f32,
    source_y: f32,
    radius: f32,
    feather: f32,
    opacity: f32,
}

struct DevelopMask {
    kind: u8,
    enabled: bool,
    inverted: bool,
    opacity: f32,
    feather: f32,
    range: [f32; 2],
    adjustments: [f32; 16],
    points: Vec<[f32; 3]>,
    colors: Vec<[f32; 3]>,
}

#[derive(Clone, Copy)]
struct DevelopPointColor {
    ref_hsl: [f32; 3], // sampled colour: hue 0..360, sat 0..1, lum 0..1
    hue: f32,          // -1..1
    sat: f32,          // -1..1
    lum: f32,          // -1..1
    range: f32,        // 0..1
}

/// Transform extras beyond the three prefix keystone floats (v4 tail):
/// LR's Aspect / Scale / X-Y Offset sliders + the Constrain Crop checkbox.
#[derive(Clone, Copy)]
struct DevelopTransform {
    aspect: f32,   // -1..1: + narrows/tallens, - widens/flattens
    scale: f32,    // 0.25..4, neutral 1
    offset_x: f32, // -1..1 of the frame width  (±1 = ±half-frame shift)
    offset_y: f32, // -1..1 of the frame height
    constrain_crop: bool,
}

const DEV_TRANSFORM_NEUTRAL: DevelopTransform = DevelopTransform {
    aspect: 0.0,
    scale: 1.0,
    offset_x: 0.0,
    offset_y: 0.0,
    constrain_crop: false,
};

/// V5 extras: Camera Raw's Detail sub-sliders (ACR units 0..100), lens
/// Vignetting (-1..1), and the colour Defringe hue windows (ACR's 0..100 hue
/// units) + green amount (0..1). The Upright mode is validated but not kept: its
/// solved correction already rides the keystone floats 1083..1085.
#[derive(Clone, Copy)]
struct DevelopExtras {
    sharpen_detail: f32,
    sharpen_masking: f32,
    nr_contrast: f32,
    color_detail: f32,
    color_smoothness: f32,
    vignetting: f32,
    purple_hue: [f32; 2],
    green_amount: f32,
    green_hue: [f32; 2],
}

const DEV_EXTRAS_NEUTRAL: DevelopExtras = DevelopExtras {
    sharpen_detail: 25.0,
    sharpen_masking: 0.0,
    nr_contrast: 0.0,
    color_detail: 50.0,
    color_smoothness: 50.0,
    vignetting: 0.0,
    purple_hue: [30.0, 70.0],
    green_amount: 0.0,
    green_hue: [40.0, 60.0],
};

pub(crate) struct DevelopAdvanced {
    profile: DevelopProfile,
    profile_start: usize,
    profile_words: usize,
    lens: Option<lens_profile::Correction>,
    crop: DevelopCrop,
    denoise_enabled: bool,
    denoise_amount: f32,
    raw_details: bool,
    heals: Vec<DevelopHeal>,
    masks: Vec<DevelopMask>,
    point_colors: Vec<DevelopPointColor>,
    transform: DevelopTransform,
    extras: DevelopExtras,
}

impl DevelopAdvanced {
    pub(super) fn has_lens_correction(&self) -> bool {
        self.lens.is_some_and(|lens| !lens.identity())
    }
}

fn develop_tail_count(value: f32, max: usize) -> Option<usize> {
    if value < 0.0 || value > max as f32 || value.fract() != 0.0 {
        None
    } else {
        Some(value as usize)
    }
}

/// Parse the optional variable Camera Raw tail atomically. Any unknown tag,
/// non-finite value, invalid count/kind, truncation, or trailing data rejects
/// the complete tail; the stable 1086-float prefix still renders normally.
pub(crate) fn parse_develop_advanced(p: &[f32]) -> Option<DevelopAdvanced> {
    if p.len() <= DEV_ADVANCED_BASE || p[DEV_ADVANCED_BASE] != DEV_ADVANCED_MAGIC {
        return None;
    }
    if !p[DEV_ADVANCED_BASE..].iter().all(|value| value.is_finite()) || p.len() < 1113 {
        return None;
    }
    let version = p[1087];
    if version != DEV_ADVANCED_LEGACY_VERSION
        && version != DEV_ADVANCED_VERSION
        && version != DEV_ADVANCED_V3
        && version != DEV_ADVANCED_V4
        && version != DEV_ADVANCED_V5
        && version != DEV_ADVANCED_V6
        && version != DEV_ADVANCED_V7
        && version != DEV_ADVANCED_V8
    {
        return None;
    }
    let profile_code = develop_tail_count(p[1088], 5)? as u8;
    let mut profile = DevelopProfile {
        code: profile_code,
        amount: p[1089],
        shadow_tint: p[1090],
        primary: [[p[1091], p[1092]], [p[1093], p[1094]], [p[1095], p[1096]]],
        digest: None,
        dcp: None,
        kelvin: 0.0,
        source: None,
    };
    let crop = DevelopCrop {
        enabled: p[1097] >= 0.5,
        x: p[1098],
        y: p[1099],
        width: p[1100],
        height: p[1101],
        angle: p[1102],
        constrain_aspect: p[1103] >= 0.5,
        aspect_ratio: p[1104],
        flip_h: p[1105] >= 0.5,
        flip_v: p[1106] >= 0.5,
    };
    // 1110 is the validated super-resolution flag. It is intentionally not
    // retained here: the Store owns that dimensional document operation.
    let denoise_enabled = p[1107] >= 0.5;
    let denoise_amount = p[1108];
    let raw_details = p[1109] >= 0.5;

    let heal_count = develop_tail_count(p[1111], DEV_MAX_HEALS)?;
    let mut cursor = 1112usize;
    let heal_end = cursor.checked_add(heal_count.checked_mul(8)?)?;
    if heal_end >= p.len() {
        return None;
    } // one mask-count float must follow
    let mut heals = Vec::with_capacity(heal_count);
    for _ in 0..heal_count {
        let mode = develop_tail_count(p[cursor], 1)? as u8;
        heals.push(DevelopHeal {
            mode,
            x: p[cursor + 1],
            y: p[cursor + 2],
            source_x: p[cursor + 3],
            source_y: p[cursor + 4],
            radius: p[cursor + 5],
            feather: p[cursor + 6],
            opacity: p[cursor + 7],
        });
        cursor += 8;
    }

    let mask_count = develop_tail_count(*p.get(cursor)?, DEV_MAX_MASKS)?;
    cursor += 1;
    let mut masks = Vec::with_capacity(mask_count);
    let mut total_points = 0usize;
    for _ in 0..mask_count {
        if cursor.checked_add(25)? > p.len() {
            return None;
        }
        let kind = develop_tail_count(p[cursor], DEV_MAX_MASK_KIND)? as u8;
        let point_count = develop_tail_count(p[cursor + 7], DEV_MAX_MASK_POINTS)?;
        let color_count = develop_tail_count(p[cursor + 8], DEV_MAX_MASK_COLORS)?;
        total_points = total_points.checked_add(point_count)?;
        if total_points > DEV_MAX_MASK_POINTS {
            return None;
        }
        let mut adjustments = [0.0f32; 16];
        adjustments.copy_from_slice(&p[cursor + 9..cursor + 25]);
        let enabled = p[cursor + 1] >= 0.5;
        let inverted = p[cursor + 2] >= 0.5;
        let opacity = p[cursor + 3];
        let feather = p[cursor + 4];
        let range = [p[cursor + 5], p[cursor + 6]];
        cursor += 25;
        let payload = point_count.checked_add(color_count)?.checked_mul(3)?;
        if cursor.checked_add(payload)? > p.len() {
            return None;
        }
        let mut points = Vec::with_capacity(point_count);
        for _ in 0..point_count {
            points.push([p[cursor], p[cursor + 1], p[cursor + 2]]);
            cursor += 3;
        }
        let mut colors = Vec::with_capacity(color_count);
        for _ in 0..color_count {
            colors.push([p[cursor], p[cursor + 1], p[cursor + 2]]);
            cursor += 3;
        }
        masks.push(DevelopMask {
            kind,
            enabled,
            inverted,
            opacity,
            feather,
            range,
            adjustments,
            points,
            colors,
        });
    }
    // V2 retains editable curve source state after the render payload. The
    // renderer validates it atomically but intentionally uses the compiled LUTs
    // in the stable prefix; TypeScript consumes this metadata on re-edit.
    if version >= DEV_ADVANCED_VERSION {
        let parametric_end = cursor.checked_add(4)?;
        if parametric_end > p.len()
            || p[cursor..parametric_end]
                .iter()
                .any(|value| !(-100.0..=100.0).contains(value))
        {
            return None;
        }
        cursor = parametric_end;
        for _ in 0..4 {
            let point_count = develop_tail_count(*p.get(cursor)?, DEV_MAX_CURVE_POINTS)?;
            if point_count < 2 {
                return None;
            }
            cursor += 1;
            let point_end = cursor.checked_add(point_count.checked_mul(2)?)?;
            if point_end > p.len()
                || p[cursor..point_end]
                    .iter()
                    .any(|value| !(0.0..=1.0).contains(value))
            {
                return None;
            }
            cursor = point_end;
        }
    }
    // V3 appends a Point Color block after the curve-source payload: a count
    // (0..=8) then 7 floats per socket [refHue, refSat, refLum, hue, sat, lum,
    // range]. All tail values were finite-checked above; ranges are clamped on
    // use in the renderer.
    let mut point_colors = Vec::new();
    if version >= DEV_ADVANCED_V3 {
        let count = develop_tail_count(*p.get(cursor)?, DEV_MAX_POINT_COLORS)?;
        cursor += 1;
        let end = cursor.checked_add(count.checked_mul(7)?)?;
        if end > p.len() {
            return None;
        }
        for _ in 0..count {
            point_colors.push(DevelopPointColor {
                ref_hsl: [p[cursor], p[cursor + 1], p[cursor + 2]],
                hue: p[cursor + 3],
                sat: p[cursor + 4],
                lum: p[cursor + 5],
                range: p[cursor + 6],
            });
            cursor += 7;
        }
    }
    // V4 Transform block: strict ranges, mirroring the curve-source validation
    // style — a crafted out-of-range value rejects the tail atomically.
    let mut transform = DEV_TRANSFORM_NEUTRAL;
    if version >= DEV_ADVANCED_V4 {
        let end = cursor.checked_add(5)?;
        if end > p.len() {
            return None;
        }
        let (aspect, scale) = (p[cursor], p[cursor + 1]);
        let (offset_x, offset_y, constrain) = (p[cursor + 2], p[cursor + 3], p[cursor + 4]);
        if !(-1.0..=1.0).contains(&aspect)
            || !(0.25..=4.0).contains(&scale)
            || !(-1.0..=1.0).contains(&offset_x)
            || !(-1.0..=1.0).contains(&offset_y)
            || (constrain != 0.0 && constrain != 1.0)
        {
            return None;
        }
        transform = DevelopTransform {
            aspect,
            scale,
            offset_x,
            offset_y,
            constrain_crop: constrain == 1.0,
        };
        cursor = end;
    }
    // V5 extras block, validated the same strict way.
    let mut extras = DEV_EXTRAS_NEUTRAL;
    if version >= DEV_ADVANCED_V5 {
        let end = cursor.checked_add(12)?;
        if end > p.len() {
            return None;
        }
        let e = &p[cursor..end];
        let percent = |value: f32| (0.0..=100.0).contains(&value);
        let window = |lo: f32, hi: f32| percent(lo) && percent(hi) && lo <= hi;
        if !e[..5].iter().all(|value| percent(*value))
            || !(-1.0..=1.0).contains(&e[5])
            || !window(e[6], e[7])
            || !(0.0..=1.0).contains(&e[8])
            || !window(e[9], e[10])
        {
            return None;
        }
        develop_tail_count(e[11], DEV_MAX_UPRIGHT)?; // Upright mode: carried, not rendered
        extras = DevelopExtras {
            sharpen_detail: e[0],
            sharpen_masking: e[1],
            nr_contrast: e[2],
            color_detail: e[3],
            color_smoothness: e[4],
            vignetting: e[5],
            purple_hue: [e[6], e[7]],
            green_amount: e[8],
            green_hue: [e[9], e[10]],
        };
        cursor = end;
    }
    // V6 profile identity: only Embedded / Custom codes render through it.
    let profile_words = if version == DEV_ADVANCED_V8 {
        let count = develop_tail_count(*p.get(cursor)?, 21)?; cursor += 1; count
    } else if version == DEV_ADVANCED_V7 { 21 } else if version == DEV_ADVANCED_V6 { 9 } else { 0 };
    if ![0, 9, 21].contains(&profile_words) { return None; }
    let profile_start = cursor;
    if profile_words >= 9 {
        let end = cursor.checked_add(DEV_PROFILE_ID_LEN)?;
        let block = p.get(cursor..end)?;
        let digest = dcp::digest_from_words(&block[..8])?;
        let as_shot = block[8];
        if as_shot != 0.0 && !(1000.0..=100_000.0).contains(&as_shot) {
            return None;
        }
        if matches!(profile.code, 4 | 5) {
            profile.kelvin = develop_white_kelvin(as_shot, develop_stable_value(p, 2));
            profile.dcp = dcp::develop_profile(&digest);
            profile.digest = Some(digest);
        }
        cursor = end;
    }
    if profile_words == 21 {
        let end = cursor.checked_add(12)?;
        profile.source = Some(dcp::DcpSource::from_words(p.get(cursor..end)?)?);
        cursor = end;
    }
    let lens = if version == DEV_ADVANCED_V8 {
        let (lens, end) = lens_profile::read_tail(p, cursor)?; cursor = end; lens
    } else { None };
    if cursor != p.len() {
        return None;
    }
    Some(DevelopAdvanced {
        profile, profile_start, profile_words, lens,
        crop,
        denoise_enabled,
        denoise_amount,
        raw_details,
        heals,
        masks,
        point_colors,
        transform,
        extras,
    })
}

impl DevelopProfile {
    fn is_neutral(&self) -> bool {
        let neutral_calibration =
            self.shadow_tint == 0.0 && self.primary.iter().flatten().all(|value| *value == 0.0);
        // Embedded / Custom render only through a registered profile; without
        // one they are Camera Default.
        let pass_through = self.code == 0 || (matches!(self.code, 4 | 5) && self.dcp.is_none());
        (self.amount.clamp(0.0, 1.0) == 0.0 || pass_through) && neutral_calibration
    }
}

/// Colour temperature of the develop's white, for a profile's illuminant
/// interpolation: the raw's as-shot white (5500 K when unknown) moved by
/// Monet's relative Temp (monet-photo's whiteBalancePresetOffsets: 200 mireds
/// a unit).
fn develop_white_kelvin(as_shot: f32, temp: f32) -> f32 {
    let base = if as_shot > 0.0 { as_shot } else { 5500.0 };
    1.0e6 / (1.0e6 / base - 200.0 * temp).clamp(1.0e6 / 50_000.0, 1.0e6 / 1000.0)
}

impl Engine {
    /// Re-render every Smart Object whose Camera Raw filter develops through a
    /// DNG camera profile (#446) that can be found now — a project saved while
    /// its profile was missing, or a profile loaded since, shows it again.
    /// A layer naming a profile that still cannot be found keeps its pixels
    /// (it is reported through `develop_profile_take_missing`). A cache
    /// refresh, not an edit: no history step. Returns the layers re-rendered.
    pub(crate) fn refresh_develop_profile_layers(&mut self) -> u32 {
        let mut refreshed = 0;
        for i in 0..self.layers.len() {
            if self.layers[i].kind != 7 {
                continue;
            }
            let profiles: Vec<bool> = self.layers[i]
                .smart_filters
                .iter()
                .filter(|(fid, _)| *fid == 17)
                .filter_map(|(_, params)| parse_develop_advanced(params))
                .filter(|advanced| advanced.profile.digest.is_some())
                .map(|advanced| advanced.profile.dcp.is_some())
                .collect();
            if !profiles.is_empty() && profiles.iter().all(|found| *found) {
                self.render_smart(i);
                refreshed += 1;
            }
        }
        if refreshed > 0 {
            self.composite();
        }
        refreshed
    }
}

/// The built-in looks (Adobe Color / Camera Neutral / Monochrome) of pixel
/// (r, g, b). Camera Default, and an Embedded / Custom profile nobody
/// registered, are already represented by the decoded working pixels.
fn builtin_profile_look(code: u8, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let (hue, saturation, lightness) = color::rgb_to_hsl(r, g, b);
    let (profile_h, profile_s, profile_l) = match code {
        // Adobe Color: a modest contrast/saturation rendering.
        1 => (
            hue,
            (saturation * 1.18).clamp(0.0, 1.0),
            ((lightness - 0.5) * 1.08 + 0.5).clamp(0.0, 1.0),
        ),
        // Camera Neutral: flatter and less saturated than the default.
        2 => (
            hue,
            saturation * 0.72,
            ((lightness - 0.5) * 0.88 + 0.5).clamp(0.0, 1.0),
        ),
        3 => {
            let lum = 0.299 * r + 0.587 * g + 0.114 * b;
            (0.0, 0.0, lum)
        }
        // Camera Default: the decoded pixels as they are.
        _ => (hue, saturation, lightness),
    };
    color::hsl_to_rgb(profile_h, profile_s, profile_l)
}

// (#77) Takes the projected selection like every other per-pixel develop stage
// (camera_raw / wb_tint / curves / …): a marquee must clip the profile and
// Camera Calibration rendering too.
fn develop_profile_calibration(px: &mut [u16], sel: &Selection, profile: &DevelopProfile) {
    let amount = profile.amount.clamp(0.0, 1.0);
    if profile.is_neutral() {
        return;
    }
    let dcp = profile
        .dcp
        .as_ref()
        .filter(|_| matches!(profile.code, 4 | 5) && amount > 0.0)
        .and_then(|dcp| dcp.render_setup(profile.kelvin, profile.source.as_ref()));
    for (index, pixel) in px.chunks_exact_mut(4).enumerate() {
        let cov = sel.coverage(index);
        if cov <= 0.0 {
            continue;
        }
        let original = [
            pixel[0] as f32 / 65535.0,
            pixel[1] as f32 / 65535.0,
            pixel[2] as f32 / 65535.0,
        ];
        let (mut r, mut g, mut b) = (original[0], original[1], original[2]);
        let profiled = match &dcp {
            Some(dcp) => {
                let out = dcp.apply(original);
                (out[0], out[1], out[2])
            }
            None => builtin_profile_look(profile.code, r, g, b),
        };
        r += (profiled.0 - r) * amount;
        g += (profiled.1 - g) * amount;
        b += (profiled.2 - b) * amount;

        // Camera Calibration hue/saturation is weighted by proximity to the
        // red, green, and blue primaries on the hue wheel.
        let (hue, saturation, lightness) = color::rgb_to_hsl(r, g, b);
        let hue_distance = |center: f32| {
            let d = (hue - center).abs().min(360.0 - (hue - center).abs());
            (1.0 - d / 120.0).clamp(0.0, 1.0)
        };
        let weights = [hue_distance(0.0), hue_distance(120.0), hue_distance(240.0)];
        let weight_sum = weights.iter().sum::<f32>().max(f32::EPSILON);
        let hue_shift = (0..3)
            .map(|i| weights[i] * profile.primary[i][0])
            .sum::<f32>()
            / weight_sum
            * 30.0;
        let sat_shift = (0..3)
            .map(|i| weights[i] * profile.primary[i][1])
            .sum::<f32>()
            / weight_sum;
        (r, g, b) = color::hsl_to_rgb(
            (hue + hue_shift).rem_euclid(360.0),
            (saturation * (1.0 + sat_shift * 0.5)).clamp(0.0, 1.0),
            lightness,
        );
        let shadow = (1.0 - lightness * 2.0).clamp(0.0, 1.0);
        let tint = profile.shadow_tint.clamp(-1.0, 1.0) * shadow * 0.12;
        // Positive Camera Calibration Shadow Tint is magenta; negative is green.
        r += tint;
        b += tint;
        g -= tint;
        // Feather toward the clamped result by selection coverage (#77); cov 1
        // (or an inactive selection) keeps the previous byte-identical write.
        pixel[0] = color::to16(color::lerp(original[0], color::clamp01(r), cov));
        pixel[1] = color::to16(color::lerp(original[1], color::clamp01(g), cov));
        pixel[2] = color::to16(color::lerp(original[2], color::clamp01(b), cov));
    }
}

#[derive(Clone, Copy)]
struct DevelopCropMap {
    active: bool,
    center_x: f32,
    center_y: f32,
    crop_px_w: f32,
    crop_px_h: f32,
    source_w: f32,
    source_h: f32,
    sin: f32,
    cos: f32,
    fill_scale: f32,
    flip_h: bool,
    flip_v: bool,
}

impl DevelopCropMap {
    fn new(crop: DevelopCrop, w: u32, h: u32) -> Self {
        let (source_w, source_h) = (w.max(1) as f32, h.max(1) as f32);
        if !crop.enabled {
            return Self {
                active: false,
                center_x: 0.5,
                center_y: 0.5,
                crop_px_w: source_w,
                crop_px_h: source_h,
                source_w,
                source_h,
                sin: 0.0,
                cos: 1.0,
                fill_scale: 1.0,
                flip_h: false,
                flip_v: false,
            };
        }
        let mut width = crop.width.clamp(1.0 / source_w, 1.0);
        let mut height = crop.height.clamp(1.0 / source_h, 1.0);
        let mut center_x = crop.x.clamp(0.0, 1.0) + width * 0.5;
        let mut center_y = crop.y.clamp(0.0, 1.0) + height * 0.5;
        if crop.constrain_aspect && crop.aspect_ratio > 0.0 {
            let target = crop.aspect_ratio.clamp(0.01, 100.0);
            let current = width * source_w / (height * source_h).max(f32::EPSILON);
            if current > target {
                width = target * height * source_h / source_w;
            } else {
                height = width * source_w / (target * source_h);
            }
        }
        width = width.clamp(1.0 / source_w, 1.0);
        height = height.clamp(1.0 / source_h, 1.0);
        center_x = center_x.clamp(width * 0.5, 1.0 - width * 0.5);
        center_y = center_y.clamp(height * 0.5, 1.0 - height * 0.5);
        let crop_px_w = width * source_w;
        let crop_px_h = height * source_h;
        let (sin, cos) = crop.angle.clamp(-45.0, 45.0).to_radians().sin_cos();
        // Zoom just enough that rotating the chosen crop never exposes pixels
        // outside its rectangle (crop-to-fill rather than transparent corners).
        let rotated_w = cos.abs() * crop_px_w + sin.abs() * crop_px_h;
        let rotated_h = sin.abs() * crop_px_w + cos.abs() * crop_px_h;
        let fill_scale = (crop_px_w / rotated_w.max(1.0))
            .min(crop_px_h / rotated_h.max(1.0))
            .min(1.0);
        Self {
            active: true,
            center_x,
            center_y,
            crop_px_w,
            crop_px_h,
            source_w,
            source_h,
            sin,
            cos,
            fill_scale,
            flip_h: crop.flip_h,
            flip_v: crop.flip_v,
        }
    }

    fn output_to_source(self, x: f32, y: f32) -> (f32, f32) {
        let mut dx = x - 0.5;
        let mut dy = y - 0.5;
        if self.flip_h {
            dx = -dx;
        }
        if self.flip_v {
            dy = -dy;
        }
        let qx = dx * self.crop_px_w * self.fill_scale;
        let qy = dy * self.crop_px_h * self.fill_scale;
        let sx = self.cos * qx + self.sin * qy;
        let sy = -self.sin * qx + self.cos * qy;
        (
            self.center_x + sx / self.source_w,
            self.center_y + sy / self.source_h,
        )
    }

    fn source_to_output(self, x: f32, y: f32) -> (f32, f32) {
        if !self.active {
            return (x, y);
        }
        let sx = (x - self.center_x) * self.source_w;
        let sy = (y - self.center_y) * self.source_h;
        let qx = self.cos * sx - self.sin * sy;
        let qy = self.sin * sx + self.cos * sy;
        let mut dx = qx / (self.crop_px_w * self.fill_scale).max(f32::EPSILON);
        let mut dy = qy / (self.crop_px_h * self.fill_scale).max(f32::EPSILON);
        if self.flip_h {
            dx = -dx;
        }
        if self.flip_v {
            dy = -dy;
        }
        (dx + 0.5, dy + 0.5)
    }

    fn moves_pixels(self, w: u32, h: u32) -> bool {
        self.active
            && !(self.center_x == 0.5
                && self.center_y == 0.5
                && (self.crop_px_w - w as f32).abs() < 1e-4
                && (self.crop_px_h - h as f32).abs() < 1e-4
                && self.sin == 0.0
                && !self.flip_h
                && !self.flip_v)
    }

    fn output_radius_px(self, normalized_source_radius: f32, w: u32, h: u32) -> f32 {
        let source_radius = normalized_source_radius.max(0.0) * self.source_w.min(self.source_h);
        if !self.active {
            return source_radius;
        }
        let zoom_x = w as f32 / (self.crop_px_w * self.fill_scale).max(1.0);
        let zoom_y = h as f32 / (self.crop_px_h * self.fill_scale).max(1.0);
        source_radius * zoom_x.min(zoom_y)
    }
}

fn develop_crop_to_fill(px: &mut [u16], w: u32, h: u32, map: DevelopCropMap) {
    if !map.moves_pixels(w, h) {
        return;
    }
    let source = px.to_vec();
    for y in 0..h {
        for x in 0..w {
            let (sx, sy) =
                map.output_to_source((x as f32 + 0.5) / w as f32, (y as f32 + 0.5) / h as f32);
            let offset = ((y * w + x) * 4) as usize;
            sample_bi(
                &source,
                w as i32,
                h as i32,
                sx * w as f32 - 0.5,
                sy * h as f32 - 0.5,
                &mut px[offset..offset + 4],
            );
        }
    }
}

// (#79) Retouch discs are clipped by the selection, like every other write on
// the apply16 path. Heals run after the crop resample, so the plane-space
// coverage is sampled at output coordinates — the same approximation
// `develop_local_masks` already accepts.
fn develop_heal_spots(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    spots: &[DevelopHeal],
    crop_map: DevelopCropMap,
    proxy_scale: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    if wi <= 0 || hi <= 0 {
        return;
    }
    for spot in spots {
        let radius = crop_map
            .output_radius_px(spot.radius, w, h)
            .max(proxy_scale.clamp(0.05, 1.0));
        let opacity = spot.opacity.clamp(0.0, 1.0);
        if radius <= 0.0 || opacity <= 0.0 {
            continue;
        }
        let (target_x, target_y) = crop_map.source_to_output(spot.x, spot.y);
        let (source_x, source_y) = crop_map.source_to_output(spot.source_x, spot.source_y);
        let target_px = target_x * w as f32 - 0.5;
        let target_py = target_y * h as f32 - 0.5;
        let source_px = source_x * w as f32 - 0.5;
        let source_py = source_y * h as f32 - 0.5;
        if target_px + radius < 0.0
            || target_py + radius < 0.0
            || target_px - radius >= w as f32
            || target_py - radius >= h as f32
        {
            continue;
        }
        // px is still pre-spot here, so the boundary probes read exactly what
        // the old whole-buffer clone held. Heal (mode 0) solves a membrane over
        // the disc; clone (mode 1) copies the source untouched.
        let membrane = (spot.mode == 0).then(|| {
            HealMembrane::solve(
                &px[..],
                wi,
                hi,
                (target_px, target_py),
                (source_px, source_py),
                radius,
            )
        });
        let feather = spot.feather.clamp(0.0, 1.0);
        let inner = radius * (1.0 - feather);
        let x0 = (target_px - radius).floor().max(0.0) as i32;
        let y0 = (target_py - radius).floor().max(0.0) as i32;
        let x1 = (target_px + radius).ceil().min(wi as f32 - 1.0) as i32;
        let y1 = (target_py + radius).ceil().min(hi as f32 - 1.0) as i32;
        // Snapshot only the source disc, not the whole layer: at export res a
        // full clone is ~480 MB per spot and 64 spots are allowed, yet every
        // read below lands inside this rect. Still taken BEFORE this spot's
        // writes, so later spots keep seeing earlier spots' output.
        let source = SourcePatch::capture(
            px,
            wi,
            hi,
            source_px + (x0 as f32 - target_px),
            source_px + (x1 as f32 - target_px),
            source_py + (y0 as f32 - target_py),
            source_py + (y1 as f32 - target_py),
        );
        for y in y0..=y1 {
            for x in x0..=x1 {
                let dx = x as f32 - target_px;
                let dy = y as f32 - target_py;
                let distance = (dx * dx + dy * dy).sqrt();
                if distance > radius {
                    continue;
                }
                let edge = if distance <= inner || feather <= f32::EPSILON {
                    1.0
                } else {
                    ((radius - distance) / (radius - inner).max(f32::EPSILON)).clamp(0.0, 1.0)
                };
                let amount = edge * opacity * sel.coverage((y * wi + x) as usize);
                if amount <= 0.0 {
                    continue;
                }
                let mut sampled = [0u16; 4];
                source.sample(wi, hi, source_px + dx, source_py + dy, &mut sampled);
                // Smooth tone correction for this pixel; zero for clone.
                let delta = membrane
                    .as_ref()
                    .map_or([0.0; 3], |m| m.correction(dx, dy));
                let offset = (y * wi + x) as usize * 4;
                for channel in 0..3 {
                    let replacement = (sampled[channel] as f32 + delta[channel]).clamp(0.0, 65535.0);
                    px[offset + channel] = (px[offset + channel] as f32
                        + (replacement - px[offset + channel] as f32) * amount)
                        .round()
                        .clamp(0.0, 65535.0) as u16;
                }
                if spot.mode == 1 {
                    px[offset + 3] = (px[offset + 3] as f32
                        + (sampled[3] as f32 - px[offset + 3] as f32) * amount)
                        .round()
                        .clamp(0.0, 65535.0) as u16;
                }
            }
        }
    }
}

// Gradient-domain heal: the result is `source + h`, where `h` is the harmonic
// function that equals the residual (destination − source) on the disc
// boundary. That is Poisson seamless cloning stated for a disc — the patch
// keeps its own texture (its gradients are untouched) while its low-frequency
// tone bends to meet the destination, so a spot laid on a sky, a vignette or a
// cheek falloff has no edge. The old constant centre delta is the n = 0 term.
//
// On a disc the harmonic extension is the Poisson kernel, i.e. the boundary
// residual's Fourier series with each harmonic decayed by (r/R)^n — no solver
// iteration, one closed form.
//
// ponytail: 8 harmonics from 64 boundary probes, not a variational solve.
// Exact for the constant/linear/quadratic tone ramps that cause visible seams,
// and higher harmonics decay away from the edge anyway. Upgrade to a multigrid
// Poisson solve if heal regions ever stop being discs or need gradient mixing.
const HEAL_HARMONICS: usize = 8;
const HEAL_BOUNDARY_PROBES: usize = 64;

pub(super) struct HealMembrane {
    /// n = 0 term: the mean boundary residual, per RGB channel.
    mean: [f32; 3],
    /// cos/sin coefficients of harmonics 1..=HEAL_HARMONICS, per RGB channel.
    cos: [[f32; 3]; HEAL_HARMONICS],
    sin: [[f32; 3]; HEAL_HARMONICS],
    inv_radius: f32,
}

impl HealMembrane {
    fn solve(
        px: &[u16],
        w: i32,
        h: i32,
        target: (f32, f32),
        source: (f32, f32),
        radius: f32,
    ) -> Self {
        Self::from_boundary(radius, |ox, oy| {
            let mut destination = [0u16; 4];
            let mut patch = [0u16; 4];
            sample_bi(px, w, h, target.0 + ox, target.1 + oy, &mut destination);
            sample_bi(px, w, h, source.0 + ox, source.1 + oy, &mut patch);
            [
                destination[0] as f32 - patch[0] as f32,
                destination[1] as f32 - patch[1] as f32,
                destination[2] as f32 - patch[2] as f32,
            ]
        })
    }

    /// The same solve, driven by a caller-supplied boundary probe:
    /// `residual(ox, oy)` returns destination − source at that offset from the
    /// disc centre. Units are the caller's — `correction` gives them back — so a
    /// brush working in 0..1 floats and Camera Raw working in u16 share one
    /// solver. The Healing Brush enters here (its destination is a layer plane
    /// and its source a separate clone buffer, neither addressable as one `px`).
    pub(super) fn from_boundary(
        radius: f32,
        mut residual_at: impl FnMut(f32, f32) -> [f32; 3],
    ) -> Self {
        let mut membrane = Self {
            mean: [0.0; 3],
            cos: [[0.0; 3]; HEAL_HARMONICS],
            sin: [[0.0; 3]; HEAL_HARMONICS],
            inv_radius: 1.0 / radius.max(f32::EPSILON),
        };
        let probes = HEAL_BOUNDARY_PROBES as f32;
        for k in 0..HEAL_BOUNDARY_PROBES {
            let angle = std::f32::consts::TAU * k as f32 / probes;
            let (sin_a, cos_a) = angle.sin_cos();
            let residual = residual_at(cos_a * radius, sin_a * radius);
            for channel in 0..3 {
                membrane.mean[channel] += residual[channel] / probes;
            }
            // e^{i·n·angle} by repeated complex multiply — no trig per harmonic.
            let (mut hx, mut hy) = (1.0f32, 0.0f32);
            for n in 0..HEAL_HARMONICS {
                let (nx, ny) = (hx * cos_a - hy * sin_a, hx * sin_a + hy * cos_a);
                for channel in 0..3 {
                    membrane.cos[n][channel] += residual[channel] * nx * 2.0 / probes;
                    membrane.sin[n][channel] += residual[channel] * ny * 2.0 / probes;
                }
                hx = nx;
                hy = ny;
            }
        }
        membrane
    }

    /// Σ (r/R)^n · (aₙ·cos nθ + bₙ·sin nθ) at an offset from the disc centre.
    /// `z = (dx + i·dy)/R` carries both the decay and the rotation, so powers
    /// of z are one complex multiply each.
    pub(super) fn correction(&self, dx: f32, dy: f32) -> [f32; 3] {
        let mut out = self.mean;
        let (zx, zy) = (dx * self.inv_radius, dy * self.inv_radius);
        let (mut hx, mut hy) = (1.0f32, 0.0f32);
        for n in 0..HEAL_HARMONICS {
            let (nx, ny) = (hx * zx - hy * zy, hx * zy + hy * zx);
            for channel in 0..3 {
                out[channel] += self.cos[n][channel] * nx + self.sin[n][channel] * ny;
            }
            hx = nx;
            hy = ny;
        }
        out
    }
}

#[cfg(test)]
mod develop_heal_membrane_tests {
    use super::*;

    const W: u32 = 64;
    const H: u32 = 64;

    /// Curved vertical tone ramp — a sky/vignette falloff. Quadratic on purpose:
    /// its slope differs between the source and target rows, so no *constant*
    /// delta can match the destination on both sides of the disc at once.
    fn ramp(y: i32) -> f32 {
        2000.0 + 12.0 * (y * y) as f32
    }

    fn crop_map() -> DevelopCropMap {
        DevelopCropMap::new(
            DevelopCrop {
                enabled: false, x: 0.0, y: 0.0, width: 1.0, height: 1.0,
                angle: 0.0, constrain_aspect: false, aspect_ratio: 1.0,
                flip_h: false, flip_v: false,
            },
            W, H,
        )
    }

    #[test]
    fn heal_matches_the_destination_ramp_at_the_seam_and_keeps_source_texture() {
        // Centres land on whole pixels: (x + 0.5) / W maps back to px x.
        let (target_cx, target_cy) = (32i32, 44i32);
        let (source_cx, source_cy) = (32i32, 16i32);
        let radius = 10i32;
        let core = 6i32; // blemish / texture core, clear of the boundary ring

        let at = |x: i32, y: i32| ((y * W as i32 + x) * 4) as usize;
        let mut px = vec![0u16; (W * H * 4) as usize];
        for y in 0..H as i32 {
            for x in 0..W as i32 {
                let mut value = ramp(y);
                let source_d = (((x - source_cx).pow(2) + (y - source_cy).pow(2)) as f32).sqrt();
                if source_d <= core as f32 {
                    // Fine detail only inside the source core: it must survive
                    // the blend, and it never reaches the boundary probes.
                    value += if x % 2 == 0 { 500.0 } else { -500.0 };
                }
                let target_d = (((x - target_cx).pow(2) + (y - target_cy).pow(2)) as f32).sqrt();
                if target_d <= core as f32 {
                    value = 60000.0; // the blemish being healed away
                }
                let offset = at(x, y);
                for channel in 0..3 {
                    px[offset + channel] = value as u16;
                }
                px[offset + 3] = 65535;
            }
        }

        let spot = DevelopHeal {
            mode: 0,
            x: (target_cx as f32 + 0.5) / W as f32,
            y: (target_cy as f32 + 0.5) / H as f32,
            source_x: (source_cx as f32 + 0.5) / W as f32,
            source_y: (source_cy as f32 + 0.5) / H as f32,
            radius: radius as f32 / W as f32,
            feather: 0.0,
            opacity: 1.0,
        };
        develop_heal_spots(
            &mut px,
            W,
            H,
            &Selection::new(W, H),
            &[spot],
            crop_map(),
            1.0,
        );

        // The healed disc reproduces the destination's own tone field, so the
        // rim is continuous with the pixels just outside it. A constant delta
        // cannot: it is off by ±6720 at the top and bottom of this disc, with
        // opposite signs, so no single offset satisfies both ends.
        let mut worst = 0.0f32;
        for dy in -radius..=radius {
            for dx in -radius..=radius {
                let d = ((dx * dx + dy * dy) as f32).sqrt();
                if d > radius as f32 || d <= core as f32 {
                    continue; // the core carries texture, judged separately
                }
                let out = px[at(target_cx + dx, target_cy + dy)] as f32;
                worst = worst.max((out - ramp(target_cy + dy)).abs());
            }
        }
        assert!(worst < 16.0, "seamless rim, worst deviation {worst}");

        // The blemish is gone (it read 60000 against a ~25000 ramp)...
        let centre = px[at(target_cx, target_cy)] as f32;
        assert!(
            (centre - ramp(target_cy)).abs() < 600.0,
            "blemish replaced by the source tone, got {centre}"
        );
        // ...and the source's fine detail came with it: neighbouring columns
        // differ by the source texture, not by the flat blemish they replaced.
        let neighbour = px[at(target_cx + 1, target_cy)] as f32;
        assert!(
            (centre - neighbour).abs() > 800.0,
            "source texture preserved, got {centre} vs {neighbour}"
        );
    }
}

// A rectangular snapshot of the pre-spot pixels, sampled through the exact
// same bilinear + edge-clamp rule as sample_bi so a heal reads byte-identical
// values to the whole-buffer clone this replaces.
struct SourcePatch {
    px: Vec<u16>,
    x0: i32,
    y0: i32,
    stride: i32,
}

impl SourcePatch {
    /// `f*_min`/`f*_max` are the extreme sample coordinates the caller will
    /// ask for. sample_bi only ever indexes `clamp(floor(f) + {0,1})`, so
    /// covering `floor(min) ..= floor(max) + 1` (edge-clamped) covers them all.
    fn capture(
        src: &[u16],
        w: i32,
        h: i32,
        fx_min: f32,
        fx_max: f32,
        fy_min: f32,
        fy_max: f32,
    ) -> Self {
        let x0 = (fx_min.floor() as i32).clamp(0, w - 1);
        let x1 = (fx_max.floor() as i32)
            .saturating_add(1)
            .clamp(0, w - 1)
            .max(x0);
        let y0 = (fy_min.floor() as i32).clamp(0, h - 1);
        let y1 = (fy_max.floor() as i32)
            .saturating_add(1)
            .clamp(0, h - 1)
            .max(y0);
        let stride = x1 - x0 + 1;
        let mut px = Vec::with_capacity((stride * (y1 - y0 + 1) * 4) as usize);
        for y in y0..=y1 {
            let row = ((y * w + x0) * 4) as usize;
            px.extend_from_slice(&src[row..row + (stride * 4) as usize]);
        }
        Self {
            px,
            x0,
            y0,
            stride,
        }
    }

    // Body kept VERBATIM from sample_bi; only the source index is rebased onto
    // the patch, so the float accumulation order (and therefore the result) is
    // unchanged.
    fn sample(&self, w: i32, h: i32, fx: f32, fy: f32, out: &mut [u16]) {
        if fx < -1.0 || fy < -1.0 || fx > w as f32 || fy > h as f32 {
            out[0] = 0;
            out[1] = 0;
            out[2] = 0;
            out[3] = 0;
            return;
        }
        let x0 = fx.floor() as i32;
        let y0 = fy.floor() as i32;
        let tx = fx - x0 as f32;
        let ty = fy - y0 as f32;
        let mut acc = [0f32; 4];
        for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
            for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
                let sx = (x0 + ox).clamp(0, w - 1);
                let sy = (y0 + oy).clamp(0, h - 1);
                let si = ((sy - self.y0) * self.stride + (sx - self.x0)) as usize * 4;
                let wgt = wx * wy;
                for k in 0..4 {
                    acc[k] += self.px[si + k] as f32 * wgt;
                }
            }
        }
        for k in 0..4 {
            out[k] = acc[k].round().clamp(0.0, 65535.0) as u16;
        }
    }
}

fn develop_denoise(px: &mut [u16], w: u32, h: u32, sel: &Selection, amount: f32, proxy_scale: f32) {
    let amount = amount.clamp(0.0, 1.0);
    if amount <= 0.0 {
        return;
    }
    let radius = (2.0 * proxy_scale.clamp(0.05, 1.0)).round().max(1.0) as i32;
    let (wi, hi) = (w as i32, h as i32);
    let source = px.to_vec();
    let sigma_color = 0.025 + amount * 0.18;
    let inv_color = 1.0 / (2.0 * sigma_color * sigma_color);
    let inv_space = 1.0 / (2.0 * (radius.max(1) as f32).powi(2));
    for y in 0..hi {
        for x in 0..wi {
            let index = (y * wi + x) as usize;
            let coverage = sel.coverage(index) * amount;
            if coverage <= 0.0 {
                continue;
            }
            let offset = index * 4;
            let center = [
                source[offset] as f32 / 65535.0,
                source[offset + 1] as f32 / 65535.0,
                source[offset + 2] as f32 / 65535.0,
            ];
            let mut sum = [0.0f32; 3];
            let mut weight_sum = 0.0f32;
            for dy in -radius..=radius {
                for dx in -radius..=radius {
                    let sx = (x + dx).clamp(0, wi - 1);
                    let sy = (y + dy).clamp(0, hi - 1);
                    let sample_offset = (sy * wi + sx) as usize * 4;
                    let sample = [
                        source[sample_offset] as f32 / 65535.0,
                        source[sample_offset + 1] as f32 / 65535.0,
                        source[sample_offset + 2] as f32 / 65535.0,
                    ];
                    let color_distance = (sample[0] - center[0]).powi(2)
                        + (sample[1] - center[1]).powi(2)
                        + (sample[2] - center[2]).powi(2);
                    let spatial_distance = (dx * dx + dy * dy) as f32;
                    let weight = (-color_distance * inv_color - spatial_distance * inv_space).exp();
                    for channel in 0..3 {
                        sum[channel] += sample[channel] * weight;
                    }
                    weight_sum += weight;
                }
            }
            for channel in 0..3 {
                let filtered = sum[channel] / weight_sum.max(f32::EPSILON);
                let output = center[channel] + (filtered - center[channel]) * coverage;
                px[offset + channel] = color::to16(output);
            }
        }
    }
}

// (#78) Uses the caller's selection instead of a locally-built full one, so
// Enhance clips to the marquee like the recipe's own Detail stages, which run
// the identical kernels through `sel`.
fn develop_enhance(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    denoise_enabled: bool,
    denoise_amount: f32,
    raw_details: bool,
    proxy_scale: f32,
) {
    if denoise_enabled {
        develop_denoise(px, w, h, sel, denoise_amount, proxy_scale);
    }
    if raw_details {
        filters::smart_sharpen(
            px,
            w,
            h,
            sel,
            0.65,
            (0.9 * proxy_scale.clamp(0.05, 1.0)).max(0.35),
            0.2,
            0,
            0.0,
            0.0,
            0.0,
        );
    }
}

fn develop_smoothstep(edge0: f32, edge1: f32, value: f32) -> f32 {
    if (edge1 - edge0).abs() <= f32::EPSILON {
        return if value >= edge1 { 1.0 } else { 0.0 };
    }
    let t = ((value - edge0) / (edge1 - edge0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

fn develop_mask_dab(
    coverage: &mut [f32],
    w: u32,
    h: u32,
    x: f32,
    y: f32,
    radius: f32,
    feather: f32,
    strength: f32,
) {
    let (wi, hi) = (w as i32, h as i32);
    let cx = x * w as f32 - 0.5;
    let cy = y * h as f32 - 0.5;
    let radius = radius.max(0.5);
    let inner = radius * (1.0 - feather.clamp(0.0, 1.0));
    let x0 = (cx - radius).floor().max(0.0) as i32;
    let y0 = (cy - radius).floor().max(0.0) as i32;
    let x1 = (cx + radius).ceil().min(wi as f32 - 1.0) as i32;
    let y1 = (cy + radius).ceil().min(hi as f32 - 1.0) as i32;
    for py in y0..=y1 {
        for px in x0..=x1 {
            let distance = ((px as f32 - cx).powi(2) + (py as f32 - cy).powi(2)).sqrt();
            if distance > radius {
                continue;
            }
            let edge = if distance <= inner {
                1.0
            } else {
                (1.0 - develop_smoothstep(inner, radius, distance)).clamp(0.0, 1.0)
            };
            let index = (py * wi + px) as usize;
            coverage[index] = coverage[index].max(edge * strength.clamp(0.0, 1.0));
        }
    }
}

/// Separable box blur over a coverage plane — the outline-mask feather.
/// Radius derives from `feather` (fraction-ish of the short side, capped).
fn develop_feather_coverage(coverage: &mut [f32], w: u32, h: u32, feather: f32) {
    let radius = ((feather.clamp(0.0, 1.0) * 0.04 * w.min(h) as f32) as usize).clamp(1, 32);
    let (wi, hi) = (w as usize, h as usize);
    let mut pass = |horizontal: bool, src: &[f32], dst: &mut [f32]| {
        let (outer, inner) = if horizontal { (hi, wi) } else { (wi, hi) };
        for o in 0..outer {
            let mut sum = 0.0f32;
            let at = |i: usize| if horizontal { o * wi + i } else { i * wi + o };
            let window = (radius * 2 + 1).min(inner);
            for i in 0..window.min(inner) {
                sum += src[at(i.min(inner - 1))];
            }
            for i in 0..inner {
                let lo = i.saturating_sub(radius);
                let hi_i = (i + radius).min(inner - 1);
                // Recompute incrementally: slide the window by one.
                if i > 0 {
                    let drop = i.saturating_sub(radius + 1);
                    if i > radius {
                        sum -= src[at(drop)];
                    }
                    if i + radius <= inner - 1 {
                        sum += src[at(hi_i)];
                    }
                }
                let count = (hi_i - lo + 1) as f32;
                dst[at(i)] = sum / count.max(1.0);
            }
        }
    };
    let mut tmp = vec![0.0f32; coverage.len()];
    pass(true, coverage, &mut tmp);
    pass(false, &tmp, coverage);
}

fn develop_mask_coverage(
    mask: &DevelopMask,
    px: &[u16],
    w: u32,
    h: u32,
    crop_map: DevelopCropMap,
    proxy_scale: f32,
) -> Vec<u8> {
    let n = (w * h) as usize;
    let mut coverage = vec![0.0f32; n];
    let feather = mask.feather.clamp(0.0, 1.0);
    let points: Vec<[f32; 3]> = mask
        .points
        .iter()
        .map(|point| {
            let (x, y) = crop_map.source_to_output(point[0], point[1]);
            [x, y, point[2].clamp(0.0, 1.0)]
        })
        .collect();
    match mask.kind {
        // Brush path: interpolate pressure-aware circular dabs along each
        // segment so sparse pointer events do not leave holes.
        0 => {
            let base_radius = (0.025 * w.min(h) as f32).max(proxy_scale.clamp(0.05, 1.0));
            if let Some(first) = points.first() {
                develop_mask_dab(
                    &mut coverage,
                    w,
                    h,
                    first[0],
                    first[1],
                    base_radius * first[2].max(0.05),
                    feather,
                    first[2],
                );
            }
            for pair in points.windows(2) {
                let a = pair[0];
                let b = pair[1];
                let distance = (((b[0] - a[0]) * w as f32).powi(2)
                    + ((b[1] - a[1]) * h as f32).powi(2))
                .sqrt();
                let steps = (distance / (base_radius * 0.5).max(0.5))
                    .ceil()
                    .clamp(1.0, 2048.0) as usize;
                for step in 1..=steps {
                    let t = step as f32 / steps as f32;
                    let pressure = a[2] + (b[2] - a[2]) * t;
                    develop_mask_dab(
                        &mut coverage,
                        w,
                        h,
                        a[0] + (b[0] - a[0]) * t,
                        a[1] + (b[1] - a[1]) * t,
                        base_radius * pressure.max(0.05),
                        feather,
                        pressure,
                    );
                }
            }
        }
        // Linear gradient: first control point is fully selected, second is zero.
        1 if points.len() >= 2 => {
            let a = points[0];
            let b = points[1];
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let length2 = (dx * dx + dy * dy).max(f32::EPSILON);
            for y in 0..h {
                for x in 0..w {
                    let nx = (x as f32 + 0.5) / w as f32;
                    let ny = (y as f32 + 0.5) / h as f32;
                    let t = ((nx - a[0]) * dx + (ny - a[1]) * dy) / length2;
                    let linear = (1.0 - t).clamp(0.0, 1.0);
                    coverage[(y * w + x) as usize] = if feather > 0.0 {
                        develop_smoothstep(0.0, 1.0, linear).powf(1.0 - feather * 0.5)
                    } else {
                        linear
                    };
                }
            }
        }
        // Bidirectional gradient: symmetric two-sided linear gradient. Full
        // selection at the a→b midpoint, falling linearly to zero at BOTH
        // control points (and beyond) — a tent `1 - |2t-1|` over the same
        // projection the linear gradient uses. Mirrors ACR 18.4's Bidirectional
        // Gradient mask.
        8 if points.len() >= 2 => {
            let a = points[0];
            let b = points[1];
            let dx = b[0] - a[0];
            let dy = b[1] - a[1];
            let length2 = (dx * dx + dy * dy).max(f32::EPSILON);
            for y in 0..h {
                for x in 0..w {
                    let nx = (x as f32 + 0.5) / w as f32;
                    let ny = (y as f32 + 0.5) / h as f32;
                    let t = ((nx - a[0]) * dx + (ny - a[1]) * dy) / length2;
                    let tent = (1.0 - (2.0 * t - 1.0).abs()).clamp(0.0, 1.0);
                    coverage[(y * w + x) as usize] = if feather > 0.0 {
                        develop_smoothstep(0.0, 1.0, tent).powf(1.0 - feather * 0.5)
                    } else {
                        tent
                    };
                }
            }
        }
        // Radial gradient: first point is centre, second defines the outer radius.
        2 if points.len() >= 2 => {
            let center = points[0];
            let edge = points[1];
            let radius = (((edge[0] - center[0]) * w as f32).powi(2)
                + ((edge[1] - center[1]) * h as f32).powi(2))
            .sqrt()
            .max(1.0);
            for y in 0..h {
                for x in 0..w {
                    let dx = (x as f32 + 0.5 - center[0] * w as f32) / radius;
                    let dy = (y as f32 + 0.5 - center[1] * h as f32) / radius;
                    let distance = (dx * dx + dy * dy).sqrt();
                    let inner = 1.0 - feather;
                    coverage[(y * w + x) as usize] = if distance <= inner {
                        1.0
                    } else {
                        1.0 - develop_smoothstep(inner, 1.0, distance)
                    };
                }
            }
        }
        // Luminance range with feathered lower/upper transitions.
        3 => {
            let low = mask.range[0].min(mask.range[1]).clamp(0.0, 1.0);
            let high = mask.range[0].max(mask.range[1]).clamp(0.0, 1.0);
            let soft = 0.005 + feather * 0.2;
            for index in 0..n {
                let offset = index * 4;
                let lum = (0.299 * px[offset] as f32
                    + 0.587 * px[offset + 1] as f32
                    + 0.114 * px[offset + 2] as f32)
                    / 65535.0;
                let lower = if low <= 0.0 {
                    1.0
                } else {
                    develop_smoothstep(low - soft, low + soft, lum)
                };
                let upper = if high >= 1.0 {
                    1.0
                } else {
                    1.0 - develop_smoothstep(high - soft, high + soft, lum)
                };
                coverage[index] = lower.min(upper);
            }
        }
        // Color range: nearest sampled sRGB colour wins; feather expands the tolerance.
        4 if !mask.colors.is_empty() => {
            let tolerance = 0.04 + feather * 0.35;
            for index in 0..n {
                let offset = index * 4;
                let rgb = [
                    px[offset] as f32 / 65535.0,
                    px[offset + 1] as f32 / 65535.0,
                    px[offset + 2] as f32 / 65535.0,
                ];
                let nearest = mask
                    .colors
                    .iter()
                    .map(|sample| {
                        let sr = (sample[0] / 255.0).clamp(0.0, 1.0);
                        let sg = (sample[1] / 255.0).clamp(0.0, 1.0);
                        let sb = (sample[2] / 255.0).clamp(0.0, 1.0);
                        ((rgb[0] - sr).powi(2) + (rgb[1] - sg).powi(2) + (rgb[2] - sb).powi(2))
                            .sqrt()
                    })
                    .fold(f32::INFINITY, f32::min);
                coverage[index] = 1.0 - develop_smoothstep(tolerance * 0.35, tolerance, nearest);
            }
        }
        // Subject heuristic: a feathered central portrait/object ellipse.
        5 => {
            let inner = 1.0 - feather * 0.75;
            for y in 0..h {
                for x in 0..w {
                    let nx = ((x as f32 + 0.5) / w as f32 - 0.5) / 0.38;
                    let ny = ((y as f32 + 0.5) / h as f32 - 0.55) / 0.46;
                    let distance = (nx * nx + ny * ny).sqrt();
                    coverage[(y * w + x) as usize] = 1.0 - develop_smoothstep(inner, 1.0, distance);
                }
            }
        }
        // Sky heuristic: favour blue/bright pixels connected visually to the top.
        6 => {
            for y in 0..h {
                let top_weight = (1.0 - y as f32 / h.max(1) as f32).clamp(0.0, 1.0);
                for x in 0..w {
                    let index = (y * w + x) as usize;
                    let offset = index * 4;
                    let r = px[offset] as f32 / 65535.0;
                    let g = px[offset + 1] as f32 / 65535.0;
                    let b = px[offset + 2] as f32 / 65535.0;
                    let blue = ((b - r.max(g) - 0.02) / 0.28).clamp(0.0, 1.0);
                    let bright = ((r + g + b) / 3.0 - 0.55).max(0.0) * 1.8;
                    coverage[index] = blue.max(bright.clamp(0.0, 1.0)) * top_weight.powf(0.65);
                }
            }
        }
        // Outline mask (AI subject et al.): `points` is a closed polygon — the
        // normalized outline of a segmentation matte, persisted in the recipe so
        // replay is deterministic with the model absent. Scanline even-odd fill;
        // `feather` softens via a separable box blur.
        7 if points.len() >= 3 => {
            for y in 0..h {
                let fy = (y as f32 + 0.5) / h as f32;
                let mut xs: Vec<f32> = Vec::new();
                for i in 0..points.len() {
                    let a = points[i];
                    let b = points[(i + 1) % points.len()];
                    if (a[1] <= fy && fy < b[1]) || (b[1] <= fy && fy < a[1]) {
                        let t = (fy - a[1]) / (b[1] - a[1]);
                        xs.push(a[0] + (b[0] - a[0]) * t);
                    }
                }
                xs.sort_by(|p, q| p.partial_cmp(q).unwrap_or(std::cmp::Ordering::Equal));
                for pair in xs.chunks_exact(2) {
                    let x0 = (pair[0].max(0.0) * w as f32).round() as u32;
                    let x1 = ((pair[1].min(1.0) * w as f32).round() as u32).min(w);
                    for x in x0..x1 {
                        coverage[(y * w + x) as usize] = 1.0;
                    }
                }
            }
            if feather > 0.0 {
                develop_feather_coverage(&mut coverage, w, h, feather);
            }
        }
        _ => {}
    }

    let opacity = mask.opacity.clamp(0.0, 1.0);
    coverage
        .into_iter()
        .map(|mut value| {
            if mask.inverted {
                value = 1.0 - value;
            }
            (value.clamp(0.0, 1.0) * opacity * 255.0 + 0.5) as u8
        })
        .collect()
}

#[cfg(test)]
mod develop_bidirectional_mask_tests {
    use super::*;

    fn disabled_crop_map(w: u32, h: u32) -> DevelopCropMap {
        DevelopCropMap::new(
            DevelopCrop {
                enabled: false, x: 0.0, y: 0.0, width: 1.0, height: 1.0,
                angle: 0.0, constrain_aspect: false, aspect_ratio: 1.0,
                flip_h: false, flip_v: false,
            },
            w, h,
        )
    }

    // Horizontal axis from a=(0.2,0.5) to b=(0.8,0.5); no feather → the raw ramp.
    fn horiz_mask(kind: u8) -> DevelopMask {
        DevelopMask {
            kind, enabled: true, inverted: false, opacity: 1.0, feather: 0.0,
            range: [0.0, 0.0], adjustments: [0.0; 16],
            points: vec![[0.2, 0.5, 1.0], [0.8, 0.5, 1.0]],
            colors: vec![],
        }
    }

    #[test]
    fn bidirectional_gradient_peaks_at_midpoint_symmetric_and_unlike_linear() {
        let (w, h) = (40u32, 8u32);
        let px = vec![0u16; (w * h * 4) as usize];
        let bidir = develop_mask_coverage(&horiz_mask(8), &px, w, h, disabled_crop_map(w, h), 1.0);
        // Sample the middle row by explicit column so mirror pairs (x, w-1-x)
        // are exact — pixel centres (x+0.5)/w don't land on fractional fx values.
        let row = |cov: &[u8], x: u32| cov[((h / 2) * w + x) as usize];

        // Full selection at the a→b midpoint (columns straddling nx=0.5);
        // near-zero at the control points (a≈col 8, b≈col 32).
        assert!(row(&bidir, 19) > 235 && row(&bidir, 20) > 235, "midpoint ~full");
        assert!(row(&bidir, 8) < 20, "near-zero at a, got {}", row(&bidir, 8));
        assert!(row(&bidir, 32) < 20, "near-zero at b, got {}", row(&bidir, 32));
        // Symmetric about the centre: mirror columns match.
        for x in [10u32, 13, 16] {
            assert!((row(&bidir, x) as i32 - row(&bidir, w - 1 - x) as i32).abs() <= 2, "sym x={x}");
        }

        // Distinct from the one-sided linear gradient (kind 1): the linear mask is
        // FULL at a and monotonic; the bidirectional is near-zero at a and peaks
        // in the middle.
        let lin = develop_mask_coverage(&horiz_mask(1), &px, w, h, disabled_crop_map(w, h), 1.0);
        assert!(row(&lin, 8) > 235, "linear full at a");
        assert!(row(&bidir, 20) > row(&lin, 20), "bidirectional peaks mid vs linear midway");
    }
}

fn develop_local_adjustments(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    adjustments: [f32; 16],
    proxy_scale: f32,
) {
    if adjustments.iter().all(|value| *value == 0.0) {
        return;
    }
    if [0usize, 2, 3, 4, 5, 9, 10, 11]
        .iter()
        .any(|index| adjustments[*index] != 0.0)
    {
        adjust::camera_raw(
            px,
            sel,
            adjustments[0],
            adjustments[2],
            adjustments[3],
            adjustments[4],
            adjustments[5],
            adjustments[9],
            adjustments[10],
            0.0,
            adjustments[11],
            0.0,
        );
    }
    adjust::wb_tint(px, sel, adjustments[1]);
    adjust::whites_blacks(px, sel, adjustments[6], adjustments[7]);
    if adjustments[8] != 0.0 {
        filters::texture_boost(
            px,
            w,
            h,
            sel,
            adjustments[8],
            DEV_TEXTURE_RADIUS * proxy_scale.clamp(0.05, 1.0),
        );
    }
    if adjustments[12] != 0.0 {
        filters::smart_sharpen(
            px,
            w,
            h,
            sel,
            adjustments[12],
            (1.0 * proxy_scale.clamp(0.05, 1.0)).max(0.35),
            0.15,
            0,
            0.0,
            0.0,
            0.0,
        );
    }
    if adjustments[13] > 0.0 {
        develop_denoise(px, w, h, sel, adjustments[13], proxy_scale);
    }
    if adjustments[14] > 0.0 {
        filters::reduce_noise(px, w, h, sel, 0.0, adjustments[14], 1.0, 0.0);
    }
    let defringe_width =
        (adjustments[15].clamp(-1.0, 1.0).abs() * 5.0 * proxy_scale.clamp(0.05, 1.0)).round()
            as i32;
    if defringe_width >= 1 {
        filters::defringe(px, w, h, sel, defringe_width);
    }
}

fn develop_local_masks(
    px: &mut [u16],
    w: u32,
    h: u32,
    global_selection: &Selection,
    masks: &[DevelopMask],
    crop_map: DevelopCropMap,
    proxy_scale: f32,
) {
    for mask in masks {
        if !mask.enabled {
            continue;
        }
        let mut coverage = develop_mask_coverage(mask, px, w, h, crop_map, proxy_scale);
        for (index, value) in coverage.iter_mut().enumerate() {
            *value = (*value as f32 * global_selection.coverage(index))
                .round()
                .clamp(0.0, 255.0) as u8;
        }
        if coverage.iter().all(|value| *value == 0) {
            continue;
        }
        let selection = Selection {
            w,
            h,
            active: true,
            mask: coverage,
            antialias: true,
        };
        develop_local_adjustments(px, w, h, &selection, mask.adjustments, proxy_scale);
    }
}

/// Basic's tone stages (1-3 of the develop: `camera_raw`, White Balance
/// Tint, Whites/Blacks) as one per-pixel map with no upper clip — what a RAW
/// sample above white becomes under the recipe. The u16 stages clip after each
/// step; this keeps the same maths but lets headroom ride through to the end.
pub(crate) struct DevelopBasicTone {
    tone: Option<adjust::CameraRawTone>,
    tint: f32,
    whites: f32,
    blacks: f32,
}

impl DevelopBasicTone {
    pub(crate) fn from_params(p: &[f32]) -> Self {
        // The develop renders nothing for an unknown version; neither does this.
        let known = p.first().is_none_or(|version| *version == 1.0);
        let g = |i: usize| if known { develop_stable_value(p, i) } else { 0.0 };
        let (temp, exposure, contrast) = (g(2), g(4), g(5));
        let (highlights, shadows) = (g(6), g(7));
        let (clarity, dehaze, vibrance, saturation) = (g(11), g(12), g(13), g(14));
        let active = [
            temp, exposure, contrast, highlights, shadows, clarity, dehaze, vibrance, saturation,
        ]
        .iter()
        .any(|value| *value != 0.0);
        DevelopBasicTone {
            tone: active.then(|| {
                adjust::CameraRawTone::new(
                    temp, exposure, contrast, highlights, shadows, clarity, dehaze, vibrance,
                    saturation,
                )
            }),
            tint: g(3),
            whites: g(8),
            blacks: g(9),
        }
    }

    pub(crate) fn is_neutral(&self) -> bool {
        self.tone.is_none() && self.tint == 0.0 && self.whites == 0.0 && self.blacks == 0.0
    }

    pub(crate) fn apply_extended(&self, rgb: [f32; 3]) -> [f32; 3] {
        let mut out = match &self.tone {
            Some(tone) => tone.apply(rgb, f32::INFINITY),
            None => rgb,
        };
        if self.tint != 0.0 {
            // `adjust::wb_tint`'s gains.
            let (g_gain, rb_gain) = (1.0 + self.tint * 0.3, 1.0 - self.tint * 0.3);
            out = [out[0] * rb_gain, out[1] * g_gain, out[2] * rb_gain];
        }
        if self.whites != 0.0 || self.blacks != 0.0 {
            // `adjust::whites_blacks`'s linear endpoint remap, open above white.
            let (black, white) = (-self.blacks * 0.5, 1.0 - self.whites * 0.5);
            let span = (white - black).max(1e-4);
            out = out.map(|c| ((c - black) / span).max(0.0));
        }
        out
    }
}

/// Whether a RAW's headroom plane still lines up with this recipe's output,
/// so the 32-bit open can read it beside the developed plane: no Geometry,
/// Transform or Crop resample moved a pixel, and no Profile / Camera
/// Calibration re-rendered colours the headroom never saw (the same rule the
/// develop's own recovery stage follows).
pub(crate) fn develop_preserves_headroom(p: &[f32], w: u32, h: u32) -> bool {
    let g = |i: usize| develop_stable_value(p, i);
    if g(1083) != 0.0 || g(1084) != 0.0 || g(1085) != 0.0 {
        return false;
    }
    let Some(advanced) = parse_develop_advanced(p) else {
        return true;
    };
    let xf = advanced.transform;
    let transformed = xf.aspect != 0.0
        || xf.scale != 1.0
        || xf.offset_x != 0.0
        || xf.offset_y != 0.0
        || xf.constrain_crop;
    !transformed
        && advanced.profile.is_neutral()
        && !advanced.has_lens_correction()
        && !DevelopCropMap::new(advanced.crop, w, h).moves_pixels(w, h)
}

/// A RAW import's highlight headroom (#443), kept sparse: only the pixels the
/// camera recorded above sRGB white in some channel while its sensor stayed
/// below its white level. Every other pixel is exactly its u16 value, so the
/// storage scales with the above-white area, not the frame: six bytes a pixel
/// plus eight a run of consecutive ones (a blown sky is a few runs a row).
#[derive(Clone, Debug, Default, PartialEq)]
pub(crate) struct RawHeadroom {
    // Runs of consecutive plane pixel indices (`y * width + x`) as (first,
    // length): increasing, non-empty, never touching.
    runs: Vec<(u32, u32)>,
    // Each pixel's RGB in run order, in extended-range sRGB (the encoding of
    // `u16 / 65535`, not clipped at white) as fixed point over
    // `RAW_HEADROOM_RANGE`.
    rgb: Vec<[u16; 3]>,
}

/// Encoded values the fixed point covers: 0..4, about linear 25× white (4.6
/// stops), in steps of 1/16384 (four u16 codes).
const RAW_HEADROOM_RANGE: f32 = 4.0;

impl RawHeadroom {
    #[cfg(test)]
    pub(crate) fn len(&self) -> usize {
        self.rgb.len()
    }

    pub(crate) fn is_empty(&self) -> bool {
        self.rgb.is_empty()
    }

    /// Heap bytes held: what a frame with this much above-white area costs.
    #[cfg(test)]
    pub(crate) fn storage_bytes(&self) -> usize {
        self.runs.capacity() * 8 + self.rgb.capacity() * 6
    }

    /// Record `pixel`; every builder appends in increasing pixel order.
    pub(crate) fn push(&mut self, pixel: u32, rgb: [f32; 3]) {
        match self.runs.last_mut() {
            Some((first, length)) if *first + *length == pixel => *length += 1,
            last => {
                debug_assert!(last.is_none_or(|(first, length)| *first + *length < pixel));
                self.runs.push((pixel, 1));
            }
        }
        let scale = 65535.0 / RAW_HEADROOM_RANGE;
        self.rgb.push(rgb.map(|value| (value.clamp(0.0, RAW_HEADROOM_RANGE) * scale).round() as u16));
    }

    /// Drop the growth slack once built: a decode keeps only what it found.
    pub(crate) fn shrink_to_fit(&mut self) {
        self.runs.shrink_to_fit();
        self.rgb.shrink_to_fit();
    }

    /// The RGB of the `entry`-th pixel (in pixel order).
    pub(crate) fn value(&self, entry: usize) -> [f32; 3] {
        self.rgb[entry].map(|value| value as f32 * (RAW_HEADROOM_RANGE / 65535.0))
    }

    /// (pixel, RGB) in pixel order.
    pub(crate) fn iter(&self) -> impl Iterator<Item = (usize, [f32; 3])> + '_ {
        self.runs
            .iter()
            .flat_map(|&(first, length)| first as usize..(first + length) as usize)
            .enumerate()
            .map(|(entry, pixel)| (pixel, self.value(entry)))
    }

    /// Rebuild from stored parts (a project file); `None` unless the runs are
    /// ordered, non-empty and inside a plane of `pixel_count` pixels, and hold
    /// exactly one RGB each.
    pub(crate) fn from_parts(runs: Vec<(u32, u32)>, rgb: Vec<[u16; 3]>, pixel_count: usize) -> Option<Self> {
        let mut end = 0u64;
        let mut total = 0u64;
        for (index, &(first, length)) in runs.iter().enumerate() {
            if length == 0 || (index > 0 && (first as u64) <= end) {
                return None;
            }
            end = first as u64 + length as u64;
            total += length as u64;
        }
        (end <= pixel_count as u64 && total == rgb.len() as u64).then_some(RawHeadroom { runs, rgb })
    }

    pub(crate) fn parts(&self) -> (&[(u32, u32)], &[[u16; 3]]) {
        (&self.runs, &self.rgb)
    }

    /// Whether this still describes the RGBA plane `px`: every channel it
    /// holds above white is white there. A plane any edit has since rewritten
    /// fails this, so a stale headroom can never feed a develop.
    pub(crate) fn describes(&self, px: &[u16]) -> bool {
        self.iter().all(|(pixel, rgb)| {
            px.get(pixel * 4..pixel * 4 + 3).is_some_and(|sample| {
                (0..3).all(|c| rgb[c] <= 1.0 || sample[c] == u16::MAX)
            })
        })
    }
}

#[cfg(test)]
pub(crate) fn develop_buf(px: &mut [u16], w: u32, h: u32, sel: &Selection, p: &[f32]) {
    develop_buf_with_headroom(px, w, h, sel, p, None, PROFILE_SRGB);
}

/// `develop_buf` over a RAW import that kept highlight headroom (#443): the
/// pixels `headroom` lists were clipped at white in `px` although the camera
/// recorded them below its white level. Those pixels are the only ones that
/// change: Basic's tone stages evaluate them without the white clip, so
/// negative Exposure / Highlights / Whites pull the recorded detail back into
/// range instead of darkening flat white. Every other pixel, and every recipe
/// whose Basic tone is neutral, stays on the bit-exact u16 path.
pub(crate) fn develop_buf_with_headroom(
    px: &mut [u16],
    w: u32,
    h: u32,
    sel: &Selection,
    p: &[f32],
    headroom: Option<&RawHeadroom>,
    working_profile: u8,
) {
    if p.first()
        .is_some_and(|version| !version.is_finite() || *version != 1.0)
    {
        return;
    }
    let headroom = headroom.filter(|headroom| headroom.describes(px));
    let g = |i: usize| develop_stable_value(p, i);
    let advanced = parse_develop_advanced(p);
    let extras = advanced
        .as_ref()
        .map_or(DEV_EXTRAS_NEUTRAL, |a| a.extras);
    let proxy_scale = g(1);
    // Basic
    let (temp, tint, exposure, contrast) = (g(2), g(3), g(4), g(5));
    let (highlights, shadows, whites, blacks) = (g(6), g(7), g(8), g(9));
    let (texture, clarity, dehaze, vibrance, saturation) = (g(10), g(11), g(12), g(13), g(14));
    // Detail
    let (sharpen_amount, sharpen_radius) = (g(15), g(16));
    let (nr_strength, nr_color, nr_detail) = (g(17), g(18), g(19));
    // Effects
    let (grain_amount, grain_highlight, grain_intensity) = (g(20), g(21), g(22));
    let (vignette_amount, vignette_mid) = (g(23), g(24));
    // Tone curve
    let curve_enabled = g(25) >= 0.5;

    // Advanced source profile + Camera Calibration are the first rendering
    // stage, before the stable legacy Basic/Curve/Detail prefix.
    if let Some(advanced) = advanced.as_ref() {
        develop_profile_calibration(px, sel, &advanced.profile);
    }

    // 1. Core tone/colour (skip when every slider is neutral — camera_raw is only a
    //    near-no-op at zero, so calling it would break byte-identity).
    if temp != 0.0
        || exposure != 0.0
        || contrast != 0.0
        || highlights != 0.0
        || shadows != 0.0
        || clarity != 0.0
        || dehaze != 0.0
        || vibrance != 0.0
        || saturation != 0.0
    {
        adjust::camera_raw(
            px, sel, temp, exposure, contrast, highlights, shadows, clarity, dehaze, vibrance,
            saturation, 0.0,
        );
    }
    // 2. White-balance tint, 3. whites/blacks endpoints (self-guarded at neutral).
    adjust::wb_tint(px, sel, tint);
    adjust::whites_blacks(px, sel, whites, blacks);
    // 3.5 RAW highlight recovery: re-run stages 1-3 without the white clip on
    //     the samples the import kept above white. Recovery reads the camera's
    //     own values, which the Profile / Camera Calibration stage never saw, so
    //     a non-neutral profile keeps today's clipped behaviour instead.
    let basic = DevelopBasicTone::from_params(p);
    let profiled = advanced.as_ref().is_some_and(|a| !a.profile.is_neutral());
    if let Some(headroom) = headroom.filter(|_| !basic.is_neutral() && !profiled) {
        for (i, source) in headroom.iter() {
            let cov = sel.coverage(i);
            if cov <= 0.0 {
                continue;
            }
            let toned = basic.apply_extended(source);
            for c in 0..3 {
                px[i * 4 + c] =
                    color::to16(color::lerp(source[c].min(1.0), toned[c].min(1.0), cov));
            }
        }
    }
    // 4. Texture (radius scaled to the proxy).
    filters::texture_boost(px, w, h, sel, texture, DEV_TEXTURE_RADIUS * proxy_scale);
    // 5. Tone curve — rebuild the four u8 LUTs from the f32 array (skip if disabled).
    if curve_enabled {
        let lut = |base: usize| -> Vec<u8> {
            (0..256)
                .map(|i| g(base + i).round().clamp(0.0, 255.0) as u8)
                .collect()
        };
        let master = lut(26);
        let rl = lut(26 + 256);
        let gl = lut(26 + 512);
        let bl = lut(26 + 768);
        adjust::curves(px, sel, &master, &rl, &gl, &bl);
    }
    // 6. Noise reduction (skip when both luma & colour strengths are zero — the
    //    bilateral pass denoises even at strength 0, so it is not neutral).
    //    Colour alone must stay chroma-only for the same reason: preserve_details
    //    is what makes the luma pass neutral, so with Noise Reduction at 0 it is
    //    pinned to 1 rather than following the (independent) Detail slider — the
    //    local-mask path at develop_local_adjustments already passes 1.0 here.
    //    The v5 extras add Contrast, Color Detail and Color Smoothness.
    if nr_strength != 0.0 || nr_color != 0.0 {
        let preserve_details = if nr_strength == 0.0 { 1.0 } else { nr_detail };
        filters::reduce_noise_ex(
            px,
            w,
            h,
            sel,
            nr_strength,
            nr_color,
            preserve_details,
            0.0,
            extras.nr_contrast,
            extras.color_detail,
            extras.color_smoothness,
        );
    }
    // 7. Sharpen (radius scaled to the proxy) with the v5 Detail + Masking.
    if sharpen_amount != 0.0 {
        filters::smart_sharpen_ex(
            px,
            w,
            h,
            sel,
            sharpen_amount,
            sharpen_radius * proxy_scale,
            0.0,
            0,
            0.0,
            0.0,
            0.0,
            extras.sharpen_detail,
            extras.sharpen_masking,
        );
    }
    // 8. Film grain (fixed seed for determinism).
    if grain_amount != 0.0 {
        filters::film_grain(
            px,
            sel,
            grain_amount,
            grain_highlight,
            grain_intensity,
            DEV_GRAIN_SEED,
        );
    }
    // 9. Post-crop vignette via lens_correction (no distortion/CA/scale).
    if vignette_amount != 0.0 {
        filters::lens_correction(px, w, h, sel, 0.0, vignette_amount, 0.0, 1.0, vignette_mid);
    }
    // 10. Optics: lens distortion + chromatic-aberration correction + the v5 lens
    //     Vignetting, then colour Defringe. Recipe stores normalized sliders; map
    //     to the coefficients lens_correction expects (distortion ±0.5, aberration
    //     ~0..0.05 — mirroring the Lens Correction dialog's /100 and /1000
    //     scaling). Defringe's reach scales to the proxy so the preview matches
    //     the full-res bake.
    let (opt_distortion, opt_aberration, opt_defringe) = (g(1050), g(1051), g(1052));
    if let Some(correction) = advanced.as_ref().and_then(|a| a.lens) {
        lens_profile::apply(px, w, h, sel, working_profile, correction,
            [opt_distortion * 0.5, extras.vignetting, opt_aberration * 0.05, -opt_aberration * 0.05, 1.0, 0.0]);
    } else if opt_distortion != 0.0 || opt_aberration != 0.0 || extras.vignetting != 0.0 {
        filters::lens_correction(
            px,
            w,
            h,
            sel,
            opt_distortion * 0.5,
            extras.vignetting,
            opt_aberration * 0.05,
            1.0,
            0.0,
        );
    }
    if opt_defringe > 0.0 || extras.green_amount > 0.0 {
        filters::defringe_color(
            px,
            w,
            h,
            sel,
            opt_defringe,
            extras.purple_hue,
            extras.green_amount,
            extras.green_hue,
            proxy_scale,
        );
    }
    // 11. HSL / Colour mixer: eight hue bands × (hue, saturation, luminance),
    //     appended after Optics as three contiguous 8-slider blocks:
    //     hue 1053..1061, saturation 1061..1069, luminance 1069..1077. Skipped
    //     unless a slider is non-zero (keeps the neutral recipe byte-identical).
    const HSL_BASE: usize = 1053;
    if (HSL_BASE..HSL_BASE + 24).any(|i| g(i) != 0.0) {
        let band = |o: usize| -> [f32; 8] {
            let mut a = [0.0f32; 8];
            for (k, slot) in a.iter_mut().enumerate() {
                *slot = g(HSL_BASE + o + k);
            }
            a
        };
        adjust::hsl_bands(px, sel, &band(0), &band(8), &band(16));
    }
    // 12. Color Grading: three colour wheels (Shadows, Midtones, Highlights) at
    //     1077..1083 as (hue°, sat) pairs. Skipped unless a region's saturation is
    //     non-zero (a hue with zero saturation is a no-op, so the guard is exact).
    const CG_BASE: usize = 1077;
    if (0..3).any(|r| g(CG_BASE + r * 2 + 1) != 0.0) {
        let mut wheels = [0.0f32; 6];
        for (k, wv) in wheels.iter_mut().enumerate() {
            *wv = g(CG_BASE + k);
        }
        adjust::color_grade(px, sel, &wheels);
    }
    // 12.5 Point Color (V3 advanced tail): up to eight sampled colour sockets,
    //      each a targeted hue/sat/lum shift around the picked colour. A pure
    //      colour op, so it runs on the un-warped pixels before Geometry. The
    //      sampled reference is stored as HSL; convert to an RGB target for the
    //      soft distance selection.
    if let Some(adv) = advanced.as_ref() {
        if !adv.point_colors.is_empty() {
            let sockets: Vec<adjust::PointColorSocket> = adv
                .point_colors
                .iter()
                .map(|pc| {
                    let (tr, tg, tb) = color::hsl_to_rgb(
                        pc.ref_hsl[0].rem_euclid(360.0),
                        pc.ref_hsl[1].clamp(0.0, 1.0),
                        pc.ref_hsl[2].clamp(0.0, 1.0),
                    );
                    adjust::PointColorSocket {
                        target: [tr, tg, tb],
                        range: pc.range.clamp(0.0, 1.0),
                        hue: pc.hue.clamp(-1.0, 1.0),
                        sat: pc.sat.clamp(-1.0, 1.0),
                        lum: pc.lum.clamp(-1.0, 1.0),
                    }
                })
                .collect();
            adjust::point_color(px, sel, &sockets);
        }
    }
    // 13. Geometry: parametric keystone + straighten (Vertical, Horizontal,
    //     Rotate) at 1083..1086, plus the v4-tail Transform extras (Aspect,
    //     Scale, X/Y Offset, Constrain Crop). A projective resample — skipped
    //     at neutral so the identity recipe stays byte-identical.
    let (geo_v, geo_h, geo_rot) = (g(1083), g(1084), g(1085));
    let xf = advanced
        .as_ref()
        .map_or(DEV_TRANSFORM_NEUTRAL, |a| a.transform);
    let xf_active = xf.aspect != 0.0
        || xf.scale != 1.0
        || xf.offset_x != 0.0
        || xf.offset_y != 0.0
        || xf.constrain_crop;
    if xf_active {
        geometry_transform_buf(px, w, h, geo_v, geo_h, geo_rot, xf);
    } else if geo_v != 0.0 || geo_h != 0.0 || geo_rot != 0.0 {
        geometry_keystone_buf(px, w, h, geo_v, geo_h, geo_rot);
    }
    if let Some(advanced) = advanced {
        // The remaining advanced stages are intentionally ordered and operate
        // on a fixed-size buffer: crop/transform, retouch, local masks, Enhance.
        let crop_map = DevelopCropMap::new(advanced.crop, w, h);
        develop_crop_to_fill(px, w, h, crop_map);
        develop_heal_spots(px, w, h, sel, &advanced.heals, crop_map, proxy_scale);
        develop_local_masks(px, w, h, sel, &advanced.masks, crop_map, proxy_scale);
        develop_enhance(
            px,
            w,
            h,
            sel,
            advanced.denoise_enabled,
            advanced.denoise_amount,
            advanced.raw_details,
            proxy_scale,
        );
    }
}

// Full LR Transform (GAL-DEV-07): the prefix keystone + straighten PLUS the
// v4-tail Aspect / Scale / X-Y Offset in ONE projective resample, then the
// optional Constrain Crop. Mirrors `geometry_keystone_buf`'s corner model
// exactly (unit-square keystone + rotation) so the three prefix floats render
// identically whether or not extras are active, then applies the affine extras
// to the same destination quad — a second resample would soften the image.
fn geometry_transform_buf(
    px: &mut [u16],
    w: u32,
    h: u32,
    vertical: f32,
    horizontal: f32,
    rotate: f32,
    xf: DevelopTransform,
) {
    let tv = vertical.clamp(-1.0, 1.0) * 0.25;
    let th = horizontal.clamp(-1.0, 1.0) * 0.25;
    let (sa, ca) = (rotate.clamp(-1.0, 1.0) * 15.0_f32.to_radians()).sin_cos();
    // Aspect ±1 → ±25% reciprocal width/height stretch (+ = narrower/taller,
    // matching LR's slider direction); Scale zooms about the centre; Offsets
    // shift by up to half a frame per unit, like LR's ±100 percent range.
    let a = xf.aspect.clamp(-1.0, 1.0) * 0.25;
    let (ax, ay) = (1.0 - a, 1.0 + a);
    let s = xf.scale.clamp(0.25, 4.0);
    let (ox, oy) = (
        xf.offset_x.clamp(-1.0, 1.0) * 0.5,
        xf.offset_y.clamp(-1.0, 1.0) * 0.5,
    );
    let base = [
        (0.0 - tv, 0.0 - th),
        (1.0 + tv, 0.0 + th),
        (1.0 - tv, 1.0 - th),
        (0.0 + tv, 1.0 + th),
    ];
    let (fw, fh) = (w as f32, h as f32);
    let mut c = [0.0f32; 8];
    for (i, &(nx, ny)) in base.iter().enumerate() {
        let (dx, dy) = (nx - 0.5, ny - 0.5);
        // Keystone-rotated corner, then aspect + scale about the centre, then
        // the offset translation — all still in unit-square space.
        let rx = dx * ca - dy * sa;
        let ry = dx * sa + dy * ca;
        c[i * 2] = (rx * ax * s + 0.5 + ox) * fw;
        c[i * 2 + 1] = (ry * ay * s + 0.5 + oy) * fh;
    }
    let (m, ok) = square_to_quad(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    if !ok {
        return;
    }
    let inv = Engine::perspective_inverse_transform(w as i32, h as i32, m);
    let warped = Engine::transform_pixels_with_inverse(px, w as i32, h as i32, inv);
    px.copy_from_slice(&warped);
    if xf.constrain_crop {
        if let Some(crop) = constrain_crop_rect(&c, w, h) {
            develop_crop_to_fill(px, w, h, DevelopCropMap::new(crop, w, h));
        }
    }
}

/// LR's Constrain Crop: the largest frame-aspect rect inside the warped quad,
/// as a crop-to-fill (so no transparent border survives the geometry warp).
/// ponytail: binary-search a frame-aspect rect about the quad centroid — not
/// the true max-area inscribed rect; upgrade to an exact quad-inscription
/// solve if Constrain Crop visibly over-crops on strong keystones.
fn constrain_crop_rect(c: &[f32; 8], w: u32, h: u32) -> Option<DevelopCrop> {
    let (fw, fh) = (w.max(1) as f32, h.max(1) as f32);
    let cx = (c[0] + c[2] + c[4] + c[6]) * 0.25;
    let cy = (c[1] + c[3] + c[5] + c[7]) * 0.25;
    // Convex quad (corners in TL,TR,BR,BL order): inside ⇔ all edge cross
    // products share a sign.
    let inside = |x: f32, y: f32| {
        let mut sign = 0.0f32;
        for i in 0..4 {
            let j = (i + 1) % 4;
            let cross = (c[j * 2] - c[i * 2]) * (y - c[i * 2 + 1])
                - (c[j * 2 + 1] - c[i * 2 + 1]) * (x - c[i * 2]);
            if cross.abs() > 1e-3 {
                if sign == 0.0 {
                    sign = cross.signum();
                } else if cross.signum() != sign {
                    return false;
                }
            }
        }
        true
    };
    let fits = |scale: f32| {
        let (hw, hh) = (scale * fw * 0.5, scale * fh * 0.5);
        inside(cx - hw, cy - hh)
            && inside(cx + hw, cy - hh)
            && inside(cx + hw, cy + hh)
            && inside(cx - hw, cy + hh)
    };
    if !fits(1e-3) {
        return None; // degenerate warp — leave the buffer alone
    }
    let (mut lo, mut hi) = (0.0f32, 1.0f32);
    for _ in 0..24 {
        let mid = 0.5 * (lo + hi);
        if fits(mid) {
            lo = mid;
        } else {
            hi = mid;
        }
    }
    if lo >= 0.999 {
        return None; // the full frame already fits — nothing to crop
    }
    Some(DevelopCrop {
        enabled: true,
        x: ((cx - lo * fw * 0.5) / fw).clamp(0.0, 1.0),
        y: ((cy - lo * fh * 0.5) / fh).clamp(0.0, 1.0),
        width: lo,
        height: lo,
        angle: 0.0,
        constrain_aspect: false,
        aspect_ratio: 1.0,
        flip_h: false,
        flip_v: false,
    })
}

#[cfg(test)]
mod develop_transform_tests {
    use super::*;

    /// Minimal valid v4 tail: profile/crop/enhance neutral, no heals/masks,
    /// identity curve source, zero sockets, then the 5 transform floats.
    pub(super) fn v4_params(aspect: f32, scale: f32, ox: f32, oy: f32, constrain: f32) -> Vec<f32> {
        let mut p = vec![0.0f32; DEV_ADVANCED_BASE];
        p[0] = 1.0;
        p[1] = 1.0;
        p.push(DEV_ADVANCED_MAGIC);
        p.push(DEV_ADVANCED_V4);
        p.extend_from_slice(&[0.0; 23]); // profile..enhance [1088..=1110]
        p.push(0.0); // heal_count [1111]
        p.push(0.0); // mask_count
        p.extend_from_slice(&[0.0; 4]); // parametric
        for _ in 0..4 {
            p.extend_from_slice(&[2.0, 0.0, 0.0, 1.0, 1.0]); // identity channel
        }
        p.push(0.0); // point-color socket count
        p.extend_from_slice(&[aspect, scale, ox, oy, constrain]);
        p
    }

    /// Left half selected, right half outside the marquee.
    fn left_half(w: u32, h: u32) -> Selection {
        let mut sel = Selection::new(w, h);
        sel.rect(0, 0, (w / 2) as i32, h as i32, SelMode::Replace);
        sel
    }

    /// (y-banded) test plane so every row carries a distinct value.
    fn banded_plane(w: u32, h: u32) -> Vec<u16> {
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                let v = 5000 + y as u16 * 7000;
                px[o] = v;
                px[o + 1] = v;
                px[o + 2] = v;
                px[o + 3] = 65535;
            }
        }
        px
    }

    fn changed(before: &[u16], after: &[u16], w: u32, x: u32, y: u32) -> bool {
        let o = ((y * w + x) * 4) as usize;
        before[o..o + 3] != after[o..o + 3]
    }

    #[test]
    fn color_noise_alone_leaves_luminance_untouched() {
        // Detail ▸ Color Noise is a chroma control. The luma bilateral runs on
        // the same call and is only neutral at preserve_details = 1, so passing
        // the (zero) Detail slider through smoothed luma while the Noise
        // Reduction slider still read 0.
        let (w, h) = (8u32, 8u32);
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[18] = 1.0; // Color Noise; p[17] Noise Reduction stays 0
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                // Neutral, so chroma denoising is a no-op and only a luma pass
                // can move a sample.
                let o = ((y * w + x) * 4) as usize;
                let v = 30000 + ((x * 7 + y * 13) % 5) as u16 * 350;
                px[o] = v;
                px[o + 1] = v;
                px[o + 2] = v;
                px[o + 3] = 65535;
            }
        }
        let before = px.clone();
        develop_buf(&mut px, w, h, &Selection::new(w, h), &p);
        assert_eq!(px, before, "Color Noise alone ran the luminance bilateral");
    }

    #[test]
    fn profile_calibration_clips_to_the_selection() {
        // (#77) Profile + Camera Calibration is a per-pixel colour stage; the
        // marquee must clip it like camera_raw / wb_tint / curves.
        let (w, h) = (8u32, 8u32);
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[1088] = 1.0; // Adobe Color
        p[1089] = 1.0; // full amount
        let mut px = vec![0u16; (w * h * 4) as usize];
        for pixel in px.chunks_exact_mut(4) {
            pixel.copy_from_slice(&[50000, 10000, 10000, 65535]);
        }
        let before = px.clone();
        develop_buf(&mut px, w, h, &left_half(w, h), &p);
        assert!(changed(&before, &px, w, 1, 3), "selected pixel is profiled");
        assert!(
            !changed(&before, &px, w, 6, 3),
            "pixel outside the marquee keeps its colour"
        );
    }

    #[test]
    fn enhance_denoise_clips_to_the_selection() {
        // (#78) Enhance ran on a locally-built full Selection, smoothing the
        // whole plane regardless of the marquee.
        let (w, h) = (8u32, 8u32);
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[1107] = 1.0; // denoise_enabled
        p[1108] = 1.0; // denoise_amount
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                // Low-amplitude noise: inside the bilateral colour sigma, so it
                // actually gets smoothed (a hard checkerboard would not).
                let v = 30000 + ((x * 7 + y * 13) % 5) as u16 * 350;
                px[o] = v;
                px[o + 1] = v;
                px[o + 2] = v;
                px[o + 3] = 65535;
            }
        }
        let before = px.clone();
        develop_buf(&mut px, w, h, &left_half(w, h), &p);
        assert!(changed(&before, &px, w, 1, 3), "selected pixel is denoised");
        assert!(
            !changed(&before, &px, w, 6, 3),
            "pixel outside the marquee is left alone"
        );
    }

    #[test]
    fn heal_spots_clip_to_the_selection() {
        // (#79) Retouch discs wrote unconditionally; only the disc inside the
        // marquee may land.
        let (w, h) = (8u32, 8u32);
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[1111] = 2.0; // heal_count
        let norm = |v: u32, n: u32| (v as f32 + 0.5) / n as f32;
        let mut spots = Vec::new();
        for x in [1u32, 6u32] {
            // Clone (mode 1) row 6 from row 0, radius ~1.5px, hard edge.
            spots.extend_from_slice(&[
                1.0,
                norm(x, w),
                norm(6, h),
                norm(x, w),
                norm(0, h),
                0.19,
                0.0,
                1.0,
            ]);
        }
        p.splice(1112..1112, spots);
        let mut px = banded_plane(w, h);
        let before = px.clone();
        develop_buf(&mut px, w, h, &left_half(w, h), &p);
        assert!(changed(&before, &px, w, 1, 6), "selected spot is cloned");
        assert!(
            !changed(&before, &px, w, 6, 6),
            "spot outside the marquee does not retouch"
        );
    }

    #[test]
    fn v4_tail_parses_and_carries_the_transform_block() {
        let advanced = parse_develop_advanced(&v4_params(0.5, 1.5, -0.25, 0.1, 1.0))
            .expect("valid v4 tail must parse");
        let t = advanced.transform;
        assert_eq!(
            (t.aspect, t.scale, t.offset_x, t.offset_y, t.constrain_crop),
            (0.5, 1.5, -0.25, 0.1, true)
        );

        // Out-of-range values reject the whole tail atomically.
        assert!(parse_develop_advanced(&v4_params(0.0, 5.0, 0.0, 0.0, 0.0)).is_none());
        assert!(parse_develop_advanced(&v4_params(1.5, 1.0, 0.0, 0.0, 0.0)).is_none());
        assert!(parse_develop_advanced(&v4_params(0.0, 1.0, 0.0, 0.0, 0.5)).is_none());

        // A v3 tail (same payload, no transform block) still parses — and a v3
        // tail with a trailing transform block is trailing data → rejected.
        let mut v3 = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        v3.truncate(v3.len() - 5);
        v3[1087] = DEV_ADVANCED_V3;
        let advanced = parse_develop_advanced(&v3).expect("v3 tail must keep parsing");
        assert!(!advanced.transform.constrain_crop);
        assert_eq!(advanced.transform.scale, 1.0);
        let mut v3_extra = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        v3_extra[1087] = DEV_ADVANCED_V3;
        assert!(parse_develop_advanced(&v3_extra).is_none());
    }

    #[test]
    fn offset_shifts_the_image_and_scale_zooms() {
        // 16×16 transparent buffer with an opaque white marker at (4,8).
        let (w, h) = (16u32, 16u32);
        let mut px = vec![0u16; (w * h * 4) as usize];
        let at = |x: u32, y: u32| ((y * w + x) * 4) as usize;
        for ch in 0..4 {
            px[at(4, 8) + ch] = 65535;
        }
        // offset_x 1.0 = half a frame right (±1 → ±w/2): marker (4,8) → (12,8).
        let mut shifted = px.clone();
        let xf = DevelopTransform {
            offset_x: 1.0,
            ..DEV_TRANSFORM_NEUTRAL
        };
        geometry_transform_buf(&mut shifted, w, h, 0.0, 0.0, 0.0, xf);
        assert!(shifted[at(12, 8) + 3] > 0, "marker moved right by w/2");
        assert_eq!(shifted[at(4, 8) + 3], 0, "old position vacated");

        // Scale 2 about the centre: the marker at (4,8) maps toward (0,8).
        let mut zoomed = px.clone();
        let xf = DevelopTransform {
            scale: 2.0,
            ..DEV_TRANSFORM_NEUTRAL
        };
        geometry_transform_buf(&mut zoomed, w, h, 0.0, 0.0, 0.0, xf);
        assert!(zoomed[at(0, 8) + 3] > 0, "marker doubled away from centre");
    }

    #[test]
    fn constrain_crop_removes_the_transparent_corners_a_rotation_exposes() {
        let (w, h) = (32u32, 32u32);
        let mut opaque = vec![65535u16; (w * h * 4) as usize];
        let corner = 0usize; // (0,0) RGBA base
        let mut rotated = opaque.clone();
        geometry_transform_buf(&mut rotated, w, h, 0.0, 0.0, 0.5, DEV_TRANSFORM_NEUTRAL);
        assert_eq!(rotated[corner + 3], 0, "rotation exposes a transparent corner");

        let xf_constrained = DevelopTransform {
            constrain_crop: true,
            ..DEV_TRANSFORM_NEUTRAL
        };
        geometry_transform_buf(&mut opaque, w, h, 0.0, 0.0, 0.5, xf_constrained);
        assert!(
            opaque[corner + 3] > 0,
            "constrain crop re-fills the frame with opaque pixels"
        );
    }
}

#[cfg(test)]
mod develop_extras_tests {
    use super::develop_transform_tests::v4_params;
    use super::*;

    /// [sharpenDetail, sharpenMasking, nrContrast, colorDetail, colorSmoothness,
    ///  vignetting, purpleHueLo, purpleHueHi, greenAmount, greenHueLo, greenHueHi,
    ///  upright] at their neutral values.
    const NEUTRAL: [f32; 12] = [
        25.0, 0.0, 0.0, 50.0, 50.0, 0.0, 30.0, 70.0, 0.0, 40.0, 60.0, 0.0,
    ];

    fn v5_params(extras: [f32; 12]) -> Vec<f32> {
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[1087] = DEV_ADVANCED_V5;
        p.extend_from_slice(&extras);
        p
    }

    /// Low-amplitude texture over a hard luma edge at x = 12, with a purple
    /// fringe column left of the edge and a green one right of it.
    fn plane(w: u32, h: u32) -> Vec<u16> {
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                let n = ((x * 7919 + y * 104729) % 97) as u16 * 90;
                let edge = if x >= 12 { 26000 } else { 0 };
                px[o] = 18000 + edge + n;
                px[o + 1] = 21000 + edge / 2 + n / 2;
                px[o + 2] = 30000 - edge / 3 + n;
                px[o + 3] = 65535;
                if x == 11 {
                    px[o..o + 3].copy_from_slice(&[30000, 10000, 40000]);
                } else if x == 12 {
                    px[o..o + 3].copy_from_slice(&[20000, 50000, 24000]);
                }
            }
        }
        px
    }

    fn fnv(px: &[u16]) -> u64 {
        px.iter().fold(0xcbf2_9ce4_8422_2325u64, |hash, v| {
            (hash ^ *v as u64).wrapping_mul(0x0100_0000_01b3)
        })
    }

    fn render(p: &[f32]) -> Vec<u16> {
        let (w, h) = (24u32, 24u32);
        let mut px = plane(w, h);
        develop_buf(&mut px, w, h, &Selection::new(w, h), p);
        px
    }

    #[test]
    fn v5_tail_parses_every_extra_and_v4_still_parses() {
        let extras = [
            40.0, 60.0, 30.0, 70.0, 20.0, -0.5, 10.0, 90.0, 0.75, 20.0, 80.0, 5.0,
        ];
        let x = parse_develop_advanced(&v5_params(extras))
            .expect("valid v5 tail must parse")
            .extras;
        assert_eq!(
            (
                x.sharpen_detail,
                x.sharpen_masking,
                x.nr_contrast,
                x.color_detail,
                x.color_smoothness
            ),
            (40.0, 60.0, 30.0, 70.0, 20.0)
        );
        assert_eq!(x.vignetting, -0.5);
        assert_eq!(
            (x.purple_hue, x.green_amount, x.green_hue),
            ([10.0, 90.0], 0.75, [20.0, 80.0])
        );

        let v4 = parse_develop_advanced(&v4_params(0.0, 1.5, 0.0, 0.0, 0.0))
            .expect("a v4 tail keeps parsing");
        assert_eq!(v4.transform.scale, 1.5);
        assert_eq!(v4.extras.sharpen_detail, 25.0);
        // A v4 tail followed by an extras block is trailing data.
        let mut v4_with_extras = v5_params(extras);
        v4_with_extras[1087] = DEV_ADVANCED_V4;
        assert!(parse_develop_advanced(&v4_with_extras).is_none());
    }

    #[test]
    fn an_invalid_extra_rejects_the_whole_tail() {
        for (index, value) in [
            (0, 101.0),      // sharpen detail > 100
            (4, -1.0),       // colour smoothness < 0
            (3, f32::NAN),   // non-finite
            (5, 1.5),        // vignetting outside -1..1
            (6, 80.0),       // purple hue lo above hi (70)
            (8, 1.1),        // green amount > 1
            (10, 30.0),      // green hue hi below lo (40)
            (11, 6.0),       // unknown Upright mode
            (11, 2.5),       // non-integral Upright mode
        ] {
            let mut extras = NEUTRAL;
            extras[index] = value;
            assert!(
                parse_develop_advanced(&v5_params(extras)).is_none(),
                "extras[{index}] = {value} must reject the tail"
            );
        }
        let mut truncated = v5_params(NEUTRAL);
        truncated.pop();
        assert!(parse_develop_advanced(&truncated).is_none());
    }

    #[test]
    fn neutral_extras_keep_the_pre_v5_render() {
        // Captured from the kernels before #444 (sharpen 0.8, noise reduction 0.6,
        // colour noise 0.6, lens distortion 0.4 + CA 0.5) on this plane without
        // its fringe columns. A V4 tail and a neutral V5 block must keep those bytes.
        const PRE_444: u64 = 0x2a8c_01c6_0a3e_e594;
        for mut p in [v4_params(0.0, 1.0, 0.0, 0.0, 0.0), v5_params(NEUTRAL)] {
            p[15] = 0.8;
            p[16] = 1.0;
            p[17] = 0.6;
            p[18] = 0.6;
            p[19] = 0.3;
            p[1050] = 0.4;
            p[1051] = 0.5;
            let (w, h) = (24u32, 24u32);
            let mut px = plane(w, h);
            for y in 0..h {
                for x in [11u32, 12] {
                    // The golden predates the fringe columns: restore the plain texture.
                    let o = ((y * w + x) * 4) as usize;
                    let n = ((x * 7919 + y * 104729) % 97) as u16 * 90;
                    let edge = if x >= 12 { 26000 } else { 0 };
                    px[o..o + 3].copy_from_slice(&[
                        18000 + edge + n,
                        21000 + edge / 2 + n / 2,
                        30000 - edge / 3 + n,
                    ]);
                }
            }
            develop_buf(&mut px, w, h, &Selection::new(w, h), &p);
            assert_eq!(fnv(&px), PRE_444, "tail version {}", p[1087]);
        }
    }

    #[test]
    fn every_extra_changes_the_render() {
        // Noise reduction runs only for its own knobs: Color Noise smears the
        // fringe columns' chroma out of the Defringe hue windows.
        let with_prefix = |extras: [f32; 12], noise: bool| {
            let mut p = v5_params(extras);
            p[15] = 0.8; // Sharpening
            p[16] = 1.0;
            if noise {
                p[17] = 0.6; // Noise Reduction
                p[18] = 0.6; // Color Noise
                p[19] = 0.3;
            }
            p[1052] = 0.8; // Purple Defringe
            p
        };
        let with = |base: [f32; 12], edits: &[(usize, f32)]| {
            let mut extras = base;
            for &(index, value) in edits {
                extras[index] = value;
            }
            extras
        };
        let green_on = with(NEUTRAL, &[(8, 1.0)]);
        for (label, base, edits) in [
            ("sharpen detail 0", NEUTRAL, &[(0, 0.0)][..]),
            ("sharpen detail 100", NEUTRAL, &[(0, 100.0)]),
            ("masking", NEUTRAL, &[(1, 80.0)]),
            ("luminance contrast", NEUTRAL, &[(2, 100.0)]),
            ("color detail 100", NEUTRAL, &[(3, 100.0)]),
            ("color detail 0", NEUTRAL, &[(3, 0.0)]),
            ("color smoothness", NEUTRAL, &[(4, 100.0)]),
            ("vignetting +", NEUTRAL, &[(5, 0.5)]),
            ("vignetting -", NEUTRAL, &[(5, -0.5)]),
            // [0, 20] of the purple arc leaves the fringe column out.
            ("purple hue window", NEUTRAL, &[(6, 0.0), (7, 20.0)]),
            ("green amount", NEUTRAL, &[(8, 1.0)]),
            // [80, 100] of the green arc leaves the green fringe out.
            ("green hue window", green_on, &[(9, 80.0), (10, 100.0)]),
        ] {
            let noise = ["luminance", "color"].iter().any(|k| label.starts_with(k));
            assert_ne!(
                render(&with_prefix(with(base, edits), noise)),
                render(&with_prefix(base, noise)),
                "{label}"
            );
        }
    }

    #[test]
    fn upright_rides_the_tail_without_rendering() {
        // The solved Upright correction is baked into p[1083..1085]; the mode
        // code itself must not change a pixel.
        let mut auto = NEUTRAL;
        auto[11] = 1.0;
        assert_eq!(render(&v5_params(auto)), render(&v5_params(NEUTRAL)));
    }
}

#[cfg(test)]
mod develop_profile_tests {
    use super::develop_transform_tests::v4_params;
    use super::*;

    const NEUTRAL_EXTRAS: [f32; 12] = [
        25.0, 0.0, 0.0, 50.0, 50.0, 0.0, 30.0, 70.0, 0.0, 40.0, 60.0, 0.0,
    ];

    /// A V6 tail naming profile `code` at `amount` through `words`, with an
    /// unknown as-shot white.
    fn v6_params(code: f32, amount: f32, words: &[f32]) -> Vec<f32> {
        let mut p = v4_params(0.0, 1.0, 0.0, 0.0, 0.0);
        p[1087] = DEV_ADVANCED_V6;
        p[1088] = code;
        p[1089] = amount;
        p.extend_from_slice(&NEUTRAL_EXTRAS);
        p.extend_from_slice(words);
        p.push(0.0);
        p
    }

    fn words(digest: &str) -> Vec<f32> {
        (0..8)
            .map(|i| u16::from_str_radix(&digest[i * 4..i * 4 + 4], 16).unwrap() as f32)
            .collect()
    }

    fn render(p: &[f32]) -> Vec<u16> {
        let (w, h) = (6u32, 4u32);
        let mut px: Vec<u16> = (0..(w * h) as u16)
            .flat_map(|i| {
                let (r, g, b) = (i * 2111 % 50000, i * 977 % 20000, i * 613 % 30000);
                [9000 + r, 30000 - g, 12000 + b, 65535]
            })
            .collect();
        develop_buf(&mut px, w, h, &Selection::new(w, h), p);
        px
    }

    #[test]
    fn a_registered_profile_renders_and_an_unknown_one_is_camera_default() {
        let before = render(&[1.0, 1.0]);
        let shifted =
            dcp::parse_profile(&dcp::tests::dcp_bytes("Shift", Some(90.0), true)).unwrap();
        let id = words(&shifted.digest);
        // Not registered yet: Custom renders as Camera Default.
        assert_eq!(render(&v6_params(5.0, 1.0, &id)), before);
        dcp::register_profile(shifted);
        let full = render(&v6_params(5.0, 1.0, &id));
        assert_ne!(full, before, "the profile changes the render");
        assert_eq!(
            render(&v6_params(4.0, 1.0, &id)),
            full,
            "Embedded renders the same tables"
        );
        // Amount blends toward the unprofiled pixels; 0 is a no-op.
        assert_eq!(render(&v6_params(5.0, 0.0, &id)), before);
        let half = render(&v6_params(5.0, 0.5, &id));
        for i in (0..half.len()).filter(|i| i % 4 != 3) {
            let (lo, hi) = (before[i].min(full[i]), before[i].max(full[i]));
            assert!(half[i] + 1 >= lo && half[i] <= hi + 1, "channel {i}");
        }
        // A built-in look ignores the identity.
        let mut mono = v6_params(3.0, 1.0, &id);
        let mono_render = render(&mono);
        mono.truncate(mono.len() - 21);
        mono[1087] = DEV_ADVANCED_V4;
        assert_eq!(mono_render, render(&mono));
    }

    /// A Smart Object over `render`'s plane whose Camera Raw filter develops
    /// through `digest`.
    fn profiled_smart_object(id: &[f32]) -> (Engine, u32) {
        let (w, h) = (6u32, 4u32);
        let px: Vec<u16> = (0..(w * h) as u16)
            .flat_map(|i| {
                [
                    9000 + i * 2111 % 50000,
                    30000 - i * 977 % 20000,
                    12000 + i * 613 % 30000,
                    65535,
                ]
            })
            .collect();
        let mut e = Engine::with_initial_pixels(w, h, px, 16).unwrap();
        let layer = e.active_layer_id();
        e.convert_to_smart_object(layer);
        let layer = e.active_layer_id();
        e.smart_add_filter(layer, 17, &v6_params(5.0, 1.0, id));
        (e, layer)
    }

    #[test]
    fn matrix_profile_amount_and_source_context_survive_saved_smart_object_replay() {
        let mut matrix = dcp::tests::XYZ_TO_SRGB;
        for c in 0..3 { matrix.swap(c, 6 + c); }
        let profile = dcp::parse_profile(&dcp::tests::tiff_bytes(0x4352, true, &[
            (50721, dcp::tests::Val::SRational(matrix.to_vec())),
            (50936, dcp::tests::Val::Ascii("Matrix-only swap")),
        ])).unwrap();
        let id = words(&profile.digest);
        dcp::register_profile(profile);
        let source = dcp::DcpSource::from_raw(raw_fallback_camera_to_xyz(), [1.0; 4]).unwrap();
        let before = render(&[1.0, 1.0]);
        let full = render(&with_profile_source(&v6_params(5.0, 1.0, &id), Some(source)));
        assert_ne!(full, before);
        assert_eq!(render(&with_profile_source(&v6_params(4.0, 1.0, &id), Some(source))), full);
        assert_eq!(render(&with_profile_source(&v6_params(5.0, 0.0, &id), Some(source))), before);
        let half = render(&with_profile_source(&v6_params(5.0, 0.5, &id), Some(source)));
        for i in 0..half.len() {
            assert!(u32::from(half[i]) + 1 >= u32::from(before[i].min(full[i])) && u32::from(half[i]) <= u32::from(before[i].max(full[i])) + 1);
        }

        // A legacy V6 project has cached pixels and a declared RAW owner. Its
        // saved source envelope supplies the basis before any filter is replayed.
        let (mut e, layer) = profiled_smart_object(&id);
        assert_eq!(e.smart_filter_params(layer, 0)[1087], DEV_ADVANCED_V6);
        let history = e.undo_pushes();
        assert_eq!(e.refresh_develop_profiles(Some(layer), Some(source.words())), 1);
        assert_eq!(e.undo_pushes(), history, "source hydration is not an edit");
        let params = e.smart_filter_params(layer, 0);
        assert_eq!(params[1087], DEV_ADVANCED_V7);
        assert_eq!(&params[params.len() - 12..], source.words());
        let expected = e.export_composite_rgba16();
        let mut reopened = Engine::load_project(&e.save_project()).unwrap();
        let restored = reopened.active_layer_id();
        reopened.set_smart_filters_enabled(restored, false);
        reopened.set_smart_filters_enabled(restored, true);
        assert_eq!(reopened.export_composite_rgba16(), expected);

        // A document retaining RAW metadata must not impose its camera basis
        // on a later, unrelated RGB layer. Only explicit source provenance can.
        let mut raw_doc = Engine::from_raw(&crate::raster::raw_import_pipeline::tiny_linear_dng(8, 6, 3)).unwrap();
        let mut rgb_doc = Engine::new(8, 6);
        for doc in [&mut raw_doc, &mut rgb_doc] {
            doc.add_layer("Unrelated RGB");
            doc.select_rect(0, 0, 8, 6, 0);
            doc.fill_selection(50, 120, 160, 255);
            doc.select_none();
            doc.camera_raw_develop(&v6_params(5.0, 1.0, &id));
        }
        assert_eq!(raw_doc.export_composite_rgba16(), rgb_doc.export_composite_rgba16());
    }

    #[test]
    fn v8_lens_rendering_and_v7_camera_hydration_preserve_each_other() {
        let lens = |enabled: f32| {
            let mut words = vec![enabled, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 32.0];
            words.extend([b'a' as f32; 32]);
            words.extend([0.0,0.12,0.0,0.0, 1.0,0.0,0.0, 1.0,0.0,0.0, -0.2,0.0,0.0]);
            words
        };
        let mut p = v6_params(0.0, 1.0, &[0.0; 8]);
        p.truncate(p.len() - 9); p[1087] = DEV_ADVANCED_V8;
        p.push(0.0); // JPEG/default profile: no invented camera identity/basis
        p.extend(lens(1.0));
        assert!(parse_develop_advanced(&p).unwrap().lens.is_some());
        assert!(!develop_preserves_headroom(&p, 6, 4), "calibrated geometry/gain invalidates the original RAW coordinates/values");
        let mut neutral_lens = p.clone();
        let start = neutral_lens.len() - 13;
        neutral_lens[start..].fill(0.0); neutral_lens[start + 4] = 1.0; neutral_lens[start + 7] = 1.0;
        assert!(develop_preserves_headroom(&neutral_lens, 6, 4), "an identity profile keeps usable headroom");
        let before = render(&[1.0, 1.0]);
        let correction = lens_profile::Correction::parse(&[1.0,1.0, 0.0,0.12,0.0,0.0, 1.0,0.0,0.0, 1.0,0.0,0.0, -0.2,0.0,0.0]).unwrap();
        let mut expected = before.clone();
        lens_profile::apply(&mut expected, 6, 4, &Selection::new(6,4), PROFILE_SRGB, correction, [0.0,0.0,0.0,0.0,1.0,0.0]);
        assert_eq!(render(&p), expected);
        assert_ne!(expected, before);
        // Camera Raw Filter is also available on non-RAW working documents.
        // Its calibrated vignette must decode the actual transfer curve,
        // matching the direct Lens Correction operation and fid118.
        let filter = [0.0,0.0,0.0,0.0,1.0,0.0, 1.0,1.0, 0.0,0.12,0.0,0.0, 1.0,0.0,0.0, 1.0,0.0,0.0, -0.2,0.0,0.0];
        for profile in [PROFILE_ADOBE_RGB, PROFILE_REC2020] {
            let make = || {
                let mut doc = Engine::with_initial_pixels(6, 4, [5000,6000,7000,65535].repeat(24), 16).unwrap();
                doc.assign_profile(profile); doc
            };
            let mut direct = make(); direct.filter_lens_profile(&filter);
            let mut camera = make(); camera.camera_raw_develop(&p);
            assert_eq!(camera.export_composite_rgba16(), direct.export_composite_rgba16(), "working profile {profile}");
            let mut smart = make(); smart.convert_to_smart_object(smart.active_layer_id());
            smart.smart_add_filter(smart.active_layer_id(), 17, &p);
            assert_eq!(smart.export_composite_rgba16(), direct.export_composite_rgba16(), "smart working profile {profile}");
        }
        p.truncate(p.len() - lens(1.0).len()); p.extend(lens(0.0));
        assert_eq!(render(&p), before, "disabled choice remains a no-op");
        assert!(develop_preserves_headroom(&p, 6, 4), "a disabled profile preserves headroom");

        let mut combined = v6_params(5.0, 1.0, &[0.0; 8]);
        let identity = combined.split_off(combined.len() - 9);
        combined[1087] = DEV_ADVANCED_V8; combined.push(9.0); combined.extend(identity); combined.extend(lens(1.0));
        let source = dcp::DcpSource::from_raw(raw_fallback_camera_to_xyz(), [1.0; 4]).unwrap();
        let hydrated = with_profile_source(&combined, Some(source));
        assert_eq!(hydrated[1087], DEV_ADVANCED_V8);
        assert_eq!(&hydrated[hydrated.len() - lens(1.0).len()..], lens(1.0));
        let parsed = parse_develop_advanced(&hydrated).unwrap();
        assert!(parsed.profile.source.is_some() && parsed.lens.is_some());
        let mut truncated = hydrated; truncated.pop();
        assert!(parse_develop_advanced(&truncated).is_none());
    }

    fn set_host(bytes: Option<(String, Vec<u8>)>) {
        dcp::tests::HOST.with(|host| {
            *host.borrow_mut() =
                bytes.map(|(digest, bytes)| -> Box<dyn Fn(&str) -> Option<Vec<u8>>> {
                    Box::new(move |asked| (asked == digest).then(|| bytes.clone()))
                })
        });
    }

    #[test]
    fn an_evicted_profile_comes_back_from_the_host_when_a_layer_re_renders() {
        // The verifier's repro: a reopened Smart Object's profile falls out of
        // the registry while other profiles are browsed, then the layer
        // re-renders (filter off/on) — and must not turn into Camera Default.
        let bytes = dcp::tests::dcp_bytes("Shift", Some(90.0), true);
        let profile = dcp::parse_profile(&bytes).unwrap();
        let (digest, id) = (profile.digest.clone(), words(&profile.digest));
        dcp::register_profile(profile);
        let (mut e, layer) = profiled_smart_object(&id);
        let profiled = e.export_composite_rgba16();
        let rerender = |e: &mut Engine| {
            e.set_smart_filter_enabled(layer, 0, false);
            e.set_smart_filter_enabled(layer, 0, true);
            e.export_composite_rgba16()
        };
        for shift in 0..20 {
            let other = dcp::tests::dcp_bytes("Other", Some(shift as f32), true);
            dcp::register_profile(dcp::parse_profile(&other).unwrap());
        }
        assert!(!dcp::develop_profile_registered(&digest), "evicted");
        set_host(Some((digest.clone(), bytes)));
        assert_eq!(
            rerender(&mut e),
            profiled,
            "the host's bytes render it again"
        );
        assert_eq!(dcp::develop_profile_take_missing(), "[]");
        // Only a profile nobody has renders as Camera Default — and says so.
        for shift in 20..40 {
            let other = dcp::tests::dcp_bytes("Other", Some(shift as f32), true);
            dcp::register_profile(dcp::parse_profile(&other).unwrap());
        }
        set_host(None);
        assert_ne!(rerender(&mut e), profiled);
        assert_eq!(
            dcp::develop_profile_take_missing(),
            format!("[\"{digest}\"]")
        );
        assert_eq!(
            dcp::develop_profile_take_missing(),
            "[]",
            "taking clears the list"
        );
    }

    #[test]
    fn refresh_re_renders_only_layers_whose_profile_is_available() {
        let bytes = dcp::tests::dcp_bytes("Shift", Some(90.0), true);
        let digest = dcp::parse_profile(&bytes).unwrap().digest;
        let id = words(&digest);
        // Saved while the profile was missing: Camera Default pixels.
        let (mut e, _) = profiled_smart_object(&id);
        let camera_default = e.export_composite_rgba16();
        assert_eq!(
            e.refresh_develop_profiles(None, None),
            0,
            "still missing: pixels kept"
        );
        assert_eq!(e.export_composite_rgba16(), camera_default);
        set_host(Some((digest, bytes)));
        assert_eq!(e.refresh_develop_profiles(None, None), 1);
        assert_ne!(
            e.export_composite_rgba16(),
            camera_default,
            "the profile shows again"
        );
        set_host(None);
        let _ = dcp::develop_profile_take_missing();
    }

    #[test]
    fn a_malformed_identity_rejects_the_tail() {
        let good = v6_params(5.0, 1.0, &[1.0; 8]);
        assert!(parse_develop_advanced(&good).is_some());
        for bad in [65536.0, 0.5, -1.0] {
            let mut p = good.clone();
            let at = p.len() - 3;
            p[at] = bad;
            assert!(parse_develop_advanced(&p).is_none(), "{bad}");
        }
        for bad in [500.0, -3200.0, 1.0e6] {
            let mut p = good.clone();
            *p.last_mut().unwrap() = bad;
            assert!(parse_develop_advanced(&p).is_none(), "as-shot {bad}");
        }
        assert!(parse_develop_advanced(&good[..good.len() - 1]).is_none());
    }

    #[test]
    fn the_white_is_the_as_shot_temperature_moved_by_temp() {
        assert_eq!(develop_white_kelvin(0.0, 0.0), 5500.0);
        assert!((develop_white_kelvin(2850.0, 0.0) - 2850.0).abs() < 0.01);
        // +0.25 Temp is 50 mireds warmer a rendering (a bluer light).
        let shifted = develop_white_kelvin(2850.0, 0.25);
        assert!(
            (1.0e6 / shifted - (1.0e6 / 2850.0 - 50.0)).abs() < 1e-3,
            "{shifted}"
        );
        let mut p = v6_params(5.0, 1.0, &[1.0; 8]);
        *p.last_mut().unwrap() = 2850.0;
        let kelvin = parse_develop_advanced(&p).unwrap().profile.kelvin;
        assert!((kelvin - 2850.0).abs() < 0.01, "{kelvin}");
    }
}
