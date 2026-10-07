#[cfg(feature = "color-management")]
mod enabled {
    use moxcms::{
        ColorProfile, DataColorSpace, Layout, ProfileClass, RenderingIntent, ToneReprCurve,
        Transform16BitExecutor, TransformOptions, Xyzd,
    };
    use std::sync::Arc;

    const MAX_ICC_PROFILE_BYTES: usize = 10 * 1024 * 1024;

    pub(crate) struct Rgba16Transform {
        inner: Arc<Transform16BitExecutor>,
        /// Black-Point Compensation: the destination black as the chosen
        /// intent's own tables reproduce it, which the source is lifted onto
        /// first. None without BPC, or when that black is a true zero (every
        /// built-in matrix RGB profile, and a perceptual table that already
        /// maps black onto the press black) — BPC is then the identity.
        lift: Option<BlackPoint>,
        /// Set when the destination is a CMYK, Gray or Lab profile.
        separation: Option<Separation>,
    }

    /// The way back out of a CMYK / Gray / Lab destination. The document keeps
    /// RGB pixels in its source space and reads its plates out of them on
    /// demand, so a separation stores what the device values reproduce:
    /// relative colorimetric, with the device black shown as black (the
    /// black-point mapping Photoshop's display applies to a CMYK document).
    /// `recombine` is that encoding; a transform built relative colorimetric
    /// with BPC (the engine's `ModeProfile`) `separate`s it back exactly, so
    /// the plates read back are the values the conversion produced.
    struct Separation {
        /// Document mode the separation lands in: 1 Gray, 2 CMYK, 3 Lab.
        mode: u8,
        /// Samples per pixel in the device layout: Gray rides GrayAlpha, and
        /// CMYK / Lab ride the four Rgba lanes (C,M,Y,K · L,a,b,alpha).
        lanes: usize,
        back: Arc<Transform16BitExecutor>,
        /// The device black, relative colorimetric, shown as black. Always
        /// the relative colorimetric one, whatever the conversion's intent,
        /// so every document separated through this profile stores the same
        /// encoding.
        display: Option<BlackPoint>,
    }

    /// Normalized destination-black luminance (of 65535) treated as the
    /// source's own black: under half an 8-bit level of sRGB shadow lift.
    const BLACK_POINT_TOLERANCE: u16 = 8;

    /// Black-Point Compensation in linear light. Adobe's BPC (as LittleCMS
    /// runs it) maps the source black onto the destination black with an
    /// affine scale per XYZ component. In the source's normalized XYZ — X/Xw,
    /// Y/Yw, Z/Zw as a linear matrix/TRC profile — that is a per-channel lift
    /// that leaves midtones and saturation where they were, and every real
    /// colour lies inside [0, 1]³ there, so the u16 legs never clip.
    #[derive(Clone)]
    struct BlackPoint {
        to_xyz: Arc<Transform16BitExecutor>,
        from_xyz: Arc<Transform16BitExecutor>,
        /// The destination black's normalized luminance, 0..1. Neutral, the
        /// way LittleCMS detects a black point (a* = b* = 0): a tinted press
        /// black would otherwise tint every shadow it lifts.
        y: f32,
    }

    impl BlackPoint {
        /// `black` is the destination's black expressed in the source space.
        /// None when it is a true zero (BPC is then the identity), or when the
        /// source cannot be linearized — BPC degrades to a no-op rather than
        /// failing an otherwise valid conversion.
        fn new(source: &ColorProfile, black: [u16; 3]) -> Option<Self> {
            if black == [0; 3] {
                return None;
            }
            // Normalize by the source's own white so it maps to exactly 1; a
            // LUT-based source has no colorants and its PCS white stands in.
            let m = source.rgb_to_xyz_matrix().v;
            let row = |r: usize| m[r][0] + m[r][1] + m[r][2];
            let white = if row(1) > 0.0 {
                Xyzd { x: row(0), y: row(1), z: row(2) }
            } else {
                source.white_point
            };
            let mut xyz = ColorProfile::new_srgb();
            xyz.cicp = None; // otherwise moxcms takes the CICP transfer and ignores the TRC
            xyz.red_colorant = Xyzd { x: white.x, y: 0.0, z: 0.0 };
            xyz.green_colorant = Xyzd { x: 0.0, y: white.y, z: 0.0 };
            xyz.blue_colorant = Xyzd { x: 0.0, y: 0.0, z: white.z };
            let linear = ToneReprCurve::Lut(Vec::new());
            xyz.red_trc = Some(linear.clone());
            xyz.green_trc = Some(linear.clone());
            xyz.blue_trc = Some(linear);
            let options = TransformOptions {
                rendering_intent: RenderingIntent::RelativeColorimetric,
                // moxcms 0.8.1's fixed-point SIMD matrix path overflows on the
                // XYZ→RGB inverse (white comes back with R = 0 on NEON).
                prefer_fixed_point: false,
                ..TransformOptions::default()
            };
            let to_xyz = source
                .create_transform_16bit(Layout::Rgba, &xyz, Layout::Rgba, options)
                .ok()?;
            let from_xyz = xyz
                .create_transform_16bit(Layout::Rgba, source, Layout::Rgba, options)
                .ok()?;
            let mut point = [0u16; 4];
            to_xyz
                .transform(&[black[0], black[1], black[2], 65535], &mut point)
                .ok()?;
            // Black points that already match are left alone, as LittleCMS
            // leaves them. A destination black this close to zero is the 16-bit
            // round trip's own noise (Apple's sRGB and display profiles come
            // back a step or two above zero), and lifting by it would only add
            // the XYZ legs' rounding: a level of 8-bit shadow detail.
            if point[1] <= BLACK_POINT_TOLERANCE {
                return None;
            }
            Some(Self {
                to_xyz,
                from_xyz,
                y: point[1] as f32 / 65535.0,
            })
        }

        /// Map [0, white] onto [black, white]: source black lands on the
        /// destination's black instead of clipping into it, so shadow
        /// gradation survives. White is held fixed.
        fn lift(&self, pixels: &mut [u16]) -> Result<(), String> {
            self.map(pixels, |v, k| k + v * (1.0 - k))
        }

        /// The inverse of `lift`: [black, white] back onto [0, white].
        fn unlift(&self, pixels: &mut [u16]) -> Result<(), String> {
            self.map(pixels, |v, k| (v - k) / (1.0 - k).max(1e-6))
        }

