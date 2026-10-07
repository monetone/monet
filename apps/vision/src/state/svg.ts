// svg.ts — open/place SVG. Photoshop opens SVG (rasterizing it); Monet Vision
// could only *export* it (exportPathsSVG/copyLayerSVG), and Rust's `image` can't
// decode SVG. SVG is vector, so rasterize it in the browser (an <img> is loaded
// in "secure static mode" — no scripts, no external fetches, so the canvas can't
// be tainted or run active content) and hand the engine a PNG it already opens.
// The pure size math now lives in @monet-ui/monet-imageio (svgRaster); the
// browser rasterization below stays app-side (needs the DOM). Mirrors [[avif]].
import { SVG_RE, svgIntrinsicSize, withExplicitSize } from "@monet-ui/monet-imageio";
export { SVG_RE, svgIntrinsicSize, withExplicitSize };

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = src; });
}

/** Rasterize SVG file bytes to PNG bytes at the SVG's intrinsic pixel size. */
export async function svgToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const text = new TextDecoder().decode(bytes);
  const { w, h } = svgIntrinsicSize(text);
  const url = URL.createObjectURL(new Blob([withExplicitSize(text, w, h)], { type: "image/svg+xml" }));
  try {
    const img = await loadImage(url);
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const cx = c.getContext("2d");
    if (!cx) throw new Error("2D canvas unavailable");
    cx.drawImage(img, 0, 0, w, h);
    const blob = await new Promise<Blob | null>((res) => c.toBlob(res, "image/png"));
    if (!blob) throw new Error("PNG encode failed");
    return new Uint8Array(await blob.arrayBuffer());
  } finally { URL.revokeObjectURL(url); }
}
