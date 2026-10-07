// ─────────────────────────────────────────────────────────────
// Per-pixel adjustment dispatch — used by non-destructive adjustment
// layers, which apply their transform to the composited backdrop at
// composite time. `params` packs the controls (and a LUT for curves /
// gradient map). Mirrors the destructive ops in adjust.rs.
// ─────────────────────────────────────────────────────────────

use crate::raster::color::*;

// kind ids (kept in lockstep with the TS `ADJ_LAYER` table):
// 0 brightness/contrast, 1 levels,
// 2 hue/sat ([hue, sat, light, colorize, six ranges × hue/sat/light]),
// 3 vibrance, 4 invert, 5 desaturate,
// 6 black&white (legacy RGB weights or 12-float six-band + Tint block),
// 7 posterize, 8 threshold, 9 exposure,
// 10 color balance (9 shifts + optional [9] preserve-luminosity),
// 11 photo filter (r,g,b,density + optional [4] preserve-luminosity),
// 12 curves(LUT256), 13 gradient map(LUT256*3),
// 14 channel mixer (3 output rows × [r,g,b,constant]),
// 15 selective color ([relative_flag, 9 bands × [C,M,Y,K]]),
// 16 color lookup ([preset_id], or a loaded 3D LUT — see `lut3d_pixel`)
pub fn apply_pixel(kind: u8, p: &[f32], r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    match kind {
        0 => {
            let (br, c) = (get(p, 0), 1.0 + get(p, 1));
            (
                (r - 0.5) * c + 0.5 + br,
                (g - 0.5) * c + 0.5 + br,
                (b - 0.5) * c + 0.5 + br,
            )
        }
        1 => {
            let (ib, iw, gamma, ob, ow) = (
                get(p, 0),
                get(p, 1),
                get(p, 2).max(1e-4),
                get(p, 3),
                get(p, 4),
            );
            let inv = (iw - ib).max(1e-4);
            let f = |c: f32| {
                let v = ((c - ib) / inv).clamp(0.0, 1.0).powf(1.0 / gamma);
                ob + v * (ow - ob)
            };
            (f(r), f(g), f(b))
        }
        2 => crate::raster::adjust::hue_saturation_pixel(r, g, b, p),
        3 => {
            let (h, s, v) = rgb_to_hsv(r, g, b);
            let ns = (s + get(p, 0) * (1.0 - s) + get(p, 1)).clamp(0.0, 1.0);
            hsv_to_rgb(h, ns, v)
        }
        4 => (1.0 - r, 1.0 - g, 1.0 - b),
        5 => {
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            (l, l, l)
        }
        6 => crate::raster::adjust::black_white_pixel(r, g, b, p),
        7 => {
            let n = (get(p, 0).max(2.0) - 1.0).max(1.0);
            let q = |c: f32| (c * n).round() / n;
            (q(r), q(g), q(b))
        }
        8 => {
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            let v = if l >= get(p, 0) { 1.0 } else { 0.0 };
            (v, v, v)
        }
        9 => {
            // (#107) Linear-space Exposure, shared with the destructive op.
            let mul = 2f32.powf(get(p, 0));
            let off = get(p, 1);
            let ig = 1.0 / get(p, 2).max(1e-4);
            let f = |c: f32| crate::raster::adjust::exposure_channel(c, mul, off, ig);
            (f(r), f(g), f(b))
        }
        10 => {
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            let ws = (1.0 - l).powi(2);
            let wh = l.powi(2);
            let wm = (1.0 - (2.0 * l - 1.0).abs()).max(0.0);
            let shift =
                |i: usize| 0.25 * (get(p, i) * ws + get(p, 3 + i) * wm + get(p, 6 + i) * wh);
            let (mut nr, mut ng, mut nb) = (
                (r + shift(0)).clamp(0.0, 1.0),
                (g + shift(1)).clamp(0.0, 1.0),
                (b + shift(2)).clamp(0.0, 1.0),
            );
            // p[9] = Preserve Luminosity. Absent (old 9-param layers) reads 0.0,
            // so saved documents keep the look they were saved with. Same maths
            // as adjust::color_balance, so the layer and Image > Adjustments >
            // Color Balance agree.
            if get(p, 9) > 0.5 {
                let nl = 0.299 * nr + 0.587 * ng + 0.114 * nb;
                let d = l - nl;
                nr = (nr + d).clamp(0.0, 1.0);
                ng = (ng + d).clamp(0.0, 1.0);
                nb = (nb + d).clamp(0.0, 1.0);
            }
            (nr, ng, nb)
        }
        11 => {
            let (fr, fg, fb, d) = (get(p, 0), get(p, 1), get(p, 2), get(p, 3));
            let (mut nr, mut ng, mut nb) = (
                (r * (1.0 - d) + r * fr * d * 2.0).clamp(0.0, 1.0),
                (g * (1.0 - d) + g * fg * d * 2.0).clamp(0.0, 1.0),
                (b * (1.0 - d) + b * fb * d * 2.0).clamp(0.0, 1.0),
            );
            // p[4] = Preserve Luminosity — see kind 10. Mirrors
            // adjust::photo_filter, which scales back to the SOURCE luminance.
            if get(p, 4) > 0.5 {
                let l = 0.299 * r + 0.587 * g + 0.114 * b;
                let nl = (0.299 * nr + 0.587 * ng + 0.114 * nb).max(1e-4);
                let sc = l / nl;
                nr = (nr * sc).clamp(0.0, 1.0);
                ng = (ng * sc).clamp(0.0, 1.0);
                nb = (nb * sc).clamp(0.0, 1.0);
            }
            (nr, ng, nb)
        }
        12 => {
            if p.len() < 256 {
                return (r, g, b);
            }
            let lut = |c: f32| lut_lerp(p, 1, 0, c);
            (lut(r), lut(g), lut(b))
        }
        13 => {
            if p.len() < 256 * 3 {
                return (r, g, b);
            }
            let l = 0.299 * r + 0.587 * g + 0.114 * b;
            (
                lut_lerp(p, 3, 0, l),
                lut_lerp(p, 3, 1, l),
                lut_lerp(p, 3, 2, l),
            )
        }
        14 => {
            if p.len() < 12 {
                return (r, g, b);
            }
            let mix = |o: usize| {
                (p[o * 4] * r + p[o * 4 + 1] * g + p[o * 4 + 2] * b + p[o * 4 + 3]).clamp(0.0, 1.0)
            };
            (mix(0), mix(1), mix(2))
        }
        15 => {
            // selective color: p = [relative_flag, 9 bands × [C,M,Y,K]] (37 values)
            if p.len() < 37 {
                return (r, g, b);
            }
            crate::raster::adjust::selective_color_pixel(r, g, b, &p[1..], p[0] > 0.5)
        }
        16 => {
            // color lookup: p = [preset_id], or [-1, ...] for a loaded 3D LUT.
            if p.is_empty() {
                return (r, g, b);
            }
            if p[0] < 0.0 {
                return lut3d_pixel(p, r, g, b);
            }
            color_lookup_pixel(p[0] as u8, r, g, b)
        }
        _ => (r, g, b),
    }
}

