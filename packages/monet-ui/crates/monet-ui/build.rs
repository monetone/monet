//! Build script for `monet-ui`.
//!
//! Tauri emits the `desktop` / `mobile` cfg *aliases* from its own build
//! script, but those only apply to the `tauri` crate itself — they do not
//! propagate to downstream crates. Since `monet-ui` is a plain library (it has
//! no `tauri-build` dependency), we re-derive the same aliases here so that the
//! `#[cfg(desktop)]`-gated menu code actually compiles on desktop targets.
//!
//! Pure std — no build-dependencies.

fn main() {
    let target_os = std::env::var("CARGO_CFG_TARGET_OS").unwrap_or_default();
    let mobile = target_os == "ios" || target_os == "android";

    // Declare the cfgs so `--cfg desktop` / `--cfg mobile` are not flagged by
    // the `unexpected_cfgs` lint.
    println!("cargo:rustc-check-cfg=cfg(desktop)");
    println!("cargo:rustc-check-cfg=cfg(mobile)");

    if mobile {
        println!("cargo:rustc-cfg=mobile");
    } else {
        println!("cargo:rustc-cfg=desktop");
    }
}
