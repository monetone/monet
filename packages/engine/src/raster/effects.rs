// ─────────────────────────────────────────────────────────────
// Layer effects (Photoshop "Layer Style" / Blending Options).
//
// Each effect renders into its own canvas-sized straight-alpha RGBA
// buffer (`FxSlot`) plus the blend mode / opacity it should be
// composited with, and whether it sits BELOW the layer fill (drop
// shadow, outer glow) or ABOVE it (overlays, satin, inner glow,
// inner shadow, bevel, stroke). The compositor in lib.rs walks the
// slots around the fill so each effect blends with the document
// backdrop using its own mode — exactly like Photoshop.
//
// The renderers work entirely from the layer's *alpha shape* (its
// coverage in canvas space), so they apply to any layer kind that
// has a shape: raster, text, smart object; an adjustment layer's
// shape is its mask, and a group header's is its members' composited
// coverage (`Engine::group_coverage`), so one style wraps the whole
// assembly the way Photoshop's does.
// ─────────────────────────────────────────────────────────────

use crate::raster::blend::BlendMode;
use crate::raster::color;

// Effect ids — kept in lockstep with the TS `FX` table in state/effects.ts.
pub const FX_DROP_SHADOW: u8 = 0;
pub const FX_INNER_SHADOW: u8 = 1;
pub const FX_OUTER_GLOW: u8 = 2;
pub const FX_INNER_GLOW: u8 = 3;
pub const FX_BEVEL: u8 = 4;
pub const FX_SATIN: u8 = 5;
pub const FX_COLOR_OVERLAY: u8 = 6;
pub const FX_GRADIENT_OVERLAY: u8 = 7;
pub const FX_PATTERN_OVERLAY: u8 = 8;
pub const FX_STROKE: u8 = 9;

// Canonical bottom→top compositing order.
const ORDER: [u8; 10] = [
    FX_DROP_SHADOW,
    FX_OUTER_GLOW,
    FX_COLOR_OVERLAY,
    FX_GRADIENT_OVERLAY,
    FX_PATTERN_OVERLAY,
    FX_SATIN,
    FX_INNER_GLOW,
    FX_INNER_SHADOW,
    FX_BEVEL,
    FX_STROKE,
];

// Photoshop CC allows up to ten instances of each effect *type* on one layer —
// the basis of stacked strokes and layered shadows. The layer's effect list is
// therefore a multiset keyed by id, not a slot per id.
pub const FX_MAX_INSTANCES: usize = 10;

pub struct FxSlot {
    pub blend: BlendMode,
    pub opacity: f32,
    pub below: bool,
    pub buf: Vec<u16>, // canvas w*h*4, straight alpha
}

// Cached render for one layer: a content signature + the built slots.
pub struct FxRender {
    pub sig: u64,
    pub slots: Vec<FxSlot>,
}

#[inline]
fn g(p: &[f32], i: usize) -> f32 {
    p.get(i).copied().unwrap_or(0.0)
}

fn pack(rgb: [f32; 3], cov: &[f32], w: usize, h: usize) -> Vec<u16> {
    let mut buf = vec![0u16; w * h * 4];
    let (r, gg, b) = (
        color::to16(rgb[0]),
        color::to16(rgb[1]),
        color::to16(rgb[2]),
    );
    for i in 0..w * h {
        let a = cov[i].clamp(0.0, 1.0);
        if a <= 0.0 {
            continue;
        }
        buf[i * 4] = r;
        buf[i * 4 + 1] = gg;
        buf[i * 4 + 2] = b;
        buf[i * 4 + 3] = color::to16(a);
    }
    buf
}

// Per-pixel colored coverage (gradient / pattern overlays write their own rgb).
fn pack_rgb(rgb: &[f32], cov: &[f32], w: usize, h: usize) -> Vec<u16> {
    let mut buf = vec![0u16; w * h * 4];
    for i in 0..w * h {
        let a = cov[i].clamp(0.0, 1.0);
        if a <= 0.0 {
            continue;
        }
        buf[i * 4] = color::to16(rgb[i * 3]);
        buf[i * 4 + 1] = color::to16(rgb[i * 3 + 1]);
        buf[i * 4 + 2] = color::to16(rgb[i * 3 + 2]);
        buf[i * 4 + 3] = color::to16(a);
    }
    buf
}

fn gauss_kernel(radius: f32) -> (Vec<f32>, i32) {
    let r = radius.max(0.0).ceil() as i32;
    if r < 1 {
        return (vec![1.0], 0);
    }
    let sigma = (radius / 2.0).max(0.5);
    let mut k = Vec::with_capacity((2 * r + 1) as usize);
    let mut sum = 0.0;
    for i in -r..=r {
        let v = (-(i * i) as f32 / (2.0 * sigma * sigma)).exp();
        k.push(v);
        sum += v;
    }
    for v in k.iter_mut() {
        *v /= sum;
    }
    (k, r)
}

// Separable Gaussian blur of a single-channel coverage plane.
fn blur1(src: &[f32], w: usize, h: usize, radius: f32) -> Vec<f32> {
    if radius < 0.1 {
        return src.to_vec();
    }
    let (k, r) = gauss_kernel(radius);
    let (wi, hi) = (w as i32, h as i32);
    let mut tmp = vec![0f32; w * h];
    for y in 0..hi {
        for x in 0..wi {
            let mut acc = 0.0;
            for (ki, kv) in k.iter().enumerate() {
                let sx = (x + ki as i32 - r).clamp(0, wi - 1);
                acc += src[(y * wi + sx) as usize] * kv;
            }
            tmp[(y * wi + x) as usize] = acc;
        }
    }
    let mut out = vec![0f32; w * h];
    for y in 0..hi {
        for x in 0..wi {
            let mut acc = 0.0;
            for (ki, kv) in k.iter().enumerate() {
                let sy = (y + ki as i32 - r).clamp(0, hi - 1);
                acc += tmp[(sy * wi + x) as usize] * kv;
            }
            out[(y * wi + x) as usize] = acc;
        }
    }
    out
}

// Integer shift, zero-fill outside.
fn shift(a: &[f32], w: usize, h: usize, dx: i32, dy: i32) -> Vec<f32> {
    let (wi, hi) = (w as i32, h as i32);
    let mut o = vec![0f32; w * h];
    for y in 0..hi {
        for x in 0..wi {
            let sx = x - dx;
            let sy = y - dy;
            if sx >= 0 && sy >= 0 && sx < wi && sy < hi {
                o[(y * wi + x) as usize] = a[(sy * wi + sx) as usize];
            }
        }
    }
    o
}

// Approximate Euclidean distance (chamfer 3x3) from every pixel to the
// nearest `seed` pixel. Seed pixels get 0.
fn dist_to(seed: &[bool], w: usize, h: usize) -> Vec<f32> {
    let big = 1e9f32;
    let (wi, hi) = (w as i32, h as i32);
    let mut d = vec![big; w * h];
    for i in 0..w * h {
        if seed[i] {
            d[i] = 0.0;
        }
    }
    let idx = |x: i32, y: i32| (y * wi + x) as usize;
    const O: f32 = 1.0;
    const D: f32 = std::f32::consts::SQRT_2;
    for y in 0..hi {
        for x in 0..wi {
            let mut v = d[idx(x, y)];
            if x > 0 {
                v = v.min(d[idx(x - 1, y)] + O);
            }
            if y > 0 {
                v = v.min(d[idx(x, y - 1)] + O);
                if x > 0 {
                    v = v.min(d[idx(x - 1, y - 1)] + D);
                }
                if x < wi - 1 {
                    v = v.min(d[idx(x + 1, y - 1)] + D);
                }
            }
            d[idx(x, y)] = v;
        }
    }
    for y in (0..hi).rev() {
        for x in (0..wi).rev() {
            let mut v = d[idx(x, y)];
            if x < wi - 1 {
                v = v.min(d[idx(x + 1, y)] + O);
            }
            if y < hi - 1 {
                v = v.min(d[idx(x, y + 1)] + O);
                if x < wi - 1 {
                    v = v.min(d[idx(x + 1, y + 1)] + D);
                }
                if x > 0 {
                    v = v.min(d[idx(x - 1, y + 1)] + D);
                }
            }
            d[idx(x, y)] = v;
        }
    }
    d
}

// Grow/shrink a soft matte by remapping around the 0.5 threshold.
fn spread_matte(m: &mut [f32], spread: f32) {
    if spread <= 0.0 {
        return;
    }
    let gain = 1.0 / (1.0 - spread.min(0.95));
    for v in m.iter_mut() {
        *v = ((*v - 0.5) * gain + 0.5).clamp(0.0, 1.0);
    }
}

#[inline]
fn offset_px(angle_deg: f32, distance: f32) -> (i32, i32) {
    let a = angle_deg.to_radians();
    // Global-light convention: angle is the light direction; the cast
    // shadow falls away from it. Screen y grows downward.
    let dx = -(distance * a.cos());
    let dy = distance * a.sin();
    (dx.round() as i32, dy.round() as i32)
}

// Bounding box of the shape (alpha > ~0), for gradient normalisation.
fn alpha_bbox(a: &[f32], w: usize, h: usize) -> (i32, i32, i32, i32) {
    let (mut x0, mut y0, mut x1, mut y1) = (w as i32, h as i32, 0i32, 0i32);
    let mut any = false;
    for y in 0..h {
        for x in 0..w {
            if a[y * w + x] > 0.02 {
                any = true;
                x0 = x0.min(x as i32);
                y0 = y0.min(y as i32);
                x1 = x1.max(x as i32);
                y1 = y1.max(y as i32);
            }
        }
    }
    if !any {
        (0, 0, w as i32 - 1, h as i32 - 1)
    } else {
        (x0, y0, x1, y1)
    }
}

// ── individual effects ─────────────────────────────────────────