// Color Lookup (Image ▸ Adjustments / adjustment-layer kind 16). A small roster
// of built-in creative looks, each a deterministic RGB grade (0..1 in/out).
// Preset 0 (and any unknown id) is the identity. These are Monet Vision's own
// looks, not Adobe's proprietary LUTs, but cover the same creative ground.
pub(crate) fn color_lookup_pixel(preset: u8, r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let contrast = |x: f32, k: f32| (x - 0.5) * k + 0.5;
    let luma = 0.299 * r + 0.587 * g + 0.114 * b;
    let sat = |c: f32, amt: f32| luma + (c - luma) * amt; // amt<1 desaturates, >1 boosts
    let (or, og, ob) = match preset {
        1 => (
            contrast(r, 1.12) * 1.06 + 0.02,
            contrast(g, 1.12),
            contrast(b, 1.12) * 0.92,
        ), // Crisp Warm
        2 => (
            contrast(r, 1.12) * 0.92,
            contrast(g, 1.12),
            contrast(b, 1.12) * 1.08 + 0.02,
        ), // Crisp Winter
        3 => (
            contrast(sat(r, 0.35), 1.4),
            contrast(sat(g, 0.35), 1.4),
            contrast(sat(b, 0.35), 1.4),
        ), // Bleach Bypass
        4 => (r * 1.10 + 0.04, g * 0.98 + 0.02, b * 0.78), // Candlelight
        5 => (r * 0.95, g * 1.02, b * 0.62 + 0.05),        // Drop Blues
        6 => (
            sat(r, 1.2) * 1.04 + 0.02,
            sat(g, 1.2) * 0.98,
            sat(b, 1.2) * 0.9,
        ), // Fall Colors
        7 => {
            let d = luma * 0.8; // Moonlight — cool, near-monochrome blue
            (d * 0.8 + 0.02, d * 0.95 + 0.03, d * 1.2 + 0.08)
        }
        8 => (
            contrast(r, 0.92) * 1.04 + 0.03,
            contrast(g, 0.92) + 0.02,
            contrast(b, 0.92) * 0.96 + 0.02,
        ), // Soft Warming
        _ => (r, g, b),
    };
    (or.clamp(0.0, 1.0), og.clamp(0.0, 1.0), ob.clamp(0.0, 1.0))
}

