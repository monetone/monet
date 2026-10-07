// Standard capture EXIF for automatic lens matching (#445). MakerNotes are
// deliberately opaque: an unknown lens stays unknown instead of being guessed.
use super::dcp::{Tiff, TiffEntry};
use image::ImageDecoder;
use std::io::Cursor;

#[derive(Clone, Default, Debug, PartialEq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct CaptureMetadata {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub make: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub lens: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub aperture: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub focal_length35_mm: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub subject_distance_m: Option<f64>,
}

/// TIFF-derived RAWs are inspected directly. JPEG/PNG/WebP expose their EXIF
/// through the already-installed image decoder, without decoding any pixels.
pub(super) fn read(bytes: &[u8]) -> CaptureMetadata {
    let bytes = bytes.strip_prefix(b"Exif\0\0").unwrap_or(bytes);
    if matches!(bytes.get(..4), Some(b"II*\0" | b"MM\0*")) {
        return read_tiff(bytes);
    }
    image::ImageReader::new(Cursor::new(bytes))
        .with_guessed_format().ok()
        .and_then(|reader| reader.into_decoder().ok())
        .and_then(|mut decoder| decoder.exif_metadata().ok().flatten())
        .map(|exif| read_tiff(exif.strip_prefix(b"Exif\0\0").unwrap_or(&exif)))
        .unwrap_or_default()
}

