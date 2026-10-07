// pdfExport.ts — the PDF writer behind File ▸ Export ▸ PDF, PDF Presentation
// and the Artboards / Layer Comps PDFs.
//
// VIS-PRINT-02: the previous writer wrapped one fixed-quality JPEG in a bare
// PDF 1.4 shell — no profile, no output intent, no physical page size. This one
// is prepress-shaped: the page image can be ICC-tagged RGB or DeviceCMYK plates,
// the page box is in points (px ÷ ppi × 72), the catalog can carry a PDF/X
// output intent, and PDF/X-1a / PDF/X-4 identification is written where each
// standard expects it (Info keys for X-1a, XMP for X-4).
//
// Everything here is pure + byte-exact (latin1 strings) so the cross-reference
// offsets are correct; the pixel work stays in app.ts.

/** Photoshop's PDF presets, minus the ones that need editable layers. */
export type PdfPreset = "standard" | "x1a" | "x4";

export interface PdfImage {
  /** Already-encoded stream bytes (JPEG, or zlib-deflated raw samples). */
  data: Uint8Array;
  filter: "DCTDecode" | "FlateDecode";
  w: number;
  h: number;
  space: "rgb" | "cmyk";
}

/** One line of invisible (Tr 3) text laid over the page raster, so a flattened
 *  PDF still searches and copies. Document px, top-left origin, `y` = baseline. */
export interface PdfTextLine {
  x: number;
  y: number;
  size: number;
  text: string;
}

export interface PdfOutputIntent {
  icc: Uint8Array;
  components: 3 | 4;
  /** Registered condition name, e.g. "FOGRA39L". */
  identifier: string;
  condition?: string;
}

export interface PdfPage {
  image: PdfImage;
  /** Document resolution; drives the MediaBox (72 = one px per point). */
  ppi?: number;
  text?: PdfTextLine[];
}

export interface PdfOptions {
  preset: PdfPreset;
  /** ICC profile tagging RGB page images (ICCBased). Untagged → DeviceRGB. */
  icc?: Uint8Array | null;
  outputIntent?: PdfOutputIntent | null;
  title?: string;
  now?: Date;
}

const latin1 = (s: string): Uint8Array => {
  const a = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff;
  return a;
};

/** WinAnsiEncoding's 0x80–0x9F block (CP1252) — the only run where the encoding
 *  is NOT Latin-1, so it needs a real table. NUL marks an unused code. (#136) */
const WIN_ANSI_HIGH =
  "\u20AC\u0000\u201A\u0192\u201E\u2026\u2020\u2021\u02C6\u2030\u0160\u2039\u0152\u0000\u017D\u0000" +
  "\u0000\u2018\u2019\u201C\u201D\u2022\u2013\u2014\u02DC\u2122\u0161\u203A\u0153\u0000\u017E\u0178";

/** A PDF literal string: escape the delimiters, then encode through
 *  WinAnsiEncoding — the encoding the font resource below declares — as octal
 *  escapes, so accented Latin text survives instead of collapsing to spaces.
 *  Only genuinely unencodable code points become a space. (#136) */
const str = (s: string): string => {
  let out = "";
  for (const ch of s) {
    if (ch === "\\" || ch === "(" || ch === ")") { out += `\\${ch}`; continue; }
    const cp = ch.codePointAt(0)!;
    if (cp >= 0x20 && cp <= 0x7e) { out += ch; continue; }
    const high = cp === 0 ? -1 : WIN_ANSI_HIGH.indexOf(ch);
    const b = cp >= 0xa0 && cp <= 0xff ? cp : high >= 0 ? 0x80 + high : -1;
    out += b < 0 ? " " : `\\${b.toString(8).padStart(3, "0")}`;
  }
  return `(${out})`;
};

const num = (n: number): string => (Math.round(n * 100) / 100).toString();

const pdfDate = (d: Date): string => {
  const p = (n: number) => String(n).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}+00'00'`;
};

/** FNV-1a over the page bytes → the /ID pair. PDF/X requires an ID; it only has
 *  to be stable per file, and hashing the content keeps the writer pure (no
 *  crypto, deterministic tests). ponytail: not collision-proof — swap in a real
 *  digest if anyone diffs PDFs by ID. */
function contentId(pages: PdfPage[], title: string): string {
  let out = "";
  for (const seed of [0x811c9dc5, 0x01000193]) {
    let h = seed >>> 0;
    const mix = (b: number) => { h = Math.imul(h ^ b, 0x01000193) >>> 0; };
    for (let i = 0; i < title.length; i++) mix(title.charCodeAt(i) & 0xff);
    for (const pg of pages) {
      mix(pg.image.w & 0xff); mix(pg.image.h & 0xff);
      // Sample the stream — hashing megabytes of pixels buys nothing here.
      const d = pg.image.data;
      const step = Math.max(1, Math.floor(d.length / 512));
      for (let i = 0; i < d.length; i += step) mix(d[i]);
      mix(d.length & 0xff); mix((d.length >>> 8) & 0xff);
    }
    out += h.toString(16).padStart(8, "0");
  }
  return (out + out).slice(0, 32);
}

const XMP = (version: string, title: string, date: string) =>
  `<?xpacket begin="" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about="" xmlns:pdfxid="http://www.npes.org/pdfx/ns/id/">
   <pdfxid:GTS_PDFXVersion>${version}</pdfxid:GTS_PDFXVersion>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:dc="http://purl.org/dc/elements/1.1/">
   <dc:title><rdf:Alt><rdf:li xml:lang="x-default">${title.replace(/[<>&]/g, "")}</rdf:li></rdf:Alt></dc:title>
  </rdf:Description>
  <rdf:Description rdf:about="" xmlns:xmp="http://ns.adobe.com/xap/1.0/">
   <xmp:CreatorTool>Monet Vision</xmp:CreatorTool>
   <xmp:CreateDate>${date}</xmp:CreateDate>
  </rdf:Description>
 </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

