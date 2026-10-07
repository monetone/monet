// ─────────────────────────────────────────────────────────────
// GIMP XCF reader (v0 through v11+).
//
// XCF is a pointer-graph format: the image points at layer/channel structures,
// each layer points at a pixel "hierarchy" → "level" → 64×64 "tiles". The one
// version gate that matters pervasively is pointer width: 4 bytes through v10,
// 8 bytes from v11. Tiles are uncompressed-interleaved, GIMP per-plane RLE, or
// (v11+) zlib of the interleaved buffer.
//
// This pass reconstructs raster + group layers with offset, opacity, blend
// mode, visibility, layer masks, and group nesting (PROP_ITEM_PATH). Pixels of
// any bit depth are decoded and reduced to 8-bit RGBA for the IR.
// ─────────────────────────────────────────────────────────────

use crate::import::codec::{gimp_rle_plane, zlib_inflate_exact};
use crate::import::document::*;
use crate::import::error::{FormatError, Result};
use crate::import::reader::Reader;

// Property ids we decode (others are skipped by their length).
const PROP_END: u32 = 0;
const PROP_COLORMAP: u32 = 1;
const PROP_OPACITY: u32 = 6;
const PROP_MODE: u32 = 7;
const PROP_VISIBLE: u32 = 8;
const PROP_LINKED: u32 = 9;
const PROP_LOCK_ALPHA: u32 = 10;
const PROP_OFFSETS: u32 = 15;
const PROP_COMPRESSION: u32 = 17;
const PROP_GROUP_ITEM: u32 = 29;
const PROP_ITEM_PATH: u32 = 30;
const PROP_FLOAT_OPACITY: u32 = 33;
const PROP_TEXT_LAYER_FLAGS: u32 = 34;
const PROP_BLEND_SPACE: u32 = 38;
const PROP_COMPOSITE_SPACE: u32 = 39;
const PROP_COMPOSITE_MODE: u32 = 40;

/// Largest pixel buffer one XCF drawable may allocate.
const MAX_DRAWABLE_BYTES: usize = 512 * 1024 * 1024;

/// `a * b * c` for a buffer sized by file-supplied fields. usize is 32-bit on
/// wasm32 and the release profile has no overflow checks, so an unchecked
/// product wraps to a short buffer that the tile blit then indexes past the
/// end of; the cap keeps absurd-but-non-wrapping dimensions from aborting the
/// module on a multi-gigabyte allocation (#62).
fn checked_bytes(a: usize, b: usize, c: usize, what: &str) -> Result<usize> {
    a.checked_mul(b)
        .and_then(|n| n.checked_mul(c))
        .filter(|n| *n <= MAX_DRAWABLE_BYTES)
        .ok_or_else(|| FormatError::Malformed(format!("xcf {what} exceeds decoder limit")))
}

/// End offset of a property payload. The unchecked `position + len` wraps back
/// to the property's own start on wasm32, so `seek(end)` re-reads the same
/// property forever and the UI hangs (#62).
fn prop_end(r: &Reader, len: usize) -> Result<usize> {
    r.position()
        .checked_add(len)
        .filter(|end| *end <= r.len())
        .ok_or_else(|| FormatError::Malformed("xcf property length exceeds file".into()))
}

struct XcfHeader {
    version: u32,
    wide: bool,
    width: u32,
    height: u32,
    base_type: u32,
    bpc: usize, // bytes per colour component
    is_float: bool,
}

struct RawXcf {
    id: u32,
    name: String,
    width: u32,
    height: u32,
    ltype: u32,
    opacity: f32,
    visible: bool,
    locked: bool,
    blend: BlendMode,
    pass_through: bool,
    is_group: bool,
    is_text: bool,
    offset: (i32, i32),
    item_path: Vec<u32>,
    rgba: Vec<u8>,
    mask: Option<(i32, i32, u32, u32, Vec<u8>, bool)>,
}

