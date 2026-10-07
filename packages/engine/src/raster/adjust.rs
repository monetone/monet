// ─────────────────────────────────────────────────────────────
// Image adjustments — operate on a layer's RGBA8 buffer, masked by
// the active Selection (per-pixel coverage lerp). Alpha is preserved
// unless an op states otherwise.
// ─────────────────────────────────────────────────────────────

use crate::raster::color::*;
use crate::raster::selection::Selection;
use crate::raster::Engine;

// Apply a per-pixel RGB transform `f(r,g,b,a) -> (r,g,b)` (0..1), blended into
// the layer by the selection coverage.
fn map_rgb<F: Fn(f32, f32, f32, f32) -> (f32, f32, f32)>(px: &mut [u16], sel: &Selection, f: F) {
    map_rgb_at(px, sel, |_, r, g, b, a| f(r, g, b, a));
}

// `map_rgb` with the plane index, for ops whose kernel reads a second plane
// (a blurred mask, a histogram lookup) at the same pixel.
fn map_rgb_at<F: Fn(usize, f32, f32, f32, f32) -> (f32, f32, f32)>(
    px: &mut [u16],
    sel: &Selection,
    f: F,
) {
    let n = (sel.w * sel.h) as usize;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let p = i * 4;
        let r = px[p] as f32 / 65535.0;
        let g = px[p + 1] as f32 / 65535.0;
        let b = px[p + 2] as f32 / 65535.0;
        let a = px[p + 3] as f32 / 65535.0;
        let (nr, ng, nb) = f(i, r, g, b, a);
        // (#109) Clamp the kernel result to the working range *before* the
        // coverage lerp — Photoshop stores the adjusted pixel at document depth
        // and then blends the mask, so a partially selected pixel must feather
        // toward the clamped value, not toward an out-of-gamut overshoot.
        px[p] = to16(lerp(r, nr.clamp(0.0, 1.0), cov));
        px[p + 1] = to16(lerp(g, ng.clamp(0.0, 1.0), cov));
        px[p + 2] = to16(lerp(b, nb.clamp(0.0, 1.0), cov));
    }
}

// brightness/contrast in -1..1. Contrast scales around mid-grey.
pub fn brightness_contrast(px: &mut [u16], sel: &Selection, brightness: f32, contrast: f32) {
    let c = 1.0 + contrast; // 0..2
    map_rgb(px, sel, |r, g, b, _| {
        (
            (r - 0.5) * c + 0.5 + brightness,
            (g - 0.5) * c + 0.5 + brightness,
            (b - 0.5) * c + 0.5 + brightness,
        )
    });
}

// channel: 0 = RGB (all), 1 = R, 2 = G, 3 = B
// The Levels transfer function for one channel value (all params in 0..1 except
// gamma): normalize the input range, apply gamma, remap to the output range.
fn levels_one(
    c: f32,
    in_black: f32,
    in_white: f32,
    gamma: f32,
    out_black: f32,
    out_white: f32,
) -> f32 {
    let inv = (in_white - in_black).max(1e-4);
    let v = ((c - in_black) / inv)
        .clamp(0.0, 1.0)
        .powf(1.0 / gamma.max(1e-4));
    out_black + v * (out_white - out_black)
}

/// Native HDR transfer functions keep negative samples and super-white values.
/// Signed powers extend gamma below black without producing NaNs.
pub(crate) fn signed_power(value: f32, power: f32) -> f32 {
    value.signum() * value.abs().powf(power)
}

pub(crate) fn levels_float(value: f32, p: &[f32]) -> f32 {
    // Same span/gamma floors as `levels_one`: crossed sliders apply, never refuse.
    // A floored span thresholds like `levels_one` instead of scaling by 1e4.
    let span = p[1] - p[0];
    let t = (value - p[0]) / span.max(1e-4);
    let t = if span < 1e-4 { t.clamp(0.0, 1.0) } else { t };
    p[3] + signed_power(t, 1.0 / p[2].max(1e-4)) * (p[4] - p[3])
}

// ponytail: fixed 16-entry window, so a control point inside it blends into the
// tangent; derive it from the dialog's points if that ever matters.
const CURVE_TANGENT_SPAN: usize = 16;

/// The existing Curves dialog supplies 256-entry LUTs. Interpolate inside the
/// range and extend each endpoint's tangent outside it, never clamp the input.
/// The tangent is measured across the end entries: one 8-bit step rounds a
/// gentle slope flat, which would pin a lifted curve's HDR highlights to 1.0.
pub(crate) fn curve_float(lut: &[u8], value: f32) -> f32 {
    let x = value as f64 * 255.0;
    let n = CURVE_TANGENT_SPAN;
    let y = if x > 255.0 {
        lut[255] as f64 + (x - 255.0) * (lut[255] as f64 - lut[255 - n] as f64) / n as f64
    } else if x < 0.0 {
        lut[0] as f64 + x * (lut[n] as f64 - lut[0] as f64) / n as f64
    } else {
        let i = x.floor().clamp(0.0, 254.0) as usize;
        lut[i] as f64 + (lut[i + 1] as f64 - lut[i] as f64) * (x - i as f64)
    };
    (y / 255.0) as f32
}

/// Reuse the full Hue/Saturation range/Colorize kernel in a pixel's extended
/// RGB interval, then restore that interval so HDR and negative RGB survive.
pub(crate) fn hue_saturation_float(r: f32, g: f32, b: f32, p: &[f32]) -> (f32, f32, f32) {
    if p.iter().all(|value| *value == 0.0) {
        return (r, g, b);
    }
    let low = r.min(g).min(b).min(0.0) as f64;
    let span = r.max(g).max(b).max(1.0) as f64 - low;
    let normalized = |c: f32| ((c as f64 - low) / span) as f32;
    let (r, g, b) = hue_saturation_pixel(normalized(r), normalized(g), normalized(b), p);
    ((r as f64 * span + low) as f32, (g as f64 * span + low) as f32, (b as f64 * span + low) as f32)
}

pub fn levels(
    px: &mut [u16],
    sel: &Selection,
    in_black: f32,
    in_white: f32,
    gamma: f32,
    out_black: f32,
    out_white: f32,
    channel: u8,
) {
    let f = |c: f32| levels_one(c, in_black, in_white, gamma, out_black, out_white);
    map_rgb(px, sel, |r, g, b, _| match channel {
        1 => (f(r), g, b),
        2 => (r, f(g), b),
        3 => (r, g, f(b)),
        _ => (f(r), f(g), f(b)),
    });
}

// Photoshop Levels with a Channel selector: apply the composite levels (RGB, to all
// channels) then each per-channel levels, all in one pass. Each `p` is
// [in_black, in_white, gamma, out_black, out_white] (0..1 except gamma).
pub fn levels_multi(
    px: &mut [u16],
    sel: &Selection,
    comp: &[f32],
    red: &[f32],
    grn: &[f32],
    blu: &[f32],
) {
    let lv = |c: f32, p: &[f32]| levels_one(c, p[0], p[1], p[2], p[3], p[4]);
    map_rgb(px, sel, |r, g, b, _| {
        (
            lv(lv(r, comp), red),
            lv(lv(g, comp), grn),
            lv(lv(b, comp), blu),
        )
    });
}

// Sample a 256-entry 8-bit transfer LUT at a 0..1 position, interpolating
// between neighbouring entries. (#110) Indexing by the high byte alone would
// quantize the engine's 16-bit pixels to 256 levels — even an identity curve
// would not be the identity (input 300 → 257) and smooth gradients would band.
// With interpolation an identity LUT is exact and the output keeps 16-bit
// precision, matching Photoshop's evaluate-at-document-depth behaviour.
fn lut_sample(lut: &[u8], t: f32) -> f32 {
    let x = t.clamp(0.0, 1.0) * 255.0;
    let i = x.floor() as usize;
    let f = x - i as f32;
    let lo = lut[i] as f32;
    let hi = lut[(i + 1).min(255)] as f32;
    (lo + (hi - lo) * f) / 255.0
}

// Apply 256-entry transfer LUTs: a master LUT (all channels) then per-channel.
pub fn curves(px: &mut [u16], sel: &Selection, master: &[u8], r: &[u8], g: &[u8], b: &[u8]) {
    let n = (sel.w * sel.h) as usize;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let p = i * 4;
        let or = px[p] as f32 / 65535.0;
        let og = px[p + 1] as f32 / 65535.0;
        let ob = px[p + 2] as f32 / 65535.0;
        // Master LUT then per-channel LUT, both sampled with interpolation (#110).
        let nr = lut_sample(r, lut_sample(master, or));
        let ng = lut_sample(g, lut_sample(master, og));
        let nb = lut_sample(b, lut_sample(master, ob));
        px[p] = to16(lerp(or, nr, cov));
        px[p + 1] = to16(lerp(og, ng, cov));
        px[p + 2] = to16(lerp(ob, nb, cov));
    }
}

// hue in degrees (-180..180), sat/light in -1..1.
pub fn hue_saturation(px: &mut [u16], sel: &Selection, hue: f32, sat: f32, light: f32) {
    let p = [hue, sat, light];
    map_rgb(px, sel, |r, g, b, _| hue_saturation_pixel(r, g, b, &p));
}

// Hue/Saturation with the full parameter block below (six colour ranges +
// Colorize). Same layout as adjustment-layer kind 2, so the destructive dialog
// and the adjustment layer are one implementation.
pub fn hue_saturation_params(px: &mut [u16], sel: &Selection, p: &[f32]) {
    map_rgb(px, sel, |r, g, b, _| hue_saturation_pixel(r, g, b, p));
}

