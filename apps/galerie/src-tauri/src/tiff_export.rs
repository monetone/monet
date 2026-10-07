use std::fs::File;
use std::io::{BufReader, BufWriter, Read, Seek, Write};
use std::path::Path;

use monet_photo_core::{DevelopFrame, PixelEncoding};
use moxcms::{ColorDateTime, ColorProfile, Layout, RenderingIntent, TransformOptions};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tiff::decoder::Decoder;
use tiff::encoder::{colortype, TiffEncoder};
use tiff::tags::Tag;
use tiff::ColorType;

const STRIP_BUFFER_LIMIT: usize = 64 * 1024 * 1024;

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum TiffStage {
    Converting,
    Writing,
    Validating,
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum OutputProfile {
    Srgb,
    DisplayP3,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TiffMetadata {
    pub width: u32,
    pub height: u32,
    pub bits_per_sample: u8,
    pub samples_per_pixel: u8,
    pub orientation: u8,
    pub profile: OutputProfile,
    pub intent: &'static str,
    pub black_point_compensation: bool,
    pub icc_digest: String,
    pub output_digest: String,
    pub bytes: u64,
}

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn selected_profile(profile: OutputProfile) -> ColorProfile {
    let mut profile = match profile {
        OutputProfile::Srgb => ColorProfile::new_srgb(),
        OutputProfile::DisplayP3 => ColorProfile::new_display_p3(),
    };
    profile.rendering_intent = RenderingIntent::RelativeColorimetric;
    profile.creation_date_time = ColorDateTime {
        year: 2026,
        month: 1,
        day_of_the_month: 1,
        hours: 0,
        minutes: 0,
        seconds: 0,
    };
    profile
}

pub fn profile_bytes(profile: OutputProfile) -> Result<Vec<u8>, String> {
    let mut bytes = selected_profile(profile)
        .encode()
        .map_err(|error| format!("encode ICC profile: {error}"))?;
    // moxcms 0.8.1 currently stamps encode time instead of the profile's
    // creation_date_time field. Canonicalize the ICC header so the selected
    // built-in profile has exact, reproducible bytes.
    bytes[24..36].copy_from_slice(&[
        0x07, 0xea, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    ]);
    validate_icc(&bytes)?;
    Ok(bytes)
}

pub fn validate_icc(bytes: &[u8]) -> Result<(), String> {
    if bytes.len() < 128 {
        return Err("ICC profile is shorter than its 128-byte header".into());
    }
    let declared = u32::from_be_bytes(bytes[..4].try_into().expect("ICC size field")) as usize;
    if declared != bytes.len() {
        return Err("ICC profile header size does not match embedded bytes".into());
    }
    if &bytes[36..40] != b"acsp" {
        return Err("ICC profile is missing the acsp signature".into());
    }
    Ok(())
}

pub fn write_rgb16_tiff(
    file: File,
    frame: &DevelopFrame,
    profile: OutputProfile,
    checkpoint: impl FnMut(TiffStage) -> Result<(), String>,
) -> Result<TiffMetadata, String> {
    write_rgb16_tiff_impl(file, frame, profile, checkpoint, digest_file)
}

fn write_rgb16_tiff_impl(
    file: File,
    frame: &DevelopFrame,
    profile: OutputProfile,
    mut checkpoint: impl FnMut(TiffStage) -> Result<(), String>,
    digest_output: impl FnOnce(&mut File) -> Result<(String, u64), String>,
) -> Result<TiffMetadata, String> {
    if frame.encoding != PixelEncoding::SrgbEncodedU16Full {
        return Err("TIFF export requires sRGB-encoded shared-core output".into());
    }
    let icc = profile_bytes(profile)?;
    let source_profile = selected_profile(OutputProfile::Srgb);
    let destination_profile = selected_profile(profile);
    let transform = source_profile
        .create_transform_16bit(
            Layout::Rgb,
            &destination_profile,
            Layout::Rgb,
            TransformOptions {
                rendering_intent: RenderingIntent::RelativeColorimetric,
                ..TransformOptions::default()
            },
        )
        .map_err(|error| format!("create RGB16 ICC transform: {error}"))?;

    let mut validation_file = file
        .try_clone()
        .map_err(|error| format!("clone TIFF for validation: {error}"))?;
    let mut writer = BufWriter::new(file);
    {
        let mut encoder = TiffEncoder::new(&mut writer)
            .map_err(|error| format!("create TIFF encoder: {error}"))?;
        let mut image = encoder
            .new_image::<colortype::RGB16>(frame.width, frame.height)
            .map_err(|error| format!("create RGB16 TIFF image: {error}"))?;
        image
            .encoder()
            .write_tag(Tag::IccProfile, &icc[..])
            .map_err(|error| format!("embed ICC profile: {error}"))?;
        image
            .encoder()
            .write_tag(Tag::Orientation, 1_u16)
            .map_err(|error| format!("write TIFF orientation: {error}"))?;
        let (row_samples, frame_samples) = checked_tiff_layout(frame.width, frame.height)?;
        if frame_samples != frame.pixels.len() {
            return Err("TIFF frame sample count mismatch".into());
        }
        let max_rows = (STRIP_BUFFER_LIMIT / 4 / row_samples).max(1);
        image
            .rows_per_strip(u32::try_from(max_rows).unwrap_or(u32::MAX))
            .map_err(|error| format!("configure TIFF strips: {error}"))?;

        let mut row = 0_usize;
        while image.next_strip_sample_count() != 0 {
            checkpoint(TiffStage::Converting)?;
            let samples = usize::try_from(image.next_strip_sample_count())
                .map_err(|_| "TIFF strip sample count exceeds address space")?;
            let rows = samples / row_samples;
            let mut source = Vec::with_capacity(samples);
            let width =
                usize::try_from(frame.width).map_err(|_| "TIFF width exceeds address space")?;
            let start = row
                .checked_mul(width)
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or("TIFF source offset overflow")?;
            let end = row
                .checked_add(rows)
                .and_then(|row| row.checked_mul(width))
                .and_then(|pixels| pixels.checked_mul(4))
                .ok_or("TIFF source offset overflow")?;
            for pixel in frame.pixels[start..end].chunks_exact(4) {
                source.extend_from_slice(&pixel[..3]);
            }
            let mut destination = vec![0_u16; samples];
            transform
                .transform(&source, &mut destination)
                .map_err(|error| format!("apply RGB16 ICC transform: {error}"))?;
            checkpoint(TiffStage::Writing)?;
            image
                .write_strip(&destination)
                .map_err(|error| format!("write RGB16 TIFF strip: {error}"))?;
            row += rows;
        }
        image
            .finish()
            .map_err(|error| format!("finish RGB16 TIFF: {error}"))?;
    }
    writer
        .flush()
        .map_err(|error| format!("flush TIFF: {error}"))?;
    writer
        .get_ref()
        .sync_all()
        .map_err(|error| format!("sync TIFF: {error}"))?;
    drop(writer);
    checkpoint(TiffStage::Validating)?;
    validate_tiff_reader(&mut validation_file, frame.width, frame.height, &icc)?;
    let (output_digest, bytes) = digest_output(&mut validation_file)?;
    Ok(TiffMetadata {
        width: frame.width,
        height: frame.height,
        bits_per_sample: 16,
        samples_per_pixel: 3,
        orientation: 1,
        profile,
        intent: "relativeColorimetric",
        black_point_compensation: false,
        icc_digest: digest(&icc),
        output_digest,
        bytes,
    })
}

#[cfg(test)]
pub(crate) fn write_rgb16_tiff_with_digest(
    file: File,
    frame: &DevelopFrame,
    profile: OutputProfile,
    checkpoint: impl FnMut(TiffStage) -> Result<(), String>,
    digest_output: impl FnOnce(&mut File) -> Result<(String, u64), String>,
) -> Result<TiffMetadata, String> {
    write_rgb16_tiff_impl(file, frame, profile, checkpoint, digest_output)
}

fn checked_tiff_layout(width: u32, height: u32) -> Result<(usize, usize), String> {
    let width = usize::try_from(width).map_err(|_| "TIFF width exceeds address space")?;
    let height = usize::try_from(height).map_err(|_| "TIFF height exceeds address space")?;
    let row_samples = width
        .checked_mul(3)
        .ok_or("TIFF row sample count overflow")?;
    let frame_samples = width
        .checked_mul(height)
        .and_then(|pixels| pixels.checked_mul(4))
        .ok_or("TIFF frame sample count overflow")?;
    if row_samples == 0 || frame_samples == 0 {
        return Err("TIFF dimensions must be positive".into());
    }
    Ok((row_samples, frame_samples))
}

pub fn validate_tiff(
    path: &Path,
    width: u32,
    height: u32,
    expected_icc: &[u8],
) -> Result<(), String> {
    let mut file = File::open(path).map_err(|error| format!("open TIFF validation: {error}"))?;
    validate_tiff_reader(&mut file, width, height, expected_icc)
}

fn validate_tiff_reader(
    file: &mut File,
    width: u32,
    height: u32,
    expected_icc: &[u8],
) -> Result<(), String> {
    file.rewind()
        .map_err(|error| format!("seek TIFF validation: {error}"))?;
    let mut decoder = Decoder::new(BufReader::new(file))
        .map_err(|error| format!("decode TIFF header: {error}"))?;
    if decoder.dimensions().map_err(|error| error.to_string())? != (width, height) {
        return Err("TIFF dimensions do not match developed frame".into());
    }
    if decoder.colortype().map_err(|error| error.to_string())? != ColorType::RGB(16) {
        return Err("TIFF is not unsigned RGB16".into());
    }
    if decoder
        .get_tag_u32(Tag::SamplesPerPixel)
        .map_err(|error| error.to_string())?
        != 3
        || decoder
            .get_tag_u32(Tag::Orientation)
            .map_err(|error| error.to_string())?
            != 1
    {
        return Err("TIFF sample/orientation contract mismatch".into());
    }
    let embedded = decoder
        .get_tag_u8_vec(Tag::IccProfile)
        .map_err(|error| format!("read embedded ICC profile: {error}"))?;
    if embedded != expected_icc {
        return Err("TIFF embedded ICC bytes differ from selected profile".into());
    }
    validate_icc(&embedded)
}

fn digest_file(file: &mut File) -> Result<(String, u64), String> {
    file.rewind()
        .map_err(|error| format!("seek TIFF digest: {error}"))?;
    let mut hash = Sha256::new();
    let mut buffer = [0_u8; 1024 * 1024];
    let mut bytes = 0_u64;
    loop {
        let read = file
            .read(&mut buffer)
            .map_err(|error| format!("read TIFF digest: {error}"))?;
        if read == 0 {
            break;
        }
        hash.update(&buffer[..read]);
        bytes += read as u64;
    }
    Ok((
        hash.finalize()
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
        bytes,
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use monet_photo_core::{AlphaMode, DecodeProvenance, OrientationState, PixelEncoding};
    use tiff::decoder::DecodingResult;

    fn frame() -> DevelopFrame {
        DevelopFrame::new(
            2,
            1,
            vec![u16::MAX, 0, 0, u16::MAX, 0, u16::MAX, 0, u16::MAX],
            PixelEncoding::SrgbEncodedU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "fixture".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 2, 1],
                working_profile_digest: "11".repeat(32),
                decode_intent_digest: "22".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        )
        .unwrap()
    }

    fn expected_transform_frame() -> (DevelopFrame, Vec<u16>) {
        let colors = [
            [0, 0, 0],
            [u16::MAX, u16::MAX, u16::MAX],
            [1, 1, 1],
            [257, 257, 257],
            [1024, 1024, 1024],
            [4096, 4096, 4096],
            [16384, 16384, 16384],
            [32768, 32768, 32768],
            [49152, 49152, 49152],
            [65534, 65534, 65534],
            [1024, 0, 0],
            [16384, 0, 0],
            [32768, 0, 0],
            [49152, 0, 0],
            [u16::MAX, 0, 0],
            [0, 1024, 0],
            [0, 16384, 0],
            [0, 32768, 0],
            [0, 49152, 0],
            [0, u16::MAX, 0],
            [0, 0, 1024],
            [0, 0, 16384],
            [0, 0, 32768],
            [0, 0, 49152],
            [0, 0, u16::MAX],
            [u16::MAX, 1, 32768],
            [1, u16::MAX, 32768],
            [32768, 1, u16::MAX],
            [u16::MAX, 32768, 1],
            [32768, u16::MAX, 1],
            [1, 32768, u16::MAX],
            [1234, 56789, 22222],
            [60000, 4000, 50000],
            [300, 50000, 65000],
        ];
        let source = colors.into_iter().flatten().collect::<Vec<_>>();
        let pixels = colors
            .into_iter()
            .flat_map(|[red, green, blue]| [red, green, blue, u16::MAX])
            .collect();
        (
            DevelopFrame::new(
                colors.len() as u32,
                1,
                pixels,
                PixelEncoding::SrgbEncodedU16Full,
                OrientationState {
                    source_exif: 1,
                    output_exif: 1,
                },
                DecodeProvenance {
                    source_digest: "00".repeat(32),
                    backend: "fixture".into(),
                    backend_revision: "1".into(),
                    decoder_version: "1".into(),
                    active_area: [0, 0, colors.len() as u32, 1],
                    working_profile_digest: "11".repeat(32),
                    decode_intent_digest: "22".repeat(32),
                    alpha_mode: AlphaMode::Opaque,
                },
            )
            .unwrap(),
            source,
        )
    }

    fn nearest_rank(sorted: &[u16], percentile: usize) -> u16 {
        sorted[(sorted.len() * percentile).div_ceil(100) - 1]
    }

    #[test]
    fn profiles_are_stable_valid_and_distinct() {
        let srgb = profile_bytes(OutputProfile::Srgb).unwrap();
        let p3 = profile_bytes(OutputProfile::DisplayP3).unwrap();
        assert_eq!(srgb, profile_bytes(OutputProfile::Srgb).unwrap());
        assert_eq!(
            digest(&srgb),
            "3f5dc0dcf055bb1a0058e9511a16ab16506ae37b63267ac335d3fd136f8b4285"
        );
        assert_eq!(
            digest(&p3),
            "2b29c843f52c3459285d1092d6d6843e578647894b75049672f8abe144248d61"
        );
        assert_ne!(srgb, p3);
    }

    #[test]
    fn expected_transform_metrics_are_reproducible_for_both_profiles() {
        let (frame, source) = expected_transform_frame();
        let mut encoded = Vec::new();
        for profile in [OutputProfile::Srgb, OutputProfile::DisplayP3] {
            let path = std::env::temp_dir().join(format!(
                "galerie-rgb16-{}-{profile:?}.tiff",
                std::process::id()
            ));
            let file = File::options()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            let metadata = write_rgb16_tiff(file, &frame, profile, |_| Ok(())).unwrap();
            assert_eq!(metadata.bits_per_sample, 16);
            assert_eq!(
                metadata.icc_digest,
                digest(&profile_bytes(profile).unwrap())
            );
            let mut decoder = Decoder::new(BufReader::new(File::open(&path).unwrap())).unwrap();
            assert_eq!(
                decoder.get_tag_u8_vec(Tag::IccProfile).unwrap(),
                profile_bytes(profile).unwrap()
            );
            let DecodingResult::U16(actual) = decoder.read_image().unwrap() else {
                panic!("expected RGB16 pixels");
            };
            let transform = selected_profile(OutputProfile::Srgb)
                .create_transform_16bit(
                    Layout::Rgb,
                    &selected_profile(profile),
                    Layout::Rgb,
                    TransformOptions {
                        rendering_intent: RenderingIntent::RelativeColorimetric,
                        ..TransformOptions::default()
                    },
                )
                .unwrap();
            let mut expected = vec![0; source.len()];
            transform.transform(&source, &mut expected).unwrap();
            let mut errors = actual
                .iter()
                .zip(&expected)
                .map(|(actual, expected)| actual.abs_diff(*expected))
                .collect::<Vec<_>>();
            errors.sort_unstable();
            let maximum = *errors.last().unwrap();
            let above_one_lsb = errors.iter().filter(|error| **error > 1).count();
            println!(
                "tiff_expected_transform profile={profile:?} max={maximum} p50={} p95={} p99={} above_one_lsb={above_one_lsb} samples={}",
                nearest_rank(&errors, 50),
                nearest_rank(&errors, 95),
                nearest_rank(&errors, 99),
                errors.len(),
            );
            assert!(maximum <= 1);
            assert_eq!(above_one_lsb, 0);
            encoded.push(actual);
            std::fs::remove_file(path).unwrap();
        }
        let profile_differences = encoded[0]
            .iter()
            .zip(&encoded[1])
            .filter(|(srgb, p3)| srgb != p3)
            .count();
        println!(
            "tiff_expected_transform profile_differences={profile_differences} samples={}",
            encoded[0].len()
        );
        assert!(profile_differences > 0);
    }

    #[test]
    fn checked_layout_rejects_zero_and_overflow_before_allocation() {
        assert_eq!(
            checked_tiff_layout(0, 1).unwrap_err(),
            "TIFF dimensions must be positive"
        );
        if usize::BITS == 32 {
            assert!(checked_tiff_layout(u32::MAX, u32::MAX).is_err());
        } else {
            assert_eq!(
                checked_tiff_layout(u32::MAX, u32::MAX).unwrap_err(),
                "TIFF frame sample count overflow"
            );
        }
    }

    #[test]
    fn write_and_validation_failures_leave_only_the_owned_file_for_cleanup() {
        for failed_stage in [
            TiffStage::Converting,
            TiffStage::Writing,
            TiffStage::Validating,
        ] {
            let path = std::env::temp_dir().join(format!(
                "galerie-rgb16-failure-{}-{failed_stage:?}.tiff",
                std::process::id()
            ));
            let file = File::options()
                .read(true)
                .write(true)
                .create_new(true)
                .open(&path)
                .unwrap();
            let error = write_rgb16_tiff(file, &frame(), OutputProfile::Srgb, |stage| {
                if stage == failed_stage {
                    Err("injected failure".into())
                } else {
                    Ok(())
                }
            })
            .unwrap_err();
            assert!(error.contains("injected failure"));
            assert!(path.exists());
            std::fs::remove_file(path).unwrap();
        }
    }
}
