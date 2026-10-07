// ─────────────────────────────────────────────────────────────
// Compression/decompression helpers shared by the format readers and writers:
//   • PackBits        — PSD RLE channel rows (compression code 1)
//   • zlib            — PSD ZIP channels (codes 2/3) + XCF v11 zlib tiles
//   • ZIP prediction  — PSD code 3 horizontal delta prediction
//   • GIMP per-plane RLE — XCF tile planes (PROP_COMPRESSION 1)
// ─────────────────────────────────────────────────────────────

use crate::import::error::{FormatError, Result};
use crate::import::reader::Reader;

/// Decode an Apple PackBits stream (PSD compression code 1) to exactly
/// `expected` bytes. Trailing bytes in `src` past the last needed output are
/// ignored, which lets a whole channel's concatenated rows decode in one pass.
pub fn packbits_decode(src: &[u8], expected: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(expected);
    let mut i = 0usize;
    while out.len() < expected {
        if i >= src.len() {
            return Err(FormatError::Decompress(format!(
                "packbits underrun: produced {} of {expected}",
                out.len()
            )));
        }
        let n = src[i] as i8;
        i += 1;
        if n == -128 {
            // no-op
        } else if n >= 0 {
            let count = n as usize + 1;
            if i + count > src.len() {
                return Err(FormatError::Decompress("packbits literal overrun".into()));
            }
            out.extend_from_slice(&src[i..i + count]);
            i += count;
        } else {
            let count = (1 - n as i32) as usize; // (-n + 1) copies
            if i >= src.len() {
                return Err(FormatError::Decompress("packbits run overrun".into()));
            }
            let v = src[i];
            i += 1;
            out.resize(out.len() + count, v);
        }
    }
    out.truncate(expected);
    Ok(out)
}

/// Append `src` PackBits-packed to `out` — the inverse of `packbits_decode`
/// and the PSD/PSB channel encoding behind compression code 1. PSD packs every
/// channel row on its own (the row-count table indexes each packed row), so
/// call this once per row. Greedy: runs of >=3 identical bytes become run
/// packets, everything else literal packets, both capped at 128 bytes.
pub fn packbits_encode(src: &[u8], out: &mut Vec<u8>) {
    let n = src.len();
    let mut i = 0usize;
    while i < n {
        let mut run = 1usize;
        while i + run < n && src[i + run] == src[i] && run < 128 {
            run += 1;
        }
        if run >= 3 {
            out.push((257 - run) as u8); // header -(run - 1) as i8
            out.push(src[i]);
            i += run;
        } else {
            let start = i;
            i += 1; // src[start] is not the head of a run
            while i < n && i - start < 128 && !(i + 2 < n && src[i + 1] == src[i] && src[i + 2] == src[i]) {
                i += 1;
            }
            out.push((i - start - 1) as u8); // header len - 1
            out.extend_from_slice(&src[start..i]);
        }
    }
}

/// Inflate a zlib stream (RFC 1950, `0x78 …`) to at most `expected` bytes.
/// Used for PSD ZIP channels and XCF v11 zlib tiles.
pub fn zlib_inflate(src: &[u8], expected: usize) -> Result<Vec<u8>> {
    miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(src, expected.max(1))
        .map_err(|e| FormatError::Decompress(format!("zlib inflate failed: {:?}", e.status)))
}

/// Inflate a bounded zlib stream and require the exact decoded byte count.
/// PSD channels are fixed-size planes; accepting a short stream would otherwise
/// turn truncation into zero-filled pixels in the 8-bit compatibility path.
pub fn zlib_inflate_exact(src: &[u8], expected: usize) -> Result<Vec<u8>> {
    let data = zlib_inflate(src, expected)?;
    if data.len() != expected {
        return Err(FormatError::Decompress(format!(
            "zlib size mismatch: produced {} of {expected}",
            data.len()
        )));
    }
    Ok(data)
}