// Hue/Saturation parameter block — shared by the destructive op above and the
// non-destructive adjustment layer (pixel_adjust kind 2). Every index is
// optional (absent reads 0.0), so a legacy 3-float `[hue, sat, light]` block
// behaves exactly as it always did:
//   p[0]      master hue rotation in degrees  (Colorize: the target hue 0..360)
//   p[1]      master saturation −1..1         (Colorize: the target saturation 0..1)
//   p[2]      master lightness −1..1
//   p[3]      Colorize flag (>0.5)
//   p[4..22]  six colour ranges × [hue°, sat, light], anchored every 60° in
//             Reds/Yellows/Greens/Cyans/Blues/Magentas order. The membership
//             weight is a triangular 60° hue window scaled by HSL saturation,
//             so a range slider only bites on
//             pixels of that hue and leaves neutrals byte-identical. The windows
//             partition unity, so the six ranges at the same value reproduce the
//             master slider at that value on a fully saturated pixel.
pub(crate) const HUE_SAT_PARAMS: usize = 22;

pub(crate) fn hue_saturation_pixel(r: f32, g: f32, b: f32, p: &[f32]) -> (f32, f32, f32) {
    let at = |i: usize| p.get(i).copied().unwrap_or(0.0);
    let (mut h, mut s, mut l) = rgb_to_hsl(r, g, b);
    if p.len() < HUE_SAT_PARAMS {
        h = (h + at(0)).rem_euclid(360.0);
        s = (s * (1.0 + at(1))).clamp(0.0, 1.0);
        let light = at(2);
        l = if light >= 0.0 {
            l + (1.0 - l) * light
        } else {
            l * (1.0 + light)
        };
        return hsl_to_rgb(h, s, l);
    }
    let light;
    if at(3) > 0.5 {
        // Colorize: force every pixel onto one hue at one saturation, keeping
        // its lightness. The colour ranges select *by* hue, so once every pixel
        // shares a hue they have nothing left to select and do not apply.
        h = at(0).rem_euclid(360.0);
        s = at(1).clamp(0.0, 1.0);
        light = at(2);
    } else {
        let (mut dh, mut ds, mut dl) = (at(0), at(1), at(2));
        for band in 0..6u8 {
            let w = hue_band_membership(band, h, s);
            if w <= 0.0 {
                continue;
            }
            let base = 4 + band as usize * 3;
            dh += at(base) * w;
            ds += at(base + 1) * w;
            dl += at(base + 2) * w;
        }
        h = (h + dh).rem_euclid(360.0);
        s = (s * (1.0 + ds)).clamp(0.0, 1.0);
        light = dl;
    }
    l = if light >= 0.0 {
        l + (1.0 - l) * light
    } else {
        l * (1.0 + light)
    };
    hsl_to_rgb(h, s, l)
}

fn hue_band_membership(band: u8, hue: f32, saturation: f32) -> f32 {
    let mut distance = (hue - band as f32 * 60.0).abs();
    if distance > 180.0 {
        distance = 360.0 - distance;
    }
    (1.0 - distance / 60.0).clamp(0.0, 1.0) * saturation
}

// Camera Raw HSL / Colour mixer: eight hue bands (Red, Orange, Yellow, Green,
// Aqua, Blue, Purple, Magenta), each with a Hue / Saturation / Luminance slider
// (all -1..1). A pixel's hue is linearly blended between its two neighbouring
// band anchors, so the effect is smooth across the wheel and exact at each
// anchor. Near-neutral pixels are left alone (a saturation confidence gate) —
// their hue is numerically unstable and a band adjustment there only adds noise,
// which also preserves byte-identity for grey pixels.
pub fn hsl_bands(px: &mut [u16], sel: &Selection, hue: &[f32], sat: &[f32], lum: &[f32]) {
    map_rgb(px, sel, |r, g, b, _| {
        let (mut h, mut s, mut l) = rgb_to_hsl(r, g, b);
        // Saturation confidence: 0 below ~0, smooth (smoothstep) to full by ~15%.
        let conf = {
            let t = (s / 0.15).clamp(0.0, 1.0);
            t * t * (3.0 - 2.0 * t)
        };
        if conf <= 0.0 {
            return (r, g, b);
        }
        let (i, j, t) = band_blend(h);
        let (wi, wj) = (1.0 - t, t);
        // Hue slider maps -1..1 → ±30° (a ±100 ACR slider / 100 × 30°).
        let hue_add = (wi * hue[i] + wj * hue[j]) * 30.0 * conf;
        let sat_fac = (wi * sat[i] + wj * sat[j]) * conf;
        let lum_fac = (wi * lum[i] + wj * lum[j]) * conf;
        h = (h + hue_add).rem_euclid(360.0);
        s = (s * (1.0 + sat_fac)).clamp(0.0, 1.0);
        l = if lum_fac >= 0.0 {
            l + (1.0 - l) * lum_fac
        } else {
            l * (1.0 + lum_fac)
        };
        hsl_to_rgb(h, s, l)
    });
}

// Which two band anchors bracket hue `h` (degrees) and the 0..1 blend `t` toward
// the second. Wraps between Magenta (330°) and Red (360°≡0°).
fn band_blend(h: f32) -> (usize, usize, f32) {
    const ANCHORS: [f32; 8] = [0.0, 30.0, 60.0, 120.0, 180.0, 240.0, 285.0, 330.0];
    if h >= ANCHORS[7] {
        return (7, 0, (h - ANCHORS[7]) / (360.0 - ANCHORS[7]));
    }
    for i in 0..7 {
        if h < ANCHORS[i + 1] {
            return (i, i + 1, (h - ANCHORS[i]) / (ANCHORS[i + 1] - ANCHORS[i]));
        }
    }
    (7, 0, 0.0) // unreachable: h < 330 is handled by the loop
}

// Image ▸ Adjustments ▸ Replace Color: select pixels within `fuzz` (0..200) of
// the target colour and shift their hue/saturation/lightness, weighted by how
// close they are (a soft selection, like Photoshop's Fuzziness slider).
pub fn replace_color(
    px: &mut [u16],
    sel: &Selection,
    target: [u8; 3],
    fuzz: f32,
    hue: f32,
    sat: f32,
    light: f32,
) {
    let (tr, tg, tb) = (
        target[0] as f32 / 255.0,
        target[1] as f32 / 255.0,
        target[2] as f32 / 255.0,
    );
    let radius = (fuzz / 200.0 * 3.0f32.sqrt()).max(1e-3); // max RGB distance is √3
    map_rgb(px, sel, |r, g, b, _| {
        let dist = ((r - tr).powi(2) + (g - tg).powi(2) + (b - tb).powi(2)).sqrt();
        let weight = (1.0 - dist / radius).clamp(0.0, 1.0);
        if weight <= 0.0 {
            return (r, g, b);
        }
        let (mut h, mut s, mut l) = rgb_to_hsl(r, g, b);
        h = (h + hue).rem_euclid(360.0);
        s = (s * (1.0 + sat)).clamp(0.0, 1.0);
        l = if light >= 0.0 {
            l + (1.0 - l) * light
        } else {
            l * (1.0 + light)
        };
        let (nr, ng, nb) = hsl_to_rgb(h, s, l);
        (
            r + (nr - r) * weight,
            g + (ng - g) * weight,
            b + (nb - b) * weight,
        )
    });
}

// Camera Raw / Lightroom "Point Color": up to N sampled colour sockets. Each
// socket nudges the hue/saturation/luminance of pixels near its sampled colour,
// weighted by a soft RGB-distance falloff (like Replace Color) so it targets the
// exact picked colour rather than a whole hue band. `range` (0..1) widens the
// affected neighbourhood; the shifts follow the HSL-mixer convention
// (hue −1..1 → ±30°, saturation multiplicative, luminance asymmetric). Sockets
// apply in order over the accumulating colour.
pub struct PointColorSocket {
    pub target: [f32; 3], // sampled colour, RGB 0..1
    pub range: f32,       // 0..1 selectivity radius
    pub hue: f32,         // -1..1
    pub sat: f32,         // -1..1
    pub lum: f32,         // -1..1
}

pub fn point_color(px: &mut [u16], sel: &Selection, sockets: &[PointColorSocket]) {
    map_rgb(px, sel, |r, g, b, _| {
        let (mut cr, mut cg, mut cb) = (r, g, b);
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
            let (mut h, mut sat, mut l) = rgb_to_hsl(cr, cg, cb);
            h = (h + s.hue * 30.0 * weight).rem_euclid(360.0);
            sat = (sat * (1.0 + s.sat * weight)).clamp(0.0, 1.0);
            l = if s.lum >= 0.0 {
                l + (1.0 - l) * s.lum * weight
            } else {
                l * (1.0 + s.lum * weight)
            };
            let (nr, ng, nb) = hsl_to_rgb(h, sat, l);
            cr = nr;
            cg = ng;
            cb = nb;
        }
        (cr, cg, cb)
    });
}

// Vibrance boosts low-saturation pixels more; `sat` is a flat saturation add.
pub fn vibrance(px: &mut [u16], sel: &Selection, vib: f32, sat: f32) {
    map_rgb(px, sel, |r, g, b, _| {
        let (h, s, v) = rgb_to_hsv(r, g, b);
        let ns = (s + vib * (1.0 - s) + sat).clamp(0.0, 1.0);
        hsv_to_rgb(h, ns, v)
    });
}

pub fn invert(px: &mut [u16], sel: &Selection) {
    map_rgb(px, sel, |r, g, b, _| (1.0 - r, 1.0 - g, 1.0 - b));
}

// Filter ▸ Stylize ▸ Solarize: invert each channel value above 50% — a tent
// curve `min(v, 1-v)` peaking at mid-grey. Reproduces the darkroom effect of
// briefly exposing a print to light mid-development (blends positive+negative).
pub fn solarize(px: &mut [u16], sel: &Selection) {
    map_rgb(px, sel, |r, g, b, _| {
        (r.min(1.0 - r), g.min(1.0 - g), b.min(1.0 - b))
    });
}

