use std::path::Path;

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::tiff_export::{profile_bytes, validate_tiff, OutputProfile};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProductTiffProof {
    pub width: u32,
    pub height: u32,
    pub profile: OutputProfile,
    pub bits_per_sample: u8,
    pub samples_per_pixel: u8,
    pub orientation: u8,
    pub icc_digest: String,
}

pub fn verify_product_tiff(
    path: &Path,
    width: u32,
    height: u32,
    profile: OutputProfile,
) -> Result<ProductTiffProof, String> {
    let icc = profile_bytes(profile)?;
    validate_tiff(path, width, height, &icc)?;
    Ok(ProductTiffProof {
        width,
        height,
        profile,
        bits_per_sample: 16,
        samples_per_pixel: 3,
        orientation: 1,
        icc_digest: Sha256::digest(icc)
            .iter()
            .map(|byte| format!("{byte:02x}"))
            .collect(),
    })
}