/// Encode big-endian f32 rows as PSD ZIP-with-prediction (compression code 3).
/// Shuffle each row to MSB-first byte planes, then byte-difference across the
/// entire row. One zlib stream holds all rows, including merged channel planes.
pub fn zip_predict_f32_encode(src: &[u8], row_bytes: usize) -> Result<Vec<u8>> {
    if !src.is_empty() && (row_bytes == 0 || row_bytes % 4 != 0 || src.len() % row_bytes != 0) {
        return Err(FormatError::Malformed(
            "Photoshop float channel rows do not match their bounds".into(),
        ));
    }
    let mut predicted = vec![0u8; src.len()];
    if !src.is_empty() {
        let width = row_bytes / 4;
        for (row, out) in src.chunks_exact(row_bytes).zip(predicted.chunks_exact_mut(row_bytes)) {
            for (x, sample) in row.chunks_exact(4).enumerate() {
                for b in 0..4 {
                    out[b * width + x] = sample[b];
                }
            }
            for x in (1..row_bytes).rev() {
                out[x] = out[x].wrapping_sub(out[x - 1]);
            }
        }
    }
    Ok(miniz_oxide::deflate::compress_to_vec_zlib(&predicted, 6))
}

/// Reverse PSD "ZIP with prediction" (compression code 3): inflate, then undo
/// the per-row horizontal prediction. `sample_bytes` is 1 (8-bit), 2 (16-bit),
/// or 4 (32-bit float — the TIFF "floating point" predictor).
pub fn zip_predicted(
    src: &[u8],
    width: usize,
    height: usize,
    sample_bytes: usize,
) -> Result<Vec<u8>> {
    let expected = width
        .checked_mul(height)
        .and_then(|samples| samples.checked_mul(sample_bytes))
        .ok_or_else(|| FormatError::Malformed("ZIP-predicted byte count overflow".into()))?;
    let mut data = zlib_inflate_exact(src, expected)?;
    match sample_bytes {
        1 => {
            for row in 0..height {
                let base = row * width;
                for x in 1..width {
                    data[base + x] = data[base + x].wrapping_add(data[base + x - 1]);
                }
            }
        }
        2 => {
            // 16-bit samples are big-endian; the delta is on the 16-bit value.
            for row in 0..height {
                let base = row * width * 2;
                for x in 1..width {
                    let prev = ((data[base + (x - 1) * 2] as u16) << 8)
                        | data[base + (x - 1) * 2 + 1] as u16;
                    let cur = ((data[base + x * 2] as u16) << 8) | data[base + x * 2 + 1] as u16;
                    let v = cur.wrapping_add(prev);
                    data[base + x * 2] = (v >> 8) as u8;
                    data[base + x * 2 + 1] = (v & 0xFF) as u8;
                }
            }
        }
        4 => {
            // 32-bit float channels use the TIFF floating-point predictor: each
            // row's width*4 bytes are byte-delta predicted, then stored
            // byte-planar (all sample byte-0s, then all byte-1s, …, MSB-first).
            // Undo the delta, then de-planarize back to interleaved big-endian
            // f32 samples (which plane_to_u8 reads via f32::from_be_bytes).
            let stride = width * 4;
            let mut row = vec![0u8; stride];
            for y in 0..height {
                let base = y * stride;
                for x in 1..stride {
                    data[base + x] = data[base + x].wrapping_add(data[base + x - 1]);
                }
                for i in 0..width {
                    row[i * 4] = data[base + i];
                    row[i * 4 + 1] = data[base + width + i];
                    row[i * 4 + 2] = data[base + 2 * width + i];
                    row[i * 4 + 3] = data[base + 3 * width + i];
                }
                data[base..base + stride].copy_from_slice(&row);
            }
        }
        _ => {
            return Err(FormatError::Unsupported(format!(
                "ZIP-with-prediction PSD channels at {sample_bytes} bytes/sample"
            )))
        }
    }
    data.truncate(expected);
    Ok(data)
}