        fn map(&self, pixels: &mut [u16], f: impl Fn(f32, f32) -> f32) -> Result<(), String> {
            let mut xyz = vec![0u16; pixels.len()];
            self.to_xyz
                .transform(pixels, &mut xyz)
                .map_err(|error| format!("ICC black point failed: {error}"))?;
            for px in xyz.chunks_exact_mut(4) {
                for c in 0..3 {
                    let v = f(px[c] as f32 / 65535.0, self.y);
                    px[c] = (v * 65535.0).round().clamp(0.0, 65535.0) as u16;
                }
            }
            self.from_xyz
                .transform(&xyz, pixels)
                .map_err(|error| format!("ICC black point failed: {error}"))
        }
    }

    impl Rgba16Transform {
        pub(crate) fn new(
            source_profile: u8,
            source_icc: &[u8],
            destination_profile: u8,
            destination_icc: &[u8],
            intent: u8,
            black_point_compensation: bool,
        ) -> Result<Self, String> {
            let source = profile(source_profile, source_icc, "Source", &[DataColorSpace::Rgb])?;
            let destination = profile(
                destination_profile,
                destination_icc,
                "Destination",
                &[
                    DataColorSpace::Rgb,
                    DataColorSpace::Cmyk,
                    DataColorSpace::Gray,
                    DataColorSpace::Lab,
                ],
            )?;
            let options = TransformOptions {
                rendering_intent: rendering_intent(intent)?,
                ..TransformOptions::default()
            };
            let mode = match destination.color_space {
                DataColorSpace::Gray => 1,
                DataColorSpace::Cmyk => 2,
                DataColorSpace::Lab => 3,
                _ => 0,
            };
            let unsupported = |error: moxcms::CmsError| format!("ICC transform is unsupported: {error}");
            // moxcms 0.8.1's Cmyka interceptors are broken upstream (see
            // ProofTransform), so CMYK rides the four Rgba lanes, no alpha.
            let (device_layout, lanes) = if mode == 1 {
                (Layout::GrayAlpha, 2)
            } else {
                (Layout::Rgba, 4)
            };
            let inner = source
                .create_transform_16bit(Layout::Rgba, &destination, device_layout, options)
                .map_err(unsupported)?;
            // Source black through `forward`, then back into the source space.
            let black_through = |forward: &Transform16BitExecutor, back: &Transform16BitExecutor| {
                let mut device = vec![0u16; lanes];
                let mut doc = [0u16; 4];
                forward.transform(&[0, 0, 0, 65535], &mut device).ok()?;
                back.transform(&device, &mut doc).ok()?;
                Some([doc[0], doc[1], doc[2]])
            };
            // Adobe's BPC detects the destination black through the chosen
            // intent's own tables (cmsDetectBlackPoint is per intent): a
            // perceptual table that already maps black onto the press black
            // leaves nothing to compensate. `None` when the destination has no
            // inverse leg for that intent — BPC then degrades to a no-op rather
            // than failing an otherwise valid conversion.
            let lift = if black_point_compensation {
                destination
                    .create_transform_16bit(device_layout, &source, Layout::Rgba, options)
                    .ok()
                    .and_then(|back| black_through(inner.as_ref(), back.as_ref()))
                    .and_then(|black| BlackPoint::new(&source, black))
            } else {
                None
            };
            if mode == 0 {
                return Ok(Self {
                    inner,
                    lift,
                    separation: None,
                });
            }
            let relative = TransformOptions {
                rendering_intent: RenderingIntent::RelativeColorimetric,
                ..TransformOptions::default()
            };
            let back = destination
                .create_transform_16bit(device_layout, &source, Layout::Rgba, relative)
                .map_err(unsupported)?;
            let relative_forward = if options.rendering_intent == RenderingIntent::RelativeColorimetric {
                inner.clone()
            } else {
                source
                    .create_transform_16bit(Layout::Rgba, &destination, device_layout, relative)
                    .map_err(unsupported)?
            };
            let black = black_through(relative_forward.as_ref(), back.as_ref())
                .ok_or_else(|| "ICC black point failed".to_string())?;
            Ok(Self {
                inner,
                lift,
                separation: Some(Separation {
                    mode,
                    lanes,
                    back,
                    display: BlackPoint::new(&source, black),
                }),
            })
        }

        /// The document mode this conversion lands in: 0 for an RGB
        /// destination, else the separation's Gray (1), CMYK (2) or Lab (3).
        pub(crate) fn mode(&self) -> u8 {
            self.separation.as_ref().map_or(0, |s| s.mode)
        }

        /// Convert RGBA pixels in place. A CMYK / Gray / Lab destination
        /// separates and comes back into the source space (see `Separation`),
        /// so the pixels end up holding what the device values reproduce.
        pub(crate) fn apply(&self, pixels: &mut [u16]) -> Result<(), String> {
            if pixels.len() % 4 != 0 {
                return Err("ICC transform requires RGBA pixels".into());
            }
            let Some(separation) = &self.separation else {
                let converted = self.to_device(pixels, 4)?;
                pixels.copy_from_slice(&converted);
                return Ok(());
            };
            // The CMYK leg spends the alpha lane on K, so alpha is carried over.
            let alpha: Vec<u16> = pixels.iter().skip(3).step_by(4).copied().collect();
            let device = self.to_device(pixels, separation.lanes)?;
            separation
                .back
                .transform(&device, pixels)
                .map_err(|error| format!("ICC transform failed: {error}"))?;
            if let Some(black) = &separation.display {
                black.unlift(pixels)?;
            }
            for (px, a) in pixels.chunks_exact_mut(4).zip(alpha) {
                px[3] = a;
            }
            Ok(())
        }

        /// A separation's plates for RGBA pixels, four lanes per pixel in the
        /// Channels-panel order and encoding: Gray · C,M,Y,K · L,a,b (Lab as
        /// L/100, (a+128)/255, (b+128)/255). Unused lanes are 0.
        pub(crate) fn separate(&self, rgba: &[u16]) -> Result<Vec<u16>, String> {
            let Some(separation) = &self.separation else {
                return Err("ICC transform is not a separation".into());
            };
            if rgba.len() % 4 != 0 {
                return Err("ICC transform requires RGBA pixels".into());
            }
            let mut source = rgba.to_vec();
            let device = self.to_device(&mut source, separation.lanes)?;
            Ok(match separation.mode {
                1 => device.chunks_exact(2).flat_map(|g| [g[0], 0, 0, 0]).collect(),
                3 => device.chunks_exact(4).flat_map(|l| [l[0], l[1], l[2], 0]).collect(),
                _ => device,
            })
        }

