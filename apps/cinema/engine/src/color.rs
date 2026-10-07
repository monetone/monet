//! Color math + the Lumetri-style per-clip color grade.
//!
//! The grade param block is a fixed-length `f32` slice whose slot layout is
//! mirrored on the TS side (`state/effects.ts`, `COLOR_PARAMS`). Index 0 is the
//! enable flag; a disabled (or empty) block is a no-op.

pub const COLOR_PARAMS_LEN: usize = 16;

// Slot indices into the grade param block.
pub const P_ENABLED: usize = 0;
pub const P_EXPOSURE: usize = 1; // stops, -5..5
pub const P_CONTRAST: usize = 2; // -1..1
pub const P_SATURATION: usize = 3; // -1..1
pub const P_TEMPERATURE: usize = 4; // -1..1 (warm +)
pub const P_TINT: usize = 5; // -1..1 (magenta +)
pub const P_HIGHLIGHTS: usize = 6; // -1..1
pub const P_SHADOWS: usize = 7; // -1..1
pub const P_WHITES: usize = 8; // -1..1
pub const P_BLACKS: usize = 9; // -1..1
pub const P_VIBRANCE: usize = 10; // -1..1
pub const P_HUE: usize = 11; // degrees, -180..180
pub const P_GAMMA: usize = 12; // 0.1..3, 1 = neutral
pub const P_LIFT: usize = 13; // -1..1 (shadow offset)
pub const P_GAIN: usize = 14; // 0..2, 1 = neutral
pub const P_LUT_MIX: usize = 15; // 0..1 creative-LUT blend (0 = no LUT)

/// Largest lattice edge accepted from the host — mirrors monet-photo's
/// `MAX_CUBE_LUT_SIZE`, and bounds `set_lut`'s allocation.
pub const MAX_LUT_SIZE: usize = 64;

#[inline]
fn luma(r: f32, g: f32, b: f32) -> f32 {
    0.2126 * r + 0.7152 * g + 0.0722 * b
}

#[inline]
fn clamp01(x: f32) -> f32 {
    x.max(0.0).min(1.0)
}

/// True if the block enables grading and is long enough to read.
pub fn grade_enabled(p: &[f32]) -> bool {
    p.len() >= COLOR_PARAMS_LEN && p[P_ENABLED] > 0.5
}

/// Apply the full grade to a straight RGB triple (0..1). Returns the graded
/// triple, clamped to 0..1.
pub fn apply_grade(p: &[f32], rgb: [f32; 3]) -> [f32; 3] {
    let mut r = rgb[0];
    let mut g = rgb[1];
    let mut b = rgb[2];

    // 1. Exposure (linear gain in display space — cheap approximation).
    let exp = (2.0_f32).powf(p[P_EXPOSURE]);
    r *= exp;
    g *= exp;
    b *= exp;

    // 2. White balance: temperature warms (R up, B down), tint pushes magenta.
    let temp = p[P_TEMPERATURE];
    let tint = p[P_TINT];
    r *= 1.0 + 0.30 * temp;
    b *= 1.0 - 0.30 * temp;
    g *= 1.0 - 0.20 * tint;

    // 3. Lift / gamma / gain (offset, power, multiply).
    let lift = p[P_LIFT];
    let gain = if p[P_GAIN] == 0.0 { 1.0 } else { p[P_GAIN] };
    let gamma = if p[P_GAMMA] <= 0.0 { 1.0 } else { p[P_GAMMA] };
    let lgg = |x: f32| -> f32 {
        let y = (x + lift * (1.0 - x)) * gain;
        clamp01(y).powf(1.0 / gamma)
    };
    r = lgg(r);
    g = lgg(g);
    b = lgg(b);

    // 4. Shadows / highlights / whites / blacks tonal pushes (luma-weighted).
    let l = luma(r, g, b);
    let sh = p[P_SHADOWS] * (1.0 - l) * (1.0 - l);
    let hi = p[P_HIGHLIGHTS] * l * l;
    let bl = p[P_BLACKS] * (1.0 - l).powi(3);
    let wh = p[P_WHITES] * l.powi(3);
    let tone = 0.5 * (sh + hi + bl + wh);
    r += tone;
    g += tone;
    b += tone;

    // 5. Contrast around 0.5 pivot.
    let c = 1.0 + p[P_CONTRAST];
    r = (r - 0.5) * c + 0.5;
    g = (g - 0.5) * c + 0.5;
    b = (b - 0.5) * c + 0.5;

    // 6. Hue rotation (around the luma axis, YIQ-ish).
    if p[P_HUE].abs() > 0.001 {
        let rot = p[P_HUE].to_radians();
        let cs = rot.cos();
        let sn = rot.sin();
        // Rotate chroma in a simple I/Q plane.
        let y = luma(r, g, b);
        let i = 0.596 * r - 0.274 * g - 0.322 * b;
        let q = 0.211 * r - 0.523 * g + 0.312 * b;
        let i2 = i * cs - q * sn;
        let q2 = i * sn + q * cs;
        r = y + 0.956 * i2 + 0.621 * q2;
        g = y - 0.272 * i2 - 0.647 * q2;
        b = y - 1.106 * i2 + 1.703 * q2;
    }

    // 7. Saturation + vibrance (vibrance scales less-saturated pixels more).
    let l2 = luma(r, g, b);
    let mut sat = 1.0 + p[P_SATURATION];
    if p[P_VIBRANCE].abs() > 0.001 {
        let max = r.max(g).max(b);
        let min = r.min(g).min(b);
        let cur_sat = (max - min).max(0.0);
        sat += p[P_VIBRANCE] * (1.0 - cur_sat);
    }
    r = l2 + (r - l2) * sat;
    g = l2 + (g - l2) * sat;
    b = l2 + (b - l2) * sat;

    [clamp01(r), clamp01(g), clamp01(b)]
}

