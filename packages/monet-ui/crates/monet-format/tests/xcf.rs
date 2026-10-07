// XCF reader tests. GIMP isn't available, so we generate XCF in-memory with a
// faithful writer (dev/xcf_writer.rs) across both pointer widths (v1 = 32-bit,
// v11 = 64-bit) and both tile codecs (uncompressed + GIMP per-plane RLE), then
// parse and assert structure + byte-exact pixels.

#[path = "../dev/xcf_writer.rs"]
mod xcf_writer;

use monet_format::import::{parse, BlendMode, LayerKind, SourceFormat};
use xcf_writer::{sample_layers, write_xcf, WLayer};

fn layer<'a>(doc: &'a monet_format::import::Document, name: &str) -> &'a monet_format::import::Layer {
    doc.layers
        .iter()
        .find(|l| l.name == name)
        .unwrap_or_else(|| panic!("no layer {name}; have {:?}", doc.layers.iter().map(|l| &l.name).collect::<Vec<_>>()))
}

fn check(version: u32, compression: u8) {
    let bytes = write_xcf(version, compression, 16, 16, &sample_layers());
    let doc = parse(&bytes).unwrap_or_else(|e| panic!("parse v{version} comp{compression}: {e}"));
    assert_eq!(doc.source, SourceFormat::Xcf);
    assert_eq!((doc.width, doc.height), (16, 16));

    // Bottom-to-top: Background is the bottommost root.
    let first_root = doc.layers.iter().find(|l| l.parent.is_none()).unwrap();
    assert_eq!(first_root.name, "Background", "v{version} comp{compression}");

    let bg = layer(&doc, "Background");
    assert_eq!(&bg.rgba[0..4], &[30, 30, 30, 255]);

    let red = layer(&doc, "Red");
    assert!((red.opacity - 0.5).abs() < 0.01, "opacity {}", red.opacity);
    assert_eq!(red.blend, BlendMode::Multiply);
    assert_eq!(&red.rgba[0..4], &[220, 20, 20, 255]);
    // Gradient mask decoded: coverage = x*16.
    let mask = red.mask.as_ref().expect("Red mask");
    assert_eq!(mask.w, 16);
    assert_eq!(mask.data[8], 128, "mask coverage at x=8");
    assert_eq!(mask.data[0], 0);

    let group = layer(&doc, "Group");
    assert_eq!(group.kind, LayerKind::Group);
    let child = layer(&doc, "Child");
    assert_eq!(child.kind, LayerKind::Raster);
    assert_eq!(child.parent, Some(group.id), "Child must nest under Group");
    assert_eq!((child.bounds.x, child.bounds.y), (4, 4));
    assert_eq!((child.bounds.w, child.bounds.h), (8, 8));
    // Byte-exact green child (validates RLE/raw tile decode + de-planarization).
    for i in 0..8 * 8 {
        assert_eq!(&child.rgba[i * 4..i * 4 + 4], &[0, 200, 0, 255], "child px {i}");
    }
}

#[test]
fn xcf_v11_rle() {
    check(11, 1);
}

#[test]
fn xcf_v11_uncompressed() {
    check(11, 0);
}

#[test]
fn xcf_v1_rle_narrow_pointers() {
    check(1, 1);
}

#[test]
fn xcf_v1_uncompressed_narrow_pointers() {
    check(1, 0);
}

#[test]
fn xcf_multi_tile_gradient_byte_exact() {
    // 80×100 forces a 2×2 tile grid with clamped edge tiles (16 wide, 36 tall),
    // exercising the tile-blit offset math and per-tile RLE de-planarization.
    let (w, h) = (80u32, 100u32);
    let mut rgba = vec![0u8; (w * h * 4) as usize];
    for y in 0..h {
        for x in 0..w {
            let i = ((y * w + x) * 4) as usize;
            rgba[i] = (x % 256) as u8;
            rgba[i + 1] = (y % 256) as u8;
            rgba[i + 2] = ((x * 3 + y * 7) % 256) as u8;
            rgba[i + 3] = 255;
        }
    }
    let layers = vec![WLayer {
        name: "Gradient".into(),
        w,
        h,
        x: 0,
        y: 0,
        opacity: 1.0,
        visible: true,
        mode: 28,
        is_group: false,
        item_path: vec![0],
        rgba: rgba.clone(),
        mask: None,
    }];
    for comp in [0u8, 1u8] {
        let bytes = write_xcf(11, comp, w, h, &layers);
        let doc = parse(&bytes).unwrap_or_else(|e| panic!("parse comp{comp}: {e}"));
        assert_eq!(doc.layers.len(), 1);
        assert_eq!(doc.layers[0].rgba, rgba, "multi-tile pixels comp{comp}");
    }
}