        /// The inverse of `separate`: plates back to opaque RGBA pixels.
        pub(crate) fn recombine(&self, plates: &[u16]) -> Result<Vec<u16>, String> {
            let Some(separation) = &self.separation else {
                return Err("ICC transform is not a separation".into());
            };
            if plates.len() % 4 != 0 {
                return Err("ICC transform requires four plates per pixel".into());
            }
            let device: Vec<u16> = match separation.mode {
                1 => plates.chunks_exact(4).flat_map(|p| [p[0], 65535]).collect(),
                3 => plates.chunks_exact(4).flat_map(|p| [p[0], p[1], p[2], 65535]).collect(),
                _ => plates.to_vec(),
            };
            let mut rgba = vec![0u16; plates.len()];
            separation
                .back
                .transform(&device, &mut rgba)
                .map_err(|error| format!("ICC transform failed: {error}"))?;
            if let Some(black) = &separation.display {
                black.unlift(&mut rgba)?;
            }
            for px in rgba.chunks_exact_mut(4) {
                px[3] = 65535;
            }
            Ok(rgba)
        }

        /// The forward leg into destination values (`lanes` samples per pixel).
        /// Lifts `pixels` in place first when BPC is on.
        fn to_device(&self, pixels: &mut [u16], lanes: usize) -> Result<Vec<u16>, String> {
            if let Some(black) = &self.lift {
                black.lift(pixels)?;
            }
            let mut device = vec![0u16; pixels.len() / 4 * lanes];
            self.inner
                .transform(pixels, &mut device)
                .map_err(|error| format!("ICC transform failed: {error}"))?;
            Ok(device)
        }
    }

    fn rendering_intent(intent: u8) -> Result<RenderingIntent, String> {
        Ok(match intent {
            0 => RenderingIntent::Perceptual,
            1 => RenderingIntent::RelativeColorimetric,
            2 => RenderingIntent::Saturation,
            3 => RenderingIntent::AbsoluteColorimetric,
            _ => return Err("Rendering intent must be between 0 and 3".into()),
        })
    }

    /// Soft-proof round-trip: document RGB → a CMYK proof profile → back out.
    /// The way in is Convert to Profile's own forward leg (intent and BPC), so
    /// Proof Colors shows what converting would print. `display` maps the
    /// proofed ink values to sRGB for the canvas; `back` maps them to the
    /// DOCUMENT space so a ΔE against the original detects out-of-gamut
    /// colours. Every leg shares the same rendering intent.
    pub(crate) struct ProofTransform {
        to_proof: Rgba16Transform,
        display: Arc<Transform16BitExecutor>,
        back: Arc<Transform16BitExecutor>,
    }

    impl ProofTransform {
        pub(crate) fn new(
            source_profile: u8,
            source_icc: &[u8],
            proof_icc: &[u8],
            intent: u8,
            black_point_compensation: bool,
        ) -> Result<Self, String> {
            let source = profile(source_profile, source_icc, "Source", &[DataColorSpace::Rgb])?;
            let proof = device_profile(proof_icc)?;
            let to_proof = Rgba16Transform::new(
                source_profile,
                source_icc,
                0,
                proof_icc,
                intent,
                black_point_compensation,
            )
            .map_err(|error| format!("Proof transform is unsupported: {error}"))?;
            let display = ColorProfile::new_srgb();
            let options = TransformOptions {
                rendering_intent: rendering_intent(intent)?,
                ..TransformOptions::default()
            };
            let build = |err: &str, result: Result<Arc<Transform16BitExecutor>, moxcms::CmsError>| {
                result.map_err(|error| format!("{err}: {error}"))
            };
            // moxcms 0.8.1's Layout::Cmyka interceptors are broken upstream
            // (FromCmykaInterceptor::transform ends in an unconditional Err),
            // so every leg uses 4-lane Rgba layouts instead: CMYK has exactly
            // four device channels, and the lanes carry C,M,Y,K with no alpha.
            // RGB proof profiles (most photo-inkjet profiles) use the same
            // Rgba layout natively, so both device classes share these legs.
            Ok(Self {
                to_proof,
                display: build(
                    "Proof display transform is unsupported",
                    proof.create_transform_16bit(Layout::Rgba, &display, Layout::Rgba, options),
                )?,
                back: build(
                    "Proof gamut transform is unsupported",
                    proof.create_transform_16bit(Layout::Rgba, &source, Layout::Rgba, options),
                )?,
            })
        }

        /// Transform an RGBA16 lattice into (proofed sRGB RGBA16, doc-space
        /// round-trip RGBA16, the lattice as BPC mapped it) — the caller
        /// derives display colours from the first and gamut membership from
        /// the second against the third, so shadows BPC lifted into the
        /// proof's range read as printable.
        pub(crate) fn apply(
            &self,
            pixels: &[u16],
        ) -> Result<(Vec<u16>, Vec<u16>, Vec<u16>), String> {
            if pixels.len() % 4 != 0 {
                return Err("Proof transform requires RGBA pixels".into());
            }
            let px = pixels.len() / 4;
            let mut mapped = pixels.to_vec();
            // C,M,Y,K in the four lanes (an RGB proof device uses them natively)
            let ink = self.to_proof.to_device(&mut mapped, 4)?;
            let mut display = vec![0u16; px * 4];
            self.display
                .transform(&ink, &mut display)
                .map_err(|error| format!("proof display failed: {error}"))?;
            let mut back = vec![0u16; px * 4];
            self.back
                .transform(&ink, &mut back)
                .map_err(|error| format!("proof gamut failed: {error}"))?;
            Ok((display, back, mapped))
        }
    }

