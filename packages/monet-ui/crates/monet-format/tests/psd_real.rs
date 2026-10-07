// Regression tests against REAL, third-party Photoshop documents (not the
// synthetic `sample.psd` written by ag-psd in `gen/gen-psd.mjs`). Fixtures come
// from the MIT-licensed ag-psd project; see test-assets/fixtures/REAL-FIXTURES.md
// for provenance. Each expected structure is the ground truth from the ag-psd
// reference parser, so a test fails iff monet-format imports the real file wrong.

use monet_format::import::{
    parse, reconcile_psd_layer_blocks, Adjustment, ColorMode, Document, Layer, LayerKind,
    SourceFormat,
};

const REAL_PSD: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-adjustment-layers.psd"));
const REAL_16BIT: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-16bit-rgb.psd"));
const REAL_32BIT: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-32bit-rgb.psd"));
const REAL_INDEXED: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-indexed.psd"));
const REAL_BITMAP: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-bitmap.psd"));
const REAL_BITMAP_RLE: &[u8] =
    include_bytes!(concat!(env!("CARGO_MANIFEST_DIR"), "/test-assets/fixtures/real-bitmap-rle.psd"));

fn layer<'a>(doc: &'a Document, name: &str) -> &'a Layer {
    doc.layers.iter().find(|l| l.name == name).unwrap_or_else(|| {
        panic!("no layer named {name}; have {:?}", doc.layers.iter().map(|l| &l.name).collect::<Vec<_>>())
    })
}

fn u32_at(label: &str, bytes: &[u8], offset: usize) -> usize {
    assert!(offset + 4 <= bytes.len(), "{label}: missing PSD section length at byte {offset}");
    u32::from_be_bytes([bytes[offset], bytes[offset + 1], bytes[offset + 2], bytes[offset + 3]]) as usize
}

fn psd_v1_section_end(label: &str, bytes: &[u8], offset: usize, section: &str) -> usize {
    let len = u32_at(label, bytes, offset);
    let end = offset
        .checked_add(4)
        .and_then(|start| start.checked_add(len))
        .unwrap_or_else(|| panic!("{label}: {section} section length overflows usize"));
    assert!(end <= bytes.len(), "{label}: {section} section extends past fixture length");
    end
}

fn psd_v1_merged_composite_offset(label: &str, bytes: &[u8]) -> usize {
    assert!(bytes.len() >= 26, "{label}: missing fixed PSD header");
    assert_eq!(&bytes[0..4], b"8BPS", "{label}: PSD magic");
    assert_eq!(u16::from_be_bytes([bytes[4], bytes[5]]), 1, "{label}: PSD version");
    let mut offset = 26; // fixed PSD header
    offset = psd_v1_section_end(label, bytes, offset, "color mode data");
    offset = psd_v1_section_end(label, bytes, offset, "image resources");
    offset = psd_v1_section_end(label, bytes, offset, "layer and mask");
    assert!(offset + 2 <= bytes.len(), "{label}: missing merged-composite compression marker");
    offset
}

// The 16 adjustment layers Photoshop wrote, in stacking order (bottom→top above
// the single raster layer). "Color Lookup 1" is the one this fixture guards.
const ADJUSTMENT_LAYERS: &[&str] = &[
    "Brightness/Contrast 1",
    "Levels 1",
    "Curves 1",
    "Exposure 1",
    "Vibrance 1",
    "Hue/Saturation 1",
    "Color Balance 1",
    "Black & White 1",
    "Photo Filter 1",
    "Channel Mixer 1",
    "Color Lookup 1",
    "Invert 1",
    "Posterize 1",
    "Threshold 1",
    "Gradient Map 1",
    "Selective Color 1",
];

