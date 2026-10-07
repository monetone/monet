// Photoshop's plug-in file formats the `image` crate does not read (#466):
// JPEG 2000 (open + save), Cineon/DPX, Amiga IFF, DICOM (open) and
// headerless Photoshop Raw (open + save). Every decoder refuses an
// out-of-budget size before it allocates and hands back an
// `image::DynamicImage`, so Open, Place, Import and Load Files into Stack
// treat these files like any other decoded image.

use super::dims_ok;
use image::{DynamicImage, ImageBuffer};

const OUT_OF_RANGE: &str = "image dimensions out of range";
const UNDEFINED: u32 = u32::MAX;

/// Decode `bytes` when their signature names one of these formats; `None`
/// leaves them to the `image` crate. Headerless Photoshop Raw has no
/// signature, so it only opens through `decode_photoshop_raw`.
pub(super) fn decode(bytes: &[u8]) -> Option<Result<DynamicImage, String>> {
    if jpeg2000_format(bytes).is_some() {
        return Some(decode_jpeg2000(bytes));
    }
    match bytes.get(..4)? {
        [0x80, 0x2A, 0x5F, 0xD7] | [0xD7, 0x5F, 0x2A, 0x80] => Some(decode_cineon(bytes)),
        b"SDPX" | b"XPDS" => Some(decode_dpx(bytes)),
        b"FORM" if matches!(bytes.get(8..12), Some(b"ILBM" | b"PBM ")) => Some(decode_iff(bytes)),
        _ if bytes.get(128..132) == Some(b"DICM") => Some(decode_dicom(bytes)),
        _ => None,
    }
}

/// `v` of a `max`-valued sample, rescaled to the full 16-bit range.
fn scale16(v: u32, max: u32) -> u16 {
    let max = max.max(1) as u64;
    ((v as u64).min(max) * 65535 / max) as u16
}

/// Interleaved 16-bit samples as an image: grey, grey+alpha, RGB or RGBA.
/// `deep` false narrows to 8 bits, which opens an 8-bit document.
fn image_from_samples(w: u32, h: u32, channels: usize, deep: bool, samples: Vec<u16>) -> Result<DynamicImage, String> {
    let mismatch = || "decoded sample count does not match the image size".to_string();
    let img = match channels {
        1 => DynamicImage::ImageLuma16(ImageBuffer::from_raw(w, h, samples).ok_or_else(mismatch)?),
        2 => DynamicImage::ImageLumaA16(ImageBuffer::from_raw(w, h, samples).ok_or_else(mismatch)?),
        3 => DynamicImage::ImageRgb16(ImageBuffer::from_raw(w, h, samples).ok_or_else(mismatch)?),
        4 => DynamicImage::ImageRgba16(ImageBuffer::from_raw(w, h, samples).ok_or_else(mismatch)?),
        n => return Err(format!("{n}-channel images are not supported")),
    };
    Ok(match (deep, channels) {
        (true, _) => img,
        (false, 1) => DynamicImage::ImageLuma8(img.to_luma8()),
        (false, 2) => DynamicImage::ImageLumaA8(img.to_luma_alpha8()),
        (false, 3) => DynamicImage::ImageRgb8(img.to_rgb8()),
        (false, _) => DynamicImage::ImageRgba8(img.to_rgba8()),
    })
}

/// The composite as the planes a writer stores: luma for a Grayscale
/// document, else RGB, plus alpha when `alpha` and the composite is not
/// opaque. 16-bit (and 32-bit) documents write 16-bit samples.
fn planes(img: &DynamicImage, gray: bool, alpha: bool) -> (u8, Vec<Vec<u16>>) {
    let deep = !matches!(img, DynamicImage::ImageRgba8(_));
    let (bits, pixels): (u8, Vec<u16>) = if deep {
        (16, img.to_rgba16().into_raw())
    } else {
        (8, img.to_rgba8().into_raw().into_iter().map(u16::from).collect())
    };
    let opaque = if deep { 65535 } else { 255 };
    let keep_alpha = alpha && pixels.chunks_exact(4).any(|p| p[3] != opaque);
    let mut channels: Vec<usize> = if gray { vec![0] } else { vec![0, 1, 2] };
    if keep_alpha {
        channels.push(3);
    }
    let planes = channels
        .iter()
        .map(|&c| pixels.chunks_exact(4).map(|p| p[c]).collect())
        .collect();
    (bits, planes)
}

// ── JPEG 2000 ────────────────────────────────────────────────────────────

fn jpeg2000_format(bytes: &[u8]) -> Option<openjp2::Format> {
    if bytes.starts_with(b"\0\0\0\x0cjP  \r\n\x87\n") {
        Some(openjp2::Format::Jp2)
    } else if bytes.starts_with(&[0xFF, 0x4F, 0xFF, 0x51]) {
        Some(openjp2::Format::J2k)
    } else {
        None
    }
}

/// The component planes of a JP2 file or bare codestream, after the header
/// passes the document-size budget.
fn decode_jpeg2000_planes(bytes: &[u8]) -> Result<openjp2::Image, String> {
    let format = jpeg2000_format(bytes).ok_or("not a JPEG 2000 file")?;
    let failed = |e| format!("JPEG 2000 decode failed ({e})");
    let info = openjp2::Decoder::inspect(bytes, format).map_err(failed)?;
    if !dims_ok(info.width, info.height) {
        return Err(OUT_OF_RANGE.into());
    }
    // The decoder allocates a plane per component (a header can claim 16,384)
    // although only four are read: hold them to an RGBA document's budget.
    if u64::from(info.width) * u64::from(info.height) * u64::from(info.numcomps) > super::MAX_PIXELS * 4 {
        return Err(format!("the JPEG 2000 file's {} components are too large to open", info.numcomps));
    }
    let image = openjp2::Decoder::new(format).and_then(|mut d| d.decode_slice(bytes)).map_err(failed)?;
    if image.components.is_empty() {
        return Err("the JPEG 2000 file has no image components".into());
    }
    Ok(image)
}

/// Component `c`'s sample under image pixel (x, y), unsigned and rescaled to
/// 16 bits. Subsampled components repeat each sample (nearest neighbour).
fn jpeg2000_sample(c: &openjp2::ImageComponent, x: u32, y: u32) -> u16 {
    let cx = (x / c.dx.max(1)).min(c.width.saturating_sub(1));
    let cy = (y / c.dy.max(1)).min(c.height.saturating_sub(1));
    let v = c.data.get(cy as usize * c.width as usize + cx as usize).copied().unwrap_or(0) as i64;
    let prec = u32::from(c.precision.clamp(1, 31));
    let v = if c.signed { v + (1i64 << (prec - 1)) } else { v };
    scale16(v.clamp(0, u32::MAX as i64) as u32, (1u32 << prec) - 1)
}

/// Grey, grey+alpha, RGB or RGBA from the first four components; any
/// component deeper than 8 bits opens a 16-bit document.
fn decode_jpeg2000(bytes: &[u8]) -> Result<DynamicImage, String> {
    let image = decode_jpeg2000_planes(bytes)?;
    if image.x0 != 0 || image.y0 != 0 {
        return Err("JPEG 2000 images with a nonzero image origin are not supported".into());
    }
    let ycc = match image.color_space {
        openjp2::ColorSpace::Sycc => true,
        openjp2::ColorSpace::Eycc | openjp2::ColorSpace::Cmyk => {
            return Err(format!("JPEG 2000 {:?} colour is not supported", image.color_space));
        }
        _ => false,
    };
    let comps = &image.components[..image.components.len().min(4)];
    if ycc && comps.len() < 3 {
        return Err("JPEG 2000 sYCC images need three colour components".into());
    }
    let (w, h) = (image.width, image.height);
    let mut samples = Vec::with_capacity(w as usize * h as usize * comps.len());
    for y in 0..h {
        for x in 0..w {
            samples.extend(comps.iter().map(|c| jpeg2000_sample(c, x, y)));
        }
    }
    if ycc {
        let midpoint = |c: &openjp2::ImageComponent| {
            let bits = u32::from(c.precision.clamp(1, 31));
            scale16(1 << (bits - 1), (1 << bits) - 1)
        };
        for pixel in samples.chunks_exact_mut(comps.len()) {
            ycbcr_to_rgb(pixel, midpoint(&comps[1]), midpoint(&comps[2]));
        }
    }
    let deep = comps.iter().any(|c| c.precision > 8);
    image_from_samples(w, h, comps.len(), deep, samples)
}

/// Save As ▸ JPEG 2000. Lossless uses the reversible 5/3 wavelet, so the
/// samples decode bit-exact; otherwise `quality` (1–100) picks a compression
/// ratio from 1:1 up to about 125:1. `codestream` writes a bare `.j2k`
/// codestream instead of the JP2 container.
pub(super) fn encode_jpeg2000(img: &DynamicImage, gray: bool, lossless: bool, quality: u8, codestream: bool) -> Result<Vec<u8>, String> {
    let (w, h) = (img.width(), img.height());
    let (bits, planes) = planes(img, gray, true);
    let components = planes
        .into_iter()
        .map(|p| openjp2::ImageComponent::new(w, h, bits, false, p.into_iter().map(i32::from).collect()))
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| format!("JPEG 2000 encode failed ({e})"))?;
    let color_space = if gray { openjp2::ColorSpace::Greyscale } else { openjp2::ColorSpace::Srgb };
    let use_mct = components.len() >= 3;
    let image = openjp2::Image::new(w, h, color_space, components).map_err(|e| format!("JPEG 2000 encode failed ({e})"))?;
    let ratio = 1.05f32.powi(100 - i32::from(quality.clamp(1, 100)));
    let options = openjp2::EncodeOptions {
        format: if codestream { openjp2::Format::J2k } else { openjp2::Format::Jp2 },
        irreversible: !lossless,
        use_mct,
        // A rate of 0 is OpenJPEG's "no truncation": the whole lossless stream.
        rates: vec![if lossless { 0.0 } else { ratio }],
        ..openjp2::EncodeOptions::default()
    };
    let mut bytes = openjp2::Encoder::encode(&image, &options).map_err(|e| format!("JPEG 2000 encode failed ({e})"))?;
    let colors = if gray { 1 } else { 3 };
    if !codestream && image.components.len() > colors {
        // The crate's public ImageComponent has no alpha flag. Name the alpha
        // channel in JP2's cdef box so other readers preserve transparency.
        let channels = image.components.len() as u16;
        let mut cdef = Vec::from((10 + u32::from(channels) * 6).to_be_bytes());
        cdef.extend_from_slice(b"cdef");
        cdef.extend_from_slice(&channels.to_be_bytes());
        for channel in 0..channels {
            cdef.extend_from_slice(&channel.to_be_bytes());
            let (kind, association): (u16, u16) = if usize::from(channel) < colors { (0, channel + 1) } else { (1, 0) };
            cdef.extend_from_slice(&kind.to_be_bytes());
            cdef.extend_from_slice(&association.to_be_bytes());
        }
        let mut at = 0;
        loop {
            let header = bytes.get(at..at + 8).ok_or("JPEG 2000 encoder returned no JP2 header")?;
            let len = u32::from_be_bytes(header[..4].try_into().unwrap()) as usize;
            let end = at.checked_add(len).filter(|&end| len >= 8 && end <= bytes.len()).ok_or("JPEG 2000 encoder returned an invalid JP2 header")?;
            if &header[4..] == b"jp2h" {
                bytes[at..at + 4].copy_from_slice(&((len + cdef.len()) as u32).to_be_bytes());
                bytes.splice(end..end, cdef);
                break;
            }
            at = end;
        }
    }
    Ok(bytes)
}