    /// The destination's black point expressed in the SOURCE space: source
    /// black through the conversion, then back out again. A built-in matrix RGB
    /// profile reproduces a true zero and answers `[0; 3]`, so BPC stays the
    /// documented no-op there; a profile carrying a real black (a v4 LUT output
    /// profile, or any TRC with a lifted toe) answers the doc-space colour its
    /// darkest black actually reproduces.
    ///
    /// `None` when the destination has no inverse leg to probe with — BPC then
    /// degrades to a no-op rather than failing an otherwise valid conversion.
    fn destination_black(
        source: &ColorProfile,
        destination: &ColorProfile,
        forward: &Transform16BitExecutor,
        options: TransformOptions,
    ) -> Option<[u16; 3]> {
        let back = destination
            .create_transform_16bit(Layout::Rgba, source, Layout::Rgba, options)
            .ok()?;
        let mut device = [0u16; 4];
        forward.transform(&[0, 0, 0, 65535], &mut device).ok()?;
        let mut doc = [0u16; 4];
        back.transform(&device, &mut doc).ok()?;
        Some([doc[0], doc[1], doc[2]])
    }

    /// Validate an untrusted proof device profile with the same trust-boundary
    /// checks as `profile`, accepting RGB or CMYK device data — press profiles
    /// are CMYK, but most photo-inkjet output profiles are RGB.
    fn device_profile(icc: &[u8]) -> Result<ColorProfile, String> {
        if icc.len() < 132 || icc.len() >= MAX_ICC_PROFILE_BYTES {
            return Err("Proof ICC profile must be between 132 bytes and 10 MiB".into());
        }
        if icc.get(36..40) != Some(&b"acsp"[..]) {
            return Err("Proof ICC profile has an invalid header signature".into());
        }
        let declared = u32::from_be_bytes(icc[0..4].try_into().unwrap()) as usize;
        if !(132..=icc.len()).contains(&declared) {
            return Err("Proof ICC profile has an invalid declared size".into());
        }
        let parsed = ColorProfile::new_from_slice(&icc[..declared])
            .map_err(|error| format!("Proof ICC profile is invalid: {error}"))?;
        if !matches!(
            parsed.profile_class,
            ProfileClass::OutputDevice | ProfileClass::DisplayDevice | ProfileClass::ColorSpace
        ) {
            return Err("Proof ICC profile class is unsupported".into());
        }
        if !matches!(parsed.color_space, DataColorSpace::Rgb | DataColorSpace::Cmyk) {
            return Err("Proof ICC profile must use RGB or CMYK device data".into());
        }
        if !matches!(parsed.pcs, DataColorSpace::Xyz | DataColorSpace::Lab) {
            return Err("Proof ICC profile must use XYZ or Lab connection space".into());
        }
        Ok(parsed)
    }

    /// Validate an untrusted document-side profile. `spaces` is the device
    /// data the caller can use: a document source is RGB, a Convert to Profile
    /// destination may also be CMYK, Gray or Lab.
    fn profile(
        id: u8,
        icc: &[u8],
        label: &str,
        spaces: &[DataColorSpace],
    ) -> Result<ColorProfile, String> {
        if icc.is_empty() {
            return match id {
                0 => Ok(ColorProfile::new_srgb()),
                1 => Ok(ColorProfile::new_display_p3()),
                2 => Ok(ColorProfile::new_adobe_rgb()),
                3 => Ok(ColorProfile::new_bt2020()),
                _ => Err(format!("{label} built-in RGB profile is invalid")),
            };
        }
        if icc.len() < 132 || icc.len() >= MAX_ICC_PROFILE_BYTES {
            return Err(format!(
                "{label} ICC profile must be between 132 bytes and 10 MiB"
            ));
        }
        if icc.get(36..40) != Some(&b"acsp"[..]) {
            return Err(format!(
                "{label} ICC profile has an invalid header signature"
            ));
        }
        let declared = u32::from_be_bytes(icc[0..4].try_into().unwrap()) as usize;
        if !(132..=icc.len()).contains(&declared) {
            return Err(format!("{label} ICC profile has an invalid declared size"));
        }
        let parsed = ColorProfile::new_from_slice(&icc[..declared])
            .map_err(|error| format!("{label} ICC profile is invalid: {error}"))?;
        // A Lab destination is usually written as an abstract Lab identity
        // (lcms' cmsCreateLab*Profile); every other abstract, link or named
        // profile has no device side to convert into.
        let lab_space = parsed.color_space == DataColorSpace::Lab;
        if !matches!(
            parsed.profile_class,
            ProfileClass::InputDevice
                | ProfileClass::DisplayDevice
                | ProfileClass::OutputDevice
                | ProfileClass::ColorSpace
        ) && !(lab_space && parsed.profile_class == ProfileClass::Abstract)
        {
            return Err(format!("{label} ICC profile class is unsupported"));
        }
        if !spaces.contains(&parsed.color_space) {
            return Err(if spaces == [DataColorSpace::Rgb] {
                format!("{label} ICC profile must use RGB device data")
            } else {
                format!("{label} ICC profile must use RGB, CMYK, Gray or Lab device data")
            });
        }
        if !matches!(parsed.pcs, DataColorSpace::Xyz | DataColorSpace::Lab) {
            return Err(format!(
                "{label} ICC profile must use XYZ or Lab connection space"
            ));
        }
        // A Lab destination is CIE Lab: Generic Lab (a colour-space class
        // profile) and lcms' abstract identity both carry identity tables,
        // often only the perceptual pair, which moxcms cannot run relative
        // colorimetric. Checked, then converted as plain CIE Lab. An abstract
        // effect over Lab (Sepia Tone, Lightness Increase…) changes colours
        // instead of naming a space, so it is refused rather than dropped.
        if lab_space {
            if !lab_tables_are_identity(&parsed) {
                return Err(format!(
                    "{label} ICC profile is a Lab effect, not a colour space: its tables change colours. Choose a plain Lab, CMYK, Gray or RGB profile"
                ));
            }
            return Ok(cie_lab());
        }
        Ok(parsed)
    }

    fn cie_lab() -> ColorProfile {
        let mut lab = ColorProfile::new_lab();
        lab.pcs = DataColorSpace::Lab;
        lab
    }

