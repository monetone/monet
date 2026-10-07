use monet_photo_core::{DevelopFrame, PixelEncoding};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::{Read, Seek, SeekFrom, Write};

const MAX_STRIP_BYTES: u64 = 16 * 1024 * 1024;
pub const COLOR_MATRIX: [[i32; 2]; 9] = [
    [3_134_112, 1_000_000],
    [-1_617_392, 1_000_000],
    [-490_633, 1_000_000],
    [-978_787, 1_000_000],
    [1_916_280, 1_000_000],
    [33_455, 1_000_000],
    [71_983, 1_000_000],
    [-228_986, 1_000_000],
    [1_405_385, 1_000_000],
];

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LinearDngMetadata {
    pub width: u32,
    pub height: u32,
    pub bits_per_sample: u16,
    pub samples_per_pixel: u16,
    pub orientation: u16,
    pub photometric: u16,
    pub output_digest: String,
    pub bytes: u64,
    pub strip_count: usize,
    pub rows_per_strip: u32,
    pub color_matrix: [[i32; 2]; 9],
    pub provenance: serde_json::Value,
    pub expected_pixel_digest: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PixelValidation {
    pub sample_count: u64,
    pub expected_pixel_digest: String,
    pub decoded_pixel_digest: String,
    pub maximum_lsb_difference: u16,
    pub count_over_one_lsb: u64,
}

/// The bounded read-chunk size used while independently stream-decoding
/// emitted strips — never larger than the documented 1 MiB stream bound
/// (`dng::STREAM_BUFFER`), regardless of how large a single strip is (up to
/// the writer's own 16 MiB strip cap).
const COMPARE_CHUNK_BYTES: usize = crate::dng::STREAM_BUFFER;

/// Independently prove the emitted RGB16 strips match the developed frame:
/// re-derive the expected samples from `frame.pixels` through the pinned
/// inverse-sRGB LUT (a computation completely separate from the writer's
/// own generation loop), independently parse the TIFF strip layout and
/// stream-decode every strip's raw bytes in bounded chunks, then compare
/// element-wise while iterating. Never trusts a digest the writer itself
/// computed — this recomputes its own expected digest and its own decoded
/// digest from scratch, and never materializes a complete decoded or
/// expected pixel array (`decoded`/`expected` `Vec<u16>` buffers over the
/// full frame): only one `COMPARE_CHUNK_BYTES`-sized read buffer is ever
/// live, reused across strips and across chunks within a strip. The fixed
/// 128 KiB inverse LUT is small and stays resident, per the architecture
/// contract.
///
/// `file` must already be positioned anywhere; it is fully re-seeked here.
/// Returns `Err` if the sample counts disagree or the maximum per-sample
/// difference exceeds one LSB.
pub fn validate_linear_pixels<R: Read + Seek>(
    file: &mut R,
    frame: &DevelopFrame,
) -> Result<PixelValidation, String> {
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut header = [0; 8];
    file.read_exact(&mut header).map_err(|e| e.to_string())?;
    if &header[..4] != b"II*\0" {
        return Err("pixel validator requires little-endian classic TIFF".into());
    }
    let ifd = u32::from_le_bytes(header[4..8].try_into().unwrap()) as u64;
    file.seek(SeekFrom::Start(ifd)).map_err(|e| e.to_string())?;
    let mut count = [0; 2];
    file.read_exact(&mut count).map_err(|e| e.to_string())?;
    let count = u16::from_le_bytes(count);
    let mut offsets = None;
    let mut counts = None;
    for _ in 0..count {
        let mut e = [0; 12];
        file.read_exact(&mut e).map_err(|e| e.to_string())?;
        let tag = u16::from_le_bytes(e[..2].try_into().unwrap());
        if tag == 273 || tag == 279 {
            let n = u32::from_le_bytes(e[4..8].try_into().unwrap()) as usize;
            let at = u32::from_le_bytes(e[8..12].try_into().unwrap()) as u64;
            let resume = file.stream_position().map_err(|e| e.to_string())?;
            let values = if n == 1 {
                vec![at as u32]
            } else {
                file.seek(SeekFrom::Start(at)).map_err(|e| e.to_string())?;
                let mut raw = vec![0; n * 4];
                file.read_exact(&mut raw).map_err(|e| e.to_string())?;
                raw.chunks_exact(4)
                    .map(|c| u32::from_le_bytes(c.try_into().unwrap()))
                    .collect()
            };
            file.seek(SeekFrom::Start(resume))
                .map_err(|e| e.to_string())?;
            if tag == 273 {
                offsets = Some(values)
            } else {
                counts = Some(values)
            }
        }
    }
    let offsets = offsets.ok_or("missing strip offsets")?;
    let counts = counts.ok_or("missing strip counts")?;
    if offsets.len() != counts.len() {
        return Err("strip arrays differ".into());
    }

    // The expected total sample count is derived from the frame's own
    // dimensions — never from anything the writer/file claims — so a
    // corrupted or hostile strip layout that overstates its sample count
    // cannot walk `frame.pixels` out of bounds below.
    let total_expected = (frame.pixels.len() as u64 / 4)
        .checked_mul(3)
        .ok_or("Linear DNG expected sample count overflow")?;
    let lut = lut();
    let mut expected_hash = Sha256::new();
    let mut decoded_hash = Sha256::new();
    let mut maximum_lsb_difference: u16 = 0;
    let mut count_over_one_lsb: u64 = 0;
    let mut sample_index: u64 = 0;
    let mut chunk = vec![0u8; COMPARE_CHUNK_BYTES];

    for (o, c) in offsets.into_iter().zip(counts) {
        if c % 2 != 0 {
            return Err("Linear DNG strip byte count is not sample-aligned".into());
        }
        file.seek(SeekFrom::Start(o as u64))
            .map_err(|e| e.to_string())?;
        let mut remaining = c as u64;
        while remaining > 0 {
            // Bounded, reused buffer: never grows past
            // `COMPARE_CHUNK_BYTES`. `remaining` is always even (the strip
            // byte count was checked even above, and `COMPARE_CHUNK_BYTES`
            // is even), so `want` is always even too — a u16 sample never
            // straddles two reads.
            let want = remaining.min(COMPARE_CHUNK_BYTES as u64) as usize;
            debug_assert_eq!(want % 2, 0);
            let buf = &mut chunk[..want];
            file.read_exact(buf).map_err(|e| e.to_string())?;
            for pair in buf.chunks_exact(2) {
                if sample_index >= total_expected {
                    return Err(
                        "Linear DNG strip contains more samples than the developed frame provides"
                            .into(),
                    );
                }
                let pixel_index = (sample_index / 3) as usize;
                let channel = (sample_index % 3) as usize;
                let expected_sample = lut[frame.pixels[pixel_index * 4 + channel] as usize];
                let decoded_sample = u16::from_le_bytes([pair[0], pair[1]]);
                expected_hash.update(expected_sample.to_le_bytes());
                decoded_hash.update(decoded_sample.to_le_bytes());
                let diff = expected_sample.abs_diff(decoded_sample);
                maximum_lsb_difference = maximum_lsb_difference.max(diff);
                if diff > 1 {
                    count_over_one_lsb += 1;
                }
                sample_index += 1;
            }
            remaining -= want as u64;
        }
    }

    if sample_index != total_expected {
        return Err(format!(
            "Linear DNG decoded sample count {sample_index} does not match the {total_expected} expected from the developed frame"
        ));
    }
    if maximum_lsb_difference > 1 {
        return Err(format!(
            "Linear DNG pixel comparison exceeds one LSB (maximum difference {maximum_lsb_difference})"
        ));
    }
    Ok(PixelValidation {
        sample_count: sample_index,
        expected_pixel_digest: format!("{:x}", expected_hash.finalize()),
        decoded_pixel_digest: format!("{:x}", decoded_hash.finalize()),
        maximum_lsb_difference,
        count_over_one_lsb,
    })
}

struct Entry {
    tag: u16,
    typ: u16,
    count: u32,
    data: Vec<u8>,
}
fn shorts(v: &[u16]) -> Vec<u8> {
    v.iter().flat_map(|v| v.to_le_bytes()).collect()
}
fn longs(v: &[u32]) -> Vec<u8> {
    v.iter().flat_map(|v| v.to_le_bytes()).collect()
}
fn srationals(v: &[[i32; 2]]) -> Vec<u8> {
    v.iter()
        .flat_map(|v| [v[0].to_le_bytes(), v[1].to_le_bytes()].concat())
        .collect()
}
fn rationals(v: &[[u32; 2]]) -> Vec<u8> {
    v.iter()
        .flat_map(|v| [v[0].to_le_bytes(), v[1].to_le_bytes()].concat())
        .collect()
}
fn linear(v: u16) -> u16 {
    let x = v as f64 / 65535.0;
    let y = if x <= 0.04045 {
        x / 12.92
    } else {
        ((x + 0.055) / 1.055).powf(2.4)
    };
    (y * 65535.0).round().clamp(0.0, 65535.0) as u16
}
fn lut() -> Vec<u16> {
    (0..=u16::MAX).map(linear).collect()
}

/// Pure, checked, zero-allocation-beyond-`O(strip count)` classic-TIFF
/// strip-layout arithmetic for the Linear DNG writer. This is the only part
/// of the writer whose inputs scale with (attacker- or data-controlled)
/// image dimensions rather than the fixed ~24-tag IFD, so it is factored
/// out and tested in isolation: boundary layouts, the 16 MiB strip cap,
/// every `u64` overflow branch, and classic-TIFF `u32::MAX` file-size
/// rejection — all without ever allocating a multi-gigabyte buffer (a
/// rejection is provable from dimensions/counts alone, before any pixel
/// data is touched).
mod layout {
    use super::MAX_STRIP_BYTES;

    /// Per-strip row/byte-count plan. `counts[i]` is the exact byte length
    /// of strip `i` (the last strip may be shorter than `rows_per_strip`).
    #[derive(Debug)]
    pub struct StripPlan {
        pub rows_per_strip: u32,
        pub strip_count: u64,
        pub counts: Vec<u32>,
    }

    /// Reject a row whose byte size alone exceeds the strip cap, then
    /// compute how many whole rows fit in one strip and the exact byte
    /// count of every strip — using only checked `u64` arithmetic, and
    /// rejecting (never wrapping) if the strip count itself would exceed
    /// what a classic-TIFF `u32` entry count can represent.
    pub fn plan_strips(width: u32, height: u32) -> Result<StripPlan, String> {
        let row_bytes = u64::from(width)
            .checked_mul(6)
            .ok_or("Linear DNG row overflow")?;
        if row_bytes == 0 {
            return Err("Linear DNG requires nonzero width".into());
        }
        // A single row that alone exceeds the strip bound must be rejected
        // outright, never silently emitted as an oversized one-row
        // "strip" — the classic-TIFF strip contract is `rows_per_strip >=
        // 1` AND `strip_bytes <= MAX_STRIP_BYTES` together, not either
        // alone.
        if row_bytes > MAX_STRIP_BYTES {
            return Err("Linear DNG row exceeds the maximum strip size".into());
        }
        // `row_bytes <= MAX_STRIP_BYTES` was just proven, so this division
        // is always >= 1; the `.max(1)` only guards a degenerate
        // zero-height frame.
        let rows_per_strip = (MAX_STRIP_BYTES / row_bytes).min((height as u64).max(1)) as u32;
        let strip_count = (height as u64)
            .checked_add(rows_per_strip as u64)
            .and_then(|v| v.checked_sub(1))
            .ok_or("Linear DNG strip count overflow")?
            / (rows_per_strip as u64);
        if strip_count > u32::MAX as u64 {
            return Err("Linear DNG strip count exceeds classic TIFF".into());
        }
        let counts = (0..strip_count)
            .map(|i| {
                let first = i * rows_per_strip as u64;
                let rows = (height as u64 - first).min(rows_per_strip as u64);
                let bytes = rows
                    .checked_mul(row_bytes)
                    .ok_or("Linear DNG strip byte count overflow")?;
                u32::try_from(bytes).map_err(|_| "Linear DNG strip exceeds classic TIFF".into())
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(StripPlan {
            rows_per_strip,
            strip_count,
            counts,
        })
    }

    /// Compute each strip's absolute file offset starting at `pixel_start`,
    /// checked so the classic-TIFF `u32` offset space is never silently
    /// wrapped into: both the running byte cursor and the final file size
    /// use checked `u64` arithmetic, and the final size is proven `<=
    /// u32::MAX` before any offset is cast down. Zero-allocation beyond the
    /// returned `Vec<u32>`, sized by strip count (bounded), not by image
    /// byte size.
    pub fn plan_strip_offsets(pixel_start: u64, counts: &[u32]) -> Result<(Vec<u32>, u64), String> {
        let mut running = pixel_start;
        let mut offsets = Vec::with_capacity(counts.len());
        for &count in counts {
            let here = running;
            running = running
                .checked_add(count as u64)
                .ok_or("Linear DNG pixel layout overflow")?;
            offsets.push(u32::try_from(here).map_err(|_| "Linear DNG exceeds classic TIFF")?);
        }
        if running > u32::MAX as u64 {
            return Err("Linear DNG exceeds classic TIFF u32 limit".into());
        }
        Ok((offsets, running))
    }
}

pub fn write_linear_dng(
    file: &mut File,
    frame: &DevelopFrame,
    source_sha: &str,
    recipe_sha: &str,
    core_revision: &str,
    mut cancel: impl FnMut() -> Result<(), String>,
) -> Result<LinearDngMetadata, String> {
    if frame.encoding != PixelEncoding::SrgbEncodedU16Full {
        return Err("Linear DNG requires sRGB-encoded u16 develop output".into());
    }
    if frame.orientation.output_exif != 1 {
        return Err("Linear DNG requires normalized orientation".into());
    }
    if frame.pixels.chunks_exact(4).any(|p| p[3] != u16::MAX) {
        return Err("Linear DNG requires opaque alpha".into());
    }
    let plan = layout::plan_strips(frame.width, frame.height)?;
    let rows_per_strip = plan.rows_per_strip;
    let strips = plan.strip_count;
    let counts = plan.counts;
    let provenance = serde_json::json!({"schema":"monet-linear-dng-v1","sourceSha256":source_sha,"recipeSha256":recipe_sha,"coreRevision":core_revision,"workingSpace":"linear-srgb","colorimetricReference":"output-referred"});
    let mut description = serde_json::to_vec(&provenance).map_err(|e| e.to_string())?;
    description.push(0);
    let mut software = format!("Monet Galerie/{}", env!("CARGO_PKG_VERSION")).into_bytes();
    software.push(0);
    let mut model = b"Monet Galerie Linear sRGB".to_vec();
    model.push(0);
    let mut entries = vec![
        Entry {
            tag: 254,
            typ: 4,
            count: 1,
            data: longs(&[0]),
        },
        Entry {
            tag: 256,
            typ: 4,
            count: 1,
            data: longs(&[frame.width]),
        },
        Entry {
            tag: 257,
            typ: 4,
            count: 1,
            data: longs(&[frame.height]),
        },
        Entry {
            tag: 258,
            typ: 3,
            count: 3,
            data: shorts(&[16, 16, 16]),
        },
        Entry {
            tag: 259,
            typ: 3,
            count: 1,
            data: shorts(&[1]),
        },
        Entry {
            tag: 262,
            typ: 3,
            count: 1,
            data: shorts(&[34892]),
        },
        Entry {
            tag: 270,
            typ: 2,
            count: description.len() as u32,
            data: description,
        },
        Entry {
            tag: 273,
            typ: 4,
            count: strips as u32,
            data: vec![0; strips as usize * 4],
        },
        Entry {
            tag: 274,
            typ: 3,
            count: 1,
            data: shorts(&[1]),
        },
        Entry {
            tag: 277,
            typ: 3,
            count: 1,
            data: shorts(&[3]),
        },
        Entry {
            tag: 278,
            typ: 4,
            count: 1,
            data: longs(&[rows_per_strip]),
        },
        Entry {
            tag: 279,
            typ: 4,
            count: strips as u32,
            data: longs(&counts),
        },
        Entry {
            tag: 284,
            typ: 3,
            count: 1,
            data: shorts(&[1]),
        },
        Entry {
            tag: 305,
            typ: 2,
            count: software.len() as u32,
            data: software,
        },
        Entry {
            tag: 339,
            typ: 3,
            count: 3,
            data: shorts(&[1, 1, 1]),
        },
        Entry {
            tag: 50706,
            typ: 1,
            count: 4,
            data: vec![1, 2, 0, 0],
        },
        Entry {
            tag: 50707,
            typ: 1,
            count: 4,
            data: vec![1, 2, 0, 0],
        },
        Entry {
            tag: 50708,
            typ: 2,
            count: model.len() as u32,
            data: model,
        },
        Entry {
            tag: 50714,
            typ: 3,
            count: 3,
            data: shorts(&[0, 0, 0]),
        },
        Entry {
            tag: 50717,
            typ: 4,
            count: 3,
            data: longs(&[65535, 65535, 65535]),
        },
        Entry {
            tag: 50719,
            typ: 4,
            count: 2,
            data: longs(&[0, 0]),
        },
        Entry {
            tag: 50720,
            typ: 4,
            count: 2,
            data: longs(&[frame.width, frame.height]),
        },
        Entry {
            tag: 50721,
            typ: 10,
            count: 9,
            data: srationals(&COLOR_MATRIX),
        },
        Entry {
            tag: 50728,
            typ: 5,
            count: 3,
            data: rationals(&[[1, 1], [1, 1], [1, 1]]),
        },
        Entry {
            tag: 50778,
            typ: 3,
            count: 1,
            data: shorts(&[23]),
        },
        Entry {
            tag: 50879,
            typ: 3,
            count: 1,
            data: shorts(&[1]),
        },
    ];
    entries.sort_by_key(|e| e.tag);
    let ifd_bytes = 2u64 + (entries.len() as u64) * 12 + 4;
    let mut pool_offset = 8u64
        .checked_add(ifd_bytes)
        .ok_or("Linear DNG layout overflow")?;
    let mut offsets = vec![None; entries.len()];
    for (i, e) in entries.iter().enumerate() {
        if e.data.len() > 4 {
            if pool_offset % 2 != 0 {
                pool_offset += 1
            }
            offsets[i] = Some(pool_offset);
            pool_offset = pool_offset
                .checked_add(e.data.len() as u64)
                .ok_or("Linear DNG value pool overflow")?
        }
    }
    if pool_offset % 2 != 0 {
        pool_offset += 1
    }
    let pixel_start = pool_offset;
    let (strip_offsets, _file_size) = layout::plan_strip_offsets(pixel_start, &counts)?;
    let strip_entry = entries.iter_mut().find(|e| e.tag == 273).unwrap();
    strip_entry.data = longs(&strip_offsets);
    file.set_len(0).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    file.write_all(b"II*\0\x08\0\0\0")
        .map_err(|e| e.to_string())?;
    file.write_all(&(entries.len() as u16).to_le_bytes())
        .map_err(|e| e.to_string())?;
    for (i, e) in entries.iter().enumerate() {
        file.write_all(&e.tag.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&e.typ.to_le_bytes())
            .map_err(|e| e.to_string())?;
        file.write_all(&e.count.to_le_bytes())
            .map_err(|e| e.to_string())?;
        if let Some(offset) = offsets[i] {
            file.write_all(&(offset as u32).to_le_bytes())
                .map_err(|e| e.to_string())?
        } else {
            let mut inline = [0; 4];
            inline[..e.data.len()].copy_from_slice(&e.data);
            file.write_all(&inline).map_err(|e| e.to_string())?
        }
    }
    file.write_all(&0u32.to_le_bytes())
        .map_err(|e| e.to_string())?;
    for (i, e) in entries.iter().enumerate() {
        if let Some(offset) = offsets[i] {
            file.seek(SeekFrom::Start(offset))
                .map_err(|e| e.to_string())?;
            file.write_all(&e.data).map_err(|e| e.to_string())?
        }
    }
    file.seek(SeekFrom::Start(pixel_start))
        .map_err(|e| e.to_string())?;
    let lut = lut();
    let mut pixel_hash = Sha256::new();
    let mut buffer = Vec::with_capacity(MAX_STRIP_BYTES as usize);
    for strip in 0..strips {
        cancel()?;
        buffer.clear();
        let first = (strip * rows_per_strip as u64 * frame.width as u64) as usize;
        let pixels = ((counts[strip as usize] as u64) / 6) as usize;
        for p in frame.pixels.chunks_exact(4).skip(first).take(pixels) {
            for &v in &p[..3] {
                let v = lut[v as usize];
                let bytes = v.to_le_bytes();
                buffer.extend_from_slice(&bytes);
                pixel_hash.update(bytes)
            }
        }
        file.write_all(&buffer)
            .map_err(|e| format!("write Linear DNG pixels: {e}"))?
    }
    file.flush().map_err(|e| e.to_string())?;
    let bytes = file.stream_position().map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(0)).map_err(|e| e.to_string())?;
    let mut hash = Sha256::new();
    std::io::copy(&mut file.take(bytes), &mut HashWriter(&mut hash)).map_err(|e| e.to_string())?;
    Ok(LinearDngMetadata {
        width: frame.width,
        height: frame.height,
        bits_per_sample: 16,
        samples_per_pixel: 3,
        orientation: 1,
        photometric: 34892,
        output_digest: format!("{:x}", hash.finalize()),
        bytes,
        strip_count: strips as usize,
        rows_per_strip,
        color_matrix: COLOR_MATRIX,
        provenance,
        expected_pixel_digest: format!("{:x}", pixel_hash.finalize()),
    })
}
struct HashWriter<'a>(&'a mut Sha256);
impl Write for HashWriter<'_> {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.update(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use monet_photo_core::{AlphaMode, DecodeProvenance, OrientationState};
    #[test]
    fn linear_dng_reopens() {
        let frame = DevelopFrame::new(
            2,
            1,
            vec![0, 32768, 65535, 65535, 65535, 0, 32768, 65535],
            PixelEncoding::SrgbEncodedU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "test".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 2, 1],
                working_profile_digest: "00".repeat(32),
                decode_intent_digest: "00".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        )
        .unwrap();
        let path = std::env::temp_dir().join(format!("linear-{}.dng", std::process::id()));
        let mut file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        let m = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || Ok(()),
        )
        .unwrap();
        let pixels = validate_linear_pixels(&mut file, &frame).unwrap();
        assert_eq!(pixels.maximum_lsb_difference, 0);
        assert_eq!(pixels.count_over_one_lsb, 0);
        assert_eq!(pixels.sample_count, 6);
        drop(file);
        let e = crate::dng::classify(&mut File::open(&path).unwrap()).unwrap();
        assert_eq!(
            (e.class, e.width, e.height, e.photometric),
            (crate::dng::DngClass::LinearRaw, 2, 1, 34892)
        );
        // Exact required DNG 1.2 evidence and prohibited-tag absence: both
        // version fields are 1.2.0.0, orientation is normalized, sample
        // depth/format/count match RGB16, and no CFA evidence is present
        // (CFA/MakerNote/private tags are deliberately never emitted for a
        // LinearRaw derivative).
        assert_eq!(e.dng_version, Some([1, 2, 0, 0]));
        assert_eq!(e.backward_version, Some([1, 2, 0, 0]));
        assert_eq!(e.orientation, 1);
        assert_eq!(e.bits_per_sample, vec![16, 16, 16]);
        assert_eq!(e.samples_per_pixel, 3);
        assert_eq!(e.sample_format, vec![1, 1, 1]);
        assert_eq!(e.new_subfile_type, 0);
        assert_eq!(e.cfa_dimensions, None);
        assert_eq!(e.cfa_pattern, None);
        assert!(e.private_data.is_empty());
        assert_eq!(m.color_matrix, COLOR_MATRIX);
        assert_eq!(m.provenance["colorimetricReference"], "output-referred");
        assert_eq!(m.provenance["workingSpace"], "linear-srgb");
        assert_eq!(m.strip_count, 1);
        std::fs::remove_file(path).unwrap();
    }

    fn test_frame(width: u32, height: u32) -> DevelopFrame {
        DevelopFrame::new(
            width,
            height,
            vec![u16::MAX; width as usize * height as usize * 4],
            PixelEncoding::SrgbEncodedU16Full,
            OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "test".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, width, height],
                working_profile_digest: "00".repeat(32),
                decode_intent_digest: "00".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        )
        .unwrap()
    }

    fn temp_file(name: &str) -> (std::path::PathBuf, File) {
        let path = std::env::temp_dir().join(format!("{name}-{}.dng", std::process::id()));
        let file = std::fs::OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(true)
            .open(&path)
            .unwrap();
        (path, file)
    }

    #[test]
    fn rejects_a_row_wider_than_the_strip_bound_instead_of_emitting_an_oversized_strip() {
        // `DevelopFrame::new` itself caps width at `MAX_DIMENSION` (32,767 —
        // well under the point where a row alone would exceed 16 MiB), so
        // this constructs the struct directly to exercise the writer's own
        // defense-in-depth bound. `pixels` is empty and never read: the
        // row-size check runs before any pixel access.
        let frame = DevelopFrame {
            width: 3_000_000,
            height: 1,
            pixels: vec![],
            encoding: PixelEncoding::SrgbEncodedU16Full,
            orientation: OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            provenance: DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "test".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 3_000_000, 1],
                working_profile_digest: "00".repeat(32),
                decode_intent_digest: "00".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        };
        let (path, mut file) = temp_file("linear-oversized-row");
        let err = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || Ok(()),
        )
        .unwrap_err();
        assert!(err.contains("exceeds the maximum strip size"), "{err}");
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn rejects_a_classic_tiff_file_size_over_u32_max_before_touching_pixel_data() {
        // width=2,000,000 keeps each row (12,000,000 bytes) under the 16 MiB
        // strip cap, so `rows_per_strip=1` and `strips=height`; height=400
        // alone makes the summed strip bytes (~4.8 GB) exceed `u32::MAX`
        // (~4.29 GB) — no gigabyte-scale buffer is allocated because the
        // rejection fires from `counts`/offset arithmetic alone, strictly
        // before the pixel-writing loop ever reads `frame.pixels` (empty
        // and never touched here, via the same struct-literal bypass of
        // `DevelopFrame::new`'s dimension caps used above).
        let frame = DevelopFrame {
            width: 2_000_000,
            height: 400,
            pixels: vec![],
            encoding: PixelEncoding::SrgbEncodedU16Full,
            orientation: OrientationState {
                source_exif: 1,
                output_exif: 1,
            },
            provenance: DecodeProvenance {
                source_digest: "00".repeat(32),
                backend: "test".into(),
                backend_revision: "1".into(),
                decoder_version: "1".into(),
                active_area: [0, 0, 2_000_000, 400],
                working_profile_digest: "00".repeat(32),
                decode_intent_digest: "00".repeat(32),
                alpha_mode: AlphaMode::Opaque,
            },
        };
        let (path, mut file) = temp_file("linear-over-u32-max");
        let err = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || Ok(()),
        )
        .unwrap_err();
        assert!(
            err.contains("u32 limit") || err.contains("classic TIFF"),
            "{err}"
        );
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn per_strip_cancellation_stops_the_write_between_strips() {
        // At the maximum frame width (32,767, `DevelopFrame`'s own cap),
        // rows_per_strip is ~85; a height of 200 forces 3 strips, giving
        // multiple cancellation checkpoints.
        let frame = test_frame(32_767, 200);
        let (path, mut file) = temp_file("linear-cancel");
        let mut calls = 0;
        let err = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || {
                calls += 1;
                if calls >= 2 {
                    Err("develop job cancelled".into())
                } else {
                    Ok(())
                }
            },
        )
        .unwrap_err();
        assert_eq!(err, "develop job cancelled");
        // Exactly 2 checkpoints: strip 0 wrote, strip 1's checkpoint fired
        // and stopped it — not all 3 strips ran to completion.
        assert_eq!(calls, 2, "cancellation must stop the write between strips");
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    #[test]
    fn independent_validation_catches_a_corrupted_strip() {
        let frame = test_frame(2, 1);
        let (path, mut file) = temp_file("linear-corrupt");
        let m = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || Ok(()),
        )
        .unwrap();
        // Corrupt the first sample inside the pixel region — the source
        // frame is all-white (0xFFFF), so writing 0x0000 is guaranteed to
        // differ. The independent validator must catch this, not just
        // re-hash whatever the writer wrote.
        let pixel_region_start = m.bytes - (m.width as u64 * m.height as u64 * 6);
        file.seek(SeekFrom::Start(pixel_region_start)).unwrap();
        file.write_all(&[0x00, 0x00]).unwrap();
        file.flush().unwrap();
        let err = validate_linear_pixels(&mut file, &frame).unwrap_err();
        assert!(err.contains("exceeds one LSB"), "{err}");
        drop(file);
        std::fs::remove_file(path).unwrap();
    }

    // --- `layout` module: direct, allocation-free boundary/overflow tests -
    //
    // Calling `layout::plan_strips`/`layout::plan_strip_offsets` directly
    // (rather than only through `write_linear_dng`) lets these tests feed
    // adversarial `u64` values — like a `pixel_start` deliberately placed
    // near `u64::MAX` — that a real frame's small, fixed-size IFD/value
    // pool could never produce, proving the checked arithmetic itself is
    // correct rather than only "not reached by realistic inputs." No test
    // here allocates a buffer proportional to the tested size.

    #[test]
    fn plan_strips_produces_a_valid_boundary_layout() {
        // row_bytes = 2,000,000 * 6 = 12,000,000 (< 16 MiB cap); rows_per_strip
        // = 16,777,216 / 12,000,000 = 1. height=3 forces exactly 3 strips of
        // one row each, the last one identical in size to the others.
        let plan = layout::plan_strips(2_000_000, 3).unwrap();
        assert_eq!(plan.rows_per_strip, 1);
        assert_eq!(plan.strip_count, 3);
        assert_eq!(plan.counts, vec![12_000_000, 12_000_000, 12_000_000]);
    }

    #[test]
    fn plan_strips_rejects_a_row_over_the_strip_cap() {
        let err = layout::plan_strips(3_000_000, 1).unwrap_err();
        assert!(err.contains("exceeds the maximum strip size"), "{err}");
    }

    #[test]
    fn plan_strips_rejects_zero_width() {
        let err = layout::plan_strips(0, 10).unwrap_err();
        assert!(err.contains("nonzero width"), "{err}");
    }

    #[test]
    fn plan_strip_offsets_rejects_a_running_total_over_u32_max_without_wrapping() {
        // A single strip whose own byte count is legal (`u32::MAX`), placed
        // at a small starting offset, pushes the running total just past
        // `u32::MAX` — this must be rejected, not silently wrapped into a
        // small offset.
        let err = layout::plan_strip_offsets(100, &[u32::MAX]).unwrap_err();
        assert!(err.contains("u32 limit"), "{err}");
    }

    #[test]
    fn plan_strip_offsets_rejects_checked_add_overflow_of_the_u64_running_total() {
        // `pixel_start` deliberately placed near `u64::MAX` so
        // `running.checked_add(count)` itself overflows `u64` — a case a
        // real writer (whose `pixel_start` is at most a few hundred bytes)
        // could never reach, but the checked arithmetic must still refuse
        // to wrap rather than panic or silently succeed.
        let err = layout::plan_strip_offsets(u64::MAX - 10, &[100]).unwrap_err();
        assert!(err.contains("overflow"), "{err}");
    }

    #[test]
    fn plan_strip_offsets_rejects_checked_narrowing_instead_of_wrapping() {
        // `pixel_start` already exceeds `u32::MAX` before any strip is even
        // considered: `u32::try_from(here)` must fail outright rather than
        // truncating to an in-range-looking `u32`.
        let over = u32::MAX as u64 + 1;
        let err = layout::plan_strip_offsets(over, &[10]).unwrap_err();
        assert!(err.contains("exceeds classic TIFF"), "{err}");
    }

    #[test]
    fn plan_strip_offsets_accepts_a_layout_exactly_at_the_u32_max_boundary() {
        // The very last valid byte of a classic-TIFF file: running lands
        // exactly on `u32::MAX`, which must be accepted (only *exceeding*
        // it is rejected).
        let start = (u32::MAX - 10) as u64;
        let (offsets, size) = layout::plan_strip_offsets(start, &[10]).unwrap();
        assert_eq!(offsets, vec![start as u32]);
        assert_eq!(size, u32::MAX as u64);
    }

    /// Wraps a `File` and records the largest single `read()` request it
    /// ever received — the only reliable way to prove, from a unit test,
    /// that a "streaming" comparison never grew a buffer to cover a whole
    /// strip (or the whole file). `validate_linear_pixels` is generic over
    /// `Read + Seek` specifically so this probe can be substituted for the
    /// concrete `File` used everywhere else.
    struct ReadProbe<'a> {
        inner: &'a mut File,
        max_read_len: usize,
        calls: usize,
    }
    impl Read for ReadProbe<'_> {
        fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
            self.calls += 1;
            self.max_read_len = self.max_read_len.max(buf.len());
            self.inner.read(buf)
        }
    }
    impl Seek for ReadProbe<'_> {
        fn seek(&mut self, pos: SeekFrom) -> std::io::Result<u64> {
            self.inner.seek(pos)
        }
    }

    #[test]
    fn independent_validation_never_reads_more_than_the_documented_chunk_bound() {
        // 600x600 gives a single ~2.06 MiB strip (well over
        // `COMPARE_CHUNK_BYTES` = 1 MiB), forcing the comparison loop to
        // issue multiple bounded reads within one strip — proving both the
        // chunk-size bound and the chunk-boundary logic, without a
        // gigabyte-scale allocation (frame.pixels here is ~2.7 MB).
        let frame = test_frame(600, 600);
        let (path, mut file) = temp_file("linear-chunk-bound");
        let m = write_linear_dng(
            &mut file,
            &frame,
            &"00".repeat(32),
            &"11".repeat(32),
            "test",
            || Ok(()),
        )
        .unwrap();
        assert_eq!(m.strip_count, 1, "test assumes a single >1MiB strip");
        let mut probe = ReadProbe {
            inner: &mut file,
            max_read_len: 0,
            calls: 0,
        };
        let pixels = validate_linear_pixels(&mut probe, &frame).unwrap();
        assert_eq!(pixels.maximum_lsb_difference, 0);
        assert_eq!(pixels.sample_count, 600 * 600 * 3);
        assert!(
            probe.max_read_len <= COMPARE_CHUNK_BYTES,
            "single read of {} bytes exceeded the documented {} byte bound",
            probe.max_read_len,
            COMPARE_CHUNK_BYTES
        );
        assert!(
            probe.calls > 1,
            "a single strip over the chunk bound must be read in more than one call"
        );
        drop(probe);
        drop(file);
        std::fs::remove_file(path).unwrap();
    }
}