// A "contour" remaps an effect's coverage ramp, matching FX_DEFS' Contour select:
// 0 Linear, 1 Cone, 2 Cone-Inverted, 3 Ring, 4 Gaussian, 5 Half Round.
/// Photoshop's contour slots. 0-5 are the built-in shapes; 100+ selects the
/// custom curve at `contours[preset - 100]`, a 0..1 LUT authored in the Contour
/// Editor. An index with no curve behind it falls back to Linear rather than
/// rendering something arbitrary.
fn contour_map(contours: &[Vec<f32>], preset: f32, t: f32) -> f32 {
    let t = t.clamp(0.0, 1.0);
    if preset >= 100.0 {
        let Some(lut) = contours.get(preset as usize - 100) else {
            return t;
        };
        if lut.len() < 2 {
            return t;
        }
        // Linear interpolation between LUT samples, so a coarse curve still
        // renders smoothly.
        let x = t * (lut.len() - 1) as f32;
        let i = x.floor() as usize;
        let f = x - i as f32;
        let a = lut[i.min(lut.len() - 1)];
        let b = lut[(i + 1).min(lut.len() - 1)];
        return (a + (b - a) * f).clamp(0.0, 1.0);
    }
    match preset as u8 {
        1 => t * t,
        2 => 2.0 * t - t * t,
        3 => 0.5 * (1.0 - (t * std::f32::consts::TAU).cos()),
        4 => (-(((t - 0.5) * 3.0).powi(2))).exp(),
        5 => (1.0 - (1.0 - t).powi(2)).sqrt(),
        _ => t,
    }
}

fn apply_contour(contours: &[Vec<f32>], cov: &mut [f32], contour: f32) {
    if contour == 0.0 {
        return; // Linear: identity
    }
    for c in cov.iter_mut() {
        *c = contour_map(contours, contour, *c);
    }
}

// Deterministic per-pixel value in 0..1, stable across recomposites.
// ponytail: a local copy of filters.rs' private `hash2`/`dissolve_keep` mix —
// promote one of them to a shared util if a third module wants it.
#[inline]
pub(super) fn hash01(x: usize, y: usize, salt: u32) -> f32 {
    let mut v = (x as u32).wrapping_mul(0x9E37_79B1)
        ^ (y as u32).wrapping_mul(0x85EB_CA6B)
        ^ salt.wrapping_mul(0xC2B2_AE35);
    v ^= v >> 16;
    v = v.wrapping_mul(0x7FEB_352D);
    v ^= v >> 15;
    v = v.wrapping_mul(0x846C_A68B);
    v ^= v >> 16;
    (v & 0xFFFF) as f32 / 65536.0
}

// Photoshop's Noise slider dissolves an effect's coverage with a fixed dither,
// so a smooth falloff breaks into grain. 0 (what a pre-VIS-LS-13 vector reads
// through `g`) leaves the coverage untouched.
fn apply_noise(cov: &mut [f32], w: usize, noise: f32, salt: u32) {
    if noise <= 0.0 {
        return;
    }
    let n = noise.min(1.0);
    for (i, c) in cov.iter_mut().enumerate() {
        *c *= 1.0 - n * hash01(i % w, i / w, salt);
    }
}

// A hard-edged glow ramp: 1 up to `size * amount` from the edge, falling to 0
// at `size`. This is the Precise technique — unlike the Gaussian of Softer it
// follows the distance field, so corners keep their point.
fn precise_ramp(d: &[f32], size: f32, amount: f32) -> Vec<f32> {
    let solid = size * amount.clamp(0.0, 1.0);
    let feather = (size - solid).max(0.1);
    d.iter()
        .map(|&v| ((size - v) / feather).clamp(0.0, 1.0))
        .collect()
}

// Shared Outer/Inner Glow finish. `base` is the Technique slot, so from there
// the layout is: base Technique, +1 Noise, +2 Range, +3 Jitter, +4 Fill Type,
// +5..7 the gradient's end colour; the Contour sits at base-1. Every added slot
// is inert at 0, so vectors written before VIS-LS-13 render bit-identically.
fn finish_glow(contours: &[Vec<f32>], cov: &mut [f32], p: &[f32], base: usize, w: usize, h: usize) -> Vec<u16> {
    let r = g(p, base + 2);
    let range = if r <= 0.0 { 1.0 } else { r.clamp(0.05, 1.0) };
    let jitter = g(p, base + 3);
    let contour = g(p, base - 1);
    for (i, c) in cov.iter_mut().enumerate() {
        // Range narrows the band the contour spans; Jitter roughens the ramp.
        let mut t = (*c / range).clamp(0.0, 1.0);
        if jitter > 0.0 {
            t = (t + (hash01(i % w, i / w, 0x51ED) - 0.5) * jitter).clamp(0.0, 1.0);
        }
        *c = if contour as u8 == 0 {
            t
        } else {
            contour_map(contours, contour, t)
        };
    }
    apply_noise(cov, w, g(p, base + 1), 0x9E37);
    let c0 = [g(p, 3), g(p, 4), g(p, 5)];
    if g(p, base + 4) < 0.5 {
        return pack(c0, cov, w, h); // Fill Type: Color
    }
    // Gradient fill: the falloff itself is the ramp position, so the start
    // colour hugs the shape and the end colour takes over at the rim.
    let c1 = [g(p, base + 5), g(p, base + 6), g(p, base + 7)];
    let mut rgb = vec![0f32; w * h * 3];
    for i in 0..w * h {
        let t = 1.0 - cov[i].clamp(0.0, 1.0);
        for k in 0..3 {
            rgb[i * 3 + k] = color::lerp(c0[k], c1[k], t);
        }
    }
    pack_rgb(&rgb, cov, w, h)
}

fn drop_shadow(contours: &[Vec<f32>], p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let (dx, dy) = offset_px(g(p, 6), g(p, 7));
    let mut m = shift(a, w, h, dx, dy);
    spread_matte(&mut m, g(p, 8));
    let blurred = blur1(&m, w, h, g(p, 9));
    // "Layer Knocks Out Drop Shadow" (slot 11) is on in Photoshop and was the
    // only behaviour before it got a slot, so a missing slot must read as 1 —
    // hence the explicit `get` instead of `g`, which would default it to 0.
    let knockout = p.get(11).copied().unwrap_or(1.0) >= 0.5;
    let mut cov = vec![0f32; w * h];
    for i in 0..w * h {
        cov[i] = if knockout {
            blurred[i] * (1.0 - a[i])
        } else {
            blurred[i]
        };
    }
    apply_contour(contours, &mut cov, g(p, 10));
    apply_noise(&mut cov, w, g(p, 12), 0xD305);
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: true,
        buf: pack([g(p, 3), g(p, 4), g(p, 5)], &cov, w, h),
    }
}

fn outer_glow(contours: &[Vec<f32>], p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let spread = g(p, 6);
    let size = g(p, 7); // raw: blur1 treats < 0.1 as "no blur", so keep that
    let mut cov: Vec<f32> = if g(p, 9) as i32 == 1 {
        // Precise: distance out from the shape.
        let inside: Vec<bool> = a.iter().map(|&v| v >= 0.5).collect();
        let ramp = precise_ramp(&dist_to(&inside, w, h), size, spread);
        (0..w * h).map(|i| ramp[i] * (1.0 - a[i])).collect()
    } else {
        let mut m = a.to_vec();
        spread_matte(&mut m, spread);
        let blurred = blur1(&m, w, h, size);
        (0..w * h).map(|i| blurred[i] * (1.0 - a[i])).collect()
    };
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: true,
        buf: finish_glow(contours, &mut cov, p, 9, w, h),
    }
}

fn inner_glow(contours: &[Vec<f32>], p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let choke = g(p, 6);
    let size = g(p, 7).max(0.1);
    let from_center = g(p, 8) >= 0.5;
    let mut cov = vec![0f32; w * h];
    if from_center {
        let inside: Vec<bool> = a.iter().map(|&v| v >= 0.5).collect();
        let outside: Vec<bool> = inside.iter().map(|&v| !v).collect();
        let din = dist_to(&outside, w, h);
        for i in 0..w * h {
            let t = (din[i] / size).clamp(0.0, 1.0);
            cov[i] = t * a[i]; // brightest in the middle
        }
    } else if g(p, 10) as i32 == 1 {
        // Precise: distance in from the edge.
        let inside: Vec<bool> = a.iter().map(|&v| v >= 0.5).collect();
        let outside: Vec<bool> = inside.iter().map(|&v| !v).collect();
        let ramp = precise_ramp(&dist_to(&outside, w, h), size, choke);
        for i in 0..w * h {
            cov[i] = ramp[i] * a[i];
        }
    } else {
        let inv: Vec<f32> = a.iter().map(|&v| 1.0 - v).collect();
        let blurred = blur1(&inv, w, h, size);
        let gain = 1.0 + choke * 4.0;
        for i in 0..w * h {
            cov[i] = (blurred[i] * gain).clamp(0.0, 1.0) * a[i];
        }
    }
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: finish_glow(contours, &mut cov, p, 10, w, h),
    }
}

fn inner_shadow(contours: &[Vec<f32>], p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let (dx, dy) = offset_px(g(p, 6), g(p, 7));
    let choke = g(p, 8);
    let size = g(p, 9).max(0.1);
    let shifted = shift(a, w, h, dx, dy);
    let m: Vec<f32> = (0..w * h).map(|i| (1.0 - shifted[i]).max(0.0)).collect();
    let blurred = blur1(&m, w, h, size);
    let gain = 1.0 + choke * 4.0;
    let mut cov = vec![0f32; w * h];
    for i in 0..w * h {
        cov[i] = (blurred[i] * gain).clamp(0.0, 1.0) * a[i];
    }
    apply_contour(contours, &mut cov, g(p, 10));
    apply_noise(&mut cov, w, g(p, 11), 0x1357);
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: pack([g(p, 3), g(p, 4), g(p, 5)], &cov, w, h),
    }
}