    /// Whether a Lab profile's device→PCS table maps Lab onto itself (within
    /// 1%, which an 8-bit or v2-encoded identity table stays inside).
    fn lab_tables_are_identity(profile: &ColorProfile) -> bool {
        let intent = if profile.lut_a_to_b_perceptual.is_some() {
            RenderingIntent::Perceptual
        } else if profile.lut_a_to_b_colorimetric.is_some() {
            RenderingIntent::RelativeColorimetric
        } else if profile.lut_a_to_b_saturation.is_some() {
            RenderingIntent::Saturation
        } else {
            return true; // no tables: nothing to apply
        };
        let options = TransformOptions {
            rendering_intent: intent,
            ..TransformOptions::default()
        };
        let Ok(table) = profile.create_transform_16bit(Layout::Rgba, &cie_lab(), Layout::Rgba, options)
        else {
            return false;
        };
        let mut samples = Vec::new();
        for l in [0u16, 16384, 32768, 49152, 65535] {
            for a in [0u16, 16384, 32896, 49152, 65535] {
                for b in [0u16, 32896, 65535] {
                    samples.extend([l, a, b, 65535]);
                }
            }
        }
        let mut out = vec![0u16; samples.len()];
        table.transform(&samples, &mut out).is_ok()
            && samples
                .chunks_exact(4)
                .zip(out.chunks_exact(4))
                .all(|(s, o)| (0..3).all(|c| s[c].abs_diff(o[c]) <= 655))
    }

    #[cfg(test)]
    mod tests {
        use super::*;
        use moxcms::ToneReprCurve;

        fn encoded(profile: ColorProfile) -> Vec<u8> {
            profile.encode().expect("built-in ICC encodes")
        }

        /// sRGB primaries with a TRC that bottoms out above zero: device black
        /// still emits `lift` of light, the way a real output profile with a
        /// measured black point does. Stand-in for the v4 LUT output profiles
        /// Vision can now carry as an embedded document profile.
        fn lifted_black_profile(lift: u16) -> Vec<u8> {
            let mut p = ColorProfile::new_srgb();
            p.cicp = None; // otherwise moxcms takes the CICP transfer and ignores the TRC
            let ramp: Vec<u16> = (0..256u32)
                .map(|i| (lift as u32 + i * (65535 - lift as u32) / 255) as u16)
                .collect();
            p.red_trc = Some(ToneReprCurve::Lut(ramp.clone()));
            p.green_trc = Some(ToneReprCurve::Lut(ramp.clone()));
            p.blue_trc = Some(ToneReprCurve::Lut(ramp));
            encoded(p)
        }

        #[test]
        fn black_point_compensation_leaves_matching_black_points_alone() {
            // A destination whose black sits a hair above zero (the 16-bit
            // detection noise Apple's display profiles show) is a black point
            // that already matches: BPC must change nothing, as in LittleCMS.
            for lift in [1u16, 5] {
                let near = lifted_black_profile(lift);
                let convert = |bpc: bool| {
                    let mut px: Vec<u16> = (0..256u32)
                        .flat_map(|v| [(v * 257) as u16, (v * 131) as u16, (v * 61) as u16, 65535])
                        .collect();
                    Rgba16Transform::new(0, &[], 0, &near, 1, bpc).unwrap().apply(&mut px).unwrap();
                    px
                };
                assert_eq!(convert(true), convert(false), "lift {lift}");
            }
        }

        #[test]
        fn black_point_compensation_holds_white_and_keeps_shadows_off_the_destination_black() {
            // VIS-CM-05: BPC is honoured on RGB→RGB whenever the destination
            // reproduces a real black, not refused outright.
            let lifted = lifted_black_profile(6000);
            let convert = |bpc: bool, mut px: [u16; 4]| {
                Rgba16Transform::new(0, &[], 0, &lifted, 1, bpc)
                    .expect("lifted-black destination builds")
                    .apply(&mut px)
                    .unwrap();
                px
            };

            // A 10% shadow falls below this destination's black point, so plain
            // relative colorimetric clips it flat; BPC compresses it into the
            // reproducible range instead — in linear light, as Adobe's BPC does
            // (LittleCMS 2.19 `transicc -b` into this profile: 2.56/255 = 658).
            let shadow = [6553u16, 6553, 6553, 65535];
            let clipped = convert(false, shadow);
            let compensated = convert(true, shadow);
            assert_eq!(clipped[0], 0, "shadow should clip without BPC");
            assert!(
                compensated[..3].iter().all(|v| v.abs_diff(658) <= 20),
                "BPC left the shadow crushed: {compensated:?}"
            );
            assert_eq!(compensated[3], 65535, "alpha must survive the lift");

            // White is the fixed end of the lift: BPC must not move it at all.
            let white = [65535u16, 65535, 65535, 65535];
            assert_eq!(convert(true, white), convert(false, white));

            // The documented no-op still holds for the built-in matrix profiles:
            // they reproduce a true zero black, so BPC changes no numbers.
            let sample = [56540u16, 10280, 7710, 65535];
            let adobe = encoded(ColorProfile::new_adobe_rgb());
            let both = [false, true].map(|bpc| {
                let mut px = sample;
                Rgba16Transform::new(0, &adobe, 1, &[], 1, bpc)
                    .expect("matrix conversion accepts BPC")
                    .apply(&mut px)
                    .unwrap();
                px
            });
            assert_eq!(both[0], both[1], "BPC must be a no-op between matrix profiles");
        }

        #[test]
        fn proof_transform_accepts_rgb_device_profiles() {
            // Most photo-inkjet output profiles are RGB, not CMYK — the proof
            // leg must build for them (VIS-CM-01).
            let rgb_proof = encoded(ColorProfile::new_adobe_rgb());
            let t = ProofTransform::new(0, &[], &rgb_proof, 1, false).expect("RGB proof profile builds");
            let (display, back, _) = t.apply(&[32768, 32768, 32768, 65535]).unwrap();
            // sRGB mid grey through an Adobe RGB proof stays roughly neutral on
            // screen and round-trips near the source (in gamut).
            assert!(display[0].abs_diff(display[1]) < 2000, "display drifted off neutral");
            assert!(back[0].abs_diff(32768) < 2000, "round-trip moved mid grey");

            // Preserve-Numbers idiom: the proof profile doubles as the source,
            // so document numbers reach the proof device unconverted.
            assert!(ProofTransform::new(0, &rgb_proof, &rgb_proof, 1, false).is_ok());

            // Lab device data is still refused at the trust boundary.
            let mut lab = encoded(ColorProfile::new_srgb());
            lab[16..20].copy_from_slice(b"Lab ");
            assert!(ProofTransform::new(0, &[], &lab, 1, false).is_err());
        }

