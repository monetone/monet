// SVG intrinsic-size parsing for browser SVG rasterization. Pure, deterministic,
// node-safe (no DOM) — so it unit-tests without a browser and any Monet app that
// opens SVG sizes it identically. The rasterization itself (a secure-static-mode
// <img> drawn to a 2D canvas) stays app-side; this module is the shared math it
// feeds. Paired with each app's svgToPng glue.

export const SVG_RE = /\.svg$/i;
const MAX_DIM = 8192; // guard a viewBox like "0 0 1e9 1e9" from allocating a huge canvas
const DEF_DIM = 512;  // width/height and viewBox both absent → a sensible default

/** A plain or px length ("240", "240px") → number; %/em/other units → null. */
function len(s: string | undefined): number | null {
  const m = s?.trim().match(/^(-?\d*\.?\d+)(px)?$/i);
  const v = m ? parseFloat(m[1]) : NaN;
  return Number.isFinite(v) ? v : null;
}

/** Locate the root `<svg …>` tag. (#95) A plain `/<svg\b[^>]*>/` got this wrong
 *  twice on legal input: a commented-out root tag in the preamble won the match,
 *  and a `>` inside an attribute value truncated the tag so width/height after it
 *  were missed. So comments/PIs/doctype are masked out (blanked in place, keeping
 *  offsets valid) and the closing `>` is found past quoted values. */
function findRootTag(text: string): { tag: string; start: number; end: number } | null {
  const masked = text.replace(/<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!DOCTYPE[^>]*>/gi, (m) => m.replace(/[^\n]/g, " "));
  const m = masked.match(/<svg\b(?:"[^"]*"|'[^']*'|[^>"'])*>/i);
  if (!m || m.index === undefined) return null;
  const end = m.index + m[0].length;
  return { tag: text.slice(m.index, end), start: m.index, end };
}

/** Intrinsic pixel size of an SVG: root width/height, else the viewBox extent,
 *  else a default. Each axis is clamped to [1, MAX_DIM]. Pure + deterministic. */
export function svgIntrinsicSize(text: string, def = DEF_DIM): { w: number; h: number } {
  const root = findRootTag(text)?.tag ?? "";
  const attr = (n: string) => root.match(new RegExp(`\\b${n}\\s*=\\s*["']([^"']*)["']`, "i"))?.[1];
  let w = len(attr("width"));
  let h = len(attr("height"));
  if (w == null || h == null) {
    const vb = attr("viewBox")?.split(/[\s,]+/).map(Number).filter((n) => Number.isFinite(n));
    if (vb && vb.length === 4 && vb[2] > 0 && vb[3] > 0) {
      w = w ?? vb[2];
      h = h ?? vb[3];
    }
  }
  const clamp = (v: number | null) => Math.max(1, Math.min(MAX_DIM, Math.round(v != null && v > 0 ? v : def)));
  return { w: clamp(w), h: clamp(h) };
}

/** SVG markup with explicit root width/height, so the browser rasterizes at full
 *  resolution (a viewBox-only SVG otherwise decodes at a tiny default size). */
export function withExplicitSize(text: string, w: number, h: number): string {
  const root = findRootTag(text); // (#95) same tag svgIntrinsicSize measured
  if (!root) return text;
  const attrs = root.tag.slice(4, -1); // between "<svg" and ">"
  const stripped = attrs.replace(/\s(width|height)\s*=\s*["'][^"']*["']/gi, "");
  return `${text.slice(0, root.start)}<svg${stripped} width="${w}" height="${h}">${text.slice(root.end)}`;
}
