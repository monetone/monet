// ─────────────────────────────────────────────────────────────
// Adobe Photoshop PSD (version 1) and PSB (large document, version 2) reader.
//
// One code path parameterized by `psb`: the formats are byte-identical except
// for a handful of length fields that widen from u32 → u64 (the Layer & Mask
// section length, the Layer Info length, the per-channel data length, the RLE
// per-row count table, and a specific set of additional-info keys).
//
// This pass reconstructs the full layer model: geometry/offset, blend mode,
// opacity, visibility, clipping, layer mask, Unicode name, group nesting
// (`lsct` section dividers), and channel pixel data (raw / PackBits / ZIP).
// Text, adjustment and layer-effect *details* are decoded by the descriptor
// pass (`fidelity`), which reads the tagged blocks collected here.
// ─────────────────────────────────────────────────────────────

use crate::import::codec::{packbits_decode, zip_predicted, zlib_inflate_exact};
use crate::import::descriptor::psd_fidelity;
use crate::import::document::*;
use crate::import::error::{FormatError, Result};
use crate::import::reader::Reader;

/// Whether an additional-info block uses PSB's widened 8-byte length field.
///
/// This is the single wire-format authority shared by the importer and the
/// engine's PSB writer. The first group is Adobe's documented set; the latter
/// keys are emitted by current Photoshop versions and are handled as wide by
/// mature PSD implementations such as psd-tools.
pub fn psb_uses_8_byte_length(key: [u8; 4]) -> bool {
    matches!(
        &key,
        b"LMsk"
            | b"Lr16"
            | b"Lr32"
            | b"Layr"
            | b"Mt16"
            | b"Mt32"
            | b"Mtrn"
            | b"Alph"
            | b"FMsk"
            | b"lnk2"
            | b"lnk3"
            | b"lnkE"
            | b"FEid"
            | b"FXid"
            | b"FELS"
            | b"PxSD"
            | b"pths"
            | b"extd"
            | b"extn"
            | b"cinf"
            | b"artd"
    )
}

// Keep decoder allocations aligned with the live engine's hard limits. PSD/PSB
// can advertise much larger canvases and layer rectangles, so validate before
// deriving any sample count or allocating a channel buffer.
const MAX_PSD_DIMENSION: u32 = 32_767;
const MAX_PSD_PIXELS: u64 = 80_000_000;
const MAX_PSD_CHANNELS: usize = 56;
const MAX_PSD_LAYERS: usize = 4_096;
const MAX_PSD_DECODED_IMAGE_BYTES: usize = 1024 * 1024 * 1024;
const MAX_PSD_DECODED_SAMPLES: usize = 1_000_000_000;
const MAX_PSD_CHANNEL_METADATA_BYTES: usize = 4 * 1024 * 1024;

pub(crate) const PSD_ADJUSTMENT_KEYS: &[&[u8; 4]] = &[
    b"brit", b"levl", b"curv", b"hue2", b"hue ", b"blnc", b"expA", b"vibA", b"blwh", b"post",
    b"thrs", b"nvrt", b"grdm", b"mixr", b"selc", b"phfl", b"clrL",
];

#[derive(Default)]
struct PsdDecodeBudget {
    copied_metadata_bytes: usize,
    preserved_bytes: usize,
    preserved_blocks: usize,
    decoded_samples: usize,
    decoded_bytes: usize,
}

impl PsdDecodeBudget {
    /// Reserve before copying/allocating retained metadata. Unknown blocks are
    /// skipped as borrowed input and therefore consume no decoder allocation.
    fn reserve_metadata(&mut self, len: usize, preserved: bool) -> Result<()> {
        let copied = self
            .copied_metadata_bytes
            .checked_add(len)
            .ok_or_else(|| FormatError::Malformed("Photoshop metadata size overflow".into()))?;
        if copied > MAX_PSD_PRESERVED_BYTES {
            return Err(FormatError::Unsupported(
                "Photoshop metadata exceeds decoder allocation limit".into(),
            ));
        }

        if preserved {
            let bytes = self.preserved_bytes.checked_add(len).ok_or_else(|| {
                FormatError::Malformed("preserved Photoshop data size overflow".into())
            })?;
            let blocks = self.preserved_blocks.checked_add(1).ok_or_else(|| {
                FormatError::Malformed("preserved Photoshop block count overflow".into())
            })?;
            if bytes > MAX_PSD_PRESERVED_BYTES || blocks > MAX_PSD_PRESERVED_BLOCKS {
                return Err(FormatError::Unsupported(
                    "Photoshop preserved layer data exceeds preservation limit".into(),
                ));
            }
            self.preserved_bytes = bytes;
            self.preserved_blocks = blocks;
        }

        self.copied_metadata_bytes = copied;
        Ok(())
    }

    /// Reserve the complete projected decode before reading compressed channel
    /// payloads. `bytes` includes native planes, temporary raw planes, retained
    /// RGBA, and compatibility previews; `samples` independently bounds
    /// pathological low-bit-depth documents.
    fn reserve_decoded(&mut self, samples: usize, bytes: usize) -> Result<()> {
        let samples = self
            .decoded_samples
            .checked_add(samples)
            .ok_or_else(|| FormatError::Malformed("Photoshop decoded sample overflow".into()))?;
        let bytes = self
            .decoded_bytes
            .checked_add(bytes)
            .ok_or_else(|| FormatError::Malformed("Photoshop decoded byte overflow".into()))?;
        if samples > MAX_PSD_DECODED_SAMPLES || bytes > MAX_PSD_DECODED_IMAGE_BYTES {
            return Err(FormatError::Unsupported(
                "Photoshop decoded channel data exceeds decoder budget".into(),
            ));
        }
        self.decoded_samples = samples;
        self.decoded_bytes = bytes;
        Ok(())
    }
}

fn checked_pixel_count(width: u32, height: u32, context: &str) -> Result<usize> {
    if width > MAX_PSD_DIMENSION || height > MAX_PSD_DIMENSION {
        return Err(FormatError::Unsupported(format!(
            "{context} dimensions exceed decoder limit"
        )));
    }
    let pixels = u64::from(width) * u64::from(height);
    if pixels > MAX_PSD_PIXELS {
        return Err(FormatError::Unsupported(format!(
            "{context} pixel count exceeds decoder limit"
        )));
    }
    usize::try_from(pixels)
        .map_err(|_| FormatError::Malformed(format!("{context} pixel count overflow")))
}

fn rect_span(start: i32, end: i32) -> u32 {
    (i64::from(end) - i64::from(start)).clamp(0, i64::from(u32::MAX)) as u32
}

struct Header {
    psb: bool,
    channels: u16,
    width: u32,
    height: u32,
    depth: u16,
    color_mode: u16,
}

#[derive(Default)]
struct ChannelResources {
    pascal_names: Vec<String>,
    unicode_names: Vec<String>,
    identifiers: Vec<u32>,
    display: Vec<ChannelDisplayInfo>,
    /// Named paths (2000-2997) only ride along to the Document: they describe
    /// no channel, so `metadata_count` ignores them and they never force a
    /// merged-image read.
    paths: Vec<DocumentPath>,
    /// Path resources and a clipping path that could not be read.
    skipped_paths: usize,
    /// Resource 1066, Alternate Duotone Colors: each ink as Lab, the only
    /// colour a colour-book ink carries outside its (private) book.
    duotone_alternates: Vec<u8>,
}

impl ChannelResources {
    fn metadata_count(&self) -> usize {
        self.unicode_names
            .len()
            .max(self.pascal_names.len())
            .max(self.identifiers.len())
            .max(self.display.len())
    }

    fn name(&self, index: usize) -> Option<String> {
        self.unicode_names
            .get(index)
            .or_else(|| self.pascal_names.get(index))
            .cloned()
    }

    fn skip_leading(&mut self, count: usize) {
        self.pascal_names
            .drain(..count.min(self.pascal_names.len()));
        self.unicode_names
            .drain(..count.min(self.unicode_names.len()));
        self.identifiers.drain(..count.min(self.identifiers.len()));
        self.display.drain(..count.min(self.display.len()));
    }
}

#[derive(Clone)]
struct ChannelInfo {
    id: i16,
    len: u64,
}

#[derive(Clone, Copy, PartialEq)]
enum Section {
    None,
    Open,
    Closed,
    Bounding,
}

#[derive(Clone)]
struct RawMask {
    x: i32,
    y: i32,
    w: u32,
    h: u32,
    default: u8,
    disabled: bool,
    relative: bool,
    invert: bool,
    density: Option<u8>,
    feather: Option<f64>,
    vector_density: Option<u8>,
    vector_feather: Option<f64>,
    real: Option<Box<RawMask>>,
}

/// Everything parsed from a layer record, before pixel assembly + IR mapping.
pub(crate) struct RawLayer {
    pub top: i32,
    pub left: i32,
    pub bottom: i32,
    pub right: i32,
    channels: Vec<ChannelInfo>,
    blend_key: [u8; 4],
    opacity: u8,
    fill_opacity: u8,
    /// `knko` setting: 0 None, 1 Shallow, 2 Deep.
    knockout: u8,
    /// `lspf` protected-setting bits, 0 when the block is absent.
    lock_flags: u32,
    /// `brst` restricted-channel bits (R/G/B), 0 when the block is absent.
    blend_restrictions: u8,
    /// `tsly` Transparency Shapes Layer, on when the block is absent.
    transparency_shapes: bool,
    /// `infx` Blend Interior Effects as Group, off when the block is absent.
    blend_interior_group: bool,
    /// `clbl` Blend Clipped Layers as Group, off when the block is absent.
    blend_clipped_group: bool,
    blend_if: Option<[f32; 32]>,
    clipping: bool,
    flags: u8,
    name: String,
    mask: Option<RawMask>,
    section: Section,
    section_key: Option<[u8; 4]>,
    /// Tagged blocks consumed by the fidelity pass and retained for bounded
    /// semantic/opaque round-tripping. Unused blocks are skipped without
    /// allocation.
    pub additional: Vec<([u8; 4], Vec<u8>)>,
    /// Assembled layer-local 8-bit RGBA (w*h*4), filled in the channel pass.
    /// For high-depth documents this is only a compatibility preview; native
    /// authority lives in `rgba16`/`rgba32`.
    rgba: Vec<u8>,
    /// Native 16-bit straight-alpha RGBA for 16-bit documents.
    rgba16: Vec<u16>,
    /// Native float straight-alpha RGBA for 32-bit documents.
    rgba32: Vec<f32>,
    /// Assembled user-mask coverage (mask.w*mask.h), filled in the channel
    /// pass. `mask_pixels` is a compatibility preview for native-depth masks.
    mask_pixels: Vec<u8>,
    mask_pixels16: Vec<u16>,
    mask_pixels32: Vec<f32>,
    /// Photoshop's optional real user-mask channel (`-3`).
    real_mask_pixels: Vec<u8>,
    real_mask_pixels16: Vec<u16>,
    real_mask_pixels32: Vec<f32>,
}

impl RawLayer {
    pub(crate) fn find(&self, key: &[u8; 4]) -> Option<&[u8]> {
        self.additional
            .iter()
            .find(|(k, _)| k == key)
            .map(|(_, v)| v.as_slice())
    }
    fn width(&self) -> u32 {
        rect_span(self.left, self.right)
    }
    fn height(&self) -> u32 {
        rect_span(self.top, self.bottom)
    }
}

pub fn parse(bytes: &[u8]) -> Result<Document> {
    let mut r = Reader::new(bytes);
    let header = read_header(&mut r)?;
    let mut budget = PsdDecodeBudget::default();

    // Color Mode Data (u32 length in both PSD/PSB). For Indexed documents this
    // holds the 256-colour palette ([n R][n G][n B]) needed to turn the index
    // plane into RGB; a Duotone's is its ink specification, which the host
    // turns back into inks. Every other mode carries nothing we need, so skip.
    let cmd_len = r.u32()? as usize;
    let mut duotone = Vec::new();
    let palette = if header.color_mode == 2 {
        Some(r.read_bytes(cmd_len)?)
    } else if header.color_mode == 8 {
        budget.reserve_metadata(cmd_len, false)?;
        duotone = r.read_vec(cmd_len)?;
        None
    } else {
        r.skip(cmd_len)?;
        None
    };

    // Image Resources: retain the ordered alpha/spot channel names,
    // identifiers, and raw display metadata. Large unrelated resources remain
    // borrowed and skipped without allocation.
    let res_len = r.u32()? as usize;
    let mut channel_resources =
        read_channel_resources(&mut r, res_len, header.width, header.height)?;

    let mut doc = Document::new(
        header.width,
        header.height,
        if header.psb {
            SourceFormat::Psb
        } else {
            SourceFormat::Psd
        },
    );
    // Not inside the merged-image branch below: layered files skip it.
    doc.paths = std::mem::take(&mut channel_resources.paths);
    doc.skipped_paths = channel_resources.skipped_paths;
    doc.depth = header.depth as u8;
    doc.color_mode = color_mode(header.color_mode);
    if header.color_mode == 8 {
        doc.duotone = duotone;
        doc.duotone_alternates = std::mem::take(&mut channel_resources.duotone_alternates);
    }

    // Layer & Mask Information.
    let section_len = usize::try_from(r.read_ptr(header.psb)?)
        .map_err(|_| FormatError::Malformed("layer section length overflow".into()))?;
    let section_end = r
        .position()
        .checked_add(section_len)
        .ok_or_else(|| FormatError::Malformed("layer section length overflow".into()))?;
    if section_end > r.len() {
        return Err(FormatError::Malformed("layer section exceeds file".into()));
    }
    let mut merged_transparency = false;
    if section_len > 0 {
        let (raw, linked, has_merged_transparency, skipped_patterns) =
            read_layers(&mut r, &header, section_end, &mut budget)?;
        merged_transparency = has_merged_transparency;
        doc.layers = build_layers(raw, &header)?;
        doc.psd_linked_blocks = linked;
        doc.skipped_patterns = skipped_patterns;
        validate_preserved_blocks(&doc)?;
        r.seek(section_end.min(r.len()))?;
    }

    // The final Image Data section also owns document alpha/spot planes. Decode
    // it for flattened documents and whenever planes remain after the process
    // channels plus an authoritative merged-transparency plane.
    let base_channels = psd_color_channel_count(header.color_mode);
    let extra_channels = (header.channels as usize).saturating_sub(base_channels);
    // Photoshop names every Multichannel plate, so there the channel resources
    // describe the ink plates first and the document channels after them.
    if header.color_mode == 7 && channel_resources.metadata_count() > extra_channels {
        channel_resources.skip_leading(base_channels);
    }
    let needs_merged = doc.layers.is_empty()
        || extra_channels > usize::from(merged_transparency)
        || channel_resources.metadata_count() > 0;
    if needs_merged {
        let (background, channels) = read_merged_image(
            &mut r,
            &header,
            palette,
            &channel_resources,
            merged_transparency,
            &mut budget,
        )?;
        doc.channels = channels;
        if doc.layers.is_empty() {
            doc.layers.push(background);
        }
    }

    Ok(doc)
}

/// Photoshop's layered TIFF payload (tag 37724, ImageSourceData): a signature,
/// then additional-info blocks whose `Layr`/`Lr16`/`Lr32` block is a Layer Info
/// body. The canvas size comes from the TIFF. Blocks are big-endian (`8BIM`) or,
/// as Photoshop writes them into an IBM PC byte order TIFF, little-endian
/// (`MIB8`): every integer and 4-character code reversed, the channel samples
/// still big-endian (psdtags reads the same layout).
pub fn parse_image_source_data(isd: &[u8], width: u32, height: u32) -> Result<Document> {
    let payload = isd
        .strip_prefix(b"Adobe Photoshop Document Data Block\0")
        .ok_or(FormatError::BadMagic)?;
    checked_pixel_count(width, height, "TIFF layer data")?;
    let le = payload.starts_with(b"MIB8");
    let mut r = Reader::new(payload).little_endian(le);
    let mut budget = PsdDecodeBudget::default();
    let mut doc = Document::new(width, height, SourceFormat::Psd);
    let mut patterns = Vec::new();
    loop {
        while r.rest().first() == Some(&0) {
            r.skip(1)?;
        }
        if r.remaining() == 0 {
            break;
        }
        // One byte order per tag: a block in the other order is damage.
        if &r.fourcc()? != b"8BIM" {
            return Err(FormatError::Malformed(
                "invalid ImageSourceData block signature".into(),
            ));
        }
        let key = r.fourcc()?;
        let len = r.u32()? as usize;
        let end = r
            .position()
            .checked_add(len)
            .filter(|end| *end <= r.len())
            .ok_or_else(|| FormatError::Malformed("ImageSourceData block exceeds tag".into()))?;
        let depth = match &key {
            b"Layr" => 8,
            b"Lr16" => 16,
            b"Lr32" => 32,
            _ => 0,
        };
        if depth != 0 && doc.layers.is_empty() {
            let header = Header { psb: false, channels: 4, width, height, depth, color_mode: 3 };
            // Bounded to the block, so a short length fails instead of reading on.
            let mut block = Reader::new(&payload[..end]).little_endian(le);
            block.seek(r.position())?;
            let (raw, _) = read_layer_records(&mut block, &header, end, &mut budget)?;
            doc.depth = depth as u8;
            doc.layers = build_layers(raw, &header)?;
        // Little-endian document blocks are left out: a PSD save would write
        // them back verbatim into a big-endian file.
        } else if !le && is_linked_block(key) {
            budget.reserve_metadata(len, true)?;
            doc.psd_linked_blocks.push(PsdTaggedBlock { key, data: r.read_vec(len)? });
        } else if !le && is_pattern_block(key) {
            patterns.push((key, r.read_bytes(len)?));
        }
        r.seek(end)?;
    }
    if doc.layers.is_empty() {
        return Err(FormatError::Malformed("ImageSourceData holds no layers".into()));
    }
    doc.skipped_patterns = keep_pattern_blocks(patterns, &mut budget, &mut doc.psd_linked_blocks);
    validate_preserved_blocks(&doc)?;
    Ok(doc)
}

fn read_header(r: &mut Reader) -> Result<Header> {
    let sig = r.fourcc()?;
    if &sig != b"8BPS" {
        return Err(FormatError::BadMagic);
    }
    let version = r.u16()?;
    let psb = match version {
        1 => false,
        2 => true,
        v => return Err(FormatError::Unsupported(format!("PSD version {v}"))),
    };
    r.skip(6)?; // reserved
    let channels = r.u16()?;
    let height = r.u32()?;
    let width = r.u32()?;
    let depth = r.u16()?;
    let color_mode = r.u16()?;
    if !matches!(depth, 1 | 8 | 16 | 32) {
        return Err(FormatError::Unsupported(format!("PSD depth {depth}")));
    }
    // Indexed and Bitmap are single-depth modes in Photoshop. A crafted file
    // pairing Indexed with 16/32-bit reaches the palette remap in
    // read_merged_image with an empty 8-bit buffer and panics (#25).
    if (color_mode == 2 && depth != 8) || (color_mode == 0 && depth != 1) {
        return Err(FormatError::Unsupported(format!(
            "PSD color mode {color_mode} at depth {depth}"
        )));
    }
    if width == 0 || height == 0 {
        return Err(FormatError::Malformed("zero canvas".into()));
    }
    if channels == 0 || channels as usize > MAX_PSD_CHANNELS {
        return Err(FormatError::Unsupported(format!(
            "PSD channel count {channels}"
        )));
    }
    checked_pixel_count(width, height, "PSD canvas")?;
    Ok(Header {
        psb,
        channels,
        width,
        height,
        depth,
        color_mode,
    })
}

