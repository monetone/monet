//! Published calibration polynomials resolved into half-diagonal coordinates.
//! These equations are implemented here independently of Lensfun's code.
use super::*;

#[derive(Clone, Copy)]
pub(super) struct Correction {
    distortion_amount: f32,
    vignette_amount: f32,
    distortion: [f32; 4],
    red: [f32; 3],
    blue: [f32; 3],
    vignette: [f32; 3],
}

impl Correction {
    pub(super) fn parse(p: &[f32]) -> Option<Self> {
        if p.len() != 15 || !p.iter().all(|v| v.is_finite())
            || p[..2].iter().any(|v| !(0.0..=2.0).contains(v))
            || p[2..].iter().any(|v| v.abs() > 1000.0) { return None; }
        let c = Self { distortion_amount: p[0], vignette_amount: p[1],
            distortion: p[2..6].try_into().ok()?, red: p[6..9].try_into().ok()?,
            blue: p[9..12].try_into().ok()?, vignette: p[12..15].try_into().ok()? };
        // The attenuation polynomial must stay positive on the input image.
        // Its extrema are the roots of a quadratic in radius squared.
        let [a, b, c3] = c.vignette.map(f64::from);
        let attenuation = |x: f64| 1.0 + x * (a + x * (b + x * c3));
        let mut radii = vec![0.0, 1.0];
        if c3.abs() > 1e-12 {
            let discriminant = 4.0 * b * b - 12.0 * c3 * a;
            if discriminant >= 0.0 {
                radii.extend([(-2.0 * b + discriminant.sqrt()) / (6.0 * c3), (-2.0 * b - discriminant.sqrt()) / (6.0 * c3)]);
            }
        } else if b.abs() > 1e-12 { radii.push(-a / (2.0 * b)); }
        if radii.into_iter().filter(|r| (0.0..=1.0).contains(r)).any(|r| attenuation(r) <= 1e-6) { return None; }
        Some(c)
    }

    pub(super) fn identity(&self) -> bool {
        (self.distortion_amount == 0.0 || self.distortion == [0.0; 4])
            && self.red == [1.0, 0.0, 0.0] && self.blue == [1.0, 0.0, 0.0]
            && (self.vignette_amount == 0.0 || self.vignette == [0.0; 3])
    }

    fn geometry(&self, radius: f32) -> f32 {
        let [a, b, c, d] = self.distortion;
        1.0 + self.distortion_amount * radius * (a + radius * (b + radius * (c + radius * d)))
    }

    fn correct(&self, px: &mut [u16], w: u32, h: u32, profile: u8) {
        if self.identity() { return; }
        let (cx, cy) = ((w as f32 - 1.0) * 0.5, (h as f32 - 1.0) * 0.5);
        let radius = (w as f32).hypot(h as f32) * 0.5;
        let mut source = px.to_vec();
        // Vignetting is a gain in input linear light, before any resampling.
        if self.vignette_amount != 0.0 && self.vignette != [0.0; 3] {
            for (i, pixel) in source.chunks_exact_mut(4).enumerate() {
                let q2 = ((i as u32 % w) as f32 - cx).hypot((i as u32 / w) as f32 - cy).powi(2) / radius.powi(2);
                let [a, b, c] = self.vignette;
                let attenuation = 1.0 + q2 * (a + q2 * (b + q2 * c));
                let gain = (1.0 + self.vignette_amount * (1.0 / attenuation - 1.0)).max(0.0);
                for channel in &mut pixel[..3] {
                    *channel = color::to16(encode_profile(profile, decode_profile(profile, *channel as f32 / 65535.0) * gain));
                }
            }
        }
        let sample = |x: f32, y: f32| -> Rgba {
            if !x.is_finite() || !y.is_finite() || x < -1.0 || y < -1.0 || x > w as f32 || y > h as f32 { return Rgba::new(0.0, 0.0, 0.0, 0.0); }
            let (x0, y0) = (x.floor() as i32, y.floor() as i32);
            let at = |x: i32, y: i32| if x >= 0 && y >= 0 && x < w as i32 && y < h as i32 {
                let i = (y as usize * w as usize + x as usize) * 4;
                Rgba::from_u16(&source[i..i + 4])
            } else { Rgba::new(0.0, 0.0, 0.0, 0.0) };
            lerp_premul(lerp_premul(at(x0, y0), at(x0 + 1, y0), x - x0 as f32),
                lerp_premul(at(x0, y0 + 1), at(x0 + 1, y0 + 1), x - x0 as f32), y - y0 as f32)
        };
        for (i, pixel) in px.chunks_exact_mut(4).enumerate() {
            let (dx, dy) = ((i as u32 % w) as f32 - cx, (i as u32 / w) as f32 - cy);
            let q = dx.hypot(dy) / radius;
            let factor = self.geometry(q);
            let base = sample(cx + dx * factor, cy + dy * factor);
            let distorted_radius = q * factor.abs();
            let channel = |[v, c, b]: [f32; 3]| {
                let f = factor * (v + distorted_radius * (c + distorted_radius * b));
                sample(cx + dx * f, cy + dy * f)
            };
            let r = if self.red == [1.0, 0.0, 0.0] { base.r } else { channel(self.red).r };
            let b = if self.blue == [1.0, 0.0, 0.0] { base.b } else { channel(self.blue).b };
            Rgba::new(r, base.g, b, base.a).to_u16(pixel);
        }
    }
}

