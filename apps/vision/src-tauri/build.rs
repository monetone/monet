/// End-entity cert C2PA will accept: digitalSignature plus emailProtection,
/// CA:FALSE, and a normal validity window. A bare rcgen default is rejected
/// as "the certificate is invalid".
fn dev_signer_params(common_name: &str) -> rcgen::CertificateParams {
    let mut params = rcgen::CertificateParams::default();
    params.not_before = rcgen::date_time_ymd(2026, 1, 1);
    params.not_after = rcgen::date_time_ymd(2036, 1, 1);
    params.subject_alt_names.clear();
    params.distinguished_name = rcgen::DistinguishedName::new();
    params
        .distinguished_name
        .push(rcgen::DnType::CommonName, common_name);
    params
        .distinguished_name
        .push(rcgen::DnType::OrganizationName, "Monet");
    params
        .distinguished_name
        .push(rcgen::DnType::CountryName, "US");
    params.is_ca = rcgen::IsCa::ExplicitNoCa;
    params.key_usages = vec![rcgen::KeyUsagePurpose::DigitalSignature];
    params.extended_key_usages = vec![rcgen::ExtendedKeyUsagePurpose::EmailProtection];
    params.use_authority_key_identifier_extension = true;
    params
}

/// ES256 dev signer for Content Credentials. Written into OUT_DIR and compiled
/// into the app. It is not a source file: a private key must not be committed.
/// The pair is reused for as long as this build directory lives, so a rebuild
/// keeps the same untrusted identity until `cargo clean`.
fn ensure_dev_signer() {
    let out_dir = std::path::PathBuf::from(std::env::var("OUT_DIR").expect("OUT_DIR"));
    let cert_path = out_dir.join("es256-cert.pem");
    let key_path = out_dir.join("es256-key.pem");
    if cert_path.is_file() && key_path.is_file() {
        return;
    }
    let key = rcgen::KeyPair::generate_for(&rcgen::PKCS_ECDSA_P256_SHA256)
        .expect("generate the dev signer key");
    let params = dev_signer_params("Monet Vision Dev Signer");
    let cert = params.self_signed(&key).expect("self-sign the dev signer");
    std::fs::write(&cert_path, cert.pem()).expect("write the dev certificate");
    std::fs::write(&key_path, key.serialize_pem()).expect("write the dev key");
}

fn main() {
    ensure_dev_signer();
    // Declare in-app plugin commands (and the shared atomicsave plugin from the
    // monet-ui crate) so each webview's capability can grant just the
    // operations it needs — anything undeclared is refused by the ACL (#504).
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .plugin(
                "atomicsave",
                tauri_build::InlinedPlugin::new()
                    .commands(&["atomic_write"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "c2pa",
                tauri_build::InlinedPlugin::new()
                    .commands(&[
                        "sign_content_credentials",
                        "c2pa_read_manifest",
                        "c2pa_signer_info",
                        "c2pa_import_signer",
                        "c2pa_clear_signer",
                    ])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "droplet",
                tauri_build::InlinedPlugin::new()
                    .commands(&["save_droplet_app"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "float",
                tauri_build::InlinedPlugin::new()
                    .commands(&["open", "close", "cascade", "frame", "attach", "input"]),
            )
            .plugin(
                "heic",
                tauri_build::InlinedPlugin::new()
                    .commands(&["decode_heic", "encode_heic"])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            )
            .plugin(
                "models",
                tauri_build::InlinedPlugin::new()
                    .commands(&[
                        "download_model",
                        "cancel_download",
                        "import_model",
                        "cancel_import",
                        "verify_model_unit",
                        "remove_model",
                    ])
                    .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
            ),
    )
    .expect("failed to build Monet Vision's Tauri context");
}