fn color_mode(m: u16) -> ColorMode {
    match m {
        0 => ColorMode::Bitmap,
        1 => ColorMode::Grayscale,
        2 => ColorMode::Indexed,
        3 => ColorMode::Rgb,
        4 => ColorMode::Cmyk,
        7 => ColorMode::Multichannel,
        8 => ColorMode::Duotone,
        9 => ColorMode::Lab,
        _ => ColorMode::Rgb,
    }
}

fn read_channel_resources(
    r: &mut Reader,
    len: usize,
    width: u32,
    height: u32,
) -> Result<ChannelResources> {
    let end = r
        .position()
        .checked_add(len)
        .ok_or_else(|| FormatError::Malformed("image resources length overflow".into()))?;
    if end > r.len() {
        return Err(FormatError::Malformed(
            "image resources section exceeds file".into(),
        ));
    }
    let mut resources = ChannelResources::default();
    let mut clipping_path = None;
    while r.position() < end {
        if end - r.position() < 12 {
            let padding = r.read_bytes(end - r.position())?;
            if padding.iter().any(|byte| *byte != 0) {
                return Err(FormatError::Malformed(
                    "truncated image resource header".into(),
                ));
            }
            break;
        }
        // All five documented resource signatures are legal (ag-psd accepts the
        // same set): MeSa comes from ImageReady/Save-for-Web, PHUT from
        // PhotoDeluxe, DCSR from DCS writers. Refusing them aborted the whole
        // import over one metadata block this function does not want (#215).
        let signature = r.fourcc()?;
        if !matches!(&signature, b"8BIM" | b"MeSa" | b"AgHg" | b"PHUT" | b"DCSR") {
            return Err(FormatError::Malformed(
                "invalid image resource signature".into(),
            ));
        }
        let id = r.u16()?;
        let name_len = usize::from(r.u8()?);
        let name = r.read_bytes(name_len)?;
        if name_len % 2 == 0 {
            r.skip(1)?; // length byte plus name pad to even
        }
        let data_len = r.u32()? as usize;
        let data_end = r
            .position()
            .checked_add(data_len)
            .ok_or_else(|| FormatError::Malformed("image resource length overflow".into()))?;
        if data_end > end {
            return Err(FormatError::Malformed(
                "image resource exceeds section".into(),
            ));
        }
        // Only 8BIM blocks carry the ids we consume; anything else is skipped by
        // its declared length (#215).
        let consume = &signature == b"8BIM";
        if consume
            && matches!(id, 1006 | 1045 | 1053 | 1077)
            && data_len > MAX_PSD_CHANNEL_METADATA_BYTES
        {
            return Err(FormatError::Unsupported(
                "Photoshop channel metadata exceeds decoder limit".into(),
            ));
        }
        let data = r.read_bytes(data_len)?;
        match id {
            1006 if consume => resources.pascal_names = read_alpha_names(data)?,
            1045 if consume => resources.unicode_names = read_unicode_alpha_names(data)?,
            1053 if consume => resources.identifiers = read_alpha_identifiers(data)?,
            1077 if consume => resources.display = read_channel_display_info(data)?,
            2000..=2997 if consume => match read_path_anchors(data, width, height) {
                Some((anchors, contours)) if !name.is_empty() => resources.paths.push(DocumentPath {
                    name: latin1(name),
                    anchors,
                    contours,
                    clip_flatness: None,
                }),
                _ => resources.skipped_paths += 1,
            },
            2999 if consume => clipping_path = read_clipping_path(data),
            1066 if consume && data_len <= 64 * 1024 => {
                resources.duotone_alternates = data.to_vec()
            }
            _ => {}
        }
        if data_len % 2 != 0 {
            if r.position() >= end {
                return Err(FormatError::Malformed(
                    "missing image resource padding".into(),
                ));
            }
            r.skip(1)?;
        }
    }
    r.seek(end)?;
    if let Some((name, flatness)) = clipping_path {
        match resources.paths.iter_mut().find(|path| path.name == name) {
            Some(path) => path.clip_flatness = Some(flatness),
            None => resources.skipped_paths += 1,
        }
    }
    Ok(resources)
}

/// Pascal resource names are single-byte; Vision writes them as Latin-1.
fn latin1(bytes: &[u8]) -> String {
    bytes.iter().copied().map(char::from).collect()
}

/// A path resource (2000-2997): 26-byte records whose points are signed 8.24
/// (y, x) fractions of the canvas. Returns every closed subpath with 3+ knots
/// as one anchor list, plus each subpath's knot count when there are several
/// (the Paths panel's loops); open, truncated or malformed subpaths are
/// skipped, never fatal.
fn read_path_anchors(data: &[u8], width: u32, height: u32) -> Option<(Vec<f32>, Vec<u32>)> {
    let (w, h) = (f64::from(width), f64::from(height));
    let selector = |record: &[u8]| u16::from_be_bytes([record[0], record[1]]);
    let fixed = |record: &[u8], at: usize| {
        f64::from(i32::from_be_bytes(record[at..at + 4].try_into().unwrap())) / 16_777_216.0
    };
    let (mut anchors, mut contours) = (Vec::new(), Vec::new());
    let mut records = data.chunks_exact(26);
    while let Some(record) = records.next() {
        // 0/3 length records; fill rule, clipboard and initial fill are skipped.
        if !matches!(selector(record), 0 | 3) {
            continue;
        }
        let count = usize::from(u16::from_be_bytes([record[2], record[3]]));
        let knots: Vec<&[u8]> = records.by_ref().take(count).collect();
        if selector(record) != 0
            || count < 3
            || knots.len() != count
            || knots.iter().any(|knot| !matches!(selector(knot), 1 | 2))
        {
            continue;
        }
        for knot in knots {
            let (y, x) = (fixed(knot, 10), fixed(knot, 14));
            anchors.extend(
                [
                    x * w,
                    y * h,
                    (fixed(knot, 6) - x) * w,
                    (fixed(knot, 2) - y) * h,
                    (fixed(knot, 22) - x) * w,
                    (fixed(knot, 18) - y) * h,
                ]
                .map(|v| v as f32),
            );
        }
        contours.push(count as u32);
    }
    if contours.len() < 2 {
        contours.clear();
    }
    (!anchors.is_empty()).then_some((anchors, contours))
}

/// The clipping path (resource 2999): an unpadded Pascal name, flatness as
/// 16.16 fixed device pixels, then two fill-rule bytes Adobe ignores — the
/// layout GIMP's reader and ExifTool agree on. Flatness is clamped the way
/// GIMP clamps it, so an odd or missing value never loses the clipping choice.
fn read_clipping_path(data: &[u8]) -> Option<(String, f32)> {
    let (&len, rest) = data.split_first()?;
    let name = rest.get(..usize::from(len))?;
    let flatness = rest
        .get(usize::from(len)..usize::from(len) + 4)
        .map_or(0.2, |b| i32::from_be_bytes(b.try_into().unwrap()) as f32 / 65536.0);
    Some((latin1(name), flatness.clamp(0.2, 100.0)))
}

fn read_alpha_names(data: &[u8]) -> Result<Vec<String>> {
    let mut r = Reader::new(data);
    let mut names = Vec::new();
    while r.position() < r.len() {
        let len = r.u8()? as usize;
        let bytes = r.read_bytes(len)?;
        names.push(String::from_utf8_lossy(bytes).into_owned());
    }
    Ok(names)
}

fn read_unicode_alpha_names(data: &[u8]) -> Result<Vec<String>> {
    let mut r = Reader::new(data);
    let mut names = Vec::new();
    while r.position() < r.len() {
        names.push(r.unicode_string(1)?);
    }
    Ok(names)
}

fn read_alpha_identifiers(data: &[u8]) -> Result<Vec<u32>> {
    if data.len() % 4 != 0 {
        return Err(FormatError::Malformed(
            "invalid alpha-channel identifier resource".into(),
        ));
    }
    let mut r = Reader::new(data);
    let mut identifiers = Vec::with_capacity(data.len() / 4);
    while r.position() < r.len() {
        identifiers.push(r.u32()?);
    }
    Ok(identifiers)
}

fn read_channel_display_info(data: &[u8]) -> Result<Vec<ChannelDisplayInfo>> {
    let mut r = Reader::new(data);
    if r.u32()? != 1 || r.remaining() % 13 != 0 {
        return Err(FormatError::Malformed(
            "invalid alpha-channel display-info resource".into(),
        ));
    }
    let mut display = Vec::with_capacity(r.remaining() / 13);
    while r.position() < r.len() {
        let color_space = r.u16()?;
        let color = [r.u16()?, r.u16()?, r.u16()?, r.u16()?];
        let opacity = r.u16()?;
        let mode = r.u8()?;
        display.push(ChannelDisplayInfo {
            color_space,
            color,
            opacity,
            mode,
        });
    }
    Ok(display)
}

/// Read the layer records and their channel pixel data for the Layer & Mask
/// section. 8-bit documents keep their layers in the main Layer Info, but
/// 16-/32-bit documents leave it empty and stash the real records in an
/// `Lr16`/`Lr32` additional-info block (Photoshop's high-bit-depth quirk). Read
/// the main info first; if it is empty, recover the `Lr16`/`Lr32` records so
/// layered 16-/32-bit files don't collapse to a single flattened layer.
fn read_layers<'a>(
    r: &mut Reader<'a>,
    header: &Header,
    section_end: usize,
    budget: &mut PsdDecodeBudget,
) -> Result<(Vec<RawLayer>, Vec<PsdTaggedBlock>, bool, bool)> {
    let layer_info_len = usize::try_from(r.read_ptr(header.psb)?)
        .map_err(|_| FormatError::Malformed("layer info length overflow".into()))?;
    let layer_info_end = r
        .position()
        .checked_add(layer_info_len)
        .ok_or_else(|| FormatError::Malformed("layer info length overflow".into()))?;
    if layer_info_end > section_end {
        return Err(FormatError::Malformed("layer info exceeds section".into()));
    }

    let (mut layers, mut merged_transparency) = if layer_info_len == 0 {
        (Vec::new(), false)
    } else {
        read_layer_records(r, header, layer_info_end, budget)?
    };
    r.seek(layer_info_end.min(r.len()))?;

    // Global layer mask info (u32 length + body), followed by document-level
    // additional-info blocks. Smart Object embedded/linked source data lives in
    // lnk2/lnkD/lnk3/lnkE here, separate from the per-layer SoLd descriptor.
    if r.position() + 4 <= section_end {
        let gmask_len = r.u32()? as usize;
        let gmask_end = r
            .position()
            .checked_add(gmask_len)
            .ok_or_else(|| FormatError::Malformed("global layer mask length overflow".into()))?;
        if gmask_end > section_end {
            return Err(FormatError::Malformed(
                "global layer mask exceeds section".into(),
            ));
        }
        r.seek(gmask_end)?;
    }

    let mut linked = Vec::new();
    let mut patterns = Vec::new();
    while r.position() < section_end {
        // Adobe writers may leave alignment zeroes between global blocks.
        while r.position() < section_end && r.rest().first() == Some(&0) {
            r.skip(1)?;
        }
        if r.position() >= section_end {
            break;
        }
        if r.position() + 12 > section_end {
            return Err(FormatError::Malformed(
                "truncated global additional-info header".into(),
            ));
        }
        match r.peek4() {
            Some(s) if &s == b"8BIM" || &s == b"8B64" => {}
            _ => {
                return Err(FormatError::Malformed(
                    "invalid global additional-info signature".into(),
                ))
            }
        }
        let _sig = r.fourcc()?;
        let key = r.fourcc()?;
        let big = header.psb && psb_uses_8_byte_length(key);
        let len64 = if big { r.u64()? } else { r.u32()? as u64 };
        let len = usize::try_from(len64)
            .map_err(|_| FormatError::Malformed("global block length overflow".into()))?;
        let block_end = r
            .position()
            .checked_add(len)
            .ok_or_else(|| FormatError::Malformed("global block length overflow".into()))?;
        if block_end > section_end {
            return Err(FormatError::Malformed(
                "global block exceeds section".into(),
            ));
        }

        if layers.is_empty() && (&key == b"Lr16" || &key == b"Lr32") {
            let (decoded, has_merged_transparency) =
                read_layer_records(r, header, block_end, budget)?;
            layers = decoded;
            merged_transparency = has_merged_transparency;
        } else if is_linked_block(key) {
            budget.reserve_metadata(len, true)?;
            linked.push(PsdTaggedBlock {
                key,
                data: r.read_vec(len)?,
            });
        } else if is_pattern_block(key) {
            patterns.push((key, r.read_bytes(len)?));
        }
        r.seek(block_end)?;
    }
    let skipped_patterns = keep_pattern_blocks(patterns, budget, &mut linked);
    Ok((layers, linked, merged_transparency, skipped_patterns))
}

/// Parse a Layer Info body — layer count, then records, then channel image data
/// — occupying `[r.position(), end)`. Shared by the main Layer Info and the
/// `Lr16`/`Lr32` blocks, whose payload is the byte-identical structure.
fn read_layer_records(
    r: &mut Reader,
    header: &Header,
    end: usize,
    budget: &mut PsdDecodeBudget,
) -> Result<(Vec<RawLayer>, bool)> {
    let count_raw = r.i16()?;
    let count = count_raw.unsigned_abs() as usize;
    if count > MAX_PSD_LAYERS {
        return Err(FormatError::Unsupported(format!(
            "PSD layer count {count} exceeds decoder limit"
        )));
    }

    // Pass 1: records (fixed-walkable).
    let mut layers = Vec::with_capacity(count);
    for _ in 0..count {
        layers.push(read_record(r, header, budget)?);
    }

    // All records are available before any compressed channel bytes are
    // touched. Preflight the whole layer set so a tiny compression bomb is
    // rejected before the first large plane allocation.
    reserve_layer_decodes(&layers, header, budget)?;

    // Pass 2: channel image data, in record order.
    for layer in layers.iter_mut() {
        read_channels(r, header, layer)?;
    }

    // Stay aligned regardless of trailing padding within the body.
    r.seek(end.min(r.len()))?;
    Ok((layers, count_raw < 0))
}

/// Smart Object sources, kept for re-export.
fn is_linked_block(key: [u8; 4]) -> bool {
    matches!(&key, b"lnk2" | b"lnkD" | b"lnk3" | b"lnkE")
}

/// Pattern records, kept for the fills, overlays and strokes that name them.
fn is_pattern_block(key: [u8; 4]) -> bool {
    matches!(&key, b"Patt" | b"Pat2" | b"Pat3")
}

/// Keep the pattern records once everything a file cannot open without has
/// taken its share of the preservation budget. Past it they are left out
/// rather than refusing the file (the fills and overlays naming them keep
/// their pixels); an empty block, which Photoshop writes into documents with
/// no patterns, is not kept at all. True when records were left out.
fn keep_pattern_blocks(
    patterns: Vec<([u8; 4], &[u8])>,
    budget: &mut PsdDecodeBudget,
    kept: &mut Vec<PsdTaggedBlock>,
) -> bool {
    let mut skipped = false;
    for (key, data) in patterns.into_iter().filter(|(_, data)| !data.is_empty()) {
        if budget.reserve_metadata(data.len(), true).is_ok() {
            kept.push(PsdTaggedBlock { key, data: data.to_vec() });
        } else {
            skipped = true;
        }
    }
    skipped
}

fn is_smart_block(key: [u8; 4]) -> bool {
    matches!(&key, b"SoLd" | b"SoLE" | b"PlLd")
}

fn is_preserved_layer_block(key: [u8; 4]) -> bool {
    is_smart_block(key)
        || matches!(
            &key,
            b"vmsk"
                | b"vsms"
                | b"vogk"
                | b"vstk"
                | b"vscg"
                | b"SoCo"
                | b"GdFl"
                | b"PtFl"
        )
}

fn is_fidelity_block(key: [u8; 4]) -> bool {
    matches!(&key, b"TySh" | b"lfx2" | b"lrFX")
        || PSD_ADJUSTMENT_KEYS.contains(&&key)
        || is_preserved_layer_block(key)
}

fn validate_preserved_blocks(doc: &Document) -> Result<()> {
    let blocks = doc.psd_linked_blocks.len()
        + doc
            .layers
            .iter()
            .map(|layer| layer.psd_smart_blocks.len())
            .sum::<usize>();
    let bytes = doc
        .psd_linked_blocks
        .iter()
        .chain(doc.layers.iter().flat_map(|layer| &layer.psd_smart_blocks))
        .try_fold(0usize, |total, block| total.checked_add(block.data.len()))
        .ok_or_else(|| FormatError::Malformed("preserved Photoshop data size overflow".into()))?;
    if blocks > MAX_PSD_PRESERVED_BLOCKS || bytes > MAX_PSD_PRESERVED_BYTES {
        return Err(FormatError::Unsupported(
            "Photoshop preserved layer data exceeds preservation limit".into(),
        ));
    }
    Ok(())
}

