// ─────────────────────────────────────────────────────────────
// graphics — the unified Monet graphics document (design doc §8, option D).
//
// One layer-stack document that represents BOTH raster (Vision) and vector
// (Artisan) content, superseding `.mvsn` and `.artisan`. It reuses this crate's
// `import::` raster IR for the raster/adjustment/text/group/smart-object layer
// kinds and adds a `Vector` kind.
//
// The vector scene is carried as a `serde_json::Value` (the canonical `.artisan`
// document JSON) rather than a strongly-typed field: that keeps monet-format free
// of any dependency on the engine crate (which depends on monet-format, so the
// reverse would be circular). It is lossless — the value IS the `.artisan` JSON —
// and the engine parses it into its `vector::model::Document` on load.
//
// Persistence reuses the `format::` envelope PATTERNS (a `{format,schemaVersion,
// app,document}` wrapper, `#[serde(flatten)] extra` forward-compat, camelCase +
// skip_serializing_if, lenient parse) — but a fresh layer-stack spine, since the
// timeline envelope cannot host a layer stack.
// ─────────────────────────────────────────────────────────────

use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};

use crate::import::{
    Adjustment, BlendMode, Bounds, ColorMode, Document as ImportDocument, DocumentChannel, Effect,
    LayerKind as ImportKind, Mask, PsdTaggedBlock, Text,
};

pub const PSD_LINKED_BLOCKS_EXTRA: &str = "photoshopLinkedBlocks";
pub const PSD_SMART_BLOCKS_EXTRA: &str = "photoshopSmartObjectBlocks";

/// The `format` discriminator written into the envelope.
pub const GFX_FORMAT: &str = "monet-graphics";
/// Current on-disk schema version. A reader rejects a strictly higher version.
/// v2 adds native-u16 `RasterPayload.pixels`; v3 adds bounded native-f32 pixel
/// storage; v4 moves document-channel planes behind typed refs. v1-v3 inline
/// layer and channel payloads still load.
pub const GFX_SCHEMA_VERSION: u32 = 4;

fn one() -> f32 { 1.0 }
fn yes() -> bool { true }
fn depth8() -> u8 { 8 }
fn blend_normal() -> BlendMode { BlendMode::Normal }
fn color_rgb() -> ColorMode { ColorMode::Rgb }
fn identity_affine() -> [f32; 6] { [1.0, 0.0, 0.0, 1.0, 0.0, 0.0] }

/// The on-disk envelope. `GfxDocument::to_json` writes this; `parse` accepts
/// either this wrapper or a bare `GfxDocument`.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GfxFile {
    pub format: String,
    pub schema_version: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub app: Option<AppInfo>,
    pub document: GfxDocument,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub name: String,
    #[serde(default)]
    pub version: String,
}

/// A unified graphics document: a bottom-to-top layer stack over a canvas.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GfxDocument {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub id: String,
    #[serde(default)]
    pub name: String,
    pub width: u32,
    pub height: u32,
    #[serde(default = "depth8")]
    pub depth: u8,
    #[serde(default = "color_rgb")]
    pub color_mode: ColorMode,
    /// Bottom-to-top (index 0 = bottommost), matching the engine layer vec.
    #[serde(default)]
    pub layers: Vec<GfxLayer>,
    /// Ordered document alpha/spot plates with native-depth authority.
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub channels: Vec<GfxDocumentChannel>,
    /// Provenance when imported from a foreign format.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<crate::import::SourceFormat>,
    /// The document's embedded ICC profile, base64 of the raw profile bytes.
    /// Every app is a COURIER for it: an app that cannot interpret a profile
    /// must still re-emit these two fields verbatim, or a hand-off through it
    /// silently reinterprets the document's colors as sRGB.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icc_profile: Option<String>,
    /// Display name for `icc_profile` (e.g. "Adobe RGB (1998)").
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub icc_profile_name: Option<String>,
    /// Per-app namespaced bags (e.g. Vision-only frames/selections; design §8.7).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub data: Option<Value>,
    /// Forward-compat: unknown top-level fields round-trip losslessly.
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// The unified layer kind. Superset of `import::LayerKind` + `Vector`.
#[derive(Serialize, Deserialize, Debug, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum GfxLayerKind {
    Raster,
    Adjustment,
    Text,
    Group,
    SmartObject,
    Vector,
}

impl GfxLayerKind {
    pub fn from_import(k: ImportKind) -> GfxLayerKind {
        match k {
            ImportKind::Raster => GfxLayerKind::Raster,
            ImportKind::Adjustment => GfxLayerKind::Adjustment,
            ImportKind::Text => GfxLayerKind::Text,
            ImportKind::Group => GfxLayerKind::Group,
            ImportKind::SmartObject => GfxLayerKind::SmartObject,
        }
    }
    /// Engine `kind` byte (0 raster, 1 adjustment, 2 text, 3 vector, 6 group, 7 smart).
    pub fn engine_byte(self) -> u8 {
        match self {
            GfxLayerKind::Raster => 0,
            GfxLayerKind::Adjustment => 1,
            GfxLayerKind::Text => 2,
            GfxLayerKind::Vector => 3,
            GfxLayerKind::Group => 6,
            GfxLayerKind::SmartObject => 7,
        }
    }
}