/// Largest 3D LUT a kind-16 layer accepts (64³·3 floats ≈ 3 MB of params) —
/// the same ceiling as monet-photo's `.cube`/`.3dl` parser.
pub const MAX_LUT3D_SIZE: usize = 64;
const LUT3D_HEADER: usize = 8;

/// Color Lookup with an external .cube/.3dl LUT (#441). The table rides the
/// layer's own params — `[-1, N, domain_min×3, domain_max×3, N³·3 output
/// triplets, red varying fastest]` — so it composites live, re-opens editable
/// and persists with the layer through MVSN like any other adj_params.
/// Trilinear, mirroring monet-photo `sampleLut3D`; a malformed table (bad N,
/// truncated data) is the identity rather than a panic.
fn lut3d_pixel(p: &[f32], r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let n = get(p, 1) as usize;
    if n < 2 || n > MAX_LUT3D_SIZE || p.len() < LUT3D_HEADER + n * n * n * 3 {
        return (r, g, b);
    }
    let d = &p[LUT3D_HEADER..];
    let nf = (n - 1) as f32;
    let axis = |v: f32, lo: f32, hi: f32| {
        if hi > lo { ((v - lo) / (hi - lo)).clamp(0.0, 1.0) * nf } else { 0.0 }
    };
    let (fr, fg, fb) = (axis(r, p[2], p[5]), axis(g, p[3], p[6]), axis(b, p[4], p[7]));
    let (r0, g0, b0) = (fr.floor() as usize, fg.floor() as usize, fb.floor() as usize);
    let (r1, g1, b1) = ((r0 + 1).min(n - 1), (g0 + 1).min(n - 1), (b0 + 1).min(n - 1));
    let (dr, dg, db) = (fr - r0 as f32, fg - g0 as f32, fb - b0 as f32);
    let idx = |ri: usize, gi: usize, bi: usize| ((bi * n + gi) * n + ri) * 3;
    let lerp = |a: f32, c: f32, t: f32| a + (c - a) * t;
    let mut out = [0f32; 3];
    for (c, o) in out.iter_mut().enumerate() {
        let c00 = lerp(d[idx(r0, g0, b0) + c], d[idx(r1, g0, b0) + c], dr);
        let c10 = lerp(d[idx(r0, g1, b0) + c], d[idx(r1, g1, b0) + c], dr);
        let c01 = lerp(d[idx(r0, g0, b1) + c], d[idx(r1, g0, b1) + c], dr);
        let c11 = lerp(d[idx(r0, g1, b1) + c], d[idx(r1, g1, b1) + c], dr);
        *o = lerp(lerp(c00, c10, dg), lerp(c01, c11, dg), db).clamp(0.0, 1.0);
    }
    (out[0], out[1], out[2])
}

#[inline]
fn get(p: &[f32], i: usize) -> f32 {
    p.get(i).copied().unwrap_or(0.0)
}

/// Sample a 256-entry transfer LUT at a 0..1 position, interpolating between
/// neighbouring entries — `adjust::lut_sample`'s f32 sibling (#110). Rounding to
/// the nearest entry quantized the composite to 256 levels, so even an identity
/// curve was not the identity and smooth gradients banded. `stride`/`channel`
/// select the plane in an interleaved LUT (gradient map packs r,g,b per entry).
#[inline]
fn lut_lerp(lut: &[f32], stride: usize, channel: usize, t: f32) -> f32 {
    let x = t.clamp(0.0, 1.0) * 255.0;
    let i = x.floor() as usize;
    let f = x - i as f32;
    let lo = lut[i * stride + channel];
    let hi = lut[(i + 1).min(255) * stride + channel];
    lo + (hi - lo) * f
}