fn read_record(r: &mut Reader, header: &Header, budget: &mut PsdDecodeBudget) -> Result<RawLayer> {
    let top = r.i32()?;
    let left = r.i32()?;
    let bottom = r.i32()?;
    let right = r.i32()?;
    let channel_count = r.u16()? as usize;
    if channel_count > MAX_PSD_CHANNELS {
        return Err(FormatError::Unsupported(format!(
            "PSD layer channel count {channel_count} exceeds decoder limit"
        )));
    }
    checked_pixel_count(rect_span(left, right), rect_span(top, bottom), "PSD layer")?;

    let mut channels = Vec::with_capacity(channel_count);
    for _ in 0..channel_count {
        let id = r.i16()?;
        let len = r.read_ptr(header.psb)?; // 4 bytes PSD / 8 bytes PSB
        channels.push(ChannelInfo { id, len });
    }

    let _blend_sig = r.fourcc()?; // 8BIM / 8B64
    let blend_key = r.fourcc()?;
    let opacity = r.u8()?;
    let clipping = r.u8()? == 1;
    let flags = r.u8()?;
    let _filler = r.u8()?;

    let extra_len = r.u32()? as usize;
    let extra_end = r
        .position()
        .checked_add(extra_len)
        .ok_or_else(|| FormatError::Malformed("layer extra length overflow".into()))?;
    if extra_end > r.len() {
        return Err(FormatError::Malformed(
            "layer extra data exceeds file".into(),
        ));
    }

    // 4.2a Layer mask data.
    let mask = read_mask(r)?;
    // 4.2b Layer blending ranges (Blend If): composite gray followed by
    // per-channel source/destination split-slider bytes.
    let blend_if = read_blending_ranges(r)?;
    // 4.2c Pascal name, padded to 4.
    let mut name = r.pascal_string(4)?;

    // 4.2d Additional layer info blocks.
    let mut additional: Vec<([u8; 4], Vec<u8>)> = Vec::new();
    let mut section = Section::None;
    let mut section_key = None;
    let mut fill_opacity = 255;
    let mut knockout = 0u8;
    let mut lock_flags = 0u32;
    let mut blend_restrictions = 0u8;
    let mut transparency_shapes = true;
    let mut blend_interior_group = false;
    let mut blend_clipped_group = false;
    while r.position() + 8 <= extra_end {
        match r.peek4() {
            Some(s) if &s == b"8BIM" || &s == b"8B64" => {}
            _ => break,
        }
        let _sig = r.fourcc()?;
        let key = r.fourcc()?;
        let big = header.psb && psb_uses_8_byte_length(key);
        let len64 = if big { r.u64()? } else { r.u32()? as u64 };
        let len = usize::try_from(len64)
            .map_err(|_| FormatError::Malformed("layer block length overflow".into()))?;
        let block_start = r.position();
        let data_end = block_start
            .checked_add(len)
            .ok_or_else(|| FormatError::Malformed("layer block length overflow".into()))?;
        if data_end > extra_end {
            return Err(FormatError::Malformed(
                "layer block exceeds additional-info section".into(),
            ));
        }

        match &key {
            b"luni" => {
                budget.reserve_metadata(len, false)?;
                let u = r.unicode_string(1)?;
                if !u.is_empty() {
                    name = u;
                }
            }
            b"lsct" | b"lsdk" => {
                let t = r.u32()?;
                section = match t {
                    1 => Section::Open,
                    2 => Section::Closed,
                    3 => Section::Bounding,
                    _ => Section::None,
                };
                if r.position() + 8 <= data_end {
                    let _sig = r.fourcc()?;
                    section_key = Some(r.fourcc()?);
                }
            }
            b"iOpa" => {
                if r.position() < data_end {
                    fill_opacity = r.u8()?;
                }
            }
            b"knko" => {
                if r.position() < data_end {
                    knockout = r.u8()?.min(2);
                }
            }
            b"tsly" => {
                if r.position() < data_end {
                    transparency_shapes = r.u8()? != 0;
                }
            }
            b"infx" => {
                if r.position() < data_end {
                    blend_interior_group = r.u8()? != 0;
                }
            }
            b"clbl" => {
                if r.position() < data_end {
                    blend_clipped_group = r.u8()? != 0;
                }
            }
            b"lspf" => {
                if r.position() + 4 <= data_end {
                    lock_flags = r.u32()?;
                }
            }
            b"brst" => {
                // A list of 4-byte channel ids the layer may NOT blend into.
                while r.position() + 4 <= data_end {
                    let channel = r.u32()?;
                    if channel < 3 {
                        blend_restrictions |= 1 << channel;
                    }
                }
            }
            // A little-endian descriptor would be misread here and written back
            // verbatim into a big-endian file. Text, smart objects and fills
            // show as their pixels without it; effects, adjustments and vector
            // masks change the composite, so their layers cannot open at all.
            // ponytail: transcode descriptors to big-endian if Windows layered
            // TIFFs with styles or adjustment layers need to open layered.
            _ if is_fidelity_block(key) && r.is_little_endian() => {
                if matches!(&key, b"lfx2" | b"lrFX" | b"vmsk" | b"vsms" | b"vstk")
                    || PSD_ADJUSTMENT_KEYS.contains(&&key)
                {
                    return Err(FormatError::Unsupported(
                        "layer effects, adjustments or vector masks in little-endian layer data"
                            .into(),
                    ));
                }
            }
            _ if is_fidelity_block(key) => {
                budget.reserve_metadata(len, true)?;
                let data = r.read_vec(data_end - block_start)?;
                additional.push((key, data));
            }
            _ => {}
        }
        if r.position() > data_end {
            return Err(FormatError::Malformed(
                "layer block parser exceeded declared payload".into(),
            ));
        }
        // The declared length may or may not count the alignment, which is 4
        // bytes in Photoshop's files and 2 in Adobe's spec and psdtags'. The
        // next block starts at the 2-byte end when a whole block fits there,
        // else at the 4-byte end (padding that is not zero can look like a
        // signature). Preserve exactly the payload, then skip the padding.
        let padded_end = |align: usize| {
            len.checked_add(align - 1)
                .and_then(|len| block_start.checked_add(len & !(align - 1)))
                .ok_or_else(|| FormatError::Malformed("layer block padding overflow".into()))
        };
        let even = padded_end(2)?;
        let next = if block_fits(r, even, extra_end, header.psb)? { even } else { padded_end(4)? };
        r.seek(next.min(extra_end))?;
    }
    r.seek(extra_end.min(r.len()))?;

    Ok(RawLayer {
        top,
        left,
        bottom,
        right,
        channels,
        blend_key,
        opacity,
        fill_opacity,
        knockout,
        lock_flags,
        blend_restrictions,
        transparency_shapes,
        blend_interior_group,
        blend_clipped_group,
        blend_if,
        clipping,
        flags,
        name,
        mask,
        section,
        section_key,
        additional,
        rgba: Vec::new(),
        rgba16: Vec::new(),
        rgba32: Vec::new(),
        mask_pixels: Vec::new(),
        mask_pixels16: Vec::new(),
        mask_pixels32: Vec::new(),
        real_mask_pixels: Vec::new(),
        real_mask_pixels16: Vec::new(),
        real_mask_pixels32: Vec::new(),
    })
}

/// Whether a whole additional-info block, header and payload, lies in
/// `[at, end)`.
fn block_fits(r: &mut Reader, at: usize, end: usize, psb: bool) -> Result<bool> {
    if at.checked_add(12).is_none_or(|header_end| header_end > end) {
        return Ok(false);
    }
    r.seek(at)?;
    if !matches!(r.peek4(), Some(s) if &s == b"8BIM" || &s == b"8B64") {
        return Ok(false);
    }
    r.skip(4)?;
    let key = r.fourcc()?;
    let len = if psb && psb_uses_8_byte_length(key) {
        if r.position() + 8 > end {
            return Ok(false);
        }
        r.u64()?
    } else {
        u64::from(r.u32()?)
    };
    Ok((r.position() as u64)
        .checked_add(len)
        .is_some_and(|block_end| block_end <= end as u64))
}

fn read_blending_ranges(r: &mut Reader) -> Result<Option<[f32; 32]>> {
    let len = r.u32()? as usize;
    if len == 0 {
        return Ok(None);
    }
    if len < 8 || len % 8 != 0 {
        return Err(FormatError::Malformed(
            "invalid layer blending ranges length".into(),
        ));
    }
    // Four one-byte values per range, which a little-endian file reverses as
    // one 4-byte integer.
    let bytes: Vec<u8> = (0..len / 4)
        .map(|_| r.u32().map(u32::to_be_bytes))
        .collect::<Result<Vec<_>>>()?
        .concat();
    let mut ranges = [0.0f32; 32];
    for channel in 0..4 {
        ranges[channel * 8 + 2] = 1.0;
        ranges[channel * 8 + 3] = 1.0;
        ranges[channel * 8 + 6] = 1.0;
        ranges[channel * 8 + 7] = 1.0;
    }
    for channel in 0..(len / 8).min(4) {
        for value in 0..8 {
            ranges[channel * 8 + value] = bytes[channel * 8 + value] as f32 / 255.0;
        }
    }
    Ok(Some(ranges))
}

fn read_mask(r: &mut Reader) -> Result<Option<RawMask>> {
    let len = r.u32()? as usize;
    if len == 0 {
        return Ok(None);
    }
    let start = r.position();
    let end = start
        .checked_add(len)
        .ok_or_else(|| FormatError::Malformed("layer mask length overflow".into()))?;
    if len < 18 || end > r.len() {
        return Err(FormatError::Malformed("invalid layer mask length".into()));
    }
    let top = r.i32()?;
    let left = r.i32()?;
    let bottom = r.i32()?;
    let right = r.i32()?;
    let default = r.u8()?;
    let flags = r.u8()?;
    let mut density = None;
    let mut feather = None;
    let mut vector_density = None;
    let mut vector_feather = None;
    // Adobe's order is base rectangle/default/flags, optional user/vector mask
    // parameters, then the optional 18-byte real-mask tail.
    if flags & 0x10 != 0 {
        if r.position() >= end {
            return Err(FormatError::Malformed(
                "missing layer mask parameters".into(),
            ));
        }
        let params = r.u8()?;
        if params & 0x01 != 0 {
            require_mask_bytes(r, end, 1)?;
            density = Some(r.u8()?);
        }
        if params & 0x02 != 0 {
            require_mask_bytes(r, end, 8)?;
            let value = r.f64()?;
            if !value.is_finite() || value < 0.0 {
                return Err(FormatError::Malformed("invalid layer mask feather".into()));
            }
            feather = Some(value);
        }
        if params & 0x04 != 0 {
            require_mask_bytes(r, end, 1)?;
            vector_density = Some(r.u8()?);
        }
        if params & 0x08 != 0 {
            require_mask_bytes(r, end, 8)?;
            let value = r.f64()?;
            if !value.is_finite() || value < 0.0 {
                return Err(FormatError::Malformed(
                    "invalid vector mask feather".into(),
                ));
            }
            vector_feather = Some(value);
        }
        if r.position() > end {
            return Err(FormatError::Malformed(
                "layer mask parameters exceed block".into(),
            ));
        }
    }
    let real = if end.saturating_sub(r.position()) >= 18 {
        let real_flags = r.u8()?;
        let real_default = r.u8()?;
        let real_top = r.i32()?;
        let real_left = r.i32()?;
        let real_bottom = r.i32()?;
        let real_right = r.i32()?;
        let real_w = rect_span(real_left, real_right);
        let real_h = rect_span(real_top, real_bottom);
        checked_pixel_count(real_w, real_h, "PSD real layer mask")?;
        Some(Box::new(RawMask {
            x: real_left,
            y: real_top,
            w: real_w,
            h: real_h,
            default: real_default,
            disabled: real_flags & 0x02 != 0,
            relative: real_flags & 0x01 != 0,
            invert: real_flags & 0x04 != 0,
            density: None,
            feather: None,
            vector_density: None,
            vector_feather: None,
            real: None,
        }))
    } else {
        None
    };
    // A basic mask block carries two zero padding bytes. Accept arbitrary zero
    // alignment padding, but reject non-zero partial tails instead of silently
    // discarding malformed real-mask metadata.
    if r.position() < end {
        let padding = r.read_bytes(end - r.position())?;
        if padding.iter().any(|byte| *byte != 0) {
            return Err(FormatError::Malformed(
                "invalid layer mask trailing data".into(),
            ));
        }
    }
    r.seek(end)?;
    let w = rect_span(left, right);
    let h = rect_span(top, bottom);
    checked_pixel_count(w, h, "PSD layer mask")?;
    Ok(Some(RawMask {
        x: left,
        y: top,
        w,
        h,
        default,
        disabled: flags & 0x02 != 0,
        relative: flags & 0x01 != 0,
        invert: flags & 0x04 != 0,
        density,
        feather,
        vector_density,
        vector_feather,
        real,
    }))
}

fn require_mask_bytes(r: &Reader<'_>, end: usize, need: usize) -> Result<()> {
    if r.position().checked_add(need).is_none_or(|next| next > end) {
        return Err(FormatError::Malformed(
            "layer mask parameters exceed block".into(),
        ));
    }
    Ok(())
}

/// Bytes per channel sample for the document depth.
fn sample_bytes(depth: u16) -> usize {
    match depth {
        16 => 2,
        32 => 4,
        _ => 1,
    }
}

#[derive(Default)]
struct DecodeProjection {
    samples: usize,
    bytes: usize,
}

impl DecodeProjection {
    fn add(
        &mut self,
        samples: usize,
        bytes_per_sample: usize,
        copies: usize,
    ) -> Result<()> {
        let allocated_samples = samples
            .checked_mul(copies)
            .ok_or_else(|| FormatError::Malformed("decoded sample projection overflow".into()))?;
        let allocated_bytes = allocated_samples
            .checked_mul(bytes_per_sample)
            .ok_or_else(|| FormatError::Malformed("decoded byte projection overflow".into()))?;
        self.samples = self
            .samples
            .checked_add(allocated_samples)
            .ok_or_else(|| FormatError::Malformed("decoded sample projection overflow".into()))?;
        self.bytes = self
            .bytes
            .checked_add(allocated_bytes)
            .ok_or_else(|| FormatError::Malformed("decoded byte projection overflow".into()))?;
        Ok(())
    }

    /// The heavier of two projections, for allocations that are alive one at a
    /// time rather than all at once. Compared on bytes — the limit that binds
    /// first for every real document — and kept as one piece so the returned
    /// sample count still belongs with the byte count it was measured with.
    fn max(self, other: Self) -> Self {
        if other.bytes > self.bytes {
            other
        } else {
            self
        }
    }
}

fn layer_channel_samples(layer: &RawLayer, id: i16) -> Result<usize> {
    match id {
        -2 => layer
            .mask
            .as_ref()
            .map(|mask| checked_pixel_count(mask.w, mask.h, "PSD layer mask"))
            .transpose()
            .map(Option::unwrap_or_default),
        -3 => layer
            .mask
            .as_ref()
            .and_then(|mask| mask.real.as_deref())
            .map(|mask| checked_pixel_count(mask.w, mask.h, "PSD real layer mask"))
            .transpose()?
            .ok_or_else(|| {
                FormatError::Malformed(
                    "real layer-mask channel has no real-mask metadata".into(),
                )
            }),
        _ => checked_pixel_count(layer.width(), layer.height(), "PSD layer"),
    }
}

fn reserve_layer_decodes(
    layers: &[RawLayer],
    header: &Header,
    budget: &mut PsdDecodeBudget,
) -> Result<()> {
    let native_bytes = sample_bytes(header.depth);
    let mut retained = DecodeProjection::default();
    // `read_channels` builds every channel's raw and typed plane for ONE layer,
    // then drops them when it returns. Charging each layer's share as though
    // they were all live at once refused documents that decode comfortably —
    // an ordinary 24 MP 16-bit two-layer file, Vision's own included. Only the
    // heaviest layer's transient planes are ever held together, so that is what
    // the peak reserves.
    let mut peak_transient = DecodeProjection::default();
    for layer in layers {
        let layer_samples = checked_pixel_count(layer.width(), layer.height(), "PSD layer")?;
        let mut transient = DecodeProjection::default();
        for channel in &layer.channels {
            if !channel_is_used(channel.id, header.color_mode) {
                continue;
            }
            let samples = layer_channel_samples(layer, channel.id)?;
            // The compressed payload first expands to raw bytes, then to a
            // typed native plane; both coexist briefly.
            transient.add(samples, native_bytes, 2)?;
            if matches!(channel.id, -2 | -3) {
                retained.add(samples, 1, 1)?; // retained 8-bit mask preview
            }
        }
        peak_transient = peak_transient.max(transient);

        let rgba_samples = layer_samples.checked_mul(4).ok_or_else(|| {
            FormatError::Malformed("layer RGBA sample projection overflow".into())
        })?;
        retained.add(rgba_samples, native_bytes, 1)?;
        if header.depth > 8 {
            retained.add(rgba_samples, 1, 1)?; // compatibility preview
        }
    }
    budget.reserve_decoded(
        retained.samples.saturating_add(peak_transient.samples),
        retained.bytes.saturating_add(peak_transient.bytes),
    )
}

#[derive(Clone)]
enum ChannelPlane {
    U8(Vec<u8>),
    U16(Vec<u16>),
    F32(Vec<f32>),
}