pub fn parse(bytes: &[u8]) -> Result<Document> {
    let mut r = Reader::new(bytes);
    let header = read_header(&mut r)?;

    // Image property list.
    let mut compression: u8 = 0;
    let mut palette: Vec<u8> = Vec::new();
    loop {
        let prop = r.u32()?;
        let len = r.u32()? as usize;
        if prop == PROP_END {
            break;
        }
        let end = prop_end(&r, len)?;
        match prop {
            PROP_COMPRESSION => compression = r.u8()?,
            PROP_COLORMAP => {
                let n = r.u32()? as usize;
                palette = r.read_vec(checked_bytes(n, 3, 1, "colormap")?)?;
            }
            _ => {}
        }
        r.seek(end)?;
    }

    // Layer pointer list, then channel pointer list (channels = saved
    // selections etc.; not needed — we reach layer masks via the layer).
    let mut layer_ptrs = Vec::new();
    loop {
        let p = r.read_ptr(header.wide)?;
        if p == 0 {
            break;
        }
        layer_ptrs.push(p as usize);
    }

    let mut raws = Vec::with_capacity(layer_ptrs.len());
    for (i, &lp) in layer_ptrs.iter().enumerate() {
        raws.push(read_layer(
            &mut r,
            &header,
            compression,
            &palette,
            lp,
            (i + 1) as u32,
        )?);
    }

    let layers = build_tree(raws, header.width, header.height);
    let mut doc = Document::new(header.width, header.height, SourceFormat::Xcf);
    doc.depth = if header.is_float {
        32
    } else {
        (header.bpc * 8) as u8
    };
    doc.color_mode = match header.base_type {
        1 => ColorMode::Grayscale,
        2 => ColorMode::Indexed,
        _ => ColorMode::Rgb,
    };
    doc.layers = layers;
    Ok(doc)
}

fn read_header(r: &mut Reader) -> Result<XcfHeader> {
    let magic = r.read_bytes(9)?;
    if magic != b"gimp xcf " {
        return Err(FormatError::BadMagic);
    }
    let tag = r.read_bytes(4)?.to_vec();
    let _nul = r.u8()?;
    let version = if &tag == b"file" {
        0
    } else if tag[0] == b'v' {
        std::str::from_utf8(&tag[1..4])
            .ok()
            .and_then(|s| s.parse::<u32>().ok())
            .ok_or(FormatError::Malformed("bad xcf version tag".into()))?
    } else {
        return Err(FormatError::BadMagic);
    };
    let wide = version >= 11;
    let width = r.u32()?;
    let height = r.u32()?;
    let base_type = r.u32()?;
    let (bpc, is_float) = if version >= 4 {
        decode_precision(r.u32()?)
    } else {
        (1, false)
    };
    if width == 0 || height == 0 {
        return Err(FormatError::Malformed("zero canvas".into()));
    }
    Ok(XcfHeader {
        version,
        wide,
        width,
        height,
        base_type,
        bpc,
        is_float,
    })
}

/// (bytes per component, is_float) from the XCF precision field.
fn decode_precision(p: u32) -> (usize, bool) {
    if p >= 100 {
        match p / 100 {
            1 => (1, false), // 8-bit int
            2 => (2, false), // 16-bit int
            3 => (4, false), // 32-bit int
            4 => (2, true),  // 16-bit float (half)
            5 => (4, true),  // 32-bit float
            _ => (1, false),
        }
    } else {
        match p {
            0 | 1 => (1, false),
            2 | 3 => (2, false),
            4 | 5 => (4, false),
            6 | 7 => (2, true),
            8 | 9 => (4, true),
            _ => (1, false),
        }
    }
}

fn channels_for(ltype: u32) -> usize {
    match ltype {
        0 => 3, // RGB
        1 => 4, // RGBA
        2 => 1, // Gray
        3 => 2, // GrayA
        4 => 1, // Indexed
        5 => 2, // IndexedA
        _ => 4,
    }
}