        #[test]
        fn supports_custom_profiles_in_both_directions_and_round_trips_numerically() {
            let adobe = encoded(ColorProfile::new_adobe_rgb());
            let p3 = encoded(ColorProfile::new_display_p3());
            let original = [56540, 10280, 7710, 65535];

            let mut custom_to_builtin = original;
            Rgba16Transform::new(0, &adobe, 1, &[], 1, false)
                .unwrap()
                .apply(&mut custom_to_builtin)
                .unwrap();
            assert_eq!(custom_to_builtin, [60330, 16199, 11580, 65535]);
            assert_ne!(custom_to_builtin, original);
            assert_eq!(custom_to_builtin[3], original[3]);

            let mut builtin_to_custom = custom_to_builtin;
            Rgba16Transform::new(1, &[], 0, &adobe, 1, false)
                .unwrap()
                .apply(&mut builtin_to_custom)
                .unwrap();
            for channel in 0..3 {
                assert!(
                    builtin_to_custom[channel].abs_diff(original[channel]) <= 32,
                    "round-trip channel {channel}: {} vs {}",
                    builtin_to_custom[channel],
                    original[channel]
                );
            }

            let mut custom_to_custom = original;
            Rgba16Transform::new(0, &adobe, 0, &p3, 1, false)
                .unwrap()
                .apply(&mut custom_to_custom)
                .unwrap();
            assert_eq!(custom_to_custom, custom_to_builtin);
        }

        /// The bundled FOGRA39 / ISO Coated v2 300% press profile: a real
        /// LUT-based (mft2) CMYK output profile.
        const PRESS_ICC: &[u8] =
            include_bytes!("../../../../apps/vision/public/profiles/ISOcoated_v2_300_eci.icc");

        const RED: [u16; 4] = [65535, 0, 0, 65535];
        const MID_GREY: [u16; 4] = [32896, 32896, 32896, 65535]; // sRGB 128

        /// Plates as percent ink / 0..1, for comparing against LittleCMS.
        fn plates(t: &Rgba16Transform, px: [u16; 4]) -> [f32; 4] {
            let p = t.separate(&px).expect("separates");
            std::array::from_fn(|c| p[c] as f32 / 65535.0)
        }

        fn assert_near(got: [f32; 4], want: [f32; 4], tol: f32, what: &str) {
            for c in 0..4 {
                assert!(
                    (got[c] - want[c]).abs() <= tol,
                    "{what}: plate {c} is {:.4}, LittleCMS says {:.4} ({got:?})",
                    got[c],
                    want[c]
                );
            }
        }

        #[test]
        fn device_profile_cmyk_separation_follows_the_lut_profile_and_intent() {
            // References: LittleCMS 2.19 `transicc -i *sRGB -o ISOcoated_v2_300_eci.icc -t <intent>`.
            let relative = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 1, false).unwrap();
            assert_eq!(relative.mode(), 2, "a CMYK destination lands in CMYK mode");
            assert_near(plates(&relative, RED), [0.0, 0.902, 0.996, 0.0], 0.01, "relative red");
            assert_near(plates(&relative, MID_GREY), [0.450, 0.363, 0.357, 0.282], 0.01, "relative grey");

            // The intent reaches the profile's own B2A table: perceptual red is
            // a different separation, and it is LittleCMS' perceptual one.
            let perceptual = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 0, false).unwrap();
            assert_near(plates(&perceptual, RED), [0.005, 0.966, 0.925, 0.006], 0.01, "perceptual red");