impl ChannelPlane {
    fn preview_u8(&self) -> Vec<u8> {
        match self {
            ChannelPlane::U8(values) => values.clone(),
            ChannelPlane::U16(values) => values.iter().map(|v| (v >> 8) as u8).collect(),
            ChannelPlane::F32(values) => values
                .iter()
                .map(|v| (v.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
                .collect(),
        }
    }
}

fn decode_native_plane(raw: &[u8], depth: u16, count: usize) -> Result<ChannelPlane> {
    match depth {
        16 => {
            if raw.len() < count.saturating_mul(2) {
                return Err(FormatError::Malformed("16-bit channel underrun".into()));
            }
            Ok(ChannelPlane::U16(
                raw.chunks_exact(2)
                    .take(count)
                    .map(|bytes| u16::from_be_bytes([bytes[0], bytes[1]]))
                    .collect(),
            ))
        }
        32 => {
            if raw.len() < count.saturating_mul(4) {
                return Err(FormatError::Malformed("32-bit channel underrun".into()));
            }
            let mut values = Vec::with_capacity(count);
            for bytes in raw.chunks_exact(4).take(count) {
                let value = f32::from_be_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
                if !value.is_finite() || value.abs() > MAX_HDR_SAMPLE {
                    return Err(FormatError::Malformed(
                        "non-finite or unreasonable 32-bit channel sample".into(),
                    ));
                }
                values.push(value);
            }
            Ok(ChannelPlane::F32(values))
        }
        _ => {
            let mut values = raw[..count.min(raw.len())].to_vec();
            values.resize(count, 0);
            Ok(ChannelPlane::U8(values))
        }
    }
}

fn read_channels(r: &mut Reader, header: &Header, layer: &mut RawLayer) -> Result<()> {
    let sb = sample_bytes(header.depth);
    let lw = layer.width() as usize;
    let lh = layer.height() as usize;
    let layer_count = checked_pixel_count(layer.width(), layer.height(), "PSD layer")?;

    let mut planes: Vec<(i16, ChannelPlane)> = Vec::with_capacity(layer.channels.len());
    for ch in layer.channels.clone() {
        let (cw, ch_h) = match ch.id {
            -2 => layer
                .mask
                .as_ref()
                .map(|mask| (mask.w as usize, mask.h as usize))
                .unwrap_or((0, 0)),
            -3 => layer
                .mask
                .as_ref()
                .and_then(|mask| mask.real.as_deref())
                .map(|mask| (mask.w as usize, mask.h as usize))
                .ok_or_else(|| {
                    FormatError::Malformed(
                        "real layer-mask channel has no real-mask metadata".into(),
                    )
                })?,
            _ => (lw, lh),
        };
        let payload_len = usize::try_from(ch.len)
            .map_err(|_| FormatError::Malformed("channel payload length overflow".into()))?
            .checked_sub(2)
            .ok_or_else(|| FormatError::Malformed("channel payload shorter than header".into()))?;
        let comp = r.u16()?;
        let payload = r.read_bytes(payload_len)?;
        if !channel_is_used(ch.id, header.color_mode) {
            continue;
        }
        let raw = decode_channel(payload, comp, cw, ch_h, sb, header.psb)?;
        let plane_count = cw
            .checked_mul(ch_h)
            .ok_or_else(|| FormatError::Malformed("channel sample count overflow".into()))?;
        planes.push((ch.id, decode_native_plane(&raw, header.depth, plane_count)?));
    }

    // Assemble RGBA from the colour channels.
    let count = layer_count;
    if count > 0 {
        match header.depth {
            16 => layer.rgba16 = assemble_rgba16(&planes, count, header.color_mode)?,
            32 => layer.rgba32 = assemble_rgba32(&planes, count, header.color_mode)?,
            _ => layer.rgba = assemble_rgba8(&planes, count, header.color_mode),
        }
        // Keep an 8-bit compatibility preview for callers that have not adopted
        // the native fields. It is never used as high-depth authority.
        if layer.rgba.is_empty() {
            layer.rgba = if !layer.rgba16.is_empty() {
                layer
                    .rgba16
                    .iter()
                    .map(|value| (value >> 8) as u8)
                    .collect()
            } else {
                layer
                    .rgba32
                    .iter()
                    .map(|value| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
                    .collect()
            };
        }
    }

    // Mask planes: -2 = user mask, -3 = real user mask. Keep their native
    // samples as export authority and derive only the engine compatibility
    // preview at import time.
    if let Some(plane) = take_channel_plane(&mut planes, -2) {
        store_mask_plane(
            plane,
            &mut layer.mask_pixels,
            &mut layer.mask_pixels16,
            &mut layer.mask_pixels32,
        );
    }
    if let Some(plane) = take_channel_plane(&mut planes, -3) {
        store_mask_plane(
            plane,
            &mut layer.real_mask_pixels,
            &mut layer.real_mask_pixels16,
            &mut layer.real_mask_pixels32,
        );
    }
    Ok(())
}

fn take_channel_plane(planes: &mut Vec<(i16, ChannelPlane)>, id: i16) -> Option<ChannelPlane> {
    let index = planes.iter().position(|(plane_id, _)| *plane_id == id)?;
    Some(planes.remove(index).1)
}

fn store_mask_plane(
    plane: ChannelPlane,
    preview: &mut Vec<u8>,
    native16: &mut Vec<u16>,
    native32: &mut Vec<f32>,
) {
    *preview = plane.preview_u8();
    match plane {
        ChannelPlane::U8(_) => {}
        ChannelPlane::U16(values) => *native16 = values,
        ChannelPlane::F32(values) => *native32 = values,
    }
}

fn channel_is_used(id: i16, color_mode: u16) -> bool {
    if matches!(id, -1 | -2 | -3) {
        return true;
    }
    id >= 0 && (id as usize) < psd_color_channel_count(color_mode)
}

/// sRGB's ICC colorants, Bradford-adapted to D50: Photoshop's Lab is D50 (the
/// ICC connection space), so sRGB goes through these rather than its D65
/// matrix to agree with it.
const SRGB_TO_XYZ_D50: [[f32; 3]; 3] = [
    [0.436_074_7, 0.385_064_9, 0.143_080_4],
    [0.222_504_5, 0.716_878_6, 0.060_616_9],
    [0.013_932_2, 0.097_104_5, 0.714_173_3],
];
const XYZ_D50_TO_SRGB: [[f32; 3]; 3] = [
    [3.133_856_1, -1.616_866_7, -0.490_614_6],
    [-0.978_768_4, 1.916_141_5, 0.033_454_0],
    [0.071_945_3, -0.228_991_4, 1.405_242_7],
];
/// The D50 white those colorants sum to, so every neutral lands on a = b = 0.
const D50_WHITE: [f32; 3] = [0.964_22, 1.0, 0.825_21];

fn mul3(m: &[[f32; 3]; 3], v: [f32; 3]) -> [f32; 3] {
    m.map(|row| row[0] * v[0] + row[1] * v[1] + row[2] * v[2])
}

/// sRGB (each component 0..1) to CIE L*a*b* D50, the Lab Photoshop stores.
pub fn srgb_to_lab(rgb: [f32; 3]) -> [f32; 3] {
    let linear = |c: f32| {
        if c <= 0.04045 {
            c / 12.92
        } else {
            ((c + 0.055) / 1.055).powf(2.4)
        }
    };
    let f = |t: f32| {
        if t > 0.008856 {
            t.cbrt()
        } else {
            7.787 * t + 16.0 / 116.0
        }
    };
    let xyz = mul3(&SRGB_TO_XYZ_D50, rgb.map(linear));
    let [fx, fy, fz] = [0, 1, 2].map(|i| f(xyz[i] / D50_WHITE[i]));
    [116.0 * fy - 16.0, 500.0 * (fx - fy), 200.0 * (fy - fz)]
}

/// CIE L*a*b* D50 to sRGB, each component 0..1: the inverse of `srgb_to_lab`,
/// so a Lab file reads back as the colours it was written from.
pub fn lab_to_srgb(lab: [f32; 3]) -> [f32; 3] {
    let fy = (lab[0] + 16.0) / 116.0;
    let inv = |t: f32| {
        if t > 0.206_896_55 {
            t * t * t
        } else {
            (t - 16.0 / 116.0) / 7.787
        }
    };
    let gamma = |c: f32| {
        if c <= 0.0031308 {
            c * 12.92
        } else {
            1.055 * c.max(0.0).powf(1.0 / 2.4) - 0.055
        }
    };
    let f = [fy + lab[1] / 500.0, fy, fy - lab[2] / 200.0];
    let xyz = [0, 1, 2].map(|i| inv(f[i]) * D50_WHITE[i]);
    mul3(&XYZ_D50_TO_SRGB, xyz).map(|c| gamma(c).clamp(0.0, 1.0))
}

/// One pixel of a Lab file's L, a, b planes, each normalised to its 0..1 code
/// range, as sRGB. Photoshop centres a and b on 128 at 8 bits and on 0x8000
/// at 16 (a = code / 256 - 128), so the 16-bit form is picked by `sixteen`.
fn lab_codes_to_srgb(l: f32, a: f32, b: f32, sixteen: bool) -> [f32; 3] {
    let chroma = |v: f32| {
        if sixteen {
            v * 65_535.0 / 256.0 - 128.0
        } else {
            v * 255.0 - 128.0
        }
    };
    lab_to_srgb([l * 100.0, chroma(a), chroma(b)])
}

fn assemble_rgba8(planes: &[(i16, ChannelPlane)], count: usize, color_mode: u16) -> Vec<u8> {
    let plane = |id: i16| {
        planes
            .iter()
            .find_map(|(plane_id, plane)| match (plane_id, plane) {
                (found, ChannelPlane::U8(values)) if *found == id => Some(values.as_slice()),
                _ => None,
            })
    };
    let at = |id: i16, i: usize, default: u8| {
        plane(id)
            .and_then(|values| values.get(i))
            .copied()
            .unwrap_or(default)
    };
    let mut rgba = vec![0u8; count * 4];
    if matches!(color_mode, 4 | 7) {
        for i in 0..count {
            let k = at(3, i, 255) as u32;
            rgba[i * 4] = (at(0, i, 255) as u32 * k / 255) as u8;
            rgba[i * 4 + 1] = (at(1, i, 255) as u32 * k / 255) as u8;
            rgba[i * 4 + 2] = (at(2, i, 255) as u32 * k / 255) as u8;
            rgba[i * 4 + 3] = at(-1, i, 255);
        }
    } else if color_mode == 9 {
        let code = |id: i16, i: usize, default: u8| at(id, i, default) as f32 / 255.0;
        for i in 0..count {
            let rgb = lab_codes_to_srgb(code(0, i, 0), code(1, i, 128), code(2, i, 128), false);
            for c in 0..3 {
                rgba[i * 4 + c] = (rgb[c] * 255.0 + 0.5) as u8;
            }
            rgba[i * 4 + 3] = at(-1, i, 255);
        }
    } else {
        let grayscale = plane(1).is_none() && plane(2).is_none();
        for i in 0..count {
            let r = at(0, i, 0);
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = if grayscale { r } else { at(1, i, 0) };
            rgba[i * 4 + 2] = if grayscale { r } else { at(2, i, 0) };
            rgba[i * 4 + 3] = at(-1, i, 255);
        }
    }
    rgba
}

fn assemble_rgba16(
    planes: &[(i16, ChannelPlane)],
    count: usize,
    color_mode: u16,
) -> Result<Vec<u16>> {
    let plane = |id: i16| {
        planes
            .iter()
            .find_map(|(plane_id, plane)| match (plane_id, plane) {
                (found, ChannelPlane::U16(values)) if *found == id => Some(values.as_slice()),
                _ => None,
            })
    };
    let at = |id: i16, i: usize, default: u16| {
        plane(id)
            .and_then(|values| values.get(i))
            .copied()
            .unwrap_or(default)
    };
    let mut rgba = vec![0u16; count * 4];
    if matches!(color_mode, 4 | 7) {
        for i in 0..count {
            let k = at(3, i, u16::MAX) as u64;
            rgba[i * 4] = ((at(0, i, u16::MAX) as u64 * k + 32_767) / 65_535) as u16;
            rgba[i * 4 + 1] = ((at(1, i, u16::MAX) as u64 * k + 32_767) / 65_535) as u16;
            rgba[i * 4 + 2] = ((at(2, i, u16::MAX) as u64 * k + 32_767) / 65_535) as u16;
            rgba[i * 4 + 3] = at(-1, i, u16::MAX);
        }
    } else if color_mode == 9 {
        let code = |id: i16, i: usize, default: u16| at(id, i, default) as f32 / 65_535.0;
        for i in 0..count {
            let rgb =
                lab_codes_to_srgb(code(0, i, 0), code(1, i, 0x8000), code(2, i, 0x8000), true);
            for c in 0..3 {
                rgba[i * 4 + c] = (rgb[c] * 65_535.0 + 0.5) as u16;
            }
            rgba[i * 4 + 3] = at(-1, i, u16::MAX);
        }
    } else {
        let grayscale = plane(1).is_none() && plane(2).is_none();
        for i in 0..count {
            let r = at(0, i, 0);
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = if grayscale { r } else { at(1, i, 0) };
            rgba[i * 4 + 2] = if grayscale { r } else { at(2, i, 0) };
            rgba[i * 4 + 3] = at(-1, i, u16::MAX);
        }
    }
    Ok(rgba)
}

fn assemble_rgba32(
    planes: &[(i16, ChannelPlane)],
    count: usize,
    color_mode: u16,
) -> Result<Vec<f32>> {
    let plane = |id: i16| {
        planes
            .iter()
            .find_map(|(plane_id, plane)| match (plane_id, plane) {
                (found, ChannelPlane::F32(values)) if *found == id => Some(values.as_slice()),
                _ => None,
            })
    };
    let at = |id: i16, i: usize, default: f32| {
        plane(id)
            .and_then(|values| values.get(i))
            .copied()
            .unwrap_or(default)
    };
    let mut rgba = vec![0.0f32; count * 4];
    let grayscale = plane(1).is_none() && plane(2).is_none();
    for i in 0..count {
        let alpha = at(-1, i, 1.0);
        if !(0.0..=1.0).contains(&alpha) {
            return Err(FormatError::Malformed(
                "32-bit alpha sample outside 0..1".into(),
            ));
        }
        if matches!(color_mode, 4 | 7) {
            let channels = [at(0, i, 1.0), at(1, i, 1.0), at(2, i, 1.0), at(3, i, 1.0)];
            if channels.iter().any(|value| !(0.0..=1.0).contains(value)) {
                return Err(FormatError::Malformed(
                    "32-bit CMYK sample outside 0..1".into(),
                ));
            }
            rgba[i * 4] = channels[0] * channels[3];
            rgba[i * 4 + 1] = channels[1] * channels[3];
            rgba[i * 4 + 2] = channels[2] * channels[3];
        } else if color_mode == 9 {
            // Photoshop has no 32-bit Lab; read one as 8-bit-style codes.
            let code = |id: i16, default: f32| at(id, i, default).clamp(0.0, 1.0);
            let rgb = lab_codes_to_srgb(
                code(0, 0.0),
                code(1, 128.0 / 255.0),
                code(2, 128.0 / 255.0),
                false,
            );
            rgba[i * 4..i * 4 + 3].copy_from_slice(&rgb);
        } else {
            let r = at(0, i, 0.0);
            rgba[i * 4] = r;
            rgba[i * 4 + 1] = if grayscale { r } else { at(1, i, 0.0) };
            rgba[i * 4 + 2] = if grayscale { r } else { at(2, i, 0.0) };
        }
        rgba[i * 4 + 3] = alpha;
    }
    Ok(rgba)
}

/// Decode one channel's compressed payload to its raw `cw*ch*sample_bytes` bytes.
fn decode_channel(
    payload: &[u8],
    comp: u16,
    cw: usize,
    ch: usize,
    sb: usize,
    psb: bool,
) -> Result<Vec<u8>> {
    let expected = cw
        .checked_mul(ch)
        .and_then(|samples| samples.checked_mul(sb))
        .ok_or_else(|| FormatError::Malformed("channel byte count overflow".into()))?;
    if expected == 0 {
        return Ok(Vec::new());
    }
    match comp {
        0 => {
            if payload.len() < expected {
                return Err(FormatError::Malformed("raw channel underrun".into()));
            }
            Ok(payload[..expected].to_vec())
        }
        1 => {
            // Per-row count table (u16 PSD / u32 PSB), then PackBits rows.
            let entry = if psb { 4 } else { 2 };
            let table = ch
                .checked_mul(entry)
                .ok_or_else(|| FormatError::Malformed("RLE table size overflow".into()))?;
            if payload.len() < table {
                return Err(FormatError::Malformed("rle count table underrun".into()));
            }
            packbits_decode(&payload[table..], expected)
        }
        2 => zlib_inflate_exact(payload, expected),
        3 => zip_predicted(payload, cw, ch, sb),
        c => Err(FormatError::Unsupported(format!("PSD compression {c}"))),
    }
}

/// Reverse of the engine's `psd_blend_key`, extended with every documented key.
/// Returns the blend mode and whether it is the group-only "pass through".
fn blend_from_key(k: &[u8; 4]) -> (BlendMode, bool) {
    use crate::import::BlendMode::*;
    match k {
        b"pass" => (Normal, true),
        b"norm" => (Normal, false),
        b"diss" => (Dissolve, false),
        b"dark" => (Darken, false),
        b"mul " => (Multiply, false),
        b"idiv" => (ColorBurn, false),
        b"lbrn" => (LinearBurn, false),
        b"lite" => (Lighten, false),
        b"scrn" => (Screen, false),
        b"div " => (ColorDodge, false),
        b"lddg" => (LinearDodge, false),
        b"over" => (Overlay, false),
        b"sLit" => (SoftLight, false),
        b"hLit" => (HardLight, false),
        b"vLit" => (VividLight, false),
        b"lLit" => (LinearLight, false),
        b"pLit" => (PinLight, false),
        b"hMix" => (HardMix, false),
        b"diff" => (Difference, false),
        b"smud" => (Exclusion, false),
        b"fsub" => (Subtract, false),
        b"fdiv" => (Divide, false),
        b"hue " => (Hue, false),
        b"sat " => (Saturation, false),
        b"colr" => (Color, false),
        b"lum " => (Luminosity, false),
        b"dkCl" => (DarkerColor, false),
        b"lgCl" => (LighterColor, false),
        _ => (Normal, false),
    }
}

/// Detect a non-group layer's kind from its tagged blocks.
fn detect_kind(raw: &RawLayer) -> LayerKind {
    if raw.find(b"TySh").is_some() {
        return LayerKind::Text;
    }
    if PSD_ADJUSTMENT_KEYS.iter().any(|k| raw.find(k).is_some()) {
        return LayerKind::Adjustment;
    }
    if raw.find(b"SoLd").is_some() || raw.find(b"SoLE").is_some() || raw.find(b"PlLd").is_some() {
        return LayerKind::SmartObject;
    }
    LayerKind::Raster
}

/// Map the bottom-to-top record list into the flat IR layer list with group
/// parent linkage. Mirrors ag-psd / Photoshop: walk top-to-bottom maintaining a
/// stack — folder dividers (type 1/2) open a group, bounding sections (type 3)
/// close it and are themselves dropped.
fn build_layers(raw: Vec<RawLayer>, header: &Header) -> Result<Vec<Layer>> {
    // Assign stable ids (1-based) by record index.
    let n = raw.len();
    let mut out: Vec<Layer> = Vec::with_capacity(n);
    // Pre-compute the parent id for each record by walking top-to-bottom.
    let mut parent_of: Vec<Option<u32>> = vec![None; n];
    let mut stack: Vec<u32> = Vec::new();
    for i in (0..n).rev() {
        let id = (i + 1) as u32;
        match raw[i].section {
            Section::Open | Section::Closed => {
                parent_of[i] = stack.last().copied();
                stack.push(id);
            }
            Section::Bounding => {
                stack.pop();
            }
            Section::None => {
                parent_of[i] = stack.last().copied();
            }
        }
    }

    for (i, mut rl) in raw.into_iter().enumerate() {
        if rl.section == Section::Bounding {
            continue; // group terminator — not a real layer
        }
        let id = (i + 1) as u32;
        let is_group = matches!(rl.section, Section::Open | Section::Closed);

        let (blend, pass_through) = if is_group {
            match rl.section_key {
                Some(k) => blend_from_key(&k),
                None => (BlendMode::Normal, false),
            }
        } else {
            blend_from_key(&rl.blend_key)
        };

        let kind = if is_group {
            LayerKind::Group
        } else {
            detect_kind(&rl)
        };

        let bounds = Bounds {
            x: rl.left,
            y: rl.top,
            w: rl.width(),
            h: rl.height(),
        };

        let raw_mask = rl.mask.clone();
        let real_mask = raw_mask
            .as_ref()
            .and_then(|mask| mask.real.as_deref())
            .and_then(|mask| {
                build_mask(
                    mask,
                    std::mem::take(&mut rl.real_mask_pixels),
                    std::mem::take(&mut rl.real_mask_pixels16),
                    std::mem::take(&mut rl.real_mask_pixels32),
                    None,
                )
            });
        let mask = raw_mask.as_ref().and_then(|mask| {
            build_mask(
                mask,
                std::mem::take(&mut rl.mask_pixels),
                std::mem::take(&mut rl.mask_pixels16),
                std::mem::take(&mut rl.mask_pixels32),
                real_mask,
            )
        });

        let mut layer = Layer::new(id, rl.name.clone(), kind, bounds);
        layer.parent = parent_of[i];
        layer.opacity = rl.opacity as f32 / 255.0;
        layer.fill_opacity = rl.fill_opacity as f32 / 255.0;
        layer.knockout = rl.knockout;
        layer.blend_if = rl.blend_if;
        layer.blend = blend;
        layer.pass_through = pass_through;
        layer.visible = rl.flags & 0x02 == 0;
        layer.clipping = rl.clipping;
        // `lspf` is the lock authority when present: bits 0..2 are the three
        // per-attribute locks and bit 31 is Lock All, kept apart so every
        // combination survives a round trip. Without the block, the record's
        // transparency-protected flag is the only lock signal, and it means
        // exactly that — not Lock All.
        let lspf = rl.lock_flags;
        layer.locked = lspf & 0x8000_0000 != 0;
        layer.lock_transparent = lspf & 0x1 != 0 || (lspf == 0 && rl.flags & 0x01 != 0);
        layer.lock_image = lspf & 0x2 != 0;
        layer.lock_position = lspf & 0x4 != 0;
        layer.blend_channels = ALL_BLEND_CHANNELS & !rl.blend_restrictions;
        layer.transparency_shapes = rl.transparency_shapes;
        layer.blend_interior_group = rl.blend_interior_group;
        layer.blend_clipped_group = rl.blend_clipped_group;
        layer.raw_blend_key = Some(rl.blend_key);
        layer.mask = mask;

        // Full-fidelity: decode text / adjustment / effects from tagged blocks.
        psd_fidelity(&rl, &mut layer, header.depth);

        // Fidelity decoding only borrows the raw record. Move every bounded
        // fidelity block and the pixel planes into the IR afterwards instead
        // of cloning them and temporarily doubling decoder memory. Semantic
        // blocks remain the byte authority until an edit is proven safe to
        // regenerate.
        layer.psd_smart_blocks = rl
            .additional
            .into_iter()
            .filter(|(key, _)| is_fidelity_block(*key))
            .map(|(key, data)| PsdTaggedBlock { key, data })
            .collect();
        if !is_group {
            layer.rgba = rl.rgba;
            layer.rgba16 = rl.rgba16;
            layer.rgba32 = rl.rgba32;
        }

        out.push(layer);
    }
    Ok(out)
}

fn build_mask(
    raw: &RawMask,
    data: Vec<u8>,
    data16: Vec<u16>,
    data32: Vec<f32>,
    real: Option<Mask>,
) -> Option<Mask> {
    let samples = (raw.w as usize).checked_mul(raw.h as usize)?;
    if samples == 0 || data.len() != samples {
        return None;
    }
    if (!data16.is_empty() && data16.len() != samples)
        || (!data32.is_empty() && data32.len() != samples)
        || (!data16.is_empty() && !data32.is_empty())
    {
        return None;
    }
    Some(Mask {
        x: raw.x,
        y: raw.y,
        w: raw.w,
        h: raw.h,
        data,
        data16,
        data32,
        default: raw.default,
        disabled: raw.disabled,
        relative: raw.relative,
        invert: raw.invert,
        density: raw.density,
        feather: raw.feather,
        vector_density: raw.vector_density,
        vector_feather: raw.vector_feather,
        real: real.map(Box::new),
    })
}

/// Unpack a 1-bit (Bitmap mode) channel into a w*h 8-bit grayscale plane. Rows
/// are ceil(w/8) bytes, bits are MSB-first, and — matching Photoshop / ag-psd —
/// a set bit is black (0) and a clear bit is white (255).
fn unpack_1bit(packed: &[u8], w: usize, h: usize) -> Vec<u8> {
    let stride = w.div_ceil(8);
    let mut out = vec![0u8; w * h];
    for y in 0..h {
        for x in 0..w {
            let byte = packed.get(y * stride + x / 8).copied().unwrap_or(0);
            let bit = (byte >> (7 - (x % 8))) & 1;
            out[y * w + x] = if bit == 1 { 0 } else { 255 };
        }
    }
    out
}

/// Single-layer fallback: read the merged composite at the end of the file as a
/// "Background" raster layer (used when there is no layer section).
fn read_merged_image(
    r: &mut Reader,
    header: &Header,
    palette: Option<&[u8]>,
    resources: &ChannelResources,
    merged_transparency: bool,
    budget: &mut PsdDecodeBudget,
) -> Result<(Layer, Vec<DocumentChannel>)> {
    let w = header.width as usize;
    let h = header.height as usize;
    let sb = sample_bytes(header.depth);
    let comp = r.u16()?;
    let nch = header.channels as usize;
    // 1-bit Bitmap mode packs 8 pixels per byte (rows are ceil(w/8) bytes); every
    // other depth is `sb` bytes per sample. High-depth planes remain native.
    let one_bit = header.depth == 1;
    let sample_count = checked_pixel_count(header.width, header.height, "PSD canvas")?;
    let chan_bytes = if one_bit {
        w.div_ceil(8)
            .checked_mul(h)
            .ok_or_else(|| FormatError::Malformed("bitmap channel size overflow".into()))?
    } else {
        sample_count
            .checked_mul(sb)
            .ok_or_else(|| FormatError::Malformed("merged channel size overflow".into()))?
    };
    let total_bytes = chan_bytes
        .checked_mul(nch)
        .ok_or_else(|| FormatError::Malformed("merged image size overflow".into()))?;
    if total_bytes > MAX_PSD_DECODED_IMAGE_BYTES {
        return Err(FormatError::Unsupported(
            "Photoshop merged channel data exceeds decoder limit".into(),
        ));
    }
    let color_channels = psd_color_channel_count(header.color_mode);
    let extra_count = nch.saturating_sub(color_channels);
    let metadata_count = resources.metadata_count();
    // Multichannel has no layers and so no transparency: every plate is ink.
    let multichannel = header.color_mode == 7;
    let metadata_implies_transparency =
        !multichannel && metadata_count > 0 && metadata_count.saturating_add(1) == extra_count;
    let render_transparency = !multichannel
        && extra_count > 0
        && (merged_transparency || metadata_implies_transparency || metadata_count != extra_count);
    // A signed layer count is authoritative. Without it, consume a leading
    // transparency plane only when resource cardinality proves one exists.
    // Ambiguous unnamed extras remain document channels even when the first is
    // also used as the compatibility render alpha, so no source plane is lost.
    let channel_start = if merged_transparency || metadata_implies_transparency {
        color_channels.saturating_add(1)
    } else {
        color_channels
    };

    let mut projection = DecodeProjection::default();
    let plane_samples = sample_count
        .checked_mul(nch)
        .ok_or_else(|| FormatError::Malformed("merged sample projection overflow".into()))?;
    projection.add(plane_samples, sb, 2)?; // raw inflate + typed planes
    let rgba_samples = sample_count
        .checked_mul(4)
        .ok_or_else(|| FormatError::Malformed("merged RGBA projection overflow".into()))?;
    projection.add(rgba_samples, sb, 1)?;
    if header.depth > 8 {
        projection.add(rgba_samples, 1, 1)?;
    }
    let document_samples = sample_count
        .checked_mul(nch.saturating_sub(channel_start))
        .ok_or_else(|| FormatError::Malformed("document channel projection overflow".into()))?;
    projection.add(document_samples, 1, 1)?; // per-channel compatibility previews
    budget.reserve_decoded(projection.samples, projection.bytes)?;

    let to_plane = |raw: &[u8]| -> Result<ChannelPlane> {
        if one_bit {
            Ok(ChannelPlane::U8(unpack_1bit(raw, w, h)))
        } else {
            decode_native_plane(raw, header.depth, sample_count)
        }
    };
    let mut planes: Vec<ChannelPlane> = Vec::with_capacity(nch);
    match comp {
        0 => {
            for _ in 0..nch {
                let raw = r.read_vec(chan_bytes)?;
                planes.push(to_plane(&raw)?);
            }
        }
        1 => {
            // One count table for ALL rows of ALL channels.
            let row_count = nch
                .checked_mul(h)
                .ok_or_else(|| FormatError::Malformed("RLE row count overflow".into()))?;
            let mut counts = Vec::with_capacity(row_count);
            for _ in 0..row_count {
                counts.push(if header.psb {
                    r.u32()? as usize
                } else {
                    r.u16()? as usize
                });
            }
            let mut idx = 0;
            for _ in 0..nch {
                let mut bytes = Vec::new();
                for _ in 0..h {
                    bytes.extend_from_slice(r.read_bytes(counts[idx])?);
                    idx += 1;
                }
                let raw = packbits_decode(&bytes, chan_bytes)?;
                planes.push(to_plane(&raw)?);
            }
        }
        2 | 3 => {
            // Flattened ZIP image data is one zlib stream containing every
            // channel plane back-to-back, unlike layer channels which each own
            // their compressed payload. Bound inflate to the exact validated
            // planar byte count before splitting it into channels.
            let raw = if comp == 2 {
                zlib_inflate_exact(r.rest(), total_bytes)?
            } else {
                let row_width = if one_bit { w.div_ceil(8) } else { w };
                let rows = h.checked_mul(nch).ok_or_else(|| {
                    FormatError::Malformed("merged ZIP row count overflow".into())
                })?;
                zip_predicted(r.rest(), row_width, rows, sb)?
            };
            if raw.len() != total_bytes {
                return Err(FormatError::Decompress(
                    "merged ZIP decoded byte count mismatch".into(),
                ));
            }
            r.seek(r.len())?;
            for channel in raw.chunks_exact(chan_bytes) {
                planes.push(to_plane(channel)?);
            }
        }
        c => return Err(FormatError::Unsupported(format!("merged compression {c}"))),
    }
    let tagged: Vec<(i16, ChannelPlane)> = planes
        .into_iter()
        .enumerate()
        .map(|(index, plane)| {
            let id = if index < color_channels {
                index as i16
            } else if render_transparency && index == color_channels {
                -1
            } else {
                index as i16
            };
            (id, plane)
        })
        .collect();

    let mut layer = Layer::new(
        1,
        "Background",
        LayerKind::Raster,
        Bounds {
            x: 0,
            y: 0,
            w: header.width,
            h: header.height,
        },
    );
    match header.depth {
        16 => layer.rgba16 = assemble_rgba16(&tagged, sample_count, header.color_mode)?,
        32 => layer.rgba32 = assemble_rgba32(&tagged, sample_count, header.color_mode)?,
        _ => layer.rgba = assemble_rgba8(&tagged, sample_count, header.color_mode),
    }
    if header.color_mode == 2 {
        // Indexed: plane 0 holds palette indices; the Color Mode Data palette is
        // [n R bytes][n G bytes][n B bytes]. Map each index to its RGB; fall back
        // to grayscale if the palette is missing or the index is out of range.
        let pal = palette.unwrap_or(&[]);
        let n = pal.len() / 3;
        let plane0 = tagged.iter().find_map(|(id, plane)| match (id, plane) {
            (0, ChannelPlane::U8(values)) => Some(values.as_slice()),
            _ => None,
        });
        for i in 0..sample_count {
            let g = plane0
                .and_then(|values| values.get(i))
                .copied()
                .unwrap_or(0);
            let ix = g as usize;
            if n > 0 && ix < n {
                layer.rgba[i * 4] = pal[ix];
                layer.rgba[i * 4 + 1] = pal[n + ix];
                layer.rgba[i * 4 + 2] = pal[2 * n + ix];
            } else {
                layer.rgba[i * 4] = g;
                layer.rgba[i * 4 + 1] = g;
                layer.rgba[i * 4 + 2] = g;
            }
        }
    }
    if layer.rgba.is_empty() {
        layer.rgba = if !layer.rgba16.is_empty() {
            layer
                .rgba16
                .iter()
                .map(|value| (value >> 8) as u8)
                .collect()
        } else {
            layer
                .rgba32
                .iter()
                .map(|value| (value.clamp(0.0, 1.0) * 255.0 + 0.5) as u8)
                .collect()
        };
    }
    let channels = tagged
        .into_iter()
        .skip(channel_start)
        .map(|(_, plane)| plane)
        .enumerate()
        .map(|(index, plane)| document_channel(plane, resources, index))
        .collect();
    Ok((layer, channels))
}

fn psd_color_channel_count(color_mode: u16) -> usize {
    match color_mode {
        // Multichannel reads its first four plates as C, M, Y, K, like
        // Vision's own Multichannel mode.
        4 | 7 => 4,
        0 | 1 | 2 | 8 => 1,
        _ => 3,
    }
}

fn document_channel(
    plane: ChannelPlane,
    resources: &ChannelResources,
    index: usize,
) -> DocumentChannel {
    let data = plane.preview_u8();
    let (data16, data32) = match plane {
        ChannelPlane::U8(_) => (Vec::new(), Vec::new()),
        ChannelPlane::U16(values) => (values, Vec::new()),
        ChannelPlane::F32(values) => (Vec::new(), values),
    };
    DocumentChannel {
        name: resources.name(index),
        identifier: resources.identifiers.get(index).copied(),
        display: resources.display.get(index).copied(),
        data,
        data16,
        data32,
    }
}

#[cfg(test)]
mod mask_tests {
    use super::*;

    fn mask_block(flags: u8, tail: &[u8]) -> Vec<u8> {
        let mut data = Vec::new();
        data.extend_from_slice(&2i32.to_be_bytes());
        data.extend_from_slice(&(-3i32).to_be_bytes());
        data.extend_from_slice(&7i32.to_be_bytes());
        data.extend_from_slice(&4i32.to_be_bytes());
        data.push(19);
        data.push(flags);
        data.extend_from_slice(tail);
        let mut block = (data.len() as u32).to_be_bytes().to_vec();
        block.extend_from_slice(&data);
        block
    }

    #[test]
    fn reads_basic_twenty_byte_mask() {
        let bytes = mask_block(0x07, &[0, 0]);
        let mut reader = Reader::new(&bytes);
        let mask = read_mask(&mut reader).unwrap().unwrap();
        assert_eq!((mask.x, mask.y, mask.w, mask.h), (-3, 2, 7, 5));
        assert_eq!(mask.default, 19);
        assert!(mask.relative && mask.disabled && mask.invert);
        assert_eq!((mask.density, mask.feather), (None, None));
        assert_eq!(reader.position(), bytes.len());
    }

    #[test]
    fn reads_params_only_before_padding() {
        let mut tail = vec![0x03, 143];
        tail.extend_from_slice(&2.25f64.to_be_bytes());
        tail.extend_from_slice(&[0, 0]);
        let bytes = mask_block(0x10, &tail);
        let mut reader = Reader::new(&bytes);
        let mask = read_mask(&mut reader).unwrap().unwrap();
        assert_eq!(mask.density, Some(143));
        assert_eq!(mask.feather, Some(2.25));
        assert_eq!(reader.position(), bytes.len());
    }

    #[test]
    fn reads_params_before_real_mask_tail() {
        let mut tail = vec![0x0f, 201];
        tail.extend_from_slice(&1.5f64.to_be_bytes());
        tail.push(173); // vector-mask density
        tail.extend_from_slice(&3.25f64.to_be_bytes());
        tail.push(0x07); // real-mask flags
        tail.push(255); // real-mask background
        for value in [1i32, 2, 8, 9] {
            tail.extend_from_slice(&value.to_be_bytes());
        }
        tail.extend_from_slice(&[0, 0]);
        let bytes = mask_block(0x10, &tail);
        let mut reader = Reader::new(&bytes);
        let mask = read_mask(&mut reader).unwrap().unwrap();
        assert_eq!(mask.density, Some(201));
        assert_eq!(mask.feather, Some(1.5));
        assert_eq!(mask.vector_density, Some(173));
        assert_eq!(mask.vector_feather, Some(3.25));
        let real = mask.real.as_deref().expect("real user mask");
        assert_eq!((real.x, real.y, real.w, real.h), (2, 1, 7, 7));
        assert_eq!(real.default, 255);
        assert!(real.relative && real.disabled && real.invert);
        assert_eq!(reader.position(), bytes.len());
    }

    #[test]
    fn native_mask_planes_keep_exact_samples_and_preview() {
        let raw = RawMask {
            x: -2,
            y: 3,
            w: 2,
            h: 1,
            default: 0,
            disabled: false,
            relative: true,
            invert: false,
            density: None,
            feather: None,
            vector_density: None,
            vector_feather: None,
            real: None,
        };

        let values16 = vec![1u16, 65_534];
        let mut preview = Vec::new();
        let mut native16 = Vec::new();
        let mut native32 = Vec::new();
        store_mask_plane(
            ChannelPlane::U16(values16.clone()),
            &mut preview,
            &mut native16,
            &mut native32,
        );
        let mask = build_mask(&raw, preview, native16, native32, None).unwrap();
        assert_eq!(mask.data, vec![0, 255]);
        assert_eq!(mask.data16, values16);

        let values32 = vec![-0.25f32, 1.25];
        let mut preview = Vec::new();
        let mut native16 = Vec::new();
        let mut native32 = Vec::new();
        store_mask_plane(
            ChannelPlane::F32(values32.clone()),
            &mut preview,
            &mut native16,
            &mut native32,
        );
        let mask = build_mask(&raw, preview, native16, native32, None).unwrap();
        assert_eq!(mask.data, vec![0, 255]);
        assert_eq!(
            mask.data32.iter().map(|value| value.to_bits()).collect::<Vec<_>>(),
            values32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>()
        );
    }
}

#[cfg(test)]
mod document_channel_tests {
    use super::*;

    fn header(depth: u16, channels: u16) -> Header {
        Header {
            psb: false,
            channels,
            width: 2,
            height: 1,
            depth,
            color_mode: 3,
        }
    }

    fn resource(out: &mut Vec<u8>, id: u16, data: &[u8]) {
        out.extend_from_slice(b"8BIM");
        out.extend_from_slice(&id.to_be_bytes());
        out.extend_from_slice(&[0, 0]); // empty Pascal name + even padding
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(data);
        if data.len() % 2 != 0 {
            out.push(0);
        }
    }

    fn unicode_names(names: &[&str]) -> Vec<u8> {
        let mut out = Vec::new();
        for name in names {
            let units: Vec<u16> = name.encode_utf16().collect();
            out.extend_from_slice(&(units.len() as u32).to_be_bytes());
            for unit in units {
                out.extend_from_slice(&unit.to_be_bytes());
            }
        }
        out
    }

    fn channel_resources() -> ChannelResources {
        ChannelResources {
            pascal_names: vec!["legacy spot".into(), "legacy alpha".into()],
            unicode_names: vec!["Spot 海".into(), "Alpha Ω".into()],
            identifiers: vec![31, 47],
            display: vec![
                ChannelDisplayInfo {
                    color_space: 2,
                    color: [1, 2, 3, 4],
                    opacity: 73,
                    mode: 2,
                },
                ChannelDisplayInfo {
                    color_space: 0,
                    color: [5, 6, 7, 8],
                    opacity: 41,
                    mode: 1,
                },
            ],
            ..ChannelResources::default()
        }
    }

    #[test]
    fn reads_ordered_unicode_names_identifiers_and_display_info() {
        let mut bytes = Vec::new();
        resource(&mut bytes, 1006, &[4, b'o', b'l', b'd', b'1', 0]);
        resource(&mut bytes, 1045, &unicode_names(&["Spot 海", "Alpha Ω"]));
        let identifiers: Vec<u8> = [31u32, 47]
            .into_iter()
            .flat_map(u32::to_be_bytes)
            .collect();
        resource(&mut bytes, 1053, &identifiers);
        let mut display = 1u32.to_be_bytes().to_vec();
        for item in channel_resources().display {
            display.extend_from_slice(&item.color_space.to_be_bytes());
            for component in item.color {
                display.extend_from_slice(&component.to_be_bytes());
            }
            display.extend_from_slice(&item.opacity.to_be_bytes());
            display.push(item.mode);
        }
        resource(&mut bytes, 1077, &display);

        let mut reader = Reader::new(&bytes);
        let resources = read_channel_resources(&mut reader, bytes.len(), 2, 1).unwrap();
        assert_eq!(resources.name(0).as_deref(), Some("Spot 海"));
        assert_eq!(resources.name(1).as_deref(), Some("Alpha Ω"));
        assert_eq!(resources.identifiers, vec![31, 47]);
        assert_eq!(resources.display, channel_resources().display);
        assert_eq!(reader.position(), bytes.len());
    }

    #[test]
    fn resource_backed_extras_are_channels_not_merged_transparency() {
        // RGB + spot + saved alpha. With two matching resource records and no
        // negative layer-count signal, neither extra is composite alpha.
        let planes = [[10u8, 20], [30, 40], [50, 60], [70, 80], [90, 100]];
        let mut bytes = 0u16.to_be_bytes().to_vec();
        bytes.extend(planes.into_iter().flatten());
        let mut reader = Reader::new(&bytes);
        let mut budget = PsdDecodeBudget::default();
        let (background, channels) = read_merged_image(
            &mut reader,
            &header(8, 5),
            None,
            &channel_resources(),
            false,
            &mut budget,
        )
        .unwrap();

        assert_eq!(background.rgba[3], 255);
        assert_eq!(channels.len(), 2);
        assert_eq!(channels[0].name.as_deref(), Some("Spot 海"));
        assert_eq!(channels[0].identifier, Some(31));
        assert_eq!(channels[0].display.unwrap().mode, 2);
        assert_eq!(channels[0].data, vec![70, 80]);
        assert_eq!(channels[1].data, vec![90, 100]);
    }

    #[test]
    fn signed_merged_transparency_precedes_native_document_channels() {
        let resources = channel_resources();

        let planes16 = [
            [1u16, 2],
            [3, 4],
            [5, 6],
            [7, 8], // merged transparency
            [9, 10],
            [11, 12],
        ];
        let mut bytes16 = 0u16.to_be_bytes().to_vec();
        bytes16.extend(
            planes16
                .iter()
                .flatten()
                .flat_map(|value| value.to_be_bytes()),
        );
        let mut budget16 = PsdDecodeBudget::default();
        let (background16, channels16) = read_merged_image(
            &mut Reader::new(&bytes16),
            &header(16, 6),
            None,
            &resources,
            true,
            &mut budget16,
        )
        .unwrap();
        assert_eq!(background16.rgba16[3], 7);
        assert_eq!(channels16[0].data16, vec![9, 10]);
        assert_eq!(channels16[1].data16, vec![11, 12]);

        let planes32 = [
            [0.1f32, 0.2],
            [0.3, 0.4],
            [0.5, 0.6],
            [0.7, 0.8], // merged transparency
            [-0.25, 1.25],
            [2.5, -3.5],
        ];
        let mut bytes32 = 0u16.to_be_bytes().to_vec();
        bytes32.extend(
            planes32
                .iter()
                .flatten()
                .flat_map(|value| value.to_be_bytes()),
        );
        let mut budget32 = PsdDecodeBudget::default();
        let (background32, channels32) = read_merged_image(
            &mut Reader::new(&bytes32),
            &header(32, 6),
            None,
            &resources,
            true,
            &mut budget32,
        )
        .unwrap();
        assert_eq!(background32.rgba32[3].to_bits(), 0.7f32.to_bits());
        assert_eq!(
            channels32[0]
                .data32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>(),
            [-0.25f32, 1.25]
                .into_iter()
                .map(f32::to_bits)
                .collect::<Vec<_>>()
        );
        assert_eq!(
            channels32[1]
                .data32
                .iter()
                .map(|value| value.to_bits())
                .collect::<Vec<_>>(),
            [2.5f32, -3.5]
                .into_iter()
                .map(f32::to_bits)
                .collect::<Vec<_>>()
        );
    }
}

#[cfg(test)]
mod bounds_and_float_tests {
    use super::*;

    fn header(channels: u16, width: u32, height: u32, depth: u16) -> Vec<u8> {
        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&channels.to_be_bytes());
        bytes.extend_from_slice(&height.to_be_bytes());
        bytes.extend_from_slice(&width.to_be_bytes());
        bytes.extend_from_slice(&depth.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes
    }

    fn push_length(out: &mut Vec<u8>, version: u16, value: usize) {
        if version == 2 {
            out.extend_from_slice(&(value as u64).to_be_bytes());
        } else {
            out.extend_from_slice(&(value as u32).to_be_bytes());
        }
    }

    fn layered_bomb(
        version: u16,
        width: u32,
        height: u32,
        depth: u16,
        channel_ids: &[i16],
        large_user_and_real_masks: bool,
    ) -> Vec<u8> {
        layered_bomb_n(version, width, height, depth, channel_ids, large_user_and_real_masks, 1)
    }

    #[allow(clippy::too_many_arguments)]
    fn layered_bomb_n(
        version: u16,
        width: u32,
        height: u32,
        depth: u16,
        channel_ids: &[i16],
        large_user_and_real_masks: bool,
        layers: usize,
    ) -> Vec<u8> {
        let mut extra = Vec::new();
        if large_user_and_real_masks {
            let mut mask = Vec::new();
            mask.extend_from_slice(&0i32.to_be_bytes());
            mask.extend_from_slice(&0i32.to_be_bytes());
            mask.extend_from_slice(&8_000i32.to_be_bytes());
            mask.extend_from_slice(&10_000i32.to_be_bytes());
            mask.extend_from_slice(&[0, 0]);
            mask.extend_from_slice(&[0, 0]); // real flags/default
            mask.extend_from_slice(&0i32.to_be_bytes());
            mask.extend_from_slice(&0i32.to_be_bytes());
            mask.extend_from_slice(&8_000i32.to_be_bytes());
            mask.extend_from_slice(&10_000i32.to_be_bytes());
            extra.extend_from_slice(&(mask.len() as u32).to_be_bytes());
            extra.extend_from_slice(&mask);
        } else {
            extra.extend_from_slice(&0u32.to_be_bytes());
        }
        extra.extend_from_slice(&0u32.to_be_bytes()); // blending ranges
        extra.extend_from_slice(&[0, 0, 0, 0]); // empty Pascal name, padded to four

        let mut record = Vec::new();
        record.extend_from_slice(&0i32.to_be_bytes());
        record.extend_from_slice(&0i32.to_be_bytes());
        record.extend_from_slice(&(height as i32).to_be_bytes());
        record.extend_from_slice(&(width as i32).to_be_bytes());
        record.extend_from_slice(&(channel_ids.len() as u16).to_be_bytes());
        for id in channel_ids {
            record.extend_from_slice(&id.to_be_bytes());
            push_length(&mut record, version, 2); // compression word only; never reached
        }
        record.extend_from_slice(b"8BIMnorm");
        record.extend_from_slice(&[255, 0, 0, 0]);
        record.extend_from_slice(&(extra.len() as u32).to_be_bytes());
        record.extend_from_slice(&extra);

        let mut layer_info = (layers as i16).to_be_bytes().to_vec();
        for _ in 0..layers {
            layer_info.extend_from_slice(&record);
        }
        let mut section = Vec::new();
        push_length(&mut section, version, layer_info.len());
        section.extend_from_slice(&layer_info);

        let mut bytes = header(4, width, height, depth);
        bytes[4..6].copy_from_slice(&version.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes()); // color mode data
        bytes.extend_from_slice(&0u32.to_be_bytes()); // image resources
        push_length(&mut bytes, version, section.len());
        bytes.extend_from_slice(&section);
        bytes
    }

    fn flattened_document_channel_bomb(version: u16) -> Vec<u8> {
        let mut bytes = header(56, 4_096, 4_096, 8);
        bytes[4..6].copy_from_slice(&version.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        push_length(&mut bytes, version, 0);
        bytes.extend_from_slice(&0u16.to_be_bytes()); // raw merged compression
        bytes
    }

    fn assert_decode_budget_rejected(bytes: &[u8]) {
        let result = std::panic::catch_unwind(|| parse(bytes));
        assert!(matches!(
            result.expect("hostile Photoshop input must not panic"),
            Err(FormatError::Unsupported(message)) if message.contains("decoded channel data")
        ));
    }

    #[test]
    fn rejects_canvas_allocations_before_decoding_payloads() {
        for bytes in [
            header(4, MAX_PSD_DIMENSION + 1, 1, 32),
            header(4, 10_000, 10_000, 32),
            header((MAX_PSD_CHANNELS + 1) as u16, 1, 1, 32),
        ] {
            let mut reader = Reader::new(&bytes);
            assert!(read_header(&mut reader).is_err());
        }
    }

    /// The inverse of `assert_decode_budget_rejected`: the budget must not be
    /// what stops this document. These fixtures carry no channel payload, so a
    /// later truncation error is the expected outcome — only the budget verdict
    /// is under test.
    fn assert_decode_budget_allows(bytes: &[u8]) {
        let result = std::panic::catch_unwind(|| parse(bytes));
        if let Err(FormatError::Unsupported(message)) =
            result.expect("hostile Photoshop input must not panic")
        {
            assert!(
                !message.contains("decoded channel data"),
                "the decoder budget refused a document of this size: {message}"
            );
        }
    }

    // A 24 MP 16-bit document with two layers is ordinary camera work, and one
    // Vision writes itself — but the budget charged every layer's TRANSIENT
    // decode buffers as though they were all live at once, so Vision's own file
    // came back "exceeds decoder budget" on open. read_channels drops those
    // buffers per layer, so only the largest layer's are ever held together.
    #[test]
    fn a_two_layer_sixteen_bit_camera_document_is_within_the_decoder_budget() {
        for version in [1, 2] {
            assert_decode_budget_allows(&layered_bomb_n(
                version,
                6_000,
                4_000,
                16,
                &[0, 1, 2, -1],
                false,
                2,
            ));
        }
    }

    #[test]
    fn compact_layer_and_mask_bombs_fail_before_payload_decode() {
        for version in [1, 2] {
            let layers = layered_bomb(version, 8_192, 8_192, 16, &[0, 1, 2, -1], false);
            assert!(layers.len() < 256);
            assert_decode_budget_rejected(&layers);

            let masks = layered_bomb(version, 1, 1, 32, &[-2, -3], true);
            assert!(masks.len() < 256);
            assert_decode_budget_rejected(&masks);
        }
    }

    #[test]
    fn compact_document_channel_bomb_fails_before_payload_decode() {
        for version in [1, 2] {
            let bytes = flattened_document_channel_bomb(version);
            assert!(bytes.len() < 64);
            assert_decode_budget_rejected(&bytes);
        }
    }

    #[test]
    fn float_plane_preserves_large_finite_samples_and_rejects_nonfinite() {
        let samples = [100_000.25f32, -4.5, 2.0, 0.5];
        let raw: Vec<u8> = samples
            .iter()
            .flat_map(|sample| sample.to_be_bytes())
            .collect();
        let ChannelPlane::F32(decoded) = decode_native_plane(&raw, 32, samples.len()).unwrap()
        else {
            panic!("expected float plane");
        };
        assert_eq!(
            decoded
                .iter()
                .map(|sample| sample.to_bits())
                .collect::<Vec<_>>(),
            samples
                .iter()
                .map(|sample| sample.to_bits())
                .collect::<Vec<_>>()
        );

        let nan = f32::NAN.to_be_bytes();
        assert!(decode_native_plane(&nan, 32, 1).is_err());
    }
}

#[cfg(test)]
mod psb_and_merged_zip_tests {
    use super::*;
    use miniz_oxide::deflate::compress_to_vec_zlib;

    const WIDTH: usize = 3;
    const HEIGHT: usize = 2;
    const CHANNELS: usize = 4;

    fn flattened_header(version: u16, depth: u16, channels: u16) -> Vec<u8> {
        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&version.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&channels.to_be_bytes());
        bytes.extend_from_slice(&(HEIGHT as u32).to_be_bytes());
        bytes.extend_from_slice(&(WIDTH as u32).to_be_bytes());
        bytes.extend_from_slice(&depth.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes()); // RGB
        bytes.extend_from_slice(&0u32.to_be_bytes()); // color mode data
        bytes.extend_from_slice(&0u32.to_be_bytes()); // image resources
        if version == 2 {
            bytes.extend_from_slice(&0u64.to_be_bytes()); // layer & mask info
        } else {
            bytes.extend_from_slice(&0u32.to_be_bytes());
        }
        bytes
    }

    fn predict_rows(raw: &[u8], width: usize, rows: usize, sample_bytes: usize) -> Vec<u8> {
        let stride = width * sample_bytes;
        assert_eq!(raw.len(), stride * rows);
        let mut predicted = Vec::with_capacity(raw.len());
        for row in raw.chunks_exact(stride) {
            match sample_bytes {
                1 => {
                    predicted.push(row[0]);
                    for x in 1..width {
                        predicted.push(row[x].wrapping_sub(row[x - 1]));
                    }
                }
                2 => {
                    let first = u16::from_be_bytes([row[0], row[1]]);
                    predicted.extend_from_slice(&first.to_be_bytes());
                    for x in 1..width {
                        let current = u16::from_be_bytes([row[x * 2], row[x * 2 + 1]]);
                        let previous = u16::from_be_bytes([row[(x - 1) * 2], row[(x - 1) * 2 + 1]]);
                        predicted.extend_from_slice(&current.wrapping_sub(previous).to_be_bytes());
                    }
                }
                4 => {
                    let mut planar = vec![0u8; stride];
                    for x in 0..width {
                        for byte in 0..4 {
                            planar[byte * width + x] = row[x * 4 + byte];
                        }
                    }
                    predicted.push(planar[0]);
                    for x in 1..stride {
                        predicted.push(planar[x].wrapping_sub(planar[x - 1]));
                    }
                }
                _ => unreachable!(),
            }
        }
        predicted
    }

    fn flattened_zip(version: u16, depth: u16, compression: u16, planar_raw: &[u8]) -> Vec<u8> {
        let sample_bytes = usize::from(depth / 8);
        let source = if compression == 3 {
            predict_rows(planar_raw, WIDTH, HEIGHT * CHANNELS, sample_bytes)
        } else {
            planar_raw.to_vec()
        };
        let mut bytes = flattened_header(version, depth, CHANNELS as u16);
        bytes.extend_from_slice(&compression.to_be_bytes());
        bytes.extend_from_slice(&compress_to_vec_zlib(&source, 6));
        bytes
    }

    fn variants(depth: u16, planar_raw: &[u8]) -> Vec<Document> {
        let mut documents = Vec::new();
        for version in [1u16, 2] {
            for compression in [2u16, 3] {
                let bytes = flattened_zip(version, depth, compression, planar_raw);
                let document = parse(&bytes).unwrap_or_else(|error| {
                    panic!("version {version}, depth {depth}, compression {compression}: {error}")
                });
                assert_eq!(
                    document.source,
                    if version == 2 {
                        SourceFormat::Psb
                    } else {
                        SourceFormat::Psd
                    }
                );
                documents.push(document);
            }
        }
        documents
    }

    #[test]
    fn flattened_zip_and_prediction_decode_8bit_psd_and_psb() {
        let planes = [
            [1u8, 2, 3, 4, 5, 6],
            [11u8, 12, 13, 14, 15, 16],
            [21u8, 22, 23, 24, 25, 26],
            [255u8, 192, 128, 64, 32, 0],
        ];
        let planar: Vec<u8> = planes.into_iter().flatten().collect();
        let expected: Vec<u8> = (0..WIDTH * HEIGHT)
            .flat_map(|index| planes.map(|plane| plane[index]))
            .collect();
        for document in variants(8, &planar) {
            assert_eq!(document.layers[0].rgba, expected);
        }
    }

    #[test]
    fn flattened_zip_and_prediction_decode_16bit_psd_and_psb() {
        let planes = [
            [1u16, 258, 32_769, 65_534, 4_369, 43_981],
            [65_535u16, 0, 17, 8_738, 32_896, 65_279],
            [13_107u16, 16_448, 257, 513, 1_027, 2_055],
            [65_535u16, 49_152, 32_768, 16_384, 8_192, 0],
        ];
        let planar: Vec<u8> = planes
            .iter()
            .flatten()
            .flat_map(|sample| sample.to_be_bytes())
            .collect();
        let expected: Vec<u16> = (0..WIDTH * HEIGHT)
            .flat_map(|index| planes.map(|plane| plane[index]))
            .collect();
        for document in variants(16, &planar) {
            assert_eq!(document.layers[0].rgba16, expected);
        }
    }

    #[test]
    fn flattened_zip_and_prediction_decode_32bit_psd_and_psb() {
        let planes = [
            [-0.25f32, 0.0, 0.125, 0.5, 1.0, 4.25],
            [0.75f32, 0.625, 0.5, 0.375, 0.25, 0.125],
            [2.0f32, 1.5, 1.0, 0.5, 0.0, -1.0],
            [1.0f32, 0.75, 0.5, 0.25, 0.125, 0.0],
        ];
        let planar: Vec<u8> = planes
            .iter()
            .flatten()
            .flat_map(|sample| sample.to_be_bytes())
            .collect();
        let expected: Vec<u32> = (0..WIDTH * HEIGHT)
            .flat_map(|index| planes.map(|plane| plane[index].to_bits()))
            .collect();
        for document in variants(32, &planar) {
            assert_eq!(
                document.layers[0]
                    .rgba32
                    .iter()
                    .map(|sample| sample.to_bits())
                    .collect::<Vec<_>>(),
                expected
            );
        }
    }

    fn psb_with_global_block(key: [u8; 4]) -> Vec<u8> {
        let mut block = b"8B64".to_vec();
        block.extend_from_slice(&key);
        block.extend_from_slice(&1u64.to_be_bytes());
        block.push(0xA5);
        block.extend_from_slice(&[0; 3]);

        let mut section = Vec::new();
        section.extend_from_slice(&0u64.to_be_bytes()); // layer info
        section.extend_from_slice(&0u32.to_be_bytes()); // global mask
        section.extend_from_slice(&block);

        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&2u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&8u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes());
        bytes.extend_from_slice(&(section.len() as u64).to_be_bytes());
        bytes.extend_from_slice(&section);
        bytes.extend_from_slice(&0u16.to_be_bytes()); // raw composite
        bytes.extend_from_slice(&[1, 2, 3]);
        bytes
    }

    #[test]
    fn modern_wide_keys_keep_psb_global_blocks_aligned() {
        for key in [
            *b"lnk3", *b"lnkE", *b"FELS", *b"pths", *b"extd", *b"extn", *b"cinf", *b"artd",
        ] {
            let document = parse(&psb_with_global_block(key))
                .unwrap_or_else(|error| panic!("key {:?}: {error}", String::from_utf8_lossy(&key)));
            assert_eq!(document.layers[0].rgba, [1, 2, 3, 255]);
            if matches!(&key, b"lnk3" | b"lnkE") {
                assert_eq!(document.psd_linked_blocks[0].key, key);
                assert_eq!(document.psd_linked_blocks[0].data, [0xA5]);
            }
        }
    }

    #[test]
    fn psb_wide_key_table_is_authoritative_and_metadata_budget_precedes_copy() {
        for key in [
            *b"LMsk", *b"Lr16", *b"Lr32", *b"Layr", *b"Mt16", *b"Mt32", *b"Mtrn", *b"Alph",
            *b"FMsk", *b"lnk2", *b"lnk3", *b"lnkE", *b"FEid", *b"FXid", *b"FELS", *b"PxSD",
            *b"pths", *b"extd", *b"extn", *b"cinf", *b"artd",
        ] {
            assert!(
                psb_uses_8_byte_length(key),
                "{:?}",
                String::from_utf8_lossy(&key)
            );
        }
        for key in [*b"lnkD", *b"TySh", *b"luni", *b"artb"] {
            assert!(
                !psb_uses_8_byte_length(key),
                "{:?}",
                String::from_utf8_lossy(&key)
            );
        }

        let mut budget = PsdDecodeBudget::default();
        assert!(budget
            .reserve_metadata(MAX_PSD_PRESERVED_BYTES + 1, false)
            .is_err());
        for _ in 0..MAX_PSD_PRESERVED_BLOCKS {
            budget.reserve_metadata(0, true).unwrap();
        }
        assert!(budget.reserve_metadata(0, true).is_err());
    }

    #[test]
    fn every_owned_semantic_key_is_retained_under_the_preservation_budget() {
        for &&key in PSD_ADJUSTMENT_KEYS {
            assert!(
                is_fidelity_block(key),
                "{:?}",
                String::from_utf8_lossy(&key)
            );
        }
        for key in [*b"TySh", *b"lfx2", *b"lrFX"] {
            assert!(is_fidelity_block(key));
        }
    }
}

#[cfg(test)]
mod layer_lock_tests {
    use super::*;

    /// A 1×1 RGB PSD with one raster layer whose record carries `flags` and,
    /// when `lspf` is Some, an `lspf` protected-setting block — hand-written so
    /// the reader is pinned against bytes no Vision writer produced (#418).
    fn psd_with_locked_layer(flags: u8, lspf: Option<u32>) -> Vec<u8> {
        psd_with_blocks(flags, lspf, &[])
    }

    /// The same, plus an arbitrary extra tagged block (key, payload).
    fn psd_with_blocks(flags: u8, lspf: Option<u32>, extra_blocks: &[([u8; 4], Vec<u8>)]) -> Vec<u8> {
        let mut record = Vec::new();
        for v in [0i32, 0, 1, 1] {
            record.extend_from_slice(&v.to_be_bytes()); // top, left, bottom, right
        }
        record.extend_from_slice(&4u16.to_be_bytes()); // R, G, B, A
        for id in [0i16, 1, 2, -1] {
            record.extend_from_slice(&id.to_be_bytes());
            record.extend_from_slice(&3u32.to_be_bytes()); // compression word + 1 sample
        }
        record.extend_from_slice(b"8BIMnorm");
        record.extend_from_slice(&[255, 0, flags, 0]); // opacity, clipping, flags, filler
        let mut extra = Vec::new();
        extra.extend_from_slice(&0u32.to_be_bytes()); // no mask
        extra.extend_from_slice(&0u32.to_be_bytes()); // no blending ranges
        extra.extend_from_slice(&[1, b'L', 0, 0]); // pascal name, padded to 4
        if let Some(bits) = lspf {
            extra.extend_from_slice(b"8BIMlspf");
            extra.extend_from_slice(&4u32.to_be_bytes());
            extra.extend_from_slice(&bits.to_be_bytes());
        }
        for (key, data) in extra_blocks {
            extra.extend_from_slice(b"8BIM");
            extra.extend_from_slice(key);
            extra.extend_from_slice(&(data.len() as u32).to_be_bytes());
            extra.extend_from_slice(data);
            while extra.len() % 4 != 0 {
                extra.push(0);
            }
        }
        record.extend_from_slice(&(extra.len() as u32).to_be_bytes());
        record.extend_from_slice(&extra);

        let mut info = 1i16.to_be_bytes().to_vec(); // one layer
        info.extend_from_slice(&record);
        for sample in [10u8, 20, 30, 255] {
            info.extend_from_slice(&0u16.to_be_bytes()); // raw
            info.push(sample);
        }
        let mut section = (info.len() as u32).to_be_bytes().to_vec();
        section.extend_from_slice(&info);

        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes()); // channels
        bytes.extend_from_slice(&1u32.to_be_bytes()); // height
        bytes.extend_from_slice(&1u32.to_be_bytes()); // width
        bytes.extend_from_slice(&8u16.to_be_bytes()); // depth
        bytes.extend_from_slice(&3u16.to_be_bytes()); // RGB
        bytes.extend_from_slice(&0u32.to_be_bytes()); // colour mode data
        bytes.extend_from_slice(&0u32.to_be_bytes()); // image resources
        bytes.extend_from_slice(&(section.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&section);
        bytes.extend_from_slice(&0u16.to_be_bytes()); // merged image, raw
        bytes.extend_from_slice(&[10, 20, 30]);
        bytes
    }

    fn locks(bytes: &[u8]) -> (bool, bool, bool, bool) {
        let doc = parse(bytes).expect("lock fixture parses");
        let l = doc.layers.iter().find(|l| l.name == "L").expect("the layer");
        (l.locked, l.lock_transparent, l.lock_image, l.lock_position)
    }

    /// The R/G/B channels a fixture's layer may blend into.
    fn channels(bytes: &[u8]) -> u8 {
        let doc = parse(bytes).expect("brst fixture parses");
        doc.layers.iter().find(|l| l.name == "L").expect("the layer").blend_channels
    }

    #[test]
    fn brst_lists_the_channels_a_layer_may_not_blend_into() {
        // #421: Photoshop names the RESTRICTED channels, so an absent block is
        // "blend everything" — not "blend nothing".
        assert_eq!(channels(&psd_with_locked_layer(0x08, None)), 0b111);
        let brst = |ids: &[u32]| {
            let data = ids.iter().flat_map(|c| c.to_be_bytes()).collect::<Vec<u8>>();
            psd_with_blocks(0x08, None, &[(*b"brst", data)])
        };
        assert_eq!(channels(&brst(&[1])), 0b101, "green restricted");
        assert_eq!(channels(&brst(&[0, 2])), 0b010, "red and blue restricted");
        assert_eq!(channels(&brst(&[0, 1, 2])), 0, "every channel restricted");
        assert_eq!(channels(&brst(&[])), 0b111, "an empty list restricts nothing");
        // Channels this document does not have (alpha, spot) are not R/G/B bits.
        assert_eq!(channels(&brst(&[7])), 0b111);
    }

    #[test]
    fn lspf_bits_map_to_the_four_locks_independently() {
        // Photoshop sets the record's transparency-protected flag alongside any
        // lock, so a reader that only looked at the flag saw every lock as the
        // same lock. With lspf present, the flag must not add anything.
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x1))), (false, true, false, false));
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x2))), (false, false, true, false));
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x4))), (false, false, false, true));
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x6))), (false, false, true, true));
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x8000_0000))), (true, false, false, false));
        assert_eq!(locks(&psd_with_locked_layer(0x09, Some(0x8000_0007))), (true, true, true, true));
        assert_eq!(locks(&psd_with_locked_layer(0x08, Some(0))), (false, false, false, false));
    }

    #[test]
    fn without_lspf_the_record_flag_means_transparency_protected_only() {
        // Bit 0 of the record flags is "transparency protected"; it used to
        // become Lock All, which also refused moves the file never forbade.
        assert_eq!(locks(&psd_with_locked_layer(0x09, None)), (false, true, false, false));
        assert_eq!(locks(&psd_with_locked_layer(0x08, None)), (false, false, false, false));
    }
}

