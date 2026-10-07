import { describe, it, expect } from "vitest";
import { decodePcx, encodePcx, PCX_RE } from "./pcx";

/** Build a PCX header with the given fields (rest zero). */
function header(opts: { enc?: number; bpp?: number; w: number; h: number; nplanes: number; bytesPerLine: number }): Uint8Array {
  const b = new Uint8Array(128);
  b[0] = 0x0a; b[1] = 5; b[2] = opts.enc ?? 1; b[3] = opts.bpp ?? 8;
  b[8] = (opts.w - 1) & 0xff; b[9] = ((opts.w - 1) >> 8) & 0xff;
  b[10] = (opts.h - 1) & 0xff; b[11] = ((opts.h - 1) >> 8) & 0xff;
  b[65] = opts.nplanes;
  b[66] = opts.bytesPerLine & 0xff; b[67] = (opts.bytesPerLine >> 8) & 0xff;
  return b;
}
function concat(...parts: (Uint8Array | number[])[]): Uint8Array {
  const arrs = parts.map((p) => (p instanceof Uint8Array ? p : Uint8Array.from(p)));
  const out = new Uint8Array(arrs.reduce((n, a) => n + a.length, 0));
  let o = 0; for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

describe("PCX_RE", () => {
  it("matches .pcx case-insensitively", () => {
    expect(PCX_RE.test("art.pcx")).toBe(true);
    expect(PCX_RE.test("ART.PCX")).toBe(true);
    expect(PCX_RE.test("art.png")).toBe(false);
  });
});

describe("decodePcx", () => {
  it("decodes an uncompressed 24-bit RGB image (planar → packed)", () => {
    // 2×1, bytesPerLine 2, planes: R=[10,40] G=[20,50] B=[30,60]
    const f = concat(header({ enc: 0, w: 2, h: 1, nplanes: 3, bytesPerLine: 2 }), [10, 40, 20, 50, 30, 60]);
    const d = decodePcx(f)!;
    expect(d.width).toBe(2); expect(d.height).toBe(1);
    expect(Array.from(d.data)).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
  });

  it("decodes an RLE run packet", () => {
    // 4×1 grayscale-ish via 3 planes each bytesPerLine 4; use RLE 0xC4 (run 4).
    // R plane: run of 4 × 100; G: run 4 × 150; B: run 4 × 200.
    const f = concat(header({ w: 4, h: 1, nplanes: 3, bytesPerLine: 4 }), [0xc4, 100, 0xc4, 150, 0xc4, 200]);
    const d = decodePcx(f)!;
    expect(Array.from(d.data.slice(0, 4))).toEqual([100, 150, 200, 255]);
    expect(Array.from(d.data.slice(12, 16))).toEqual([100, 150, 200, 255]); // last px too
  });

  it("decodes 8-bit indexed with a trailing VGA palette", () => {
    // 2×1, 1 plane, indices [0,1]; palette entry 0 = red, 1 = green.
    const pal = new Uint8Array(768); pal[0] = 255; pal[3 + 1] = 255; // idx0=(255,0,0), idx1=(0,255,0)
    const f = concat(header({ enc: 0, w: 2, h: 1, nplanes: 1, bytesPerLine: 2 }), [0, 1], [0x0c], pal);
    const d = decodePcx(f)!;
    expect(Array.from(d.data)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it("falls back to grayscale for indexed with no trailing palette", () => {
    const f = concat(header({ enc: 0, w: 2, h: 1, nplanes: 1, bytesPerLine: 2 }), [64, 200]);
    const d = decodePcx(f)!;
    expect(Array.from(d.data)).toEqual([64, 64, 64, 255, 200, 200, 200, 255]);
  });

  it("ignores the even-padding byte in bytesPerLine", () => {
    // width 1 but bytesPerLine 2 (padded); only column 0 is used per plane.
    const f = concat(header({ enc: 0, w: 1, h: 1, nplanes: 3, bytesPerLine: 2 }), [11, 0, 22, 0, 33, 0]);
    const d = decodePcx(f)!;
    expect(Array.from(d.data)).toEqual([11, 22, 33, 255]);
  });

  it("rejects bad manufacturer, sub-8-bit depth, and truncation", () => {
    const bad = header({ w: 1, h: 1, nplanes: 3, bytesPerLine: 1 }); bad[0] = 0;
    expect(decodePcx(bad)).toBeNull();
    expect(decodePcx(header({ bpp: 4, w: 1, h: 1, nplanes: 1, bytesPerLine: 1 }))).toBeNull();
    expect(decodePcx(new Uint8Array(50))).toBeNull(); // shorter than a header
    expect(decodePcx(concat(header({ enc: 0, w: 4, h: 4, nplanes: 3, bytesPerLine: 4 }), [1, 2, 3]))).toBeNull(); // truncated raw
  });

  it("rejects header dimensions it could never fill, without allocating (#92)", () => {
    // Pre-fix, `rows` was sized from the header alone: these bare 128-byte
    // headers asked for 17 GB / 8 GB / 192 MB before reading a byte. Refuse any
    // allocation over 1 MB while decoding them, so the guard has to run first.
    const files = [
      header({ w: 4, h: 65536, nplanes: 4, bytesPerLine: 65535 }),  // over MAX_DIM
      header({ w: 4, h: 32767, nplanes: 4, bytesPerLine: 65535 }),  // dims fine, file can't fill it
      header({ w: 8000, h: 8000, nplanes: 3, bytesPerLine: 8000 }), // RLE can't expand 0 bytes
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
      for (const f of files) expect(decodePcx(f)).toBeNull();
    } finally {
      g.Uint8Array = Real;
    }
  });
});

describe("encodePcx → decodePcx round-trip", () => {
  it("round-trips RGB (alpha dropped to opaque), header sane", () => {
    const w = 5, h = 3; // odd width exercises the even-bytesPerLine padding
    const rgba = new Uint8Array(w * h * 4);
    for (let i = 0; i < w * h; i++) { rgba[i * 4] = (i * 11) & 255; rgba[i * 4 + 1] = (i * 7 + 30) & 255; rgba[i * 4 + 2] = (i * 3) & 255; rgba[i * 4 + 3] = 100; }
    const pcx = encodePcx(rgba, w, h);
    expect(pcx[0]).toBe(0x0a); expect(pcx[2]).toBe(1); expect(pcx[3]).toBe(8); expect(pcx[65]).toBe(3);
    const d = decodePcx(pcx)!;
    expect(d.width).toBe(w); expect(d.height).toBe(h);
    for (let i = 0; i < w * h; i++) {
      expect([d.data[i * 4], d.data[i * 4 + 1], d.data[i * 4 + 2], d.data[i * 4 + 3]])
        .toEqual([rgba[i * 4], rgba[i * 4 + 1], rgba[i * 4 + 2], 255]);
    }
  });

  it("RLE shrinks a run-heavy (solid) image below its raw size", () => {
    const solid = new Uint8Array(64 * 64 * 4).fill(180);
    expect(encodePcx(solid, 64, 64).length).toBeLessThan(128 + 64 * 64 * 3);
  });
});