#[test]
fn imports_real_photoshop_adjustment_stack() {
    let doc = parse(REAL_PSD).expect("parse real adjustment-layers.psd");
    assert_eq!(doc.source, SourceFormat::Psd);
    assert_eq!((doc.width, doc.height), (200, 200), "canvas size");

    // 1 raster + 16 adjustment layers, none dropped or duplicated.
    assert_eq!(doc.layers.len(), 17, "layer count");

    // The single pixel layer keeps its raster kind and real (offset) bounds.
    let base = layer(&doc, "Layer 1");
    assert_eq!(base.kind, LayerKind::Raster);
    assert_eq!(
        (base.bounds.x, base.bounds.y, base.bounds.w, base.bounds.h),
        (64, 68, 65, 57),
        "raster layer bounds",
    );
    // A real Photoshop raster layer carries straight-alpha RGBA for its rect.
    assert_eq!(base.rgba.len(), (65 * 57 * 4) as usize, "raster rgba size");

    // Every adjustment layer is classified as Adjustment — the regression is
    // specifically that "Color Lookup 1" (clrL) used to come through as Raster.
    for name in ADJUSTMENT_LAYERS {
        assert_eq!(layer(&doc, name).kind, LayerKind::Adjustment, "{name} should be an adjustment layer");
    }

    // Exactly one raster layer, sixteen adjustments — guards against the inverse
    // regression (an adjustment silently decoded as pixels).
    let rasters = doc.layers.iter().filter(|l| l.kind == LayerKind::Raster).count();
    let adjustments = doc.layers.iter().filter(|l| l.kind == LayerKind::Adjustment).count();
    assert_eq!((rasters, adjustments), (1, 16), "exactly 1 raster + 16 adjustment layers");

    // Bottom-to-top ordering: the raster layer is the bottommost.
    assert_eq!(doc.layers[0].name, "Layer 1", "raster layer is bottommost");
}

#[test]
fn retains_real_photoshop_adjustment_blocks_as_byte_authority() {
    let doc = parse(REAL_PSD).expect("parse real adjustment-layers.psd");
    let expected = [
        ("Brightness/Contrast 1", *b"brit"),
        ("Levels 1", *b"levl"),
        ("Curves 1", *b"curv"),
        ("Exposure 1", *b"expA"),
        ("Vibrance 1", *b"vibA"),
        ("Hue/Saturation 1", *b"hue2"),
        ("Color Balance 1", *b"blnc"),
        ("Black & White 1", *b"blwh"),
        ("Photo Filter 1", *b"phfl"),
        ("Channel Mixer 1", *b"mixr"),
        ("Color Lookup 1", *b"clrL"),
        ("Invert 1", *b"nvrt"),
        ("Posterize 1", *b"post"),
        ("Threshold 1", *b"thrs"),
        ("Gradient Map 1", *b"grdm"),
        ("Selective Color 1", *b"selc"),
    ];

    for (name, key) in expected {
        let imported = layer(&doc, name);
        assert!(
            imported
                .psd_smart_blocks
                .iter()
                .any(|block| block.key == key && (!block.data.is_empty() || key == *b"nvrt")),
            "{name} retains its {:?} payload",
            String::from_utf8_lossy(&key)
        );
        assert_eq!(
            reconcile_psd_layer_blocks(imported, &imported.psd_smart_blocks)
                .unwrap_or_else(|error| panic!("{name}: {error}")),
            imported.psd_smart_blocks,
            "{name} untouched raw block order and bytes"
        );
    }
}