/// Full-range YCbCr at 16-bit scale. The chroma midpoint follows the source
/// precision: 8-bit 128 scales to 32896, rather than 16-bit 32768.
fn ycbcr_to_rgb(pixel: &mut [u16], cb_midpoint: u16, cr_midpoint: u16) {
    let (y, cb, cr) = (f32::from(pixel[0]), f32::from(pixel[1]) - f32::from(cb_midpoint), f32::from(pixel[2]) - f32::from(cr_midpoint));
    let q = |v: f32| v.round().clamp(0.0, 65535.0) as u16;
    pixel[..3].copy_from_slice(&[q(y + 1.402 * cr), q(y - 0.344_136 * cb - 0.714_136 * cr), q(y + 1.772 * cb)]);
}

// ── Cineon / DPX ─────────────────────────────────────────────────────────

/// Fixed-offset header fields in the file's own byte order.
struct Header<'a> {
    bytes: &'a [u8],
    be: bool,
}

impl Header<'_> {
    fn field<const N: usize>(&self, at: usize) -> Result<[u8; N], String> {
        let mut raw: [u8; N] = self
            .bytes
            .get(at..at + N)
            .and_then(|s| s.try_into().ok())
            .ok_or("the file header is truncated")?;
        if !self.be {
            raw.reverse();
        }
        Ok(raw)
    }
    fn u8(&self, at: usize) -> Result<u8, String> {
        Ok(self.field::<1>(at)?[0])
    }
    fn u16(&self, at: usize) -> Result<u16, String> {
        Ok(u16::from_be_bytes(self.field(at)?))
    }
    fn u32(&self, at: usize) -> Result<u32, String> {
        Ok(u32::from_be_bytes(self.field(at)?))
    }
}

/// Film-scan samples, line by line: 8-bit bytes, 16-bit words, 12-bit one
/// per 16-bit word, and 10-bit three per 32-bit word. Filling method A
/// left-justifies (10-bit padding in the two low bits); method B right-
/// justifies. Each line starts on a 32-bit boundary and is followed by
/// `eol_pad` bytes. Returns 16-bit samples; the data stays as the file encodes it
/// (log film density opens as-is, like Photoshop).
#[allow(clippy::too_many_arguments)]
fn unpack_film(bytes: &[u8], offset: usize, w: u32, h: u32, channels: usize, bits: u8, method_b: bool, be: bool, eol_pad: usize) -> Result<Vec<u16>, String> {
    if !dims_ok(w, h) {
        return Err(OUT_OF_RANGE.into());
    }
    let per_line = w as usize * channels;
    let line_bytes = match bits {
        8 => per_line,
        12 | 16 => per_line * 2,
        10 => per_line.div_ceil(3) * 4,
        _ => return Err(format!("{bits}-bit film scans are not supported (8, 10, 12 and 16 bits are)")),
    };
    // Checked: the padding is a file field, and usize is 32 bits on wasm32.
    let stride = line_bytes.next_multiple_of(4).checked_add(eol_pad).ok_or("the image data is truncated")?;
    let end = stride
        .checked_mul(h as usize - 1)
        .and_then(|lines| lines.checked_add(line_bytes))
        .and_then(|len| len.checked_add(offset))
        .filter(|&end| end <= bytes.len())
        .ok_or("the image data is truncated")?;
    let data = &bytes[offset..end];
    let mut out = Vec::with_capacity(per_line * h as usize);
    for line in data.chunks(stride) {
        let line = &line[..line_bytes];
        let word16 = |at: usize| if be { u16::from_be_bytes([line[at], line[at + 1]]) } else { u16::from_le_bytes([line[at], line[at + 1]]) };
        match bits {
            8 => out.extend(line.iter().map(|&v| scale16(v.into(), 255))),
            16 => out.extend((0..per_line).map(|i| word16(i * 2))),
            12 => out.extend((0..per_line).map(|i| {
                let v = word16(i * 2);
                scale16(u32::from(if method_b { v & 0xFFF } else { v >> 4 }), 4095)
            })),
            _ => {
                let start = out.len();
                let shifts: [u32; 3] = if method_b { [20, 10, 0] } else { [22, 12, 2] };
                for word in line.chunks_exact(4) {
                    let word = [word[0], word[1], word[2], word[3]];
                    let word = if be { u32::from_be_bytes(word) } else { u32::from_le_bytes(word) };
                    out.extend(shifts.iter().map(|s| scale16((word >> s) & 0x3FF, 1023)));
                }
                // The last word of a line can carry up to two padding samples.
                out.truncate(start + per_line);
            }
        }
    }
    Ok(out)
}

/// Kodak Cineon: one image element of 1 or 3 pixel-interleaved channels,
/// 10-bit data three to a 32-bit word (method A), or 8/12/16-bit.
fn decode_cineon(bytes: &[u8]) -> Result<DynamicImage, String> {
    let head = Header { bytes, be: bytes[0] == 0x80 };
    let channels = usize::from(head.u8(193)?);
    if channels != 1 && channels != 3 {
        return Err(format!("Cineon files with {channels} channels are not supported (1 or 3 are)"));
    }
    if head.u8(680)? != 0 {
        return Err("line- or channel-interleaved Cineon files are not supported".into());
    }
    let bits = head.u8(198)?;
    let (w, h) = (head.u32(200)?, head.u32(204)?);
    let eol_pad = match head.u32(684)? {
        UNDEFINED => 0,
        pad => pad as usize,
    };
    let samples = unpack_film(bytes, head.u32(4)? as usize, w, h, channels, bits, false, head.be, eol_pad)?;
    image_from_samples(w, h, channels, bits > 8, samples)
}

/// SMPTE DPX: the first image element — luma (6), RGB (50), RGBA (51) or
/// ABGR (52) — uncompressed, at 8/10/12/16 bits.
fn decode_dpx(bytes: &[u8]) -> Result<DynamicImage, String> {
    let head = Header { bytes, be: &bytes[..4] == b"SDPX" };
    let (w, h) = (head.u32(772)?, head.u32(776)?);
    let descriptor = head.u8(800)?;
    let channels = match descriptor {
        6 => 1,
        50 => 3,
        51 | 52 => 4,
        other => return Err(format!("DPX image element descriptor {other} is not supported (luma, RGB, RGBA and ABGR are)")),
    };
    let bits = head.u8(803)?;
    let packing = head.u16(804)?;
    if head.u16(806)? != 0 {
        return Err("run-length encoded DPX files are not supported".into());
    }
    if packing == 0 && matches!(bits, 10 | 12) {
        return Err(format!("bit-packed {bits}-bit DPX files are not supported; save them with filled (method A) packing"));
    }
    let offset = match head.u32(808)? {
        0 | UNDEFINED => head.u32(4)?,
        element => element,
    };
    let eol_pad = match head.u32(812)? {
        UNDEFINED => 0,
        pad => pad as usize,
    };
    let mut samples = unpack_film(bytes, offset as usize, w, h, channels, bits, packing == 2, head.be, eol_pad)?;
    if descriptor == 52 {
        for px in samples.chunks_exact_mut(4) {
            px.reverse();
        }
    }
    image_from_samples(w, h, channels, bits > 8, samples)
}

// ── Amiga IFF (ILBM / PBM) ───────────────────────────────────────────────

/// ByteRun1 (PackBits), shared by IFF bodies and DICOM RLE: `n` in 0..=127
/// copies the next n+1 bytes, -127..=-1 repeats the next byte 1-n times, and
/// -128 is a no-op. Stops once `len` bytes are out.
fn unpack_bits(src: &[u8], len: usize) -> Result<Vec<u8>, String> {
    let truncated = || "the compressed image data is truncated".to_string();
    // `len` is what the header claims; two packed bytes yield 128 at most.
    let mut out = Vec::with_capacity(len.min(src.len().saturating_mul(64)));
    let mut i = 0;
    while out.len() < len {
        let n = *src.get(i).ok_or_else(truncated)? as i8;
        i += 1;
        match n {
            0..=127 => {
                let run = src.get(i..i + n as usize + 1).ok_or_else(truncated)?;
                out.extend_from_slice(run);
                i += run.len();
            }
            -127..=-1 => {
                let v = *src.get(i).ok_or_else(truncated)?;
                out.resize(out.len() + (1 - n as isize) as usize, v);
                i += 1;
            }
            _ => {}
        }
    }
    out.truncate(len);
    Ok(out)
}

/// Where the chunk after the one at `at` starts: past its 8-byte header, its
/// `size` bytes and the pad to an even length. `None` when that overflows —
/// the size is a file field, and usize is 32 bits on wasm32.
fn iff_next_chunk(at: usize, size: usize) -> Option<usize> {
    at.checked_add(8)?.checked_add(size)?.checked_add(size & 1)
}

