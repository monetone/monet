// Camera Raw "Visualize Spots" — a deterministic, preview-only dust-reveal view
// (ACR's checkbox at the bottom of the Camera Raw window). Sensor/lens dust and
// blemishes are low-contrast blobs that vanish against busy detail; rendering a
// high-contrast luminance-edge map (Sobel, white edges on a black field, gained
// by a Threshold) makes their rings pop so you can place healing spots. This is
// a DISPLAY transform on the develop preview only — it never touches the recipe
// or the baked pixels. Engine-free + pure so it unit-tests in node.

/** Transform an RGBA develop preview into the high-contrast spot-visualization
 *  view. `threshold` (0..1) raises edge sensitivity. Alpha is forced opaque. */
export function visualizeSpots(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  threshold: number,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const gain = 3 + Math.max(0, Math.min(1, threshold)) * 40;
  const lum = (x: number, y: number): number => {
    const xx = x < 0 ? 0 : x >= w ? w - 1 : x;
    const yy = y < 0 ? 0 : y >= h ? h - 1 : y;
    const i = (yy * w + xx) * 4;
    return 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
  };
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const gx =
        lum(x + 1, y - 1) + 2 * lum(x + 1, y) + lum(x + 1, y + 1) -
        (lum(x - 1, y - 1) + 2 * lum(x - 1, y) + lum(x - 1, y + 1));
      const gy =
        lum(x - 1, y + 1) + 2 * lum(x, y + 1) + lum(x + 1, y + 1) -
        (lum(x - 1, y - 1) + 2 * lum(x, y - 1) + lum(x + 1, y - 1));
      // Max Sobel magnitude for 8-bit luma ≈ 4·255 = 1020; normalize, then gain.
      const e = Math.min(1, (Math.hypot(gx, gy) / 1020) * gain);
      const v = Math.round(e * 255);
      const i = (y * w + x) * 4;
      out[i] = v;
      out[i + 1] = v;
      out[i + 2] = v;
      out[i + 3] = 255;
    }
  }
  return out;
}
