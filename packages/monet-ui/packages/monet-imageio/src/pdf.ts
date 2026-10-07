// Minimal multi-page PDF writer — pages of placed JPEGs (DCTDecode) plus
// base-14 text. Pure + byte-exact (latin1 strings) so the cross-reference
// offsets are correct.
// Used by File ▸ Export ▸ Artboards to PDF / PDF Presentation (buildPDF), the
// Slideshow module's Export PDF, and the Book module's PDF output
// (buildPagesPDF — photo cells, page/photo text, bleed + trim boxes).

/** Placement rectangle, in points, **top-left origin** (y grows down) with the
 *  origin at the page's trim corner — the same convention the layout code and
 *  the canvas renderers use. The writer flips into PDF space. */
export interface PdfRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** A JPEG drawn into `box`. `w`/`h` are the JPEG's own pixel dimensions (the
 *  XObject size); `box` is where it lands on the page, already fitted — cell
 *  fitting/cropping is the caller's layout job. */
export interface PdfImageBox {
  jpeg: Uint8Array;
  w: number;
  h: number;
  box: PdfRect;
}

/** The base-14 faces we can draw without embedding anything. */
export type PdfFont = "Helvetica" | "Helvetica-Bold" | "Helvetica-Oblique";

/** A run of text. `x`/`y` are the top-left of the first line's em box.
 *  With `width` set the run wraps to that width and aligns inside
 *  [x, x+width]; without it, `align` is taken about `x`. */
export interface PdfTextRun {
  text: string;
  x: number;
  y: number;
  /** Font size in points. */
  size: number;
  font?: PdfFont;
  /** "#rgb" / "#rrggbb". Default black. */
  color?: string;
  align?: "left" | "center" | "right";
  /** Wrap width in points. Omitted → no wrapping (explicit \n still breaks). */
  width?: number;
  /** Line advance in points. Default 1.2 × size. */
  leading?: number;
}

/** One page: a trim size, optional bleed, a background, images and text.
 *  A book spread is just a page whose trim width is two leaves wide. */
export interface PdfPageSpec {
  /** Trim size in points (72 pt = 1 in). */
  w: number;
  h: number;
  /** Bleed in points on every side. The MediaBox grows by it; /TrimBox stays
   *  the trim size, so a printer knows where to cut. Content that bleeds is
   *  placed at negative coordinates by the caller. */
  bleed?: number;
  /** Fills the whole media box (bleed included) before anything is drawn. */
  background?: string;
  images?: PdfImageBox[];
  texts?: PdfTextRun[];
}

// ─── Base-14 metrics ─────────────────────────────────────────────────
// AFM widths (1/1000 em) for codes 32…126. Helvetica-Oblique shares
// Helvetica's widths, which is why only two tables exist.

const W_HELVETICA = "278 278 355 556 556 889 667 191 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 278 278 584 584 584 556 1015 667 667 722 722 667 611 778 722 278 500 667 556 833 722 778 667 778 722 667 611 722 667 944 667 667 611 278 278 278 469 556 333 556 556 500 556 556 278 556 556 222 222 500 222 833 556 556 556 556 333 500 278 556 500 722 500 500 500 334 260 334 584"
  .split(" ")
  .map(Number);

const W_HELVETICA_BOLD = "278 333 474 556 556 889 722 238 333 333 389 584 278 333 278 278 556 556 556 556 556 556 556 556 556 556 333 333 584 584 584 611 975 722 722 722 722 667 611 778 722 278 556 722 611 833 722 778 667 778 722 667 611 722 667 944 667 667 611 333 278 333 584 556 333 556 611 556 611 556 333 611 611 278 278 556 278 889 611 611 611 611 389 556 333 611 556 778 556 556 500 389 280 389 584"
  .split(" ")
  .map(Number);

/** Typographic punctuation that WinAnsiEncoding carries above 0x7f: source
 *  codepoint → [WinAnsi byte, Helvetica width, Helvetica-Bold width]. Captions
 *  are full of curly quotes and dashes, so measuring them as "?" would wrap
 *  visibly wrong. */
const WIN_ANSI_EXTRA: Record<number, [number, number, number]> = {
  0x2018: [0x91, 222, 278],
  0x2019: [0x92, 222, 278],
  0x201c: [0x93, 333, 500],
  0x201d: [0x94, 333, 500],
  0x2013: [0x96, 556, 556],
  0x2014: [0x97, 1000, 1000],
  0x2026: [0x85, 1000, 1000],
  0x2022: [0x95, 350, 350],
};

/** Helvetica's ascender, as a fraction of the em — turns a run's top-left `y`
 *  into a baseline. */
const ASCENT = 0.718;

/** WinAnsi byte for a codepoint, or null if we cannot represent it. */
function winAnsiByte(cp: number): number | null {
  if (cp >= 32 && cp <= 126) return cp;
  const extra = WIN_ANSI_EXTRA[cp];
  if (extra) return extra[0];
  // 0xa0…0xff is Latin-1, which WinAnsi matches; the C1 range is not text.
  if (cp >= 0xa0 && cp <= 0xff) return cp;
  return null;
}

