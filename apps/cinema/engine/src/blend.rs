//! Separable W3C compositing blend modes, operating on straight 0..1 channels.
//!
//! The program monitor is always opaque, so compositing is "source over" an
//! opaque destination: `out = lerp(dst, blend(dst, src), src_alpha)`. These
//! functions compute the per-channel `blend(dst, src)` term; the alpha lerp is
//! done by the compositor in `lib.rs`.
//!
//! The numeric ids match the `BLEND_MODES` list on the TS side (`state/store`),
//! so a clip's `blendIndex` maps 1:1 to a variant here.

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlendMode {
    Normal,
    Multiply,
    Screen,
    Overlay,
    Darken,
    Lighten,
    ColorDodge,
    ColorBurn,
    HardLight,
    SoftLight,
    Difference,
    Exclusion,
    Add,
    Subtract,
}

impl BlendMode {
    pub fn from_index(i: u32) -> BlendMode {
        match i {
            1 => BlendMode::Multiply,
            2 => BlendMode::Screen,
            3 => BlendMode::Overlay,
            4 => BlendMode::Darken,
            5 => BlendMode::Lighten,
            6 => BlendMode::ColorDodge,
            7 => BlendMode::ColorBurn,
            8 => BlendMode::HardLight,
            9 => BlendMode::SoftLight,
            10 => BlendMode::Difference,
            11 => BlendMode::Exclusion,
            12 => BlendMode::Add,
            13 => BlendMode::Subtract,
            _ => BlendMode::Normal,
        }
    }
}

#[inline]
fn ch(mode: BlendMode, d: f32, s: f32) -> f32 {
    match mode {
        BlendMode::Normal => s,
        BlendMode::Multiply => d * s,
        BlendMode::Screen => d + s - d * s,
        BlendMode::Overlay => hard_light(s, d),
        BlendMode::Darken => d.min(s),
        BlendMode::Lighten => d.max(s),
        BlendMode::ColorDodge => {
            if d <= 0.0 {
                0.0
            } else if s >= 1.0 {
                1.0
            } else {
                (d / (1.0 - s)).min(1.0)
            }
        }
        BlendMode::ColorBurn => {
            if d >= 1.0 {
                1.0
            } else if s <= 0.0 {
                0.0
            } else {
                1.0 - ((1.0 - d) / s).min(1.0)
            }
        }
        BlendMode::HardLight => hard_light(d, s),
        BlendMode::SoftLight => soft_light(d, s),
        BlendMode::Difference => (d - s).abs(),
        BlendMode::Exclusion => d + s - 2.0 * d * s,
        BlendMode::Add => (d + s).min(1.0),
        BlendMode::Subtract => (d - s).max(0.0),
    }
}

#[inline]
fn hard_light(d: f32, s: f32) -> f32 {
    if s <= 0.5 {
        d * (2.0 * s)
    } else {
        d + (2.0 * s - 1.0) - d * (2.0 * s - 1.0)
    }
}

#[inline]
fn soft_light(d: f32, s: f32) -> f32 {
    if s <= 0.5 {
        d - (1.0 - 2.0 * s) * d * (1.0 - d)
    } else {
        let dd = if d <= 0.25 {
            ((16.0 * d - 12.0) * d + 4.0) * d
        } else {
            d.sqrt()
        };
        d + (2.0 * s - 1.0) * (dd - d)
    }
}

/// Blend one RGB triple (straight, 0..1) over a destination triple.
#[inline]
pub fn blend_rgb(mode: BlendMode, dst: [f32; 3], src: [f32; 3]) -> [f32; 3] {
    [ch(mode, dst[0], src[0]), ch(mode, dst[1], src[1]), ch(mode, dst[2], src[2])]
}