#[cfg(test)]
mod tests {
    use super::apply_pixel;

    /// An adjustment LAYER and the matching Image > Adjustments command are two
    /// implementations of one adjustment, and they had drifted: `adjust.rs`
    /// honoured Preserve Luminosity for Color Balance and Photo Filter (the
    /// dialogs expose the checkbox, and Photoshop defaults it ON), while the
    /// layer kernels had no slot for it at all. Same settings, different image,
    /// depending only on how you applied it. These pin the two together.
    mod preserve_luminosity_matches_the_destructive_op {
        use super::apply_pixel;
        use crate::raster::adjust;
        use crate::raster::color;
        use crate::raster::selection::Selection;

        /// Run a destructive op over one pixel and read it back as 0..1 floats.
        fn destructive(rgb: (f32, f32, f32), run: impl Fn(&mut [u16], &Selection)) -> (f32, f32, f32) {
            let mut px = [
                color::to16(rgb.0), color::to16(rgb.1), color::to16(rgb.2), 65535u16,
            ];
            run(&mut px, &Selection::new(1, 1));
            (
                px[0] as f32 / 65535.0,
                px[1] as f32 / 65535.0,
                px[2] as f32 / 65535.0,
            )
        }

        fn close(a: (f32, f32, f32), b: (f32, f32, f32)) -> bool {
            (a.0 - b.0).abs() < 2e-4 && (a.1 - b.1).abs() < 2e-4 && (a.2 - b.2).abs() < 2e-4
        }

        /// Deliberately off-grey and off-neutral: a grey pixel is unchanged by a
        /// luminance-preserving correction, so it could not detect the flag.
        const PIX: (f32, f32, f32) = (0.62, 0.34, 0.18);

        #[test]
        fn color_balance_agrees_with_and_without_the_flag() {
            let sh = [0.4f32, -0.2, 0.1];
            let mid = [-0.3f32, 0.25, 0.0];
            let hi = [0.1f32, 0.1, -0.4];
            for preserve in [false, true] {
                let mut params: Vec<f32> = sh.iter().chain(mid.iter()).chain(hi.iter()).copied().collect();
                params.push(if preserve { 1.0 } else { 0.0 });
                let layer = apply_pixel(10, &params, PIX.0, PIX.1, PIX.2);
                let direct = destructive(PIX, |px, sel| adjust::color_balance(px, sel, sh, mid, hi, preserve));
                assert!(close(layer, direct), "preserve={preserve}: layer {layer:?} vs direct {direct:?}");
            }
        }

        #[test]
        fn photo_filter_agrees_with_and_without_the_flag() {
            let (fr, fg, fb, d) = (0.93f32, 0.54, 0.0, 0.25);
            for preserve in [false, true] {
                let params = [fr, fg, fb, d, if preserve { 1.0 } else { 0.0 }];
                let layer = apply_pixel(11, &params, PIX.0, PIX.1, PIX.2);
                let direct = destructive(PIX, |px, sel| adjust::photo_filter(px, sel, fr, fg, fb, d, preserve));
                assert!(close(layer, direct), "preserve={preserve}: layer {layer:?} vs direct {direct:?}");
            }
        }

        /// Sensitivity control: the flag must actually CHANGE the result, or the
        /// equivalence tests above would pass for a kernel that ignores it.
        #[test]
        fn the_flag_is_not_inert() {
            let cb = |on: f32| apply_pixel(10, &[0.4, -0.2, 0.1, -0.3, 0.25, 0.0, 0.1, 0.1, -0.4, on], PIX.0, PIX.1, PIX.2);
            assert!(!close(cb(0.0), cb(1.0)), "Color Balance: preserve-luminosity must change the pixel");
            let pf = |on: f32| apply_pixel(11, &[0.93, 0.54, 0.0, 0.25, on], PIX.0, PIX.1, PIX.2);
            assert!(!close(pf(0.0), pf(1.0)), "Photo Filter: preserve-luminosity must change the pixel");
        }

