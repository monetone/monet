// Camera Raw split Before/After view (ACR/Lightroom's Left-Right and Top-Bottom
// comparison modes). Vision already peeks the whole before-image while a button
// is held; this composites BEFORE and AFTER into a single frame split down the
// middle so you compare in place. Preview-only — it never touches the recipe or
// baked pixels. Engine-free + pure so it unit-tests in node.

export type SplitMode = "off" | "lr" | "tb";

/** Composite `before` and `after` (both w×h RGBA) into one frame: for "lr" the
 *  left half is BEFORE and the right half AFTER; for "tb" the top is BEFORE and
 *  the bottom AFTER. */
export function splitBeforeAfter(
  before: Uint8ClampedArray | Uint8Array,
  after: Uint8ClampedArray | Uint8Array,
  w: number,
  h: number,
  mode: "lr" | "tb",
): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  const midX = w / 2;
  const midY = h / 2;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const useBefore = mode === "lr" ? x < midX : y < midY;
      const src = useBefore ? before : after;
      out[i] = src[i];
      out[i + 1] = src[i + 1];
      out[i + 2] = src[i + 2];
      out[i + 3] = src[i + 3];
    }
  }
  return out;
}

/** Camera Raw's on-screen frame: split Before/After when asked, then run the
 *  document-profile → display transform exactly once. Clipping and spot
 *  overlays paint after this, so their warning colours stay uncompensated. */
export function presentCameraRawFrame(
  copy: ArrayLike<number>,
  before: ArrayLike<number> | null | undefined,
  after: ArrayLike<number> | null | undefined,
  w: number,
  h: number,
  split: SplitMode,
  compensate: (px: Uint8ClampedArray) => Uint8ClampedArray,
): Uint8ClampedArray {
  const frame = split !== "off" && before && after && before.length === after.length
    ? splitBeforeAfter(before as Uint8Array, after as Uint8Array, w, h, split)
    : (copy instanceof Uint8ClampedArray ? copy : new Uint8ClampedArray(copy));
  return compensate(frame instanceof Uint8ClampedArray ? frame : new Uint8ClampedArray(frame));
}