/** Assemble the PDF. Page images arrive already encoded — this only writes
 *  structure, so it stays synchronous and testable without a canvas. */
export function buildPdf(pages: PdfPage[], opts: PdfOptions): Uint8Array {
  const { preset } = opts;
  const title = opts.title ?? "Monet Vision";
  const now = opts.now ?? new Date();
  const bodies: (Uint8Array | string)[][] = [];
  const reserve = () => bodies.push([]);
  const put = (n: number, ...chunks: (Uint8Array | string)[]) => { bodies[n - 1] = chunks; };
  const stream = (dict: string, data: Uint8Array | string): (Uint8Array | string)[] => {
    const bytes = typeof data === "string" ? latin1(data) : data;
    return [`<< ${dict} /Length ${bytes.length} >>\nstream\n`, bytes, "\nendstream"];
  };

  const catalogN = reserve();
  const pagesN = reserve();
  const infoN = reserve();
  // ICCBased needs the profile as its own stream object; shared by every page.
  // Plates-only documents (PDF/X-1a) get no RGB profile — an unreferenced one
  // is just dead weight a preflight has to explain.
  const iccN = opts.icc?.length && pages.some((p) => p.image.space === "rgb") ? reserve() : 0;
  if (iccN) put(iccN, ...stream("/N 3", opts.icc!));
  const intent = opts.outputIntent?.icc.length ? opts.outputIntent : null;
  const intentN = intent ? reserve() : 0;
  if (intent) put(intentN, ...stream(`/N ${intent.components}`, intent.icc));
  const metaN = preset === "x4" ? reserve() : 0;
  const hasText = pages.some((p) => p.text?.length);
  // ponytail: base-14 Helvetica, no embedding — enough for the invisible text
  // layer (search/copy), which is why it is standard-preset only. Real vector
  // type means subsetting + embedding the actual font: the upgrade path.
  const fontN = hasText ? reserve() : 0;
  if (fontN) put(fontN, "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>");

  const kids: number[] = [];
  for (const pg of pages) {
    const { image } = pg;
    const scale = 72 / (pg.ppi && pg.ppi > 0 ? pg.ppi : 72);
    const wPt = image.w * scale, hPt = image.h * scale;
    const imgN = reserve(), contentN = reserve(), pageN = reserve();
    kids.push(pageN);
    const space = image.space === "cmyk" ? "/DeviceCMYK" : iccN ? `[/ICCBased ${iccN} 0 R]` : "/DeviceRGB";
    put(imgN, ...stream(
      `/Type /XObject /Subtype /Image /Width ${image.w} /Height ${image.h} /ColorSpace ${space} /BitsPerComponent 8 /Filter /${image.filter}`,
      image.data,
    ));
    let ops = `q ${num(wPt)} 0 0 ${num(hPt)} 0 0 cm /Im0 Do Q`;
    for (const line of pg.text ?? []) {
      if (!line.text) continue;
      // PDF is bottom-up: flip the baseline into page space. Tr 3 = invisible.
      ops += `\nBT 3 Tr /F1 ${num(line.size * scale)} Tf 1 0 0 1 ${num(line.x * scale)} ${num(hPt - line.y * scale)} Tm ${str(line.text)} Tj ET`;
    }
    put(contentN, ...stream("", ops));
    const font = fontN && pg.text?.length ? ` /Font << /F1 ${fontN} 0 R >>` : "";
    put(pageN, `<< /Type /Page /Parent ${pagesN} 0 R /MediaBox [0 0 ${num(wPt)} ${num(hPt)}] /Resources << /XObject << /Im0 ${imgN} 0 R >>${font} >> /Contents ${contentN} 0 R >>`);
  }

  const intentDict = intent
    ? ` /OutputIntents [ << /Type /OutputIntent /S /GTS_PDFX /OutputConditionIdentifier ${str(intent.identifier)} /OutputCondition ${str(intent.condition ?? intent.identifier)} /RegistryName (http://www.color.org) /DestOutputProfile ${intentN} 0 R >> ]`
    : "";
  put(catalogN, `<< /Type /Catalog /Pages ${pagesN} 0 R${intentDict}${metaN ? ` /Metadata ${metaN} 0 R` : ""} >>`);
  put(pagesN, `<< /Type /Pages /Kids [${kids.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  const date = pdfDate(now);
  // X-1a identifies itself through the Info dictionary; X-4 through XMP.
  const xKeys = preset === "x1a" ? " /GTS_PDFXVersion (PDF/X-1a:2001) /GTS_PDFXConformance (PDF/X-1a:2001)" : "";
  put(infoN, `<< /Title ${str(title)} /Creator (Monet Vision) /Producer (Monet Vision) /CreationDate (${date}) /ModDate (${date}) /Trapped /False${xKeys} >>`);
  if (metaN) {
    const iso = `${date.slice(2, 6)}-${date.slice(6, 8)}-${date.slice(8, 10)}T${date.slice(10, 12)}:${date.slice(12, 14)}:${date.slice(14, 16)}Z`;
    put(metaN, ...stream("/Type /Metadata /Subtype /XML", XMP("PDF/X-4", title, iso)));
  }

  // ── serialize ──────────────────────────────────────────────────
  const version = preset === "x1a" ? "1.3" : preset === "x4" ? "1.6" : "1.4";
  const parts: Uint8Array[] = [];
  let len = 0;
  const pushBytes = (a: Uint8Array) => { parts.push(a); len += a.length; };
  const push = (s: string) => pushBytes(latin1(s));
  push(`%PDF-${version}\n`);
  pushBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a])); // binary marker
  const offsets: number[] = [];
  bodies.forEach((chunks, i) => {
    offsets[i] = len;
    push(`${i + 1} 0 obj\n`);
    for (const c of chunks) typeof c === "string" ? push(c) : pushBytes(c);
    push("\nendobj\n");
  });
  const xrefStart = len;
  push(`xref\n0 ${bodies.length + 1}\n0000000000 65535 f \n`);
  for (const off of offsets) push(`${String(off).padStart(10, "0")} 00000 n \n`);
  const id = contentId(pages, title);
  push(`trailer\n<< /Size ${bodies.length + 1} /Root ${catalogN} 0 R /Info ${infoN} 0 R /ID [<${id}> <${id}>] >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** zlib-wrapped deflate for FlateDecode streams (the platform's, not ours). */
export async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const cs = new CompressionStream("deflate");
  const blob = await new Response(new Blob([bytes as unknown as BlobPart]).stream().pipeThrough(cs)).arrayBuffer();
  return new Uint8Array(blob);
}

/** Interleaved CMYK samples out of the engine's flattened CMYK PSD
 *  (`export_psd_cmyk`) — the one place Vision's own ink separation is reachable
 *  from JS. Planar, raw (compression 0), channels stored inverted. Null if the
 *  bytes are not that file. */
export function cmykFromPsd(psd: Uint8Array): { data: Uint8Array; w: number; h: number } | null {
  const be32 = (o: number) => (psd[o] << 24 | psd[o + 1] << 16 | psd[o + 2] << 8 | psd[o + 3]) >>> 0;
  const be16 = (o: number) => psd[o] << 8 | psd[o + 1];
  if (psd.length < 30 || psd[0] !== 0x38 || psd[1] !== 0x42 || psd[2] !== 0x50 || psd[3] !== 0x53) return null;
  if (be16(12) !== 4 || be16(24) !== 4) return null; // 4 channels, CMYK mode
  // The engine writes 16-bit big-endian plates for any non-8-bit document
  // (raster/mod.rs export_psd_cmyk_with_icc), so the sample stride is not always
  // 1 — reading those as 8-bit produced a striped-noise PDF/X-1a page. (#32)
  const depth = be16(22);
  if (depth !== 8 && depth !== 16) return null;
  const bps = depth >> 3; // bytes per sample
  const h = be32(14), w = be32(18);
  let p = 26;
  p += 4 + be32(p); // colour mode data
  p += 4 + be32(p); // image resources
  p += 4 + be32(p); // layer + mask info
  if (be16(p) !== 0) return null; // only the raw (uncompressed) writer
  p += 2;
  const n = w * h;
  const planeBytes = n * bps;
  if (!n || p + planeBytes * 4 > psd.length) return null;
  const data = new Uint8Array(n * 4);
  for (let c = 0; c < 4; c++) {
    const src = p + c * planeBytes;
    // 16-bit plates are big-endian: the high byte is the 8-bit ink value.
    for (let i = 0; i < n; i++) data[i * 4 + c] = 255 - psd[src + i * bps];
  }
  return { data, w, h };
}

/** Flatten straight RGBA onto an opaque matte for the (alpha-less) PDF image
 *  XObject. The composite really can be transparent — a document with no opaque
 *  Background layer is (0,0,0,0) there — and simply dropping alpha painted every
 *  transparent pixel BLACK; Photoshop flattens PDF pages onto white. (#134) */
export function rgbFromRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  matte: [number, number, number] = [255, 255, 255],
): Uint8Array {
  const n = rgba.length / 4;
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    for (let k = 0; k < 3; k++) out[i * 3 + k] = Math.round(rgba[i * 4 + k] * a + matte[k] * (1 - a));
  }
  return out;
}