/// Deluxe Paint ILBM (interleaved bitplanes: 1–8 indexed planes with EHB and
/// HAM6/HAM8, or 24/32-bit deep) and PBM (chunky 8-bit), uncompressed or
/// ByteRun1, with mask-plane or transparent-colour masking.
fn decode_iff(bytes: &[u8]) -> Result<DynamicImage, String> {
    let pbm = &bytes[8..12] == b"PBM ";
    let end = bytes.len().min(8usize.saturating_add(u32::from_be_bytes([bytes[4], bytes[5], bytes[6], bytes[7]]) as usize));
    let (mut bmhd, mut cmap, mut camg, mut body) = (None, Vec::new(), 0u32, None);
    let mut at = 12usize;
    while let Some(start) = at.checked_add(8).filter(|&start| start <= end) {
        let size = u32::from_be_bytes([bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]]) as usize;
        let data = &bytes[start..start.saturating_add(size).min(end)];
        match &bytes[at..at + 4] {
            b"BMHD" => bmhd = Some(data),
            b"CMAP" => cmap = data.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect(),
            b"CAMG" if data.len() >= 4 => camg = u32::from_be_bytes([data[0], data[1], data[2], data[3]]),
            b"BODY" => body = Some(data),
            _ => {}
        }
        // A chunk that claims more than the address space is the last one.
        let Some(next) = iff_next_chunk(at, size) else { break };
        at = next;
    }
    let bmhd = bmhd.filter(|b| b.len() >= 20).ok_or("the IFF file has no bitmap header (BMHD)")?;
    let body = body.ok_or("the IFF file has no image body (BODY)")?;
    let (w, h) = (u32::from(u16::from_be_bytes([bmhd[0], bmhd[1]])), u32::from(u16::from_be_bytes([bmhd[2], bmhd[3]])));
    let (planes, compression) = (usize::from(bmhd[8]), bmhd[10]);
    // A chunky PBM body has no mask plane, and a deep ILBM no colour index.
    let masking = match bmhd[9] {
        1 if pbm => 0,
        2 if planes > 8 => 0,
        masking => masking,
    };
    let transparent = usize::from(u16::from_be_bytes([bmhd[12], bmhd[13]]));
    if !dims_ok(w, h) {
        return Err(OUT_OF_RANGE.into());
    }
    if (pbm && planes != 8) || !(matches!(planes, 1..=8 | 24 | 32)) {
        return Err(format!("IFF images with {planes} bitplanes are not supported"));
    }
    let (w, h) = (w as usize, h as usize);
    let row_bytes = if pbm { w + (w & 1) } else { w.div_ceil(16) * 2 };
    let rows_per_line = if pbm { 1 } else { planes + usize::from(masking == 1) };
    let len = row_bytes * rows_per_line * h;
    let data = match compression {
        0 => body.get(..len).ok_or("the IFF image body is truncated")?.to_vec(),
        1 => unpack_bits(body, len)?,
        other => return Err(format!("IFF compression {other} is not supported")),
    };
    // Old 4-bit palettes store each gun in the high nibble; widen them.
    if !cmap.is_empty() && cmap.iter().flatten().all(|v| v & 0x0F == 0) {
        cmap.iter_mut().flatten().for_each(|v| *v |= *v >> 4);
    }
    if camg & 0x80 != 0 && planes == 6 && cmap.len() >= 32 {
        let half: Vec<[u8; 3]> = cmap[..32].iter().map(|c| c.map(|v| v >> 1)).collect();
        cmap.truncate(32);
        cmap.extend(half);
    }
    let ham = camg & 0x800 != 0 && matches!(planes, 6 | 8);
    let alpha = masking == 1 || masking == 2 || planes == 32;
    let channels = if alpha { 4 } else { 3 };
    let mut out = Vec::with_capacity(w * h * channels);
    for y in 0..h {
        let line = &data[y * row_bytes * rows_per_line..(y + 1) * row_bytes * rows_per_line];
        let bit = |plane: usize, x: usize| usize::from(line[plane * row_bytes + x / 8] >> (7 - x % 8) & 1);
        let mut hold = cmap.first().copied().unwrap_or([0; 3]);
        for x in 0..w {
            let value = |from: usize, count: usize| (0..count).fold(0, |v, p| v | bit(from + p, x) << p);
            let index = if pbm { usize::from(line[x]) } else if planes <= 8 { value(0, planes) } else { 0 };
            let rgb = if planes >= 24 {
                [value(0, 8) as u8, value(8, 8) as u8, value(16, 8) as u8]
            } else if ham {
                let bits = planes - 2;
                let v = index & ((1 << bits) - 1);
                let v8 = if bits == 4 { (v * 17) as u8 } else { (v << 2 | v >> 4) as u8 };
                match index >> bits {
                    0 => hold = cmap.get(v).copied().unwrap_or([0; 3]),
                    1 => hold[2] = v8,
                    2 => hold[0] = v8,
                    _ => hold[1] = v8,
                }
                hold
            } else if cmap.is_empty() {
                [(index * 255 / ((1usize << planes) - 1)) as u8; 3]
            } else {
                cmap.get(index).copied().unwrap_or([0; 3])
            };
            out.extend_from_slice(&rgb);
            if alpha {
                out.push(match masking {
                    1 => 255 * bit(planes, x) as u8,
                    2 if index == transparent => 0,
                    _ if planes == 32 => value(24, 8) as u8,
                    _ => 255,
                });
            }
        }
    }
    let (w, h) = (w as u32, h as u32);
    let mismatch = || "decoded sample count does not match the image size".to_string();
    Ok(if alpha {
        DynamicImage::ImageRgba8(ImageBuffer::from_raw(w, h, out).ok_or_else(mismatch)?)
    } else {
        DynamicImage::ImageRgb8(ImageBuffer::from_raw(w, h, out).ok_or_else(mismatch)?)
    })
}

// ── DICOM ────────────────────────────────────────────────────────────────

/// How a transfer syntax stores its pixel data.
#[derive(Clone, Copy, PartialEq)]
enum DicomPixels {
    Native,
    Jpeg,
    Jpeg2000,
    Rle,
}

/// The dataset encoding of a transfer syntax UID: (explicit VR, big endian,
/// pixel storage), or the actionable refusal for a compression Vision can't
/// decode.
fn dicom_syntax(uid: &str) -> Result<(bool, bool, DicomPixels), String> {
    Ok(match uid {
        "1.2.840.10008.1.2" => (false, false, DicomPixels::Native),
        "1.2.840.10008.1.2.1" => (true, false, DicomPixels::Native),
        "1.2.840.10008.1.2.2" => (true, true, DicomPixels::Native),
        "1.2.840.10008.1.2.4.50" => (true, false, DicomPixels::Jpeg),
        "1.2.840.10008.1.2.4.90" | "1.2.840.10008.1.2.4.91" | "1.2.840.10008.1.2.4.201"
        | "1.2.840.10008.1.2.4.202" | "1.2.840.10008.1.2.4.203" => (true, false, DicomPixels::Jpeg2000),
        "1.2.840.10008.1.2.5" => (true, false, DicomPixels::Rle),
        other => {
            let name = match other {
                "1.2.840.10008.1.2.1.99" => "Deflated Explicit VR Little Endian",
                "1.2.840.10008.1.2.4.51" => "JPEG Extended",
                "1.2.840.10008.1.2.4.57" | "1.2.840.10008.1.2.4.70" => "JPEG Lossless",
                "1.2.840.10008.1.2.4.80" | "1.2.840.10008.1.2.4.81" => "JPEG-LS",
                "1.2.840.10008.1.2.4.92" | "1.2.840.10008.1.2.4.93" => "JPEG 2000 Part 2",
                _ => "transfer syntax",
            };
            return Err(format!(
                "compressed DICOM ({name} {other}) isn't supported; convert it to an uncompressed transfer syntax (for example with gdcmconv --raw) and open it again"
            ));
        }
    })
}

/// A dataset walker for one Part-10 file.
struct Dicom<'a> {
    bytes: &'a [u8],
    explicit: bool,
    be: bool,
}

impl<'a> Dicom<'a> {
    fn u16(&self, at: usize) -> Result<u16, String> {
        let b = self.bytes.get(at..at + 2).ok_or("the DICOM file is truncated")?;
        Ok(if self.be { u16::from_be_bytes([b[0], b[1]]) } else { u16::from_le_bytes([b[0], b[1]]) })
    }
    fn u32(&self, at: usize) -> Result<u32, String> {
        let b = self.bytes.get(at..at + 4).ok_or("the DICOM file is truncated")?;
        let b = [b[0], b[1], b[2], b[3]];
        Ok(if self.be { u32::from_be_bytes(b) } else { u32::from_le_bytes(b) })
    }

    /// The element at `at`: (tag, value length, value offset). Items and
    /// delimiters never carry a VR.
    fn element(&self, at: usize) -> Result<(u32, u32, usize), String> {
        let tag = u32::from(self.u16(at)?) << 16 | u32::from(self.u16(at + 2)?);
        if tag >> 16 == 0xFFFE || !self.explicit {
            return Ok((tag, self.u32(at + 4)?, at + 8));
        }
        let vr = self.bytes.get(at + 4..at + 6).ok_or("the DICOM file is truncated")?;
        if matches!(vr, b"OB" | b"OD" | b"OF" | b"OL" | b"OV" | b"OW" | b"SQ" | b"SV" | b"UC" | b"UN" | b"UR" | b"UT" | b"UV") {
            Ok((tag, self.u32(at + 8)?, at + 12))
        } else {
            Ok((tag, u32::from(self.u16(at + 6)?), at + 8))
        }
    }

    /// The offset just past an element's value, walking undefined-length
    /// sequences item by item to their delimiter.
    fn skip(&self, len: u32, value: usize, depth: u8) -> Result<usize, String> {
        if len != UNDEFINED {
            return value.checked_add(len as usize).filter(|&end| end <= self.bytes.len()).ok_or_else(|| "the DICOM file is truncated".to_string());
        }
        if depth > 32 {
            return Err("the DICOM sequences nest too deeply".into());
        }
        let mut at = value;
        loop {
            let (tag, len, value) = self.element(at)?;
            match tag {
                // Sequence or item delimiter: the undefined-length value ends here.
                0xFFFE_E0DD | 0xFFFE_E00D => return Ok(value),
                _ => at = self.skip(len, value, depth + 1)?,
            }
        }
    }
}

/// The attributes a DICOM image needs, read up to its pixel data.
#[derive(Default)]
struct DicomImage {
    rows: u32,
    cols: u32,
    samples: usize,
    bits_allocated: u16,
    bits_stored: u16,
    signed: bool,
    planar: bool,
    frames: u32,
    photometric: String,
    slope: Option<f64>,
    intercept: Option<f64>,
    center: Option<f64>,
    width: Option<f64>,
    instance: Option<i32>,
    /// (length, offset) of Pixel Data (7FE0,0010).
    pixels: Option<(u32, usize)>,
}

/// First value of a decimal/integer string (DS/IS), multi-valued or padded.
fn dicom_number(value: &[u8]) -> Option<f64> {
    std::str::from_utf8(value).ok()?.split('\\').next()?.trim_matches(|c: char| c == '\0' || c.is_whitespace()).parse().ok()
}

