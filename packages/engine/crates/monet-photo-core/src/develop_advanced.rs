// Camera-Raw source-profile + Camera-Calibration stage. This is the wasm
// engine's FIRST develop stage; ported VERBATIM from
// packages/engine/src/raster/develop.rs (fn develop_profile_calibration,
// struct DevelopProfile) so native full-res export matches wasm bit-for-bit.
// Do NOT "improve" this — the native==wasm proof gate depends on exact bits.

use crate::recipe::get_f32;
use serde_json::Value;

pub(crate) struct DevelopProfile {
    code: u8,
    amount: f32,
    shadow_tint: f32,
    primary: [[f32; 2]; 3], // red/green/blue × hue/saturation
}

/// Map a develop recipe JSON to the profile/calibration inputs exactly the way
/// packages/monet-ui/packages/monet-photo/src/developParams.ts serializes them
/// into the advanced tail (offsets 1088..1096).
pub(crate) fn profile_from_recipe(r: &Value) -> DevelopProfile {
    let code = match r.get("profile").and_then(|p| p.get("id")).and_then(Value::as_str) {
        Some("camera-default") => 0,
        Some("adobe-color") => 1,
        Some("camera-neutral") => 2,
        Some("monochrome") => 3,
        // A DNG camera profile needs the registry only the wasm engine keeps,
        // so both render as Camera Default natively, as they do there without one.
        Some("embedded") => 4,
        Some("custom") => 5,
        _ => 0,
    };
    DevelopProfile {
        code,
        amount: get_f32(r, &["profile", "amount"]),
        shadow_tint: get_f32(r, &["calibration", "shadowTint"]),
        primary: [
            [
                get_f32(r, &["calibration", "redHue"]),
                get_f32(r, &["calibration", "redSat"]),
            ],
            [
                get_f32(r, &["calibration", "greenHue"]),
                get_f32(r, &["calibration", "greenSat"]),
            ],
            [
                get_f32(r, &["calibration", "blueHue"]),
                get_f32(r, &["calibration", "blueSat"]),
            ],
        ],
    }
}