/// Decode one GIMP RLE plane (XCF PROP_COMPRESSION 1) of exactly `size` bytes,
/// advancing the reader. Canonical `xcf-load.c` scheme: the escape to a u16
/// length fires when the *computed* short length equals 128 (control byte 127
/// for runs, 128 for literals) — NOT at 128/129 as some docs state.
pub fn gimp_rle_plane(r: &mut Reader, size: usize) -> Result<Vec<u8>> {
    let mut out = Vec::with_capacity(size);
    while out.len() < size {
        let op = r.u8()? as usize;
        if op < 128 {
            // run
            let mut length = op + 1;
            if length == 128 {
                length = r.u16()? as usize;
            }
            let v = r.u8()?;
            if out.len() + length > size {
                return Err(FormatError::Decompress("xcf rle run overrun".into()));
            }
            out.resize(out.len() + length, v);
        } else {
            // literal
            let mut length = 256 - op;
            if length == 128 {
                length = r.u16()? as usize;
            }
            if out.len() + length > size {
                return Err(FormatError::Decompress("xcf rle literal overrun".into()));
            }
            for _ in 0..length {
                out.push(r.u8()?);
            }
        }
    }
    Ok(out)
}

/// Encode one plane with GIMP RLE (used only by the test-fixture generator and
/// round-trip tests). Greedy: emit runs for >=2 identical bytes, literals
/// otherwise; uses the long (u16) escape for runs over 127.
pub fn gimp_rle_encode_plane(data: &[u8]) -> Vec<u8> {
    let mut out = Vec::new();
    let mut i = 0usize;
    let n = data.len();
    while i < n {
        // Measure the run of identical bytes starting at i.
        let mut run = 1usize;
        while i + run < n && data[i + run] == data[i] && run < 0xFFFF {
            run += 1;
        }
        if run >= 3 {
            if run <= 127 {
                out.push((run - 1) as u8); // opcode 0..126
                out.push(data[i]);
            } else {
                out.push(127); // long-run escape
                out.push((run >> 8) as u8);
                out.push((run & 0xFF) as u8);
                out.push(data[i]);
            }
            i += run;
        } else {
            // Gather a literal chunk (<=127 bytes) until the next >=2 run.
            let start = i;
            while i < n {
                let same_ahead = i + 1 < n && data[i + 1] == data[i];
                if same_ahead {
                    break;
                }
                i += 1;
                if i - start == 127 {
                    break;
                }
            }
            let len = i - start;
            out.push((256 - len) as u8); // opcode 129..255 → literal length 127..1
            out.extend_from_slice(&data[start..start + len]);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn packbits_round_basic() {
        // 3 literal bytes (n=2) then a run of 5 of 0xAB (n = 1-(-4)=5 => n=-4)
        let src = [0x02, 0x10, 0x20, 0x30, (-4i8) as u8, 0xAB];
        let out = packbits_decode(&src, 8).unwrap();
        assert_eq!(out, [0x10, 0x20, 0x30, 0xAB, 0xAB, 0xAB, 0xAB, 0xAB]);
    }

    #[test]
    fn packbits_encode_round_trips_and_packs_runs() {
        let cases: Vec<Vec<u8>> = vec![
            vec![0u8; 1000],                                     // runs > 128 split
            (0..300u32).map(|x| (x * 37 % 251) as u8).collect(), // literals > 128 split
            {
                let mut v = vec![0u8; 50];
                v.extend([1, 2, 3, 3, 4, 5, 5, 5, 6]);
                v.extend(std::iter::repeat(9u8).take(130));
                v.extend([7, 7, 8]);
                v
            },
            vec![42],
            vec![],
        ];
        for data in cases {
            let mut enc = Vec::new();
            packbits_encode(&data, &mut enc);
            let dec = packbits_decode(&enc, data.len()).unwrap();
            assert_eq!(dec, data, "packbits mismatch (len {})", data.len());
            // Every packed byte is consumed: no trailing packets past the row.
            assert!(
                packbits_decode(&enc[..enc.len().saturating_sub(1)], data.len()).is_err()
                    || data.is_empty()
            );
        }
        // A solid row packs to 2 bytes per 128: the whole point of the codec.
        let mut solid = Vec::new();
        packbits_encode(&[0u8; 1024], &mut solid);
        assert_eq!(solid.len(), 16);
        // An incompressible row costs one header byte per 128.
        let noise: Vec<u8> = (0..256u32).map(|x| (x * 37 % 251) as u8).collect();
        let mut packed = Vec::new();
        packbits_encode(&noise, &mut packed);
        assert_eq!(packed.len(), 258);
    }

    #[test]
    fn gimp_rle_round_trips() {
        // A few shapes: long solid run, alternating literals, mixed.
        let cases: Vec<Vec<u8>> = vec![
            vec![7u8; 300],                                      // long run > 127 -> u16 escape
            (0..200u32).map(|x| (x * 37 % 251) as u8).collect(), // mostly literals
            {
                let mut v = vec![0u8; 50];
                v.extend(std::iter::repeat(9u8).take(130));
                v.extend([1, 2, 3, 4, 5]);
                v
            },
            vec![],
        ];
        for data in cases {
            let enc = gimp_rle_encode_plane(&data);
            let mut r = Reader::new(&enc);
            let dec = gimp_rle_plane(&mut r, data.len()).unwrap();
            assert_eq!(dec, data, "rle plane mismatch (len {})", data.len());
            assert_eq!(r.remaining(), 0, "decoder left trailing bytes");
        }
    }

    #[test]
    fn zip_prediction_32bit_float_round_trips() {
        // Independent byte fixture checks shuffling, differences across byte
        // planes, and resetting prediction at each row (not a symmetric bug).
        let raw: Vec<u8> = [1.0f32, 2.0, -0.5, 4.0].iter().flat_map(|f| f.to_be_bytes()).collect();
        let compressed = zip_predict_f32_encode(&raw, 8).unwrap();
        assert_eq!(zlib_inflate_exact(&compressed, 16).unwrap(), [
            0x3f, 0x01, 0x40, 0x80, 0, 0, 0, 0,
            0xbf, 0x81, 0xc0, 0x80, 0x80, 0, 0, 0,
        ]);
        assert_eq!(zip_predicted(&compressed, 2, 2, 4).unwrap(), raw);

        for width in [1usize, 5, 129] {
            let raw: Vec<u8> = (0..width * 3)
                .flat_map(|i| [100_000.25f32, -0.25, -0.0, f32::from_bits(1), 0.1][i % 5].to_be_bytes())
                .collect();
            let compressed = zip_predict_f32_encode(&raw, width * 4).unwrap();
            assert_eq!(zip_predicted(&compressed, width, 3, 4).unwrap(), raw);
        }
        let empty = zip_predict_f32_encode(&[], 0).unwrap();
        assert!(zip_predicted(&empty, 0, 0, 4).unwrap().is_empty());
        for row_bytes in [0, 3, 8, usize::MAX] {
            assert!(zip_predict_f32_encode(&[0; 4], row_bytes).is_err());
        }
    }

    #[test]
    fn gimp_rle_decodes_long_literal_escape() {
        // Hand-craft an opcode-128 long literal of 3 bytes, which the greedy
        // encoder never emits but real GIMP writers can.
        let mut enc = vec![128u8, 0x00, 0x03, 0xAA, 0xBB, 0xCC];
        enc.push(0x00); // short run of 1 of 0x00 to round out
        enc.push(0xFF);
        let mut r = Reader::new(&enc);
        let dec = gimp_rle_plane(&mut r, 4).unwrap();
        assert_eq!(dec, [0xAA, 0xBB, 0xCC, 0xFF]);
    }
}
