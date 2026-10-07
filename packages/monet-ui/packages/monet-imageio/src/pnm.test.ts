import { describe, it, expect } from "vitest";
import { decodePnm, encodePnm, PNM_RE } from "./pnm";

const enc = (s: string) => new TextEncoder().encode(s);
/** ASCII header + binary body → a P4/P5/P6 file. */
function bin(header: string, body: number[]): Uint8Array {
  const h = enc(header);
  const out = new Uint8Array(h.length + body.length);
  out.set(h, 0); out.set(body, h.length);
  return out;
}

describe("PNM_RE", () => {
  it("matches the Netpbm extensions case-insensitively", () => {
    for (const e of ["a.pnm", "a.ppm", "a.pgm", "a.pbm", "A.PPM"]) expect(PNM_RE.test(e)).toBe(true);
    expect(PNM_RE.test("a.png")).toBe(false);
  });
});

describe("decodePnm — ASCII", () => {
  it("decodes P3 RGB", () => {
    const d = decodePnm(enc("P3\n2 1\n255\n255 0 0  0 255 0\n"))!;
    expect(d.width).toBe(2); expect(d.height).toBe(1);
    expect(Array.from(d.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });
  it("decodes P2 grayscale and scales by maxval", () => {
    const d = decodePnm(enc("P2\n2 1\n15\n0 15\n"))!; // maxval 15 → 0 and 255
    expect(Array.from(d.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255]);
  });
  it("decodes P1 bitmap (1 = black), ignoring whitespace", () => {
    const d = decodePnm(enc("P1\n3 1\n1 0 1\n"))!;
    expect(Array.from(d.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255]);
  });
  it("clamps out-of-range ASCII samples instead of wrapping (#226)", () => {
    // maxval 255 used to short-circuit the clamp, so the Uint8Array wrapped:
    // 300 → 44 (near-black instead of white) and −5 → 251 (near-white).
    expect(Array.from(decodePnm(enc("P3\n1 1\n255\n300 0 0\n"))!.data)).toEqual([255, 0, 0, 255]);
    expect(Array.from(decodePnm(enc("P2\n1 1\n255\n-5\n"))!.data)).toEqual([0, 0, 0, 255]);
  });
  it("skips header comments", () => {
    const d = decodePnm(enc("P3\n# a comment\n1 1\n# another\n255\n10 20 30\n"))!;
    expect(Array.from(d.data)).toEqual([10, 20, 30, 255]);
  });
});

describe("decodePnm — binary", () => {
  it("decodes P6 RGB", () => {
    const d = decodePnm(bin("P6\n2 1\n255\n", [1, 2, 3, 4, 5, 6]))!;
    expect(Array.from(d.data)).toEqual([1, 2, 3, 255, 4, 5, 6, 255]);
  });
  it("decodes P5 grayscale", () => {
    const d = decodePnm(bin("P5\n2 1\n255\n", [100, 200]))!;
    expect(Array.from(d.data)).toEqual([100, 100, 100, 255, 200, 200, 200, 255]);
  });
  it("decodes 16-bit P5 (big-endian, scaled to 8-bit)", () => {
    const d = decodePnm(bin("P5\n1 1\n65535\n", [0xff, 0xff]))!; // full white
    expect(Array.from(d.data)).toEqual([255, 255, 255, 255]);
  });
  it("decodes P4 packed bitmap (MSB first, 1 = black)", () => {
    // width 4 → 1 row byte; 0b1010_0000 → black,white,black,white
    const d = decodePnm(bin("P4\n4 1\n", [0b10100000]))!;
    expect(Array.from(d.data)).toEqual([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);
  });
});

describe("decodePnm — robustness", () => {
  it("returns null for bad magic, non-PNM, bad dims and truncation", () => {
    expect(decodePnm(enc("BM..."))).toBeNull();          // not 'P'
    expect(decodePnm(enc("P7\n1 1\n255\n"))).toBeNull();  // P7 (PAM) unsupported
    expect(decodePnm(enc("P6\n0 0\n255\n"))).toBeNull();  // zero dims
    expect(decodePnm(bin("P6\n4 4\n255\n", [1, 2, 3]))).toBeNull(); // claims 48 bytes, has 3
    expect(decodePnm(new Uint8Array([0x50]))).toBeNull(); // just 'P'
  });

  it("rejects hostile dimensions before allocating", () => {
    const Real = Uint8Array;
    const g = globalThis as unknown as { Uint8Array: unknown };
    g.Uint8Array = new Proxy(Real, {
      construct: (T, args: unknown[]) => {
        if (typeof args[0] === "number" && args[0] > 1 << 20) throw new RangeError("oversized allocation");
        return new (T as Uint8ArrayConstructor)(...(args as [number]));
      },
    });
    try {
      expect(decodePnm(enc("P6\n20000 20000\n255\n"))).toBeNull();
    } finally {
      g.Uint8Array = Real;
    }
  });
});

describe("encodePnm → decodePnm round-trip", () => {
  it("round-trips RGB (alpha dropped to opaque)", () => {
    const w = 3, h = 2;
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = i * 20; rgba[i * 4 + 1] = 255 - i * 10; rgba[i * 4 + 2] = i * 5; rgba[i * 4 + 3] = 128; }
    const p6 = encodePnm(rgba, w, h);
    expect(p6[0]).toBe(0x50); expect(p6[1]).toBe(0x36); // "P6"
    const d = decodePnm(p6)!;
    expect(d.width).toBe(w); expect(d.height).toBe(h);
    for (let i = 0; i < w * h; i++) {
      expect([d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2], d.data[i * 4 + 3]])
        .toEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], 255]); // RGB kept, alpha → 255
    }
  });
});