function charWidth(cp: number, bold: boolean): number {
  if (cp >= 32 && cp <= 126) return (bold ? W_HELVETICA_BOLD : W_HELVETICA)[cp - 32];
  const extra = WIN_ANSI_EXTRA[cp];
  if (extra) return extra[bold ? 2 : 1];
  // ponytail: accented Latin-1 measures as its unaccented cousin would, near
  // enough — 556 is the width of most Helvetica lowercase. Swap in the full
  // AFM table when a caption visibly mis-wraps.
  if (cp >= 0xa0 && cp <= 0xff) return bold ? 611 : 556;
  return bold ? 611 : 556;
}

/** Width of `text` in points at `size` in one of the base-14 faces. */
export function textWidth(text: string, size: number, font: PdfFont = "Helvetica"): number {
  const bold = font === "Helvetica-Bold";
  let w = 0;
  for (const ch of text) w += charWidth(ch.codePointAt(0) ?? 32, bold);
  return (w / 1000) * size;
}

/** Greedy word wrap to `maxWidth` points. Honors explicit newlines; a single
 *  word longer than the line is broken by character rather than overflowing
 *  the cell. `maxWidth <= 0` disables wrapping. */
export function wrapText(
  text: string,
  maxWidth: number,
  size: number,
  font: PdfFont = "Helvetica",
): string[] {
  const paragraphs = text.split("\n");
  if (!(maxWidth > 0)) return paragraphs;
  const out: string[] = [];
  for (const para of paragraphs) {
    const words = para.split(/ +/).filter((w) => w.length > 0);
    if (words.length === 0) {
      out.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line === "" ? word : `${line} ${word}`;
      if (textWidth(candidate, size, font) <= maxWidth) {
        line = candidate;
        continue;
      }
      if (line !== "") out.push(line);
      // The word alone may still be too wide — split it at the last char that fits.
      let rest = word;
      while (textWidth(rest, size, font) > maxWidth) {
        let cut = 1;
        while (cut < rest.length && textWidth(rest.slice(0, cut + 1), size, font) <= maxWidth) cut++;
        out.push(rest.slice(0, cut));
        rest = rest.slice(cut);
      }
      line = rest;
    }
    out.push(line);
  }
  return out;
}

// ─── Content-stream helpers ──────────────────────────────────────────

/** Trim float noise — PDF numbers are plain decimals, never exponent form. */
function num(v: number): string {
  const r = Math.round(v * 1000) / 1000;
  return Object.is(r, -0) ? "0" : String(r);
}