fn read_tiff(bytes: &[u8]) -> CaptureMetadata {
    let mut out = CaptureMetadata::default();
    let little = match bytes.get(..4) {
        Some(b"II*\0") => true,
        Some(b"MM\0*") => false,
        _ => return out,
    };
    let tiff = Tiff { bytes, little };
    let Some(first) = tiff.u32_at(4) else { return out };
    let mut pending = vec![first as usize];
    let mut seen = Vec::new();
    // EXIF, SubIFDs and next-IFD links can cycle or fan out in hostile input.
    while let Some(at) = pending.pop() {
        if at == 0 || seen.contains(&at) { continue; }
        if seen.len() == 16 { break; }
        seen.push(at);
        let Some(entries) = tiff.ifd(at) else { continue };
        let text = |entry| tiff.text(entry).filter(|value| !value.is_empty());
        let number = |entry: TiffEntry, maximum: f64| {
            if entry.count != 1 { return None; }
            tiff.numbers(entry)?.first().copied().filter(|v| *v > 0.0 && *v <= maximum)
        };
        // Read this image's EXIF before the next image/thumbnail's metadata.
        if let Some(next_at) = tiff.u16_at(at)
            .and_then(|count| at.checked_add(2 + usize::from(count) * 12))
        {
            if pending.len() < 16 {
                if let Some(next) = tiff.u32_at(next_at) { pending.push(next as usize); }
            }
        }
        for entry in entries {
            match entry.tag {
                0x010F if out.make.is_none() => out.make = text(entry),
                0x0110 if out.model.is_none() => out.model = text(entry),
                0xA434 if out.lens.is_none() => out.lens = text(entry),
                0x920A if out.focal_length_mm.is_none() => out.focal_length_mm = number(entry, 100_000.0),
                0x829D if out.aperture.is_none() => out.aperture = number(entry, 1024.0),
                0xA405 if out.focal_length35_mm.is_none() => out.focal_length35_mm = number(entry, 65_535.0),
                // EXIF's all-ones numerator means infinity, not metres.
                0x9206 if out.subject_distance_m.is_none() && tiff.u32_at(entry.at) != Some(u32::MAX) => {
                    out.subject_distance_m = number(entry, 1_000_000_000.0);
                }
                0x8769 | 0x014A if matches!(entry.kind, 4 | 13) && entry.count <= 16 => {
                    for i in 0..entry.count {
                        if pending.len() < 16 {
                            if let Some(offset) = tiff.u32_at(entry.at + i * 4) { pending.push(offset as usize); }
                        }
                    }
                }
                _ => {}
            }
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::ImageEncoder;

    fn u16_bytes(value: u16, little: bool) -> [u8; 2] {
        if little { value.to_le_bytes() } else { value.to_be_bytes() }
    }
    fn u32_bytes(value: u32, little: bool) -> [u8; 4] {
        if little { value.to_le_bytes() } else { value.to_be_bytes() }
    }
    fn ifd(file: &mut Vec<u8>, little: bool, fields: &[(u16, u16, Vec<u8>)]) -> usize {
        let offset = file.len();
        file.extend_from_slice(&u16_bytes(fields.len() as u16, little));
        file.resize(file.len() + fields.len() * 12 + 4, 0);
        for (i, (tag, kind, value)) in fields.iter().enumerate() {
            let at = offset + 2 + i * 12;
            let size = match kind { 3 => 2, 4 => 4, 5 => 8, _ => 1 };
            file[at..at + 2].copy_from_slice(&u16_bytes(*tag, little));
            file[at + 2..at + 4].copy_from_slice(&u16_bytes(*kind, little));
            file[at + 4..at + 8].copy_from_slice(&u32_bytes((value.len() / size) as u32, little));
            if value.len() <= 4 {
                file[at + 8..at + 8 + value.len()].copy_from_slice(value);
            } else {
                let data = file.len();
                file[at + 8..at + 12].copy_from_slice(&u32_bytes(data as u32, little));
                file.extend_from_slice(value);
            }
        }
        offset
    }

    fn fixture(little: bool) -> Vec<u8> {
        let mut file = if little { b"II*\0".to_vec() } else { b"MM\0*".to_vec() };
        file.extend_from_slice(&u32_bytes(8, little));
        let root = ifd(&mut file, little, &[
            (0x010F, 2, b"Acme\0".to_vec()),
            (0x0110, 2, b"Camera\0".to_vec()),
            (0x8769, 4, vec![0; 4]),
        ]);
        let rational = |n, d| [u32_bytes(n, little), u32_bytes(d, little)].concat();
        let exif = ifd(&mut file, little, &[
            (0xA434, 2, b"Standard Zoom\0".to_vec()),
            (0x920A, 5, rational(50, 1)),
            (0x829D, 5, rational(28, 10)),
            (0xA405, 3, u16_bytes(75, little).to_vec()),
            (0x9206, 5, rational(3, 1)),
        ]);
        file[root + 34..root + 38].copy_from_slice(&u32_bytes(exif as u32, little));
        file
    }

    #[test]
    fn standard_ifd_and_exif_tags_read_in_both_byte_orders() {
        for little in [true, false] {
            let mut file = fixture(little);
            let thumbnail = ifd(&mut file, little, &[(0xA434, 2, b"Thumbnail Lens\0".to_vec())]);
            file[46..50].copy_from_slice(&u32_bytes(thumbnail as u32, little));
            let fields = read(&file);
            assert_eq!(fields, CaptureMetadata {
                make: Some("Acme".into()), model: Some("Camera".into()), lens: Some("Standard Zoom".into()),
                focal_length_mm: Some(50.0), aperture: Some(2.8), focal_length35_mm: Some(75.0), subject_distance_m: Some(3.0),
            });
            let json = serde_json::to_value(fields).unwrap();
            assert_eq!(json["focalLength35Mm"], 75.0);
            assert_eq!(json["subjectDistanceM"], 3.0);
        }
    }

    #[test]
    fn jpeg_png_and_webp_exif_is_read_without_changing_image_open() {
        let exif = fixture(true);
        for format in [image::ImageFormat::Jpeg, image::ImageFormat::Png, image::ImageFormat::WebP] {
            let mut bytes = Vec::new();
            let pixels = [20, 40, 60, 80, 100, 120];
            match format {
                image::ImageFormat::Jpeg => {
                    let mut encoder = image::codecs::jpeg::JpegEncoder::new(&mut bytes);
                    encoder.set_exif_metadata(exif.clone()).unwrap();
                    encoder.write_image(&pixels, 2, 1, image::ExtendedColorType::Rgb8).unwrap();
                }
                image::ImageFormat::Png => {
                    let mut encoder = image::codecs::png::PngEncoder::new(&mut bytes);
                    encoder.set_exif_metadata(exif.clone()).unwrap();
                    encoder.write_image(&pixels, 2, 1, image::ExtendedColorType::Rgb8).unwrap();
                }
                _ => {
                    let mut encoder = image::codecs::webp::WebPEncoder::new_lossless(&mut bytes);
                    encoder.set_exif_metadata(exif.clone()).unwrap();
                    encoder.write_image(&pixels, 2, 1, image::ExtendedColorType::Rgb8).unwrap();
                }
            }
            assert_eq!(read(&bytes), read(&exif), "{format:?}");
            let opened = super::super::Engine::from_image(&bytes).unwrap();
            assert_eq!((opened.width(), opened.height()), (2, 1));
        }
    }

    #[test]
    fn malformed_values_offsets_and_cycles_are_bounded_and_omit_unknown_fields() {
        assert_eq!(read(b"not an image"), CaptureMetadata::default());
        let original = fixture(true);
        for len in [0, 4, 7, 50, original.len() - 1] { let _ = read(&original[..len]); }
        let mut file = original.clone();
        file[4..8].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(read(&file), CaptureMetadata::default());
        let mut file = original.clone();
        file[8..10].copy_from_slice(&u16::MAX.to_le_bytes());
        assert_eq!(read(&file), CaptureMetadata::default());
        let mut file = original.clone();
        file[42..46].copy_from_slice(&8u32.to_le_bytes()); // Exif IFD cycles to IFD0
        assert_eq!(read(&file).lens, None);
        assert_eq!(read(&file).make.as_deref(), Some("Acme"));

        let tiff = Tiff { bytes: &original, little: true };
        let exif = tiff.u32_at(42).unwrap() as usize;
        let entries = tiff.ifd(exif).unwrap();
        let mut file = original.clone();
        file[exif + 6..exif + 10].copy_from_slice(&u32::MAX.to_le_bytes());
        assert_eq!(read(&file).lens, None, "unbounded text count is refused");
        let mut file = original;
        for entry in entries {
            match entry.tag {
                0x829D => file[entry.at + 4..entry.at + 8].fill(0), // zero denominator
                0x920A | 0xA405 => file[entry.at..entry.at + 2].fill(0), // unknown zero
                0x9206 => file[entry.at..entry.at + 4].fill(255), // infinite distance
                _ => {}
            }
        }
        let fields = read(&file);
        assert_eq!((fields.aperture, fields.focal_length_mm, fields.focal_length35_mm, fields.subject_distance_m), (None, None, None, None));
        assert_eq!(fields.lens.as_deref(), Some("Standard Zoom"));
        let mut png = Vec::new();
        let mut encoder = image::codecs::png::PngEncoder::new(&mut png);
        encoder.set_exif_metadata(file).unwrap();
        encoder.write_image(&[20, 40, 60], 1, 1, image::ExtendedColorType::Rgb8).unwrap();
        assert_eq!(super::super::Engine::from_image(&png).unwrap().width(), 1);
    }
}
