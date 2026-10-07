use std::time::Instant;

use monet_photo_core::{
    develop_in_place, parse_recipe_json, recipe_digest, CoverageView, RenderContext, ScratchArena,
};
use monet_galerie::raw_decode::{decode_to_frame, RawDecodeIntent};
use serde_json::json;
use sha2::{Digest, Sha256};

fn frame_digest(frame: &monet_photo_core::DevelopFrame) -> String {
    let bytes: Vec<u8> = frame
        .pixels
        .iter()
        .flat_map(|sample| sample.to_le_bytes())
        .collect();
    Sha256::digest(bytes)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn digest_hex(digest: monet_photo_core::RecipeDigest) -> String {
    digest.0.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn main() -> Result<(), String> {
    let source = std::env::args()
        .nth(1)
        .ok_or("usage: proxy_proof <source-raw>")?;
    let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../../packages/monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
    ))
    .map_err(|error| error.to_string())?;
    let mut first_value = fixture["recipe"].clone();
    first_value["basic"]["exposure"] = json!(0.15);
    first_value["basic"]["contrast"] = json!(0.1);
    let first_recipe =
        parse_recipe_json(serde_json::to_vec(&first_value).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let mut rerender_value = first_value;
    rerender_value["basic"]["exposure"] = json!(0.35);
    let rerender_recipe =
        parse_recipe_json(serde_json::to_vec(&rerender_value).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let intent: RawDecodeIntent = serde_json::from_value(first_recipe.value()["rawDecode"].clone())
        .map_err(|e| e.to_string())?;

    let cold = Instant::now();
    let decoded = decode_to_frame(&source, 4096, &intent)?;
    let (width, height) = (decoded.frame.width, decoded.frame.height);
    let context = RenderContext {
        scale_numerator: decoded.metadata.scale_numerator,
        scale_denominator: decoded.metadata.scale_denominator,
        coverage: CoverageView {
            width,
            height,
            coverage: None,
        },
    };
    let mut first_output = decoded.frame.clone();
    develop_in_place(
        &mut first_output,
        &first_recipe,
        &context,
        &mut ScratchArena::default(),
    )
    .map_err(str::to_string)?;
    let cold_milliseconds = cold.elapsed().as_millis();
    let first_output_digest = frame_digest(&first_output);
    drop(first_output);

    let rerender = Instant::now();
    let mut rerender_output = decoded.frame.clone();
    develop_in_place(
        &mut rerender_output,
        &rerender_recipe,
        &context,
        &mut ScratchArena::default(),
    )
    .map_err(str::to_string)?;
    let rerender_milliseconds = rerender.elapsed().as_millis();
    let rerender_output_digest = frame_digest(&rerender_output);
    if first_output_digest == rerender_output_digest {
        return Err("changed proxy recipe produced identical output".into());
    }
    println!(
        "{}",
        json!({
            "width": width,
            "height": height,
            "coldMilliseconds": cold_milliseconds,
            "rerenderMilliseconds": rerender_milliseconds,
            "baselineSourceDigest": decoded.metadata.source_digest,
            "firstRecipeDigest": digest_hex(recipe_digest(&first_recipe).map_err(|error| error.to_string())?),
            "rerenderRecipeDigest": digest_hex(recipe_digest(&rerender_recipe).map_err(|error| error.to_string())?),
            "firstOutputDigest": first_output_digest,
            "rerenderOutputDigest": rerender_output_digest
        })
    );
    Ok(())
}