#[cfg(test)]
mod hostile_header_and_resource_tests {
    use super::*;

    /// A 1×1 single-channel PSD with the given depth/colour mode and no layer
    /// section — the shortest file that reaches read_merged_image.
    fn minimal_psd(depth: u16, color_mode: u16, payload: &[u8]) -> Vec<u8> {
        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&1u16.to_be_bytes()); // PSD, not PSB
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&1u16.to_be_bytes()); // channels
        bytes.extend_from_slice(&1u32.to_be_bytes()); // height
        bytes.extend_from_slice(&1u32.to_be_bytes()); // width
        bytes.extend_from_slice(&depth.to_be_bytes());
        bytes.extend_from_slice(&color_mode.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes()); // colour mode data
        bytes.extend_from_slice(&0u32.to_be_bytes()); // image resources
        bytes.extend_from_slice(&0u32.to_be_bytes()); // layer & mask info
        bytes.extend_from_slice(&0u16.to_be_bytes()); // raw compression
        bytes.extend_from_slice(payload);
        bytes
    }

    /// One image-resource block. Every payload here is even-length, so the
    /// section needs no pad byte.
    fn resource(signature: &[u8; 4], id: u16, data: &[u8]) -> Vec<u8> {
        let mut block = signature.to_vec();
        block.extend_from_slice(&id.to_be_bytes());
        block.extend_from_slice(&[0, 0]); // empty pascal name, padded to 2
        block.extend_from_slice(&(data.len() as u32).to_be_bytes());
        block.extend_from_slice(data);
        block
    }

    #[test]
    fn indexed_colour_mode_above_8_bit_is_rejected_not_panicked_on() {
        // read_merged_image fills rgba16/rgba32 by depth, so the unconditional
        // Indexed palette remap indexed an empty 8-bit buffer (#25).
        assert_eq!(
            parse(&minimal_psd(16, 2, &[0x12, 0x34])).err(),
            Some(FormatError::Unsupported(
                "PSD color mode 2 at depth 16".into()
            ))
        );
        assert_eq!(
            parse(&minimal_psd(32, 2, &[0x3F, 0x80, 0x00, 0x00])).err(),
            Some(FormatError::Unsupported(
                "PSD color mode 2 at depth 32".into()
            ))
        );
        // Bitmap is 1-bit only for the same reason.
        assert_eq!(
            parse(&minimal_psd(16, 0, &[0x12, 0x34])).err(),
            Some(FormatError::Unsupported(
                "PSD color mode 0 at depth 16".into()
            ))
        );
        // The legal pairings still parse.
        assert!(parse(&minimal_psd(8, 2, &[0x00])).is_ok());
        assert!(parse(&minimal_psd(1, 0, &[0x00])).is_ok());
    }

    #[test]
    fn foreign_image_resource_signatures_are_skipped_not_fatal() {
        // MeSa/PHUT/AgHg/DCSR are legal resource signatures; refusing them
        // aborted the whole import over a block we never read (#215).
        let mut section = Vec::new();
        section.extend_from_slice(&resource(b"MeSa", 1024, &[0xAA, 0xBB]));
        section.extend_from_slice(&resource(b"PHUT", 1006, &[0x03, b'n', b'o', b'!']));
        section.extend_from_slice(&resource(
            b"8BIM",
            1006,
            &[0x05, b'A', b'l', b'p', b'h', b'a'],
        ));
        let len = section.len();
        let mut r = Reader::new(&section);
        let resources =
            read_channel_resources(&mut r, len, 1, 1).expect("foreign signatures skipped");
        // …and only the 8BIM block contributes: the PHUT block also claims id
        // 1006 but must not be consumed.
        assert_eq!(resources.pascal_names, ["Alpha"]);
    }
}

