// ─────────────────────────────────────────────────────────────
// Color math — straight-alpha RGBA in 0..1 float, plus HSL/HSV
// conversions and the W3C non-separable blend helpers.
// ─────────────────────────────────────────────────────────────
// Blending is done in the document's (sRGB / gamma) space, matching
// Photoshop's default 8-bit behaviour — channels are not linearized.

#[derive(Clone, Copy, Debug)]
pub struct Rgba {
    pub r: f32,
    pub g: f32,
    pub b: f32,
    pub a: f32,
}

impl Rgba {
    #[inline]
    pub fn new(r: f32, g: f32, b: f32, a: f32) -> Self {
        Rgba { r, g, b, a }
    }

    #[inline]
    pub fn to_u8(self, out: &mut [u8]) {
        out[0] = (self.r.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[1] = (self.g.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[2] = (self.b.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
        out[3] = (self.a.clamp(0.0, 1.0) * 255.0 + 0.5) as u8;
    }

    // 16-bit/channel storage (the engine's internal pixel depth).
    #[inline]
    pub fn from_u16(p: &[u16]) -> Self {
        Rgba {
            r: p[0] as f32 / 65535.0,
            g: p[1] as f32 / 65535.0,
            b: p[2] as f32 / 65535.0,
            a: p[3] as f32 / 65535.0,
        }
    }

    #[inline]
    pub fn from_f32(p: &[f32]) -> Self {
        Rgba {
            r: p[0],
            g: p[1],
            b: p[2],
            a: p[3],
        }
    }

    #[inline]
    pub fn to_f32(self, out: &mut [f32]) {
        out[0] = self.r;
        out[1] = self.g;
        out[2] = self.b;
        out[3] = self.a.clamp(0.0, 1.0);
    }

    #[inline]
    pub fn to_u16(self, out: &mut [u16]) {
        out[0] = (self.r.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
        out[1] = (self.g.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
        out[2] = (self.b.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
        out[3] = (self.a.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16;
    }
}

#[inline]
pub fn to16(x: f32) -> u16 {
    (x.clamp(0.0, 1.0) * 65535.0 + 0.5) as u16
}

// 8-bit value <-> 16-bit storage (exact round-trip for 8-bit-origin data).
#[inline]
pub fn u8_to_16(v: u8) -> u16 {
    v as u16 * 257
}
#[inline]
pub fn u16_to_8(v: u16) -> u8 {
    (v >> 8) as u8
}

#[inline]
pub fn clamp01(x: f32) -> f32 {
    x.clamp(0.0, 1.0)
}

#[inline]
pub fn to8(x: f32) -> u8 {
    (x.clamp(0.0, 1.0) * 255.0 + 0.5) as u8
}

#[inline]
pub fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}

// Perceptual luminance used by the non-separable blend modes (W3C / Photoshop).
#[inline]
pub fn lum(r: f32, g: f32, b: f32) -> f32 {
    0.3 * r + 0.59 * g + 0.11 * b
}

// ── HSL ────────────────────────────────────────────────────────
// h in 0..360, s/l in 0..1.
pub fn rgb_to_hsl(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
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

pub fn hsl_to_rgb(h: f32, s: f32, l: f32) -> (f32, f32, f32) {
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

// ── HSV ────────────────────────────────────────────────────────
pub fn rgb_to_hsv(r: f32, g: f32, b: f32) -> (f32, f32, f32) {
    let max = r.max(g).max(b);
    let min = r.min(g).min(b);
    let d = max - min;
    let v = max;
    let s = if max <= 0.0 { 0.0 } else { d / max };
    let h = if d.abs() < 1e-6 {
        0.0
    } else if max == r {
        ((g - b) / d).rem_euclid(6.0)
    } else if max == g {
        (b - r) / d + 2.0
    } else {
        (r - g) / d + 4.0
    };
    (h * 60.0, s, v)
}

pub fn hsv_to_rgb(h: f32, s: f32, v: f32) -> (f32, f32, f32) {
    let h = (h / 60.0).rem_euclid(6.0);
    let i = h.floor() as i32;
    let f = h - i as f32;
    let p = v * (1.0 - s);
    let q = v * (1.0 - s * f);
    let t = v * (1.0 - s * (1.0 - f));
    match i {
        0 => (v, t, p),
        1 => (q, v, p),
        2 => (p, v, t),
        3 => (p, q, v),
        4 => (t, p, v),
        _ => (v, p, q),
    }
}

// ── W3C non-separable blend helpers (hue / saturation / color / luminosity) ──
type C3 = [f32; 3];

#[inline]
fn lum3(c: C3) -> f32 {
    lum(c[0], c[1], c[2])
}

fn clip_color(mut c: C3) -> C3 {
    let l = lum3(c);
    let n = c[0].min(c[1]).min(c[2]);
    let x = c[0].max(c[1]).max(c[2]);
    if n < 0.0 {
        let d = l - n;
        if d.abs() > 1e-6 {
            for v in c.iter_mut() {
                *v = l + (*v - l) * l / d;
            }
        }
    }
    if x > 1.0 {
        let d = x - l;
        if d.abs() > 1e-6 {
            for v in c.iter_mut() {
                *v = l + (*v - l) * (1.0 - l) / d;
            }
        }
    }
    c
}

pub fn set_lum(c: C3, l: f32) -> C3 {
    let d = l - lum3(c);
    clip_color([c[0] + d, c[1] + d, c[2] + d])
}

fn sat3(c: C3) -> f32 {
    c[0].max(c[1]).max(c[2]) - c[0].min(c[1]).min(c[2])
}

// Set saturation of c to s, preserving relative ordering of channels.
pub fn set_sat(c: C3, s: f32) -> C3 {
    // indices of min, mid, max
    let mut idx = [0usize, 1, 2];
    idx.sort_by(|&a, &b| c[a].partial_cmp(&c[b]).unwrap_or(std::cmp::Ordering::Equal));
    let (imin, imid, imax) = (idx[0], idx[1], idx[2]);
    let mut out = [0.0f32; 3];
    if c[imax] > c[imin] {
        out[imid] = (c[imid] - c[imin]) / (c[imax] - c[imin]) * s;
        out[imax] = s;
    }
    out[imin] = 0.0;
    out
}

pub fn nonsep_hue(cb: C3, cs: C3) -> C3 {
    set_lum(set_sat(cs, sat3(cb)), lum3(cb))
}
pub fn nonsep_saturation(cb: C3, cs: C3) -> C3 {
    set_lum(set_sat(cb, sat3(cs)), lum3(cb))
}
pub fn nonsep_color(cb: C3, cs: C3) -> C3 {
    set_lum(cs, lum3(cb))
}
pub fn nonsep_luminosity(cb: C3, cs: C3) -> C3 {
    set_lum(cb, lum3(cs))
}