/// One layer. Common compositing fields are grafted from `import::Layer`; the
/// kind-specific payload is either `raster` (Raster/Text/SmartObject/Adjustment/
/// Group) or `vector` (Vector).
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GfxLayer {
    pub id: u32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub parent: Option<u32>,
    #[serde(default)]
    pub name: String,
    pub kind: GfxLayerKind,
    #[serde(default = "one")]
    pub opacity: f32,
    #[serde(default = "one")]
    pub fill_opacity: f32,
    #[serde(default = "blend_normal")]
    pub blend: BlendMode,
    #[serde(default = "yes")]
    pub visible: bool,
    #[serde(default)]
    pub clipping: bool,
    #[serde(default)]
    pub locked: bool,
    #[serde(default)]
    pub knockout: u8,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub blend_if: Option<[f32; 32]>,
    /// Group-only: PassThrough (non-isolated). `import::BlendMode` has no
    /// PassThrough variant, so it is carried here (design doc §7/§8.1).
    #[serde(default)]
    pub pass_through: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mask: Option<Mask>,
    /// Resolution-independent per-layer affine [a b c d e f]. The raster IR has
    /// only an integer offset (`bounds`); shape/vector layers need a real affine.
    #[serde(default = "identity_affine")]
    pub transform: [f32; 6],
    #[serde(default, skip_serializing_if = "RasterPayload::is_empty")]
    pub raster: RasterPayload,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub vector: Option<VectorPayload>,
    #[serde(flatten)]
    pub extra: Map<String, Value>,
}

/// A reference to a layer's pixel data. The unified format keeps pixels OUT of
/// the inline `rgba` array (which forces an 8-bit JSON-number blowup and loses
/// >8-bit precision) by pointing at a zip entry (`Png`/`Raw16`/`Raw32`) or carrying a
/// base64 blob inline (`Base64`). `Base64{bits}` is what the JSON-only
/// `save_graphics` writes; the zip container rewrites those to an external ref.
///   • `Png{path}`   — an 8-bit RGBA PNG zip entry.
///   • `Raw16{path}` — a zlib-deflated little-endian u16 RGBA stream (see
///                     `deflate_u16_le`), preserving full >8-bit precision.
///   • `Raw32{path}` — a zlib-deflated little-endian f32 RGBA stream.
///   • `Base64{data,bits}` — base64 of either an 8-bit RGBA byte stream (`bits=8`)
///                     or the deflated native stream (`bits=16`/`bits=32`).
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum PixelRef {
    Png { path: String, w: u32, h: u32 },
    Raw16 { path: String, w: u32, h: u32 },
    Raw32 { path: String, w: u32, h: u32 },
    Base64 { data: String, w: u32, h: u32, bits: u8 },
}

/// A single-plane document-channel payload. Unlike layer `PixelRef`, all three
/// external forms are exact raw sample streams: Raw8 is one byte/sample and
/// Raw16/Raw32 are little-endian two/four-byte samples. `Base64` carries that
/// same canonical raw stream for plain-JSON documents.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum ChannelPixelRef {
    Raw8 { path: String, w: u32, h: u32 },
    Raw16 { path: String, w: u32, h: u32 },
    Raw32 { path: String, w: u32, h: u32 },
    Base64 { data: String, w: u32, h: u32, bits: u8 },
}

/// Metadata plus one authoritative document-channel plane. The three inline
/// vectors are retained only to read v1-v3 documents; v4 writes normalize them
/// into `pixels` and serialize none of the compatibility arrays.
#[derive(Serialize, Deserialize, Debug, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GfxDocumentChannel {
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub name: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub identifier: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub display: Option<crate::import::ChannelDisplayInfo>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixels: Option<ChannelPixelRef>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data: Vec<u8>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data16: Vec<u16>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub data32: Vec<f32>,
}

impl GfxDocumentChannel {
    /// Construct a v4 channel record around an already chosen authoritative ref.
    pub fn with_pixels(channel: &DocumentChannel, pixels: ChannelPixelRef) -> Self {
        Self {
            name: channel.name.clone(),
            identifier: channel.identifier,
            display: channel.display,
            pixels: Some(pixels),
            data: Vec::new(),
            data16: Vec::new(),
            data32: Vec::new(),
        }
    }