fn dicom_text(value: &[u8]) -> String {
    String::from_utf8_lossy(value).trim_matches(|c: char| c == '\0' || c.is_whitespace()).to_string()
}

/// Walk a Part-10 file: the explicit-little-endian file meta group names the
/// transfer syntax, which then governs the dataset up to Pixel Data.
fn dicom_header(bytes: &[u8]) -> Result<(DicomImage, Dicom<'_>, DicomPixels), String> {
    if bytes.get(128..132) != Some(b"DICM") {
        return Err("not a DICOM Part-10 file".into());
    }
    let mut dicom = Dicom { bytes, explicit: true, be: false };
    let mut at = 132;
    let mut uid = String::new();
    while dicom.u16(at).is_ok_and(|group| group == 0x0002) {
        let (tag, len, value) = dicom.element(at)?;
        let end = dicom.skip(len, value, 0)?;
        if tag == 0x0002_0010 {
            uid = dicom_text(&bytes[value..end]);
        }
        at = end;
    }
    // A meta group without a transfer syntax means the Part-10 default.
    let (explicit, be, pixels) = dicom_syntax(if uid.is_empty() { "1.2.840.10008.1.2" } else { &uid })?;
    dicom.explicit = explicit;
    dicom.be = be;
    let mut meta = DicomImage { samples: 1, bits_allocated: 16, frames: 1, ..DicomImage::default() };
    while at < bytes.len() {
        let (tag, len, value) = dicom.element(at)?;
        if tag == 0x7FE0_0010 {
            meta.pixels = Some((len, value));
            break;
        }
        let end = dicom.skip(len, value, 0)?;
        let v = &bytes[value.min(end)..end];
        let us = || dicom.u16(value).unwrap_or(0);
        match tag {
            0x0020_0013 => meta.instance = dicom_number(v).map(|n| n as i32),
            0x0028_0002 => meta.samples = usize::from(us()),
            0x0028_0004 => meta.photometric = dicom_text(v),
            0x0028_0006 => meta.planar = us() == 1,
            0x0028_0008 => meta.frames = dicom_number(v).map_or(1, |n| n as u32),
            0x0028_0010 => meta.rows = u32::from(us()),
            0x0028_0011 => meta.cols = u32::from(us()),
            0x0028_0100 => meta.bits_allocated = us(),
            0x0028_0101 => meta.bits_stored = us(),
            0x0028_0103 => meta.signed = us() == 1,
            0x0028_1050 => meta.center = dicom_number(v),
            0x0028_1051 => meta.width = dicom_number(v),
            0x0028_1052 => meta.intercept = dicom_number(v),
            0x0028_1053 => meta.slope = dicom_number(v),
            _ => {}
        }
        at = end;
    }
    Ok((meta, dicom, pixels))
}

/// Instance Number (0020,0013), which orders a series for Load Multiple
/// DICOM Files; `None` for a file without one or that isn't DICOM.
pub(super) fn dicom_instance_number(bytes: &[u8]) -> Option<i32> {
    dicom_header(bytes).ok()?.0.instance
}

/// The first frame's bytes of encapsulated Pixel Data: every fragment when
/// the file holds one frame, else the fragments the Basic Offset Table gives
/// the first frame (just the first fragment without one).
fn dicom_first_frame(dicom: &Dicom, value: usize, frames: u32) -> Result<Vec<u8>, String> {
    let mut at = value;
    let mut items: Vec<&[u8]> = Vec::new();
    loop {
        let (tag, len, value) = dicom.element(at)?;
        if tag != 0xFFFE_E000 {
            break;
        }
        let end = dicom.skip(len, value, 0)?;
        items.push(&dicom.bytes[value..end]);
        at = end;
    }
    let (offsets, fragments) = items.split_first().ok_or("the DICOM pixel data has no fragments")?;
    let first_frame_end = offsets.get(4..8).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
    let mut frame = Vec::new();
    let mut offset = 0;
    for fragment in fragments {
        let done = match (frames > 1, first_frame_end) {
            (false, _) => false,
            (true, Some(end)) => offset >= end,
            (true, None) => !frame.is_empty(),
        };
        if done {
            break;
        }
        frame.extend_from_slice(fragment);
        offset += fragment.len() + 8;
    }
    Ok(frame)
}

/// Medical images: the first frame of a Part-10 file — MONOCHROME1/2
/// through the modality rescale and VOI window (or the data's own range when
/// the file has no window), or RGB / YBR_FULL colour — stored natively,
/// RLE-compressed, or encapsulated as baseline JPEG or JPEG 2000.
fn decode_dicom(bytes: &[u8]) -> Result<DynamicImage, String> {
    let (meta, dicom, storage) = dicom_header(bytes)?;
    let (len, value) = meta.pixels.ok_or("the DICOM file has no pixel data")?;
    let (w, h) = (meta.cols, meta.rows);
    if !dims_ok(w, h) {
        return Err(OUT_OF_RANGE.into());
    }
    let color = meta.samples == 3;
    if !color && meta.samples != 1 {
        return Err(format!("DICOM images with {} samples per pixel are not supported", meta.samples));
    }
    let gray = matches!(meta.photometric.as_str(), "MONOCHROME1" | "MONOCHROME2");
    if !gray && !matches!(meta.photometric.as_str(), "RGB" | "YBR_FULL" | "YBR_FULL_422" | "YBR_ICT" | "YBR_RCT") {
        return Err(format!("DICOM {} images are not supported", meta.photometric));
    }
    let bits_stored = if meta.bits_stored == 0 { meta.bits_allocated } else { meta.bits_stored.min(meta.bits_allocated) };
    let bytes_per = match meta.bits_allocated {
        8 => 1,
        16 => 2,
        other => return Err(format!("DICOM images with {other}-bit samples are not supported")),
    };
    let count = w as usize * h as usize * meta.samples;
    let stored = |raw: u32| -> i32 {
        let bits = u32::from(bits_stored.clamp(1, 16));
        let v = raw & ((1 << bits) - 1);
        if meta.signed && v >> (bits - 1) & 1 == 1 { v as i32 - (1 << bits) } else { v as i32 }
    };
    // Stored values, pixel-interleaved, plus the maximum of their range.
    let (mut samples, max, ycc): (Vec<i32>, u32, bool) = match storage {
        DicomPixels::Native => {
            let subsampled = meta.photometric == "YBR_FULL_422";
            if subsampled && (!color || meta.planar || w % 2 != 0) {
                return Err("native DICOM YBR_FULL_422 needs interleaved colour and an even width".into());
            }
            let stored_count = if subsampled { count / 3 * 2 } else { count };
            let end = value.checked_add(len as usize).filter(|_| len != UNDEFINED).ok_or("the DICOM pixel data is truncated")?;
            let data = dicom.bytes.get(value..end).filter(|d| d.len() >= stored_count * bytes_per).ok_or("the DICOM pixel data is truncated")?;
            let samples = (0..count)
                .map(|i| {
                    // Native 4:2:2 stores Y1,Y2,Cb,Cr for each pair of pixels.
                    let at = if subsampled { i / 6 * 4 + if i % 3 == 0 { i % 6 / 3 } else { i % 3 + 1 } } else { i };
                    stored(if bytes_per == 1 { u32::from(data[at]) } else { u32::from(dicom.u16(value + at * 2).unwrap_or(0)) })
                })
                .collect();
            (samples, (1 << bits_stored) - 1, meta.photometric.starts_with("YBR_FULL"))
        }
        DicomPixels::Rle => {
            let frame = dicom_first_frame(&dicom, value, meta.frames)?;
            let header = |i: usize| frame.get(i * 4..i * 4 + 4).map(|b| u32::from_le_bytes([b[0], b[1], b[2], b[3]]) as usize);
            let segments = meta.samples * bytes_per;
            if header(0) != Some(segments) {
                return Err("the DICOM RLE header does not match the image".into());
            }
            let pixels = w as usize * h as usize;
            let planes = (0..segments)
                .map(|s| {
                    let start = header(s + 1).filter(|&o| o <= frame.len()).ok_or("the DICOM RLE header is truncated")?;
                    unpack_bits(&frame[start..], pixels)
                })
                .collect::<Result<Vec<_>, String>>()?;
            let samples = (0..count)
                .map(|i| {
                    let (pixel, sample) = (i / meta.samples, i % meta.samples);
                    stored((0..bytes_per).fold(0, |v, b| v << 8 | u32::from(planes[sample * bytes_per + b][pixel])))
                })
                .collect();
            (samples, (1 << bits_stored) - 1, meta.photometric.starts_with("YBR_FULL"))
        }
        DicomPixels::Jpeg => {
            let frame = dicom_first_frame(&dicom, value, meta.frames)?;
            let img = image::load_from_memory_with_format(&frame, image::ImageFormat::Jpeg).map_err(|e| format!("the DICOM JPEG frame could not be decoded ({e})"))?;
            let samples: Vec<i32> = if color { img.to_rgb8().into_raw().into_iter().map(i32::from).collect() } else { img.to_luma8().into_raw().into_iter().map(i32::from).collect() };
            (samples, 255, false)
        }
        DicomPixels::Jpeg2000 => {
            let frame = dicom_first_frame(&dicom, value, meta.frames)?;
            let planes = decode_jpeg2000_planes(&frame)?;
            if (planes.width, planes.height) != (w, h) || planes.x0 != 0 || planes.y0 != 0 {
                return Err("the DICOM JPEG 2000 frame does not match its rows and columns or has a nonzero origin".into());
            }
            let comps = planes.components.get(..meta.samples).ok_or("the DICOM JPEG 2000 frame has too few components")?;
            if comps.iter().any(|c| c.width != w || c.height != h || c.dx != 1 || c.dy != 1) {
                return Err("subsampled DICOM JPEG 2000 frames are not supported".into());
            }
            let prec = comps[0].precision.clamp(1, 16);
            let samples = (0..w as usize * h as usize)
                .flat_map(|i| comps.iter().map(move |c| c.data.get(i).copied().unwrap_or(0)))
                .collect();
            (samples, (1 << prec) - 1, meta.photometric.starts_with("YBR_FULL"))
        }
    };
    if samples.len() != count {
        return Err("the DICOM frame does not match its rows and columns".into());
    }
    if color {
        if meta.planar && storage == DicomPixels::Native {
            let plane = count / 3;
            samples = (0..count).map(|i| samples[(i % 3) * plane + i / 3]).collect();
        }
        let mut out: Vec<u16> = samples.iter().map(|&v| scale16(v.max(0) as u32, max)).collect();
        if ycc {
            for px in out.chunks_exact_mut(3) {
                let midpoint = scale16((max + 1) / 2, max);
                ycbcr_to_rgb(px, midpoint, midpoint);
            }
        }
        return image_from_samples(w, h, 3, max > 255, out);
    }
    // Modality LUT (Rescale Slope/Intercept), then the linear VOI window of
    // PS3.3 C.11.2.1.2.1; a file without a window spans its own value range.
    let (slope, intercept) = (meta.slope.unwrap_or(1.0), meta.intercept.unwrap_or(0.0));
    let modality: Vec<f64> = samples.iter().map(|&v| f64::from(v) * slope + intercept).collect();
    let (center, width) = match (meta.center, meta.width) {
        (Some(center), Some(width)) if width >= 1.0 => (center, width),
        _ => {
            let (lo, hi) = modality.iter().fold((f64::MAX, f64::MIN), |(lo, hi), &v| (lo.min(v), hi.max(v)));
            // The window that maps lo to black and hi to white.
            ((lo + hi + 1.0) / 2.0, (hi - lo + 1.0).max(1.0))
        }
    };
    let invert = meta.photometric == "MONOCHROME1";
    let out = modality
        .iter()
        .map(|&x| {
            let y = if x <= center - 0.5 - (width - 1.0) / 2.0 {
                0.0
            } else if x > center - 0.5 + (width - 1.0) / 2.0 {
                1.0
            } else {
                (x - (center - 0.5)) / (width - 1.0).max(1.0) + 0.5
            };
            let y = (y.clamp(0.0, 1.0) * 65535.0).round() as u16;
            if invert { 65535 - y } else { y }
        })
        .collect();
    image_from_samples(w, h, 1, bits_stored > 8, out)
}