pub fn desaturate(px: &mut [u16], sel: &Selection) {
    map_rgb(px, sel, |r, g, b, _| {
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        (l, l, l)
    });
}

// Black & white with adjustable channel weights (normalized).
pub fn black_and_white(px: &mut [u16], sel: &Selection, rw: f32, gw: f32, bw: f32) {
    let p = [rw, gw, bw];
    map_rgb(px, sel, |r, g, b, _| black_white_pixel(r, g, b, &p));
}

// Black & White with the full parameter block below (six colour sliders +
// Tint). Same layout as adjustment-layer kind 6.
pub fn black_and_white_params(px: &mut [u16], sel: &Selection, p: &[f32]) {
    map_rgb(px, sel, |r, g, b, _| black_white_pixel(r, g, b, p));
}

// Black & White parameter block — shared by the destructive op above and the
// non-destructive adjustment layer (pixel_adjust kind 6):
//   p[0]      achromatic-base multiplier (1 for new adjustments; migrated
//             legacy RGB weights use their signed normalised sum)
//   p[1..3]   reserved
//   p[3..9]   six colour sliders (Reds, Yellows, Greens, Cyans, Blues,
//             Magentas); 1.0 renders that hue as white, 0.0 as black
//   p[9]      Tint flag (>0.5); p[10] tint hue°, p[11] tint saturation 0..1
// A block shorter than BW_PARAMS stays on the legacy RGB-weight math, so every
// kind-6 layer already saved in a document — and `adjust_black_white`, which
// only ever passes three weights — keeps the look it was created with.
pub(crate) const BW_PARAMS: usize = 12;

pub(crate) fn black_white_pixel(r: f32, g: f32, b: f32, p: &[f32]) -> (f32, f32, f32) {
    if p.len() < BW_PARAMS {
        let (rw, gw, bw) = (
            p.first().copied().unwrap_or(0.0),
            p.get(1).copied().unwrap_or(0.0),
            p.get(2).copied().unwrap_or(0.0),
        );
        let l = (rw * r + gw * g + bw * b) / (rw + gw + bw).abs().max(1e-4);
        return (l, l, l);
    }
    // Photoshop's six-slider model: split the pixel into an achromatic base
    // (its minimum channel, which no slider can move) plus the chroma above it,
    // and render that chroma at the slider value for its hue. So a fully
    // saturated Red lands exactly on the Reds slider, white stays white, and
    // every neutral is untouched whatever the sliders say.
    let mn = r.min(g).min(b);
    let chroma = r.max(g).max(b) - mn;
    let (i, j, t) = hue6_blend(rgb_to_hsl(r, g, b).0);
    let l = mn * p[0] + chroma * ((1.0 - t) * p[3 + i] + t * p[3 + j]);
    if p[9] > 0.5 {
        // Tint: the gray becomes the lightness of a single tint colour.
        return hsl_to_rgb(
            p[10].rem_euclid(360.0),
            p[11].clamp(0.0, 1.0),
            l.clamp(0.0, 1.0),
        );
    }
    (l, l, l)
}

// Which two of the six Black & White colour anchors (Reds 0°, Yellows 60°,
// Greens 120°, Cyans 180°, Blues 240°, Magentas 300°) bracket hue `h`, and the
// 0..1 blend toward the second. The two weights sum to 1, so a fully saturated
// pixel renders at exactly its anchor's slider value.
fn hue6_blend(h: f32) -> (usize, usize, f32) {
    let x = h.rem_euclid(360.0) / 60.0;
    let i = (x.floor() as usize) % 6;
    (i, (i + 1) % 6, x - x.floor())
}

pub fn threshold(px: &mut [u16], sel: &Selection, level: f32) {
    map_rgb(px, sel, |r, g, b, _| {
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        let v = if l >= level { 1.0 } else { 0.0 };
        (v, v, v)
    });
}

// (#111) Photoshop splits the INPUT range into `levels` EQUAL bands — thresholds
// at k/N — and maps band k onto k/(N-1). Quantising with round(c·(N-1))/(N-1)
// instead put the thresholds at half-steps of 1/(N-1), so the two end bands came
// out half-width: at N=3 the middle band spanned 0.25..0.75 rather than ⅓..⅔ and
// inputs in between landed in the wrong band. Output levels were always right;
// only the boundaries moved (the two agree exactly at N=2).
pub fn posterize(px: &mut [u16], sel: &Selection, levels: u32) {
    let n = levels.max(2) as f32;
    let q = |c: f32| (c * n).floor().clamp(0.0, n - 1.0) / (n - 1.0);
    map_rgb(px, sel, |r, g, b, _| (q(r), q(g), q(b)));
}

// (#107) Photoshop computes Exposure in a LINEAR colour space (gamma 1.0), not
// in the document's gamma-encoded space: the channel is decoded, scaled by
// 2^EV, offset, gamma-corrected, then re-encoded. Multiplying the encoded value
// directly made every setting far stronger than the same slider in PS
// (0.5 grey at +1 EV clipped to 1.0 instead of landing at ~0.68).
// Shared with the kind-9 adjustment layer (pixel_adjust.rs) so both agree.
pub(crate) fn exposure_channel(c: f32, mul: f32, offset: f32, inv_gamma: f32) -> f32 {
    let linear = (Engine::srgb_to_linear_f(c) * mul + offset).max(0.0);
    Engine::linear_to_srgb_f(linear.powf(inv_gamma))
}

pub fn exposure(px: &mut [u16], sel: &Selection, exposure: f32, offset: f32, gamma: f32) {
    let mul = 2f32.powf(exposure);
    let ig = 1.0 / gamma.max(1e-4);
    let f = |c: f32| exposure_channel(c, mul, offset, ig);
    map_rgb(px, sel, |r, g, b, _| (f(r), f(g), f(b)));
}

// Color balance: per-channel shifts for shadows/midtones/highlights (each -1..1).
pub fn color_balance(
    px: &mut [u16],
    sel: &Selection,
    sh: [f32; 3],
    mid: [f32; 3],
    hi: [f32; 3],
    preserve_lum: bool,
) {
    map_rgb(px, sel, |r, g, b, _| {
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        // tonal weights (smooth)
        let ws = (1.0 - l).powf(2.0);
        let wh = l.powf(2.0);
        let wm = (1.0 - (2.0 * l - 1.0).abs()).max(0.0);
        let shift = |i: usize| 0.25 * (sh[i] * ws + mid[i] * wm + hi[i] * wh);
        let mut nr = (r + shift(0)).clamp(0.0, 1.0);
        let mut ng = (g + shift(1)).clamp(0.0, 1.0);
        let mut nb = (b + shift(2)).clamp(0.0, 1.0);
        if preserve_lum {
            let nl = 0.299 * nr + 0.587 * ng + 0.114 * nb;
            let d = l - nl;
            nr = (nr + d).clamp(0.0, 1.0);
            ng = (ng + d).clamp(0.0, 1.0);
            nb = (nb + d).clamp(0.0, 1.0);
        }
        (nr, ng, nb)
    });
}

// Camera Raw Color Grading: three colour wheels — Shadows, Midtones, Highlights
// — each a (hue°, saturation 0..1). Every wheel is turned into an RGB push
// vector (a pure hue colour, centred on grey and scaled by saturation) and
// applied as a tonal colour balance in its region, reusing `color_balance`.
// Saturation 0 → a zero push, so a neutral grade is byte-identical.
pub fn color_grade(px: &mut [u16], sel: &Selection, wheels: &[f32; 6]) {
    let shift = |r: usize| -> [f32; 3] {
        let (cr, cg, cb) = hsl_to_rgb(wheels[r * 2], 1.0, 0.5);
        let s = wheels[r * 2 + 1];
        [
            (cr - 0.5) * 2.0 * s,
            (cg - 0.5) * 2.0 * s,
            (cb - 0.5) * 2.0 * s,
        ]
    };
    color_balance(px, sel, shift(0), shift(1), shift(2), false);
}

// Photo filter: tint toward (r,g,b) by `density`, optionally preserving luminosity.
pub fn photo_filter(
    px: &mut [u16],
    sel: &Selection,
    fr: f32,
    fg: f32,
    fb: f32,
    density: f32,
    preserve_lum: bool,
) {
    map_rgb(px, sel, |r, g, b, _| {
        let mut nr = r * (1.0 - density) + r * fr * density * 2.0;
        let mut ng = g * (1.0 - density) + g * fg * density * 2.0;
        let mut nb = b * (1.0 - density) + b * fb * density * 2.0;
        nr = nr.clamp(0.0, 1.0);
        ng = ng.clamp(0.0, 1.0);
        nb = nb.clamp(0.0, 1.0);
        if preserve_lum {
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            let nl = (0.299 * nr + 0.587 * ng + 0.114 * nb).max(1e-4);
            let s = l / nl;
            nr = (nr * s).clamp(0.0, 1.0);
            ng = (ng * s).clamp(0.0, 1.0);
            nb = (nb * s).clamp(0.0, 1.0);
        }
        (nr, ng, nb)
    });
}

// Channel mixer: each output channel is a weighted sum of inputs + constant.
// rows: [[rr,rg,rb,rc],[gr,gg,gb,gc],[br,bg,bb,bc]]
pub fn channel_mixer(px: &mut [u16], sel: &Selection, m: [[f32; 4]; 3]) {
    map_rgb(px, sel, |r, g, b, _| {
        (
            m[0][0] * r + m[0][1] * g + m[0][2] * b + m[0][3],
            m[1][0] * r + m[1][1] * g + m[1][2] * b + m[1][3],
            m[2][0] * r + m[2][1] * g + m[2][2] * b + m[2][3],
        )
    });
}

