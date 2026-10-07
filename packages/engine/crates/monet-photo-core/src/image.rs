use serde::{Deserialize, Serialize};

pub const MAX_DIMENSION: u32 = 32_767;
pub const MAX_PIXELS: u64 = 120_000_000;

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum PixelEncoding {
    LinearSrgbU16Full,
    SrgbEncodedU16Full,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum AlphaMode {
    Opaque,
    Straight,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OrientationState {
    pub source_exif: u8,
    pub output_exif: u8,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DecodeProvenance {
    pub source_digest: String,
    pub backend: String,
    pub backend_revision: String,
    pub decoder_version: String,
    /// `[x, y, width, height]` in un-oriented native source coordinates.
    pub active_area: [u32; 4],
    pub working_profile_digest: String,
    pub decode_intent_digest: String,
    pub alpha_mode: AlphaMode,
}

#[derive(Clone, Debug, Eq, PartialEq)]
pub struct DevelopFrame {
    pub width: u32,
    pub height: u32,
    pub pixels: Vec<u16>,
    pub encoding: PixelEncoding,
    pub orientation: OrientationState,
    pub provenance: DecodeProvenance,
}

impl DevelopFrame {
    pub fn new(
        width: u32,
        height: u32,
        pixels: Vec<u16>,
        encoding: PixelEncoding,
        orientation: OrientationState,
        provenance: DecodeProvenance,
    ) -> Result<Self, &'static str> {
        let samples = u64::from(width)
            .checked_mul(u64::from(height))
            .and_then(|n| n.checked_mul(4))
            .ok_or("frame dimensions overflow")?;
        if width == 0
            || height == 0
            || width > MAX_DIMENSION
            || height > MAX_DIMENSION
            || u64::from(width) * u64::from(height) > MAX_PIXELS
        {
            return Err("frame dimensions out of range");
        }
        if samples != pixels.len() as u64 {
            return Err("RGBA16 frame is not tightly packed");
        }
        if provenance.alpha_mode == AlphaMode::Opaque
            && pixels.chunks_exact(4).any(|pixel| pixel[3] != u16::MAX)
        {
            return Err("opaque frame contains non-opaque alpha");
        }
        if !(1..=8).contains(&orientation.source_exif) {
            return Err("invalid source orientation");
        }
        if orientation.output_exif != 1 {
            return Err("develop output orientation must be 1");
        }
        Ok(Self {
            width,
            height,
            pixels,
            encoding,
            orientation,
            provenance,
        })
    }
}

#[derive(Clone, Copy, Debug)]
pub struct CoverageView<'a> {
    pub width: u32,
    pub height: u32,
    pub coverage: Option<&'a [u8]>,
}

impl<'a> CoverageView<'a> {
    pub fn validate(self) -> Result<Self, &'static str> {
        if let Some(mask) = self.coverage {
            let len = u64::from(self.width)
                .checked_mul(u64::from(self.height))
                .ok_or("coverage dimensions overflow")?;
            if len != mask.len() as u64 {
                return Err("coverage dimensions do not match mask");
            }
        }
        Ok(self)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn provenance(alpha_mode: AlphaMode) -> DecodeProvenance {
        DecodeProvenance {
            source_digest: "00".repeat(32),
            backend: "fixture".into(),
            backend_revision: "1".into(),
            decoder_version: "1".into(),
            active_area: [0, 0, 2, 1],
            working_profile_digest: "11".repeat(32),
            decode_intent_digest: "22".repeat(32),
            alpha_mode,
        }
    }

    #[test]
    fn frame_checks_dimensions_layout_orientation_and_raw_alpha() {
        let pixels = vec![0, 0, 0, u16::MAX, 1, 2, 3, u16::MAX];
        assert!(DevelopFrame::new(
            2,
            1,
            pixels.clone(),
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 6,
                output_exif: 1
            },
            provenance(AlphaMode::Opaque),
        )
        .is_ok());
        assert!(DevelopFrame::new(
            2,
            2,
            pixels.clone(),
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1
            },
            provenance(AlphaMode::Opaque),
        )
        .is_err());
        let mut transparent = pixels;
        transparent[3] = 0;
        assert!(DevelopFrame::new(
            2,
            1,
            transparent,
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1
            },
            provenance(AlphaMode::Opaque),
        )
        .is_err());
        assert!(DevelopFrame::new(
            MAX_DIMENSION + 1,
            1,
            Vec::new(),
            PixelEncoding::LinearSrgbU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1
            },
            provenance(AlphaMode::Opaque),
        )
        .is_err());
    }

    #[test]
    fn coverage_length_is_checked() {
        assert!(CoverageView {
            width: 2,
            height: 2,
            coverage: Some(&[255; 3])
        }
        .validate()
        .is_err());
    }
}