            // Converting keeps RGB pixels that hold what the ink reproduces:
            // reading the plates back out of them gives the separation again,
            // alpha survives the K lane, and the device black shows as black.
            let mut px = [RED, [65535, 65535, 65535, 20000], [0, 0, 0, 65535]].concat();
            relative.apply(&mut px).unwrap();
            assert_ne!(&px[..4], &RED, "red is out of the press gamut and moves");
            assert_eq!(px[7], 20000, "alpha is carried over");
            assert_eq!(&px[4..7], &[65535; 3], "paper white stays white");
            // Near black: the neutral black point leaves the press black's slight
            // violet tint (LittleCMS' display transform keeps it too).
            assert!(px[8..11].iter().all(|v| *v < 4000), "the press black shows as black: {px:?}");
            // The document reads its plates back through relative colorimetric
            // with BPC — the inverse of that encoding (the engine's ModeProfile).
            // The profile's own B2A∘A2B round trip is not exact at the gamut
            // edge (LittleCMS drifts red's magenta by 1% in float too).
            let reader = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 1, true).unwrap();
            let back: [u16; 4] = px[..4].try_into().unwrap();
            assert_near(plates(&reader, back), plates(&relative, RED), 0.025, "re-separated red");
            let mut grey = MID_GREY;
            relative.apply(&mut grey).unwrap();
            assert_near(plates(&reader, grey), plates(&relative, MID_GREY), 0.005, "re-separated grey");
            let rgb = reader.recombine(&reader.separate(&grey).unwrap()).unwrap();
            for c in 0..3 {
                assert!(rgb[c].abs_diff(grey[c]) <= 64, "recombine inverts separate: {rgb:?} vs {grey:?}");
            }
        }

        #[test]
        fn device_profile_black_point_compensation_keeps_shadows_off_the_press_black() {
            // FOGRA39's black is well above zero (L* 11), so without BPC a deep
            // shadow clips into the same rich black as pure black; with BPC it
            // keeps its own, lighter separation (LittleCMS: K 95% → 86%).
            let shadow = [5140u16, 5140, 5140, 65535]; // sRGB 20
            let off = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 1, false).unwrap();
            let on = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 1, true).unwrap();
            let (clipped, kept) = (plates(&off, shadow), plates(&on, shadow));
            assert!(clipped[3] > 0.93, "shadow clips to the press black without BPC: {clipped:?}");
            assert!(kept[3] < clipped[3] - 0.03, "BPC keeps the shadow off the black: {kept:?}");
            assert_near(plates(&on, [65535; 4]), [0.0; 4], 0.005, "white takes no ink either way");
            // Adobe BPC is linear-light, so midtones and saturated colours barely
            // move (LittleCMS 2.19 `transicc -b`, relative colorimetric).
            assert_near(plates(&on, shadow), [0.725, 0.626, 0.571, 0.862], 0.03, "BPC shadow");
            assert_near(plates(&on, MID_GREY), [0.441, 0.355, 0.350, 0.267], 0.02, "BPC grey");
            assert_near(plates(&on, [56540, 10280, 7710, 65535]), [0.018, 0.924, 0.900, 0.037], 0.03, "BPC red");

            // Stored pixels: without BPC the shadow crushes to black; with BPC it
            // survives close to where it was.
            let stored = |t: &Rgba16Transform| {
                let mut px = shadow;
                t.apply(&mut px).unwrap();
                px[0]
            };
            assert!(stored(&off) < 2000, "crushed into the press black: {}", stored(&off));
            assert!(stored(&on).abs_diff(shadow[0]) < 1500, "kept: {}", stored(&on));
        }

        #[test]
        fn device_profile_gray_and_lab_destinations_switch_mode_and_match_references() {
            // Gray Gamma 2.2 (matrix/TRC): LittleCMS `-o *Gray22` puts sRGB 128
            // at 127.03/255 and pure red at 128.78/255.
            let gray22 = encoded(ColorProfile::new_gray_with_gamma(2.2));
            let gray = Rgba16Transform::new(0, &[], 0, &gray22, 1, false).unwrap();
            assert_eq!(gray.mode(), 1, "a Gray destination lands in Grayscale mode");
            assert_near(plates(&gray, MID_GREY), [127.03 / 255.0, 0.0, 0.0, 0.0], 0.003, "gray grey");
            assert_near(plates(&gray, RED), [128.78 / 255.0, 0.0, 0.0, 0.0], 0.003, "gray red");
            let mut px = [RED, [0, 0, 65535, 9000]].concat();
            gray.apply(&mut px).unwrap();
            assert!(px[0].abs_diff(px[1]) <= 64 && px[1].abs_diff(px[2]) <= 64, "gray pixels are neutral: {px:?}");
            assert_eq!(px[7], 9000, "alpha rides GrayAlpha through");

            // Lab: sRGB red is D50 L*a*b* (54.29, 80.81, 69.89), in the plate
            // encoding L/100, (a+128)/255, (b+128)/255. Both a Lab profile with
            // real PCS→Lab tables and the abstract A2B0-only identity lcms
            // writes (cmsCreateLab*Profile) must land there.
            let lab_want = [54.29 / 100.0, (80.81 + 128.0) / 255.0, (69.89 + 128.0) / 255.0, 0.0];
            let mut tables = ColorProfile::new_lab();
            tables.pcs = DataColorSpace::Lab;
            let mut identity = tables.clone();
            identity.profile_class = ProfileClass::Abstract;
            identity.lut_b_to_a_perceptual = None;
            identity.lut_b_to_a_colorimetric = None;
            for (what, icc) in [("tables", encoded(tables)), ("identity", encoded(identity))] {
                let lab = Rgba16Transform::new(0, &[], 0, &icc, 1, false)
                    .unwrap_or_else(|e| panic!("{what} Lab profile builds: {e}"));
                assert_eq!(lab.mode(), 3, "a Lab destination lands in Lab mode");
                assert_near(plates(&lab, RED), lab_want, 0.003, what);
                // Lab holds the whole RGB gamut: converting barely moves pixels
                // (the 33-point LUT costs a few percent at the red corner).
                let mut px = RED;
                lab.apply(&mut px).unwrap();
                assert!(px[0] > 64000 && px[1] < 3000 && px[2] < 3000, "{what} red stays red: {px:?}");
                let mut grey = MID_GREY;
                lab.apply(&mut grey).unwrap();
                assert!(grey[..3].iter().all(|v| v.abs_diff(32896) < 300), "{what} grey stays: {grey:?}");
            }

            // An abstract profile over anything but Lab has no device side.
            let mut abstract_rgb = encoded(ColorProfile::new_srgb());
            abstract_rgb[12..16].copy_from_slice(b"abst");
            assert!(Rgba16Transform::new(0, &[], 0, &abstract_rgb, 1, false).is_err());
        }

        /// A v2 Lab profile made of 8-bit tables (`mft1`, grid 2, identity
        /// CLUT) with only the perceptual pair — the shape of macOS's Generic
        /// Lab Profile and of its abstract Lab effects. `l_curve` bends L*.
        /// Written by hand: moxcms 0.8.1 mis-encodes `mft1` tables.
        fn lab_lut8_profile(class: &[u8; 4], l_curve: impl Fn(u8) -> u8) -> Vec<u8> {
            let ramp: Vec<u8> = (0..=255).collect();
            let mft1 = |l: &dyn Fn(u8) -> u8| {
                let mut t = b"mft1\0\0\0\0".to_vec();
                t.extend([3, 3, 2, 0]);
                for m in [1, 0, 0, 0, 1, 0, 0, 0, 1] {
                    t.extend((m as i32 * 65536).to_be_bytes());
                }
                t.extend(ramp.iter().map(|&v| l(v)));
                t.extend(&ramp);
                t.extend(&ramp);
                t.extend((0..8u8).flat_map(|n| [n >> 2 & 1, n >> 1 & 1, n & 1].map(|bit| bit * 255)));
                t.extend(ramp.repeat(3));
                t
            };
            let mut tags = vec![(*b"A2B0", mft1(&l_curve))];
            if class != b"abst" {
                tags.push((*b"B2A0", mft1(&|v| v)));
            }
            let mut icc = vec![0u8; 128];
            icc[8..12].copy_from_slice(&[2, 0x20, 0, 0]);
            icc[12..16].copy_from_slice(class);
            icc[16..20].copy_from_slice(b"Lab ");
            icc[20..24].copy_from_slice(b"Lab ");
            icc[36..40].copy_from_slice(b"acsp");
            for (k, v) in [0.9642f64, 1.0, 0.8249].into_iter().enumerate() {
                icc[68 + k * 4..72 + k * 4].copy_from_slice(&((v * 65536.0).round() as i32).to_be_bytes());
            }
            icc.extend((tags.len() as u32).to_be_bytes());
            let mut offset = 132 + 12 * tags.len();
            for (sig, data) in &tags {
                icc.extend(sig);
                icc.extend((offset as u32).to_be_bytes());
                icc.extend((data.len() as u32).to_be_bytes());
                offset += data.len();
            }
            for (_, data) in tags {
                icc.extend(data);
            }
            let size = icc.len() as u32;
            icc[0..4].copy_from_slice(&size.to_be_bytes());
            icc
        }

        #[test]
        fn device_profile_lab_colour_spaces_convert_and_lab_effects_are_refused() {
            // A colour-space-class Lab profile whose tables are an identity is
            // CIE Lab, even with only the perceptual pair moxcms cannot run
            // relative colorimetric (LittleCMS through macOS's Generic Lab
            // Profile: sRGB red is 54.29 / 80.81 / 69.89).
            let lab_want = [54.29 / 100.0, (80.81 + 128.0) / 255.0, (69.89 + 128.0) / 255.0, 0.0];
            let generic = lab_lut8_profile(b"spac", |v| v);
            let lab = Rgba16Transform::new(0, &[], 0, &generic, 1, true).expect("identity Lab space converts");
            assert_eq!(lab.mode(), 3);
            assert_near(plates(&lab, RED), lab_want, 0.003, "identity lut8 Lab");

            // An abstract profile that bends Lab is an effect, not a space: it is
            // refused with a reason, never applied as a plain Lab destination.
            let lighter = lab_lut8_profile(b"abst", |v| ((v as f32 / 255.0).sqrt() * 255.0) as u8);
            assert!(Rgba16Transform::new(0, &[], 0, &lab_lut8_profile(b"abst", |v| v), 1, false).is_ok(), "identity abstract Lab");
            let error = Rgba16Transform::new(0, &[], 0, &lighter, 1, false).err().expect("Lab effect refused");
            assert!(error.contains("Lab effect, not a colour space"), "{error}");
        }

        #[test]
        fn device_profile_perceptual_black_point_compensation_is_not_applied_twice() {
            // FOGRA39's perceptual table already maps black onto the press
            // black, so BPC detected through that intent changes nothing
            // (LittleCMS 2.19 `transicc -t 0` gives the same with and without
            // `-b`): black 73.5/68.4/63.0/94.9, sRGB 20 69.8/61.5/58.2/84.6.
            let with = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 0, true).unwrap();
            let without = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 0, false).unwrap();
            let black = [0u16, 0, 0, 65535];
            let shadow = [5140u16, 5140, 5140, 65535];
            assert_near(plates(&with, black), [0.735, 0.684, 0.630, 0.949], 0.02, "perceptual BPC black");
            assert_near(plates(&with, shadow), [0.698, 0.615, 0.582, 0.846], 0.02, "perceptual BPC shadow");
            assert_near(plates(&with, MID_GREY), plates(&without, MID_GREY), 0.005, "perceptual grey");
            // ...and the converted press black still shows as (near) black.
            let mut px = black;
            with.apply(&mut px).unwrap();
            assert!(px[..3].iter().all(|v| *v < 4000), "press black shows dark: {px:?}");
        }

        #[test]
        fn device_profile_soft_proof_predicts_the_conversion() {
            // Proof Colors separates exactly as Convert to Profile does, then
            // shows the ink relative colorimetric: LittleCMS says grey 127.5
            // and 63.75 converted with BPC print as sRGB 130.6 and 72.2.
            let proof = ProofTransform::new(0, &[], PRESS_ICC, 1, true).unwrap();
            let convert = Rgba16Transform::new(0, &[], 0, PRESS_ICC, 1, true).unwrap();
            let greys = [[32768u16, 32768, 32768, 65535], [16384, 16384, 16384, 65535]];
            let (display, _, _) = proof.apply(&greys.concat()).unwrap();
            for (i, want) in [130.6f32, 72.2].into_iter().enumerate() {
                let shown = display[i * 4] as f32 / 257.0;
                assert!((shown - want).abs() < 2.0, "grey {i} proofs as {shown}, prints as {want}");
                // The proof's ink is the conversion's plates.
                let ink = plates(&convert, greys[i]);
                let mut lattice = greys[i].to_vec();
                let proofed = proof.to_proof.to_device(&mut lattice, 4).unwrap();
                assert_near(std::array::from_fn(|c| proofed[c] as f32 / 65535.0), ink, 0.001, "proof ink");
            }
        }

        #[test]
        fn rejects_invalid_profiles_and_unsupported_options_without_touching_pixels() {
            let pixels = [56540, 10280, 7710, 65535];
            let before = pixels;
            assert!(Rgba16Transform::new(0, b"not an ICC profile", 0, &[], 1, false).is_err());
            assert_eq!(pixels, before);

            let mut device_link = encoded(ColorProfile::new_srgb());
            device_link[12..16].copy_from_slice(b"link");
            assert!(Rgba16Transform::new(0, &device_link, 0, &[], 1, false).is_err());

            let mut cmyk = encoded(ColorProfile::new_srgb());
            cmyk[16..20].copy_from_slice(b"CMYK");
            assert!(Rgba16Transform::new(0, &cmyk, 0, &[], 1, false).is_err());
        }
    }
}