fn satin(contours: &[Vec<f32>], p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let (dx, dy) = offset_px(g(p, 6), g(p, 7));
    let size = g(p, 8);
    let invert = g(p, 9) >= 0.5;
    let s1 = shift(a, w, h, dx, dy);
    let s2 = shift(a, w, h, -dx, -dy);
    let m: Vec<f32> = (0..w * h).map(|i| (s1[i] - s2[i]).abs()).collect();
    let b = blur1(&m, w, h, size);
    let mut cov = vec![0f32; w * h];
    for i in 0..w * h {
        let v = if invert { 1.0 - b[i] } else { b[i] };
        cov[i] = v.clamp(0.0, 1.0) * a[i];
    }
    apply_contour(contours, &mut cov, g(p, 10)); // Photoshop puts a contour on Satin too
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: pack([g(p, 3), g(p, 4), g(p, 5)], &cov, w, h),
    }
}

fn color_overlay(p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: pack([g(p, 3), g(p, 4), g(p, 5)], a, w, h),
    }
}

// A multi-stop gradient across `cov` — shared by Gradient Overlay and the
// Stroke effect's Gradient fill type. `stops` is [pos, r, g, b, a] per stop,
// ascending by pos: the same packing as `add_gradient_fill_layer` and the
// Gradient tool, so a ramp authored anywhere in the app renders identically.
struct Grad {
    angle: f32,
    scale: f32,
    kind: i32,       // 0 linear · 1 radial · 2 angle · 3 reflected · 4 diamond (Gradient-tool codes)
    reverse: bool,
    dither: bool,
    align: bool,     // "Align with Layer": fit the shape's bbox, else the canvas
    off: (f32, f32), // centre offset, as a fraction of the gradient's half-extent
    stops: Vec<[f32; 5]>,
}

// The plain two-colour ramp a param vector without a stop tail decodes to.
fn two_stops(c0: [f32; 3], c1: [f32; 3]) -> Vec<[f32; 5]> {
    vec![
        [0.0, c0[0], c0[1], c0[2], 1.0],
        [1.0, c1[0], c1[1], c1[2], 1.0],
    ]
}

// Colour + alpha at ramp position t — the mirror of `gradient_fill`'s sampler
// in mod.rs (classic straight-RGB blend).
// ponytail: no per-stop midpoints — the 5-float stop packing has no room for
// one and the Gradient tool ignores them too; widen the packing to 6 floats if
// the picker ever grows midpoint handles.
fn sample_stops(stops: &[[f32; 5]], t: f32) -> [f32; 4] {
    let t = t.clamp(0.0, 1.0);
    let mut i = 0;
    while i + 1 < stops.len() && stops[i + 1][0] < t {
        i += 1;
    }
    let j = (i + 1).min(stops.len() - 1);
    let (s0, s1) = (stops[i], stops[j]);
    let f = if (s1[0] - s0[0]).abs() < 1e-5 {
        0.0
    } else {
        ((t - s0[0]) / (s1[0] - s0[0])).clamp(0.0, 1.0)
    };
    let mut out = [0f32; 4];
    for (k, o) in out.iter_mut().enumerate() {
        *o = color::lerp(s0[k + 1], s1[k + 1], f);
    }
    out
}

// 4x4 ordered (Bayer) dither — deterministic, no crawl between recomposites.
// Twin of the table in `gradient_fill` (mod.rs).
const BAYER4: [u8; 16] = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

// Renders the ramp over `cov`. Returns straight RGB plus the coverage the caller
// should pack with — cov × the ramp's own alpha, i.e. Photoshop's opacity stops.
fn gradient_rgba(cov: &[f32], w: usize, h: usize, gr: &Grad) -> (Vec<f32>, Vec<f32>) {
    let (cx, cy, extent) = if gr.align {
        let (x0, y0, x1, y1) = alpha_bbox(cov, w, h);
        (
            (x0 + x1) as f32 * 0.5,
            (y0 + y1) as f32 * 0.5,
            ((x1 - x0).max(y1 - y0)) as f32 * 0.5,
        )
    } else {
        // Align off: the gradient spans the canvas instead of the shape.
        (
            w as f32 * 0.5,
            h as f32 * 0.5,
            w.max(h) as f32 * 0.5,
        )
    };
    let half = (extent * gr.scale.max(0.01)).max(1.0);
    // Drag-to-offset: Photoshop moves the ramp's centre, in gradient-extent units.
    let (cx, cy) = (cx + gr.off.0 * half, cy + gr.off.1 * half);
    let ar = gr.angle.to_radians();
    let (ca, sa) = (ar.cos(), ar.sin());
    let mut rgb = vec![0f32; w * h * 3];
    let mut alpha = vec![0f32; w * h];
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if cov[i] <= 0.0 {
                continue;
            }
            let px = x as f32 - cx;
            let py = y as f32 - cy;
            let proj = px * ca - py * sa; // signed distance along the gradient
            let mut t = match gr.kind {
                1 => ((px * px + py * py).sqrt() / half).clamp(0.0, 1.0), // radial
                2 => {
                    // angle: a 360° sweep, 0 at the gradient direction
                    let mut a = (py.atan2(px) - ar) / std::f32::consts::TAU;
                    a -= a.floor();
                    a
                }
                3 => (proj.abs() / half).clamp(0.0, 1.0), // reflected (mirrored at the centre)
                4 => {
                    let perp = px * sa + py * ca;
                    ((proj.abs() + perp.abs()) / half).clamp(0.0, 1.0) // diamond (L1)
                }
                _ => (proj / (2.0 * half) + 0.5).clamp(0.0, 1.0), // linear
            };
            if gr.reverse {
                t = 1.0 - t;
            }
            let c = sample_stops(&gr.stops, t);
            // Ordered offset of ~±half an 8-bit step to break banding.
            let d = if gr.dither {
                (BAYER4[(y & 3) * 4 + (x & 3)] as f32 / 16.0 - 0.5) / 255.0
            } else {
                0.0
            };
            for k in 0..3 {
                rgb[i * 3 + k] = (c[k] + d).clamp(0.0, 1.0);
            }
            alpha[i] = cov[i] * c[3].clamp(0.0, 1.0);
        }
    }
    (rgb, alpha)
}

// First slot of Gradient Overlay's optional multi-stop tail.
const GRAD_STOP_BASE: usize = 18;

// The overlay's ramp: the multi-stop tail (slot 17 = stop count, then that many
// [pos,r,g,b,a] runs from slot 18) when one has been authored, else the two
// legacy colours at 7..12. The Layer Style dialog has no interior-stop control,
// so slots 7..12 keep driving the ramp's *ends* even on a multi-stop gradient —
// the "Start"/"End" colour rows stay live instead of going quietly dead.
fn overlay_stops(p: &[f32]) -> Vec<[f32; 5]> {
    let c0 = [g(p, 7), g(p, 8), g(p, 9)];
    let c1 = [g(p, 10), g(p, 11), g(p, 12)];
    let n = g(p, 17).max(0.0) as usize;
    if n < 2 || p.len() < GRAD_STOP_BASE + n * 5 {
        return two_stops(c0, c1);
    }
    let mut stops: Vec<[f32; 5]> = (0..n)
        .map(|k| {
            let b = GRAD_STOP_BASE + k * 5;
            [p[b], p[b + 1], p[b + 2], p[b + 3], p[b + 4]]
        })
        .collect();
    stops[0][1..4].copy_from_slice(&c0);
    let last = stops.len() - 1;
    stops[last][1..4].copy_from_slice(&c1);
    stops
}

// Gradient Overlay. Slots 0..12 are the original vector (two colours, Linear or
// Radial); 13.. were appended: dither, align-with-layer, offset x/y and the
// optional multi-stop tail. A pre-VIS-LS-09 vector still renders identically.
fn gradient_overlay(p: &[f32], a: &[f32], w: usize, h: usize) -> FxSlot {
    let gr = Grad {
        angle: g(p, 3),
        scale: g(p, 4),
        kind: g(p, 5) as i32,
        reverse: g(p, 6) >= 0.5,
        dither: g(p, 13) >= 0.5,
        // A missing slot must read as ON — fitting the layer's bbox was the only
        // behaviour before the toggle existed (same trick as the shadow knockout).
        align: p.get(14).copied().unwrap_or(1.0) >= 0.5,
        off: (g(p, 15), g(p, 16)),
        stops: overlay_stops(p),
    };
    let (rgb, alpha) = gradient_rgba(a, w, h, &gr);
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: pack_rgb(&rgb, &alpha, w, h),
    }
}

// Palette for the procedural patterns: [dark, grid light, dot light,
// checker light, checker dark]. Pattern Overlay lets its vector override every
// entry (slots 5..19); the Stroke effect's Pattern fill takes them as-is.
const PATTERN_PALETTE: [[f32; 3]; 5] = [[0.15; 3], [0.85; 3], [0.9; 3], [0.8; 3], [0.25; 3]];

// The Edit ▸ Define Pattern tile (RGBA u16 rows), borrowed for one render pass.
// Pattern kind 3 ("Defined") samples it instead of a procedural formula, so the
// Pattern Overlay / Stroke Pattern fill / Bevel Texture picks all resolve to the
// same tile the Pattern Stamp and pattern fill layers already use.
#[derive(Clone, Copy)]
pub struct Tile<'a> {
    pub px: &'a [u16],
    pub w: usize,
    pub h: usize,
}

// Pattern kind for "the defined tile" — index 3 of FX_DEFS' PATTERNS select.
const PAT_DEFINED: i32 = 3;

/// Every tile a style may name: the single Edit ▸ Define Pattern slot (kind 3)
/// and the pattern library a picker chooses from, so two effects — in one
/// style, or on two layers — can use different tiles.
///
/// A library tile is named by ID, not by position: the host's library is
/// reorderable and deletable, and a style that stored a position would start
/// rendering its neighbour's tile the moment a row moved. An id with no tile
/// (deleted, or one the host declined to push) falls back to the procedural
/// checker, exactly like kind 3 with nothing defined.
#[derive(Clone, Copy, Default)]
pub struct Tiles<'a> {
    pub defined: Option<Tile<'a>>,
    pub library: &'a [(i32, Option<Tile<'a>>)],
}