// ── Photoshop Raw ────────────────────────────────────────────────────────

/// The layout the Photoshop Raw Options dialog describes: headerless
/// samples after `header` bytes, channel-interleaved or planar, 8 or 16 bits
/// in Mac (big-endian) or IBM PC (little-endian) byte order.
pub(super) struct PhotoshopRaw {
    pub width: u32,
    pub height: u32,
    pub channels: u32,
    pub interleaved: bool,
    pub depth: u32,
    pub big_endian: bool,
    pub header: u32,
}

/// Open headerless samples as grey, grey+alpha, RGB or RGBA. Trailing bytes
/// past the described image are ignored, as Photoshop does.
pub(super) fn decode_photoshop_raw(bytes: &[u8], raw: &PhotoshopRaw) -> Result<DynamicImage, String> {
    let PhotoshopRaw { width: w, height: h, channels, interleaved, depth, big_endian, header } = *raw;
    if !dims_ok(w, h) {
        return Err("Width and Height must be 1 to 32,767 pixels, and 80 megapixels at most.".into());
    }
    if !(1..=4).contains(&channels) {
        return Err("Photoshop Raw files open with 1 to 4 channels.".into());
    }
    if depth != 8 && depth != 16 {
        return Err("Photoshop Raw depth is 8 or 16 bits.".into());
    }
    let bytes_per = depth as usize / 8;
    let (pixels, channels) = (w as usize * h as usize, channels as usize);
    let need = header as u64 + (pixels * channels * bytes_per) as u64;
    if (bytes.len() as u64) < need {
        return Err(format!(
            "{w} × {h} pixels × {channels} channel(s) at {depth} bits after a {header}-byte header needs {need} bytes, but the file holds {}. Check the values or click Guess.",
            bytes.len()
        ));
    }
    let data = &bytes[header as usize..];
    let sample = |i: usize| -> u16 {
        if bytes_per == 1 {
            scale16(data[i].into(), 255)
        } else if big_endian {
            u16::from_be_bytes([data[i * 2], data[i * 2 + 1]])
        } else {
            u16::from_le_bytes([data[i * 2], data[i * 2 + 1]])
        }
    };
    let samples = (0..pixels * channels)
        .map(|i| sample(if interleaved { i } else { (i % channels) * pixels + i / channels }))
        .collect();
    image_from_samples(w, h, channels, depth == 16, samples)
}

/// The largest header Save As ▸ Photoshop Raw writes. The bytes are
/// allocated as asked, and a failed allocation traps the wasm engine.
pub(super) const PHOTOSHOP_RAW_MAX_HEADER: u32 = 1 << 24;

