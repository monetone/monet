pub fn encode_srgb_u16(linear: u16) -> u16 {
    let v = linear as f32 / 65_535.0;
    let encoded = if v <= 0.003_130_8 {
        12.92 * v
    } else {
        1.055 * v.powf(1.0 / 2.4) - 0.055
    };
    (encoded * 65_535.0).round().clamp(0.0, 65_535.0) as u16
}

pub fn encode_linear_srgb_rgba16(pixels: &mut [u16]) {
    for pixel in pixels.chunks_exact_mut(4) {
        pixel[0] = encode_srgb_u16(pixel[0]);
        pixel[1] = encode_srgb_u16(pixel[1]);
        pixel[2] = encode_srgb_u16(pixel[2]);
    }
}

// ── Verbatim ports from packages/engine/src/raster/color.rs ────────────
// Bit-exact copies so develop_advanced matches the wasm engine's first
// develop stage. Do not "clean up" — divergence breaks the native==wasm gate.

#[inline]
pub(crate) fn to16(x: f32) -> u16 {
    (x.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16
}

// ── HSL ────────────────────────────────────────────────────────
// h in 0..360, s/l in 0..1.
pub(crate) fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let l = (max + min) * 0.5;
    if (max - min).abs() < 1e-6 {
        return (0.0, 0.0, l);
    }
    let d = max - min;
    let s = if l > 0.5 {
        d / (2.0 - max - min)
    } else {
        d / (max + min)
    };
    let h = if max == r {
        (g - b) / d + if g < b { 6.0 } else { 0.0 }
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, l)
}

fn hue_to_rgb(p: f32, q: f32, mut t: f32) -> f32 {
    if t < 0.0 {
        t += 1.0;
    }
    if t > 1.0 {
        t -= 1.0;
    }
    if t < 1.0 / 6.0 {
        p + (q - p) * 6.0 * t
    } else if t < 0.5 {
        q
    } else if t < 2.0 / 3.0 {
        p + (q - p) * (2.0 / 3.0 - t) * 6.0
    } else {
        p
    }
}

pub(crate) fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
    if s.abs() < 1e-6 {
        return (l, l, l);
    }
    let q = if l < 0.5 {
        l * (1.0 + s)
    } else {
        l + s - l * s
    };
    let p = 2.0 * l - q;
    let hk = h / 360.0;
    (
        hue_to_rgb(p, q, hk + 1.0 / 3.0),
        hue_to_rgb(p, q, hk),
        hue_to_rgb(p, q, hk - 1.0 / 3.0),
    )
}