        /// Back-compat: a document saved before the flag existed carries 9 (or 4)
        /// params and must render exactly as it always did.
        #[test]
        fn a_shorter_saved_param_list_keeps_the_old_look() {
            let old = apply_pixel(10, &[0.4, -0.2, 0.1, -0.3, 0.25, 0.0, 0.1, 0.1, -0.4], PIX.0, PIX.1, PIX.2);
            let off = apply_pixel(10, &[0.4, -0.2, 0.1, -0.3, 0.25, 0.0, 0.1, 0.1, -0.4, 0.0], PIX.0, PIX.1, PIX.2);
            assert!(close(old, off), "a 9-param Color Balance layer must read preserve as OFF");
            let old11 = apply_pixel(11, &[0.93, 0.54, 0.0, 0.25], PIX.0, PIX.1, PIX.2);
            let off11 = apply_pixel(11, &[0.93, 0.54, 0.0, 0.25, 0.0], PIX.0, PIX.1, PIX.2);
            assert!(close(old11, off11), "a 4-param Photo Filter layer must read preserve as OFF");
        }
    }

    #[test]
    fn channel_mixer_swaps_red_and_blue() {
        // out R = in B, out B = in R, G identity.
        let m = [0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0];
        let (r, g, b) = apply_pixel(14, &m, 0.8, 0.4, 0.1);
        assert!((r - 0.1).abs() < 1e-5, "R←B: {r}");
        assert!((g - 0.4).abs() < 1e-5, "G identity: {g}");
        assert!((b - 0.8).abs() < 1e-5, "B←R: {b}");
    }

    #[test]
    fn channel_mixer_constant_and_clamp() {
        let m = [1.0, 0.0, 0.0, 0.5, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, -0.2];
        let (r, _g, b) = apply_pixel(14, &m, 0.8, 0.4, 0.1);
        assert!((r - 1.0).abs() < 1e-5, "R = 0.8+0.5 clamps to 1: {r}");
        assert!(b.abs() < 1e-5, "B = 0.1-0.2 clamps to 0: {b}");
    }