    /// Encode one authoritative plane for the plain-JSON path. Native authority
    /// wins only at its matching document depth; otherwise the 8-bit plane is
    /// the compatibility authority, matching existing engine behavior.
    pub fn inline(channel: &DocumentChannel, w: u32, h: u32, depth: u8) -> Self {
        let (bits, bytes) = if depth == 32 && !channel.data32.is_empty() {
            (32, f32_plane_to_le_bytes(&channel.data32))
        } else if depth == 16 && !channel.data16.is_empty() {
            (16, u16_plane_to_le_bytes(&channel.data16))
        } else {
            (8, channel.data.clone())
        };
        Self::with_pixels(
            channel,
            ChannelPixelRef::Base64 {
                data: base64_encode(&bytes),
                w,
                h,
                bits,
            },
        )
    }

    fn normalized_for_write(&self, w: u32, h: u32, depth: u8) -> Self {
        if let Some(pixels) = self.pixels.clone() {
            let legacy = DocumentChannel {
                name: self.name.clone(),
                identifier: self.identifier,
                display: self.display,
                data: Vec::new(),
                data16: Vec::new(),
                data32: Vec::new(),
            };
            return Self::with_pixels(&legacy, pixels);
        }
        let legacy = DocumentChannel {
            name: self.name.clone(),
            identifier: self.identifier,
            display: self.display,
            data: self.data.clone(),
            data16: self.data16.clone(),
            data32: self.data32.clone(),
        };
        Self::inline(&legacy, w, h, depth)
    }
}

/// The raster-IR per-layer payload (grafted from `import::Layer`).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct RasterPayload {
    #[serde(default, skip_serializing_if = "bounds_is_zero")]
    pub bounds: Bounds,
    /// w*h*4 straight-alpha RGBA, layer-local. v1 docs store pixels here inline;
    /// v2 writers leave this `None` and use `pixels` instead. Still read for
    /// backward compatibility with v1 documents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub rgba: Option<Vec<u8>>,
    /// v2 precision-preserving pixel storage (design §8.4). Supersedes `rgba` on
    /// new writes; readers fall back to `rgba` when this is absent.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub pixels: Option<PixelRef>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub adjustment: Option<Adjustment>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub effects: Vec<Effect>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub text: Option<Text>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub raw_blend_key: Option<[u8; 4]>,
}

impl RasterPayload {
    pub fn is_empty(&self) -> bool {
        bounds_is_zero(&self.bounds)
            && self.rgba.is_none()
            && self.pixels.is_none()
            && self.adjustment.is_none()
            && self.effects.is_empty()
            && self.text.is_none()
            && self.raw_blend_key.is_none()
    }
}

fn bounds_is_zero(b: &Bounds) -> bool {
    b.x == 0 && b.y == 0 && b.w == 0 && b.h == 0
}

/// The vector layer payload: an Artisan scene (`.artisan` document JSON).
#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct VectorPayload {
    /// The `vector::model::Document` as JSON. Lossless; parsed by the engine.
    #[serde(default)]
    pub scene: Value,
    /// Bake text to bezier outlines when rasterizing (vs. host text shaping).
    #[serde(default = "yes")]
    pub text_as_outline: bool,
}

impl GfxDocument {
    /// Build a unified document from an imported (PSD/PSB/XCF) raster document.
    /// Each `import::Layer` maps 1:1; no vector layers are produced.
    pub fn from_import(doc: &ImportDocument) -> GfxDocument {
        let layers = doc
            .layers
            .iter()
            .map(|l| {
                let mut extra = Map::new();
                if !l.psd_smart_blocks.is_empty() {
                    extra.insert(
                        PSD_SMART_BLOCKS_EXTRA.into(),
                        psd_blocks_to_json(&l.psd_smart_blocks),
                    );
                }
                let native_pixels = if !l.rgba32.is_empty() {
                    Some(PixelRef::Base64 {
                        data: base64_encode(&deflate_f32_le(&l.rgba32).unwrap_or_default()),
                        w: l.bounds.w,
                        h: l.bounds.h,
                        bits: 32,
                    })
                } else if !l.rgba16.is_empty() {
                    Some(PixelRef::Base64 {
                        data: base64_encode(&deflate_u16_le(&l.rgba16)),
                        w: l.bounds.w,
                        h: l.bounds.h,
                        bits: 16,
                    })
                } else {
                    None
                };
                GfxLayer {
                    id: l.id,
                    parent: l.parent,
                    name: l.name.clone(),
                    kind: GfxLayerKind::from_import(l.kind),
                    opacity: l.opacity,
                    fill_opacity: l.fill_opacity,
                    blend: l.blend,
                    visible: l.visible,
                    clipping: l.clipping,
                    locked: l.locked,
                    knockout: l.knockout,
                    blend_if: l.blend_if,
                    pass_through: l.pass_through,
                    mask: l.mask.clone(),
                    transform: identity_affine(),
                    raster: RasterPayload {
                        bounds: l.bounds,
                        rgba: if native_pixels.is_none() && !l.rgba.is_empty() {
                            Some(l.rgba.clone())
                        } else {
                            None
                        },
                        pixels: native_pixels,
                        adjustment: l.adjustment.clone(),
                        effects: l.effects.clone(),
                        text: l.text.clone(),
                        raw_blend_key: l.raw_blend_key,
                    },
                    vector: None,
                    extra,
                }
            })
            .collect();
        let mut extra = Map::new();
        if !doc.psd_linked_blocks.is_empty() {
            extra.insert(
                PSD_LINKED_BLOCKS_EXTRA.into(),
                psd_blocks_to_json(&doc.psd_linked_blocks),
            );
        }
        GfxDocument {
            id: String::new(),
            name: String::new(),
            width: doc.width,
            height: doc.height,
            depth: doc.depth,
            color_mode: doc.color_mode,
            layers,
            channels: doc
                .channels
                .iter()
                .map(|channel| GfxDocumentChannel::inline(channel, doc.width, doc.height, doc.depth))
                .collect(),
            source: Some(doc.source),
            icc_profile: None,
            icc_profile_name: None,
            data: None,
            extra,
        }
    }