/// A creative-Look 3D LUT (Adobe `.cube` / Autodesk `.3dl`) attached to a layer.
///
/// The lattice layout is the shared Monet one — RED varies fastest, then green,
/// then blue: `index = ((b·n + g)·n + r)·3`. That is what `@monet-ui/monet-photo`
/// `parseCubeLut`/`parse3dlLut` hand back and what Vision's `export_color_lut`
/// writes, so a LUT crosses between the apps without a repack.
#[derive(Clone)]
pub struct Lut3d {
    size: usize,
    data: Vec<f32>, // size³·3
    domain_min: [f32; 3],
    domain_max: [f32; 3],
}

impl Lut3d {
    /// Validate + copy a lattice from the host. `None` for anything malformed —
    /// a bad LUT must fail loudly at the boundary, never index out of bounds in
    /// the per-pixel loop.
    pub fn new(size: usize, data: &[f32], domain_min: [f32; 3], domain_max: [f32; 3]) -> Option<Lut3d> {
        if !(2..=MAX_LUT_SIZE).contains(&size) || data.len() != size * size * size * 3 {
            return None;
        }
        if !data.iter().all(|v| v.is_finite())
            || !domain_min.iter().chain(domain_max.iter()).all(|v| v.is_finite())
        {
            return None;
        }
        Some(Lut3d { size, data: data.to_vec(), domain_min, domain_max })
    }

    /// Trilinear sample for a straight RGB triple; mirrors monet-photo's
    /// `sampleLut3D` so preview and any TS-side bake agree.
    pub fn sample(&self, rgb: [f32; 3]) -> [f32; 3] {
        let n = self.size;
        let nf = (n - 1) as f32;
        let axis = |v: f32, lo: f32, hi: f32| -> f32 {
            let t = if hi > lo { (v - lo) / (hi - lo) } else { 0.0 };
            clamp01(t) * nf
        };
        let f = [
            axis(rgb[0], self.domain_min[0], self.domain_max[0]),
            axis(rgb[1], self.domain_min[1], self.domain_max[1]),
            axis(rgb[2], self.domain_min[2], self.domain_max[2]),
        ];
        let i0 = [f[0].floor() as usize, f[1].floor() as usize, f[2].floor() as usize];
        let i1 = [
            (i0[0] + 1).min(n - 1),
            (i0[1] + 1).min(n - 1),
            (i0[2] + 1).min(n - 1),
        ];
        let d = [f[0] - i0[0] as f32, f[1] - i0[1] as f32, f[2] - i0[2] as f32];
        let idx = |r: usize, g: usize, b: usize| ((b * n + g) * n + r) * 3;
        let lerp = |a: f32, c: f32, t: f32| a + (c - a) * t;
        let mut out = [0.0f32; 3];
        for (c, o) in out.iter_mut().enumerate() {
            let c00 = lerp(self.data[idx(i0[0], i0[1], i0[2]) + c], self.data[idx(i1[0], i0[1], i0[2]) + c], d[0]);
            let c10 = lerp(self.data[idx(i0[0], i1[1], i0[2]) + c], self.data[idx(i1[0], i1[1], i0[2]) + c], d[0]);
            let c01 = lerp(self.data[idx(i0[0], i0[1], i1[2]) + c], self.data[idx(i1[0], i0[1], i1[2]) + c], d[0]);
            let c11 = lerp(self.data[idx(i0[0], i1[1], i1[2]) + c], self.data[idx(i1[0], i1[1], i1[2]) + c], d[0]);
            *o = lerp(lerp(c00, c10, d[1]), lerp(c01, c11, d[1]), d[2]);
        }
        out
    }
}