/// `camera_raw`'s per-pixel tone/colour maths with its slider-derived factors
/// precomputed. `hi` is the upper clip: 1.0 is the working range every u16
/// caller stores; Develop's RAW highlight recovery passes `f32::INFINITY` so a
/// sample above white keeps its headroom until the recipe's own final clip.
pub(crate) struct CameraRawTone {
    temp: f32,
    exp: f32,
    cf: f32,
    highlights: f32,
    shadows: f32,
    clarity: f32,
    dehaze: f32,
    vibrance: f32,
    saturation: f32,
}

impl CameraRawTone {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        temp: f32,
        exposure: f32,
        contrast: f32,
        highlights: f32,
        shadows: f32,
        clarity: f32,
        dehaze: f32,
        vibrance: f32,
        saturation: f32,
    ) -> Self {
        CameraRawTone {
            temp,
            exp: 2f32.powf(exposure),
            cf: 1.0 + contrast.clamp(-1.0, 1.0),
            highlights,
            shadows,
            clarity: clarity.clamp(-1.0, 1.0),
            dehaze: dehaze.clamp(-1.0, 1.0),
            vibrance,
            saturation,
        }
    }

    pub(crate) fn apply(&self, [or, og, ob]: [f32; 3], hi: f32) -> [f32; 3] {
        let (temp, exp, cf) = (self.temp, self.exp, self.cf);
        let (clarity, dehaze) = (self.clarity, self.dehaze);
        let mut r = (or * (1.0 + temp * 0.3) * exp - 0.5) * cf + 0.5;
        let mut g = (og * exp - 0.5) * cf + 0.5;
        let mut b = (ob * (1.0 - temp * 0.3) * exp - 0.5) * cf + 0.5;
        let lum = 0.299 * r + 0.587 * g + 0.114 * b;
        let hw = (lum * 2.0 - 1.0).clamp(0.0, 1.0); // 0 mid → 1 white
        let sw = (1.0 - lum * 2.0).clamp(0.0, 1.0); // 1 black → 0 mid
        let tone = self.highlights * hw * 0.5 + self.shadows * sw * 0.5;
        r += tone;
        g += tone;
        b += tone;
        let lum2 = 0.299 * r + 0.587 * g + 0.114 * b;
        let midtone = (1.0 - (lum2 - 0.5).abs() * 2.0).clamp(0.0, 1.0);
        let target_lum = ((lum2 - 0.5) * (1.0 + clarity * 0.75 * midtone) + 0.5).clamp(0.0, hi);
        let lscale = if lum2 > 1e-4 { target_lum / lum2 } else { 1.0 };
        r *= lscale;
        g *= lscale;
        b *= lscale;
        if dehaze.abs() > 1e-5 {
            let hf = 1.0 + dehaze * 0.45;
            r = (r - 0.5) * hf + 0.5 - dehaze * 0.03;
            g = (g - 0.5) * hf + 0.5 - dehaze * 0.03;
            b = (b - 0.5) * hf + 0.5 - dehaze * 0.03;
        }
        let lum2 = 0.299 * r + 0.587 * g + 0.114 * b;
        let (maxc, minc) = (r.max(g).max(b), r.min(g).min(b));
        let cursat = if maxc > 1e-4 {
            (maxc - minc) / maxc
        } else {
            0.0
        };
        let sf = (1.0 + self.saturation + self.vibrance * (1.0 - cursat) + dehaze * 0.15).max(0.0);
        [
            (lum2 + (r - lum2) * sf).clamp(0.0, hi),
            (lum2 + (g - lum2) * sf).clamp(0.0, hi),
            (lum2 + (b - lum2) * sf).clamp(0.0, hi),
        ]
    }
}

// Filter ▸ Camera Raw Filter: core raw tone/colour controls in one pass —
// temperature, exposure (EV), contrast, highlights/shadows, texture-like clarity,
// dehaze, vibrance, saturation and deterministic monochrome grain. All params
// roughly -1..1 (exposure in stops).
#[allow(clippy::too_many_arguments)]
pub fn camera_raw(
    px: &mut [u16],
    sel: &Selection,
    temp: f32,
    exposure: f32,
    contrast: f32,
    highlights: f32,
    shadows: f32,
    clarity: f32,
    dehaze: f32,
    vibrance: f32,
    saturation: f32,
    grain: f32,
) {
    let tone = CameraRawTone::new(
        temp, exposure, contrast, highlights, shadows, clarity, dehaze, vibrance, saturation,
    );
    let grain = grain.clamp(0.0, 1.0);
    let n = (sel.w * sel.h) as usize;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let p = i * 4;
        let or = px[p] as f32 / 65535.0;
        let og = px[p + 1] as f32 / 65535.0;
        let ob = px[p + 2] as f32 / 65535.0;
        let [mut r, mut g, mut b] = tone.apply([or, og, ob], 1.0);
        if grain > 0.0 {
            let mut h = (i as u32)
                .wrapping_mul(747_796_405)
                .wrapping_add(2_891_336_453);
            h ^= h >> 16;
            h = h.wrapping_mul(2_246_822_519);
            h ^= h >> 13;
            let noise = (h as f32 / u32::MAX as f32 - 0.5) * grain * 0.18;
            r = (r + noise).clamp(0.0, 1.0);
            g = (g + noise).clamp(0.0, 1.0);
            b = (b + noise).clamp(0.0, 1.0);
        }
        px[p] = to16(lerp(or, r, cov));
        px[p + 1] = to16(lerp(og, g, cov));
        px[p + 2] = to16(lerp(ob, b, cov));
    }
}

// Camera Raw ▸ White Balance ▸ Tint — the green↔magenta axis, the mirror of
// `camera_raw`'s temperature scaling (which pushes r/b apart).
//
// INTERNAL axis: positive tint raises G, negative raises R/B. This is the sign the
// stored DevelopRecipe uses and the Rust-authoritative canonical fixture pins, so it
// must not be flipped here — Adobe's user-facing axis is the opposite (negative =
// green, positive = magenta) and is negated at the two BOUNDARIES instead: the
// Camera Raw slider and the XMP/ACR interop. Byte-identity at 0. (#108)
pub fn wb_tint(px: &mut [u16], sel: &Selection, tint: f32) {
    if tint == 0.0 {
        return;
    }
    let g_gain = 1.0 + tint * 0.3; // green channel
    let rb_gain = 1.0 - tint * 0.3; // red/blue (magenta) channels
    map_rgb(px, sel, |r, g, b, _| (r * rb_gain, g * g_gain, b * rb_gain));
}

// Camera Raw ▸ Basic ▸ Whites/Blacks — move the tone endpoints. Whites pulls the
// white point down to `1 − whites*K` (positive brightens the highlights toward
// clipping); Blacks pushes the black point to `−blacks*K` (positive lifts the
// shadows). A linear (gamma-1) per-channel endpoint remap, reusing `levels_one`.
// Byte-identity at 0 (white point 1.0, black point 0.0 → the identity levels map).
pub fn whites_blacks(px: &mut [u16], sel: &Selection, whites: f32, blacks: f32) {
    if whites == 0.0 && blacks == 0.0 {
        return;
    }
    const K: f32 = 0.5;
    let white_pt = 1.0 - whites * K;
    let black_pt = -blacks * K;
    let f = |c: f32| levels_one(c, black_pt, white_pt, 1.0, 0.0, 1.0);
    map_rgb(px, sel, |r, g, b, _| (f(r), f(g), f(b)));
}

// Color Lookup: a built-in look `[preset_id]` or a loaded 3D LUT — the same
// kind-16 params an adjustment layer carries (see pixel_adjust::apply_pixel).
pub fn color_lookup(px: &mut [u16], sel: &Selection, params: &[f32]) {
    map_rgb(px, sel, |r, g, b, _| {
        crate::raster::pixel_adjust::apply_pixel(16, params, r, g, b)
    });
}

// Gradient map: replace color by sampling a 256*4 RGBA LUT at the luminance.
pub fn gradient_map(px: &mut [u16], sel: &Selection, lut: &[u8]) {
    map_rgb(px, sel, |r, g, b, _| {
        let l = (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 1.0);
        // Interpolate between the two neighbouring stops instead of snapping to
        // the nearest — a 16-bit luminance ramp maps to a smooth ramp (#110).
        let x = l * 255.0;
        let i = x.floor() as usize;
        let f = x - i as f32;
        let j = (i + 1).min(255);
        let s = |c: usize| {
            let lo = lut[i * 4 + c] as f32;
            let hi = lut[j * 4 + c] as f32;
            (lo + (hi - lo) * f) / 255.0
        };
        (s(0), s(1), s(2))
    });
}

// Shadows/Highlights parameters — the four tone sliders, the Adjustments pair,
// and Photoshop's Show More Options row: a per-band Radius (in pixels) and the
// Black Clip / White Clip percentages (0..1 fractions of the pixels).
#[derive(Clone, Copy, Default)]
pub struct ShadowsHighlights {
    pub sh_amount: f32,
    pub sh_width: f32,
    pub sh_radius: f32,
    pub hi_amount: f32,
    pub hi_width: f32,
    pub hi_radius: f32,
    pub color: f32,
    pub midtone: f32,
    pub black_clip: f32,
    pub white_clip: f32,
}