#[allow(clippy::too_many_arguments)]
fn read_layer(
    r: &mut Reader,
    header: &XcfHeader,
    compression: u8,
    palette: &[u8],
    ptr: usize,
    id: u32,
) -> Result<RawXcf> {
    r.seek(ptr)?;
    let width = r.u32()?;
    let height = r.u32()?;
    let ltype = r.u32()?;
    let name = r.xcf_string()?;

    let mut opacity = 1.0f32;
    let mut visible = true;
    let mut locked = false;
    let mut is_group = false;
    let mut is_text = false;
    let mut offset = (0i32, 0i32);
    let mut item_path = Vec::new();
    let mut saw_new_props = false;
    let mut mode_value: u32 = 28; // default Normal (new enum)

    loop {
        let prop = r.u32()?;
        let len = r.u32()? as usize;
        if prop == PROP_END {
            break;
        }
        let end = prop_end(r, len)?;
        match prop {
            PROP_OPACITY => opacity = (r.u32()? as f32 / 255.0).clamp(0.0, 1.0),
            PROP_FLOAT_OPACITY => opacity = r.f32()?.clamp(0.0, 1.0),
            PROP_MODE => mode_value = r.u32()?,
            PROP_VISIBLE => visible = r.u32()? != 0,
            PROP_LINKED => {}
            PROP_LOCK_ALPHA => locked = locked || r.u32()? != 0,
            PROP_OFFSETS => offset = (r.i32()?, r.i32()?),
            PROP_GROUP_ITEM => is_group = true,
            PROP_TEXT_LAYER_FLAGS => is_text = true,
            PROP_ITEM_PATH => {
                let count = len / 4;
                for _ in 0..count {
                    item_path.push(r.u32()?);
                }
            }
            PROP_BLEND_SPACE | PROP_COMPOSITE_SPACE | PROP_COMPOSITE_MODE => saw_new_props = true,
            _ => {}
        }
        r.seek(end)?;
    }
    let (blend, pass_through) = map_mode(mode_value, header.version, saw_new_props);

    let hierarchy_ptr = r.read_ptr(header.wide)? as usize;
    let mask_ptr = r.read_ptr(header.wide)? as usize;

    // Pixels (groups have a degenerate hierarchy — skip).
    let mut rgba = Vec::new();
    if !is_group && width > 0 && height > 0 {
        // to_rgba allocates width*height*4 from these file-supplied dims (#62).
        checked_bytes(width as usize, height as usize, 4, "layer")?;
        let nch = channels_for(ltype);
        let planes = decode_hierarchy(r, header, compression, hierarchy_ptr)?;
        rgba = to_rgba(
            &planes,
            width as usize,
            height as usize,
            nch,
            ltype,
            header,
            palette,
        );
    }

    // Layer mask (a channel structure).
    let mut mask = None;
    if mask_ptr != 0 {
        if let Ok((mw, mh, data)) = read_channel(r, header, compression, mask_ptr) {
            mask = Some((offset.0, offset.1, mw, mh, data, false));
        }
    }

    Ok(RawXcf {
        id,
        name,
        width,
        height,
        ltype,
        opacity,
        visible,
        locked,
        blend,
        pass_through,
        is_group,
        is_text,
        offset,
        item_path,
        rgba,
        mask,
    })
}

/// Returns the interleaved `w*h*bpp` pixel buffer for a drawable.
fn decode_hierarchy(
    r: &mut Reader,
    header: &XcfHeader,
    compression: u8,
    ptr: usize,
) -> Result<DecodedPlane> {
    r.seek(ptr)?;
    let w = r.u32()? as usize;
    let h = r.u32()? as usize;
    let bpp = r.u32()? as usize;
    let level0 = r.read_ptr(header.wide)? as usize;
    // (remaining level pointers + terminator are ignored — only level 0 holds data.)
    decode_level(r, header, compression, level0, w, h, bpp)
}

struct DecodedPlane {
    data: Vec<u8>, // w*h*bpp interleaved
    bpp: usize,
}

fn decode_level(
    r: &mut Reader,
    header: &XcfHeader,
    compression: u8,
    ptr: usize,
    w: usize,
    h: usize,
    bpp: usize,
) -> Result<DecodedPlane> {
    r.seek(ptr)?;
    let _lw = r.u32()? as usize;
    let _lh = r.u32()? as usize;
    let mut tile_ptrs = Vec::new();
    loop {
        let p = r.read_ptr(header.wide)?;
        if p == 0 {
            break;
        }
        tile_ptrs.push(p as usize);
    }

    let tiles_x = w.div_ceil(64);
    let tiles_y = h.div_ceil(64);
    // Sized from unvalidated hierarchy fields; see checked_bytes (#62).
    let mut out = vec![0u8; checked_bytes(w, h, bpp, "hierarchy")?];
    for (ti, &tp) in tile_ptrs.iter().enumerate() {
        if ti >= tiles_x * tiles_y {
            break;
        }
        let col = ti % tiles_x;
        let row = ti / tiles_x;
        let x0 = col * 64;
        let y0 = row * 64;
        let tw = 64.min(w - x0);
        let th = 64.min(h - y0);
        r.seek(tp)?;
        let tile = decode_tile(r, compression, tw, th, bpp)?;
        // Blit interleaved tile into the level buffer.
        for ty in 0..th {
            let dst = ((y0 + ty) * w + x0) * bpp;
            let src = ty * tw * bpp;
            out[dst..dst + tw * bpp].copy_from_slice(&tile[src..src + tw * bpp]);
        }
    }
    Ok(DecodedPlane { data: out, bpp })
}