pub(super) fn filter_params(p: &[f32]) -> Option<([f32; 6], Correction)> {
    if p.len() != 21 || !p[..6].iter().all(|v| v.is_finite()) { return None; }
    let manual: [f32; 6] = p[..6].try_into().ok()?;
    if !(-0.5..=0.5).contains(&manual[0]) || !(-1.0..=1.0).contains(&manual[1])
        || manual[2..4].iter().any(|v| !(-0.1..=0.1).contains(v))
        || !(0.5..=2.0).contains(&manual[4]) || !(0.0..=0.95).contains(&manual[5]) { return None; }
    Some((manual, Correction::parse(&p[6..])?))
}

pub(super) fn apply(px: &mut [u16], w: u32, h: u32, sel: &Selection, profile: u8, correction: Correction, manual: [f32; 6]) {
    if w == 0 || h == 0 { return; }
    let mut corrected = px.to_vec();
    correction.correct(&mut corrected, w, h, profile);
    let full = Selection::new(w, h);
    let [distortion, vignette, red, blue, scale, midpoint] = manual;
    if distortion != 0.0 || vignette != 0.0 || red != 0.0 || blue != 0.0 || scale != 1.0 {
        filters::lens_correction_ca(&mut corrected, w, h, &full, distortion, vignette, red, blue, scale, midpoint);
    }
    filters::blend_back(px, &corrected, sel);
}

