// ─────────────────────────────────────────────────────────────
// svgExport.ts — assemble a self-contained document SVG.
//
// The engine's export_paths_svg() emits only the vector-layer paths (stroke
// geometry, fill=none). A "document" SVG also needs the raster composite. This
// embeds the composite PNG as a base64 <image> background and overlays the
// vector paths on top — pure string assembly so it is unit-testable without the
// engine (the LUT-pattern: builder here, engine bytes fed in by app.ts).
// ─────────────────────────────────────────────────────────────

/**
 * Insert a base64-embedded raster `<image>` (the composite) right after the
 * opening `<svg …>` tag of `pathsSvg`, so the vector paths render over it.
 * Returns the input unchanged if it has no recognizable `<svg>` open tag.
 */
export function embedRasterInSvg(pathsSvg: string, w: number, h: number, pngBase64: string): string {
  const image = `  <image x="0" y="0" width="${w}" height="${h}" href="data:image/png;base64,${pngBase64}" />\n`;
  const m = pathsSvg.match(/<svg\b[^>]*>\n?/);
  if (!m || m.index === undefined) return pathsSvg;
  const at = m.index + m[0].length;
  return pathsSvg.slice(0, at) + image + pathsSvg.slice(at);
}
