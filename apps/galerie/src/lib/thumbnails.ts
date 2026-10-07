// thumbnails — decode → downscale → object URL, via the shared wasm engine.
// In-memory only for now; the native on-disk preview cache (§3.4) supersedes
// this later (task #8). The pure cache/fit primitives live in thumbnailCache.ts.

import { decodeImage } from "../engine";
import { fitDimensions } from "./thumbnailCache";

export { fitDimensions, ThumbnailCache } from "./thumbnailCache";

/**
 * Decode `bytes` via the shared engine and render a downscaled thumbnail to a
 * JPEG object URL. Caller owns the URL (revoke on eviction — see ThumbnailCache).
 */
export async function generateThumbnail(
  bytes: Uint8Array,
  raw: boolean,
  maxEdge: number,
  sourcePath?: string,
  recipeJson?: string,
  scaleNumerator = 1,
  scaleDenominator = 1,
): Promise<{
  url: string;
  width: number;
  height: number;
  encoded: Uint8Array;
  decodedRaw?: Awaited<ReturnType<typeof decodeImage>>["decodedRaw"];
}> {
  const img = await decodeImage(
    bytes,
    raw,
    sourcePath,
    maxEdge,
    recipeJson,
    scaleNumerator,
    scaleDenominator,
  );
  const { width, height } = fitDimensions(img.width, img.height, maxEdge);

  const src = new OffscreenCanvas(img.width, img.height);
  src.getContext("2d")!.putImageData(
    new ImageData(new Uint8ClampedArray(img.rgba), img.width, img.height),
    0,
    0,
  );

  const dst = new OffscreenCanvas(width, height);
  const dctx = dst.getContext("2d")!;
  dctx.imageSmoothingQuality = "high";
  dctx.drawImage(src, 0, 0, width, height);

  // JPEG, not PNG: previews are lossy in Lightroom too, and PNG is 5-10× the
  // bytes plus slower deflate/inflate on the UI thread. Photos are opaque so
  // dropping alpha is free. ponytail: fixed quality ≈ LR "High"; add a Preview
  // Quality setting if users ask.
  const blob = await dst.convertToBlob({ type: "image/jpeg", quality: 0.85 });
  // The encoded JPEG bytes feed the on-disk preview cache (write-through); the URL
  // is made from the same blob so no double-encode.
  const encoded = new Uint8Array(await blob.arrayBuffer());
  return { url: URL.createObjectURL(blob), width, height, encoded, decodedRaw: img.decodedRaw };
}

/** Object URL for already-encoded preview bytes (a native cache hit). */
export function urlFromEncoded(encoded: Uint8Array): string {
  // Cast past the TS-5.7 Uint8Array<ArrayBufferLike> vs BlobPart variance: these
  // bytes are always ArrayBuffer-backed (fresh Uint8Array from the IPC array).
  return URL.createObjectURL(new Blob([encoded as Uint8Array<ArrayBuffer>], { type: "image/jpeg" }));
}