#[cfg(feature = "color-management")]
pub(super) use enabled::{ProofTransform, Rgba16Transform};

#[cfg(not(feature = "color-management"))]
pub(super) struct Rgba16Transform;

#[cfg(not(feature = "color-management"))]
pub(super) struct ProofTransform;

#[cfg(not(feature = "color-management"))]
impl ProofTransform {
    pub(super) fn new(
        _source_profile: u8,
        _source_icc: &[u8],
        _proof_icc: &[u8],
        _intent: u8,
        _black_point_compensation: bool,
    ) -> Result<Self, String> {
        Err("ICC color management is not available in this engine build".into())
    }

    #[allow(clippy::type_complexity)]
    pub(super) fn apply(&self, _pixels: &[u16]) -> Result<(Vec<u16>, Vec<u16>, Vec<u16>), String> {
        Err("ICC color management is not available in this engine build".into())
    }
}

#[cfg(not(feature = "color-management"))]
impl Rgba16Transform {
    pub(super) fn new(
        _source_profile: u8,
        _source_icc: &[u8],
        _destination_profile: u8,
        _destination_icc: &[u8],
        _intent: u8,
        _black_point_compensation: bool,
    ) -> Result<Self, String> {
        Err("ICC color management is not available in this engine build".into())
    }

    pub(super) fn apply(&self, _pixels: &mut [u16]) -> Result<(), String> {
        Err("ICC color management is not available in this engine build".into())
    }

    pub(super) fn mode(&self) -> u8 {
        0
    }

    pub(super) fn separate(&self, _rgba: &[u16]) -> Result<Vec<u16>, String> {
        Err("ICC color management is not available in this engine build".into())
    }

    pub(super) fn recombine(&self, _plates: &[u16]) -> Result<Vec<u16>, String> {
        Err("ICC color management is not available in this engine build".into())
    }
}