impl<'a> Tiles<'a> {
    /// Pattern kinds at or above this name a library tile by id; below it they
    /// are the procedural kinds. Mirrors state/effects.ts PATTERN_LIBRARY_BASE.
    pub const LIBRARY_BASE: i32 = 100;

    /// Just the defined slot — the shape every caller had before the library.
    pub fn one(defined: Option<Tile<'a>>) -> Self {
        Tiles { defined, library: &[] }
    }

    fn get(&self, kind: i32) -> Option<Tile<'a>> {
        if kind >= Self::LIBRARY_BASE {
            // Linear: a pattern library is a handful of entries, and this runs
            // once per effect render, not per pixel.
            return self
                .library
                .iter()
                .find(|(id, _)| *id == kind)
                .and_then(|(_, tile)| *tile);
        }
        (kind == PAT_DEFINED).then_some(self.defined).flatten()
    }
}

impl Tile<'_> {
    // Nearest-neighbour sample, tiled from the canvas origin (Photoshop's Snap
    // to Origin). `zoom` 1.0 is 1:1.
    // ponytail: nearest, and origin-anchored — no Link with Layer and no
    // drag-to-offset; both want two more param slots and a picker UI first.
    fn rgba(&self, x: usize, y: usize, zoom: f32) -> [f32; 4] {
        let sx = (x as f32 / zoom) as usize % self.w;
        let sy = (y as f32 / zoom) as usize % self.h;
        let i = (sy * self.w + sx) * 4;
        let mut out = [0f32; 4];
        for (k, o) in out.iter_mut().enumerate() {
            *o = self.px[i + k] as f32 / 65535.0;
        }
        out
    }
}

// Zoom for a defined tile from the effect's Scale slot, whose default is 16 —
// so the stock value is 1:1 and the 2..128 control spans 12%..800% (Photoshop's
// Pattern Overlay scale is likewise a percentage, 1..1000%).
fn tile_zoom(scale: f32) -> f32 {
    (scale / 16.0).max(0.05)
}

// Colour of one pattern pixel. Kinds match the pattern select in FX_DEFS:
// 0 checker, 1 grid, 2 dots, 3 the defined tile, 100+n a library tile — the
// same geometry as `pattern_height`. A kind whose tile is missing falls back
// to the checker.
fn pattern_color(
    kind: i32,
    x: usize,
    y: usize,
    scale: f32,
    pal: &[[f32; 3]; 5],
    tiles: &Tiles,
) -> [f32; 4] {
    if let Some(t) = tiles.get(kind) {
        return t.rgba(x, y, tile_zoom(scale));
    }
    let rgb = procedural_color(kind, x, y, scale, pal);
    [rgb[0], rgb[1], rgb[2], 1.0]
}

fn procedural_color(kind: i32, x: usize, y: usize, scale: f32, pal: &[[f32; 3]; 5]) -> [f32; 3] {
    match kind {
        1 => {
            // grid lines
            if (x as f32 % scale) < 1.5 || (y as f32 % scale) < 1.5 {
                pal[0]
            } else {
                pal[1]
            }
        }
        2 => {
            // dots
            let dx = x as f32 % scale - scale * 0.5;
            let dy = y as f32 % scale - scale * 0.5;
            if dx * dx + dy * dy < (scale * 0.3) * (scale * 0.3) {
                pal[0]
            } else {
                pal[2]
            }
        }
        _ => {
            // checker
            let u = (x as f32 / scale).floor() as i32;
            let v = (y as f32 / scale).floor() as i32;
            if (u + v) & 1 == 0 {
                pal[3]
            } else {
                pal[4]
            }
        }
    }
}

// Fill `cov`'s pixels with a pattern. Returns rgb + the coverage the pattern
// leaves behind — a defined tile carries its own alpha, so transparent texels
// punch through (the procedural kinds are opaque and pass `cov` straight out).
fn pattern_rgb(
    cov: &[f32],
    w: usize,
    h: usize,
    kind: i32,
    scale: f32,
    pal: &[[f32; 3]; 5],
    tiles: &Tiles,
) -> (Vec<f32>, Vec<f32>) {
    let mut rgb = vec![0f32; w * h * 3];
    let mut alpha = cov.to_vec();
    for y in 0..h {
        for x in 0..w {
            let i = y * w + x;
            if cov[i] <= 0.0 {
                continue;
            }
            let c = pattern_color(kind, x, y, scale, pal, tiles);
            rgb[i * 3..i * 3 + 3].copy_from_slice(&c[..3]);
            alpha[i] = cov[i] * c[3];
        }
    }
    (rgb, alpha)
}

fn pattern_overlay(p: &[f32], a: &[f32], w: usize, h: usize, tiles: &Tiles) -> FxSlot {
    let mut pal = PATTERN_PALETTE;
    if p.len() >= 20 {
        for (k, &slot) in [5usize, 8, 11, 14, 17].iter().enumerate() {
            pal[k] = [g(p, slot), g(p, slot + 1), g(p, slot + 2)];
        }
    }
    let (rgb, alpha) = pattern_rgb(a, w, h, g(p, 4) as i32, g(p, 3).max(1.0), &pal, tiles);
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf: pack_rgb(&rgb, &alpha, w, h),
    }
}

// Coverage of the Stroke effect's band — shared with Bevel's Stroke Emboss
// style, which rides this same band instead of the layer's own shape.
fn stroke_cov(p: &[f32], a: &[f32], w: usize, h: usize) -> Vec<f32> {
    let size = g(p, 6).max(0.1);
    let position = g(p, 7) as i32; // 0 outside, 1 inside, 2 center
    let inside: Vec<bool> = a.iter().map(|&v| v >= 0.5).collect();
    let outside: Vec<bool> = inside.iter().map(|&v| !v).collect();
    let d_out = dist_to(&inside, w, h); // 0 inside, grows outward
    let d_in = dist_to(&outside, w, h); // 0 outside, grows inward
    let mut cov = vec![0f32; w * h];
    for i in 0..w * h {
        cov[i] = match position {
            1 => {
                // inside
                if inside[i] {
                    (size + 0.5 - d_in[i]).clamp(0.0, 1.0)
                } else {
                    0.0
                }
            }
            2 => {
                // center
                let half = size * 0.5;
                if inside[i] {
                    (half + 0.5 - d_in[i]).clamp(0.0, 1.0)
                } else {
                    (half + 0.5 - d_out[i]).clamp(0.0, 1.0)
                }
            }
            _ => {
                // outside
                if !inside[i] {
                    (size + 0.5 - d_out[i]).clamp(0.0, 1.0)
                } else {
                    0.0
                }
            }
        };
    }
    cov
}

fn stroke(p: &[f32], a: &[f32], w: usize, h: usize, tiles: &Tiles) -> FxSlot {
    let cov = stroke_cov(p, a, w, h);
    let c0 = [g(p, 3), g(p, 4), g(p, 5)];
    // Fill Type (slot 8): 0 Color — the only thing a pre-VIS-LS-13 vector can
    // decode to — 1 Gradient (colour → slot 10..12), 2 Pattern.
    let buf = match g(p, 8) as i32 {
        1 => {
            let gr = Grad {
                angle: g(p, 9),
                scale: 1.0,
                kind: 0,
                reverse: false,
                dither: false,
                align: true,
                off: (0.0, 0.0),
                stops: two_stops(c0, [g(p, 10), g(p, 11), g(p, 12)]),
            };
            let (rgb, alpha) = gradient_rgba(&cov, w, h, &gr);
            pack_rgb(&rgb, &alpha, w, h)
        }
        2 => {
            let (rgb, alpha) = pattern_rgb(
                &cov,
                w,
                h,
                g(p, 13) as i32,
                g(p, 14).max(1.0),
                &PATTERN_PALETTE,
                tiles,
            );
            pack_rgb(&rgb, &alpha, w, h)
        }
        _ => pack(c0, &cov, w, h),
    };
    FxSlot {
        blend: BlendMode::from_u8(g(p, 1) as u8),
        opacity: g(p, 2),
        below: false,
        buf,
    }
}

// Pattern height (0..1) for Bevel's Texture sub-effect. Kinds match the pattern
// select in FX_DEFS: 0 checker, 1 grid, 2 dots, 3 the defined tile — whose
// luminance (faded by its alpha toward flat) is the relief, as in Photoshop.
// ponytail: three procedural patterns plus the one defined tile; a preset
// library would land as more kinds (or a tile id) in this same slot.
fn pattern_height(kind: i32, x: usize, y: usize, scale: f32, tiles: &Tiles) -> f32 {
    {
        if let Some(t) = tiles.get(kind) {
            let c = t.rgba(x, y, tile_zoom(scale));
            let lum = 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2]; // Rec.601
            return color::lerp(0.5, lum, c[3]);
        }
    }
    match kind {
        1 => {
            let on = (x as f32 % scale) < 1.5 || (y as f32 % scale) < 1.5;
            if on {
                0.0
            } else {
                1.0
            }
        }
        2 => {
            let dx = x as f32 % scale - scale * 0.5;
            let dy = y as f32 % scale - scale * 0.5;
            if dx * dx + dy * dy < (scale * 0.3) * (scale * 0.3) {
                0.0
            } else {
                1.0
            }
        }
        _ => {
            let u = (x as f32 / scale).floor() as i32;
            let v = (y as f32 / scale).floor() as i32;
            if (u + v) & 1 == 0 {
                1.0
            } else {
                0.0
            }
        }
    }
}