    /// Serialize to the pretty-printed envelope JSON (matches `format::serialize`).
    pub fn to_json(&self) -> String {
        let mut document = self.clone();
        document.channels = self
            .channels
            .iter()
            .map(|channel| {
                channel.normalized_for_write(self.width, self.height, self.depth)
            })
            .collect();
        let file = GfxFile {
            format: GFX_FORMAT.to_string(),
            schema_version: GFX_SCHEMA_VERSION,
            app: None,
            document,
        };
        serde_json::to_string_pretty(&file).unwrap_or_default()
    }

    /// Parse from JSON. Accepts either the `{format,schemaVersion,document}`
    /// envelope or a bare `GfxDocument`. Rejects a strictly newer schema version.
    pub fn parse(json: &str) -> Result<GfxDocument, String> {
        let v: Value = serde_json::from_str(json).map_err(|e| format!("graphics parse: {e}"))?;
        if let Some(doc_val) = v.get("document") {
            // Envelope form — validate format + version first (lenient version).
            if let Some(fmt) = v.get("format").and_then(Value::as_str) {
                if fmt != GFX_FORMAT {
                    return Err(format!("not a {GFX_FORMAT} document: {fmt}"));
                }
            }
            if let Some(ver) = v.get("schemaVersion").and_then(Value::as_u64) {
                if ver > GFX_SCHEMA_VERSION as u64 {
                    return Err(format!(
                        "document schemaVersion {ver} is newer than supported {GFX_SCHEMA_VERSION}"
                    ));
                }
            }
            serde_json::from_value(doc_val.clone()).map_err(|e| format!("graphics document: {e}"))
        } else {
            serde_json::from_value(v).map_err(|e| format!("graphics document: {e}"))
        }
    }
}

fn psd_blocks_to_json(blocks: &[PsdTaggedBlock]) -> Value {
    Value::Array(
        blocks
            .iter()
            .map(|block| {
                serde_json::json!({
                    "key": String::from_utf8_lossy(&block.key),
                    "data": base64_encode(&block.data),
                })
            })
            .collect(),
    )
}

// ─────────────────────────────────────────────────────────────
// Pixel codecs (raw16 + base64). These stay in monet-format so the PixelRef
// contract is self-contained; the engine reuses them when (de)serializing the
// `Base64` variant. `miniz_oxide` is already a dependency (PSD/XCF inflate).
// PNG/zip I/O lives in the engine (the `image`/zip surface), not here.
// ─────────────────────────────────────────────────────────────

