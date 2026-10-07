// One-shot zlib (RFC 1950) / deflate (RFC 1951) decoder. PNG stores its `iCCP`
// profile zlib-compressed; a browser has no synchronous inflate and monet-color
// carries no dependencies, so this is the decoder a library would have brought
// (puff-style canonical Huffman, bit-serial — plenty for a profile of a few MB).
// Returns null on any malformed input rather than throwing: a broken chunk is
// "no profile", not a failed open.

const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
const CODE_LENGTH_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

interface Huffman { count: Uint16Array; symbol: Uint16Array }

/** Canonical Huffman decoder from per-symbol code lengths (0 = unused). */
function huffman(lengths: ArrayLike<number>, n: number): Huffman {
  const count = new Uint16Array(16);
  for (let i = 0; i < n; i++) count[lengths[i] ?? 0]++;
  count[0] = 0;
  const offsets = new Uint16Array(16);
  for (let len = 1; len < 15; len++) offsets[len + 1] = offsets[len] + count[len];
  const symbol = new Uint16Array(n);
  for (let i = 0; i < n; i++) if (lengths[i]) symbol[offsets[lengths[i] as number]++] = i;
  return { count, symbol };
}

const FIXED_LITERAL = huffman(Array.from({ length: 288 }, (_, i) => (i < 144 ? 8 : i < 256 ? 9 : i < 280 ? 7 : 8)), 288);
const FIXED_DISTANCE = huffman(new Array<number>(30).fill(5), 30);

/** Ceiling on what one stream may inflate to. An embedded ICC profile is at
 *  most a few hundred KB and the caller caps the parsed profile at 10 MB — but
 *  that cap only applies AFTER inflation, so without a limit here a crafted
 *  `iCCP` chunk a few KB long could ask for gigabytes before anyone looks. */
export const MAX_INFLATED_BYTES = 32 * 1024 * 1024;

/** Inflate a zlib stream. `null` for a bad header, truncated or corrupt data. */
export function inflateZlib(data: Uint8Array): Uint8Array | null {
  const cmf = data[0] ?? 0;
  const flg = data[1] ?? 0;
  if (data.length < 6 || (cmf & 0x0f) !== 8 || ((cmf << 8) | flg) % 31 !== 0 || (flg & 0x20) !== 0) return null;
  // ponytail: the Adler-32 trailer is not checked — the ICC header/size checks
  // downstream catch a corrupt profile; verify it here if a non-ICC caller appears.
  return inflateRaw(data.subarray(2, data.length - 4));
}

/** Inflate raw deflate blocks. `null` on malformed input. */
export function inflateRaw(src: Uint8Array): Uint8Array | null {
  let out = new Uint8Array(Math.max(1024, src.length * 4));
  let outLen = 0;
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;

  const bits = (n: number): number => {
    while (bitCnt < n) {
      if (pos >= src.length) throw new RangeError("deflate: truncated");
      bitBuf |= (src[pos++] as number) << bitCnt;
      bitCnt += 8;
    }
    const v = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return v;
  };
  const decode = (h: Huffman): number => {
    let code = 0, first = 0, index = 0;
    for (let len = 1; len < 16; len++) {
      code |= bits(1);
      const count = h.count[len] as number;
      if (code - count < first) return h.symbol[index + (code - first)] as number;
      index += count;
      first = (first + count) << 1;
      code <<= 1;
    }
    throw new RangeError("deflate: bad code");
  };
  const reserve = (n: number) => {
    if (outLen + n <= out.length) return;
    if (outLen + n > MAX_INFLATED_BYTES) throw new RangeError("deflate: output too large");
    const grown = new Uint8Array(Math.min(MAX_INFLATED_BYTES, Math.max(out.length * 2, outLen + n)));
    grown.set(out.subarray(0, outLen));
    out = grown;
  };
  const codes = (literal: Huffman, distance: Huffman) => {
    for (;;) {
      const sym = decode(literal);
      if (sym < 256) { reserve(1); out[outLen++] = sym; continue; }
      if (sym === 256) return;
      const li = sym - 257;
      if (li >= LEN_BASE.length) throw new RangeError("deflate: bad length");
      const len = (LEN_BASE[li] as number) + bits(LEN_EXTRA[li] as number);
      const di = decode(distance);
      if (di >= DIST_BASE.length) throw new RangeError("deflate: bad distance");
      const dist = (DIST_BASE[di] as number) + bits(DIST_EXTRA[di] as number);
      if (dist > outLen) throw new RangeError("deflate: distance too far");
      reserve(len);
      for (let i = 0; i < len; i++, outLen++) out[outLen] = out[outLen - dist] as number; // byte-wise: overlapping copies repeat
    }
  };

  try {
    let last = 0;
    do {
      last = bits(1);
      const type = bits(2);
      if (type === 0) {
        bitBuf = 0; bitCnt = 0; // stored blocks start on a byte boundary
        if (pos + 4 > src.length) return null;
        const len = (src[pos] as number) | ((src[pos + 1] as number) << 8);
        const nlen = (src[pos + 2] as number) | ((src[pos + 3] as number) << 8);
        pos += 4;
        if ((len ^ 0xffff) !== nlen || pos + len > src.length) return null;
        reserve(len);
        out.set(src.subarray(pos, pos + len), outLen);
        outLen += len; pos += len;
      } else if (type === 1) {
        codes(FIXED_LITERAL, FIXED_DISTANCE);
      } else if (type === 2) {
        const nlen = bits(5) + 257, ndist = bits(5) + 1, ncode = bits(4) + 4;
        if (nlen > 286 || ndist > 30) return null;
        const lengths = new Uint8Array(320);
        for (let i = 0; i < ncode; i++) lengths[CODE_LENGTH_ORDER[i] as number] = bits(3);
        const lencode = huffman(lengths, 19);
        for (let i = 0; i < nlen + ndist;) {
          const sym = decode(lencode);
          if (sym < 16) { lengths[i++] = sym; continue; }
          let repeat = 0, value = 0;
          if (sym === 16) { if (i === 0) return null; value = lengths[i - 1] as number; repeat = 3 + bits(2); }
          else if (sym === 17) repeat = 3 + bits(3);
          else repeat = 11 + bits(7);
          if (i + repeat > nlen + ndist) return null;
          while (repeat--) lengths[i++] = value;
        }
        if (lengths[256] === 0) return null; // no end-of-block code
        codes(huffman(lengths, nlen), huffman(lengths.subarray(nlen), ndist));
      } else {
        return null;
      }
    } while (!last);
  } catch (e) {
    if (e instanceof RangeError) return null;
    throw e;
  }
  return out.slice(0, outLen);
}