fn bevel(
    contours: &[Vec<f32>],
    p: &[f32],
    a: &[f32],
    w: usize,
    h: usize,
    stroke_band: Option<&[f32]>,
    tiles: &Tiles,
) -> Vec<FxSlot> {
    let angle = g(p, 11);
    let altitude = g(p, 12);
    let depth = g(p, 13).max(0.1);
    let size = g(p, 14).max(1.0);
    let soften = g(p, 15);
    let style = g(p, 16) as i32; // 0 inner, 1 outer, 2 emboss, 3 pillow, 4 stroke emboss
    let technique = g(p, 17) as i32; // 0 smooth, 1 chisel hard, 2 chisel soft
    let down = g(p, 18) >= 0.5; // Direction: Up (default) / Down
    let gloss = g(p, 19);
    // Stroke Emboss rides the Stroke effect's band; with no stroke enabled
    // there is nothing to emboss, so the shape is empty and both slots go blank.
    let blank;
    let shape: &[f32] = if style == 4 {
        match stroke_band {
            Some(b) => b,
            None => {
                blank = vec![0f32; w * h];
                &blank
            }
        }
    } else {
        a
    };
    let mut height = if technique == 0 {
        blur1(shape, w, h, size) // Smooth: a Gaussian dome over the edge
    } else {
        // Chisel: a linear ramp of width `size` straddling the edge, so the
        // chamfer is a flat facet meeting the surface at a hard crease.
        let inside: Vec<bool> = shape.iter().map(|&v| v >= 0.5).collect();
        let outside: Vec<bool> = inside.iter().map(|&v| !v).collect();
        let d_in = dist_to(&outside, w, h); // 0 at the edge, grows inward
        let d_out = dist_to(&inside, w, h); // 0 at the edge, grows outward
        let mut hgt: Vec<f32> = (0..w * h)
            .map(|i| ((d_in[i] - d_out[i]) / size * 0.5 + 0.5).clamp(0.0, 1.0))
            .collect();
        if technique == 2 {
            hgt = blur1(&hgt, w, h, size * 0.25); // Chisel Soft: creases knocked off
        }
        hgt
    };
    // Contour sub-effect: reshapes the chamfer profile itself. Range scales how
    // much of the ramp the curve spans (narrow range = abrupt shoulders).
    if g(p, 20) >= 0.5 {
        let curve = g(p, 21);
        let range = g(p, 22).clamp(0.05, 1.0);
        for v in height.iter_mut() {
            *v = contour_map(contours, curve, ((*v - 0.5) / range + 0.5).clamp(0.0, 1.0));
        }
    }
    // Texture sub-effect: a pattern displaces the height field before shading,
    // so the relief carries the pattern's bumps. Depth may be negative (carved).
    if g(p, 23) >= 0.5 {
        let kind = g(p, 24) as i32;
        let tscale = g(p, 25).max(1.0);
        let tdepth = g(p, 26);
        let invert = g(p, 27) >= 0.5;
        for y in 0..h {
            for x in 0..w {
                let mut t = pattern_height(kind, x, y, tscale, tiles);
                if invert {
                    t = 1.0 - t;
                }
                height[y * w + x] += tdepth * (t - 0.5);
            }
        }
    }
    let la = angle.to_radians();
    let alt = altitude.to_radians();
    let lx = alt.cos() * la.cos();
    let ly = -alt.cos() * la.sin();
    let lz = alt.sin();
    let (wi, hi) = (w as i32, h as i32);
    let mut hi_cov = vec![0f32; w * h];
    let mut lo_cov = vec![0f32; w * h];
    let at = |x: i32, y: i32| {
        let xx = x.clamp(0, wi - 1);
        let yy = y.clamp(0, hi - 1);
        height[(yy * wi + xx) as usize]
    };
    for y in 0..hi {
        for x in 0..wi {
            let i = (y * wi + x) as usize;
            let gx = (at(x + 1, y) - at(x - 1, y)) * 0.5 * depth * 6.0;
            let gy = (at(x, y + 1) - at(x, y - 1)) * 0.5 * depth * 6.0;
            let inv = 1.0 / (gx * gx + gy * gy + 1.0).sqrt();
            let (nx, ny, nz) = (-gx * inv, -gy * inv, inv);
            let ndl = nx * lx + ny * ly + nz * lz;
            // Shade relative to the FLAT response (a level surface gives
            // ndl == lz): Photoshop's bevel only lights/shades the chamfer
            // band near the edge — the flat interior must stay untouched.
            let delta = ndl - lz;
            let mut hi_amt = (delta / (1.0 - lz).max(1e-3)).clamp(0.0, 1.0);
            let mut lo_amt = (-delta / lz.max(1e-3)).clamp(0.0, 1.0);
            // Gloss Contour remaps the lighting ramp (the metallic ringing).
            // Gated by the raw relief so a curve that is non-zero at t=0 can't
            // wash the flat interior; Linear (0) stays a bit-exact identity.
            if gloss as u8 != 0 {
                let gate = (hi_amt + lo_amt).clamp(0.0, 1.0);
                hi_amt = contour_map(contours, gloss, hi_amt) * gate;
                lo_amt = contour_map(contours, gloss, lo_amt) * gate;
            }
            let inside = shape[i];
            let outside = 1.0 - shape[i];
            // Style places the relief: inside the shape, outside it, or both
            // (Emboss); Pillow inverts the inner relief against the outer;
            // Stroke Emboss keeps it entirely within the stroke band.
            let (cov_in, cov_out, flip_in) = match style {
                1 => (0.0, outside, false),    // Outer Bevel
                2 => (inside, outside, false), // Emboss
                3 => (inside, outside, true),  // Pillow Emboss
                4 => (inside, 0.0, false),     // Stroke Emboss (shape == band)
                _ => (inside, 0.0, false),     // Inner Bevel
            };
            let (h_in, l_in) = if flip_in {
                (lo_amt, hi_amt)
            } else {
                (hi_amt, lo_amt)
            };
            hi_cov[i] = h_in * cov_in + hi_amt * cov_out;
            lo_cov[i] = l_in * cov_in + lo_amt * cov_out;
        }
    }
    // Direction Down flips the relief: what was lit is now shaded (pressed in).
    if down {
        std::mem::swap(&mut hi_cov, &mut lo_cov);
    }
    if soften > 0.1 {
        hi_cov = blur1(&hi_cov, w, h, soften);
        lo_cov = blur1(&lo_cov, w, h, soften);
    }
    vec![
        FxSlot {
            blend: BlendMode::from_u8(g(p, 1) as u8),
            opacity: g(p, 2),
            below: false,
            buf: pack([g(p, 3), g(p, 4), g(p, 5)], &hi_cov, w, h),
        },
        FxSlot {
            blend: BlendMode::from_u8(g(p, 6) as u8),
            opacity: g(p, 7),
            below: false,
            buf: pack([g(p, 8), g(p, 9), g(p, 10)], &lo_cov, w, h),
        },
    ]
}

// Build every enabled effect's slot(s), in bottom→top order. A type may appear
// more than once (Photoshop's multi-instance effects); its instances render in
// stored order within that type's place in ORDER, so instance 2 sits over 1.
/// Render a layer's effects with no custom contour library — the built-in
/// shapes only. Kept as the plain entry point so every caller that has no
/// document (tests, and anything rendering effects in isolation) is unaffected.
pub fn render(
    effects: &[(u8, Vec<f32>)],
    a: &[f32],
    w: usize,
    h: usize,
    tile: Option<Tile>,
) -> Vec<FxSlot> {
    render_with_contours(effects, a, w, h, Tiles::one(tile), &[])
}

/// The same, with the document's custom contour curves available to any slot
/// that selects one (index 100 + position).
pub fn render_with_contours(
    effects: &[(u8, Vec<f32>)],
    a: &[f32],
    w: usize,
    h: usize,
    tiles: Tiles,
    contours: &[Vec<f32>],
) -> Vec<FxSlot> {
    let mut slots = Vec::new();
    for &eid in ORDER.iter() {
        for (_, p) in effects.iter().filter(|(id, _)| *id == eid) {
            if g(p, 0) < 0.5 {
                continue; // disabled
            }
            match eid {
                x if x == FX_DROP_SHADOW => slots.push(drop_shadow(contours, p, a, w, h)),
                x if x == FX_OUTER_GLOW => slots.push(outer_glow(contours, p, a, w, h)),
                x if x == FX_COLOR_OVERLAY => slots.push(color_overlay(p, a, w, h)),
                x if x == FX_GRADIENT_OVERLAY => slots.push(gradient_overlay(p, a, w, h)),
                x if x == FX_PATTERN_OVERLAY => slots.push(pattern_overlay(p, a, w, h, &tiles)),
                x if x == FX_SATIN => slots.push(satin(contours, p, a, w, h)),
                x if x == FX_INNER_GLOW => slots.push(inner_glow(contours, p, a, w, h)),
                x if x == FX_INNER_SHADOW => slots.push(inner_shadow(contours, p, a, w, h)),
                x if x == FX_BEVEL => {
                    // Stroke Emboss (style 4) rides on the first enabled Stroke —
                    // Photoshop embosses the stroke band, and with a stack that is
                    // the outermost one.
                    let band = (g(p, 16) as i32 == 4)
                        .then(|| {
                            effects
                                .iter()
                                .find(|(id, sp)| *id == FX_STROKE && g(sp, 0) >= 0.5)
                        })
                        .flatten()
                        .map(|(_, sp)| stroke_cov(sp, a, w, h));
                    slots.extend(bevel(contours, p, a, w, h, band.as_deref(), &tiles));
                }
                x if x == FX_STROKE => slots.push(stroke(p, a, w, h, &tiles)),
                _ => {}
            }
        }
    }
    slots
}

// Cheap content signature: effect params + a hash of the alpha plane.
pub fn signature(effects: &[(u8, Vec<f32>)], a: &[f32]) -> u64 {
    let mut hsh: u64 = 0xcbf29ce484222325;
    let mut mix = |x: u64| {
        hsh ^= x;
        hsh = hsh.wrapping_mul(0x100000001b3);
    };
    for (id, p) in effects {
        mix(*id as u64);
        for &v in p {
            mix(v.to_bits() as u64);
        }
        mix(0xffff);
    }
    // sample alpha (every pixel; fast FNV over quantised bytes)
    for &v in a {
        mix((v * 255.0) as u64);
    }
    hsh
}

