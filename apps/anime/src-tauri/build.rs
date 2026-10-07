fn main() {
    // Declare the shared atomicsave plugin (from the monet-ui crate) so the
    // window's capability can grant it — undeclared commands are refused by
    // the ACL (#504).
    tauri_build::try_build(
        tauri_build::Attributes::new().plugin(
            "atomicsave",
            tauri_build::InlinedPlugin::new()
                .commands(&["atomic_write"])
                .default_permission(tauri_build::DefaultPermissionRule::AllowAllCommands),
        ),
    )
    .expect("failed to build Monet Anime's Tauri context");
}
