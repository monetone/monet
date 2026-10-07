import { describe, expect, it } from "vitest";
import { MAX_INFLATED_BYTES, inflateRaw, inflateZlib } from "./inflate";

/** Text-like data with long repeats (dynamic Huffman + far back-references)
 *  followed by a pseudo-random tail (near-literal). */
function sample(n: number): Uint8Array {
  const out = new Uint8Array(n);
  let seed = 7;
  for (let i = 0; i < n; i++) {
    if (i < n / 2) out[i] = "the quick brown fox jumps over the lazy dog ".charCodeAt(i % 44);
    else { seed = (seed * 1103515245 + 12345) & 0x7fffffff; out[i] = seed >>> 16; }
  }
  return out;
}

/** The platform's own deflate (CompressionStream), so no node:zlib types are needed. */
async function compress(data: Uint8Array, format: CompressionFormat): Promise<Uint8Array> {
  const stream = new Blob([data.slice()]).stream().pipeThrough(new CompressionStream(format));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** A hand-built zlib stream of one stored (uncompressed) block — the block type
 *  CompressionStream cannot be made to emit on demand. */
function storedZlib(data: Uint8Array): Uint8Array {
  const len = data.length;
  return new Uint8Array([0x78, 0x01, 1, len & 255, len >>> 8, ~len & 255, (~len >>> 8) & 255, ...data, 0, 0, 0, 0]);
}

describe("inflate", () => {
  it("round-trips zlib and raw deflate through dynamic Huffman blocks", async () => {
    const data = sample(70_000);
    expect(inflateZlib(await compress(data, "deflate"))).toEqual(data);
    expect(inflateRaw(await compress(data, "deflate-raw"))).toEqual(data);
    expect(inflateZlib(await compress(new Uint8Array(0), "deflate"))).toEqual(new Uint8Array(0));
  });

  it("decodes fixed-Huffman and stored blocks", () => {
    // zlib.compress(b"a"): one fixed-Huffman block.
    expect(inflateZlib(new Uint8Array([0x78, 0x9c, 0x4b, 0x04, 0x00, 0x00, 0x62, 0x00, 0x62]))).toEqual(new Uint8Array([0x61]));
    const data = sample(300);
    expect(inflateZlib(storedZlib(data))).toEqual(data);
  });

  it("returns null instead of throwing on bad input", async () => {
    const good = await compress(sample(3000), "deflate");
    expect(inflateZlib(good.subarray(0, 40))).toBeNull(); // truncated
    expect(inflateZlib(new Uint8Array([0x78, 0x9c, 7, 0, 0, 0, 0, 0]))).toBeNull(); // reserved block type
    expect(inflateZlib(new Uint8Array([1, 2, 3, 4, 5, 6]))).toBeNull(); // not zlib
  });

  // A decompression bomb: a few KB of deflate can ask for gigabytes, and the
  // caller's 10 MB profile cap only applies after inflation (#439 follow-up).
  it("refuses a stream that would inflate past the ceiling", async () => {
    const huge = new Uint8Array(MAX_INFLATED_BYTES + 1024); // all zeroes → compresses tiny
    const bomb = await compress(huge, "deflate");
    expect(bomb.length).toBeLessThan(200_000);
    expect(inflateZlib(bomb)).toBeNull();
    // …and a stream just under it still inflates.
    const ok = await compress(new Uint8Array(1024), "deflate");
    expect(inflateZlib(ok)).toEqual(new Uint8Array(1024));
  });
});