/// Decode one tile to its `tw*th*bpp` interleaved bytes.
fn decode_tile(
    r: &mut Reader,
    compression: u8,
    tw: usize,
    th: usize,
    bpp: usize,
) -> Result<Vec<u8>> {
    let n = tw * th;
    match compression {
        0 => Ok(r.read_vec(n * bpp)?),
        1 => {
            // Per-plane RLE: bpp planes of n bytes each, then re-interleave.
            let mut planes = Vec::with_capacity(bpp);
            for _ in 0..bpp {
                planes.push(gimp_rle_plane(r, n)?);
            }
            let mut out = vec![0u8; n * bpp];
            for p in 0..bpp {
                for px in 0..n {
                    out[px * bpp + p] = planes[p][px];
                }
            }
            Ok(out)
        }
        2 => {
            // zlib of the interleaved buffer (v11+). Tiles are addressed by
            // absolute pointer, so over-reading the tail is fine — inflate is
            // bounded by the known output size. The count is required, not a
            // maximum: a stream that ends short leaves the level blit slicing
            // past the end of the tile (#216).
            let tail = r.rest();
            zlib_inflate_exact(tail, n * bpp)
        }
        c => Err(FormatError::Unsupported(format!("XCF compression {c}"))),
    }
}

/// Convert an interleaved component plane to layer-local 8-bit RGBA.
fn to_rgba(
    plane: &DecodedPlane,
    w: usize,
    h: usize,
    nch: usize,
    ltype: u32,
    header: &XcfHeader,
    palette: &[u8],
) -> Vec<u8> {
    let bpc = if nch == 0 { 1 } else { plane.bpp / nch };
    // read_layer already validated w*h*4 with checked_bytes (#62).
    let mut rgba = vec![0u8; w * h * 4];
    let comp = |bytes: &[u8]| -> u8 {
        match (bpc, header.is_float) {
            (1, _) => bytes.first().copied().unwrap_or(0),
            (2, false) => bytes.first().copied().unwrap_or(0), // high byte (BE)
            (4, false) => bytes.first().copied().unwrap_or(0), // high byte of 32-bit int
            (2, true) => {
                // half-float
                if bytes.len() >= 2 {
                    (half_to_f32(u16::from_be_bytes([bytes[0], bytes[1]])).clamp(0.0, 1.0) * 255.0
                        + 0.5) as u8
                } else {
                    0
                }
            }
            (4, true) => {
                if bytes.len() >= 4 {
                    (f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]).clamp(0.0, 1.0)
                        * 255.0
                        + 0.5) as u8
                } else {
                    0
                }
            }
            _ => 0,
        }
    };
    for i in 0..w * h {
        let base = i * plane.bpp;
        let c = |k: usize| comp(&plane.data[(base + k * bpc).min(plane.data.len())..]);
        let (r8, g8, b8, a8) = match ltype {
            0 => (c(0), c(1), c(2), 255),  // RGB
            1 => (c(0), c(1), c(2), c(3)), // RGBA
            2 => {
                let v = c(0);
                (v, v, v, 255)
            } // Gray
            3 => {
                let v = c(0);
                (v, v, v, c(1))
            } // GrayA
            4 | 5 => {
                let idx = c(0) as usize;
                let r = palette.get(idx * 3).copied().unwrap_or(0);
                let g = palette.get(idx * 3 + 1).copied().unwrap_or(0);
                let b = palette.get(idx * 3 + 2).copied().unwrap_or(0);
                let a = if ltype == 5 { c(1) } else { 255 };
                (r, g, b, a)
            }
            _ => (c(0), c(1), c(2), 255),
        };
        rgba[i * 4] = r8;
        rgba[i * 4 + 1] = g8;
        rgba[i * 4 + 2] = b8;
        rgba[i * 4 + 3] = a8;
    }
    rgba
}

/// A channel structure (layer mask / saved selection): returns (w, h, coverage).
fn read_channel(
    r: &mut Reader,
    header: &XcfHeader,
    compression: u8,
    ptr: usize,
) -> Result<(u32, u32, Vec<u8>)> {
    r.seek(ptr)?;
    let w = r.u32()?;
    let h = r.u32()?;
    let _name = r.xcf_string()?;
    loop {
        let prop = r.u32()?;
        let len = r.u32()? as usize;
        if prop == PROP_END {
            break;
        }
        r.seek(prop_end(r, len)?)?;
    }
    let hierarchy_ptr = r.read_ptr(header.wide)? as usize;
    let plane = decode_hierarchy(r, header, compression, hierarchy_ptr)?;
    let bpc = if plane.bpp == 0 { 1 } else { plane.bpp };
    // Single-plane grayscale coverage → 8-bit (high byte for >8-bit).
    let n = checked_bytes(w as usize, h as usize, 1, "channel")?;
    let mut cov = vec![0u8; n];
    for i in 0..n {
        cov[i] = plane.data.get(i * bpc).copied().unwrap_or(0);
    }
    Ok((w, h, cov))
}

