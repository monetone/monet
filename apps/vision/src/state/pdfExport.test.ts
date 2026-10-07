import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { buildPdf, cmykFromPsd, deflate, rgbFromRgba, type PdfPage } from "./pdfExport";

// VIS-PRINT-02: File ▸ Export ▸ PDF used to be one fixed-quality JPEG in a bare
// wrapper — no profile, no output intent, no physical page size. These pin the
// writer; the wiring check at the bottom pins that exportPDF still reaches it
// (same idiom as colorExportWiring.test.ts).

const latin1 = (b: Uint8Array) => String.fromCharCode(...b);
const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xdb, 1, 2, 3, 0xff, 0xd9]);
const page = (over: Partial<PdfPage> = {}): PdfPage => ({
  image: { data: jpeg, filter: "DCTDecode", w: 200, h: 100, space: "rgb" },
  ...over,
});
const icc = (space: string, n = 200) => {
  const p = new Uint8Array(n);
  p.set([0x61, 0x63, 0x73, 0x70], 36); // 'acsp'
  for (let i = 0; i < 4; i++) p[16 + i] = space.charCodeAt(i);
  p[n - 1] = 0x7f;
  return p;
};

/** Walk the xref table and prove every offset lands on its own object header —
 *  the one way a hand-rolled writer silently produces an unopenable file. */
function xrefOffsetsResolve(pdf: Uint8Array): number {
  const text = latin1(pdf);
  const start = Number(text.slice(text.lastIndexOf("startxref") + 9).trim().split("\n")[0]);
  expect(text.slice(start, start + 4)).toBe("xref");
  const rows = text.slice(start).split("\n");
  const count = Number(rows[1].split(" ")[1]);
  for (let n = 1; n < count; n++) {
    const off = Number(rows[1 + n + 1].slice(0, 10));
    expect(text.slice(off, off + `${n} 0 obj`.length), `object ${n}`).toBe(`${n} 0 obj`);
  }
  return count - 1;
}

