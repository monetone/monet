// ─────────────────────────────────────────────────────────────
// Blend modes + per-pixel source-over compositing (W3C Compositing
// and Blending Level 1). Straight-alpha colors in 0..1.
// ─────────────────────────────────────────────────────────────

use crate::raster::color::*;

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum BlendMode {
    Normal,
    Dissolve, // approximated as Normal in compositing (handled via noise elsewhere)
    Darken,
    Multiply,
    ColorBurn,
    LinearBurn,
    Lighten,
    Screen,
    ColorDodge,
    LinearDodge, // (Add)
    Overlay,
    SoftLight,
    HardLight,
    VividLight,
    LinearLight,
    PinLight,
    HardMix,
    Difference,
    Exclusion,
    Subtract,
    Divide,
    Hue,
    Saturation,
    Color,
    Luminosity,
    // Group-only mode (Photoshop's default for groups): members composite
    // straight onto the backdrop, no isolation. Appended last so the existing
    // serialized indices stay stable; treated as Normal in per-pixel math.
    PassThrough,
    // Whole-pixel comparison modes: pick the darker/lighter of the entire
    // source vs. backdrop pixel (compared by RGB sum), not per channel.
    // Appended after PassThrough to keep serialized indices stable.
    DarkerColor,
    LighterColor,
}

impl BlendMode {
    pub fn from_u8(v: u8) -> BlendMode {
        use BlendMode::*;
        match v {
            0 => Normal,
            1 => Dissolve,
            2 => Darken,
            3 => Multiply,
            4 => ColorBurn,
            5 => LinearBurn,
            6 => Lighten,
            7 => Screen,
            8 => ColorDodge,
            9 => LinearDodge,
            10 => Overlay,
            11 => SoftLight,
            12 => HardLight,
            13 => VividLight,
            14 => LinearLight,
            15 => PinLight,
            16 => HardMix,
            17 => Difference,
            18 => Exclusion,
            19 => Subtract,
            20 => Divide,
            21 => Hue,
            22 => Saturation,
            23 => Color,
            24 => Luminosity,
            25 => PassThrough,
            26 => DarkerColor,
            27 => LighterColor,
            _ => Normal,
        }
    }

    pub fn to_u8(self) -> u8 {
        use BlendMode::*;
        match self {
            Normal => 0,
            Dissolve => 1,
            Darken => 2,
            Multiply => 3,
            ColorBurn => 4,
            LinearBurn => 5,
            Lighten => 6,
            Screen => 7,
            ColorDodge => 8,
            LinearDodge => 9,
            Overlay => 10,
            SoftLight => 11,
            HardLight => 12,
            VividLight => 13,
            LinearLight => 14,
            PinLight => 15,
            HardMix => 16,
            Difference => 17,
            Exclusion => 18,
            Subtract => 19,
            Divide => 20,
            Hue => 21,
            Saturation => 22,
            Color => 23,
            Luminosity => 24,
            PassThrough => 25,
            DarkerColor => 26,
            LighterColor => 27,
        }
    }

    pub fn is_nonseparable(self) -> bool {
        matches!(
            self,
            BlendMode::Hue
                | BlendMode::Saturation
                | BlendMode::Color
                | BlendMode::Luminosity
                | BlendMode::DarkerColor
                | BlendMode::LighterColor
        )
    }
}

// (#38) W3C spec order: the BACKDROP corner is tested first, so cb=1 burns to 1
// and cb=0 dodges to 0 — Photoshop leaves pure white untouched under a black
// Color Burn layer and pure black untouched under a white Color Dodge layer.
// Shared with the dodge/burn halves of Vivid Light / Hard Mix.
#[inline]
fn color_burn(cb: f32, cs: f32) -> f32 {
    if cb >= 1.0 {
        1.0
    } else if cs <= 0.0 {
        0.0
    } else {
        1.0 - ((1.0 - cb) / cs).min(1.0)
    }
}

#[inline]
fn color_dodge(cb: f32, cs: f32) -> f32 {
    if cb <= 0.0 {
        0.0
    } else if cs >= 1.0 {
        1.0
    } else {
        (cb / (1.0 - cs)).min(1.0)
    }
}