/// Save As ▸ Photoshop Raw: the composite's RGB (luma for a Grayscale
/// document) at the document's depth, after `header` zero bytes.
pub(super) fn encode_photoshop_raw(img: &DynamicImage, gray: bool, interleaved: bool, big_endian: bool, header: u32) -> Result<Vec<u8>, String> {
    if header > PHOTOSHOP_RAW_MAX_HEADER {
        return Err(format!("A Photoshop Raw header is {PHOTOSHOP_RAW_MAX_HEADER} bytes at most; {header} were asked for."));
    }
    let (bits, planes) = planes(img, gray, false);
    let (pixels, channels) = (planes[0].len(), planes.len());
    let mut out = vec![0u8; header as usize];
    out.reserve(pixels * channels * usize::from(bits / 8));
    for i in 0..pixels * channels {
        let (plane, pixel) = if interleaved { (i % channels, i / channels) } else { (i / pixels, i % pixels) };
        let v = planes[plane][pixel];
        match (bits, big_endian) {
            (8, _) => out.push(v as u8),
            (_, true) => out.extend_from_slice(&v.to_be_bytes()),
            (_, false) => out.extend_from_slice(&v.to_le_bytes()),
        }
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rgb16(img: &DynamicImage) -> Vec<u16> {
        img.to_rgb16().into_raw()
    }

    // ── JPEG 2000 ──

    fn gradient8(w: u32, h: u32) -> DynamicImage {
        DynamicImage::ImageRgba8(ImageBuffer::from_fn(w, h, |x, y| image::Rgba([(x * 37) as u8, (y * 53) as u8, (x * y * 7) as u8, 255])))
    }

    #[test]
    fn jpeg2000_lossless_round_trip_is_bit_exact_at_8_and_16_bits() {
        let img8 = gradient8(23, 17);
        for codestream in [false, true] {
            let bytes = encode_jpeg2000(&img8, false, true, 50, codestream).unwrap();
            assert_eq!(jpeg2000_format(&bytes), Some(if codestream { openjp2::Format::J2k } else { openjp2::Format::Jp2 }));
            let back = decode(&bytes).unwrap().unwrap();
            assert!(matches!(back, DynamicImage::ImageRgb8(_)), "opaque 8-bit RGB writes three 8-bit components");
            assert_eq!(back.to_rgb8(), img8.to_rgb8());
        }
        let img16 = DynamicImage::ImageRgba16(ImageBuffer::from_fn(19, 11, |x, y| image::Rgba([(x * 3001) as u16, (y * 5003 + 7) as u16, 65535 - (x * y * 97) as u16, 65535])));
        let back = decode(&encode_jpeg2000(&img16, false, true, 50, false).unwrap()).unwrap().unwrap();
        assert!(matches!(back, DynamicImage::ImageRgb16(_)));
        assert_eq!(rgb16(&back), rgb16(&img16));
    }

    #[test]
    fn jpeg2000_keeps_alpha_and_writes_luma_for_grayscale() {
        let mut img = gradient8(8, 8).to_rgba8();
        img.put_pixel(3, 3, image::Rgba([10, 20, 30, 40]));
        let back = decode(&encode_jpeg2000(&DynamicImage::ImageRgba8(img.clone()), false, true, 50, false).unwrap()).unwrap().unwrap();
        assert_eq!(back.to_rgba8(), img);
        let gray = DynamicImage::ImageRgba8(ImageBuffer::from_fn(9, 5, |x, y| {
            let v = (x * 20 + y) as u8;
            image::Rgba([v, v, v, 255])
        }));
        let back = decode(&encode_jpeg2000(&gray, true, true, 50, false).unwrap()).unwrap().unwrap();
        assert!(matches!(back, DynamicImage::ImageLuma8(_)));
        assert_eq!(back.to_luma8(), gray.to_luma8());
    }

    #[test]
    fn jpeg2000_interprets_signalled_colour_and_names_alpha_for_other_readers() {
        let comps = [100, 128, 128].map(|v| openjp2::ImageComponent::new(2, 2, 8, false, vec![v; 4]).unwrap());
        let mut image = openjp2::Image::new(2, 2, openjp2::ColorSpace::Sycc, comps.into()).unwrap();
        let options = openjp2::EncodeOptions { format: openjp2::Format::Jp2, use_mct: false, ..openjp2::EncodeOptions::default() };
        let encode = |image: &openjp2::Image| openjp2::Encoder::encode(image, &options).unwrap();
        let back = decode(&encode(&image)).unwrap().unwrap().to_rgb8();
        assert_eq!(back.into_raw(), vec![100; 12], "neutral sYCC chroma must produce grey");
        image.color_space = openjp2::ColorSpace::Eycc;
        assert!(decode(&encode(&image)).unwrap().unwrap_err().contains("Eycc colour"));
        image.color_space = openjp2::ColorSpace::Cmyk;
        image.components.push(openjp2::ImageComponent::new(2, 2, 8, false, vec![0; 4]).unwrap());
        assert!(decode(&encode(&image)).unwrap().unwrap_err().contains("Cmyk colour"));
        image.color_space = openjp2::ColorSpace::Srgb;
        image.x0 = 1;
        assert!(decode(&encode(&image)).unwrap().unwrap_err().contains("nonzero image origin"));

        let img = DynamicImage::ImageRgba8(ImageBuffer::from_pixel(2, 2, image::Rgba([100, 100, 100, 42])));
        for gray in [false, true] {
            let bytes = encode_jpeg2000(&img, gray, true, 50, false).unwrap();
            let channels = if gray { 2u16 } else { 4 };
            let mut expected = b"cdef".to_vec();
            expected.extend_from_slice(&channels.to_be_bytes());
            for c in 0..channels {
                let (kind, association): (u16, u16) = if c == channels - 1 { (1, 0) } else { (0, c + 1) };
                expected.extend_from_slice(&c.to_be_bytes());
                expected.extend_from_slice(&kind.to_be_bytes());
                expected.extend_from_slice(&association.to_be_bytes());
            }
            assert!(bytes.windows(expected.len()).any(|b| b == expected), "JP2 cdef must identify its opacity component");
            assert_eq!(decode(&bytes).unwrap().unwrap().to_rgba8(), img.to_rgba8());
        }
    }

    #[test]
    fn jpeg2000_quality_trades_size_for_error() {
        let img = gradient8(64, 64);
        let lossless = encode_jpeg2000(&img, false, true, 50, false).unwrap();
        let lossy = encode_jpeg2000(&img, false, false, 50, false).unwrap();
        let rough = encode_jpeg2000(&img, false, false, 5, false).unwrap();
        assert!(lossy.len() < lossless.len() && rough.len() < lossy.len(), "{} {} {}", lossless.len(), lossy.len(), rough.len());
        let back = decode(&lossy).unwrap().unwrap().to_rgb8();
        let worst = back.as_raw().iter().zip(img.to_rgb8().as_raw()).map(|(a, b)| a.abs_diff(*b)).max().unwrap();
        assert!(worst > 0, "the irreversible wavelet is lossy");
        assert_eq!(back.dimensions(), (64, 64));
    }

    #[test]
    fn jpeg2000_rejects_a_truncated_file() {
        let bytes = encode_jpeg2000(&gradient8(16, 16), false, true, 50, false).unwrap();
        assert!(decode(&bytes[..40]).unwrap().is_err());
    }

    #[test]
    fn jpeg2000_budgets_every_component_plane_before_the_decoder_allocates_them() {
        // Five real 2 × 2 components, then a header that claims an 80-megapixel
        // canvas in one tile: in budget as a document, not as five planes.
        let comps = (0..5).map(|c| openjp2::ImageComponent::new(2, 2, 8, false, vec![c; 4]).unwrap()).collect();
        let image = openjp2::Image::new(2, 2, openjp2::ColorSpace::Unknown, comps).unwrap();
        let options = openjp2::EncodeOptions { format: openjp2::Format::J2k, ..openjp2::EncodeOptions::default() };
        let mut file = openjp2::Encoder::encode(&image, &options).unwrap();
        assert_eq!(decode_jpeg2000(&file).unwrap().to_rgba8().dimensions(), (2, 2), "five components open as their first four");
        // SIZ: Xsiz/Ysiz at 8/12 and the tile size XTsiz/YTsiz at 24/28.
        assert_eq!(file[2..4], [0xFF, 0x51]);
        for at in [8, 24] {
            file[at..at + 4].copy_from_slice(&32_767u32.to_be_bytes());
            file[at + 4..at + 8].copy_from_slice(&2_441u32.to_be_bytes());
        }
        assert!(dims_ok(32_767, 2_441));
        let err = decode_jpeg2000(&file).unwrap_err();
        assert!(err.contains("5 components are too large to open"), "{err}");
    }

    #[test]
    fn packbits_reserves_what_its_input_can_yield_not_what_the_header_claims() {
        // Without the bound this is Vec::with_capacity(usize::MAX): a panic.
        assert_eq!(unpack_bits(&[0x81, 7], usize::MAX).unwrap_err(), "the compressed image data is truncated");
        assert_eq!(unpack_bits(&[0x81, 7], 128).unwrap(), vec![7; 128]);
    }

    // ── Cineon / DPX ──

    fn put_u32(buf: &mut [u8], at: usize, v: u32, be: bool) {
        buf[at..at + 4].copy_from_slice(&if be { v.to_be_bytes() } else { v.to_le_bytes() });
    }
    fn put_u16(buf: &mut [u8], at: usize, v: u16, be: bool) {
        buf[at..at + 2].copy_from_slice(&if be { v.to_be_bytes() } else { v.to_le_bytes() });
    }
    /// A 10-bit method-A word holding three samples.
    fn word10(a: u32, b: u32, c: u32) -> u32 {
        a << 22 | b << 12 | c << 2
    }

    #[test]
    fn cineon_10_bit_opens_log_data_as_is_into_16_bits_in_both_byte_orders() {
        for be in [true, false] {
            let mut file = vec![0u8; 1024];
            put_u32(&mut file, 0, 0x802A_5FD7, be);
            put_u32(&mut file, 4, 1024, be);
            file[193] = 3;
            file[198] = 10;
            put_u32(&mut file, 200, 2, be);
            put_u32(&mut file, 204, 1, be);
            for (r, g, b) in [(1023, 0, 512), (95, 685, 1)] {
                let word = word10(r, g, b);
                file.extend_from_slice(&if be { word.to_be_bytes() } else { word.to_le_bytes() });
            }
            let img = decode(&file).unwrap().unwrap();
            assert!(matches!(img, DynamicImage::ImageRgb16(_)), "10-bit film opens a 16-bit document");
            let s = |v: u32| scale16(v, 1023);
            assert_eq!(rgb16(&img), vec![65535, 0, s(512), s(95), s(685), s(1)]);
        }
    }

    fn dpx(be: bool, w: u32, h: u32, descriptor: u8, bits: u8, packing: u16, data: &[u8]) -> Vec<u8> {
        let mut file = vec![0u8; 2048];
        file[..4].copy_from_slice(if be { b"SDPX" } else { b"XPDS" });
        put_u32(&mut file, 4, 2048, be);
        put_u32(&mut file, 772, w, be);
        put_u32(&mut file, 776, h, be);
        file[800] = descriptor;
        file[803] = bits;
        put_u16(&mut file, 804, packing, be);
        put_u32(&mut file, 808, 2048, be);
        file.extend_from_slice(data);
        file
    }

    #[test]
    fn dpx_reads_10_bit_method_a_rgb_little_endian() {
        let words = [word10(1023, 512, 0), word10(3, 2, 1)];
        let data: Vec<u8> = words.iter().flat_map(|w| w.to_le_bytes()).collect();
        let img = decode(&dpx(false, 2, 1, 50, 10, 1, &data)).unwrap().unwrap();
        let s = |v: u32| scale16(v, 1023);
        assert_eq!(rgb16(&img), vec![65535, s(512), 0, s(3), s(2), s(1)]);
    }

    #[test]
    fn dpx_reads_8_bit_rgb_with_32_bit_line_alignment() {
        // 3 × 3 bytes per line pad to 12.
        let mut data = Vec::new();
        for y in 0..2u8 {
            data.extend_from_slice(&[y, 1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0]);
        }
        let img = decode(&dpx(true, 3, 2, 50, 8, 1, &data)).unwrap().unwrap();
        assert!(matches!(img, DynamicImage::ImageRgb8(_)), "8-bit film opens an 8-bit document");
        assert_eq!(img.to_rgb8().into_raw(), [0, 1, 2, 3, 4, 5, 6, 7, 8, 1, 1, 2, 3, 4, 5, 6, 7, 8]);
    }

    #[test]
    fn dpx_reads_12_bit_luma_and_16_bit_abgr() {
        // Two rows that differ: a reader stuck on the first line repeats it.
        let luma: Vec<u8> = [4095u16 << 4, 2048 << 4, 1 << 4, 1024 << 4].iter().flat_map(|v| v.to_be_bytes()).collect();
        let img = decode(&dpx(true, 2, 2, 6, 12, 1, &luma)).unwrap().unwrap();
        assert_eq!(img.to_luma16().into_raw(), vec![65535, scale16(2048, 4095), scale16(1, 4095), scale16(1024, 4095)]);
        let abgr: Vec<u8> = (1u16..=16).flat_map(|v| v.to_le_bytes()).collect();
        let img = decode(&dpx(false, 2, 2, 52, 16, 0, &abgr)).unwrap().unwrap();
        assert_eq!(img.to_rgba16().into_raw(), vec![4, 3, 2, 1, 8, 7, 6, 5, 12, 11, 10, 9, 16, 15, 14, 13]);
    }

    #[test]
    fn dpx_reads_every_16_bit_line_past_its_32_bit_alignment() {
        // 3 × 2 bytes per line pad to 8; the padding is not a sample.
        let mut data = Vec::new();
        for row in [[0x1000u16, 0x2000, 0x3000], [0x8000, 0x9000, 0xA000]] {
            data.extend(row.iter().flat_map(|v| v.to_be_bytes()));
            data.extend_from_slice(&[0xAA, 0xAA]);
        }
        let img = decode(&dpx(true, 3, 2, 6, 16, 0, &data)).unwrap().unwrap();
        assert!(matches!(img, DynamicImage::ImageLuma16(_)), "16-bit film opens a 16-bit document");
        assert_eq!(img.to_luma16().into_raw(), vec![0x1000, 0x2000, 0x3000, 0x8000, 0x9000, 0xA000]);
    }

    #[test]
    fn dpx_refuses_what_it_cannot_read() {
        assert!(decode(&dpx(true, 2, 1, 100, 10, 1, &[0; 8])).unwrap().unwrap_err().contains("descriptor 100"));
        assert!(decode(&dpx(true, 2, 1, 50, 10, 0, &[0; 8])).unwrap().unwrap_err().contains("method A"));
        assert!(decode(&dpx(true, 4, 4, 50, 16, 0, &[0; 8])).unwrap().unwrap_err().contains("truncated"));
    }

    // ── IFF ──

    fn chunk(id: &[u8], data: &[u8]) -> Vec<u8> {
        let mut out = id.to_vec();
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(data);
        if data.len() % 2 == 1 {
            out.push(0);
        }
        out
    }
    fn iff(kind: &[u8], w: u16, h: u16, planes: u8, masking: u8, compression: u8, chunks: &[Vec<u8>]) -> Vec<u8> {
        let mut bmhd = vec![0u8; 20];
        bmhd[..2].copy_from_slice(&w.to_be_bytes());
        bmhd[2..4].copy_from_slice(&h.to_be_bytes());
        bmhd[8] = planes;
        bmhd[9] = masking;
        bmhd[10] = compression;
        let mut body = kind.to_vec();
        body.extend(chunk(b"BMHD", &bmhd));
        for c in chunks {
            body.extend_from_slice(c);
        }
        let mut out = b"FORM".to_vec();
        out.extend_from_slice(&(body.len() as u32).to_be_bytes());
        out.extend(body);
        out
    }

    #[test]
    fn ilbm_decodes_byterun1_bitplanes_through_the_palette() {
        // 4 px wide, 2 planes: indices 0,1,2,3 → plane0 = 0101, plane1 = 0011.
        let rows = [0b0101_0000u8, 0, 0b0011_0000, 0];
        // ByteRun1: literal run of 4 bytes.
        let mut packed = vec![3u8];
        packed.extend_from_slice(&rows);
        let cmap = chunk(b"CMAP", &[0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
        let file = iff(b"ILBM", 4, 1, 2, 0, 1, &[cmap, chunk(b"BODY", &packed)]);
        let img = decode(&file).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [0, 0, 0, 255, 0, 0, 0, 255, 0, 0, 0, 255]);
    }

    #[test]
    fn ilbm_decodes_deep_24_bit_mask_planes_and_ham6() {
        // 24-bit: one pixel, R=0x81 G=0x02 B=0xFF, each plane row is 2 bytes.
        let mut body = Vec::new();
        for byte in [0x81u8, 0x02, 0xFF] {
            for bit in 0..8 {
                body.extend_from_slice(&[((byte >> bit) & 1) << 7, 0]);
            }
        }
        let img = decode(&iff(b"ILBM", 1, 1, 24, 0, 0, &[chunk(b"BODY", &body)])).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [0x81, 0x02, 0xFF]);

        // 1 plane + mask plane: pixel 0 opaque index 1, pixel 1 masked out.
        let body = [0b1100_0000u8, 0, 0b1000_0000, 0];
        let cmap = chunk(b"CMAP", &[0, 0, 0, 255, 255, 255]);
        let img = decode(&iff(b"ILBM", 2, 1, 1, 1, 0, &[cmap, chunk(b"BODY", &body)])).unwrap().unwrap();
        assert_eq!(img.to_rgba8().into_raw(), [255, 255, 255, 255, 255, 255, 255, 0]);

        // HAM6: palette 1, then modify red to 15, then modify blue to 8.
        let pixels = [0b00_0001u8, 0b10_1111, 0b01_1000];
        let mut body = Vec::new();
        for plane in 0..6 {
            let bits = pixels.iter().enumerate().fold(0u8, |row, (x, p)| row | ((p >> plane) & 1) << (7 - x));
            body.extend_from_slice(&[bits, 0]);
        }
        let cmap = chunk(b"CMAP", &[0, 0, 0, 0x10, 0x20, 0x30]);
        let camg = chunk(b"CAMG", &0x800u32.to_be_bytes());
        let img = decode(&iff(b"ILBM", 3, 1, 6, 0, 0, &[cmap, camg, chunk(b"BODY", &body)])).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [0x11, 0x22, 0x33, 0xFF, 0x22, 0x33, 0xFF, 0x22, 0x88]);
    }

    #[test]
    fn pbm_decodes_chunky_pixels() {
        // 3 px → rows pad to 4 bytes; a repeat run fills the row with index 1.
        let body = [(-3i8) as u8, 1];
        let cmap = chunk(b"CMAP", &[0, 0, 0, 9, 8, 7]);
        let img = decode(&iff(b"PBM ", 3, 1, 8, 0, 1, &[cmap, chunk(b"BODY", &body)])).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [9, 8, 7, 9, 8, 7, 9, 8, 7]);
    }

    #[test]
    fn iff_chunk_size_past_the_file_ends_the_walk_without_wrapping() {
        // wasm32 reaches these sums from a 24-byte file (the e2e spec opens
        // one); a 64-bit target reaches them only here.
        assert_eq!(iff_next_chunk(12, 3), Some(24));
        assert_eq!(iff_next_chunk(usize::MAX - 7, 0), None);
        assert_eq!(iff_next_chunk(usize::MAX - 8, 1), None);
        assert_eq!(iff_next_chunk(usize::MAX - 9, 1), None);
        for size in [u32::MAX, 0xFFFF_FFE6, 0x7FFF_FFFF, 5] {
            let mut file = b"FORM\0\0\0\x10ILBMJUNK".to_vec();
            file.extend_from_slice(&size.to_be_bytes());
            file.extend_from_slice(&[0; 4]);
            assert!(decode(&file).unwrap().unwrap_err().contains("BMHD"), "chunk size {size:#x}");
        }
        // An over-long BODY is clamped to the file and still decodes.
        let cmap = chunk(b"CMAP", &[0, 0, 0, 9, 8, 7]);
        let mut file = iff(b"PBM ", 2, 1, 8, 0, 0, &[cmap, chunk(b"BODY", &[1, 0])]);
        let size_at = file.len() - 6;
        file[size_at..size_at + 4].copy_from_slice(&u32::MAX.to_be_bytes());
        assert_eq!(decode(&file).unwrap().unwrap().to_rgb8().into_raw(), [9, 8, 7, 0, 0, 0]);
    }

    // ── DICOM ──

    /// An explicit-VR (or implicit) little-endian element.
    fn element(explicit: bool, group: u16, elem: u16, vr: &[u8; 2], value: &[u8]) -> Vec<u8> {
        let mut out = [group.to_le_bytes(), elem.to_le_bytes()].concat();
        let long = matches!(vr, b"OB" | b"OW" | b"SQ" | b"UN");
        if !explicit || group == 0xFFFE {
            out.extend_from_slice(&(value.len() as u32).to_le_bytes());
        } else if long {
            out.extend_from_slice(vr);
            out.extend_from_slice(&[0, 0]);
            out.extend_from_slice(&(value.len() as u32).to_le_bytes());
        } else {
            out.extend_from_slice(vr);
            out.extend_from_slice(&(value.len() as u16).to_le_bytes());
        }
        out.extend_from_slice(value);
        out
    }
    fn text(s: &str) -> Vec<u8> {
        let mut v = s.as_bytes().to_vec();
        if v.len() % 2 == 1 {
            v.push(b' ');
        }
        v
    }
    /// A Part-10 file: preamble, meta group naming `syntax`, then `dataset`.
    fn part10(syntax: &str, dataset: &[u8]) -> Vec<u8> {
        let mut out = vec![0u8; 128];
        out.extend_from_slice(b"DICM");
        out.extend(element(true, 0x0002, 0x0010, b"UI", &text(syntax)));
        out.extend_from_slice(dataset);
        out
    }
    fn us(v: u16) -> Vec<u8> {
        v.to_le_bytes().to_vec()
    }
    fn gray_attrs(ex: bool, rows: u16, cols: u16, bits: u16, stored: u16, signed: bool, photometric: &str) -> Vec<u8> {
        [
            element(ex, 0x0028, 0x0002, b"US", &us(1)),
            element(ex, 0x0028, 0x0004, b"CS", &text(photometric)),
            element(ex, 0x0028, 0x0010, b"US", &us(rows)),
            element(ex, 0x0028, 0x0011, b"US", &us(cols)),
            element(ex, 0x0028, 0x0100, b"US", &us(bits)),
            element(ex, 0x0028, 0x0101, b"US", &us(stored)),
            element(ex, 0x0028, 0x0103, b"US", &us(signed as u16)),
        ]
        .concat()
    }

    #[test]
    fn dicom_implicit_16_bit_applies_rescale_then_window() {
        // CT-style: stored signed 12-bit, HU = v * 2 - 1024, window 40/400
        // (so -160 HU is black and 240 HU is white).
        let stored: [i16; 4] = [0, 432, 532, 2000];
        let pixels: Vec<u8> = stored.iter().flat_map(|v| v.to_le_bytes()).collect();
        let dataset = [
            element(false, 0x0020, 0x0013, b"IS", &text("7")),
            gray_attrs(false, 2, 2, 16, 12, true, "MONOCHROME2"),
            element(false, 0x0028, 0x1050, b"DS", &text("40\\300")),
            element(false, 0x0028, 0x1051, b"DS", &text("400")),
            element(false, 0x0028, 0x1052, b"DS", &text("-1024")),
            element(false, 0x0028, 0x1053, b"DS", &text("2")),
            element(false, 0x7FE0, 0x0010, b"OW", &pixels),
        ]
        .concat();
        let file = part10("1.2.840.10008.1.2", &dataset);
        assert_eq!(dicom_instance_number(&file), Some(7));
        let img = decode(&file).unwrap().unwrap();
        assert!(matches!(img, DynamicImage::ImageLuma16(_)), "12-bit data opens a 16-bit document");
        // HU: -1024 (below the window), -160 (black edge), 40 (centre), 2976.
        let centre = (((40.0 - 39.5) / 399.0 + 0.5) * 65535.0f64).round() as u16;
        assert_eq!(img.to_luma16().into_raw(), vec![0, 0, centre, 65535]);
    }

    #[test]
    fn dicom_explicit_monochrome1_inverts_and_spans_its_range_without_a_window() {
        // 0 and 255 span 8 bits, so the range window is the identity.
        let dataset = [gray_attrs(true, 1, 3, 8, 8, false, "MONOCHROME1"), element(true, 0x7FE0, 0x0010, b"OB", &[0, 100, 255, 0])].concat();
        let file = part10("1.2.840.10008.1.2.1", &dataset);
        assert_eq!(dicom_instance_number(&file), None);
        let img = decode(&file).unwrap().unwrap();
        assert!(matches!(img, DynamicImage::ImageLuma8(_)));
        assert_eq!(img.to_luma8().into_raw(), vec![255, 155, 0]);
    }

    #[test]
    fn dicom_native_pixels_respect_the_declared_element_length() {
        let dataset = [
            gray_attrs(true, 1, 2, 16, 16, false, "MONOCHROME2"),
            element(true, 0x7FE0, 0x0010, b"OW", &[0, 0]),
            element(true, 0xFFFC, 0xFFFC, b"OB", &[0xFF; 8]),
        ].concat();
        let err = decode(&part10("1.2.840.10008.1.2.1", &dataset)).unwrap().unwrap_err();
        assert!(err.contains("pixel data is truncated"), "{err}");
    }

    #[test]
    fn dicom_native_ybr_422_expands_shared_chroma() {
        let dataset = [
            element(true, 0x0028, 0x0002, b"US", &us(3)),
            element(true, 0x0028, 0x0004, b"CS", &text("YBR_FULL_422")),
            element(true, 0x0028, 0x0010, b"US", &us(1)),
            element(true, 0x0028, 0x0011, b"US", &us(2)),
            element(true, 0x0028, 0x0100, b"US", &us(8)),
            element(true, 0x7FE0, 0x0010, b"OB", &[100, 200, 128, 128]),
        ].concat();
        let img = decode(&part10("1.2.840.10008.1.2.1", &dataset)).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [100, 100, 100, 200, 200, 200]);
    }

    #[test]
    fn dicom_jpeg2000_refuses_a_frame_with_mismatched_dimensions() {
        let j2k = encode_jpeg2000(&gradient8(2, 2), true, true, 50, true).unwrap();
        let dataset = [gray_attrs(true, 2, 3, 8, 8, false, "MONOCHROME2"), encapsulated(&[&j2k])].concat();
        let err = decode(&part10("1.2.840.10008.1.2.4.90", &dataset)).unwrap().unwrap_err();
        assert!(err.contains("does not match its rows and columns"), "{err}");
    }

    #[test]
    fn dicom_skips_undefined_length_sequences_and_reads_planar_rgb() {
        // A sequence of one undefined-length item holding a nested element.
        let item = [element(true, 0x0008, 0x0100, b"SH", &text("X")), element(true, 0xFFFE, 0xE00D, b"  ", &[])].concat();
        let mut sq = [0x08u8, 0x00, 0x15, 0x11].to_vec();
        sq.extend_from_slice(b"SQ\0\0");
        sq.extend_from_slice(&UNDEFINED.to_le_bytes());
        sq.extend_from_slice(&[0xFE, 0xFF, 0x00, 0xE0]);
        sq.extend_from_slice(&UNDEFINED.to_le_bytes());
        sq.extend(item);
        sq.extend(element(true, 0xFFFE, 0xE0DD, b"  ", &[]));
        let dataset = [
            sq,
            element(true, 0x0028, 0x0002, b"US", &us(3)),
            element(true, 0x0028, 0x0004, b"CS", &text("RGB")),
            element(true, 0x0028, 0x0006, b"US", &us(1)),
            element(true, 0x0028, 0x0010, b"US", &us(1)),
            element(true, 0x0028, 0x0011, b"US", &us(2)),
            element(true, 0x0028, 0x0100, b"US", &us(8)),
            element(true, 0x0028, 0x0101, b"US", &us(8)),
            element(true, 0x7FE0, 0x0010, b"OB", &[1, 2, 3, 4, 5, 6]),
        ]
        .concat();
        let img = decode(&part10("1.2.840.10008.1.2.1", &dataset)).unwrap().unwrap();
        assert_eq!(img.to_rgb8().into_raw(), [1, 3, 5, 2, 4, 6]);
    }

    /// Encapsulated Pixel Data: an empty offset table, then `fragments`.
    fn encapsulated(fragments: &[&[u8]]) -> Vec<u8> {
        let mut out = [0xE0u8, 0x7F, 0x10, 0x00].to_vec();
        out.extend_from_slice(b"OB\0\0");
        out.extend_from_slice(&UNDEFINED.to_le_bytes());
        out.extend(element(true, 0xFFFE, 0xE000, b"  ", &[]));
        for f in fragments {
            out.extend(element(true, 0xFFFE, 0xE000, b"  ", f));
        }
        out.extend(element(true, 0xFFFE, 0xE0DD, b"  ", &[]));
        out
    }

    #[test]
    fn dicom_decodes_rle_and_encapsulated_jpeg2000() {
        // RLE: one 16-bit sample plane → two byte segments (high, low).
        let mut rle = vec![0u8; 64];
        rle[..4].copy_from_slice(&2u32.to_le_bytes());
        rle[4..8].copy_from_slice(&64u32.to_le_bytes());
        rle[8..12].copy_from_slice(&67u32.to_le_bytes());
        rle.extend_from_slice(&[1, 0x01, 0x02]); // high bytes
        rle.extend_from_slice(&[1, 0x00, 0x00]); // low bytes
        let dataset = [gray_attrs(true, 1, 2, 16, 16, false, "MONOCHROME2"), encapsulated(&[&rle])].concat();
        let img = decode(&part10("1.2.840.10008.1.2.5", &dataset)).unwrap().unwrap();
        assert_eq!(img.to_luma16().into_raw(), vec![0, 65535], "0x0100 and 0x0200 span the data range");

        let gray = DynamicImage::ImageRgba8(ImageBuffer::from_fn(4, 2, |x, y| {
            let v = (x * 60 + y * 5) as u8;
            image::Rgba([v, v, v, 255])
        }));
        let j2k = encode_jpeg2000(&gray, true, true, 50, true).unwrap();
        let dataset = [
            gray_attrs(true, 2, 4, 8, 8, false, "MONOCHROME2"),
            element(true, 0x0028, 0x1050, b"DS", &text("128")),
            element(true, 0x0028, 0x1051, b"DS", &text("256")),
            encapsulated(&[&j2k]),
        ]
        .concat();
        let img = decode(&part10("1.2.840.10008.1.2.4.90", &dataset)).unwrap().unwrap();
        assert_eq!(img.to_luma8(), gray.to_luma8(), "a full-range window passes 8-bit data through");
    }

    #[test]
    fn dicom_decodes_encapsulated_baseline_jpeg() {
        let rgb = image::RgbImage::from_pixel(8, 8, image::Rgb([200, 40, 90]));
        let mut jpeg = std::io::Cursor::new(Vec::new());
        DynamicImage::ImageRgb8(rgb).write_to(&mut jpeg, image::ImageFormat::Jpeg).unwrap();
        let dataset = [
            element(true, 0x0028, 0x0002, b"US", &us(3)),
            element(true, 0x0028, 0x0004, b"CS", &text("YBR_FULL_422")),
            element(true, 0x0028, 0x0010, b"US", &us(8)),
            element(true, 0x0028, 0x0011, b"US", &us(8)),
            element(true, 0x0028, 0x0100, b"US", &us(8)),
            encapsulated(&[&jpeg.into_inner()]),
        ]
        .concat();
        let img = decode(&part10("1.2.840.10008.1.2.4.50", &dataset)).unwrap().unwrap().to_rgb8();
        let px = img.get_pixel(4, 4).0;
        assert!(px[0].abs_diff(200) < 4 && px[1].abs_diff(40) < 4 && px[2].abs_diff(90) < 4, "{px:?}");
    }

    #[test]
    fn dicom_names_an_unsupported_compression() {
        let dataset = [gray_attrs(true, 1, 1, 8, 8, false, "MONOCHROME2"), encapsulated(&[&[0]])].concat();
        let err = decode(&part10("1.2.840.10008.1.2.4.70", &dataset)).unwrap().unwrap_err();
        assert!(err.contains("compressed DICOM (JPEG Lossless 1.2.840.10008.1.2.4.70) isn't supported"), "{err}");
    }

    // ── Through the engine ──

    #[test]
    fn engine_opens_and_saves_photoshop_raw_jpeg2000_and_dicom() {
        use super::super::Engine;
        // Headerless 16-bit RGB opens a 16-bit document; Save As writes it back.
        let src: Vec<u8> = (0..4 * 3 * 3 * 2).map(|i| (i * 37 % 251) as u8).collect();
        let mut e = Engine::from_photoshop_raw(&src, 4, 3, 3, true, 16, true, 0).unwrap();
        assert_eq!((e.width(), e.height(), e.doc_depth()), (4, 3, 16));
        assert_eq!(e.export_photoshop_raw(true, true, 0).unwrap(), src);
        // Lossless JPEG 2000 reopens at the same depth with the same samples.
        let jp2 = e.export_jpeg2000(true, 50, false).unwrap();
        let mut back = Engine::from_image(&jp2).unwrap();
        assert_eq!(back.doc_depth(), 16);
        assert_eq!(back.export_photoshop_raw(true, true, 0).unwrap(), src);
        // DICOM through the ordinary image open.
        let dataset = [gray_attrs(true, 1, 2, 16, 16, false, "MONOCHROME2"), element(true, 0x7FE0, 0x0010, b"OW", &[0, 0, 0xFF, 0xFF])].concat();
        let mut dcm = Engine::from_image(&part10("1.2.840.10008.1.2.1", &dataset)).unwrap();
        assert_eq!((dcm.width(), dcm.height(), dcm.doc_depth()), (2, 1, 16));
        assert_eq!(dcm.export_photoshop_raw(true, true, 0).unwrap(), [0, 0, 0, 0, 0, 0, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF]);
    }

    // ── Photoshop Raw ──

    fn raw(width: u32, height: u32, channels: u32, interleaved: bool, depth: u32, big_endian: bool, header: u32) -> PhotoshopRaw {
        PhotoshopRaw { width, height, channels, interleaved, depth, big_endian, header }
    }

    #[test]
    fn photoshop_raw_round_trips_every_layout() {
        let img8 = gradient8(5, 3);
        let img16 = DynamicImage::ImageRgba16(ImageBuffer::from_fn(5, 3, |x, y| image::Rgba([(x * 9001) as u16, (y * 20001) as u16, 7, 65535])));
        for (img, depth) in [(&img8, 8), (&img16, 16)] {
            for interleaved in [true, false] {
                for big_endian in [true, false] {
                    let bytes = encode_photoshop_raw(img, false, interleaved, big_endian, 7).unwrap();
                    assert_eq!(bytes.len(), 7 + 5 * 3 * 3 * depth as usize / 8);
                    assert!(bytes[..7].iter().all(|&b| b == 0));
                    let back = decode_photoshop_raw(&bytes, &raw(5, 3, 3, interleaved, depth, big_endian, 7)).unwrap();
                    assert_eq!(rgb16(&back), rgb16(img), "depth {depth} interleaved {interleaved} be {big_endian}");
                    assert_eq!(matches!(back, DynamicImage::ImageRgb16(_)), depth == 16);
                }
            }
        }
        // A Grayscale document writes one channel.
        assert_eq!(encode_photoshop_raw(&img8, true, true, true, 0).unwrap().len(), 15);
    }

    #[test]
    fn photoshop_raw_refuses_a_header_it_would_have_to_allocate_blind() {
        let img = gradient8(2, 2);
        let err = encode_photoshop_raw(&img, false, true, true, PHOTOSHOP_RAW_MAX_HEADER + 1).unwrap_err();
        assert!(err.contains("16777216 bytes at most; 16777217 were asked for"), "{err}");
        assert_eq!(encode_photoshop_raw(&img, false, true, true, PHOTOSHOP_RAW_MAX_HEADER).unwrap().len(), (1 << 24) + 12);
    }

    #[test]
    fn photoshop_raw_reads_known_samples_and_explains_a_short_file() {
        // Planar, big-endian 16-bit grey+alpha, 2 × 1.
        let bytes = [0xFF, 0xFF, 0x00, 0x01, 0x80, 0x00, 0x00, 0x00, 0xAB];
        let img = decode_photoshop_raw(&bytes, &raw(2, 1, 2, false, 16, true, 0)).unwrap();
        assert_eq!(img.to_luma_alpha16().into_raw(), vec![65535, 0x8000, 1, 0]);
        let err = decode_photoshop_raw(&bytes, &raw(3, 3, 3, true, 8, true, 4)).unwrap_err();
        assert!(err.contains("needs 31 bytes, but the file holds 9"), "{err}");
        assert!(decode_photoshop_raw(&bytes, &raw(1, 1, 5, true, 8, true, 0)).unwrap_err().contains("1 to 4 channels"));
        assert!(decode_photoshop_raw(&bytes, &raw(0, 1, 1, true, 8, true, 0)).is_err());
    }
}
