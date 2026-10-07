use monet_photo_core::{
    canonical_recipe_json, develop_in_place, encode_linear_srgb_rgba16, parse_recipe_json,
    recipe_digest, AlphaMode, CoverageView, DecodeProvenance, DevelopFrame, OrientationState,
    PixelEncoding, RenderContext, ScratchArena,
};
use serde_json::json;
use std::io::{self, Read};

fn input() -> Vec<u16> {
    (0..24u16)
        .flat_map(|index| {
            [
                700 + index * 1900,
                1300 + index * 1400,
                2900 + index * 900,
                u16::MAX,
            ]
        })
        .collect()
}

fn provenance() -> DecodeProvenance {
    DecodeProvenance {
        source_digest: "11".repeat(32),
        backend: "shared-core-wasm-proof".into(),
        backend_revision: "1".into(),
        decoder_version: "1".into(),
        active_area: [0, 0, 6, 4],
        working_profile_digest: "22".repeat(32),
        decode_intent_digest: "33".repeat(32),
        alpha_mode: AlphaMode::Opaque,
    }
}

fn render(pixels: Vec<u16>, encoding: PixelEncoding, recipe_json: &str) -> Vec<u16> {
    let recipe = parse_recipe_json(recipe_json).expect("checked proof recipe");
    let mut frame = DevelopFrame::new(
        6,
        4,
        pixels,
        encoding,
        OrientationState {
            source_exif: 6,
            output_exif: 1,
        },
        provenance(),
    )
    .expect("checked proof frame");
    develop_in_place(
        &mut frame,
        &recipe,
        &RenderContext {
            scale_numerator: 1,
            scale_denominator: 1,
            coverage: CoverageView {
                width: 6,
                height: 4,
                coverage: None,
            },
        },
        &mut ScratchArena::default(),
    )
    .expect("native shared-core render");
    frame.pixels
}

fn main() {
    let mut recipe_json = String::new();
    io::stdin()
        .read_to_string(&mut recipe_json)
        .expect("read recipe JSON");
    let recipe = parse_recipe_json(&recipe_json).expect("checked proof recipe");
    let canonical =
        String::from_utf8(canonical_recipe_json(&recipe).expect("canonical recipe")).unwrap();
    let digest = recipe_digest(&recipe).expect("recipe digest");
    let linear_input = input();
    let mut encoded_input = linear_input.clone();
    encode_linear_srgb_rgba16(&mut encoded_input);
    println!(
        "{}",
        json!({
            "width": 6,
            "height": 4,
            "canonicalJson": canonical,
            "recipeSha256": digest.0.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "linearInput": linear_input,
            "encodedInput": encoded_input,
            "linearOutput": render(input(), PixelEncoding::LinearSrgbU16Full, &recipe_json),
            "encodedOutput": render(encoded_input, PixelEncoding::SrgbEncodedU16Full, &recipe_json),
        })
    );
}