// Vivid Light: color burn below mid-grey, color dodge above (source doubled).
#[inline]
fn vivid_light(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        color_burn(cb, 2.0 * cs)
    } else {
        color_dodge(cb, 2.0 * (cs - 0.5))
    }
}

// Separable blend function B(cb, cs) per channel, both in 0..1.
#[inline]
fn blend_channel(mode: BlendMode, cb: f32, cs: f32) -> f32 {
    use BlendMode::*;
    match mode {
        // ponytail: Dissolve = Normal in per-channel blend math; its dither lives in the
        // compositor (composite_layer_px + the isolated-group branch), not here. PS also
        // dissolves in fade/apply-image/calculations/brush-paint — each a separate pixel
        // loop; wire dissolve_keep into those loops if that fidelity is ever needed.
        Normal | Dissolve | PassThrough => cs,
        Darken => cb.min(cs),
        Multiply => cb * cs,
        ColorBurn => color_burn(cb, cs),
        LinearBurn => (cb + cs - 1.0).max(0.0),
        Lighten => cb.max(cs),
        Screen => cb + cs - cb * cs,
        ColorDodge => color_dodge(cb, cs),
        LinearDodge => (cb + cs).min(1.0),
        Overlay => hard_light(cs, cb),
        HardLight => hard_light(cb, cs),
        SoftLight => soft_light(cb, cs),
        VividLight => vivid_light(cb, cs),
        LinearLight => (cb + 2.0 * cs - 1.0).clamp(0.0, 1.0),
        PinLight => {
            if cs > 0.5 {
                cb.max(2.0 * (cs - 0.5))
            } else {
                cb.min(2.0 * cs)
            }
        }
        HardMix => {
            // vivid light thresholded
            if vivid_light(cb, cs) < 0.5 {
                0.0
            } else {
                1.0
            }
        }
        Difference => (cb - cs).abs(),
        Exclusion => cb + cs - 2.0 * cb * cs,
        Subtract => (cb - cs).max(0.0),
        Divide => {
            if cs <= 0.0 {
                1.0
            } else {
                (cb / cs).min(1.0)
            }
        }
        // non-separable / whole-pixel modes handled separately in blend_rgb
        Hue | Saturation | Color | Luminosity | DarkerColor | LighterColor => cs,
    }
}

#[inline]
fn hard_light(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cb * (2.0 * cs)
    } else {
        let s = 2.0 * cs - 1.0;
        cb + s - cb * s // screen(cb, 2cs-1)
    }
}

#[inline]
fn soft_light(cb: f32, cs: f32) -> f32 {
    if cs <= 0.5 {
        cb - (1.0 - 2.0 * cs) * cb * (1.0 - cb)
    } else {
        let d = if cb <= 0.25 {
            ((16.0 * cb - 12.0) * cb + 4.0) * cb
        } else {
            cb.sqrt()
        };
        cb + (2.0 * cs - 1.0) * (d - cb)
    }
}

// Apply the blend function, returning straight-color result B(Cb,Cs) for the
// given mode (handles separable + non-separable).
#[inline]
// Public: mix backdrop `cb` with source `cs` per blend mode (no alpha) —
// used by adjustment layers, which blend their result over the backdrop.
pub fn blend_rgb_pub(mode: BlendMode, cb: [f32; 3], cs: [f32; 3]) -> [f32; 3] {
    blend_rgb(mode, cb, cs)
}