/// Canonical little-endian bytes for one native-u16 plane.
pub fn u16_plane_to_le_bytes(data: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(data.len().saturating_mul(2));
    for &value in data {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Canonical little-endian bytes for one native-f32 plane. Validation belongs
/// to the reader/writer boundary so this conversion remains bit-exact.
pub fn f32_plane_to_le_bytes(data: &[f32]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(data.len().saturating_mul(4));
    for value in data {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    bytes
}

/// Deflate a `u16` slice as a little-endian byte stream (zlib), mirroring the
/// engine's `w_u16vec` LE layout. The inverse is `inflate_u16_le`.
pub fn deflate_u16_le(data: &[u16]) -> Vec<u8> {
    let mut bytes = Vec::with_capacity(data.len() * 2);
    for &x in data {
        bytes.extend_from_slice(&x.to_le_bytes());
    }
    miniz_oxide::deflate::compress_to_vec_zlib(&bytes, 6)
}

/// Inflate a u16 LE byte stream produced by `deflate_u16_le`. `count` is the
/// number of u16 samples expected (e.g. `w*h*4`). Returns `None` on a corrupt or
/// truncated stream.
pub fn inflate_u16_le(bytes: &[u8], count: usize) -> Option<Vec<u16>> {
    let expected = count.checked_mul(2)?;
    let limit = expected.saturating_add(1).max(1);
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(bytes, limit).ok()?;
    if raw.len() != expected {
        return None;
    }
    let mut out = Vec::with_capacity(count);
    for i in 0..count {
        out.push(u16::from_le_bytes([raw[i * 2], raw[i * 2 + 1]]));
    }
    Some(out)
}

/// Deflate a validated little-endian f32 RGBA stream. RGB may be negative or
/// above 1 up to `MAX_HDR_SAMPLE`; alpha must remain within 0..1.
pub fn deflate_f32_le(data: &[f32]) -> Option<Vec<u8>> {
    if data.len() % 4 != 0
        || data.iter().enumerate().any(|(index, value)| {
            !value.is_finite()
                || value.abs() > crate::import::MAX_HDR_SAMPLE
                || (index % 4 == 3 && !(0.0..=1.0).contains(value))
        })
    {
        return None;
    }
    let mut bytes = Vec::with_capacity(data.len().checked_mul(4)?);
    for value in data {
        bytes.extend_from_slice(&value.to_le_bytes());
    }
    Some(miniz_oxide::deflate::compress_to_vec_zlib(&bytes, 6))
}

/// Inflate a bounded native-f32 RGBA stream and reject corrupt, non-finite, or
/// unreasonable samples before allocating engine authority.
pub fn inflate_f32_le(bytes: &[u8], count: usize) -> Option<Vec<f32>> {
    if count % 4 != 0 {
        return None;
    }
    let expected = count.checked_mul(4)?;
    let limit = expected.saturating_add(1).max(1);
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(bytes, limit).ok()?;
    if raw.len() != expected {
        return None;
    }
    let mut out = Vec::with_capacity(count);
    for (index, bytes) in raw.chunks_exact(4).enumerate() {
        let value = f32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
        if !value.is_finite()
            || value.abs() > crate::import::MAX_HDR_SAMPLE
            || (index % 4 == 3 && !(0.0..=1.0).contains(&value))
        {
            return None;
        }
        out.push(value);
    }
    Some(out)
}

const B64: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Standard-alphabet base64 encoder with `=` padding (no dependency).
pub fn base64_encode(data: &[u8]) -> String {
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b0 = chunk[0] as u32;
        let b1 = *chunk.get(1).unwrap_or(&0) as u32;
        let b2 = *chunk.get(2).unwrap_or(&0) as u32;
        let n = (b0 << 16) | (b1 << 8) | b2;
        out.push(B64[(n >> 18) as usize & 63] as char);
        out.push(B64[(n >> 12) as usize & 63] as char);
        out.push(if chunk.len() > 1 { B64[(n >> 6) as usize & 63] as char } else { '=' });
        out.push(if chunk.len() > 2 { B64[n as usize & 63] as char } else { '=' });
    }
    out
}

/// Standard-alphabet base64 decoder (ignores whitespace and `=` padding).
pub fn base64_decode(s: &str) -> Option<Vec<u8>> {
    fn val(c: u8) -> Option<u32> {
        match c {
            b'A'..=b'Z' => Some((c - b'A') as u32),
            b'a'..=b'z' => Some((c - b'a' + 26) as u32),
            b'0'..=b'9' => Some((c - b'0' + 52) as u32),
            b'+' => Some(62),
            b'/' => Some(63),
            _ => None,
        }
    }
    let mut out = Vec::with_capacity(s.len() * 3 / 4);
    let mut acc = 0u32;
    let mut bits = 0u32;
    for c in s.bytes() {
        if c == b'=' || c.is_ascii_whitespace() {
            continue;
        }
        let v = val(c)?;
        acc = (acc << 6) | v;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push((acc >> bits) as u8);
        }
    }
    Some(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import::{Document as ImportDocument, Layer as ImportLayer, LayerKind, PsdTaggedBlock, SourceFormat};

    #[test]
    fn import_document_round_trips_through_unified_format() {
        let mut doc = ImportDocument::new(8, 4, SourceFormat::Psd);
        let mut l = ImportLayer::new(1, "Background", LayerKind::Raster, Bounds { x: 0, y: 0, w: 8, h: 4 });
        l.rgba = vec![0u8; 8 * 4 * 4];
        l.rgba[0] = 200; // a marker pixel
        l.kind = LayerKind::SmartObject;
        l.psd_smart_blocks.push(PsdTaggedBlock {
            key: *b"SoLd",
            data: b"descriptor".to_vec(),
        });
        doc.layers.push(l);
        doc.psd_linked_blocks.push(PsdTaggedBlock {
            key: *b"lnk2",
            data: b"embedded-source".to_vec(),
        });

        let gfx = GfxDocument::from_import(&doc);
        let json = gfx.to_json();
        assert!(json.contains("monet-graphics"));
        let back = GfxDocument::parse(&json).expect("parse round-trip");

        assert_eq!(back.width, 8);
        assert_eq!(back.height, 4);
        assert_eq!(back.layers.len(), 1);
        assert_eq!(back.layers[0].kind, GfxLayerKind::SmartObject);
        assert_eq!(back.layers[0].kind.engine_byte(), 7);
        let rgba = back.layers[0].raster.rgba.as_ref().expect("pixels survive");
        assert_eq!(rgba.len(), 8 * 4 * 4);
        assert_eq!(rgba[0], 200);
        assert_eq!(back.source, Some(SourceFormat::Psd));
        assert!(back.layers[0].extra.contains_key(PSD_SMART_BLOCKS_EXTRA));
        assert!(back.extra.contains_key(PSD_LINKED_BLOCKS_EXTRA));
    }

    #[test]
    fn vector_layer_and_unknown_fields_round_trip() {
        // A document with a vector layer carrying an .artisan scene + a future
        // top-level field that must survive a round-trip via `extra`.
        let json = r#"{
          "format": "monet-graphics",
          "schemaVersion": 1,
          "document": {
            "width": 100, "height": 100,
            "futureGlobalThing": {"x": 1},
            "layers": [
              {"id": 1, "name": "Art", "kind": "vector",
               "vector": {"scene": {"artboards": [], "layers": []}, "textAsOutline": true}}
            ]
          }
        }"#;
        let doc = GfxDocument::parse(json).expect("parse");
        assert_eq!(doc.layers.len(), 1);
        assert_eq!(doc.layers[0].kind, GfxLayerKind::Vector);
        assert_eq!(doc.layers[0].kind.engine_byte(), 3);
        assert!(doc.layers[0].vector.is_some());
        assert!(doc.extra.contains_key("futureGlobalThing"), "unknown field preserved");

        // Re-serialize and confirm the unknown field is still there.
        let again = doc.to_json();
        assert!(again.contains("futureGlobalThing"));
    }

    #[test]
    fn icc_profile_and_foreign_namespaces_round_trip() {
        // COLOR-07 + the courier rule: the embedded profile and every foreign
        // app namespace under `data` survive a parse → serialize round trip,
        // additively (no schemaVersion bump — a v1 reader ignores them).
        let json = r#"{
          "format": "monet-graphics",
          "schemaVersion": 4,
          "document": {
            "width": 2, "height": 1,
            "iccProfile": "YWJjZA==",
            "iccProfileName": "Adobe RGB (1998)",
            "data": {"artisan": {"guides": [1, 2]}, "galerie": {"rating": 5}},
            "layers": []
          }
        }"#;
        let doc = GfxDocument::parse(json).expect("parse");
        assert_eq!(doc.icc_profile.as_deref(), Some("YWJjZA=="));
        assert_eq!(base64_decode(doc.icc_profile.as_deref().unwrap()).unwrap(), b"abcd");
        assert_eq!(doc.icc_profile_name.as_deref(), Some("Adobe RGB (1998)"));

        let back = GfxDocument::parse(&doc.to_json()).expect("reparse");
        assert_eq!(back.icc_profile, doc.icc_profile);
        assert_eq!(back.icc_profile_name, doc.icc_profile_name);
        assert_eq!(back.data, doc.data, "foreign app namespaces preserved");
        assert_eq!(
            back.data.as_ref().and_then(|d| d.get("galerie")),
            Some(&serde_json::json!({"rating": 5})),
        );
        // Absent on a document that never had one — no empty-string noise.
        let bare = GfxDocument::parse(
            r#"{"format":"monet-graphics","schemaVersion":4,"document":{"width":1,"height":1}}"#,
        )
        .expect("parse bare");
        assert!(bare.icc_profile.is_none() && bare.icc_profile_name.is_none());
        assert!(!bare.to_json().contains("iccProfile"));
    }

    #[test]
    fn rejects_newer_schema_version() {
        // The version gate rejects anything strictly above the current schema.
        let json = r#"{"format":"monet-graphics","schemaVersion":999,"document":{"width":1,"height":1}}"#;
        assert!(GfxDocument::parse(json).is_err());
        // Older precision-preserving documents remain readable.
        let v2 = r#"{"format":"monet-graphics","schemaVersion":2,"document":{"width":1,"height":1}}"#;
        assert!(GfxDocument::parse(v2).is_ok());
        let v3 = r#"{"format":"monet-graphics","schemaVersion":3,"document":{"width":1,"height":1}}"#;
        assert!(GfxDocument::parse(v3).is_ok());
    }

    // ── v2 pixel contract ───────────────────────────────────────────────

    #[test]
    fn raw16_codec_preserves_16bit_value() {
        // The regression proof: a native 16-bit value must survive the LE
        // deflate/inflate codec bit-for-bit (the OLD u16→u8 save collapsed
        // 0x1234 to 0x1212).
        let pixels: Vec<u16> = vec![0x1234, 0x0000, 0xFFFF, 0x00FF, 0xAB12];
        let packed = deflate_u16_le(&pixels);
        let back = inflate_u16_le(&packed, pixels.len()).expect("inflate");
        assert_eq!(back, pixels);
        assert_eq!(back[0], 0x1234, "16-bit precision preserved, not flattened");
        // A corrupt stream is rejected rather than panicking.
        assert!(inflate_u16_le(b"not a zlib stream", 4).is_none());
    }

    #[test]
    fn base64_round_trips_arbitrary_bytes() {
        for data in [vec![], vec![0u8], vec![1, 2, 3], vec![255, 254, 253, 0, 1], (0..255u32).map(|x| x as u8).collect()] {
            let enc = base64_encode(&data);
            let dec = base64_decode(&enc).expect("decode");
            assert_eq!(dec, data, "base64 round-trip (len {})", data.len());
        }
    }

    #[test]
    fn raster_pixels_base64_16bit_round_trips_through_json() {
        // A RasterPayload carrying 16-bit pixels as a Base64{bits:16} PixelRef
        // survives a full GfxDocument JSON round-trip with the value intact.
        let src: Vec<u16> = vec![0x1234, 0x5678, 0x9ABC, 0xDEF0]; // one RGBA pixel
        let data = base64_encode(&deflate_u16_le(&src));
        let mut doc = GfxDocument {
            id: String::new(), name: String::new(), width: 1, height: 1, depth: 16,
            color_mode: color_rgb(), layers: Vec::new(), channels: Vec::new(), source: None,
            icc_profile: None, icc_profile_name: None, data: None, extra: Map::new(),
        };
        let mut layer = GfxLayer {
            id: 1, parent: None, name: "L".into(), kind: GfxLayerKind::Raster, opacity: 1.0,
            fill_opacity: 1.0, blend: blend_normal(), visible: true, clipping: false, locked: false,
            knockout: 0, blend_if: None, pass_through: false, mask: None, transform: identity_affine(),
            raster: RasterPayload::default(), vector: None, extra: Map::new(),
        };
        layer.raster.bounds = Bounds { x: 0, y: 0, w: 1, h: 1 };
        layer.raster.pixels = Some(PixelRef::Base64 { data, w: 1, h: 1, bits: 16 });
        doc.layers.push(layer);

        let json = doc.to_json();
        assert!(json.contains("\"schemaVersion\": 4"));
        let back = GfxDocument::parse(&json).expect("parse");
        let px = back.layers[0].raster.pixels.as_ref().expect("pixels survive");
        match px {
            PixelRef::Base64 { data, w, h, bits } => {
                assert_eq!((*w, *h, *bits), (1, 1, 16));
                let raw = base64_decode(data).expect("b64");
                let vals = inflate_u16_le(&raw, 4).expect("inflate");
                assert_eq!(vals, src, "16-bit pixels preserved through the JSON round-trip");
            }
            other => panic!("expected Base64, got {other:?}"),
        }
        assert!(back.layers[0].raster.rgba.is_none(), "v2 writers leave rgba empty");
    }

    #[test]
    fn raw32_codec_preserves_hdr_and_rejects_invalid_samples() {
        let pixels = vec![4.25, -0.125, 0.5, 0.75, 1.25, 2.0, 0.0, 1.0];
        let packed = deflate_f32_le(&pixels).expect("valid float pixels");
        let back = inflate_f32_le(&packed, pixels.len()).expect("inflate");
        assert_eq!(back, pixels);
        assert_eq!(back[0].to_bits(), 4.25f32.to_bits());

        let mut invalid = pixels.clone();
        invalid[0] = f32::NAN;
        assert!(deflate_f32_le(&invalid).is_none(), "NaN rejected");
        invalid[0] = 0.0;
        invalid[3] = 1.01;
        assert!(deflate_f32_le(&invalid).is_none(), "alpha above one rejected");
        invalid[3] = 1.0;
        invalid[0] = 100_000.25;
        let large = deflate_f32_le(&invalid).expect("large finite PSD32 value accepted");
        assert_eq!(
            inflate_f32_le(&large, invalid.len()).expect("large finite value inflates")[0]
                .to_bits(),
            invalid[0].to_bits(),
        );
        invalid[0] = f32::INFINITY;
        assert!(deflate_f32_le(&invalid).is_none(), "infinite RGB rejected");

        let mut trailing = Vec::new();
        for value in [4.25f32, 0.0, 0.0, 1.0, 9.0] {
            trailing.extend_from_slice(&value.to_le_bytes());
        }
        let trailing = miniz_oxide::deflate::compress_to_vec_zlib(&trailing, 6);
        assert!(inflate_f32_le(&trailing, 4).is_none(), "trailing decoded samples rejected");
    }

    #[test]
    fn v4_plain_json_writes_one_authoritative_channel_plane() {
        let cases = [
            (
                8,
                DocumentChannel {
                    name: Some("Eight".into()),
                    identifier: Some(8),
                    display: None,
                    data: vec![1, 2, 3, 4],
                    data16: Vec::new(),
                    data32: Vec::new(),
                },
                8,
                vec![1, 2, 3, 4],
            ),
            (
                16,
                DocumentChannel {
                    name: Some("Sixteen".into()),
                    identifier: Some(16),
                    display: None,
                    data: vec![0x12, 0x56, 0x9a, 0xff],
                    data16: vec![0x1234, 0x5678, 0x9abc, 0xffff],
                    data32: Vec::new(),
                },
                16,
                u16_plane_to_le_bytes(&[0x1234, 0x5678, 0x9abc, 0xffff]),
            ),
            (
                32,
                DocumentChannel {
                    name: Some("Thirty two".into()),
                    identifier: Some(32),
                    display: None,
                    data: vec![0, 128, 255, 255],
                    data16: Vec::new(),
                    data32: vec![-0.25, 0.5, 4.0, 1.0],
                },
                32,
                f32_plane_to_le_bytes(&[-0.25, 0.5, 4.0, 1.0]),
            ),
        ];

        for (depth, channel, expected_bits, expected_bytes) in cases {
            let doc = GfxDocument {
                id: String::new(),
                name: String::new(),
                width: 2,
                height: 2,
                depth,
                color_mode: color_rgb(),
                layers: Vec::new(),
                channels: vec![GfxDocumentChannel::inline(&channel, 2, 2, depth)],
                source: None,
                icc_profile: None,
                icc_profile_name: None,
                data: None,
                extra: Map::new(),
            };
            let json = doc.to_json();
            assert!(json.contains("\"schemaVersion\": 4"));
            assert!(!json.contains("\"data\": ["), "legacy preview array leaked");
            assert!(!json.contains("\"data16\""), "legacy u16 array leaked");
            assert!(!json.contains("\"data32\""), "legacy f32 array leaked");

            let parsed = GfxDocument::parse(&json).expect("v4 channel parses");
            match parsed.channels[0].pixels.as_ref().expect("channel ref") {
                ChannelPixelRef::Base64 { data, w, h, bits } => {
                    assert_eq!((*w, *h, *bits), (2, 2, expected_bits));
                    assert_eq!(base64_decode(data).expect("base64"), expected_bytes);
                }
                other => panic!("expected inline Base64 channel, got {other:?}"),
            }
        }
    }

    #[test]
    fn v3_inline_document_channel_reads_and_rewrites_as_v4_ref() {
        let json = r#"{
          "format": "monet-graphics",
          "schemaVersion": 3,
          "document": {
            "width": 2, "height": 1, "depth": 16,
            "channels": [{
              "name": "Alpha", "identifier": 42,
              "data": [18, 171], "data16": [4660, 43981]
            }],
            "layers": []
          }
        }"#;
        let legacy = GfxDocument::parse(json).expect("v3 channel parses");
        assert!(legacy.channels[0].pixels.is_none());
        assert_eq!(legacy.channels[0].data, vec![18, 171]);
        assert_eq!(legacy.channels[0].data16, vec![0x1234, 0xabcd]);

        let rewritten = legacy.to_json();
        assert!(rewritten.contains("\"schemaVersion\": 4"));
        assert!(!rewritten.contains("\"data\": ["));
        assert!(!rewritten.contains("\"data16\""));
        let parsed = GfxDocument::parse(&rewritten).expect("rewritten channel parses");
        match parsed.channels[0].pixels.as_ref().expect("v4 ref") {
            ChannelPixelRef::Base64 { data, bits, .. } => {
                assert_eq!(*bits, 16);
                assert_eq!(
                    base64_decode(data).expect("base64"),
                    u16_plane_to_le_bytes(&[0x1234, 0xabcd])
                );
            }
            other => panic!("expected Base64 channel, got {other:?}"),
        }
    }

    #[test]
    fn v1_inline_rgba_doc_still_loads() {
        // A v1 document storing pixels inline in `rgba` must still parse.
        let json = r#"{
          "format": "monet-graphics",
          "schemaVersion": 1,
          "document": {
            "width": 2, "height": 1,
            "layers": [
              {"id": 1, "name": "Bg", "kind": "raster",
               "raster": {"bounds": {"x":0,"y":0,"w":2,"h":1},
                          "rgba": [10,20,30,255, 40,50,60,255]}}
            ]
          }
        }"#;
        let doc = GfxDocument::parse(json).expect("v1 parse");
        let rgba = doc.layers[0].raster.rgba.as_ref().expect("inline rgba");
        assert_eq!(rgba.len(), 8);
        assert_eq!(rgba[0], 10);
        assert!(doc.layers[0].raster.pixels.is_none(), "no v2 pixels in a v1 doc");
    }
}
