use std::path::Path;

use monet_photo_core::{canonical_recipe_json, parse_recipe_json};
use monet_galerie::develop_job::{
    DevelopJobRequest, DevelopJobService, DevelopOutputOptions, OutputFormat, OutputMetadata,
    SourceIdentity,
};
use monet_galerie::develop_scheduler::CancellationToken;
use monet_galerie::proof::verify_product_tiff;
use monet_galerie::tiff_export::OutputProfile;
use serde_json::json;
use sha2::{Digest, Sha256};

fn main() -> Result<(), String> {
    let arguments: Vec<String> = std::env::args().collect();
    if arguments.len() != 4 {
        return Err("usage: product_proof <source-raw> <output-tiff> <srgb|display-p3>".into());
    }
    let profile = match arguments[3].as_str() {
        "srgb" => OutputProfile::Srgb,
        "display-p3" => OutputProfile::DisplayP3,
        _ => return Err("profile must be srgb or display-p3".into()),
    };
    let fixture: serde_json::Value = serde_json::from_slice(include_bytes!(
        "../../../../../packages/monet-ui/packages/monet-photo/fixtures/canonical-recipe-v2.json"
    ))
    .map_err(|error| error.to_string())?;
    let mut recipe = fixture["recipe"].clone();
    recipe["basic"]["exposure"] = json!(0.15);
    recipe["basic"]["contrast"] = json!(0.1);
    recipe["basic"]["vibrance"] = json!(0.2);
    recipe["effects"]["grainAmount"] = json!(0.05);
    let recipe = parse_recipe_json(serde_json::to_vec(&recipe).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())?;
    let canonical =
        String::from_utf8(canonical_recipe_json(&recipe).map_err(|error| error.to_string())?)
            .map_err(|error| error.to_string())?;
    let output = Path::new(&arguments[2]);
    let expected_digest: String =
        Sha256::digest(std::fs::read(&arguments[1]).map_err(|error| error.to_string())?)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect();
    let result = DevelopJobService::default().run(
        DevelopJobRequest {
            job_id: format!("product-proof-{}", std::process::id()),
            source: SourceIdentity {
                path: arguments[1].clone(),
                catalog_id: "product-proof".into(),
                photo_id: 1,
                expected_digest,
            },
            canonical_recipe_json: canonical,
            output: DevelopOutputOptions {
                path: arguments[2].clone(),
                profile,
                format: OutputFormat::Tiff16,
            },
            interactive: false,
        },
        CancellationToken::default(),
    )?;
    let OutputMetadata::Tiff(metadata) = &result.output else {
        return Err("product TIFF proof received non-TIFF output".into());
    };
    let proof = verify_product_tiff(output, metadata.width, metadata.height, profile)?;
    println!(
        "{}",
        serde_json::to_string(&json!({ "result": result, "proof": proof }))
            .map_err(|error| error.to_string())?
    );
    Ok(())
}