#[cfg(test)]
mod path_resource_tests {
    use super::*;

    // Power-of-two canvas: every coordinate below is an exact 8.24 fraction.
    const W: u32 = 64;
    const H: u32 = 32;
    const TRIANGLE: [f32; 18] = [
        8.0, 4.0, 0.0, 0.0, 0.0, 0.0, //
        32.0, 4.0, -4.0, 0.0, 4.0, 2.0, //
        20.0, 16.0, 0.0, 0.0, 0.0, 0.0,
    ];

    fn named_resource(out: &mut Vec<u8>, id: u16, name: &[u8], data: &[u8]) {
        out.extend_from_slice(b"8BIM");
        out.extend_from_slice(&id.to_be_bytes());
        out.push(name.len() as u8);
        out.extend_from_slice(name);
        if name.len() % 2 == 0 {
            out.push(0); // length byte plus name padded to even
        }
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(data);
        if data.len() % 2 != 0 {
            out.push(0);
        }
    }

    /// A length record (selector 0 closed, 3 open) or a fill-rule record
    /// (selector 6, count 0): selector, u16, then zero bytes to 26.
    fn length(selector: u16, count: u16) -> Vec<u8> {
        let mut out = selector.to_be_bytes().to_vec();
        out.extend_from_slice(&count.to_be_bytes());
        out.extend_from_slice(&[0; 22]);
        out
    }