// A separable box blur of a single-channel plane. Each pass runs off a per-line
// prefix sum, so a 300 px Radius (an ordinary Photoshop value) costs the same as
// a 1 px one; at the borders the window is truncated rather than the edge pixel
// repeated. `radius` 0 returns the plane untouched.
fn blur_plane(src: &[f32], w: usize, h: usize, radius: usize) -> Vec<f32> {
    if radius == 0 || w == 0 || h == 0 {
        return src.to_vec();
    }
    let mut pre = vec![0f64; w.max(h) + 1];
    let mut mid = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            pre[x + 1] = pre[x] + src[y * w + x] as f64;
        }
        for x in 0..w {
            let (lo, hi) = (x.saturating_sub(radius), (x + radius + 1).min(w));
            mid[y * w + x] = ((pre[hi] - pre[lo]) / (hi - lo) as f64) as f32;
        }
    }
    let mut out = vec![0f32; w * h];
    for x in 0..w {
        for y in 0..h {
            pre[y + 1] = pre[y] + mid[y * w + x] as f64;
        }
        for y in 0..h {
            let (lo, hi) = (y.saturating_sub(radius), (y + radius + 1).min(h));
            out[y * w + x] = ((pre[hi] - pre[lo]) / (hi - lo) as f64) as f32;
        }
    }
    out
}

// The Black Clip / White Clip endpoints: the luminance levels below and above
// which `black`/`white` of the SELECTED pixels sit, as 0..1 fractions. Returns
// None when nothing would be clipped, so the caller skips the second pass.
fn clip_endpoints(px: &[u16], sel: &Selection, black: f32, white: f32) -> Option<(f32, f32)> {
    let (black, white) = (black.clamp(0.0, 0.5), white.clamp(0.0, 0.5));
    if black <= 0.0 && white <= 0.0 {
        return None;
    }
    let mut hist = [0u32; 256];
    let mut total = 0u32;
    for i in 0..(sel.w * sel.h) as usize {
        if sel.coverage(i) <= 0.0 {
            continue;
        }
        let p = i * 4;
        let l = 0.299 * px[p] as f32 + 0.587 * px[p + 1] as f32 + 0.114 * px[p + 2] as f32;
        hist[(l / 65535.0 * 255.0).round().clamp(0.0, 255.0) as usize] += 1;
        total += 1;
    }
    if total == 0 {
        return None;
    }
    // Each end clips a whole number of pixels — `want` of `total`, rounded
    // down. A budget of 0 (a 0% clip, or 0.01% of a plane too small to hold a
    // hundredth of a pixel) leaves that end where it is; only a budget of one
    // pixel or more moves it, to the level the clipped pixels sit under.
    let bin = |want: f32, from_top: bool| -> f32 {
        let rest = if from_top { 1.0 } else { 0.0 };
        let budget = (want * total as f32) as u32;
        if budget == 0 {
            return rest;
        }
        let mut acc = 0u32;
        for step in 0..256usize {
            let i = if from_top { 255 - step } else { step };
            acc += hist[i];
            if acc > budget {
                return i as f32 / 255.0;
            }
        }
        rest
    };
    let lo = bin(black, false);
    let hi = bin(white, true);
    (hi > lo && (lo > 0.0 || hi < 1.0)).then_some((lo, hi))
}

// Shadows/Highlights — lift shadow detail and recover blown highlights via a
// tonal mask. `*_amount` (0..1) is the strength; `*_width` (0..1) sets how far
// into the midtones each correction reaches; `*_radius` (px) blurs the mask so
// the correction follows local tone instead of the bare pixel, which is what
// stops a bright subject on a dark ground from being lifted with it. Applied as
// a hue-preserving additive luminance shift so colour relationships are kept,
// then Black/White Clip stretches the result onto pure black and white.
pub fn shadows_highlights(px: &mut [u16], sel: &Selection, p: &ShadowsHighlights) {
    let (sh_amount, hi_amount, color, midtone) = (p.sh_amount, p.hi_amount, p.color, p.midtone);
    let sw = p.sh_width.clamp(0.01, 1.0);
    let hw = p.hi_width.clamp(0.01, 1.0);
    let (w, h) = (sel.w as usize, sel.h as usize);
    let radius = |r: f32| r.max(0.0).round().min(2500.0) as usize; // Photoshop's slider ceiling
    let (sr, hr) = (radius(p.sh_radius), radius(p.hi_radius));
    // The Radius mask: the plane's own luminance, blurred per band. Radius 0 is
    // the bare pixel — the global model this op shipped with — and reads the
    // kernel's own `l`, so the six-argument callers allocate no plane here.
    let lum: Vec<f32> = (sr > 0 || hr > 0)
        .then(|| {
            (0..w * h)
                .map(|i| {
                    (0.299 * px[i * 4] as f32
                        + 0.587 * px[i * 4 + 1] as f32
                        + 0.114 * px[i * 4 + 2] as f32)
                        / 65535.0
                })
                .collect()
        })
        .unwrap_or_default();
    let sh_own = (sr > 0).then(|| blur_plane(&lum, w, h, sr));
    let hi_own = (hr > 0 && hr != sr).then(|| blur_plane(&lum, w, h, hr));
    let sh_mask = sh_own.as_deref();
    let hi_mask = if hr == sr { sh_mask } else { hi_own.as_deref() };
    // Photoshop's "Adjustments" group: Color = saturation of the corrected
    // regions; Midtone = a midtone-contrast S-curve. Clamp midtone to keep the
    // curve monotone (its slope hits 0 at the endpoints when |midtone| = 0.5).
    let mt = midtone.clamp(-0.5, 0.5);
    map_rgb_at(px, sel, |i, r, g, b, _| {
        let l = 0.299 * r + 0.587 * g + 0.114 * b;
        // Strongest at black/white, fading to 0 at the tonal-width boundary.
        let sh_inf = (1.0 - sh_mask.map_or(l, |m| m[i]) / sw).clamp(0.0, 1.0);
        let hi_inf = (1.0 - (1.0 - hi_mask.map_or(l, |m| m[i])) / hw).clamp(0.0, 1.0);
        let delta = sh_amount * sh_inf * (1.0 - l) - hi_amount * hi_inf * l;
        let (mut nr, mut ng, mut nb) = (
            (r + delta).clamp(0.0, 1.0),
            (g + delta).clamp(0.0, 1.0),
            (b + delta).clamp(0.0, 1.0),
        );
        // Midtone contrast: an S-curve fixed at 0/0.5/1 that steepens (mt>0) or
        // flattens (mt<0) the midtones, leaving black and white untouched.
        if mt != 0.0 {
            let curve = |v: f32| {
                let t = v - 0.5;
                (v + mt * t * (0.25 - t * t) * 4.0).clamp(0.0, 1.0)
            };
            nr = curve(nr);
            ng = curve(ng);
            nb = curve(nb);
        }
        // Color: scale chroma about the pixel's luma, weighted by how strongly it
        // sits in a corrected (shadow/highlight) region.
        if color != 0.0 {
            let infl = (sh_inf + hi_inf).clamp(0.0, 1.0);
            let satmul = 1.0 + color * infl;
            let nl = 0.299 * nr + 0.587 * ng + 0.114 * nb;
            nr = (nl + (nr - nl) * satmul).clamp(0.0, 1.0);
            ng = (nl + (ng - nl) * satmul).clamp(0.0, 1.0);
            nb = (nl + (nb - nl) * satmul).clamp(0.0, 1.0);
        }
        (nr, ng, nb)
    });
    // Black Clip / White Clip: a second pass, because the levels the clip is
    // measured against are the CORRECTED tones, not the ones we started with.
    if let Some((lo, hi)) = clip_endpoints(px, sel, p.black_clip, p.white_clip) {
        let f = |c: f32| levels_one(c, lo, hi, 1.0, 0.0, 1.0);
        map_rgb(px, sel, |r, g, b, _| (f(r), f(g), f(b)));
    }
}

// Selective Color — adjust the CMYK makeup of each colour band (Photoshop's
// reds/yellows/greens/cyans/blues/magentas/whites/neutrals/blacks). All 9 bands
// are applied in one pass: `corr` is band-major `[c,m,y,k]` × 9 (each -1..1),
// weighted into a pixel by its membership in each band. `relative` scales a
// shift by the channel's current amount; otherwise it is absolute.
pub fn selective_color(px: &mut [u16], sel: &Selection, corr: &[f32], relative: bool) {
    map_rgb(px, sel, |r, g, b, _| {
        selective_color_pixel(r, g, b, corr, relative)
    });
}

// Per-pixel Selective Color — shared by the destructive op above and the
// non-destructive adjustment layer (pixel_adjust kind 15). `corr` is 9 bands ×
// [Cyan, Magenta, Yellow, Black].
pub(crate) fn selective_color_pixel(
    r: f32,
    g: f32,
    b: f32,
    corr: &[f32],
    relative: bool,
) -> (f32, f32, f32) {
    let (c0, m0, y0) = (1.0 - r, 1.0 - g, 1.0 - b);
    let (mut dc, mut dm, mut dy, mut dk) = (0.0f32, 0.0f32, 0.0f32, 0.0f32);
    for band in 0..9u8 {
        let base = band as usize * 4;
        if base + 3 >= corr.len() {
            break;
        }
        let w = band_membership(band, r, g, b);
        if w <= 0.0 {
            continue;
        }
        dc += (if relative {
            c0 * corr[base]
        } else {
            corr[base]
        }) * w;
        dm += (if relative {
            m0 * corr[base + 1]
        } else {
            corr[base + 1]
        }) * w;
        dy += (if relative {
            y0 * corr[base + 2]
        } else {
            corr[base + 2]
        }) * w;
        dk += corr[base + 3] * w;
    }
    let c = (c0 + dc).clamp(0.0, 1.0);
    let m = (m0 + dm).clamp(0.0, 1.0);
    let y = (y0 + dy).clamp(0.0, 1.0);
    let (mut nr, mut ng, mut nb) = (1.0 - c, 1.0 - m, 1.0 - y);
    // Black slider: darken (k>0) or lighten (k<0).
    if dk >= 0.0 {
        let f = (1.0 - dk).clamp(0.0, 1.0);
        nr *= f;
        ng *= f;
        nb *= f;
    } else {
        let t = (-dk).clamp(0.0, 1.0);
        nr += (1.0 - nr) * t;
        ng += (1.0 - ng) * t;
        nb += (1.0 - nb) * t;
    }
    (nr.clamp(0.0, 1.0), ng.clamp(0.0, 1.0), nb.clamp(0.0, 1.0))
}


