use std::env;
use std::fs;
use std::path::Path;

use monet_photo_core::{
    develop_in_place, parse_recipe_json, recipe_digest, CoverageView, RenderContext, ScratchArena,
};
use monet_galerie::raw_decode::{decode_to_frame, pack_frame, probe_for_preview, RawDecodeIntent};
use serde_json::json;
use sha2::{Digest, Sha256};

fn digest(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn rgba16_bytes(samples: &[u16]) -> Vec<u8> {
    samples
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect()
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = env::args().collect::<Vec<_>>();
    if args.len() != 4 {
        return Err("usage: shared_core_fixture <source.raw> <recipe.json> <output-dir>".into());
    }
    let recipe_json = fs::read_to_string(&args[2])?;
    let recipe_value: serde_json::Value = serde_json::from_str(&recipe_json)?;
    let intent: RawDecodeIntent = serde_json::from_value(recipe_value["rawDecode"].clone())?;
    let recipe = parse_recipe_json(&recipe_json)?;
    let recipe_digest = recipe_digest(&recipe)?;
    let probe = probe_for_preview(&args[1], 1024, &intent)?;
    let mut decoded = decode_to_frame(&args[1], 1024, &intent)?;
    let input_width = decoded.frame.width;
    let input_height = decoded.frame.height;
    let input_encoding = decoded.frame.encoding;
    let input_digest = digest(&rgba16_bytes(&decoded.frame.pixels));
    let mdev = pack_frame(&decoded)?;

    develop_in_place(
        &mut decoded.frame,
        &recipe,
        &RenderContext {
            scale_numerator: decoded.metadata.scale_numerator,
            scale_denominator: decoded.metadata.scale_denominator,
            coverage: CoverageView {
                width: input_width,
                height: input_height,
                coverage: None,
            },
        },
        &mut ScratchArena::default(),
    )?;
    let native = rgba16_bytes(&decoded.frame.pixels);
    let display = decoded
        .frame
        .pixels
        .iter()
        .map(|sample| ((*sample as u32 + 128) / 257) as u8)
        .collect::<Vec<_>>();
    let output = Path::new(&args[3]);
    fs::create_dir_all(output)?;
    fs::write(output.join("decoded.mdev16"), mdev)?;
    fs::write(output.join("native.rgba16le"), &native)?;

    println!(
        "{}",
        serde_json::to_string_pretty(&json!({
            "sourceDigest": decoded.frame.provenance.source_digest,
            "decodedInputDigest": input_digest,
            "decodeIntent": recipe_value["rawDecode"],
            "bitDepth": 16,
            "encoding": input_encoding,
            "inputWidth": input_width,
            "inputHeight": input_height,
            "outputWidth": decoded.frame.width,
            "outputHeight": decoded.frame.height,
            "recipeDigest": recipe_digest.0.iter().map(|byte| format!("{byte:02x}")).collect::<String>(),
            "nativeOutputDigest": digest(&native),
            "nativeDisplayDigest": digest(&display),
            "orientation": decoded.frame.orientation,
            "probe": probe,
            "provenance": decoded.frame.provenance,
            "metadata": decoded.metadata,
        }))?
    );
    Ok(())
}