/// Reconstruct the flat bottom-to-top IR layer list with parent linkage from
/// the top-to-bottom XCF layer list + PROP_ITEM_PATH nesting.
fn build_tree(raws: Vec<RawXcf>, _w: u32, _h: u32) -> Vec<Layer> {
    // Map item_path → layer id, to resolve each layer's parent group.
    let path_id: Vec<(Vec<u32>, u32, bool)> = raws
        .iter()
        .map(|l| (l.item_path.clone(), l.id, l.is_group))
        .collect();
    let find_parent = |path: &[u32]| -> Option<u32> {
        if path.len() <= 1 {
            return None; // root
        }
        let parent_path = &path[..path.len() - 1];
        path_id
            .iter()
            .find(|(p, _, grp)| *grp && p.as_slice() == parent_path)
            .map(|(_, id, _)| *id)
    };

    let mut out: Vec<Layer> = Vec::with_capacity(raws.len());
    for rl in &raws {
        let kind = if rl.is_group {
            LayerKind::Group
        } else {
            LayerKind::Raster
        };
        let bounds = Bounds {
            x: rl.offset.0,
            y: rl.offset.1,
            w: rl.width,
            h: rl.height,
        };
        let mut layer = Layer::new(rl.id, rl.name.clone(), kind, bounds);
        layer.parent = find_parent(&rl.item_path);
        layer.opacity = rl.opacity;
        layer.blend = rl.blend;
        layer.pass_through = rl.pass_through;
        layer.visible = rl.visible;
        layer.locked = rl.locked;
        if !rl.is_group {
            layer.rgba = rl.rgba.clone();
        }
        if let Some((mx, my, mw, mh, data, disabled)) = &rl.mask {
            if mw * mh > 0 && !data.is_empty() {
                layer.mask = Some(Mask {
                    x: *mx,
                    y: *my,
                    w: *mw,
                    h: *mh,
                    data: data.clone(),
                    data16: Vec::new(),
                    data32: Vec::new(),
                    default: 0,
                    disabled: *disabled,
                    relative: true,
                    invert: false,
                    density: None,
                    feather: None,
                    vector_density: None,
                    vector_feather: None,
                    real: None,
                });
            }
        }
        let _ = rl.ltype;
        let _ = rl.is_text;
        out.push(layer);
    }
    // XCF stores top-to-bottom; the IR is bottom-to-top.
    out.reverse();
    out
}

/// Map an XCF mode value to a neutral blend mode + pass-through flag.
fn map_mode(mode: u32, version: u32, saw_new_props: bool) -> (BlendMode, bool) {
    use crate::import::BlendMode::*;
    let new_enum = saw_new_props || version >= 11 || mode >= 28;
    if new_enum {
        let bm = match mode {
            28 => Normal,
            30 => Dissolve,
            32 => Multiply,
            33 => Screen,
            34 => Overlay,
            35 => Difference,
            36 => LinearDodge, // Addition
            37 => Subtract,
            38 => Darken,
            39 => Lighten,
            40 => Hue,
            41 => Saturation,
            42 => Color,
            43 => Luminosity, // Value (HSV)
            44 => Divide,
            45 => ColorDodge,
            46 => ColorBurn,
            47 => HardLight,
            48 => SoftLight,
            51 => VividLight,
            52 => PinLight,
            53 => LinearLight,
            54 => HardMix,
            55 => Exclusion,
            56 => LinearBurn,
            57 => Darken,  // luma darker color → closest
            58 => Lighten, // luma lighter color → closest
            59 => Luminosity,
            64 => return (Normal, true), // pass through (group)
            _ => Normal,
        };
        (bm, false)
    } else {
        let bm = match mode {
            0 => Normal,
            1 => Dissolve,
            3 => Multiply,
            4 => Screen,
            5 => Overlay,
            6 => Difference,
            7 => LinearDodge, // Addition
            8 => Subtract,
            9 => Darken,
            10 => Lighten,
            11 => Hue,
            12 => Saturation,
            13 => Color,
            14 => Luminosity, // Value
            15 => Divide,
            16 => ColorDodge,
            17 => ColorBurn,
            18 => HardLight,
            19 => SoftLight,
            _ => Normal,
        };
        (bm, false)
    }
}