    /// A knot record: preceding control, anchor and leaving control as (x, y)
    /// document pixels, stored as 8.24 (y, x) canvas fractions.
    fn knot(selector: u16, points: [(f32, f32); 3]) -> Vec<u8> {
        let mut out = selector.to_be_bytes().to_vec();
        for (x, y) in points {
            out.extend_from_slice(&((y / H as f32 * 16_777_216.0) as i32).to_be_bytes());
            out.extend_from_slice(&((x / W as f32 * 16_777_216.0) as i32).to_be_bytes());
        }
        out
    }

    fn triangle_knots() -> Vec<u8> {
        let mut out = knot(2, [(8.0, 4.0); 3]);
        out.extend(knot(1, [(28.0, 4.0), (32.0, 4.0), (36.0, 6.0)]));
        out.extend(knot(2, [(20.0, 16.0); 3]));
        out
    }

    fn triangle() -> Vec<u8> {
        let mut out = length(6, 0);
        out.extend(length(0, 3));
        out.extend(triangle_knots());
        out
    }

    fn clipping(name: &[u8], flatness: Option<i32>) -> Vec<u8> {
        let mut out = vec![name.len() as u8];
        out.extend_from_slice(name);
        if let Some(flatness) = flatness {
            out.extend_from_slice(&flatness.to_be_bytes());
            out.extend_from_slice(&1u16.to_be_bytes());
        }
        out
    }

    /// A flattened W×H RGB PSD carrying `resources`.
    fn flat_psd(resources: &[u8]) -> Vec<u8> {
        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&H.to_be_bytes());
        bytes.extend_from_slice(&W.to_be_bytes());
        bytes.extend_from_slice(&8u16.to_be_bytes());
        bytes.extend_from_slice(&3u16.to_be_bytes());
        bytes.extend_from_slice(&0u32.to_be_bytes()); // colour mode data
        bytes.extend_from_slice(&(resources.len() as u32).to_be_bytes());
        bytes.extend_from_slice(resources);
        bytes.extend_from_slice(&0u32.to_be_bytes()); // no layer section
        bytes.extend_from_slice(&0u16.to_be_bytes()); // raw merged image
        bytes.resize(bytes.len() + 3 * (W * H) as usize, 0);
        bytes
    }

    fn path(name: &str, clip_flatness: Option<f32>) -> DocumentPath {
        DocumentPath {
            name: name.into(),
            anchors: TRIANGLE.to_vec(),
            contours: Vec::new(),
            clip_flatness,
        }
    }

    #[test]
    fn reads_named_paths_and_marks_the_clipping_path() {
        let mut section = Vec::new();
        named_resource(&mut section, 2000, b"Path 1", &triangle());
        // A compound path leaves its open subpaths out.
        let mut outline = length(3, 1);
        outline.extend(knot(5, [(1.0, 1.0); 3]));
        outline.extend(triangle());
        named_resource(&mut section, 2001, b"Outline \xE9", &outline);
        // Several closed subpaths stay the loops of one path.
        let mut glyphs = triangle();
        glyphs.extend(length(0, 3));
        glyphs.extend(triangle_knots());
        named_resource(&mut section, 2002, b"Glyphs", &glyphs);
        named_resource(&mut section, 2999, b"", &clipping(b"Outline \xE9", Some(0x0002_8000)));

        let resources =
            read_channel_resources(&mut Reader::new(&section), section.len(), W, H).unwrap();
        assert_eq!(resources.metadata_count(), 0, "paths never force a merged-image read");
        let glyphs = DocumentPath { anchors: TRIANGLE.repeat(2), contours: vec![3, 3], ..path("Glyphs", None) };
        let expected = vec![path("Path 1", None), path("Outline é", Some(2.5)), glyphs];
        assert_eq!(resources.paths, expected);
        let doc = parse(&flat_psd(&section)).unwrap();
        assert_eq!((doc.paths, doc.skipped_paths), (expected, 0));
    }

    #[test]
    fn clipping_flatness_is_clamped_instead_of_dropping_the_clip() {
        for (flatness, expected) in [(Some(0), 0.2), (Some(500 << 16), 100.0), (None, 0.2)] {
            let mut section = Vec::new();
            named_resource(&mut section, 2000, b"Path 1", &triangle());
            named_resource(&mut section, 2999, b"", &clipping(b"Path 1", flatness));
            let resources =
                read_channel_resources(&mut Reader::new(&section), section.len(), W, H).unwrap();
            assert_eq!(resources.paths, vec![path("Path 1", Some(expected))], "{flatness:?}");
        }
    }

    #[test]
    fn malformed_path_resources_are_skipped_not_fatal() {
        let mut section = Vec::new();
        let mut truncated = length(0, 5); // claims five knots, carries three
        truncated.extend(triangle_knots());
        named_resource(&mut section, 2000, b"truncated", &truncated);
        let mut open_knots = length(0, 3);
        for _ in 0..3 {
            open_knots.extend(knot(4, [(1.0, 1.0); 3]));
        }
        named_resource(&mut section, 2001, b"open knots", &open_knots);
        let mut two = length(0, 2);
        two.extend(knot(2, [(1.0, 1.0); 3]));
        two.extend(knot(2, [(9.0, 9.0); 3]));
        named_resource(&mut section, 2002, b"two knots", &two);
        named_resource(&mut section, 2003, b"", &triangle());
        // An unknown selector and a ragged tail leave the real subpath readable.
        let mut kept = length(9, 0);
        kept.extend(triangle());
        kept.extend([1, 2, 3]);
        named_resource(&mut section, 2004, b"Path 1", &kept);
        named_resource(&mut section, 2999, b"", &clipping(b"missing", Some(1 << 16)));

        let doc = parse(&flat_psd(&section)).expect("malformed paths never fail the import");
        assert_eq!(doc.paths, vec![path("Path 1", None)]);
        // Four unreadable paths plus the clipping choice that names none, so
        // the open can say what a save would leave out.
        assert_eq!(doc.skipped_paths, 5);
    }
}

#[cfg(test)]
mod image_source_data_tests {
    use super::*;