fn blend_rgb(mode: BlendMode, cb: [f32; 3], cs: [f32; 3]) -> [f32; 3] {
    if mode.is_nonseparable() {
        match mode {
            BlendMode::Hue => nonsep_hue(cb, cs),
            BlendMode::Saturation => nonsep_saturation(cb, cs),
            BlendMode::Color => nonsep_color(cb, cs),
            BlendMode::Luminosity => nonsep_luminosity(cb, cs),
            BlendMode::DarkerColor => {
                if cb[0] + cb[1] + cb[2] <= cs[0] + cs[1] + cs[2] {
                    cb
                } else {
                    cs
                }
            }
            BlendMode::LighterColor => {
                if cb[0] + cb[1] + cb[2] >= cs[0] + cs[1] + cs[2] {
                    cb
                } else {
                    cs
                }
            }
            _ => cs,
        }
    } else {
        [
            blend_channel(mode, cb[0], cs[0]),
            blend_channel(mode, cb[1], cs[1]),
            blend_channel(mode, cb[2], cs[2]),
        ]
    }
}

// Composite source `s` over backdrop `b` using `mode`. Both straight-alpha.
// Returns the straight-alpha result. `extra` multiplies source alpha
// (layer opacity, mask, selection, clip coverage, …).
#[inline]
pub fn composite_over(b: Rgba, s: Rgba, mode: BlendMode, extra: f32) -> Rgba {
    let alpha_s = (s.a * extra).clamp(0.0, 1.0);
    if alpha_s <= 0.0 {
        return b;
    }
    let alpha_b = b.a;
    let cb = [b.r, b.g, b.b];
    let cs = [s.r, s.g, s.b];

    // Blended source color, mixed with raw source by backdrop alpha:
    // Cs' = (1 - αb) * Cs + αb * B(Cb, Cs)
    let blended = blend_rgb(mode, cb, cs);
    let mut cs_eff = [0.0f32; 3];
    for i in 0..3 {
        cs_eff[i] = (1.0 - alpha_b) * cs[i] + alpha_b * blended[i];
    }

    // Source-over with premultiplied math, then un-premultiply.
    let ao = alpha_s + alpha_b * (1.0 - alpha_s);
    if ao <= 0.0 {
        return Rgba::new(0.0, 0.0, 0.0, 0.0);
    }
    let mut out = Rgba::new(0.0, 0.0, 0.0, ao);
    // co = αs*Cs' + αb*(1-αs)*Cb   (premultiplied)
    out.r = (alpha_s * cs_eff[0] + alpha_b * (1.0 - alpha_s) * cb[0]) / ao;
    out.g = (alpha_s * cs_eff[1] + alpha_b * (1.0 - alpha_s) * cb[1]) / ao;
    out.b = (alpha_s * cs_eff[2] + alpha_b * (1.0 - alpha_s) * cb[2]) / ao;
    out
}

const BLEND_GAMMA_STEPS: usize = 65535;

/// Color Settings ▸ Advanced ▸ Blend RGB / Text Colors Using Gamma: layers
/// blend in a space of gamma `g` instead of the document's own encoding, then
/// the result is re-encoded. The document is taken as gamma 2.2, so a value
/// `v` blends as `v^(2.2/g)`: 1.0 is linear light, 2.2 the document space.
/// Both directions are 16-bit tables, interpolated, so the compositor never
/// calls `powf` per pixel. They are indexed by the square root of the value,
/// which spreads the steep end of either curve over enough entries to keep
/// every 16-bit shadow value exact through a decode → encode round trip.
/// ponytail: gamma 2.2 stands in for the profile's real tone curve (sRGB's
/// piecewise curve stays within 1% of it); decode through the document
/// profile's TRC if a closer match is ever needed.
pub struct BlendGamma {
    gamma: f32,
    decode: Vec<f32>,
    encode: Vec<f32>,
}

impl BlendGamma {
    pub fn new(gamma: f32) -> Self {
        let exponent = 2.2 / gamma;
        let table = |e: f32| -> Vec<f32> {
            (0..=BLEND_GAMMA_STEPS)
                .map(|i| (i as f32 / BLEND_GAMMA_STEPS as f32).powf(2.0 * e))
                .collect()
        };
        BlendGamma { gamma, decode: table(exponent), encode: table(1.0 / exponent) }
    }

    pub fn gamma(&self) -> f32 {
        self.gamma
    }

    #[inline]
    fn lookup(table: &[f32], v: f32) -> f32 {
        let p = v.clamp(0.0, 1.0).sqrt() * BLEND_GAMMA_STEPS as f32;
        let i = (p as usize).min(BLEND_GAMMA_STEPS - 1);
        table[i] + (table[i + 1] - table[i]) * (p - i as f32)
    }

