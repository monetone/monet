// ─────────────────────────────────────────────────────────────
// io/import/inflate — zero-dependency DEFLATE via DecompressionStream
// ─────────────────────────────────────────────────────────────
// PDF /FlateDecode is zlib-wrapped (0x78 header) → "deflate"; bare DEFLATE →
// "deflate-raw". DecompressionStream does NOT apply PDF /Predictor — callers
// must run unpredict() on the result when DecodeParms specifies one.

/** Hard ceiling on a single inflate's output, to defuse decompression bombs
 *  (a few-KB stream can otherwise expand to many GB and OOM the renderer). */
export const MAX_INFLATED_BYTES = 64 * 1024 * 1024; // 64 MB

async function decompress(bytes: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const ds = new DecompressionStream(format);
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(ds).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > MAX_INFLATED_BYTES) {
      await reader.cancel();
      throw new Error(`inflate output exceeds ${MAX_INFLATED_BYTES} byte cap (possible decompression bomb)`);
    }
    chunks.push(value);
  }
  if (chunks.length === 1) return chunks[0];
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

export const inflate = (bytes: Uint8Array, raw = false): Promise<Uint8Array> =>
  decompress(bytes, raw ? "deflate-raw" : "deflate");

export const gunzip = (bytes: Uint8Array): Promise<Uint8Array> => decompress(bytes, "gzip");

/** Try zlib then raw (and vice-versa); returns empty on total failure. */
export async function inflateAuto(bytes: Uint8Array): Promise<Uint8Array> {
  const zlibFirst = bytes.length > 1 && bytes[0] === 0x78;
  try {
    return await inflate(bytes, !zlibFirst);
  } catch {
    try {
      return await inflate(bytes, zlibFirst);
    } catch {
      return new Uint8Array(0);
    }
  }
}

/** PNG/TIFF predictor reversal for FlateDecode streams (xref / images). */
export function unpredict(data: Uint8Array, predictor: number, colors: number, bpc: number, columns: number): Uint8Array {
  if (predictor < 2) return data;
  const bpp = Math.max(1, Math.ceil((colors * bpc) / 8));
  const rowLen = Math.ceil((colors * bpc * columns) / 8);
  if (rowLen <= 0) return data;

  if (predictor === 2) {
    // TIFF predictor 2 (byte-wise, 8bpc assumed)
    const out = data.slice();
    for (let r = 0; r * rowLen < out.length; r++) {
      const off = r * rowLen;
      for (let i = bpp; i < rowLen && off + i < out.length; i++) out[off + i] = (out[off + i] + out[off + i - bpp]) & 0xff;
    }
    return out;
  }

  // PNG predictors (each row prefixed with a filter-type byte)
  const stride = rowLen + 1;
  const rows = Math.floor(data.length / stride);
  const out = new Uint8Array(rows * rowLen);
  const prev = new Uint8Array(rowLen);
  for (let r = 0; r < rows; r++) {
    const ft = data[r * stride];
    const cur = data.subarray(r * stride + 1, r * stride + 1 + rowLen);
    const o = out.subarray(r * rowLen, r * rowLen + rowLen);
    for (let i = 0; i < rowLen; i++) {
      const a = i >= bpp ? o[i - bpp] : 0;
      const b = prev[i];
      const c = i >= bpp ? prev[i - bpp] : 0;
      let v = cur[i];
      switch (ft) {
        case 1: v += a; break;
        case 2: v += b; break;
        case 3: v += (a + b) >> 1; break;
        case 4: {
          const p = a + b - c;
          const pa = Math.abs(p - a);
          const pb = Math.abs(p - b);
          const pc = Math.abs(p - c);
          v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
          break;
        }
      }
      o[i] = v & 0xff;
    }
    out.set(o, r * rowLen);
    prev.set(o);
  }
  return out;
}