// Separable box blur on an f32 buffer (3 passes ≈ gaussian). Used by HDR Toning
// and the Camera Raw develop texture stage (`filters::texture_boost`).
pub(crate) fn blur_f32(buf: &mut [f32], w: u32, h: u32, radius: f32) {
    let r = radius.round() as i32;
    if r <= 0 {
        return;
    }
    let (wi, hi) = (w as i32, h as i32);
    for _ in 0..3 {
        let src = buf.to_vec();
        for y in 0..hi {
            for x in 0..wi {
                let (mut sum, mut cnt) = (0f32, 0f32);
                for dx in -r..=r {
                    sum += src[(y * wi + (x + dx).clamp(0, wi - 1)) as usize];
                    cnt += 1.0;
                }
                buf[(y * wi + x) as usize] = sum / cnt;
            }
        }
        let src = buf.to_vec();
        for y in 0..hi {
            for x in 0..wi {
                let (mut sum, mut cnt) = (0f32, 0f32);
                for dy in -r..=r {
                    sum += src[((y + dy).clamp(0, hi - 1) * wi + x) as usize];
                    cnt += 1.0;
                }
                buf[(y * wi + x) as usize] = sum / cnt;
            }
        }
    }
}

// Membership weight (0..1) of a pixel in a Selective Color band.
fn band_membership(band: u8, r: f32, g: f32, b: f32) -> f32 {
    let mx = r.max(g).max(b);
    let mn = r.min(g).min(b);
    let chroma = mx - mn;
    let whites = ((mn - 0.5) * 2.0).clamp(0.0, 1.0);
    let blacks = ((0.5 - mx) * 2.0).clamp(0.0, 1.0);
    match band {
        0..=5 => {
            // Chromatic: triangular hue window (60° half-width) weighted by chroma.
            let (h, _s, _l) = rgb_to_hsl(r, g, b);
            let hc = band as f32 * 60.0;
            let mut dh = (h - hc).abs();
            if dh > 180.0 {
                dh = 360.0 - dh;
            }
            (1.0 - dh / 60.0).clamp(0.0, 1.0) * chroma
        }
        6 => whites,
        7 => ((1.0 - chroma) - whites - blacks).clamp(0.0, 1.0), // neutrals
        8 => blacks,
        _ => 0.0,
    }
}