/// Blend `rgb` toward its LUT output by `mix` (0..1). `mix <= 0` is a no-op, so
/// an attached-but-zeroed Look costs one compare per pixel.
pub fn apply_lut(lut: &Lut3d, rgb: [f32; 3], mix: f32) -> [f32; 3] {
    let m = clamp01(mix);
    if m <= 0.0 {
        return rgb;
    }
    let l = lut.sample(rgb);
    [
        clamp01(rgb[0] + (l[0] - rgb[0]) * m),
        clamp01(rgb[1] + (l[1] - rgb[1]) * m),
        clamp01(rgb[2] + (l[2] - rgb[2]) * m),
    ]
}

#[cfg(test)]
mod tests {
    use super::*;

    /// n³ identity lattice in the shared red-fastest order.
    fn identity(n: usize) -> Lut3d {
        let mut data = vec![0.0f32; n * n * n * 3];
        let nf = (n - 1) as f32;
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let i = ((b * n + g) * n + r) * 3;
                    data[i] = r as f32 / nf;
                    data[i + 1] = g as f32 / nf;
                    data[i + 2] = b as f32 / nf;
                }
            }
        }
        Lut3d::new(n, &data, [0.0; 3], [1.0; 3]).unwrap()
    }

    #[test]
    fn rejects_malformed_lattices() {
        assert!(Lut3d::new(1, &[0.0; 3], [0.0; 3], [1.0; 3]).is_none()); // too small
        assert!(Lut3d::new(2, &[0.0; 12], [0.0; 3], [1.0; 3]).is_none()); // short data (needs 24)
        assert!(Lut3d::new(65, &[0.0; 3], [0.0; 3], [1.0; 3]).is_none()); // over MAX_LUT_SIZE
        let mut nan = vec![0.0f32; 2 * 2 * 2 * 3];
        nan[5] = f32::NAN;
        assert!(Lut3d::new(2, &nan, [0.0; 3], [1.0; 3]).is_none());
    }

    #[test]
    fn identity_lut_is_a_no_op_including_between_lattice_points() {
        let lut = identity(5);
        for probe in [[0.0, 0.0, 0.0], [1.0, 1.0, 1.0], [0.37, 0.62, 0.11], [0.5, 0.25, 0.75]] {
            let out = apply_lut(&lut, probe, 1.0);
            for c in 0..3 {
                assert!((out[c] - probe[c]).abs() < 1e-4, "channel {c}: {out:?} vs {probe:?}");
            }
        }
    }

    #[test]
    fn channel_order_is_red_fastest() {
        // A lattice that maps every input to its own red coordinate proves the
        // index formula: bumping RED must move the output, bumping blue must not.
        let n = 4;
        let nf = (n - 1) as f32;
        let mut data = vec![0.0f32; n * n * n * 3];
        for b in 0..n {
            for g in 0..n {
                for r in 0..n {
                    let i = ((b * n + g) * n + r) * 3;
                    data[i] = r as f32 / nf;
                    data[i + 1] = r as f32 / nf;
                    data[i + 2] = r as f32 / nf;
                }
            }
        }
        let lut = Lut3d::new(n, &data, [0.0; 3], [1.0; 3]).unwrap();
        assert!((lut.sample([1.0, 0.0, 0.0])[0] - 1.0).abs() < 1e-4);
        assert!(lut.sample([0.0, 0.0, 1.0])[0].abs() < 1e-4);
    }

    #[test]
    fn mix_blends_and_zero_mix_bypasses() {
        // Constant-black LUT: output is a pure lerp of the input toward 0.
        let n = 2;
        let lut = Lut3d::new(n, &vec![0.0f32; n * n * n * 3], [0.0; 3], [1.0; 3]).unwrap();
        let src = [0.8, 0.4, 0.2];
        assert_eq!(apply_lut(&lut, src, 0.0), src);
        let half = apply_lut(&lut, src, 0.5);
        for c in 0..3 {
            assert!((half[c] - src[c] * 0.5).abs() < 1e-4, "channel {c}: {half:?}");
        }
        assert!(apply_lut(&lut, src, 1.0).iter().all(|v| v.abs() < 1e-4));
    }

    #[test]
    fn domain_maps_the_input_range() {
        // A 0..0.5 domain doubles the effective input scale: 0.5 hits the top.
        let mut lut = identity(3);
        lut.domain_max = [0.5, 0.5, 0.5];
        let out = lut.sample([0.5, 0.5, 0.5]);
        assert!(out.iter().all(|v| (v - 1.0).abs() < 1e-4), "{out:?}");
    }

    #[test]
    fn lut_mix_slot_is_the_reserved_tail_of_the_grade_block() {
        // Cross-language contract with state/effects.ts.
        assert_eq!(P_LUT_MIX, COLOR_PARAMS_LEN - 1);
        assert_eq!(P_LUT_MIX, P_GAIN + 1);
    }
}
