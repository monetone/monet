# Native float core adjustments and filters

The existing menu and modal preview calls remain the public API. `adjust_levels` / `adjust_levels_multi`, `adjust_curves`, both Hue/Saturation exports, `adjust_exposure`, `filter_gaussian_blur`, `filter_sharpen`, and `filter_unsharp_mask` now dispatch to float kernels when editing a 32-bit pixel layer. Blur and Blur More already call Gaussian Blur; Sharpen and Sharpen More already call Sharpen.

## Native edit behavior

`apply32` projects the canvas selection into the layer's effective bounds, including live Move offsets. It validates the source and resulting native samples before changing history or pixels, applies feathered coverage in float precision, honors image/all/transparency locks, then records one native layer snapshot. The u16 display proxy is regenerated from `pixels_f32`; it never supplies edited values.

Mask targeting stays in the existing coverage edit path, so a selected mask cannot accidentally write layer RGB. All-lock also protects that mask path. Existing history transactions preserve native samples through preview reset, Cancel, Apply, Undo and Redo. Invalid parameters and results outside the finite float range report an operation-specific error without creating history.

## Transfer functions

- Levels extends its input/output range mapping using a signed gamma power. Master and individual channel controls retain their order.
- Curves interpolates the existing 256-entry dialog LUTs and extrapolates the endpoint tangents below zero and above one. Each tangent is measured across the 16 end entries, because a single 8-bit step rounds a gentle slope flat and would pin a lifted curve's highlights to 1.0. The window's ceiling: a control point or endpoint inside the top or bottom 16 entries blends into that tangent, so a white point moved to 0.94 lets HDR highlights keep rising at about 1/16 slope (16.0 maps to about 1.94) instead of clipping at 1.0; in-range values are unaffected. Master and individual channel LUTs remain separate. Double-precision interpolation protects finite extreme float inputs from intermediate overflow.
- Exposure applies stops, offset and signed gamma directly to the scene-linear float authority.
- Hue/Saturation reuses the full legacy/ranges/Colorize kernel in each pixel's extended RGB interval and restores that interval afterward. It retains HDR scale and negative samples without quantizing through the display proxy.
- Gaussian Blur shares the existing separable Gaussian kernel with integer documents and filters premultiplied RGBA, including tiny nonzero alpha. The kernel's f32 weights rarely sum to exactly 1, so a fully opaque neighbourhood's alpha is snapped back to exactly 1.0 rather than exporting values like 0.99999976. Sharpen/Unsharp Mask use its float result while preserving source alpha. RGB results are never clamped to display range.

Other destructive operations, including unsupported smart-filter edits, retain their guards and now name the refused operation. This change does not enable the smart-filter rendering stack or change saved document schemas.

## Validation

The `native_float_safety` tests exercise the public menu-equivalent exports, HDR and negative samples, channel routing, Curves highlights, Hue/Saturation ranges and Colorize, alpha, selection projection, every pixel lock, mask targeting, malformed controls, overflowing output, and native preview transaction reset/cancel/commit plus Undo/Redo. Existing integer adjustment/filter tests cover the shared Gaussian refactor.

Commands: `cargo test --manifest-path packages/engine/Cargo.toml --lib` and `pnpm --filter monet-vision run engine:build`.
