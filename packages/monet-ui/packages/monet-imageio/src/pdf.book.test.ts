// Book-module PDF output: multi-cell pages, text runs, bleed/trim boxes, and
// the text metrics the layout depends on.
import { describe, expect, it } from "vitest";

import { buildPDF, buildPagesPDF, textWidth, wrapText, type PdfPageSpec } from "./pdf";

const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xd9]); // minimal JPEG marker bytes
const latin1 = (b: Uint8Array) => Array.from(b, (c) => String.fromCharCode(c)).join("");

/** Every xref entry must land exactly on its "<n> 0 obj" header. */
function assertXrefIsSound(pdf: Uint8Array, expectedObjects: number): string {
  const s = latin1(pdf);
  expect(s.startsWith("%PDF-1.4")).toBe(true);
  expect(s.endsWith("%%EOF\n")).toBe(true);
  const m = /startxref\n(\d+)/.exec(s);
  expect(m).toBeTruthy();
  expect(s.slice(Number(m![1]), Number(m![1]) + 4)).toBe("xref");
  const entries = s.slice(Number(m![1])).match(/(\d{10}) 00000 n /g) ?? [];
  expect(entries.length).toBe(expectedObjects);
  entries.forEach((e, i) => {
    const off = Number(e.slice(0, 10));
    expect(s.slice(off, off + `${i + 1} 0 obj`.length)).toBe(`${i + 1} 0 obj`);
  });
  return s;
}

describe("buildPagesPDF", () => {
  it("places every cell on one page, flipping top-left boxes into PDF space", () => {
    const page: PdfPageSpec = {
      w: 600,
      h: 400,
      images: [
        { jpeg: JPEG, w: 100, h: 80, box: { x: 10, y: 20, w: 200, h: 150 } },
        { jpeg: JPEG, w: 100, h: 80, box: { x: 300, y: 20, w: 200, h: 150 } },
      ],
    };
    // 1 catalog + 1 pages + 2 images + content + page = 6 objects, no fonts.
    const s = assertXrefIsSound(buildPagesPDF([page]), 6);
    // y flips: 400 − 20 − 150 = 230.
    expect(s).toContain("q 200 0 0 150 10 230 cm /Im0 Do Q");
    expect(s).toContain("q 200 0 0 150 300 230 cm /Im1 Do Q");
    expect(s).toContain("/XObject << /Im0 3 0 R /Im1 4 0 R >>");
    expect(s).not.toContain("/Font");
  });

  it("writes a bleed MediaBox with a trim box, and fills the background across the bleed", () => {
    const s = assertXrefIsSound(
      buildPagesPDF([{ w: 612, h: 612, bleed: 9, background: "#204080" }]),
      4, // catalog + pages + content + page (no images, no text)
    );
    expect(s).toContain("/MediaBox [-9 -9 621 621] /TrimBox [0 0 612 612]");
    expect(s).toContain("0.125 0.251 0.502 rg -9 -9 630 630 re f");
  });

  it("draws text on the ascender baseline, aligned and escaped", () => {
    const s = assertXrefIsSound(
      buildPagesPDF([
        {
          w: 500,
          h: 300,
          texts: [
            { text: "Plate (1) \\ 2", x: 40, y: 100, size: 10 },
            { text: "right", x: 40, y: 100, size: 10, width: 200, align: "right", font: "Helvetica-Bold" },
          ],
        },
      ]),
      // catalog + pages + 3 fonts + content + page
      7,
    );
    expect(s).toContain("/BaseFont /Helvetica-Oblique /Encoding /WinAnsiEncoding");
    expect(s).toContain("/Font << /F0 3 0 R /F1 4 0 R /F2 5 0 R >>");
    // baseline = y + 0.718·size = 107.18 → PDF y = 300 − 107.18 = 192.82
    expect(s).toContain("BT /F0 10 Tf 0 0 0 rg 40 192.82 Td (Plate \\(1\\) \\\\ 2) Tj ET");
    const rightX = 40 + 200 - textWidth("right", 10, "Helvetica-Bold");
    expect(s).toContain(`BT /F1 10 Tf 0 0 0 rg ${Math.round(rightX * 1000) / 1000} 192.82 Td (right) Tj ET`);
  });

  it("wraps a caption into the cell width and advances by the leading", () => {
    const caption = "A long enough caption to need two lines";
    const s = latin1(
      buildPagesPDF([
        { w: 400, h: 200, texts: [{ text: caption, x: 20, y: 10, size: 12, width: 120, leading: 15 }] },
      ]),
    );
    const lines = wrapText(caption, 120, 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 12)).toBeLessThanOrEqual(120);
    expect(lines.join(" ")).toBe(caption);
    // Second line sits one leading below the first: 10 + 0.718·12 + 15 = 33.616.
    expect(s).toContain(`${Math.round((200 - 33.616) * 1000) / 1000} Td ${`(${lines[1]})`}`);
  });

  it("encodes typographic punctuation as WinAnsi and substitutes what it cannot", () => {
    const s = latin1(buildPagesPDF([{ w: 300, h: 300, texts: [{ text: "it’s — 中", x: 0, y: 0, size: 10 }] }]));
    expect(s).toContain(`(it${String.fromCharCode(0x92)}s ${String.fromCharCode(0x97)} ?)`);
  });

  it("breaks a word that cannot fit the cell instead of overflowing it", () => {
    const lines = wrapText("supercalifragilistic", 40, 12);
    expect(lines.length).toBeGreaterThan(1);
    for (const line of lines) expect(textWidth(line, 12)).toBeLessThanOrEqual(40);
    expect(lines.join("")).toBe("supercalifragilistic");
  });

  it("keeps buildPDF's full-page output structurally identical", () => {
    const s = assertXrefIsSound(buildPDF([{ jpeg: JPEG, w: 100, h: 80 }, { jpeg: JPEG, w: 50, h: 50 }]), 8);
    expect(s).toContain("/MediaBox [0 0 100 80]");
    expect(s).toContain("q 100 0 0 80 0 0 cm /Im0 Do Q");
  });
});
