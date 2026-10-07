// Camera Raw clipping overlay (ACR's highlight/shadow clipping warnings, the
// histogram-corner triangles / J key). Marks blown highlights RED and crushed
// shadows BLUE directly on the develop preview so you can see exactly where the
// tonal range clips. Preview-only — it never touches the recipe or baked pixels.
// Engine-free + pure so it unit-tests in node.

/** Overlay clipping warnings on an RGBA preview: highlight-clipped pixels (any
 *  channel ≥ 250) → red, shadow-clipped pixels (all channels ≤ 5) → blue. Copies
 *  the input; returns it unchanged when both flags are off. */
export function clippingOverlay(
  src: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  shadows: boolean,
  highlights: boolean,
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(src);
  if (!shadows && !highlights) return out;
  const n = w * h * 4;
  for (let i = 0; i < n; i += 4) {
    const r = out[i];
    const g = out[i + 1];
    const b = out[i + 2];
    if (highlights && (r >= 250 || g >= 250 || b >= 250)) {
      out[i] = 255; out[i + 1] = 0; out[i + 2] = 0; // blown highlight
    } else if (shadows && r <= 5 && g <= 5 && b <= 5) {
      out[i] = 0; out[i + 1] = 0; out[i + 2] = 255; // crushed shadow
    }
  }
  return out;
}
