// avif.ts — open AVIF images. Photoshop opens AVIF; Monet Vision could only
// *export* it (Rust `image` can't decode AVIF in wasm — the same reason AVIF
// export goes through @jsquash). So decode in TS via @jsquash and hand the
// engine a PNG it already knows how to open. The wasm-bound decoder lives in
// ./avifDecoder (dynamically imported) so these pure helpers stay unit-testable.

import { crc32 } from "./imageProcessorIo";

export const AVIF_RE = /\.avif$/i;

const PNG_SIG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** One PNG chunk: length, 4-char type, data, CRC over type+data. */
function chunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  dv.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

/** Encode decoded straight-alpha RGBA (an ImageData) to 8-bit RGBA PNG bytes.
 *  Deliberately NOT via a 2D canvas (#63): putImageData stores into the
 *  premultiplied canvas backing store and toBlob unpremultiplies again, which
 *  quantizes the colour of every pixel with alpha < 255 (r=200 at a=3 comes back
 *  as 170) — visible banding on soft alpha edges in TGA/HEIC/AVIF imports, baked
 *  in before the engine ever sees the pixels. Filter 0 rows + zlib via the
 *  platform's CompressionStream, the same deflate seam pdfExport.ts uses. */
export async function imageDataToPng(img: ImageData): Promise<Uint8Array> {
  const { width: w, height: h } = img;
  if (w <= 0 || h <= 0) throw new Error("PNG encode failed: empty image");
  const stride = w * 4;
  const raw = new Uint8Array((stride + 1) * h);
  for (let y = 0; y < h; y++) {
    raw.set(img.data.subarray(y * stride, y * stride + stride), y * (stride + 1) + 1); // [0] = filter None
  }
  const idat = new Uint8Array(await new Response(
    new Blob([raw as BlobPart]).stream().pipeThrough(new CompressionStream("deflate")),
  ).arrayBuffer());
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // colour type 6 = RGBA
  const parts = [PNG_SIG, chunk("IHDR", ihdr), chunk("IDAT", idat), chunk("IEND", new Uint8Array(0))];
  const png = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) { png.set(p, at); at += p.length; }
  return png;
}

/** Decode AVIF file bytes to PNG bytes (via @jsquash/avif → RGBA → PNG). */
export async function avifToPng(bytes: Uint8Array): Promise<Uint8Array> {
  const { decodeAvif } = await import("./avifDecoder");
  // @jsquash wants a standalone ArrayBuffer of exactly the file bytes.
  const ab = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
  return imageDataToPng(await decodeAvif(ab));
}
