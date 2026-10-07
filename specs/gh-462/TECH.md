# PSD/PSB channel compression

The issue's reopening clarification identifies native 32-bit export as the remaining gap. Integer channels continue using PackBits (compression word `1`); float channels now use ZIP with prediction (word `3`, as defined in the [Adobe format specification](https://www.adobe.com/devnet-apps/photoshop/fileformatashtml/)).

`monet-format::import::zip_predict_f32_encode` byte-shuffles each big-endian float row into four byte planes, differences bytes across that row, and compresses the result with the existing `miniz_oxide` dependency. No conversion to integer or display-range values occurs. Invalid row lengths return an error before the channel writer appends anything.

`write_psd_channel` selects this codec for all 32-bit callers: layer RGBA planes, user masks, real masks, and the merged RGBA plus document alpha/spot planes. Layer records retain their compressed byte lengths. Merged channels share one zlib stream; prediction resets on every row. PSD/PSB container length fields remain unchanged. PSD size preflight reserves conservative ZIP overhead so incompressible channels cannot bypass the PSB size guard.

## Validation

- Codec checks compare independently specified predicted bytes, exact float bit patterns, short/wide rows, empty planes, and invalid row shapes.
- Engine checks inspect every layer/mask compression word and the merged compression word for PSD and PSB at all three depths.
- Round trips preserve native user/real masks, ordered document channels, layered HDR samples, and merged HDR samples exactly.
- A mostly-empty 32-bit layered image produces a complete file smaller than 25% of its raw channel bytes.
- Regression commands: `cargo test --manifest-path packages/engine/Cargo.toml format_import_round_trip` and `cargo test --manifest-path packages/monet-ui/Cargo.toml -p monet-format`.

Photoshop itself is not installed in the execution environment; opening newly exported files in Photoshop remains a manual interoperability check. Existing real Photoshop ZIP-predicted fixtures are covered by the format suite.