    fn isd(blocks: &[(&[u8; 4], &[u8; 4], u32, &[u8])]) -> Vec<u8> {
        let mut out = b"Adobe Photoshop Document Data Block\0".to_vec();
        for (sig, key, len, data) in blocks {
            out.extend_from_slice(*sig);
            out.extend_from_slice(*key);
            out.extend_from_slice(&if *sig == b"MIB8" { len.to_le_bytes() } else { len.to_be_bytes() });
            out.extend_from_slice(data);
            out.resize(out.len() + (4 - data.len() % 4) % 4, 0);
        }
        out
    }

    #[test]
    fn unreadable_image_source_data_is_an_error_not_a_panic() {
        let mask = [0u8; 14];
        let cases: [(&str, Vec<u8>); 8] = [
            ("bad prefix", b"Adobe Photoshop Data Block\0".to_vec()),
            ("garbage signature", isd(&[(b"8BPS", b"Layr", 2, &[0, 0])])),
            ("length past the tag", isd(&[(b"8BIM", b"Layr", 4096, &[0, 0])])),
            ("little-endian length past the tag", isd(&[(b"MIB8", b"ryaL", 4096, &[0, 0])])),
            ("no layer block", isd(&[(b"8BIM", b"LMsk", 14, &mask)])),
            ("zero layers", isd(&[(b"8BIM", b"Layr", 2, &[0, 0])])),
            ("little-endian zero layers", isd(&[(b"MIB8", b"ryaL", 2, &[0, 0])])),
            (
                "both byte orders",
                isd(&[(b"MIB8", b"ksML", 14, &mask), (b"8BIM", b"Layr", 2, &[0, 0])]),
            ),
        ];
        for (label, bytes) in cases {
            let error = parse_image_source_data(&bytes, 4, 3).expect_err(label);
            match label {
                "bad prefix" => assert!(matches!(error, FormatError::BadMagic), "{label}: {error}"),
                _ => assert!(matches!(error, FormatError::Malformed(_)), "{label}: {error}"),
            }
        }

        // A little-endian layer whose effects cannot be carried opens nothing;
        // the same layer without them opens.
        let layer = |styled: bool| {
            let mut extra = vec![0; 8]; // no mask, no blending ranges
            extra.extend_from_slice(&[0; 4]); // empty name, padded
            if styled {
                extra.extend_from_slice(b"MIB82xfl");
                extra.extend_from_slice(&8u32.to_le_bytes());
                extra.extend_from_slice(&[0; 8]);
            }
            let mut layr = 1i16.to_le_bytes().to_vec();
            for edge in [0u32, 0, 3, 4] {
                layr.extend_from_slice(&edge.to_le_bytes());
            }
            layr.extend_from_slice(&0u16.to_le_bytes()); // no channels
            layr.extend_from_slice(b"MIB8mron\xff\0\0\0");
            layr.extend_from_slice(&(extra.len() as u32).to_le_bytes());
            layr.extend_from_slice(&extra);
            isd(&[(b"MIB8", b"ryaL", layr.len() as u32, &layr)])
        };
        let error = parse_image_source_data(&layer(true), 4, 3).expect_err("styled layer");
        assert!(matches!(error, FormatError::Unsupported(_)), "{error}");
        let plain = parse_image_source_data(&layer(false), 4, 3).expect("the layer without them");
        assert_eq!(plain.layers.len(), 1);

        // One layer claimed, its record cut off by the block's own length:
        // the read stops at the block instead of running into what follows.
        let mut record = 1i16.to_be_bytes().to_vec();
        record.extend_from_slice(&[0; 16]);
        let short = isd(&[(b"8BIM", b"Lr16", 6, &record[..6]), (b"8BIM", b"LMsk", 14, &mask)]);
        assert!(parse_image_source_data(&short, 4, 3).is_err());
        assert!(parse_image_source_data(&isd(&[]), 40_000, 3).is_err(), "canvas limit");
    }
}

#[cfg(test)]
mod color_mode_tests {
    use super::*;

    /// A 1×1 layerless file: `planes` raw, one per channel.
    fn flat(
        depth: u16,
        mode: u16,
        mode_data: &[u8],
        resources: &[u8],
        planes: &[&[u8]],
    ) -> Vec<u8> {
        let mut bytes = b"8BPS".to_vec();
        bytes.extend_from_slice(&1u16.to_be_bytes());
        bytes.extend_from_slice(&[0; 6]);
        bytes.extend_from_slice(&(planes.len() as u16).to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&1u32.to_be_bytes());
        bytes.extend_from_slice(&depth.to_be_bytes());
        bytes.extend_from_slice(&mode.to_be_bytes());
        bytes.extend_from_slice(&(mode_data.len() as u32).to_be_bytes());
        bytes.extend_from_slice(mode_data);
        bytes.extend_from_slice(&(resources.len() as u32).to_be_bytes());
        bytes.extend_from_slice(resources);
        bytes.extend_from_slice(&0u32.to_be_bytes()); // layer & mask info
        bytes.extend_from_slice(&0u16.to_be_bytes()); // raw
        for plane in planes {
            bytes.extend_from_slice(plane);
        }
        bytes
    }

    fn rgb16(doc: &Document) -> [u16; 3] {
        let px = &doc.layers[0].rgba16;
        [px[0], px[1], px[2]]
    }

    #[test]
    fn lab_planes_decode_through_photoshops_per_depth_centres() {
        // a and b sit on 128 at 8 bits and on 0x8000 at 16: both are neutral.
        let doc = parse(&flat(8, 9, &[], &[], &[&[128], &[128], &[128]])).unwrap();
        let px = &doc.layers[0].rgba;
        assert_eq!(
            (px[0], px[1], px[2], px[3]),
            (px[1], px[1], px[1], 255),
            "8-bit centre is gray"
        );
        assert!(
            (118..=121).contains(&px[0]),
            "L 50 is middle gray, got {}",
            px[0]
        );

        let gray = rgb16(
            &parse(&flat(
                16,
                9,
                &[],
                &[],
                &[&[0x80, 0], &[0x80, 0], &[0x80, 0]],
            ))
            .unwrap(),
        );
        assert!(
            gray[0].abs_diff(gray[1]) <= 1 && gray[1].abs_diff(gray[2]) <= 1,
            "16-bit centre is gray: {gray:?}"
        );
        // a = +40 (0x8000 + 40 * 256) leans red, b = -40 leans blue.
        let red = rgb16(
            &parse(&flat(
                16,
                9,
                &[],
                &[],
                &[&[0x80, 0], &[0xA8, 0], &[0x80, 0]],
            ))
            .unwrap(),
        );
        assert!(red[0] > red[1] + 10_000, "positive a is red: {red:?}");
        let blue = rgb16(
            &parse(&flat(
                16,
                9,
                &[],
                &[],
                &[&[0x80, 0], &[0x80, 0], &[0x58, 0]],
            ))
            .unwrap(),
        );
        assert!(blue[2] > blue[0] + 10_000, "negative b is blue: {blue:?}");
    }

    #[test]
    fn lab_is_photoshops_d50_lab() {
        // sRGB blue in D50 Lab (ICC sRGB, Bradford-adapted), as Photoshop reads it.
        let blue = srgb_to_lab([0.0, 0.0, 1.0]);
        for (got, want) in blue.iter().zip([29.57, 68.30, -112.05]) {
            assert!((got - want).abs() < 0.05, "blue {blue:?}");
        }
        let white = srgb_to_lab([1.0; 3]);
        assert!((white[0] - 100.0).abs() < 1e-3 && white[1].abs() < 1e-3 && white[2].abs() < 1e-3);
        let back = lab_to_srgb(srgb_to_lab([0.2, 0.6, 0.9]));
        assert!(
            back.iter()
                .zip([0.2, 0.6, 0.9])
                .all(|(a, b)| (a - b).abs() < 1e-4),
            "{back:?}"
        );

        // psd-tools' 4x4_16bit_lab.psd, a real Photoshop Lab file: its fourth
        // merged pixel, L/a/b codes 0x8AFB/0xD0CB/0xC5E1, is sRGB red.
        let planes: [&[u8]; 3] = [&[0x8A, 0xFB], &[0xD0, 0xCB], &[0xC5, 0xE1]];
        let red = rgb16(&parse(&flat(16, 9, &[], &[], &planes)).unwrap());
        assert!(
            red[0] > 65_300 && red[1] < 400 && red[2] < 400,
            "red {red:?}"
        );
        // The same pixel of 4x4_8bit_lab.psd, 8-bit codes 138/208/197.
        let doc = parse(&flat(8, 9, &[], &[], &[&[138], &[208], &[197]])).unwrap();
        let px = &doc.layers[0].rgba;
        assert!(
            px[0].abs_diff(253) <= 1 && px[1].abs_diff(7) <= 1 && px[2].abs_diff(2) <= 1,
            "8-bit red {px:?}"
        );
    }

    #[test]
    fn duotone_colour_mode_data_is_kept_verbatim() {
        let spec: Vec<u8> = (0..524u32).map(|i| (i * 7) as u8).collect();
        // Alternate Duotone Colors (1066): version 1, one ink, a Lab colour.
        let alternates = [0, 1, 0, 1, 0, 7, 0x11, 0xC5, 0xE6, 0x38, 0xFE, 0x0C, 0, 0];
        let mut resources = b"8BIM".to_vec();
        resources.extend_from_slice(&1066u16.to_be_bytes());
        resources.extend_from_slice(&[0, 0]);
        resources.extend_from_slice(&(alternates.len() as u32).to_be_bytes());
        resources.extend_from_slice(&alternates);
        let doc = parse(&flat(8, 8, &spec, &resources, &[&[90]])).unwrap();
        assert_eq!(doc.color_mode, ColorMode::Duotone);
        assert_eq!(doc.duotone, spec);
        assert_eq!(doc.duotone_alternates, alternates);
        assert_eq!(&doc.layers[0].rgba, &[90, 90, 90, 255], "the gray plate");
        let gray = parse(&flat(8, 1, &[], &resources, &[&[90]])).unwrap();
        assert!(gray.duotone.is_empty() && gray.duotone_alternates.is_empty());
    }

    #[test]
    fn multichannel_plates_print_as_cmyk_and_name_the_channels_after_them() {
        // Photoshop names all five channels; the fifth is the document's own.
        let mut names = Vec::new();
        for name in ["Cyan", "Magenta", "Yellow", "Black", "Varnish"] {
            names.push(name.len() as u8);
            names.extend_from_slice(name.as_bytes());
        }
        if names.len() % 2 != 0 {
            names.push(0);
        }
        let mut resources = b"8BIM".to_vec();
        resources.extend_from_slice(&1006u16.to_be_bytes());
        resources.extend_from_slice(&[0, 0]);
        resources.extend_from_slice(&(names.len() as u32).to_be_bytes());
        resources.extend_from_slice(&names);
        // 0 is solid ink: solid cyan alone on white paper.
        let doc = parse(&flat(
            8,
            7,
            &[],
            &resources,
            &[&[0], &[255], &[255], &[255], &[77]],
        ))
        .unwrap();
        assert_eq!(doc.color_mode, ColorMode::Multichannel);
        assert_eq!(
            &doc.layers[0].rgba,
            &[0, 255, 255, 255],
            "no plate is taken for transparency"
        );
        assert_eq!(doc.channels.len(), 1);
        assert_eq!(doc.channels[0].name.as_deref(), Some("Varnish"));
        assert_eq!(doc.channels[0].data, vec![77]);
    }
}

#[cfg(test)]
mod pattern_budget_and_padding_tests {
    use super::*;

    /// A tagged block padded toward 4 bytes with `pad`, which its length
    /// leaves out. An empty `pad` writes the block unpadded.
    fn block(key: &[u8; 4], data: &[u8], pad: &[u8]) -> Vec<u8> {
        let mut out = b"8BIM".to_vec();
        out.extend_from_slice(key);
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        out.extend_from_slice(data);
        out.extend_from_slice(&pad[..((4 - data.len() % 4) % 4).min(pad.len())]);
        out
    }

    fn luni(name: &str) -> Vec<u8> {
        let mut out = (name.len() as u32).to_be_bytes().to_vec();
        out.extend(name.encode_utf16().flat_map(u16::to_be_bytes));
        out
    }

    /// A 1×1 RGB PSD: one layer per `(name, tagged blocks)`, bottom first,
    /// then the document's `global` blocks.
    fn psd(layers: &[(&str, Vec<u8>)], global: &[u8]) -> Vec<u8> {
        let mut info = (layers.len() as i16).to_be_bytes().to_vec();
        for (name, blocks) in layers {
            for edge in [0i32, 0, 1, 1] {
                info.extend_from_slice(&edge.to_be_bytes());
            }
            info.extend_from_slice(&3u16.to_be_bytes());
            for id in [0i16, 1, 2] {
                info.extend_from_slice(&id.to_be_bytes());
                info.extend_from_slice(&3u32.to_be_bytes());
            }
            info.extend_from_slice(b"8BIMnorm\xff\0\0\0");
            let mut extra = vec![0; 8]; // no mask, no blending ranges
            extra.push(name.len() as u8);
            extra.extend_from_slice(name.as_bytes());
            extra.resize(8 + (1 + name.len()).next_multiple_of(4), 0);
            extra.extend_from_slice(blocks);
            info.extend_from_slice(&(extra.len() as u32).to_be_bytes());
            info.extend_from_slice(&extra);
        }
        for _ in layers {
            info.extend_from_slice(&[0, 0, 0x80, 0, 0, 0x80, 0, 0, 0x80]); // raw samples
        }
        info.resize(info.len().next_multiple_of(2), 0);
        let mut section = (info.len() as u32).to_be_bytes().to_vec();
        section.extend_from_slice(&info);
        section.extend_from_slice(&0u32.to_be_bytes()); // global layer mask
        section.extend_from_slice(global);

        let mut bytes = b"8BPS\0\x01\0\0\0\0\0\0\0\x03".to_vec();
        for value in [1u32, 1] {
            bytes.extend_from_slice(&value.to_be_bytes());
        }
        bytes.extend_from_slice(&[0, 8, 0, 3, 0, 0, 0, 0, 0, 0, 0, 0]); // 8-bit RGB, no mode data or resources
        bytes.extend_from_slice(&(section.len() as u32).to_be_bytes());
        bytes.extend_from_slice(&section);
        bytes.extend_from_slice(&[0, 0, 0x80, 0x80, 0x80]);
        bytes
    }

    /// The most preserved layer blocks a document may hold.
    fn full_layer() -> (&'static str, Vec<u8>) {
        ("a", (0..MAX_PSD_PRESERVED_BLOCKS).flat_map(|_| block(b"lrFX", &[0; 4], &[])).collect())
    }

    #[test]
    fn pattern_records_past_the_preservation_budget_open_without_them() {
        let pattern = block(b"Patt", &[1; 8], &[]);
        let doc = parse(&psd(&[full_layer()], &pattern)).expect("opens without the patterns");
        assert_eq!(doc.layers[0].psd_smart_blocks.len(), MAX_PSD_PRESERVED_BLOCKS);
        assert!(doc.psd_linked_blocks.is_empty());
        assert!(doc.skipped_patterns);

        // Photoshop's empty block in a document with no patterns is not kept,
        // so it costs nothing and leaves nothing to report.
        let doc = parse(&psd(&[full_layer()], &block(b"Patt", &[], &[]))).expect("opens");
        assert!(doc.psd_linked_blocks.is_empty());
        assert!(!doc.skipped_patterns);

        // Patterns yield to the Smart Object sources the file cannot open
        // without, even when they come first.
        let mut crowded = full_layer();
        crowded.1.truncate(crowded.1.len() - 16);
        let global = [pattern.clone(), block(b"lnk2", &[2; 8], &[])].concat();
        let doc = parse(&psd(&[crowded], &global)).expect("opens with its smart object source");
        assert_eq!(doc.psd_linked_blocks.len(), 1);
        assert_eq!(doc.psd_linked_blocks[0].key, *b"lnk2");
        assert!(doc.skipped_patterns);

        // One record block larger than the whole byte budget.
        let huge = block(b"Pat2", &vec![0; MAX_PSD_PRESERVED_BYTES + 4], &[]);
        let doc = parse(&psd(&[("a", Vec::new())], &huge)).expect("opens without the patterns");
        assert!(doc.psd_linked_blocks.is_empty());
        assert!(doc.skipped_patterns);

        // Under the budget, a record is kept as the file stated it.
        let doc = parse(&psd(&[("a", Vec::new())], &pattern)).expect("opens");
        assert_eq!(doc.psd_linked_blocks, [PsdTaggedBlock { key: *b"Patt", data: vec![1; 8] }]);
        assert!(!doc.skipped_patterns);
    }

    #[test]
    fn a_layer_block_follows_at_the_2_byte_end_only_when_a_whole_one_fits_there() {
        let divider = ("</Layer group>", block(b"lsct", &3u32.to_be_bytes(), &[]));
        let header = block(b"lsct", &1u32.to_be_bytes(), &[]);
        let kinds = |bytes: &[u8]| -> Vec<(String, LayerKind)> {
            let doc = parse(bytes).expect("opens");
            doc.layers.iter().map(|layer| (layer.name.clone(), layer.kind)).collect()
        };
        let group = vec![("a".to_string(), LayerKind::Group)];
        let raster = vec![("a".to_string(), LayerKind::Raster)];
        // "a" is 6 bytes of luni, so the 2- and 4-byte ends differ.
        let cases: [(&str, Vec<(&str, Vec<u8>)>, &Vec<(String, LayerKind)>); 6] = [
            ("Photoshop: zero padding to 4", vec![divider.clone(), ("a", [block(b"luni", &luni("a"), &[0; 2]), header.clone()].concat())], &group),
            ("psdtags: aligned to 2", vec![divider.clone(), ("a", [block(b"luni", &luni("a"), &[]), header.clone()].concat())], &group),
            ("padding that is not zero, then a block", vec![divider.clone(), ("a", [block(b"luni", &luni("a"), b"8B"), header.clone()].concat())], &group),
            ("odd length padded with junk", vec![divider.clone(), ("a", [block(b"iOpa", b"\x80\0\0\0\x07", b"\08B"), header.clone()].concat())], &group),
            ("junk padding at the section's end", vec![("a", block(b"luni", &luni("a"), b"8B"))], &raster),
            // Junk that reads as a block header whose payload runs past the
            // section: padding, not a block.
            ("junk past the section", vec![("a", [block(b"luni", &luni("a"), b"8B"), b"IMxxxx\0\0\x03\xe7".to_vec()].concat())], &raster),
        ];
        for (label, layers, want) in cases {
            assert_eq!(&kinds(&psd(&layers, &[])), want, "{label}");
        }

        // "8B" padding followed by bytes that complete a whole block at the
        // 2-byte end is byte for byte what a 2-aligned writer makes of luni
        // plus lsct, so it reads as that: the two cannot be told apart.
        let junk = [block(b"luni", &luni("a"), b"8B"), b"IMlsct\0\0\0\x04\0\0\0\x01".to_vec()].concat();
        assert_eq!(junk, [block(b"luni", &luni("a"), &[]), header].concat());
        assert_eq!(kinds(&psd(&[("a", junk)], &[])), group);
    }
}