    /// Document value → blend space. Alpha is coverage, never re-encoded.
    #[inline]
    pub fn decode(&self, c: Rgba) -> Rgba {
        let t = &self.decode;
        Rgba::new(Self::lookup(t, c.r), Self::lookup(t, c.g), Self::lookup(t, c.b), c.a)
    }

    /// Blend space → document value.
    #[inline]
    pub fn encode(&self, c: Rgba) -> Rgba {
        let t = &self.encode;
        Rgba::new(Self::lookup(t, c.r), Self::lookup(t, c.g), Self::lookup(t, c.b), c.a)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn blend_gamma_one_is_linear_light_and_round_trips() {
        let linear = BlendGamma::new(1.0);
        let mid = linear.decode(Rgba::new(0.5, 0.0, 1.0, 0.25));
        assert!((mid.r - 0.5f32.powf(2.2)).abs() < 1e-6, "{}", mid.r);
        assert_eq!((mid.g, mid.b, mid.a), (0.0, 1.0, 0.25));
        // 2.2 is the document space itself.
        let doc = BlendGamma::new(2.2).decode(Rgba::new(0.3, 0.6, 0.9, 1.0));
        assert!((doc.r - 0.3).abs() < 1e-6 && (doc.g - 0.6).abs() < 1e-6 && (doc.b - 0.9).abs() < 1e-6);
        // Every 16-bit value survives decode → encode, shadows included.
        for gamma in [1.0, 1.45, 3.0] {
            let g = BlendGamma::new(gamma);
            for v in 0..=65535u32 {
                let v = v as f32 / 65535.0;
                let back = g.encode(g.decode(Rgba::new(v, v, v, 1.0))).r;
                assert!((back - v).abs() * 65535.0 < 0.5, "gamma {gamma}: {v} → {back}");
            }
        }
    }

    #[test]
    fn darker_lighter_color_index_roundtrip() {
        assert_eq!(BlendMode::from_u8(26), BlendMode::DarkerColor);
        assert_eq!(BlendMode::from_u8(27), BlendMode::LighterColor);
        assert_eq!(BlendMode::DarkerColor.to_u8(), 26);
        assert_eq!(BlendMode::LighterColor.to_u8(), 27);
        assert!(BlendMode::DarkerColor.is_nonseparable());
        assert!(BlendMode::LighterColor.is_nonseparable());
    }

    #[test]
    fn darker_color_keeps_lower_sum_whole_pixel() {
        let cb = [0.2, 0.8, 0.2]; // sum 1.2
        let cs = [0.5, 0.1, 0.1]; // sum 0.7 → the darker whole pixel
        assert_eq!(blend_rgb_pub(BlendMode::DarkerColor, cb, cs), cs);
        assert_eq!(blend_rgb_pub(BlendMode::DarkerColor, cs, cb), cs);
    }

    #[test]
    fn lighter_color_keeps_higher_sum_whole_pixel() {
        let cb = [0.2, 0.8, 0.2]; // sum 1.2 → the lighter whole pixel
        let cs = [0.5, 0.1, 0.1]; // sum 0.7
        assert_eq!(blend_rgb_pub(BlendMode::LighterColor, cb, cs), cb);
        assert_eq!(blend_rgb_pub(BlendMode::LighterColor, cs, cb), cb);
    }

    #[test]
    fn dodge_and_burn_keep_the_spec_backdrop_corners() {
        // (#38) W3C: color-dodge(0, 1) = 0 and color-burn(1, 0) = 1 — the
        // backdrop corner wins over the source corner.
        let black = [0.0, 0.0, 0.0];
        let white = [1.0, 1.0, 1.0];
        assert_eq!(blend_rgb_pub(BlendMode::ColorDodge, black, white), black);
        assert_eq!(blend_rgb_pub(BlendMode::ColorBurn, white, black), white);
        // Vivid Light inherits both halves (source doubled: cs=1 → dodge d=1,
        // cs=0 → burn d=0), and Hard Mix thresholds Vivid Light.
        assert_eq!(blend_rgb_pub(BlendMode::VividLight, black, white), black);
        assert_eq!(blend_rgb_pub(BlendMode::VividLight, white, black), white);
        assert_eq!(blend_rgb_pub(BlendMode::HardMix, black, white), black);
        assert_eq!(blend_rgb_pub(BlendMode::HardMix, white, black), white);
        // The non-corner behaviour is unchanged.
        let mid = blend_rgb_pub(BlendMode::ColorDodge, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
        assert!((mid[0] - 1.0).abs() < 1e-6);
        let burn = blend_rgb_pub(BlendMode::ColorBurn, [0.5, 0.5, 0.5], [0.5, 0.5, 0.5]);
        assert!(burn[0].abs() < 1e-6);
    }

    #[test]
    fn every_blend_mode_executes_with_edge_channel_values() {
        let modes = [
            BlendMode::Normal,
            BlendMode::Dissolve,
            BlendMode::Darken,
            BlendMode::Multiply,
            BlendMode::ColorBurn,
            BlendMode::LinearBurn,
            BlendMode::Lighten,
            BlendMode::Screen,
            BlendMode::ColorDodge,
            BlendMode::LinearDodge,
            BlendMode::Overlay,
            BlendMode::SoftLight,
            BlendMode::HardLight,
            BlendMode::VividLight,
            BlendMode::LinearLight,
            BlendMode::PinLight,
            BlendMode::HardMix,
            BlendMode::Difference,
            BlendMode::Exclusion,
            BlendMode::Subtract,
            BlendMode::Divide,
            BlendMode::Hue,
            BlendMode::Saturation,
            BlendMode::Color,
            BlendMode::Luminosity,
            BlendMode::PassThrough,
            BlendMode::DarkerColor,
            BlendMode::LighterColor,
        ];
        let cases = [
            ([0.0, 0.25, 1.0], [0.0, 0.5, 1.0]),
            ([0.2, 0.6, 0.9], [0.1, 0.75, 0.4]),
            ([1.0, 0.0, 0.5], [1.0, 0.0, 0.5]),
        ];

        for mode in modes {
            assert_eq!(BlendMode::from_u8(mode.to_u8()), mode);
            for (backdrop, source) in cases {
                let out = blend_rgb_pub(mode, backdrop, source);
                for channel in out {
                    assert!(
                        channel.is_finite() && (-0.001..=1.001).contains(&channel),
                        "{mode:?} produced out-of-range channel {channel}"
                    );
                }
            }
        }
        assert_eq!(BlendMode::from_u8(200), BlendMode::Normal);
    }

    #[test]
    fn composite_over_covers_transparent_backdrop_and_opacity_paths() {
        let backdrop = Rgba::new(0.2, 0.3, 0.4, 0.6);
        let source = Rgba::new(0.9, 0.1, 0.2, 0.5);
        let no_op = composite_over(backdrop, source, BlendMode::Multiply, 0.0);
        assert!((no_op.r - backdrop.r).abs() < 1e-6);
        assert!((no_op.g - backdrop.g).abs() < 1e-6);
        assert!((no_op.b - backdrop.b).abs() < 1e-6);
        assert!((no_op.a - backdrop.a).abs() < 1e-6);

        let over_transparent = composite_over(
            Rgba::new(0.0, 0.0, 0.0, 0.0),
            source,
            BlendMode::Screen,
            1.0,
        );
        assert!((over_transparent.r - source.r).abs() < 1e-6);
        assert!((over_transparent.g - source.g).abs() < 1e-6);
        assert!((over_transparent.b - source.b).abs() < 1e-6);
        assert!((over_transparent.a - source.a).abs() < 1e-6);

        let mixed = composite_over(backdrop, source, BlendMode::Overlay, 0.4);
        assert!(mixed.a > backdrop.a);
        assert!(mixed.r.is_finite() && mixed.g.is_finite() && mixed.b.is_finite());
    }
}