#[cfg(test)]
mod tests {
    use super::*;

    fn alpha_shape(w: usize, h: usize) -> Vec<f32> {
        let mut a = vec![0.0; w * h];
        for y in 2..h - 2 {
            for x in 2..w - 2 {
                a[y * w + x] = if x == 3 && y == 3 { 0.65 } else { 1.0 };
            }
        }
        a
    }

    fn has_alpha(buf: &[u16]) -> bool {
        buf.chunks_exact(4).any(|px| px[3] > 0)
    }

    #[test]
    fn drop_shadow_contour_remaps_the_falloff() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let shadow = |contour: Option<f32>| -> Vec<u16> {
            let mut p = vec![1.0, 3.0, 1.0, 0.0, 0.0, 0.0, 135.0, 3.0, 0.0, 5.0];
            if let Some(c) = contour {
                p.push(c);
            }
            render(&[(FX_DROP_SHADOW, p)], &a, w, h, None).remove(0).buf
        };
        let default = shadow(None);
        let linear = shadow(Some(0.0));
        let ring = shadow(Some(3.0)); // non-monotonic
        assert_eq!(
            linear, default,
            "Linear contour equals the default (back-compatible)"
        );
        assert_ne!(
            ring, linear,
            "a non-linear contour remaps the shadow falloff"
        );
    }

    #[test]
    fn render_builds_enabled_effects_in_photoshop_order() {
        let w = 8;
        let h = 8;
        let a = alpha_shape(w, h);
        let effects = vec![
            (FX_STROKE, vec![1.0, 0.0, 0.9, 0.0, 0.0, 0.0, 2.0, 2.0]),
            (
                FX_DROP_SHADOW,
                vec![1.0, 3.0, 0.75, 0.0, 0.0, 0.0, 135.0, 2.0, 0.3, 1.5],
            ),
            (FX_PATTERN_OVERLAY, vec![1.0, 10.0, 0.6, 3.0, 0.0]),
            (FX_OUTER_GLOW, vec![1.0, 7.0, 0.5, 1.0, 0.8, 0.0, 0.4, 2.0]),
            (FX_COLOR_OVERLAY, vec![1.0, 0.0, 0.4, 0.2, 0.3, 0.4]),
            (
                FX_GRADIENT_OVERLAY,
                vec![
                    1.0, 0.0, 0.7, 45.0, 1.1, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0,
                ],
            ),
            (
                FX_SATIN,
                vec![1.0, 3.0, 0.6, 0.1, 0.2, 0.8, 45.0, 2.0, 1.5, 0.0],
            ),
            (
                FX_INNER_GLOW,
                vec![1.0, 7.0, 0.8, 0.0, 1.0, 1.0, 0.2, 2.0, 0.0],
            ),
            (
                FX_INNER_SHADOW,
                vec![1.0, 3.0, 0.55, 0.0, 0.0, 0.0, 225.0, 2.0, 0.2, 1.5],
            ),
            (
                FX_BEVEL,
                vec![
                    1.0, 7.0, 0.9, 1.0, 1.0, 1.0, 3.0, 0.7, 0.0, 0.0, 0.0, 135.0, 45.0, 1.5, 2.0,
                    1.0, 0.0,
                ],
            ),
        ];

        let slots = render(&effects, &a, w, h, None);
        assert_eq!(slots.len(), 11);
        assert!(slots[0].below);
        assert!(slots[1].below);
        assert!(slots
            .iter()
            .all(|slot| slot.buf.len() == w * h * 4 && has_alpha(&slot.buf)));
        assert_eq!(slots[0].blend, BlendMode::Multiply);
        assert_eq!(slots.last().unwrap().blend, BlendMode::Normal);
    }

    #[test]
    fn render_variants_cover_disabled_radial_patterns_strokes_and_bevel_styles() {
        let w = 7;
        let h = 7;
        let a = alpha_shape(w, h);
        assert!(render(&[(FX_DROP_SHADOW, vec![0.0])], &a, w, h, None).is_empty());
        assert!(render(&[], &a, w, h, None).is_empty());

        let radial = render(
            &[(
                FX_GRADIENT_OVERLAY,
                vec![
                    1.0, 0.0, 1.0, 0.0, 0.6, 1.0, 1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0,
                ],
            )],
            &a,
            w,
            h,
            None,
        );
        assert_eq!(radial.len(), 1);
        assert!(has_alpha(&radial[0].buf));

        for kind in [1.0, 2.0] {
            let slots = render(
                &[(FX_PATTERN_OVERLAY, vec![1.0, 0.0, 1.0, 2.5, kind])],
                &a,
                w,
                h,
                None,
            );
            assert_eq!(slots.len(), 1);
            assert!(has_alpha(&slots[0].buf));
        }

        for position in [0.0, 1.0, 2.0] {
            let slots = render(
                &[(FX_STROKE, vec![1.0, 0.0, 1.0, 0.9, 0.1, 0.2, 2.0, position])],
                &a,
                w,
                h,
                None,
            );
            assert_eq!(slots.len(), 1);
            assert!(has_alpha(&slots[0].buf));
        }

        for center in [0.0, 1.0] {
            let slots = render(
                &[(
                    FX_INNER_GLOW,
                    vec![1.0, 0.0, 1.0, 0.4, 0.6, 1.0, 0.4, 2.0, center],
                )],
                &a,
                w,
                h,
                None,
            );
            assert_eq!(slots.len(), 1);
            assert!(has_alpha(&slots[0].buf));
        }

        for invert in [0.0, 1.0] {
            let slots = render(
                &[(
                    FX_SATIN,
                    vec![1.0, 0.0, 1.0, 0.4, 0.2, 0.7, 135.0, 2.0, 1.0, invert],
                )],
                &a,
                w,
                h,
                None,
            );
            assert_eq!(slots.len(), 1);
            assert!(has_alpha(&slots[0].buf));
        }

        for style in [1.0, 2.0, 3.0] {
            let slots = render(
                &[(
                    FX_BEVEL,
                    vec![
                        1.0, 0.0, 0.8, 1.0, 1.0, 1.0, 3.0, 0.8, 0.0, 0.0, 0.0, 45.0, 35.0, 1.0,
                        1.5, 0.0, style,
                    ],
                )],
                &a,
                w,
                h,
                None,
            );
            assert_eq!(slots.len(), 2);
            assert!(slots.iter().all(|slot| has_alpha(&slot.buf)));
        }
    }

    // Base 17-float Bevel vector (the pre-VIS-LS-11 layout): inner bevel,
    // 45° / 35° light, depth 1, size 2.
    fn bevel_params() -> Vec<f32> {
        vec![
            1.0, 0.0, 0.8, 1.0, 1.0, 1.0, 3.0, 0.8, 0.0, 0.0, 0.0, 45.0, 35.0, 1.0, 2.0, 0.0, 0.0,
        ]
    }

    fn bevel_slots(p: Vec<f32>, a: &[f32], w: usize, h: usize) -> Vec<Vec<u16>> {
        render(&[(FX_BEVEL, p)], a, w, h, None)
            .into_iter()
            .map(|s| s.buf)
            .collect()
    }

    #[test]
    fn bevel_technique_direction_gloss_and_sub_effects_all_bite() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let base = bevel_slots(bevel_params(), &a, w, h);
        assert_eq!(base.len(), 2);
        assert!(base.iter().all(|b| has_alpha(b)));

        // A short (legacy) vector must render exactly like the padded default.
        let mut padded = bevel_params();
        padded.extend_from_slice(&[0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 0.0, 0.0, 16.0, 1.0, 0.0]);
        assert_eq!(
            bevel_slots(padded, &a, w, h),
            base,
            "appended slots at their defaults are a no-op (frozen persisted vectors)"
        );

        let with = |i: usize, v: f32| {
            let mut p = bevel_params();
            p.resize(28, 0.0);
            p[22] = 0.5; // contour range default
            p[25] = 16.0; // texture scale default
            p[26] = 1.0; // texture depth default
            p[i] = v;
            bevel_slots(p, &a, w, h)
        };

        for technique in [1.0, 2.0] {
            let t = with(17, technique);
            assert_ne!(t, base, "technique {technique} reshapes the chamfer");
            assert!(t.iter().all(|b| has_alpha(b)));
        }

        // Direction Down swaps the highlight and shadow *coverage* (the slots
        // keep their own colours, so compare the alpha planes).
        let alpha = |b: &[u16]| b.chunks_exact(4).map(|px| px[3]).collect::<Vec<_>>();
        let down = with(18, 1.0);
        assert_eq!(
            alpha(&down[0]),
            alpha(&base[1]),
            "Down lights what Up shaded"
        );
        assert_eq!(alpha(&down[1]), alpha(&base[0]));

        let gloss = with(19, 3.0); // Ring — non-monotonic
        assert_ne!(gloss, base, "gloss contour remaps the lighting ramp");

        assert_eq!(with(19, 0.0), base, "Linear gloss is the identity");

        // Contour sub-effect off → identical; on → a different profile.
        assert_eq!(with(21, 4.0), base, "contour curve is inert while disabled");
        let contoured = {
            let mut p = bevel_params();
            p.resize(28, 0.0);
            p[20] = 1.0; // contour on
            p[21] = 4.0; // Gaussian
            p[22] = 0.5;
            bevel_slots(p, &a, w, h)
        };
        assert_ne!(contoured, base, "contour sub-effect reshapes the profile");

        // Texture sub-effect off → identical; on → pattern-displaced relief,
        // and Invert flips it.
        assert_eq!(with(24, 2.0), base, "pattern is inert while texture is off");
        let textured = |kind: f32, invert: f32| {
            let mut p = bevel_params();
            p.resize(28, 0.0);
            p[23] = 1.0;
            p[24] = kind;
            p[25] = 4.0;
            p[26] = 1.0;
            p[27] = invert;
            bevel_slots(p, &a, w, h)
        };
        for kind in [0.0, 1.0, 2.0] {
            assert_ne!(textured(kind, 0.0), base, "texture {kind} displaces relief");
            assert_ne!(
                textured(kind, 1.0),
                textured(kind, 0.0),
                "texture {kind} invert flips the displacement"
            );
        }
    }

    #[test]
    fn stroke_emboss_rides_the_stroke_band() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let mut p = bevel_params();
        p.resize(28, 0.0);
        p[16] = 4.0; // Stroke Emboss
        let stroke_p = vec![1.0, 0.0, 1.0, 0.9, 0.1, 0.2, 3.0, 1.0];

        // Without a Stroke effect there is no band, so the relief is empty.
        let alone = render(&[(FX_BEVEL, p.clone())], &a, w, h, None);
        assert_eq!(alone.len(), 2);
        assert!(
            alone.iter().all(|s| !has_alpha(&s.buf)),
            "Stroke Emboss needs an enabled Stroke effect"
        );

        // A disabled stroke is still no band.
        let mut off = stroke_p.clone();
        off[0] = 0.0;
        let disabled = render(&[(FX_BEVEL, p.clone()), (FX_STROKE, off)], &a, w, h, None);
        assert!(disabled.iter().all(|s| !has_alpha(&s.buf)));

        let with_stroke = render(&[(FX_BEVEL, p), (FX_STROKE, stroke_p)], &a, w, h, None);
        assert_eq!(with_stroke.len(), 3); // bevel highlight + shadow + stroke
        assert!(
            with_stroke[..2].iter().any(|s| has_alpha(&s.buf)),
            "the stroke band gets embossed"
        );
    }

    // ── VIS-LS-13: noise, knockout, glow technique/range/jitter/gradient,
    // Satin contour and the Stroke fill types. Every slot these add must be
    // inert at its "missing" value so persisted vectors render unchanged.

    fn drop_shadow_params() -> Vec<f32> {
        vec![1.0, 3.0, 1.0, 0.0, 0.0, 0.0, 135.0, 3.0, 0.0, 5.0, 0.0]
    }

    fn bufs(p: Vec<f32>, id: u8, a: &[f32], w: usize, h: usize) -> Vec<Vec<u16>> {
        render(&[(id, p)], a, w, h, None)
            .into_iter()
            .map(|s| s.buf)
            .collect()
    }

    #[test]
    fn drop_shadow_knockout_toggles_and_noise_dithers() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let legacy = bufs(drop_shadow_params(), FX_DROP_SHADOW, &a, w, h);

        // A missing knockout slot must read as ON — that was the old behaviour.
        let mut on = drop_shadow_params();
        on.push(1.0);
        assert_eq!(bufs(on, FX_DROP_SHADOW, &a, w, h), legacy);

        let mut off = drop_shadow_params();
        off.push(0.0);
        let unknocked = bufs(off, FX_DROP_SHADOW, &a, w, h);
        assert_ne!(
            unknocked, legacy,
            "turning the knockout off fills the shape"
        );
        // With no knockout the shadow survives under the opaque layer.
        let centre = (h / 2 * w + w / 2) * 4 + 3;
        assert_eq!(legacy[0][centre], 0);
        assert!(unknocked[0][centre] > 0);

        let mut noisy = drop_shadow_params();
        noisy.extend_from_slice(&[1.0, 0.6]);
        let grainy = bufs(noisy.clone(), FX_DROP_SHADOW, &a, w, h);
        assert_ne!(grainy, legacy, "Noise dithers the shadow");
        assert_eq!(
            bufs(noisy, FX_DROP_SHADOW, &a, w, h),
            grainy,
            "the dither is deterministic across recomposites"
        );

        let mut quiet = drop_shadow_params();
        quiet.extend_from_slice(&[1.0, 0.0]);
        assert_eq!(
            bufs(quiet, FX_DROP_SHADOW, &a, w, h),
            legacy,
            "Noise 0 is inert"
        );
    }

    #[test]
    fn inner_shadow_and_satin_gained_noise_and_a_contour() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);

        let inner = vec![1.0, 3.0, 0.8, 0.0, 0.0, 0.0, 225.0, 2.0, 0.2, 4.0, 0.0];
        let base = bufs(inner.clone(), FX_INNER_SHADOW, &a, w, h);
        let mut noisy = inner.clone();
        noisy.push(0.7);
        assert_ne!(bufs(noisy, FX_INNER_SHADOW, &a, w, h), base);
        let mut zero = inner;
        zero.push(0.0);
        assert_eq!(bufs(zero, FX_INNER_SHADOW, &a, w, h), base);

        let satin = vec![1.0, 3.0, 0.6, 0.1, 0.2, 0.8, 45.0, 3.0, 2.0, 0.0];
        let flat = bufs(satin.clone(), FX_SATIN, &a, w, h);
        let mut linear = satin.clone();
        linear.push(0.0);
        assert_eq!(
            bufs(linear, FX_SATIN, &a, w, h),
            flat,
            "Linear contour is identity"
        );
        let mut ringed = satin;
        ringed.push(3.0); // Ring — non-monotonic
        assert_ne!(
            bufs(ringed, FX_SATIN, &a, w, h),
            flat,
            "Satin now takes a contour"
        );
    }

    #[test]
    fn glow_technique_range_jitter_and_gradient_fill_all_bite() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        // 9 legacy slots: enabled, screen, opacity, colour, spread, size, contour.
        let legacy = vec![1.0, 7.0, 0.8, 1.0, 1.0, 0.6, 0.3, 4.0, 0.0];
        let base = bufs(legacy.clone(), FX_OUTER_GLOW, &a, w, h);

        // The whole appended tail at its defaults is a no-op.
        let mut tail = legacy.clone();
        tail.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.4, 0.0]);
        assert_eq!(bufs(tail, FX_OUTER_GLOW, &a, w, h), base);

        let with = |i: usize, v: f32| {
            let mut p = legacy.clone();
            p.resize(17, 0.0);
            p[11] = 1.0; // range default
            p[i] = v;
            bufs(p, FX_OUTER_GLOW, &a, w, h)
        };
        assert_ne!(with(9, 1.0), base, "Precise technique reshapes the falloff");
        assert_ne!(with(10, 0.6), base, "Noise dithers the glow");
        assert_ne!(with(11, 0.3), base, "Range narrows the falloff band");
        assert_ne!(with(12, 0.8), base, "Jitter roughens the ramp");

        // Fill Type Gradient must actually vary the colour across the ramp.
        let mut grad = legacy.clone();
        grad.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 1.0]);
        let g_buf = &bufs(grad, FX_OUTER_GLOW, &a, w, h)[0];
        let reds: Vec<u16> = g_buf
            .chunks_exact(4)
            .filter(|px| px[3] > 0)
            .map(|px| px[0])
            .collect();
        assert!(!reds.is_empty());
        assert!(
            reds.iter().min() != reds.iter().max(),
            "a gradient glow is not one flat colour"
        );

        // Inner Glow carries the same tail, based one slot later.
        let inner = vec![1.0, 7.0, 0.8, 1.0, 1.0, 0.6, 0.3, 4.0, 0.0, 0.0];
        let ibase = bufs(inner.clone(), FX_INNER_GLOW, &a, w, h);
        let mut precise = inner.clone();
        precise.push(1.0);
        assert_ne!(bufs(precise, FX_INNER_GLOW, &a, w, h), ibase);
        let mut softer = inner;
        softer.extend_from_slice(&[0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]);
        assert_eq!(bufs(softer, FX_INNER_GLOW, &a, w, h), ibase);
    }

    #[test]
    fn stroke_fill_type_switches_between_colour_gradient_and_pattern() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let legacy = vec![1.0, 0.0, 1.0, 1.0, 0.1, 0.1, 3.0, 2.0]; // centre, red
        let flat = bufs(legacy.clone(), FX_STROKE, &a, w, h);

        let mut colour = legacy.clone();
        colour.extend_from_slice(&[0.0, 90.0, 1.0, 0.85, 0.1, 0.0, 16.0]);
        assert_eq!(
            bufs(colour, FX_STROKE, &a, w, h),
            flat,
            "Fill Type Color is the legacy render"
        );

        let band = |buf: &[u16], ch: usize| -> Vec<u16> {
            buf.chunks_exact(4)
                .filter(|px| px[3] > 0)
                .map(|px| px[ch])
                .collect()
        };
        assert!(!band(&flat[0], 1).is_empty());
        assert!(
            band(&flat[0], 1).iter().all(|&v| v == band(&flat[0], 1)[0]),
            "a colour stroke is one flat colour"
        );

        let mut grad = legacy.clone();
        grad.extend_from_slice(&[1.0, 90.0, 0.0, 1.0, 0.0, 0.0, 16.0]);
        let gb = bufs(grad, FX_STROKE, &a, w, h);
        let greens = band(&gb[0], 1);
        assert!(
            greens.iter().min() != greens.iter().max(),
            "gradient stroke ramps"
        );
        assert_eq!(
            band(&gb[0], 3),
            band(&flat[0], 3),
            "fill type never moves the band"
        );

        let mut pat = legacy;
        pat.extend_from_slice(&[2.0, 90.0, 1.0, 0.85, 0.1, 1.0, 4.0]); // grid @ 4px
        let pb = bufs(pat, FX_STROKE, &a, w, h);
        let lum = band(&pb[0], 0);
        assert!(
            lum.iter().min() != lum.iter().max(),
            "pattern stroke is patterned"
        );
        assert_eq!(band(&pb[0], 3), band(&flat[0], 3));
    }

    // ── VIS-LS-10: the "Defined" pattern kind (3) samples the Edit ▸ Define
    // Pattern tile instead of a procedural formula.

    // A 2×2 RGBA16 tile: red, blue / blue, half-transparent red.
    fn tile_px() -> Vec<u16> {
        vec![
            65535, 0, 0, 65535, // (0,0) red
            0, 0, 65535, 65535, // (1,0) blue
            0, 0, 65535, 65535, // (0,1) blue
            65535, 0, 0, 32768, // (1,1) red @ 50%
        ]
    }

    // #420: a style names a tile from the pattern LIBRARY (kind 100 + n), so two
    // effects can use different patterns; before, every "Defined" pick meant the
    // one global slot.
    #[test]
    fn library_pattern_kinds_pick_their_own_tile_per_effect() {
        let (w, h) = (4usize, 4usize);
        let a = vec![1.0f32; w * h];
        let red = tile_px();
        let green: Vec<u16> = vec![0, 65535, 0, 65535];
        let library = [
            (100, Some(Tile { px: &red, w: 2, h: 2 })),
            (101, Some(Tile { px: &green, w: 1, h: 1 })),
            (102, None), // an id whose tile the host declined to push
        ];
        let tiles = Tiles { defined: None, library: &library };
        let overlay = |kind: f32| {
            render_with_contours(
                &[(FX_PATTERN_OVERLAY, vec![1.0, 0.0, 1.0, 16.0, kind])],
                &a, w, h, tiles, &[],
            )
            .remove(0)
            .buf
        };

        // Slot 1 is the flat green tile: every pixel is that texel.
        let second = overlay(101.0);
        for i in 0..w * h {
            assert_eq!(&second[i * 4..i * 4 + 4], &green[..], "library tile 1 at {i}");
        }
        // Slot 0 is the 2×2 tile, so the two differ — the point of the issue.
        let first = overlay(100.0);
        assert_ne!(first, second, "two effects can name two different tiles");
        assert_eq!(&first[..4], &red[..4], "…and slot 0 is the red texel");

        // An empty slot, and one past the end, fall back to the checker — never
        // to a neighbouring tile.
        let checker = overlay(0.0);
        assert_eq!(overlay(102.0), checker, "an id with no tile renders the checker");
        assert_eq!(overlay(199.0), checker, "so does an id the library never had");

        // The defined slot (kind 3) is still its own thing, unaffected by the library.
        let defined = Tiles { defined: Some(Tile { px: &green, w: 1, h: 1 }), library: &library };
        let with_defined = render_with_contours(
            &[(FX_PATTERN_OVERLAY, vec![1.0, 0.0, 1.0, 16.0, 3.0])],
            &a, w, h, defined, &[],
        )
        .remove(0)
        .buf;
        assert_eq!(with_defined, second, "kind 3 samples the defined tile");
    }

    #[test]
    fn defined_pattern_kind_samples_the_tile_across_overlay_stroke_and_texture() {
        let (w, h) = (8usize, 8usize);
        let a = vec![1.0f32; w * h];
        let px = tile_px();
        let tile = Tile { px: &px, w: 2, h: 2 };
        // Pattern Overlay: kind 3, Scale 16 == 1:1, so every canvas pixel is its
        // tile texel — colour AND alpha.
        let overlay = vec![1.0, 0.0, 1.0, 16.0, 3.0];
        let one = |p: Vec<f32>, t: Option<Tile>| render(&[(FX_PATTERN_OVERLAY, p)], &a, w, h, t)
            .remove(0)
            .buf;
        let buf = one(overlay.clone(), Some(tile));
        for y in 0..h {
            for x in 0..w {
                let i = (y * w + x) * 4;
                let t = ((y % 2) * 2 + (x % 2)) * 4;
                assert_eq!(&buf[i..i + 4], &px[t..t + 4], "tile texel at {x},{y}");
            }
        }
        // No defined tile → the kind falls back to the checker, so it differs.
        assert_ne!(one(overlay, None), buf, "kind 3 without a tile falls back");

        // Scale is a zoom against that 1:1 default: 32 doubles the cell.
        let big = one(vec![1.0, 0.0, 1.0, 32.0, 3.0], Some(tile));
        assert_eq!(big[..4], big[4..8], "Scale 32 makes each texel 2px wide");
        assert_ne!(big, buf);

        // Stroke's Pattern fill type (8 = 2) and Bevel's Texture sub-effect
        // (23 = 1) read the same tile through the same slot.
        let shape = alpha_shape(w, h);
        let mut stroke_p = vec![1.0, 0.0, 1.0, 1.0, 0.1, 0.1, 2.0, 2.0];
        stroke_p.extend_from_slice(&[2.0, 90.0, 1.0, 0.85, 0.1, 3.0, 16.0]);
        let stroke_buf = |t: Option<Tile>| {
            render(&[(FX_STROKE, stroke_p.clone())], &shape, w, h, t)
                .remove(0)
                .buf
        };
        assert_ne!(
            stroke_buf(Some(tile)),
            stroke_buf(None),
            "the stroke's pattern fill uses the tile"
        );

        let mut bevel_p = bevel_params();
        // technique, direction, gloss · contour off, curve, range · texture on,
        // kind 3, scale 32 (the 2×2 tile zoomed to a 4px period, so the relief's
        // central differences can see it), depth 1, no invert.
        bevel_p.extend_from_slice(&[0.0, 0.0, 0.0, 0.0, 0.0, 0.5, 1.0, 3.0, 32.0, 1.0, 0.0]);
        let textured = render(&[(FX_BEVEL, bevel_p.clone())], &shape, w, h, Some(tile));
        let procedural = render(&[(FX_BEVEL, bevel_p)], &shape, w, h, None);
        assert_ne!(
            textured[0].buf, procedural[0].buf,
            "Bevel's Texture displaces the relief with the tile"
        );
    }

    // Gradient Overlay: the legacy 13-float vector (slots 0..12) is black→white
    // Linear at 0°, so every appended slot below is exercised against it.
    fn grad_overlay_params() -> Vec<f32> {
        vec![
            1.0, 0.0, 1.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0, 1.0, 1.0, 1.0,
        ]
    }

    #[test]
    fn gradient_overlay_styles_dither_align_and_offset_are_appended_slots() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        let legacy = bufs(grad_overlay_params(), FX_GRADIENT_OVERLAY, &a, w, h);

        // A vector padded with the defaults renders exactly like the short one.
        let mut padded = grad_overlay_params();
        padded.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 0.0]); // dither, align, off x/y, 0 stops
        assert_eq!(
            bufs(padded, FX_GRADIENT_OVERLAY, &a, w, h),
            legacy,
            "pre-VIS-LS-09 vectors keep their exact render"
        );

        // Each of the three new styles differs from Linear (0) and from Radial (1).
        let styled = |k: f32| {
            let mut p = grad_overlay_params();
            p[5] = k;
            bufs(p, FX_GRADIENT_OVERLAY, &a, w, h)
        };
        let radial = styled(1.0);
        for k in [2.0, 3.0, 4.0] {
            let s = styled(k);
            assert_ne!(s, legacy, "style {k} differs from Linear");
            assert_ne!(s, radial, "style {k} differs from Radial");
        }

        // `style` picks the projection the slot under test is observable in: a
        // 0° linear ramp is y-invariant, so Offset Y only shows up on a radial.
        let tweak = |style: f32, slot: usize, v: f32| {
            let mut p = grad_overlay_params();
            p.resize(17, 0.0);
            p[5] = style;
            p[14] = 1.0; // keep align on unless this is the slot under test
            p[slot] = v;
            bufs(p, FX_GRADIENT_OVERLAY, &a, w, h)
        };
        assert_ne!(tweak(0.0, 13, 1.0), legacy, "dither perturbs the ramp");
        assert_ne!(tweak(0.0, 14, 0.0), legacy, "align off spans the canvas");
        assert_ne!(tweak(0.0, 15, 0.5), legacy, "offset x moves the ramp");
        assert_ne!(tweak(1.0, 16, 0.5), radial, "offset y moves the ramp");
    }

    #[test]
    fn gradient_overlay_renders_a_multi_stop_ramp_with_opacity_stops() {
        let (w, h) = (16usize, 16usize);
        let a = alpha_shape(w, h);
        // Black → green → white, the middle stop half transparent: a shape the
        // two-colour ramp cannot produce at all.
        let mut p = grad_overlay_params();
        p.extend_from_slice(&[0.0, 1.0, 0.0, 0.0, 3.0]); // dither, align, off, 3 stops
        p.extend_from_slice(&[0.0, 0.0, 0.0, 0.0, 1.0]);
        p.extend_from_slice(&[0.5, 0.0, 1.0, 0.0, 0.5]);
        p.extend_from_slice(&[1.0, 1.0, 1.0, 1.0, 1.0]);
        let buf = bufs(p.clone(), FX_GRADIENT_OVERLAY, &a, w, h).remove(0);
        let px = |x: usize, y: usize| {
            let i = (y * w + x) * 4;
            [buf[i], buf[i + 1], buf[i + 2], buf[i + 3]]
        };
        // Row 8, mid-shape: 0° linear ramps left→right across the bbox.
        let mid = px(w / 2, h / 2);
        assert!(
            mid[1] > mid[0] && mid[1] > mid[2],
            "the interior stop tints the middle green, got {mid:?}"
        );
        assert!(
            mid[3] > 0 && mid[3] < 40000,
            "the interior opacity stop halves coverage, got {}",
            mid[3]
        );
        // Ends still come from the Start/End colour rows (slots 7..12).
        let mut ends = p;
        ends[7] = 1.0; // Start → red
        let recoloured = bufs(ends, FX_GRADIENT_OVERLAY, &a, w, h).remove(0);
        let i = (h / 2 * w + 3) * 4;
        assert!(
            recoloured[i] > buf[i],
            "the Start colour still drives the ramp's first stop"
        );
    }

    #[test]
    fn signature_tracks_params_and_alpha_content() {
        let a = alpha_shape(5, 5);
        let effects = vec![(FX_COLOR_OVERLAY, vec![1.0, 0.0, 0.4, 0.2, 0.3, 0.4])];
        let sig = signature(&effects, &a);
        let mut changed_effects = effects.clone();
        changed_effects[0].1[3] = 0.9;
        assert_ne!(sig, signature(&changed_effects, &a));

        let mut changed_alpha = a.clone();
        changed_alpha[0] = 1.0;
        assert_ne!(sig, signature(&effects, &changed_alpha));
    }
}