describe("buildPdf", () => {
  it("writes a structurally valid file whose xref offsets resolve", () => {
    const pdf = buildPdf([page(), page()], { preset: "standard" });
    const text = latin1(pdf);
    expect(text.startsWith("%PDF-1.4")).toBe(true);
    expect(text).toContain("/Count 2");
    expect(text.endsWith("%%EOF\n")).toBe(true);
    expect(xrefOffsetsResolve(pdf)).toBeGreaterThan(4);
    // The trailer carries the /ID PDF/X requires, as a matched pair.
    const id = /\/ID \[<([0-9a-f]{32})> <([0-9a-f]{32})>\]/.exec(text);
    expect(id?.[1]).toBe(id?.[2]);
  });

  it("keeps the JPEG bytes byte-exact inside the image stream", () => {
    const pdf = buildPdf([page()], { preset: "standard" });
    const at = latin1(pdf).indexOf("\nstream\n", latin1(pdf).indexOf("/Subtype /Image")) + 8;
    expect([...pdf.slice(at, at + jpeg.length)]).toEqual([...jpeg]);
  });

  it("sizes the page in points from the document resolution, not in pixels", () => {
    // 600 px at 300 ppi is a 2-inch = 144 pt page; the untagged default is 1:1.
    const at300 = buildPdf([page({ image: { data: jpeg, filter: "DCTDecode", w: 600, h: 300, space: "rgb" }, ppi: 300 })], { preset: "standard" });
    expect(latin1(at300)).toContain("/MediaBox [0 0 144 72]");
    expect(latin1(at300)).toContain("q 144 0 0 72 0 0 cm /Im0 Do Q");
    expect(latin1(buildPdf([page()], { preset: "standard" }))).toContain("/MediaBox [0 0 200 100]");
  });

  it("tags the page image with the document profile instead of DeviceRGB", () => {
    const profile = icc("RGB ");
    const text = latin1(buildPdf([page()], { preset: "standard", icc: profile }));
    expect(text).toContain("/ColorSpace [/ICCBased");
    expect(text).not.toContain("/ColorSpace /DeviceRGB");
    expect(text).toContain("<< /N 3 /Length 200 >>"); // the profile stream itself
    expect(latin1(buildPdf([page()], { preset: "standard" }))).toContain("/ColorSpace /DeviceRGB");
  });

  it("lays type down as invisible text so a flattened PDF still searches", () => {
    const text = latin1(buildPdf([page({ text: [{ x: 10, y: 40, size: 24, text: "Hello (PDF)" }] })], { preset: "standard" }));
    expect(text).toContain("/BaseFont /Helvetica");
    expect(text).toContain("/Font << /F1");
    // Tr 3 = invisible; the baseline flips into PDF's bottom-up page space.
    expect(text).toContain("BT 3 Tr /F1 24 Tf 1 0 0 1 10 60 Tm (Hello \\(PDF\\)) Tj ET");
  });

  // The text layer is written for /Encoding /WinAnsiEncoding, which holds the
  // whole Latin-1 supplement plus the CP1252 punctuation block — dropping
  // everything above U+007E made "Café Zürich" unsearchable. (#136)
  it("encodes accented text through WinAnsi instead of blanking it", () => {
    const text = latin1(buildPdf([page({ text: [{ x: 0, y: 0, size: 12, text: "Café Zürich — ‘n’ €5" }] })], {
      preset: "standard",
      title: "Ärger",
    }));
    expect(text).toContain("(Caf\\351 Z\\374rich \\227 \\221n\\222 \\2005) Tj");
    expect(text).toContain("/Title (\\304rger)"); // the Info dictionary goes through the same encoder
    // Genuinely unencodable code points still degrade to a space.
    expect(latin1(buildPdf([page({ text: [{ x: 0, y: 0, size: 12, text: "a→b" }] })], { preset: "standard" })))
      .toContain("(a b) Tj");
  });

  it("omits the font resource when nothing on the page has text", () => {
    expect(latin1(buildPdf([page()], { preset: "standard" }))).not.toContain("/BaseFont");
  });

  it("writes PDF/X-1a as CMYK plates with the press output intent", () => {
    const text = latin1(buildPdf(
      [page({ image: { data: jpeg, filter: "FlateDecode", w: 8, h: 8, space: "cmyk" } })],
      { preset: "x1a", icc: icc("RGB "), outputIntent: { icc: icc("CMYK"), components: 4, identifier: "FOGRA39L", condition: "ISO coated v2 300% (ECI)" } },
    ));
    // A plates-only file carries no RGB profile, referenced or orphaned.
    expect(text).not.toContain("/ICCBased");
    expect(text).not.toContain("<< /N 3");
    expect(text.startsWith("%PDF-1.3")).toBe(true);
    expect(text).toContain("/ColorSpace /DeviceCMYK");
    expect(text).toContain("/S /GTS_PDFX");
    expect(text).toContain("/OutputConditionIdentifier (FOGRA39L)");
    expect(text).toContain("/DestOutputProfile");
    expect(text).toContain("<< /N 4 /Length 200 >>");
    // X-1a identifies itself through Info, and demands a trapping state.
    expect(text).toContain("/GTS_PDFXVersion (PDF/X-1a:2001)");
    expect(text).toContain("/GTS_PDFXConformance (PDF/X-1a:2001)");
    expect(text).toContain("/Trapped /False");
    expect(text).not.toContain("/Metadata");
  });

  it("writes PDF/X-4 as PDF 1.6 with the identification in XMP", () => {
    const text = latin1(buildPdf([page()], {
      preset: "x4",
      icc: icc("RGB "),
      outputIntent: { icc: icc("RGB "), components: 3, identifier: "Document RGB" },
      title: "Poster",
    }));
    expect(text.startsWith("%PDF-1.6")).toBe(true);
    expect(text).toContain("/Type /Metadata /Subtype /XML");
    expect(text).toContain("<pdfxid:GTS_PDFXVersion>PDF/X-4</pdfxid:GTS_PDFXVersion>");
    expect(text).toContain("/Title (Poster)");
    expect(text).toContain("/S /GTS_PDFX");
    // X-4 states its version in XMP only — the X-1a Info keys must not appear.
    expect(text).not.toContain("/GTS_PDFXVersion (");
  });

  it("drops an output intent with no profile bytes rather than write a dangling reference", () => {
    const text = latin1(buildPdf([page()], { preset: "standard", outputIntent: { icc: new Uint8Array(), components: 4, identifier: "none" } }));
    expect(text).not.toContain("/OutputIntents");
  });
});

