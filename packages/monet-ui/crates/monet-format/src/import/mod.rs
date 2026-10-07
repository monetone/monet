// ─────────────────────────────────────────────────────────────
// monet-format — a pure-Rust importer/exporter library for layered image
// documents, compatible with the Monet Vision engine.
//
// A growing library: today it reads Adobe Photoshop PSD (v1) and PSB (large
// document, v2), and GIMP XCF (v0–v11+), each into a neutral `Document` IR
// (see `document`). The Monet engine depends on this crate and adapts the IR
// onto its own layer model.
//
// No `wasm-bindgen` here — the crate is pure logic (bytes in, `Document` out),
// so it compiles into the wasm engine AND runs natively under `cargo test`.
// ─────────────────────────────────────────────────────────────

mod codec;
mod descriptor;
mod document;
mod error;
mod psd;
mod psd_semantics;
mod reader;
mod xcf;

pub use document::{
    Adjustment, BlendMode, Bounds, ChannelDisplayInfo, Color3, ColorMode, Document,
    DocumentChannel, DocumentPath, Effect, Layer, LayerKind, Mask, PsdTaggedBlock, SourceFormat, Text, TextRun,
    MAX_HDR_SAMPLE, MAX_PSD_PRESERVED_BLOCKS, MAX_PSD_PRESERVED_BYTES,
};
pub use error::{FormatError, Result};
pub use psd::{lab_to_srgb, parse_image_source_data, psb_uses_8_byte_length, srgb_to_lab};
pub use psd_semantics::{
    decode_psd_solid_shape, encode_gradient_fill, encode_pattern_fill, encode_psd_placed_layer,
    psd_embedded_file, psd_linked_blocks_with_file, psd_placed_layer, reconcile_psd_layer_blocks,
    reconcile_psd_linked_blocks, PsdPlacedLayer, PsdShapeSubpath, PsdSolidShape,
    OPAQUE_FILL_KEYS,
};

/// GIMP per-plane RLE encoder — the "export"/fixture-generation side of the
/// codec. Exposed so test-fixture generators (and future XCF writers) share the
/// exact scheme the reader expects.
pub use codec::gimp_rle_encode_plane;
/// PackBits — the PSD/PSB compression-1 row codec. The encoder is what the
/// engine's PSD writer packs channel rows with; the decoder is its inverse.
pub use codec::{packbits_decode, packbits_encode};
/// Native float PSD/PSB compression-3 channel encoder.
pub use codec::zip_predict_f32_encode;

/// Identify a document by its leading bytes without fully parsing it.
pub fn sniff(bytes: &[u8]) -> Option<SourceFormat> {
    if bytes.len() >= 6 && &bytes[0..4] == b"8BPS" {
        return match u16::from_be_bytes([bytes[4], bytes[5]]) {
            1 => Some(SourceFormat::Psd),
            2 => Some(SourceFormat::Psb),
            _ => None,
        };
    }
    if bytes.len() >= 9 && &bytes[0..9] == b"gimp xcf " {
        return Some(SourceFormat::Xcf);
    }
    None
}

/// Parse any supported layered document into the neutral `Document` IR,
/// auto-detecting the format from its magic.
pub fn parse(bytes: &[u8]) -> Result<Document> {
    match sniff(bytes) {
        Some(SourceFormat::Psd) | Some(SourceFormat::Psb) => psd::parse(bytes),
        Some(SourceFormat::Xcf) => xcf::parse(bytes),
        None => Err(FormatError::BadMagic),
    }
}

#[cfg(test)]
mod sniff_tests {
    use super::*;

    #[test]
    fn sniffs_psd_psb_xcf() {
        let mut psd = b"8BPS".to_vec();
        psd.extend([0, 1]);
        assert_eq!(sniff(&psd), Some(SourceFormat::Psd));
        let mut psb = b"8BPS".to_vec();
        psb.extend([0, 2]);
        assert_eq!(sniff(&psb), Some(SourceFormat::Psb));
        assert_eq!(sniff(b"gimp xcf file\0"), Some(SourceFormat::Xcf));
        assert_eq!(sniff(b"not an image"), None);
    }

    #[test]
    fn parse_rejects_unknown() {
        assert_eq!(parse(b"garbage!!").unwrap_err(), FormatError::BadMagic);
    }
}