// Equalize — spread the luminance histogram across the full range (selection-
// masked). Hue is preserved by applying the remap as an additive luminance shift.
pub fn equalize(px: &mut [u16], sel: &Selection) {
    let n = (sel.w * sel.h) as usize;
    let mut hist = [0f64; 256];
    let mut total = 0f64;
    for i in 0..n {
        let cov = sel.coverage(i);
        if cov <= 0.0 {
            continue;
        }
        let p = i * 4;
        let l = 0.299 * (px[p] as f32 / 65535.0)
            + 0.587 * (px[p + 1] as f32 / 65535.0)
            + 0.114 * (px[p + 2] as f32 / 65535.0);
        let bin = ((l.clamp(0.0, 1.0) * 255.0 + 0.5) as usize).min(255);
        hist[bin] += cov as f64;
        total += cov as f64;
    }
    if total <= 0.0 {
        return;
    }
    // Standard equalization: LUT[i] = (cdf[i] - cdf_min) / (total - cdf_min).
    let cdf_min = hist.iter().copied().find(|&v| v > 0.0).unwrap_or(0.0);
    let denom = (total - cdf_min).max(1e-9);
    let mut cdf = 0f64;
    let mut lut = [0f32; 256];
    for (i, &hv) in hist.iter().enumerate() {
        cdf += hv;
        lut[i] = (((cdf - cdf_min) / denom).clamp(0.0, 1.0)) as f32;
    }
    map_rgb(px, sel, |r, g, b, _| {
        let l = (0.299 * r + 0.587 * g + 0.114 * b).clamp(0.0, 1.0);
        let bin = ((l * 255.0 + 0.5) as usize).min(255);
        let delta = lut[bin] - l;
        (
            (r + delta).clamp(0.0, 1.0),
            (g + delta).clamp(0.0, 1.0),
            (b + delta).clamp(0.0, 1.0),
        )
    });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgba(r: f32, g: f32, b: f32, a: f32) -> [u16; 4] {
        [to16(r), to16(g), to16(b), to16(a)]
    }

    fn pixels() -> Vec<u16> {
        [
            rgba(0.10, 0.20, 0.30, 1.0),
            rgba(0.45, 0.50, 0.55, 0.8),
            rgba(0.80, 0.15, 0.10, 0.6),
            rgba(0.95, 0.90, 0.20, 0.4),
        ]
        .concat()
    }

    fn selected(w: u32, h: u32) -> Selection {
        Selection::new(w, h)
    }

    fn masked(mask: &[u8]) -> Selection {
        let mut sel = Selection::new(2, 2);
        sel.set_mask(mask);
        sel
    }

    fn chan(px: &[u16], i: usize, c: usize) -> f32 {
        px[i * 4 + c] as f32 / 65535.0
    }

    #[test]
    fn map_rgb_based_adjustments_respect_masks_and_preserve_alpha() {
        let mut px = pixels();
        let before = px.clone();
        let sel = masked(&[255, 128, 0, 255]);
        brightness_contrast(&mut px, &sel, 0.2, 0.5);
        assert_ne!(&px[0..3], &before[0..3]);
        assert!(px[1] > before[1]);
        assert!(px[4] > before[4] && px[4] < to16(0.65));
        assert_eq!(&px[8..12], &before[8..12]);
        assert_eq!(px[3], before[3]);
        assert_eq!(px[7], before[7]);
    }

    #[test]
    fn point_color_shifts_only_the_targeted_socket_colour() {
        let mut px = [rgba(1.0, 0.0, 0.0, 1.0), rgba(0.0, 0.0, 1.0, 1.0)].concat();
        let before = px.clone();
        let sel = selected(2, 1);
        // Target red with a +30° hue push and a tight range: red drifts toward
        // orange (green channel rises), while blue is far away and untouched.
        point_color(
            &mut px,
            &sel,
            &[PointColorSocket {
                target: [1.0, 0.0, 0.0],
                range: 0.0,
                hue: 1.0,
                sat: 0.0,
                lum: 0.0,
            }],
        );
        assert!(px[1] > before[1] + 8000, "red gains green (toward orange)");
        assert_eq!(&px[4..8], &before[4..8], "blue pixel untouched");

        // A zero-shift socket and an empty socket list are both strict identities.
        let mut px2 = before.clone();
        point_color(&mut px2, &sel, &[]);
        assert_eq!(px2, before, "no sockets = identity");
    }

    #[test]
    fn levels_cover_all_channel_modes_and_composite_pipeline() {
        let sel = selected(2, 2);
        for channel in 0..=3 {
            let mut px = pixels();
            let before = pixels();
            levels(&mut px, &sel, 0.2, 0.8, 0.8, 0.1, 0.9, channel);
            match channel {
                1 => assert!(px
                    .chunks_exact(4)
                    .zip(before.chunks_exact(4))
                    .any(|(a, b)| a[0] != b[0])),
                2 => assert!(px
                    .chunks_exact(4)
                    .zip(before.chunks_exact(4))
                    .any(|(a, b)| a[1] != b[1])),
                3 => assert!(px
                    .chunks_exact(4)
                    .zip(before.chunks_exact(4))
                    .any(|(a, b)| a[2] != b[2])),
                _ => assert_ne!(px, before),
            }
        }

        let mut px = pixels();
        levels_multi(
            &mut px,
            &sel,
            &[0.0, 1.0, 1.0, 0.0, 1.0],
            &[0.1, 0.9, 1.2, 0.0, 1.0],
            &[0.0, 1.0, 0.8, 0.1, 0.9],
            &[0.2, 0.8, 1.0, 0.0, 1.0],
        );
        assert_ne!(px, pixels());
    }

    #[test]
    fn curves_apply_master_and_per_channel_luts_with_fractional_selection() {
        let mut master = vec![0u8; 256];
        let mut inv = vec![0u8; 256];
        let mut boost = vec![0u8; 256];
        for i in 0..256 {
            master[i] = i as u8;
            inv[i] = (255 - i) as u8;
            boost[i] = (i + 20).min(255) as u8;
        }
        let mut px = pixels();
        let before = px.clone();
        curves(
            &mut px,
            &masked(&[255, 0, 128, 255]),
            &master,
            &inv,
            &boost,
            &master,
        );
        assert!(chan(&px, 0, 0) > 0.80);
        assert_eq!(&px[4..8], &before[4..8]);
        assert!(chan(&px, 2, 0) < chan(&before, 2, 0));
    }

    #[test]
    fn feathered_adjustments_blend_toward_the_clamped_result() {
        // (#109) brightness +0.5 pushes 0.8 to an out-of-gamut 1.3. Under a 50%
        // mask Photoshop blends toward the clamped 1.0 (→ ~0.90); lerping the
        // raw overshoot would land on 1.05 and clip to white.
        let mut px = rgba(0.8, 0.8, 0.8, 1.0).to_vec();
        let mut sel = Selection::new(1, 1);
        sel.set_mask(&[128]);
        brightness_contrast(&mut px, &sel, 0.5, 0.0);
        assert!(
            (chan(&px, 0, 0) - 0.9).abs() < 0.005,
            "expected ~0.90, got {}",
            chan(&px, 0, 0)
        );
        assert!(px[0] < u16::MAX, "must not clip to white");
    }

    #[test]
    fn posterize_bands_the_input_range_evenly_like_photoshop() {
        // (#111) N=3 splits the input into thirds: the thresholds are ⅓ and ⅔, not
        // the half-steps 0.25/0.75 that round(c·(N-1)) produced. 0.30 belongs to
        // the bottom band (0.0) — it used to snap to the middle one (0.5).
        let level = |c: f32| {
            let mut px = rgba(c, c, c, 1.0).to_vec();
            posterize(&mut px, &selected(1, 1), 3);
            chan(&px, 0, 0)
        };
        assert!(
            level(0.30) < 0.01,
            "0.30 is in the bottom third: {}",
            level(0.30)
        );
        assert!((level(0.40) - 0.5).abs() < 0.01, "0.40 is the middle band");
        assert!(
            (level(0.60) - 0.5).abs() < 0.01,
            "0.60 is still the middle band"
        );
        assert!(
            level(0.70) > 0.99,
            "0.70 is in the top third: {}",
            level(0.70)
        );
        // The ends stay pinned and N=2 is unchanged (both schemes agree there).
        assert!(level(0.0) < 0.01 && level(1.0) > 0.99);
        let two = |c: f32| {
            let mut px = rgba(c, c, c, 1.0).to_vec();
            posterize(&mut px, &selected(1, 1), 2);
            chan(&px, 0, 0)
        };
        assert!(two(0.49) < 0.01 && two(0.51) > 0.99);
    }

    #[test]
    fn exposure_scales_in_linear_space_like_photoshop() {
        // (#107) PS computes Exposure at gamma 1.0: mid-grey at +1 EV lands on
        // ~0.68, not on 1.0 (0.5 × 2 in the encoded space blew out to white).
        let mut px = rgba(0.5, 0.5, 0.5, 1.0).to_vec();
        exposure(&mut px, &selected(1, 1), 1.0, 0.0, 1.0);
        let out = chan(&px, 0, 0);
        assert!((out - 0.6825).abs() < 0.005, "expected ~0.68, got {out}");
        assert!(out < 1.0, "mid-grey at +1 EV must not clip to white");

        // Neutral settings stay byte-identical (encode ∘ decode round-trips).
        let mut same = rgba(0.25, 0.5, 0.75, 1.0).to_vec();
        let before = same.clone();
        exposure(&mut same, &selected(1, 1), 0.0, 0.0, 1.0);
        for (a, b) in same.iter().zip(before.iter()) {
            assert!((*a as i32 - *b as i32).abs() <= 1, "{a} vs {b}");
        }
    }

    #[test]
    fn curves_and_gradient_map_keep_16_bit_precision() {
        // (#110) An identity curve must be a strict identity on 16-bit data —
        // high-byte indexing mapped 300 → 257 and collapsed every channel to
        // 256 output levels.
        let identity: Vec<u8> = (0..256).map(|i| i as u8).collect();
        let mut px = vec![300u16, 1_000, 40_001, 65_535];
        curves(
            &mut px,
            &selected(1, 1),
            &identity,
            &identity,
            &identity,
            &identity,
        );
        assert_eq!(&px[0..3], &[300, 1_000, 40_001]);

        // Two greys sharing a high byte must stay distinct through a gradient
        // map instead of snapping to the same 8-bit stop.
        let mut lut = vec![255u8; 256 * 4];
        for i in 0..256 {
            lut[i * 4] = i as u8;
            lut[i * 4 + 1] = i as u8;
            lut[i * 4 + 2] = i as u8;
        }
        let mut greys = [rgba(0.0, 0.0, 0.0, 1.0), rgba(0.0, 0.0, 0.0, 1.0)].concat();
        greys[0..3].copy_from_slice(&[300, 300, 300]);
        greys[4..7].copy_from_slice(&[320, 320, 320]);
        gradient_map(&mut greys, &selected(2, 1), &lut);
        assert!(
            greys[0] < greys[4],
            "16-bit greys must not collapse: {} vs {}",
            greys[0],
            greys[4]
        );
    }

    // The destructive op and the adjustment layer are one implementation; these
    // pin the widened parameter blocks to the layer kernel through the full
    // 16-bit buffer path (selection lerp, clamp, quantisation included).
    #[test]
    fn hue_saturation_params_matches_the_layer_kernel_and_legacy_call() {
        let sel = selected(2, 2);
        let mut wide = pixels();
        let mut legacy = pixels();
        let mut p = vec![0.0f32; HUE_SAT_PARAMS];
        p[..3].copy_from_slice(&[30.0, 0.4, -0.1]);
        hue_saturation_params(&mut wide, &sel, &p);
        hue_saturation(&mut legacy, &sel, 30.0, 0.4, -0.1);
        assert_eq!(wide, legacy, "zeroed ranges are the legacy three sliders");

        // Reds +120° recolours the red pixel (index 2) and leaves the near-grey
        // pixel (index 1) alone.
        let mut ranged = pixels();
        p[4] = 120.0;
        hue_saturation_params(&mut ranged, &sel, &p);
        assert_ne!(&ranged[8..11], &legacy[8..11]);
        assert_eq!(&ranged[4..7], &legacy[4..7]);
    }

    #[test]
    fn black_and_white_params_grades_by_hue_and_tints() {
        let sel = selected(2, 2);
        let mut legacy = pixels();
        black_and_white_params(&mut legacy, &sel, &[0.3, 0.59, 0.11]);
        let mut direct = pixels();
        black_and_white(&mut direct, &sel, 0.3, 0.59, 0.11);
        assert_eq!(legacy, direct, "a short block is still the RGB weights");

        // Six-slider mode: drop the Reds slider to 0 and the red pixel (index 2,
        // 0.80/0.15/0.10) falls back to its achromatic base (its 0.10 minimum
        // channel) instead of its 0.34 weighted luminance.
        let mut p = vec![0.0f32; BW_PARAMS];
        p[0] = 1.0;
        p[3..9].copy_from_slice(&[0.0, 0.6, 0.4, 0.6, 0.2, 0.8]);
        let mut bands = pixels();
        black_and_white_params(&mut bands, &sel, &p);
        let crushed = chan(&bands, 2, 0);
        assert!(
            crushed < 0.15 && crushed < chan(&legacy, 2, 0),
            "reds crushed toward the achromatic base: {crushed}"
        );
        assert_eq!(bands[8], bands[9], "still grey");

        // Tint on: the same pixel is no longer grey, and alpha is untouched.
        p[9] = 1.0;
        p[10] = 40.0;
        p[11] = 0.4;
        let mut tinted = pixels();
        black_and_white_params(&mut tinted, &sel, &p);
        assert!(tinted[8] > tinted[10], "warm tint on the red pixel");
        assert_eq!(tinted[11], pixels()[11], "alpha preserved");
    }

    #[test]
    fn color_adjustment_suite_changes_expected_tonal_properties() {
        let sel = selected(2, 2);

        let mut hue = pixels();
        hue_saturation(&mut hue, &sel, 120.0, 0.5, -0.2);
        assert_ne!(hue, pixels());

        let mut replaced = pixels();
        replace_color(&mut replaced, &sel, [204, 38, 25], 120.0, 120.0, 0.5, 0.2);
        assert_ne!(&replaced[8..12], &pixels()[8..12]);
        let mut not_replaced = pixels();
        replace_color(&mut not_replaced, &sel, [0, 255, 0], 1.0, 120.0, 0.5, 0.2);
        assert_eq!(not_replaced, pixels());

        let mut vib = pixels();
        vibrance(&mut vib, &sel, 0.8, 0.1);
        assert_ne!(vib, pixels());

        let mut inv = pixels();
        invert(&mut inv, &sel);
        assert!(chan(&inv, 0, 0) > 0.89);

        let mut sol = pixels();
        solarize(&mut sol, &sel);
        assert!(chan(&sol, 3, 0) < 0.1);

        let mut gray = pixels();
        desaturate(&mut gray, &sel);
        assert_eq!(gray[0], gray[1]);
        black_and_white(&mut gray, &sel, 0.0, 0.0, 0.0);
        assert_eq!(gray[0], gray[1]);

        let mut th = pixels();
        threshold(&mut th, &sel, 0.5);
        assert_eq!(chan(&th, 0, 0), 0.0);
        assert_eq!(chan(&th, 3, 0), 1.0);

        let mut post = pixels();
        posterize(&mut post, &sel, 1);
        assert!(post.iter().step_by(4).all(|&v| v == 0 || v == 65535));
    }

    #[test]
    fn exposure_balance_filters_and_channel_mixer_cover_preserve_luminosity_paths() {
        let sel = selected(2, 2);

        let mut exp = pixels();
        exposure(&mut exp, &sel, 1.0, 0.05, 0.8);
        assert!(chan(&exp, 0, 0) > chan(&pixels(), 0, 0));

        let mut bal = pixels();
        color_balance(
            &mut bal,
            &sel,
            [1.0, -1.0, 0.0],
            [0.0, 1.0, -1.0],
            [-1.0, 0.0, 1.0],
            true,
        );
        assert_ne!(bal, pixels());
        let mut bal_no_lum = pixels();
        color_balance(
            &mut bal_no_lum,
            &sel,
            [1.0, 0.0, 0.0],
            [0.0, 0.0, 0.0],
            [0.0, 0.0, -1.0],
            false,
        );
        assert_ne!(bal_no_lum, pixels());

        let mut pf = pixels();
        photo_filter(&mut pf, &sel, 1.0, 0.4, 0.2, 0.6, true);
        assert_ne!(pf, pixels());
        let mut pf_no_lum = pixels();
        photo_filter(&mut pf_no_lum, &sel, 0.1, 1.0, 0.2, 0.6, false);
        assert_ne!(pf_no_lum, pixels());

        let mut mixed = pixels();
        channel_mixer(
            &mut mixed,
            &sel,
            [
                [0.0, 1.0, 0.0, 0.1],
                [1.0, 0.0, 0.0, -0.1],
                [0.0, 0.0, 1.0, 0.0],
            ],
        );
        assert_ne!(mixed, pixels());
    }

    #[test]
    fn camera_raw_lookup_gradient_map_shadows_and_selective_color_are_exercised() {
        let sel = masked(&[255, 255, 0, 128]);
        let mut raw = pixels();
        camera_raw(
            &mut raw, &sel, 0.5, 0.4, 0.3, -0.6, 0.8, 0.7, 0.4, 0.6, 0.3, 0.8,
        );
        assert_ne!(&raw[0..8], &pixels()[0..8]);
        assert_eq!(&raw[8..12], &pixels()[8..12]);

        let mut lookup = pixels();
        color_lookup(&mut lookup, &selected(2, 2), &[2.0]);
        assert_ne!(lookup, pixels());

        let mut lut = vec![0u8; 256 * 4];
        for i in 0..256 {
            lut[i * 4] = i as u8;
            lut[i * 4 + 1] = (255 - i) as u8;
            lut[i * 4 + 2] = 128;
            lut[i * 4 + 3] = 255;
        }
        let mut mapped = pixels();
        gradient_map(&mut mapped, &selected(2, 2), &lut);
        assert_ne!(mapped, pixels());

        let mut sh = pixels();
        shadows_highlights(
            &mut sh,
            &selected(2, 2),
            &ShadowsHighlights {
                sh_amount: 0.8,
                sh_width: 0.6,
                hi_amount: 0.7,
                hi_width: 0.5,
                ..Default::default()
            },
        );
        assert!(chan(&sh, 0, 0) > chan(&pixels(), 0, 0));
        assert!(chan(&sh, 3, 0) < chan(&pixels(), 3, 0));

        let mut corr = vec![0.0f32; 36];
        for band in 0..9 {
            corr[band * 4] = 0.2;
            corr[band * 4 + 1] = -0.1;
            corr[band * 4 + 2] = 0.15;
            corr[band * 4 + 3] = if band % 2 == 0 { 0.2 } else { -0.2 };
        }
        let mut selective = [
            rgba(1.0, 0.0, 0.0, 1.0),
            rgba(1.0, 1.0, 0.0, 1.0),
            rgba(0.0, 1.0, 0.0, 1.0),
            rgba(0.0, 1.0, 1.0, 1.0),
            rgba(0.0, 0.0, 1.0, 1.0),
            rgba(1.0, 0.0, 1.0, 1.0),
            rgba(0.9, 0.9, 0.9, 1.0),
            rgba(0.5, 0.5, 0.5, 1.0),
            rgba(0.1, 0.1, 0.1, 1.0),
        ]
        .concat();
        let before = selective.clone();
        selective_color(&mut selective, &selected(3, 3), &corr, true);
        assert_ne!(selective, before);
        selective_color(&mut selective, &selected(3, 3), &corr[..8], false);
    }


    #[test]
    fn wb_tint_shifts_green_against_magenta() {
        let sel = selected(2, 2);
        // A neutral grey so all three channels start equal.
        let mut px = [rgba(0.5, 0.5, 0.5, 1.0); 4].concat();
        let before = px.clone();
        wb_tint(&mut px, &sel, 0.0);
        assert_eq!(px, before, "tint 0 is byte-identical");

        // The INTERNAL axis (what the stored recipe carries): positive raises G.
        // The user-facing ACR axis is negated at the slider / XMP boundary. (#108)
        let mut px2 = before.clone();
        wb_tint(&mut px2, &sel, 0.6);
        assert!(px2[1] > before[1], "green rises");
        assert!(px2[0] < before[0], "red falls (toward magenta axis)");
        assert!(px2[2] < before[2], "blue falls");
    }

    #[test]
    fn whites_blacks_move_endpoints_monotonically() {
        let sel = selected(2, 2);
        let mut px = [
            rgba(0.0, 0.0, 0.0, 1.0),
            rgba(0.5, 0.5, 0.5, 1.0),
            rgba(0.8, 0.8, 0.8, 1.0),
            rgba(1.0, 1.0, 1.0, 1.0),
        ]
        .concat();
        let base = px.clone();
        whites_blacks(&mut px, &sel, 0.0, 0.0);
        assert_eq!(px, base, "neutral whites/blacks is byte-identical");

        // Whites > 0 pulls the white point down → highlights brighten, black stays.
        let mut hi = base.clone();
        whites_blacks(&mut hi, &sel, 0.6, 0.0);
        assert!(
            hi[4] > base[4],
            "midtone brightens as the white point drops"
        );
        assert_eq!(hi[0], base[0], "pure black stays put");

        // Blacks > 0 pushes the black point below 0 → shadows lift.
        let mut lo = base.clone();
        whites_blacks(&mut lo, &sel, 0.0, 0.6);
        assert!(
            lo[0] > base[0],
            "black lifts as the black point drops below 0"
        );
    }

    // The six-argument kernel Shadows/Highlights shipped with, verbatim (main
    // before #442). Radius 0 and clip 0 are what every caller that never opened
    // Show More Options sends — `adj.shadowsHighlights`'s defaults, the replay
    // of an old six-param smart filter — and that path must still be this,
    // byte for byte.
    fn legacy_shadows_highlights(
        px: &mut [u16],
        sel: &Selection,
        sh_amount: f32,
        sh_width: f32,
        hi_amount: f32,
        hi_width: f32,
        color: f32,
        midtone: f32,
    ) {
        let sw = sh_width.clamp(0.01, 1.0);
        let hw = hi_width.clamp(0.01, 1.0);
        let mt = midtone.clamp(-0.5, 0.5);
        map_rgb(px, sel, |r, g, b, _| {
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            let sh_inf = (1.0 - l / sw).clamp(0.0, 1.0);
            let hi_inf = (1.0 - (1.0 - l) / hw).clamp(0.0, 1.0);
            let delta = sh_amount * sh_inf * (1.0 - l) - hi_amount * hi_inf * l;
            let (mut nr, mut ng, mut nb) = (
                (r + delta).clamp(0.0, 1.0),
                (g + delta).clamp(0.0, 1.0),
                (b + delta).clamp(0.0, 1.0),
            );
            if mt != 0.0 {
                let curve = |v: f32| {
                    let t = v - 0.5;
                    (v + mt * t * (0.25 - t * t) * 4.0).clamp(0.0, 1.0)
                };
                nr = curve(nr);
                ng = curve(ng);
                nb = curve(nb);
            }
            if color != 0.0 {
                let infl = (sh_inf + hi_inf).clamp(0.0, 1.0);
                let satmul = 1.0 + color * infl;
                let nl = 0.299 * nr + 0.587 * ng + 0.114 * nb;
                nr = (nl + (nr - nl) * satmul).clamp(0.0, 1.0);
                ng = (nl + (ng - nl) * satmul).clamp(0.0, 1.0);
                nb = (nl + (nb - nl) * satmul).clamp(0.0, 1.0);
            }
            (nr, ng, nb)
        });
    }

    // A coloured gradient with a dark corner, a bright corner and no pure black
    // or white, so a leaked radius or clip has something to move.
    fn varied_plane(w: usize, h: usize) -> Vec<u16> {
        let mut px = Vec::with_capacity(w * h * 4);
        for y in 0..h {
            for x in 0..w {
                let (u, v) = (x as f32 / (w - 1) as f32, y as f32 / (h - 1) as f32);
                px.extend_from_slice(&rgba(
                    0.05 + 0.85 * u,
                    0.1 + 0.7 * v,
                    0.08 + 0.8 * (1.0 - u) * v,
                    1.0,
                ));
            }
        }
        px
    }

    #[test]
    fn shadows_highlights_old_path_is_the_legacy_kernel_byte_for_byte() {
        let (w, h) = (24usize, 20usize);
        let sel = selected(w as u32, h as u32);
        let mut want = varied_plane(w, h);
        legacy_shadows_highlights(&mut want, &sel, 0.35, 0.5, 0.2, 0.5, 0.2, 0.1);
        assert_ne!(want, varied_plane(w, h), "the reference kernel did something");
        let run = |sr: f32, hr: f32, black_clip: f32, white_clip: f32| -> Vec<u16> {
            let mut px = varied_plane(w, h);
            let p = ShadowsHighlights {
                sh_amount: 0.35,
                sh_width: 0.5,
                sh_radius: sr,
                hi_amount: 0.2,
                hi_width: 0.5,
                hi_radius: hr,
                color: 0.2,
                midtone: 0.1,
                black_clip,
                white_clip,
            };
            shadows_highlights(&mut px, &sel, &p);
            px
        };
        assert_eq!(run(0.0, 0.0, 0.0, 0.0), want, "radius 0 / clip 0 is the six-argument kernel");
        // The dialog's own clip defaults, 0.01% either end: a hundredth of a
        // pixel on this plane rounds to no pixel, so OK on an untouched Show
        // More Options row still gives the old result.
        assert_eq!(run(0.0, 0.0, 1e-4, 1e-4), want, "the dialog's default clips change nothing");
        assert_ne!(run(6.0, 6.0, 0.0, 0.0), want, "the pin has teeth: a radius moves it");
        assert_ne!(run(0.0, 0.0, 0.1, 0.1), want, "the pin has teeth: a clip moves it");
    }
}