/// Minimal IEEE half-float → f32 (for 16-bit-float XCF precision).
fn half_to_f32(h: u16) -> f32 {
    let sign = (h >> 15) & 1;
    let exp = (h >> 10) & 0x1f;
    let mant = h & 0x3ff;
    let val = if exp == 0 {
        (mant as f32) * 2f32.powi(-24)
    } else if exp == 0x1f {
        if mant == 0 {
            f32::INFINITY
        } else {
            f32::NAN
        }
    } else {
        (1.0 + mant as f32 / 1024.0) * 2f32.powi(exp as i32 - 15)
    };
    if sign == 1 {
        -val
    } else {
        val
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn be32(out: &mut Vec<u8>, v: u32) {
        out.extend_from_slice(&v.to_be_bytes());
    }
    fn be64(out: &mut Vec<u8>, v: u64) {
        out.extend_from_slice(&v.to_be_bytes());
    }

    fn header_v11() -> XcfHeader {
        XcfHeader {
            version: 11,
            wide: true,
            width: 64,
            height: 1,
            base_type: 0,
            bpc: 1,
            is_float: false,
        }
    }

    #[test]
    fn property_length_past_end_of_file_is_rejected_before_seeking() {
        // len = 0xFFFFFFF8 wraps `position + len` back to the property's own
        // start on wasm32, so seek(end) re-reads it forever (#62). Natively the
        // add cannot wrap, so pin the guard by the error it raises: without it
        // the same bytes fall through to seek() and report Eof instead.
        let mut bytes = Vec::new();
        bytes.extend_from_slice(b"gimp xcf ");
        bytes.extend_from_slice(b"v011\0");
        be32(&mut bytes, 8); // width
        be32(&mut bytes, 8); // height
        be32(&mut bytes, 0); // base type: RGB
        be32(&mut bytes, 100); // precision: 8-bit int
        be32(&mut bytes, 100); // an image property we do not decode
        be32(&mut bytes, 0xFFFF_FFF8); // …with a hostile length
        assert_eq!(
            parse(&bytes).err(),
            Some(FormatError::Malformed(
                "xcf property length exceeds file".into()
            ))
        );
    }

    #[test]
    fn hierarchy_dimensions_are_capped_before_allocating() {
        // 16384 * 16384 * 4 = 1 GiB, over MAX_DRAWABLE_BYTES. Without the cap
        // the buffer is allocated first and the failure surfaces later as a
        // stray-pointer Eof (and on wasm32 the product wraps instead) (#62).
        let mut bytes = Vec::new();
        be32(&mut bytes, 16384); // hierarchy width
        be32(&mut bytes, 16384); // hierarchy height
        be32(&mut bytes, 4); // bytes per pixel
        be64(&mut bytes, 20); // level 0 pointer
        be32(&mut bytes, 16384); // level width
        be32(&mut bytes, 16384); // level height
        be64(&mut bytes, 0); // no tiles
        let mut r = Reader::new(&bytes);
        assert_eq!(
            decode_hierarchy(&mut r, &header_v11(), 0, 0).err(),
            Some(FormatError::Malformed(
                "xcf hierarchy exceeds decoder limit".into()
            ))
        );
    }

    #[test]
    fn short_zlib_tile_errors_instead_of_panicking_in_the_level_blit() {
        // A well-formed v11 zlib tile that legitimately inflates to fewer bytes
        // than the tile holds used to slice past the end of `tile` (#216).
        let payload = miniz_oxide::deflate::compress_to_vec_zlib(&[0u8; 8], 6);
        let mut bytes = Vec::new();
        be32(&mut bytes, 64); // hierarchy width
        be32(&mut bytes, 1); // hierarchy height
        be32(&mut bytes, 4); // bytes per pixel
        be64(&mut bytes, 20); // level 0 pointer
        be32(&mut bytes, 64); // level width
        be32(&mut bytes, 1); // level height
        be64(&mut bytes, 44); // single tile pointer
        be64(&mut bytes, 0); // terminator
        assert_eq!(bytes.len(), 44);
        bytes.extend_from_slice(&payload);
        let mut r = Reader::new(&bytes);
        assert_eq!(
            decode_hierarchy(&mut r, &header_v11(), 2, 0).err(),
            Some(FormatError::Decompress(
                "zlib size mismatch: produced 8 of 256".into()
            ))
        );
    }
}