describe("cmykFromPsd", () => {
  /** The engine's CMYK PSD: raw planar channels, stored inverted. */
  function fakeCmykPsd(w: number, h: number, inks: number[][], depth = 8): Uint8Array {
    const n = w * h;
    const bps = depth >> 3;
    const head = [
      0x38, 0x42, 0x50, 0x53, 0, 1, 0, 0, 0, 0, 0, 0, 0, 4,
      ...[24, 16, 8, 0].map((s) => (h >>> s) & 0xff),
      ...[24, 16, 8, 0].map((s) => (w >>> s) & 0xff),
      0, depth, 0, 4,
      0, 0, 0, 0, // colour mode data
      0, 0, 0, 0, // image resources
      0, 0, 0, 0, // layer + mask info
      0, 0, // compression: raw
    ];
    const out = new Uint8Array(head.length + n * 4 * bps);
    out.set(head);
    for (let c = 0; c < 4; c++) for (let i = 0; i < n; i++) {
      const v = 255 - inks[i][c];
      const at = head.length + (c * n + i) * bps;
      // 16-bit: big-endian, the engine's `stored.to_be_bytes()`.
      if (bps === 1) out[at] = v;
      else { out[at] = v; out[at + 1] = v; } // v*257 >> 8 === v
    }
    return out;
  }

  it("un-inverts the planar plates into interleaved CMYK samples", () => {
    const psd = fakeCmykPsd(2, 1, [[0, 0, 0, 255], [10, 20, 30, 40]]);
    const out = cmykFromPsd(psd);
    expect(out).toEqual({ data: new Uint8Array([0, 0, 0, 255, 10, 20, 30, 40]), w: 2, h: 1 });
  });

  // A 16-bit (or 32-bit) document makes the engine write 16-bit plates; parsing
  // those at 1 byte/sample read the C plane's hi/lo bytes as all four plates and
  // shipped striped noise as a prepress PDF/X-1a page. (#32)
  it("reads the engine's 16-bit plates at the right sample stride", () => {
    const psd = fakeCmykPsd(2, 1, [[0, 0, 0, 255], [10, 20, 30, 40]], 16);
    expect(cmykFromPsd(psd)).toEqual({ data: new Uint8Array([0, 0, 0, 255, 10, 20, 30, 40]), w: 2, h: 1 });
  });

  it("rejects bytes that are not the engine's raw CMYK PSD", () => {
    expect(cmykFromPsd(new Uint8Array(64))).toBeNull();
    const truncated = fakeCmykPsd(4, 4, Array.from({ length: 16 }, () => [1, 2, 3, 4])).slice(0, 40);
    expect(cmykFromPsd(truncated)).toBeNull();
    // A 16-bit file is only half a plate long when measured as 8-bit — the old
    // length guard passed and the parser silently produced garbage. (#32)
    const deep = fakeCmykPsd(4, 4, Array.from({ length: 16 }, () => [1, 2, 3, 4]), 16);
    expect(cmykFromPsd(deep.slice(0, deep.length - 2))).toBeNull();
    // Depths the writer never emits are rejected outright, not misread.
    const odd = fakeCmykPsd(2, 1, [[0, 0, 0, 0], [0, 0, 0, 0]]);
    odd[23] = 32;
    expect(cmykFromPsd(odd)).toBeNull();
  });
});