pub(crate) fn develop_profile_calibration(px: &mut [u16], profile: DevelopProfile) {
    let amount = profile.amount.clamp(0.0, 1.0);
    let neutral_calibration =
        profile.shadow_tint == 0.0 && profile.primary.iter().flatten().all(|value| *value == 0.0);
    if (amount == 0.0 || profile.code == 0 || profile.code == 4 || profile.code == 5)
        && neutral_calibration
    {
        return;
    }
    for pixel in px.chunks_exact_mut(4) {
        let original = [
            pixel[0] as f32 / 65535.0,
            pixel[1] as f32 / 65535.0,
            pixel[2] as f32 / 65535.0,
        ];
        let (mut r, mut g, mut b) = (original[0], original[1], original[2]);
        let (hue, saturation, lightness) = crate::color::rgb_to_hsl(r, g, b);
        let (profile_h, profile_s, profile_l) = match profile.code {
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
            // Camera Default, Embedded, and Custom are already represented by
            // the decoded working pixels; calibration below remains active.
            _ => (hue, saturation, lightness),
        };
        let profiled = crate::color::hsl_to_rgb(profile_h, profile_s, profile_l);
        r += (profiled.0 - r) * amount;
        g += (profiled.1 - g) * amount;
        b += (profiled.2 - b) * amount;

        // Camera Calibration hue/saturation is weighted by proximity to the
        // red, green, and blue primaries on the hue wheel.
        let (hue, saturation, lightness) = crate::color::rgb_to_hsl(r, g, b);
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
        (r, g, b) = crate::color::hsl_to_rgb(
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
        pixel[0] = crate::color::to16(r);
        pixel[1] = crate::color::to16(g);
        pixel[2] = crate::color::to16(b);
    }
}

// ---------------------------------------------------------------------------
// HEAL / CLONE-SPOT retouch stage. Ported VERBATIM from the wasm engine
// (packages/engine/src/raster/develop.rs: struct DevelopHeal, struct
// DevelopCrop, struct DevelopCropMap + impl, fn develop_heal_spots; and
// packages/engine/src/raster/mod.rs: fn sample_bi) so native full-res export
// matches wasm bit-for-bit. Only visibility + module paths changed; NO math.
// develop_heal_spots always receives the DISABLED crop_map here because
// developParams.ts zeroes the crop tail — heal is engine-applied, crop is not.

/// Engine cap on heal spots (wasm DEV_MAX_HEALS). A longer list rejects the
/// whole tail atomically, so clamp to match the TS serializer's slice.
const DEV_MAX_HEALS: usize = 64;

#[derive(Clone, Copy)]
pub(crate) struct DevelopHeal {
    mode: u8,
    x: f32,
    y: f32,
    source_x: f32,
    source_y: f32,
    radius: f32,
    feather: f32,
    opacity: f32,
}

#[derive(Clone, Copy)]
pub(crate) struct DevelopCrop {
    pub(crate) enabled: bool,
    pub(crate) x: f32,
    pub(crate) y: f32,
    pub(crate) width: f32,
    pub(crate) height: f32,
    pub(crate) angle: f32,
    pub(crate) constrain_aspect: bool,
    pub(crate) aspect_ratio: f32,
    pub(crate) flip_h: bool,
    pub(crate) flip_v: bool,
}

#[derive(Clone, Copy)]
pub(crate) struct DevelopCropMap {
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
    pub(crate) fn new(crop: DevelopCrop, w: u32, h: u32) -> Self {
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

pub(crate) fn develop_heal_spots(
    px: &mut Vec<u16>,
    w: u32,
    h: u32,
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
        // px is still pre-spot here, so these two centre probes read exactly
        // what the old whole-buffer clone held.
        let mut source_center = [0u16; 4];
        let mut target_center = [0u16; 4];
        sample_bi(&px[..], wi, hi, source_px, source_py, &mut source_center);
        sample_bi(&px[..], wi, hi, target_px, target_py, &mut target_center);
        let delta = [
            target_center[0] as f32 - source_center[0] as f32,
            target_center[1] as f32 - source_center[1] as f32,
            target_center[2] as f32 - source_center[2] as f32,
        ];
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
                let amount = edge * opacity;
                let mut sampled = [0u16; 4];
                source.sample(wi, hi, source_px + dx, source_py + dy, &mut sampled);
                let offset = (y * wi + x) as usize * 4;
                for channel in 0..3 {
                    let replacement = if spot.mode == 0 {
                        (sampled[channel] as f32 + delta[channel]).clamp(0.0, 65535.0)
                    } else {
                        sampled[channel] as f32
                    };
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
// Ported VERBATIM from packages/engine/src/raster/mod.rs (fn sample_bi).
fn sample_bi(src: &[u16], w: i32, h: i32, fx: f32, fy: f32, out: &mut [u16]) {
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
            let si = (sy * w + sx) as usize * 4;
            let wgt = wx * wy;
            for k in 0..4 {
                acc[k] += src[si + k] as f32 * wgt;
            }
        }
    }
    for k in 0..4 {
        out[k] = acc[k].round().clamp(0.0, 65535.0) as u16;
    }
}

// ---------------------------------------------------------------------------
// POINT COLOR (V3 advanced tail). Ported VERBATIM from the wasm engine
// (packages/engine/src/raster/adjust.rs: struct PointColorSocket, fn
// point_color) so native full-res export matches wasm bit-for-bit. In the wasm
// pipeline this runs at step 12.5 — AFTER color-grading, BEFORE geometry — on
// the un-warped pixels; develop.rs interleaves it there. The wasm applier uses
// map_rgb over the develop Selection, which is a full (inactive) selection in
// the shared camera_raw_develop path, so every pixel blends at coverage 1.0 —
// i.e. to16(nr). Only visibility + module paths changed; NO math.

/// Engine cap on point-color sockets (wasm DEV_MAX_POINT_COLORS). A longer list
/// rejects the whole tail atomically, so clamp to match the TS serializer.
const DEV_MAX_POINT_COLORS: usize = 8;

pub(crate) struct PointColorSocket {
    target: [f32; 3], // sampled colour, RGB 0..1
    range: f32,       // 0..1 selectivity radius
    hue: f32,         // -1..1
    sat: f32,         // -1..1
    lum: f32,         // -1..1
}

pub(crate) fn point_color(px: &mut [u16], sockets: &[PointColorSocket]) {
    for pixel in px.chunks_exact_mut(4) {
        let (mut cr, mut cg, mut cb) = (
            pixel[0] as f32 / 65535.0,
            pixel[1] as f32 / 65535.0,
            pixel[2] as f32 / 65535.0,
        );
        for s in sockets {
            if s.hue == 0.0 && s.sat == 0.0 && s.lum == 0.0 {
                continue;
            }
            // range 0..1 → RGB-distance radius 0.08..0.98 (max RGB dist is √3).
            let radius = (0.08 + s.range.clamp(0.0, 1.0) * 0.9).max(1e-3);
            let dist = ((cr - s.target[0]).powi(2)
                + (cg - s.target[1]).powi(2)
                + (cb - s.target[2]).powi(2))
            .sqrt();
            let t = (1.0 - dist / radius).clamp(0.0, 1.0);
            let weight = t * t * (3.0 - 2.0 * t); // smoothstep falloff
            if weight <= 0.0 {
                continue;
            }
            let (mut h, mut sat, mut l) = crate::color::rgb_to_hsl(cr, cg, cb);
            h = (h + s.hue * 30.0 * weight).rem_euclid(360.0);
            sat = (sat * (1.0 + s.sat * weight)).clamp(0.0, 1.0);
            l = if s.lum >= 0.0 {
                l + (1.0 - l) * s.lum * weight
            } else {
                l * (1.0 + s.lum * weight)
            };
            let (nr, ng, nb) = crate::color::hsl_to_rgb(h, sat, l);
            cr = nr;
            cg = ng;
            cb = nb;
        }
        pixel[0] = crate::color::to16(cr);
        pixel[1] = crate::color::to16(cg);
        pixel[2] = crate::color::to16(cb);
    }
}

/// Build point-color sockets from `recipe["pointColor"]["samples"]` exactly as
/// develop_buf constructs them from the V3 tail: each sample's srcHue/srcSat/
/// srcLum ARE the reference HSL (developParams.ts writes them straight through),
/// converted to an RGB target; range clamped 0..1, hue/sat/lum clamped -1..1;
/// clamped to `DEV_MAX_POINT_COLORS`.
pub(crate) fn point_colors_from_recipe(r: &Value) -> Vec<PointColorSocket> {
    let Some(samples) = r
        .get("pointColor")
        .and_then(|pc| pc.get("samples"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    samples
        .iter()
        .take(DEV_MAX_POINT_COLORS)
        .map(|s| {
            let f = |key: &str| s.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let (tr, tg, tb) = crate::color::hsl_to_rgb(
                f("srcHue").rem_euclid(360.0),
                f("srcSat").clamp(0.0, 1.0),
                f("srcLum").clamp(0.0, 1.0),
            );
            PointColorSocket {
                target: [tr, tg, tb],
                range: f("range").clamp(0.0, 1.0),
                hue: f("hue").clamp(-1.0, 1.0),
                sat: f("sat").clamp(-1.0, 1.0),
                lum: f("lum").clamp(-1.0, 1.0),
            }
        })
        .collect()
}

/// Map `recipe["heal"]["spots"]` into engine heal records exactly as
/// developParams.ts serializes the heal tail: clamp to `DEV_MAX_HEALS`,
/// mode "clone" → 1 else 0, and pass the eight fields through as f32.
pub(crate) fn heals_from_recipe(r: &Value) -> Vec<DevelopHeal> {
    let Some(spots) = r
        .get("heal")
        .and_then(|heal| heal.get("spots"))
        .and_then(Value::as_array)
    else {
        return Vec::new();
    };
    spots
        .iter()
        .take(DEV_MAX_HEALS)
        .map(|spot| {
            let f = |key: &str| spot.get(key).and_then(Value::as_f64).unwrap_or(0.0) as f32;
            DevelopHeal {
                mode: if spot.get("mode").and_then(Value::as_str) == Some("clone") {
                    1
                } else {
                    0
                },
                x: f("x"),
                y: f("y"),
                source_x: f("sourceX"),
                source_y: f("sourceY"),
                radius: f("radius"),
                feather: f("feather"),
                opacity: f("opacity"),
            }
        })
        .collect()
}

// ---------------------------------------------------------------------------
// GEOMETRY (keystone + straighten). Ported VERBATIM from the wasm engine
// (packages/engine/src/raster/mod.rs: fn geometry_keystone_buf and its helper
// chain — square_to_quad, perspective_inverse_transform, mat3_inv,
// clean_smart_transform, smart_affine, mat3_mul, transform_pixels_with_inverse,
// mat3_project, sample_bi_transparent, const SMART_IDENTITY). develop_buf calls
// geometry_keystone_buf at step 13, so native full-res export MUST use this
// exact float-op sequence to match wasm bit-for-bit — the kernels'
// bounded_geometry is algebraically equal but diverges by 1 ULP. Only Engine::
// method paths flattened to free fns; NO math changed.

const SMART_IDENTITY: [f32; 9] = [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];

fn geo_square_to_quad(
    x0: f32,
    y0: f32,
    x1: f32,
    y1: f32,
    x2: f32,
    y2: f32,
    x3: f32,
    y3: f32,
) -> ([f32; 9], bool) {
    let dx1 = x1 - x2;
    let dx2 = x3 - x2;
    let dx3 = x0 - x1 + x2 - x3;
    let dy1 = y1 - y2;
    let dy2 = y3 - y2;
    let dy3 = y0 - y1 + y2 - y3;
    let (a, b, c, d, e, f, g, h);
    if dx3.abs() < 1e-6 && dy3.abs() < 1e-6 {
        a = x1 - x0;
        b = x2 - x1;
        c = x0;
        d = y1 - y0;
        e = y2 - y1;
        f = y0;
        g = 0.0;
        h = 0.0;
    } else {
        let den = dx1 * dy2 - dx2 * dy1;
        if den.abs() < 1e-9 {
            return ([0.0; 9], false);
        }
        g = (dx3 * dy2 - dx2 * dy3) / den;
        h = (dx1 * dy3 - dx3 * dy1) / den;
        a = x1 - x0 + g * x1;
        b = x3 - x0 + h * x3;
        c = x0;
        d = y1 - y0 + g * y1;
        e = y3 - y0 + h * y3;
        f = y0;
    }
    ([a, b, c, d, e, f, g, h, 1.0], true)
}

fn geo_mat3_inv(m: [f32; 9]) -> [f32; 9] {
    let (a, b, c, d, e, f, g, h, i) = (m[0], m[1], m[2], m[3], m[4], m[5], m[6], m[7], m[8]);
    let det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
    if det.abs() < 1e-12 {
        return [1.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 1.0];
    }
    let id = 1.0 / det;
    [
        (e * i - f * h) * id,
        (c * h - b * i) * id,
        (b * f - c * e) * id,
        (f * g - d * i) * id,
        (a * i - c * g) * id,
        (c * d - a * f) * id,
        (d * h - e * g) * id,
        (b * g - a * h) * id,
        (a * e - b * d) * id,
    ]
}

fn geo_mat3_project(m: [f32; 9], x: f32, y: f32) -> Option<(f32, f32)> {
    let pw = m[6] * x + m[7] * y + m[8];
    if pw.abs() < 1e-9 {
        return None;
    }
    Some((
        (m[0] * x + m[1] * y + m[2]) / pw,
        (m[3] * x + m[4] * y + m[5]) / pw,
    ))
}

fn geo_clean_smart_transform(mut m: [f32; 9]) -> [f32; 9] {
    if !m.iter().all(|v| v.is_finite()) || m[8].abs() < 1e-9 {
        return SMART_IDENTITY;
    }
    let scale = m[8];
    if (scale - 1.0).abs() > 1e-6 {
        for v in &mut m {
            *v /= scale;
        }
    }
    for v in &mut m {
        if v.abs() < 1e-6 {
            *v = 0.0;
        }
    }
    m
}

fn geo_smart_affine(a: f32, b: f32, c: f32, d: f32, e: f32, f: f32) -> [f32; 9] {
    [a, c, e, b, d, f, 0.0, 0.0, 1.0]
}

fn geo_mat3_mul(a: [f32; 9], b: [f32; 9]) -> [f32; 9] {
    [
        a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
        a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
        a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
        a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
        a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
        a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
        a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
        a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
        a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
    ]
}

fn geo_perspective_inverse_transform(w: i32, h: i32, quad: [f32; 9]) -> [f32; 9] {
    let inv = geo_mat3_inv(quad);
    let dst_pixel_to_center = geo_smart_affine(1.0, 0.0, 0.0, 1.0, 0.5, 0.5);
    let unit_to_source_pixel = geo_smart_affine(w as f32, 0.0, 0.0, h as f32, -0.5, -0.5);
    geo_clean_smart_transform(geo_mat3_mul(
        unit_to_source_pixel,
        geo_mat3_mul(inv, dst_pixel_to_center),
    ))
}

fn geo_sample_bi_transparent(src: &[u16], w: i32, h: i32, fx: f32, fy: f32, out: &mut [u16]) {
    let x0 = fx.floor() as i32;
    let y0 = fy.floor() as i32;
    if x0 < -1 || y0 < -1 || x0 > w || y0 > h {
        out[0] = 0;
        out[1] = 0;
        out[2] = 0;
        out[3] = 0;
        return;
    }
    let tx = fx - x0 as f32;
    let ty = fy - y0 as f32;
    let mut acc = [0f32; 4];
    for (oy, wy) in [(0, 1.0 - ty), (1, ty)] {
        for (ox, wx) in [(0, 1.0 - tx), (1, tx)] {
            let sx = x0 + ox;
            let sy = y0 + oy;
            if sx >= 0 && sy >= 0 && sx < w && sy < h {
                let si = (sy * w + sx) as usize * 4;
                let wgt = wx * wy;
                for k in 0..4 {
                    acc[k] += src[si + k] as f32 * wgt;
                }
            }
        }
    }
    for k in 0..4 {
        out[k] = acc[k].round().clamp(0.0, 65535.0) as u16;
    }
}

fn geo_transform_pixels_with_inverse(src: &[u16], w: i32, h: i32, inv: [f32; 9]) -> Vec<u16> {
    let mut dst = vec![0u16; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let di = (y * w + x) as usize * 4;
            if let Some((fx, fy)) = geo_mat3_project(inv, x as f32, y as f32) {
                geo_sample_bi_transparent(src, w, h, fx, fy, &mut dst[di..di + 4]);
            }
        }
    }
    dst
}

/// VERBATIM port of the wasm engine's `geometry_keystone_buf` (step 13). Runs
/// AFTER Point Color on the un-warped pixels.
pub(crate) fn geometry_keystone_buf(
    px: &mut [u16],
    w: u32,
    h: u32,
    vertical: f32,
    horizontal: f32,
    rotate: f32,
) {
    let tv = vertical.clamp(-1.0, 1.0) * 0.25;
    let th = horizontal.clamp(-1.0, 1.0) * 0.25;
    let (sa, ca) = (rotate.clamp(-1.0, 1.0) * 15.0_f32.to_radians()).sin_cos();
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
        c[i * 2] = (dx * ca - dy * sa + 0.5) * fw;
        c[i * 2 + 1] = (dx * sa + dy * ca + 0.5) * fh;
    }
    let (m, ok) = geo_square_to_quad(c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]);
    if !ok {
        return;
    }
    let inv = geo_perspective_inverse_transform(w as i32, h as i32, m);
    let warped = geo_transform_pixels_with_inverse(px, w as i32, h as i32, inv);
    px.copy_from_slice(&warped);
}

#[cfg(test)]
mod heal_spot_tests {
    use super::*;

    /// The pre-REM-06 implementation, verbatim: clone the WHOLE layer per spot.
    /// Kept as the oracle — develop_heal_spots must stay byte-identical to it.
    fn heal_reference(
        px: &mut Vec<u16>,
        w: u32,
        h: u32,
        spots: &[DevelopHeal],
        crop_map: DevelopCropMap,
        proxy_scale: f32,
    ) {
        let (wi, hi) = (w as i32, h as i32);
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
            let source = px.clone();
            let mut source_center = [0u16; 4];
            let mut target_center = [0u16; 4];
            sample_bi(&source, wi, hi, source_px, source_py, &mut source_center);
            sample_bi(&source, wi, hi, target_px, target_py, &mut target_center);
            let delta = [
                target_center[0] as f32 - source_center[0] as f32,
                target_center[1] as f32 - source_center[1] as f32,
                target_center[2] as f32 - source_center[2] as f32,
            ];
            let feather = spot.feather.clamp(0.0, 1.0);
            let inner = radius * (1.0 - feather);
            let x0 = (target_px - radius).floor().max(0.0) as i32;
            let y0 = (target_py - radius).floor().max(0.0) as i32;
            let x1 = (target_px + radius).ceil().min(wi as f32 - 1.0) as i32;
            let y1 = (target_py + radius).ceil().min(hi as f32 - 1.0) as i32;
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
                    let amount = edge * opacity;
                    let mut sampled = [0u16; 4];
                    sample_bi(&source, wi, hi, source_px + dx, source_py + dy, &mut sampled);
                    let offset = (y * wi + x) as usize * 4;
                    for channel in 0..3 {
                        let replacement = if spot.mode == 0 {
                            (sampled[channel] as f32 + delta[channel]).clamp(0.0, 65535.0)
                        } else {
                            sampled[channel] as f32
                        };
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

    fn disabled_crop_map(w: u32, h: u32) -> DevelopCropMap {
        DevelopCropMap::new(
            DevelopCrop {
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
            w,
            h,
        )
    }

    /// Deterministic 2-D gradient with per-channel phase, so a wrong source
    /// rect or a rebased index that is off by one shows up as a value diff.
    fn gradient(w: u32, h: u32) -> Vec<u16> {
        let mut px = vec![0u16; (w * h * 4) as usize];
        for y in 0..h {
            for x in 0..w {
                let o = ((y * w + x) * 4) as usize;
                px[o] = ((x * 907 + y * 131) % 65536) as u16;
                px[o + 1] = ((x * 311 + y * 1223) % 65536) as u16;
                px[o + 2] = ((x * 61 + y * 7919) % 65536) as u16;
                px[o + 3] = ((x * 17 + y * 29) % 65536) as u16;
            }
        }
        px
    }

    fn heal(
        mode: u8,
        x: f32,
        y: f32,
        source_x: f32,
        source_y: f32,
        radius: f32,
        feather: f32,
        opacity: f32,
    ) -> DevelopHeal {
        DevelopHeal {
            mode,
            x,
            y,
            source_x,
            source_y,
            radius,
            feather,
            opacity,
        }
    }

    #[test]
    fn heal_sub_rect_snapshot_matches_whole_buffer_clone() {
        let (w, h) = (37u32, 29u32);
        let spots = [
            // Source disc straddles the left/top border (edge clamp path).
            heal(0, 0.5, 0.5, 0.02, 0.03, 0.2, 0.4, 1.0),
            // Source disc straddles the right/bottom border.
            heal(1, 0.35, 0.4, 0.98, 0.97, 0.18, 0.0, 0.8),
            // Overlaps the first spot's output — must read its writes.
            heal(0, 0.52, 0.46, 0.5, 0.2, 0.25, 1.0, 0.55),
            // Target partly off-canvas, source well inside.
            heal(1, 0.03, 0.9, 0.6, 0.6, 0.22, 0.3, 1.0),
            // Whole-image radius: the patch degenerates to the full buffer.
            heal(0, 0.5, 0.5, 0.45, 0.55, 1.5, 0.6, 0.4),
        ];
        let map = disabled_crop_map(w, h);

        let mut expected = gradient(w, h);
        heal_reference(&mut expected, w, h, &spots, map, 1.0);
        assert_ne!(expected, gradient(w, h), "oracle must actually retouch");

        let mut actual = gradient(w, h);
        develop_heal_spots(&mut actual, w, h, &spots, map, 1.0);
        assert_eq!(actual, expected, "sub-rect snapshot diverged from the clone");
    }

    /// The point of REM-06: the snapshot must stay local. Without this a future
    /// refactor could go back to copying the whole layer and the parity test
    /// above would still pass.
    #[test]
    fn source_patch_snapshots_only_the_sampled_neighbourhood() {
        let (w, h) = (1000i32, 800i32);
        let px = vec![0u16; (w * h * 4) as usize];
        let patch = SourcePatch::capture(&px, w, h, 100.0, 180.0, 200.0, 260.0);
        assert!(
            patch.px.len() * 50 < px.len(),
            "patch {} of {} — the whole-buffer clone is back",
            patch.px.len(),
            px.len()
        );
    }

    #[test]
    fn heal_on_empty_frame_is_a_no_op() {
        let mut px: Vec<u16> = vec![];
        develop_heal_spots(
            &mut px,
            0,
            0,
            &[heal(0, 0.5, 0.5, 0.2, 0.2, 0.3, 0.5, 1.0)],
            disabled_crop_map(0, 0),
            1.0,
        );
        assert!(px.is_empty());
    }
}