#[test]
fn decodes_real_adjustment_parameters() {
    // Several adjustments decoded to no parameters (the layers imported but applied
    // nothing): Exposure / Hue-Saturation / Color-Balance are fixed BINARY blocks
    // (expA/hue2/blnc) that were wrongly read as descriptors, and Black & White
    // (blwh descriptor) had no parser at all. The expected values below are the
    // ag-psd reference decode of this real fixture.
    let doc = parse(REAL_PSD).expect("parse real adjustment-layers.psd");

    match layer(&doc, "Exposure 1").adjustment.as_ref().expect("exposure params decoded") {
        Adjustment::Exposure { exposure, offset, gamma } => {
            assert!((*exposure + 2.0).abs() < 1e-3, "exposure {exposure}");
            assert!(offset.abs() < 1e-3, "offset {offset}");
            assert!((*gamma - 1.0).abs() < 1e-3, "gamma {gamma}");
        }
        other => panic!("expected Exposure, got {other:?}"),
    }

    match layer(&doc, "Hue/Saturation 1").adjustment.as_ref().expect("hue/sat params decoded") {
        Adjustment::HueSaturationFull {
            hue,
            saturation,
            lightness,
            colorize,
            ranges,
        } => {
            assert!(hue.abs() < 1e-3, "hue {hue}");
            assert!((*saturation + 0.40).abs() < 1e-3, "saturation {saturation}");
            assert!((*lightness - 0.05).abs() < 1e-3, "lightness {lightness}");
            assert!(!colorize, "fixture is not colorized");
            assert!(ranges.iter().flatten().all(|value| value.abs() < 1e-6));
        }
        other => panic!("expected full HueSaturation, got {other:?}"),
    }

    match layer(&doc, "Color Balance 1").adjustment.as_ref().expect("color balance params decoded") {
        Adjustment::ColorBalance { shadows, midtones, highlights } => {
            assert_eq!(*shadows, [0.0, 0.0, 0.0], "shadows");
            for (got, want) in midtones.iter().zip([0.16, -0.21, 0.33]) {
                assert!((got - want).abs() < 1e-3, "midtone {got} vs {want}");
            }
            for (got, want) in highlights.iter().zip([0.38, 0.35, 0.38]) {
                assert!((got - want).abs() < 1e-3, "highlight {got} vs {want}");
            }
        }
        other => panic!("expected ColorBalance, got {other:?}"),
    }

    // Black & White (blwh descriptor): all six grayscale bands and tint survive
    // in the full semantic representation. monet once imported this as a no-op.
    match layer(&doc, "Black & White 1").adjustment.as_ref().expect("black & white params decoded") {
        Adjustment::BlackWhiteFull {
            bands,
            tint,
            tint_hue,
            tint_saturation,
        } => {
            for (got, want) in bands.iter().zip([-0.4, 2.35, 1.44, -0.68, -0.03, -1.07]) {
                assert!((got - want).abs() < 1e-3, "band {got} vs {want}");
            }
            assert!(tint, "fixture tint flag");
            assert!((*tint_hue - 201.87918).abs() < 1e-3, "tint hue {tint_hue}");
            assert!((*tint_saturation - 0.665767).abs() < 1e-3, "tint saturation {tint_saturation}");
        }
        other => panic!("expected full BlackWhite, got {other:?}"),
    }
}

#[test]
fn imports_real_16bit_layers_from_lr16_block() {
    // 16-/32-bit documents leave the main Layer Info empty and store their layer
    // records in an `Lr16`/`Lr32` additional-info block. monet-format used to miss
    // that block and flatten the whole file to a single merged "Background"; this
    // guards the high-bit-depth layer-recovery path.
    let doc = parse(REAL_16BIT).expect("parse real 16-bit psd");
    assert_eq!(doc.source, SourceFormat::Psd);
    assert_eq!((doc.width, doc.height), (500, 500), "canvas size");
    assert_eq!(doc.depth, 16, "16 bits per channel");
    assert_eq!(doc.color_mode, ColorMode::Rgb);

    // The real layer is recovered (not the flattened-composite fallback): a single
    // raster "Layer 1" with the ag-psd-reference bounds — note it overhangs the
    // canvas with a negative offset, which the merged fallback could never produce.
    assert_eq!(doc.layers.len(), 1, "one real layer recovered from Lr16");
    let l = layer(&doc, "Layer 1");
    assert_eq!(l.kind, LayerKind::Raster);
    assert_eq!(l.blend, monet_format::import::BlendMode::Normal);
    assert!((l.opacity - 1.0).abs() < 1e-6);
    assert_eq!(
        (l.bounds.x, l.bounds.y, l.bounds.w, l.bounds.h),
        (-36, -34, 569, 591),
        "Lr16 layer bounds (overhanging canvas)",
    );

    // The recovery is NOT the merged fallback, which always names its layer
    // "Background" and spans exactly the canvas at origin.
    assert_ne!(l.name, "Background", "must be the real Lr16 layer, not the merged fallback");

    // Native u16 authority survives; rgba is only a compatibility preview.
    assert_eq!(l.rgba.len(), (569 * 591 * 4) as usize, "decoded rgba size");
    assert_eq!(l.rgba16.len(), (569 * 591 * 4) as usize, "native u16 size");
    assert!(
        l.rgba16.iter().any(|value| value % 257 != 0),
        "fixture contains precision that cannot be represented by RGBA8",
    );
    // Rendering anchor: the real photographic pixel at the layer-local centre —
    // an opaque brown — pins the 16->8-bit high-byte decode and channel placement.
    let mid = ((591 / 2) * 569 + 569 / 2) * 4;
    assert_eq!(&l.rgba[mid..mid + 4], &[76, 51, 26, 255], "centre pixel decoded value");
    assert_eq!(l.rgba16[mid] >> 8, 76);
    assert_eq!(l.rgba16[mid + 1] >> 8, 51);
    assert_eq!(l.rgba16[mid + 2] >> 8, 26);
    assert_eq!(l.rgba16[mid + 3], u16::MAX);
}