    #[test]
    fn unknown_kind_is_identity() {
        assert_eq!(apply_pixel(200, &[], 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
    }

    #[test]
    fn color_lookup_preset_zero_is_identity() {
        assert_eq!(apply_pixel(16, &[0.0], 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
    }

    #[test]
    fn color_lookup_empty_params_is_identity() {
        assert_eq!(apply_pixel(16, &[], 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
    }

    #[test]
    fn color_lookup_presets_grade_within_range() {
        // Every non-identity preset changes a mid-grey and stays in [0,1].
        for preset in 1..=8 {
            let (r, g, b) = apply_pixel(16, &[preset as f32], 0.4, 0.5, 0.6);
            for (name, v) in [("r", r), ("g", g), ("b", b)] {
                assert!(
                    (0.0..=1.0).contains(&v),
                    "preset {preset} {name} out of range: {v}"
                );
            }
            assert!(
                (r, g, b) != (0.4, 0.5, 0.6),
                "preset {preset} is not the identity"
            );
        }
    }

    /// A kind-16 layer whose params carry a loaded .cube/.3dl (#441): `[-1, N,
    /// domain, N³·3 triplets]`. A 2³ inverting cube must sample trilinearly.
    fn invert_lut3d(n: usize) -> Vec<f32> {
        let mut p = vec![-1.0, n as f32, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let nf = (n - 1) as f32;
                    p.extend([1.0 - r as f32 / nf, 1.0 - g as f32 / nf, 1.0 - b as f32 / nf]);
                }
            }
        }
        p
    }

    #[test]
    fn color_lookup_external_lut_samples_trilinearly() {
        let p = invert_lut3d(2);
        let (r, g, b) = apply_pixel(16, &p, 0.3, 0.5, 0.7);
        assert!((r - 0.7).abs() < 1e-5 && (g - 0.5).abs() < 1e-5 && (b - 0.3).abs() < 1e-5, "inverted: {r},{g},{b}");
        // A denser cube of the same transform agrees, and the corners are exact.
        let p3 = invert_lut3d(3);
        let (r3, g3, b3) = apply_pixel(16, &p3, 0.3, 0.5, 0.7);
        assert!((r3 - 0.7).abs() < 1e-5 && (g3 - 0.5).abs() < 1e-5 && (b3 - 0.3).abs() < 1e-5);
        assert_eq!(apply_pixel(16, &p, 1.0, 1.0, 1.0), (0.0, 0.0, 0.0));
        // DOMAIN_MIN/MAX rescale the input: a [0,2] domain reads 1.0 as the mid grid point.
        let mut wide = invert_lut3d(2);
        wide[5] = 2.0; wide[6] = 2.0; wide[7] = 2.0;
        let (wr, _, _) = apply_pixel(16, &wide, 1.0, 1.0, 1.0);
        assert!((wr - 0.5).abs() < 1e-5, "half-way through the domain: {wr}");
    }

    #[test]
    fn color_lookup_malformed_external_lut_is_identity() {
        let mut short = invert_lut3d(2);
        short.truncate(short.len() - 1); // truncated table
        assert_eq!(apply_pixel(16, &short, 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
        let huge = [-1.0, (super::MAX_LUT3D_SIZE + 1) as f32, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0];
        assert_eq!(apply_pixel(16, &huge, 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
        assert_eq!(apply_pixel(16, &[-1.0, 1.0], 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
    }

    #[test]
    fn selective_color_reds_black_slider_darkens() {
        // band 0 = Reds; push Black +100% (absolute) → a red pixel darkens.
        let mut p = vec![0.0f32; 37];
        p[0] = 0.0; // absolute
        p[1 + 0 * 4 + 3] = 1.0; // Reds → Black +1
        let (r, g, b) = apply_pixel(15, &p, 0.9, 0.1, 0.1);
        assert!(r < 0.9 && g <= 0.1 && b <= 0.1, "red darkened: {r},{g},{b}");
        // a blue pixel (not in the Reds band) is essentially untouched.
        let (br, bg, bb) = apply_pixel(15, &p, 0.1, 0.1, 0.9);
        assert!(
            (br - 0.1).abs() < 0.05 && (bb - 0.9).abs() < 0.05,
            "blue untouched: {br},{bg},{bb}"
        );
    }

    #[test]
    fn hue_sat_ranges_colorize_and_legacy_are_compatible() {
        let legacy = apply_pixel(2, &[45.0, 0.3, -0.2], 0.62, 0.34, 0.18);
        let mut wide = vec![0.0f32; crate::raster::adjust::HUE_SAT_PARAMS];
        wide[..3].copy_from_slice(&[45.0, 0.3, -0.2]);
        assert_eq!(legacy, apply_pixel(2, &wide, 0.62, 0.34, 0.18));

        wide.fill(0.0);
        wide[4] = 120.0; // Reds hue
        let dark_red = apply_pixel(2, &wide, 0.2, 0.0, 0.0);
        assert!(dark_red.0 < 1e-4 && (dark_red.1 - 0.2).abs() < 1e-4 && dark_red.2 < 1e-4);

        wide[0] = 120.0;
        wide[1] = 1.0;
        wide[3] = 1.0;
        let colorized = apply_pixel(2, &wide, 0.1, 0.2, 0.8);
        assert!(colorized.1 > colorized.0 && colorized.1 > colorized.2);
    }

    #[test]
    fn black_white_six_bands_tint_and_legacy_are_compatible() {
        let legacy = apply_pixel(6, &[0.3, 0.59, 0.11], 1.0, 0.0, 0.0);
        assert!((legacy.0 - 0.3).abs() < 1e-5 && legacy.0 == legacy.1 && legacy.1 == legacy.2);

        let mut wide = vec![0.0f32; crate::raster::adjust::BW_PARAMS];
        assert_eq!(apply_pixel(6, &wide, 0.5, 0.5, 0.5), (0.0, 0.0, 0.0));
        wide[0] = 1.0;
        wide[3..9].copy_from_slice(&[0.4, 0.6, 0.4, 0.6, 0.2, 0.8]);
        assert_eq!(apply_pixel(6, &wide, 1.0, 0.0, 0.0), (0.4, 0.4, 0.4));
        assert_eq!(apply_pixel(6, &wide, 0.5, 0.5, 0.5), (0.5, 0.5, 0.5));

        wide[9] = 1.0;
        wide[10] = 40.0;
        wide[11] = 0.4;
        let tinted = apply_pixel(6, &wide, 1.0, 0.0, 0.0);
        assert!(tinted.0 > tinted.2);
    }

    #[test]
    fn selective_color_short_params_is_identity() {
        assert_eq!(apply_pixel(15, &[0.0; 10], 0.3, 0.5, 0.7), (0.3, 0.5, 0.7));
    }

    #[test]
    fn scalar_adjustment_kinds_cover_dispatch_and_lut_guards() {
        let rgb = (0.24, 0.42, 0.73);
        let mut curve = vec![0.0f32; 256];
        for (i, v) in curve.iter_mut().enumerate() {
            *v = 1.0 - i as f32 / 255.0;
        }
        let mut gradient = vec![0.0f32; 256 * 3];
        for i in 0..256 {
            let t = i as f32 / 255.0;
            gradient[i * 3] = t;
            gradient[i * 3 + 1] = 1.0 - t;
            gradient[i * 3 + 2] = 0.5;
        }

        let cases: Vec<(u8, Vec<f32>)> = vec![
            (0, vec![0.1, 0.25]),
            (1, vec![0.05, 0.95, 1.2, 0.02, 0.98]),
            (2, vec![45.0, 0.2, -0.1]),
            (3, vec![0.3, 0.1]),
            (4, vec![]),
            (5, vec![]),
            (6, vec![0.2, 0.6, 0.2]),
            (7, vec![4.0]),
            (8, vec![0.5]),
            (9, vec![0.5, 0.05, 1.1]),
            (10, vec![0.2, -0.1, 0.05, -0.2, 0.1, 0.0, 0.1, 0.0, -0.1]),
            (11, vec![1.0, 0.8, 0.6, 0.4]),
            (12, curve),
            (13, gradient),
        ];

        for (kind, params) in cases {
            let (r, g, b) = apply_pixel(kind, &params, rgb.0, rgb.1, rgb.2);
            for channel in [r, g, b] {
                assert!(
                    channel.is_finite(),
                    "adjustment kind {kind} produced non-finite channel {channel}"
                );
            }
        }

        assert_eq!(apply_pixel(12, &[0.0; 32], rgb.0, rgb.1, rgb.2), rgb);
        assert_eq!(apply_pixel(13, &[0.0; 32], rgb.0, rgb.1, rgb.2), rgb);
        assert_eq!(apply_pixel(14, &[0.0; 8], rgb.0, rgb.1, rgb.2), rgb);
    }

    #[test]
    fn exposure_layer_matches_the_linear_space_destructive_op() {
        // (#107) The kind-9 layer mirrored the old gamma-space maths; both now
        // scale in linear space, so mid-grey at +1 EV lands on ~0.68.
        let (r, _, _) = apply_pixel(9, &[1.0, 0.0, 1.0], 0.5, 0.5, 0.5);
        assert!((r - 0.6825).abs() < 0.005, "expected ~0.68, got {r}");
        assert_eq!(
            r,
            crate::raster::adjust::exposure_channel(0.5, 2.0, 0.0, 1.0),
            "layer and destructive Exposure must agree"
        );
    }

    #[test]
    fn curve_and_gradient_map_layers_interpolate_their_luts() {
        // (#110 siblings) Rounding to the nearest LUT entry quantized the
        // composite to 256 levels: an identity curve was not the identity and
        // two nearby inputs collapsed onto the same gradient-map stop.
        let identity: Vec<f32> = (0..256).map(|i| i as f32 / 255.0).collect();
        let c = 0.5 + 0.5 / 255.0; // exactly between two LUT entries
        let (r, g, b) = apply_pixel(12, &identity, c, c, c);
        for out in [r, g, b] {
            assert!((out - c).abs() < 1e-6, "identity curve is exact: {out}");
        }

        let mut gradient = vec![0.0f32; 256 * 3];
        for i in 0..256 {
            let t = i as f32 / 255.0;
            gradient[i * 3] = t;
            gradient[i * 3 + 1] = 1.0 - t;
            gradient[i * 3 + 2] = 0.5;
        }
        let lo = apply_pixel(13, &gradient, 0.5, 0.5, 0.5);
        let hi = apply_pixel(13, &gradient, c, c, c);
        assert!(lo.0 < hi.0, "nearby greys must not collapse: {lo:?} {hi:?}");
        assert!(lo.1 > hi.1, "the inverted plane tracks the same position");
    }
}
