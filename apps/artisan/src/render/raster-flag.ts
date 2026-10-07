// Standalone (no wasm imports) so CanvasView can read the flag without pulling
// the Rust engine into the default bundle — the RasterDocument is lazy-loaded.

/** Whether to render the document via the Rust/WASM engine (opt-in during the
 *  SVG→Rust migration): `?renderer=rust` in the URL, or localStorage
 *  `artisan:renderer = "rust"`. `?renderer=svg` forces the legacy SVG path. */
export function rasterRendererEnabled(): boolean {
  try {
    const q = new URLSearchParams(window.location.search).get("renderer");
    if (q === "rust") return true;
    if (q === "svg") return false;
    return window.localStorage.getItem("artisan:renderer") === "rust";
  } catch {
    return false;
  }
}
