import { describe, it, expect } from "vitest";
import { decodeTga, encodeTga, TGA_RE } from "./tga";

/** Assemble a raw TGA (header + body) for decoder tests. */
function mkTga(type: number, w: number, h: number, depth: number, descriptor: number, body: number[]): Uint8Array {
  const b = new Uint8Array(18 + body.length);
  b[2] = type;
  b[12] = w & 0xff; b[13] = (w >> 8) & 0xff;
  b[14] = h & 0xff; b[15] = (h >> 8) & 0xff;
  b[16] = depth; b[17] = descriptor;
  b.set(body, 18);
  return b;
}

describe("TGA_RE", () => {
  it("matches .tga case-insensitively", () => {
    expect(TGA_RE.test("tex.tga")).toBe(true);
    expect(TGA_RE.test("TEX.TGA")).toBe(true);
    expect(TGA_RE.test("tex.png")).toBe(false);
  });
});

describe("decodeTga", () => {
  it("decodes uncompressed 24-bit BGR (alpha filled to 255)", () => {
    const t = mkTga(2, 2, 1, 24, 0x20, [10, 20, 30, /* px0 BGR */ 1, 2, 3 /* px1 BGR */]);
    const d = decodeTga(t)!;
    expect(d.width).toBe(2); expect(d.height).toBe(1);
    expect(Array.from(d.data)).toEqual([30, 20, 10, 255, 3, 2, 1, 255]);
  });

  it("decodes uncompressed 8-bit grayscale", () => {
    const d = decodeTga(mkTga(3, 2, 1, 8, 0x20, [100, 200]))!;
    expect(Array.from(d.data)).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });

  it("flips a bottom-to-top image (origin bit clear)", () => {
    // 1×2, stored bottom row first: A then B → top-to-bottom output is B, A.
    const t = mkTga(2, 1, 2, 32, 0x00, [10, 20, 30, 40, /* A BGRA */ 50, 60, 70, 80 /* B BGRA */]);
    const d = decodeTga(t)!;
    expect(Array.from(d.data)).toEqual([70, 60, 50, 80, /* B rgba */ 30, 20, 10, 40 /* A rgba */]);
  });

  it("decodes an RLE run packet (grayscale)", () => {
    // 0x83 = run of 4, value 128
    const d = decodeTga(mkTga(11, 4, 1, 8, 0x20, [0x83, 128]))!;
    expect(Array.from(d.data)).toEqual([128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255, 128, 128, 128, 255]);
  });

  it("decodes an RLE raw packet (grayscale)", () => {
    // 0x02 = raw run of 3: 10, 20, 30
    const d = decodeTga(mkTga(11, 3, 1, 8, 0x20, [0x02, 10, 20, 30]))!;
    expect(Array.from(d.data)).toEqual([10, 10, 10, 255, 20, 20, 20, 255, 30, 30, 30, 255]);
  });

  it("rejects short, colour-mapped and unsupported-depth input", () => {
    expect(decodeTga(new Uint8Array(10))).toBeNull();      // too short
    const cm = mkTga(1, 1, 1, 8, 0x20, [0]); cm[1] = 1;     // colorMapType = 1
    expect(decodeTga(cm)).toBeNull();
    expect(decodeTga(mkTga(2, 1, 1, 16, 0x20, [0, 0]))).toBeNull(); // 16-bit truecolor unsupported
    expect(decodeTga(mkTga(2, 0, 0, 32, 0x20, []))).toBeNull();     // zero dims
  });

  it("returns null when the pixel data is truncated", () => {
    expect(decodeTga(mkTga(2, 4, 4, 32, 0x20, [0, 0, 0, 0]))).toBeNull(); // claims 16 px, has 1
  });

  it("mirrors a right-to-left image (origin bit 0x10)", () => {
    // 2×1 top-to-bottom, stored right column first: A then B → output is B, A.
    const t = mkTga(2, 2, 1, 32, 0x30, [10, 20, 30, 40, /* A BGRA */ 50, 60, 70, 80 /* B BGRA */]);
    expect(Array.from(decodeTga(t)!.data)).toEqual([70, 60, 50, 80, /* B rgba */ 30, 20, 10, 40 /* A rgba */]);
    // Both origin bits at once: right-to-left AND bottom-to-top (2 columns × 2 rows).
    const both = mkTga(3, 2, 2, 8, 0x10, [1, 2, /* bottom row */ 3, 4 /* top row */]);
    expect(Array.from(decodeTga(both)!.data).filter((_, i) => i % 4 === 0)).toEqual([4, 3, 2, 1]);
  });

  it("rejects interleaved storage instead of decoding it scrambled", () => {
    expect(decodeTga(mkTga(2, 1, 1, 32, 0x60, [1, 2, 3, 4]))).toBeNull();
  });

  it("rejects header dimensions it could never fill, without allocating (#92)", () => {
    // Pre-fix, `out` was sized from the header alone: an 18-byte file declaring
    // 65535×65535 asked for a 17 GB buffer before reading a byte. Refuse any
    // allocation over 1 MB while decoding these, so the guard has to run first.
    const files = [
      mkTga(2, 65535, 65535, 32, 0x20, []),             // over MAX_DIM
      mkTga(2, 20000, 20000, 32, 0x20, []),             // over MAX_PIXELS
      mkTga(10, 4000, 4000, 32, 0x20, [0x80, 1, 2, 3]), // RLE can't reach 16M px
    ];
    const Real = Uint8Array;
    const g = globalThis as unknown as { Uint8Array: unknown };
    g.Uint8Array = new Proxy(Real, {
      construct: (T, args: unknown[]) => {
        if (typeof args[0] === "number" && args[0] > 1 << 20) throw new RangeError(`refused ${args[0]}-byte allocation`);
        return new (T as Uint8ArrayConstructor)(...(args as [number]));
      },
    });
    try {
      for (const f of files) expect(decodeTga(f)).toBeNull();
    } finally {
      g.Uint8Array = Real;
    }
  });
});

describe("encodeTga → decodeTga round-trip", () => {
  // 4×3 with runs (for RLE) and an alpha gradient.
  const w = 4, h = 3;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const run = Math.floor(i / 2); // pairs share a colour → exercises RLE runs
    rgba[i * 4] = (run * 40) & 255; rgba[i * 4 + 1] = 128; rgba[i * 4 + 2] = 255 - (run * 30) & 255; rgba[i * 4 + 3] = (i * 20) & 255;
  }

  it("round-trips uncompressed", () => {
    const enc = encodeTga(rgba, w, h);
    expect(enc[2]).toBe(2); expect(enc[16]).toBe(32); expect(enc[17]).toBe(0x28);
    const d = decodeTga(enc)!;
    expect(d.width).toBe(w); expect(d.height).toBe(h);
    expect(Array.from(d.data)).toEqual(Array.from(rgba));
  });

  it("round-trips RLE", () => {
    const enc = encodeTga(rgba, w, h, { rle: true });
    expect(enc[2]).toBe(10);
    const d = decodeTga(enc)!;
    expect(Array.from(d.data)).toEqual(Array.from(rgba));
  });

  it("RLE is no larger than raw for a run-heavy image", () => {
    const solid = new Uint8Array(64 * 64 * 4).fill(200);
    expect(encodeTga(solid, 64, 64, { rle: true }).length).toBeLessThan(encodeTga(solid, 64, 64).length);
  });
});