#[test]
fn imports_real_32bit_float_zip_predicted_channels() {
    // 32-bit/channel (float) documents store channels with ZIP-with-prediction
    // (compression code 3) using the TIFF floating-point predictor. monet-format
    // used to bail with Unsupported("32-bit ZIP-with-prediction") — the whole file
    // failed to open. This guards both the Lr32 layer recovery and the float decode.
    let doc = parse(REAL_32BIT).expect("parse real 32-bit psd");
    assert_eq!(doc.source, SourceFormat::Psd);
    assert_eq!((doc.width, doc.height), (300, 300), "canvas size");
    assert_eq!(doc.depth, 32, "32 bits per channel");
    assert_eq!(doc.color_mode, ColorMode::Rgb);

    // Both real layers recovered (from Lr32), not the flattened "Background".
    assert_eq!(doc.layers.len(), 2, "two real layers recovered from Lr32");
    let top = layer(&doc, "Layer 1");
    let bottom = layer(&doc, "Layer 0");
    assert_eq!(top.kind, LayerKind::Raster);
    assert_eq!(bottom.kind, LayerKind::Raster);
    assert_eq!(
        (top.bounds.x, top.bounds.y, top.bounds.w, top.bounds.h),
        (0, 223, 300, 77),
        "Layer 1 bounds",
    );
    assert_eq!(
        (bottom.bounds.x, bottom.bounds.y, bottom.bounds.w, bottom.bounds.h),
        (22, 30, 250, 263),
        "Layer 0 bounds",
    );

    // Native f32 authority survives ZIP prediction; rgba is only a display
    // preview. A broken predictor/endian path yields noise or non-finite values.
    assert_eq!(top.rgba.len(), (300 * 77 * 4) as usize, "top rgba size");
    assert_eq!(top.rgba32.len(), (300 * 77 * 4) as usize, "top native f32 size");
    assert_eq!(bottom.rgba32.len(), (250 * 263 * 4) as usize, "bottom native f32 size");
    assert!(top.rgba32.iter().all(|value| value.is_finite()));
    assert!(bottom.rgba32.iter().all(|value| value.is_finite()));
    assert!(
        top.rgba32.iter().any(|value| {
            let quantized = (value.clamp(0.0, 1.0) * 255.0).round() / 255.0;
            (value - quantized).abs() > 1e-6
        }),
        "fixture retains values between RGBA8 code points",
    );
    let top_mid = ((77 / 2) * 300 + 300 / 2) * 4;
    assert_eq!(&top.rgba[top_mid..top_mid + 4], &[242, 210, 71, 255], "top centre pixel");
    let bot_mid = ((263 / 2) * 250 + 250 / 2) * 4;
    assert_eq!(&bottom.rgba[bot_mid..bot_mid + 4], &[0, 171, 90, 128], "bottom centre pixel");
}