/** "#rgb"/"#rrggbb" → a PDF `r g b` triple in 0…1. Unparseable → black. */
function rgb(color: string | undefined): string {
  const hex = (color ?? "").trim().replace(/^#/, "");
  const full = hex.length === 3 ? hex.replace(/./g, (c) => c + c) : hex;
  if (!/^[0-9a-fA-F]{6}$/.test(full)) return "0 0 0";
  const v = (i: number) => num(parseInt(full.slice(i, i + 2), 16) / 255);
  return `${v(0)} ${v(2)} ${v(4)}`;
}

/** PDF string literal in WinAnsiEncoding, with the three escapes that matter.
 *  Unrepresentable codepoints become "?" — a visible substitution beats a
 *  corrupt byte in the content stream. */
function pdfString(text: string): string {
  let out = "(";
  for (const ch of text) {
    const b = winAnsiByte(ch.codePointAt(0) ?? 32);
    if (b === null) {
      out += "?";
      continue;
    }
    const c = String.fromCharCode(b);
    out += c === "(" || c === ")" || c === "\\" ? `\\${c}` : c;
  }
  return `${out})`;
}

const FONT_NAMES: PdfFont[] = ["Helvetica", "Helvetica-Bold", "Helvetica-Oblique"];

/** Content-stream ops for one text run, in PDF space (bottom-left origin). */
function textOps(run: PdfTextRun, pageH: number): string {
  const font = run.font ?? "Helvetica";
  const fi = Math.max(0, FONT_NAMES.indexOf(font));
  const size = run.size;
  const leading = run.leading ?? size * 1.2;
  const lines = run.width !== undefined ? wrapText(run.text, run.width, size, font) : run.text.split("\n");
  const align = run.align ?? "left";
  const ops: string[] = [];
  lines.forEach((line, i) => {
    const lw = textWidth(line, size, font);
    const span = run.width ?? 0;
    const x =
      align === "center" ? run.x + (span - lw) / 2 : align === "right" ? run.x + span - lw : run.x;
    // `y` is the top of the em box; the first baseline sits one ascender down.
    const baseline = run.y + ASCENT * size + i * leading;
    ops.push(
      `BT /F${fi} ${num(size)} Tf ${rgb(run.color)} rg ${num(x)} ${num(pageH - baseline)} Td ${pdfString(line)} Tj ET`,
    );
  });
  return ops.join("\n");
}

// ─── Writer ──────────────────────────────────────────────────────────

/** Build a PDF from fully-placed pages. Object numbering runs 1 = Catalog,
 *  2 = Pages, then the three shared fonts (only when a page carries text),
 *  then per page: one XObject per image, the content stream, the page. */
export function buildPagesPDF(pages: PdfPageSpec[]): Uint8Array {
  const parts: Uint8Array[] = [];
  let len = 0;
  const offsets: Record<number, number> = {};
  const enc = (s: string) => { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i) & 0xff; return a; };
  const pushBytes = (a: Uint8Array) => { parts.push(a); len += a.length; };
  const push = (s: string) => pushBytes(enc(s));

  const anyText = pages.some((p) => (p.texts?.length ?? 0) > 0);
  const fontBase = 3; // /F0 /F1 /F2 when present
  let next = fontBase + (anyText ? FONT_NAMES.length : 0);
  // Page object numbers must be known before /Kids is written.
  const pageNums = pages.map((pg) => {
    const n = next + (pg.images?.length ?? 0) + 1; // images…, content, page
    next = n + 1;
    return n;
  });
  const total = next - 1;

  push("%PDF-1.4\n");
  pushBytes(new Uint8Array([0x25, 0xff, 0xff, 0xff, 0xff, 0x0a])); // binary marker
  offsets[1] = len;
  push("1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n");
  offsets[2] = len;
  push(`2 0 obj\n<< /Type /Pages /Kids [${pageNums.map((n) => `${n} 0 R`).join(" ")}] /Count ${pages.length} >>\nendobj\n`);
  if (anyText) {
    FONT_NAMES.forEach((name, i) => {
      const n = fontBase + i;
      offsets[n] = len;
      push(`${n} 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>\nendobj\n`);
    });
  }

  pages.forEach((pg, pi) => {
    const images = pg.images ?? [];
    const pageN = pageNums[pi];
    const contentN = pageN - 1;
    const imageN0 = contentN - images.length;
    const bleed = Math.max(0, pg.bleed ?? 0);
    const ops: string[] = [];
    if (pg.background) {
      ops.push(
        `${rgb(pg.background)} rg ${num(-bleed)} ${num(-bleed)} ${num(pg.w + bleed * 2)} ${num(pg.h + bleed * 2)} re f`,
      );
    }
    images.forEach((img, ii) => {
      const n = imageN0 + ii;
      offsets[n] = len;
      push(`${n} 0 obj\n<< /Type /XObject /Subtype /Image /Width ${img.w} /Height ${img.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${img.jpeg.length} >>\nstream\n`);
      pushBytes(img.jpeg);
      push("\nendstream\nendobj\n");
      // Top-left box → PDF's bottom-left origin.
      const b = img.box;
      ops.push(`q ${num(b.w)} 0 0 ${num(b.h)} ${num(b.x)} ${num(pg.h - b.y - b.h)} cm /Im${ii} Do Q`);
    });
    for (const run of pg.texts ?? []) ops.push(textOps(run, pg.h));

    const content = ops.join("\n");
    offsets[contentN] = len;
    push(`${contentN} 0 obj\n<< /Length ${content.length} >>\nstream\n${content}\nendstream\nendobj\n`);

    const xobjects = images.map((_, ii) => `/Im${ii} ${imageN0 + ii} 0 R`).join(" ");
    const fonts = anyText
      ? ` /Font << ${FONT_NAMES.map((_, i) => `/F${i} ${fontBase + i} 0 R`).join(" ")} >>`
      : "";
    const boxes = bleed > 0
      ? `/MediaBox [${num(-bleed)} ${num(-bleed)} ${num(pg.w + bleed)} ${num(pg.h + bleed)}] /TrimBox [0 0 ${num(pg.w)} ${num(pg.h)}]`
      : `/MediaBox [0 0 ${num(pg.w)} ${num(pg.h)}]`;
    offsets[pageN] = len;
    push(`${pageN} 0 obj\n<< /Type /Page /Parent 2 0 R ${boxes} /Resources << /XObject << ${xobjects} >>${fonts} >> /Contents ${contentN} 0 R >>\nendobj\n`);
  });

  const xrefStart = len;
  push(`xref\n0 ${total + 1}\n0000000000 65535 f \n`);
  for (let n = 1; n <= total; n++) push(`${String(offsets[n]).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${total + 1} /Root 1 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`);
  const out = new Uint8Array(len);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

/** One full-page JPEG per page — the artboard/presentation/slideshow route. */
export function buildPDF(pages: { jpeg: Uint8Array; w: number; h: number }[]): Uint8Array {
  return buildPagesPDF(
    pages.map((p) => ({
      w: p.w,
      h: p.h,
      images: [{ jpeg: p.jpeg, w: p.w, h: p.h, box: { x: 0, y: 0, w: p.w, h: p.h } }],
    })),
  );
}

// ponytail: base-14 Helvetica only — no font embedding, no CMYK/ICC output
// intent, no compression (JPEGs are already compressed; the text streams are
// tiny). Embedding means a /FontFile2 stream plus a real /Widths array from the
// font file; press-ready CMYK means an /OutputIntent with the paper profile.
