// Writes the committed GIMP XCF test fixture (GIMP is unavailable in this
// environment). Run from the crate dir:
//     ~/.cargo/bin/cargo run --example gen_xcf
// Emits test-assets/fixtures/sample.xcf — a v11 (64-bit pointer), RLE-compressed
// document matching the in-memory fixtures used by tests/xcf.rs.

#[path = "../dev/xcf_writer.rs"]
mod xcf_writer;

use std::fs;
use std::path::Path;
use xcf_writer::{sample_layers, write_xcf};

fn main() {
    let bytes = write_xcf(11, 1, 16, 16, &sample_layers());
    let out = Path::new(env!("CARGO_MANIFEST_DIR")).join("test-assets/fixtures/sample.xcf");
    fs::create_dir_all(out.parent().unwrap()).unwrap();
    fs::write(&out, &bytes).unwrap();
    println!("wrote {} ({} bytes)", out.display(), bytes.len());
}