describe("stream encoding", () => {
  // Was "strips alpha", which encoded the bug: the page has no alpha channel, so
  // a transparent pixel shipped as BLACK instead of the white Photoshop flattens
  // onto. (#134)
  it("flattens the lossless page image onto white instead of blackening transparency", () => {
    expect([...rgbFromRgba(new Uint8Array([1, 2, 3, 255, 4, 5, 6, 0]))]).toEqual([1, 2, 3, 255, 255, 255]);
    // Partial alpha composites rather than truncating…
    expect([...rgbFromRgba(new Uint8Array([0, 0, 0, 128]))]).toEqual([127, 127, 127]);
    // …and a caller can pick its own backdrop.
    expect([...rgbFromRgba(new Uint8Array([9, 9, 9, 0]), [0, 0, 0])]).toEqual([0, 0, 0]);
  });

  it("deflates to a zlib stream a FlateDecode reader can inflate", async () => {
    const raw = new Uint8Array(512).map((_, i) => i & 0x0f);
    const packed = await deflate(raw);
    expect(packed.length).toBeLessThan(raw.length);
    const back = new Uint8Array(await new Response(
      // TS 5.7 Uint8Array<ArrayBufferLike> vs BlobPart variance — these bytes
      // are always ArrayBuffer-backed (same cast as galerie's urlFromEncoded).
      new Blob([packed as Uint8Array<ArrayBuffer>]).stream().pipeThrough(new DecompressionStream("deflate")),
    ).arrayBuffer());
    expect([...back]).toEqual([...raw]);
  });
});

// The writer above is only worth having if the export commands actually use it.
describe("VIS-PRINT-02 — the PDF exports reach the prepress writer", () => {
  const source = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");

  function section(start: string, end: string): string {
    const from = source.indexOf(start);
    expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
    const to = source.indexOf(end, from + start.length);
    expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
    return source.slice(from, to);
  }

  it("routes every PDF Vision writes through one profile-aware document builder", () => {
    for (const [start, end] of [
      ["export async function pdfPresentation(", "/** File ▸ Export ▸ Artboards to PDF"],
      ["export async function exportArtboardsToPDF(", "/** File ▸ Export ▸ PDF:"],
      ["export async function exportPDF(", "/** File ▸ Export ▸ PDF/X-1a"],
      ["export async function exportLayerCompsToPDF(", "/** File ▸ Automate ▸ Picture Package"],
    ] as const) {
      expect(section(start, end)).toContain("pdfDocument(");
    }
  });

  it("embeds the document profile and the PDF/X output intent", () => {
    const body = section("async function pdfDocument(", "/** File ▸ Automate ▸ PDF Presentation");
    expect(body).toContain("exportIccBytes(document)");
    expect(body).toContain("document?.iccProfileName");
    // X-1a: the document's own CMYK profile when Convert to Profile separated
    // it through one (#437), else the bundled press condition.
    expect(body).toContain("pressOutputIntent()");
    const intent = section("async function pressOutputIntent(", "/** Type layers as invisible text");
    expect(intent).toContain("const own = E().mode_profile_icc();");
    expect(intent).toContain('!E().mode_profile_error() && iccColorMode(String.fromCharCode(...own.subarray(16, 20))) === 2');
    expect(intent).toContain("fetch(PRESS_PROFILE_URL)");
    // No output intent (or no profile for X-4) must not silently ship as PDF/X.
    expect(body).toContain("return null");
  });

  it("keeps unembedded searchable text out of the PDF/X presets", () => {
    const body = section("export async function exportPDF(", "/** File ▸ Export ▸ PDF/X-1a");
    expect(body).toContain('preset === "standard" ? pdfTextLines(eng) : undefined');
    expect(body).toContain('preset === "x1a"');
  });
});
