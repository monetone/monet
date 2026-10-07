import { describe, it, expect } from "vitest";
import { buildPDF } from "./pdf";

describe("buildPDF", () => {
  it("produces a structurally valid PDF whose xref offsets point to their objects", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG marker bytes
    const pdf = buildPDF([{ jpeg, w: 100, h: 80 }, { jpeg, w: 50, h: 50 }]);
    const s = Array.from(pdf).map((b) => String.fromCharCode(b)).join("");
    expect(s.startsWith("%PDF-1.4")).toBe(true);
    expect(s.includes("%%EOF")).toBe(true);
    // 2 pages → 2 + 2*3 = 8 objects
    const m = /startxref\n(\d+)/.exec(s);
    expect(m).toBeTruthy();
    const xrefStart = Number(m![1]);
    expect(s.slice(xrefStart, xrefStart + 4)).toBe("xref");
    // parse the xref entries (skip the free obj 0) and verify each offset lands on "<n> 0 obj"
    const after = s.slice(xrefStart);
    const entries = after.match(/(\d{10}) 00000 n /g) || [];
    expect(entries.length).toBe(8);
    entries.forEach((e, i) => {
      const off = Number(e.slice(0, 10));
      expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
    });
  });
});