/// Read V8's bounded lens authoring state, retaining it in the original params
/// even when disabled or unresolved. Only a resolved, enabled snapshot renders.
pub(super) fn read_tail(p: &[f32], mut cursor: usize) -> Option<(Option<Correction>, usize)> {
    let head = p.get(cursor..cursor + 6)?;
    if ![0.0, 1.0].contains(&head[0]) || head[1..3].iter().any(|v| !(0.0..=2.0).contains(v))
        || head[3..].iter().any(|v| !(0.0..=1_000_000.0).contains(v)) { return None; }
    cursor += 6;
    let text = |cursor: &mut usize, max: usize, digest: bool| -> Option<()> {
        let n = *p.get(*cursor)?;
        if n < 0.0 || n > max as f32 || n.fract() != 0.0 { return None; }
        *cursor += 1;
        let chars = p.get(*cursor..*cursor + n as usize)?;
        if chars.iter().any(|c| *c < 0.0 || *c > 65535.0 || c.fract() != 0.0
            || (digest && (*c > 127.0 || !(*c as u8).is_ascii_hexdigit()))) || (digest && n != 0.0 && n != 32.0) { return None; }
        *cursor += n as usize;
        Some(())
    };
    text(&mut cursor, 32, true)?;
    text(&mut cursor, 512, false)?;
    let present = *p.get(cursor)?; cursor += 1;
    if ![0.0, 1.0].contains(&present) { return None; }
    let correction = if present == 1.0 {
        if *p.get(cursor)? != 32.0 { return None; }
        text(&mut cursor, 32, true)?;
        let coefficients = p.get(cursor..cursor + 13)?;
        cursor += 13;
        let mut words = vec![head[1], head[2]]; words.extend_from_slice(coefficients);
        let parsed = Correction::parse(&words)?;
        (head[0] == 1.0).then_some(parsed)
    } else { None };
    Some((correction, cursor))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity() -> Correction { Correction::parse(&[1.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 0.0]).unwrap() }

    #[test]
    fn calibrated_geometry_and_tca_use_the_documented_radii() {
        let mut c = identity();
        c.distortion = [0.2, -0.1, 0.05, 0.03]; c.distortion_amount = 1.2;
        assert!((c.geometry(0.5) - 1.09975).abs() < 1e-6);
        c.distortion = [0.0, 0.2, 0.0, 0.0]; c.distortion_amount = 1.0;
        c.red = [1.0, 0.3, 0.0]; c.blue = [1.0, -0.2, 0.0];
        let mut pixels: Vec<u16> = (0..45).flat_map(|i| [(i % 9) * 5000; 3].into_iter().chain([65535])).collect();
        c.correct(&mut pixels, 9, 5, PROFILE_SRGB);
        // At output (6,2), delta=(2,0), half-diagonal=sqrt(106)/2.
        // Geometry maps radius first; lateral CA uses THAT distorted radius.
        let q = 4.0f32 / 106.0f32.sqrt();
        let factor = 1.0 + 0.2 * q * q;
        let expected = [1.0 + 0.3 * q * factor, 1.0, 1.0 - 0.2 * q * factor]
            .map(|ca| ((4.0 + 2.0 * factor * ca) * 5000.0).round() as u16);
        for k in 0..3 { assert!(pixels[(2 * 9 + 6) * 4 + k].abs_diff(expected[k]) <= 1); }
    }

    #[test]
    fn calibrated_vignette_is_linear_input_gain_and_identity_preserves_alpha() {
        let mut pixels = [26214u16, 26214, 26214, 32768].repeat(25);
        let original = pixels.clone();
        identity().correct(&mut pixels, 5, 5, PROFILE_SRGB);
        assert_eq!(pixels, original);
        let mut c = identity(); c.vignette = [-0.4, 0.1, 0.0];
        c.correct(&mut pixels, 5, 5, PROFILE_SRGB);
        // Corner q=.8, attenuation=1-.4*.64+.1*.4096=.78496.
        let expected = color::to16(encode_profile(PROFILE_SRGB, decode_profile(PROFILE_SRGB, 0.4) / 0.78496));
        assert!(pixels[0].abs_diff(expected) <= 1);
        assert_eq!(pixels[3], original[3]);
        assert_eq!(&pixels[12 * 4..12 * 4 + 4], &original[12 * 4..12 * 4 + 4]);
        c.vignette_amount = 0.0;
        let mut zero = original.clone(); c.correct(&mut zero, 5, 5, PROFILE_SRGB); assert_eq!(zero, original);
        let mut invalid = [1.0,1.0,0.0,0.0,0.0,0.0,1.0,0.0,0.0,1.0,0.0,0.0,-2.0,0.0,0.0];
        assert!(Correction::parse(&invalid).is_none());
        invalid[12] = f32::NAN; assert!(Correction::parse(&invalid).is_none());
    }

    #[test]
    fn calibrated_sampling_does_not_pull_color_from_transparent_pixels() {
        let mut c = identity(); c.distortion[0] = 17.0f32.sqrt();
        let mut pixels = vec![65535,0,0,0, 0,65535,0,65535, 0,65535,0,65535, 0,65535,0,65535];
        c.correct(&mut pixels, 4, 1, PROFILE_SRGB);
        // Pixel 1 samples x=.5: half transparent red, half opaque green.
        assert_eq!(&pixels[4..7], &[0,65535,0]);
        assert!(pixels[7].abs_diff(32768) <= 1);
    }

    #[test]
    fn calibrated_and_manual_corrections_share_one_selection_blend_undo_and_replay() {
        let pixels: Vec<u16> = (0..81).flat_map(|i| [(i % 9) * 7000, (i / 9) * 7000, 14000, 65535]).collect();
        let params = [0.1,0.2,0.01,-0.02,1.1,0.25, 1.0,1.0, 0.0,0.08,0.0,0.0, 1.001,0.0,0.0, 0.999,0.0,0.0, -0.2,0.0,0.0];
        let mut full = Engine::with_initial_pixels(9, 9, pixels.clone(), 16).unwrap();
        full.filter_lens_profile(&params);
        let result = full.export_composite_rgba16();
        assert_ne!(result, pixels);
        full.undo(); assert_eq!(full.export_composite_rgba16(), pixels);
        let mut partial = Engine::with_initial_pixels(9, 9, pixels.clone(), 16).unwrap();
        partial.set_selection_mask(&vec![128; 81]); partial.filter_lens_profile(&params);
        let masked = partial.export_composite_rgba16();
        for i in 0..masked.len() {
            let expected = (pixels[i] as f32 + (result[i] as f32 - pixels[i] as f32) * (128.0 / 255.0)).round() as u16;
            assert!(masked[i].abs_diff(expected) <= 1, "sample {i}");
        }
        full.convert_to_smart_object(full.active_layer_id());
        let layer = full.active_layer_id(); full.smart_add_filter(layer, 118, &params);
        assert_eq!(full.export_composite_rgba16(), result);
        let mut loaded = Engine::load_project(&full.save_project()).unwrap();
        let id = loaded.active_layer_id(); loaded.set_smart_filters_enabled(id, false); loaded.set_smart_filters_enabled(id, true);
        assert_eq!(loaded.export_composite_rgba16(), result);
        let history = loaded.undo_pushes(); loaded.smart_add_filter(id, 118, &[f32::NAN]);
        assert_eq!(loaded.undo_pushes(), history);
        assert!(loaded.last_edit_error().contains("invalid calibration"));
    }
}