#[test]
fn imports_real_indexed_palette_colours() {
    // Indexed-colour documents store a single plane of palette indices plus the
    // 256-colour palette in the Color Mode Data section. monet-format used to skip
    // that palette, so the image decoded to grayscale index values (index 20 -> a
    // dark [20,20,20]) instead of its real colours. Expected RGB below come from an
    // independent decode of the palette + index plane.
    let doc = parse(REAL_INDEXED).expect("parse real indexed psd");
    assert_eq!(doc.source, SourceFormat::Psd);
    assert_eq!((doc.width, doc.height), (32, 32), "canvas size");
    assert_eq!(doc.color_mode, ColorMode::Indexed);

    // Indexed is always flattened — one composite "Background" layer.
    assert_eq!(doc.layers.len(), 1);
    let bg = layer(&doc, "Background");
    assert_eq!(bg.kind, LayerKind::Raster);
    assert_eq!(bg.rgba.len(), (32 * 32 * 4) as usize);

    // Palette-mapped colours at sampled positions (x, y) -> RGBA. The colored
    // anchors (blue, tan) would be near-black grays under the palette-skip bug.
    let px = |x: usize, y: usize| &bg.rgba[(y * 32 + x) * 4..(y * 32 + x) * 4 + 4];
    assert_eq!(px(0, 0), &[255, 255, 255, 255], "(0,0) index 20 -> white");
    assert_eq!(px(16, 16), &[0, 0, 0, 255], "(16,16) index 21 -> black");
    assert_eq!(px(8, 8), &[15, 110, 165, 255], "(8,8) index 6 -> blue");
    assert_eq!(px(24, 24), &[223, 187, 133, 255], "(24,24) index 17 -> tan");
}

#[test]
fn imports_real_1bit_bitmap_documents() {
    // 1-bit Bitmap-mode documents pack 8 pixels per byte (rows are ceil(w/8)
    // bytes). monet-format used to read depth-1 channels as 1 byte/pixel, underrun
    // the merged composite, and import ZERO layers — the image was lost entirely.
    // Now each bit unpacks to black (set) / white (clear). Expected black/white
    // pixels below come from an independent decode of the packed bitmap. Both the
    // raw (compression 0) and PackBits/RLE (compression 1) encodings are covered.
    const BLACK: &[u8] = &[0, 0, 0, 255];
    const WHITE: &[u8] = &[255, 255, 255, 255];
    for (bytes, comp, p00, p7550) in [
        (REAL_BITMAP, "raw", BLACK, WHITE),
        (REAL_BITMAP_RLE, "rle", WHITE, BLACK),
    ] {
        let doc = parse(bytes).unwrap_or_else(|e| panic!("parse {comp} bitmap: {e:?}"));
        assert_eq!(doc.source, SourceFormat::Psd);
        assert_eq!((doc.width, doc.height), (300, 200), "{comp} canvas");
        assert_eq!(doc.depth, 1, "{comp} 1 bit per channel");
        assert_eq!(doc.color_mode, ColorMode::Bitmap, "{comp} colour mode");

        // The image is recovered as one flattened "Background", not lost.
        assert_eq!(doc.layers.len(), 1, "{comp}: image recovered, not zero layers");
        let bg = layer(&doc, "Background");
        assert_eq!(bg.kind, LayerKind::Raster);
        assert_eq!(bg.rgba.len(), (300 * 200 * 4) as usize, "{comp} rgba size");

        // Each unpacked bit is pure black or white; the two fixtures differ at
        // these positions, so the asserts can't all pass on a stuck/blank plane.
        let px = |x: usize, y: usize| &bg.rgba[(y * 300 + x) * 4..(y * 300 + x) * 4 + 4];
        assert_eq!(px(0, 0), p00, "{comp} (0,0)");
        assert_eq!(px(75, 50), p7550, "{comp} (75,50)");
        assert_eq!(px(150, 100), BLACK, "{comp} (150,100)");
        assert_eq!(px(299, 199), BLACK, "{comp} (299,199)");
    }
}

#[test]
fn rejects_truncated_flattened_psd_instead_of_empty_success() {
    // Flattened Indexed/Bitmap files rely on the merged-composite fallback. If
    // that composite is truncated, parsing must fail instead of returning
    // Ok(Document { layers: [] }), which downstream import paths can mistake for
    // a successful but blank document.
    for (label, bytes) in [
        ("indexed", REAL_INDEXED),
        ("bitmap", REAL_BITMAP),
        ("bitmap-rle", REAL_BITMAP_RLE),
    ] {
        let cut = psd_v1_merged_composite_offset(label, bytes) + 2; // keep compression marker, drop image payload
        assert!(cut < bytes.len(), "{label}: fixture must include merged-composite payload");
        assert!(parse(&bytes[..cut]).is_err(), "{label} truncated composite should error");
    }
}
