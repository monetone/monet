import { describe, expect, it } from "vitest";
import { MAX_PERSISTED_NOTES } from "./notes";
import { MAX_NOTE_IMPORT_BYTES, parseImportedNotes } from "./noteImport";

const bytes = (source: string) => new TextEncoder().encode(source);

describe("PDF/FDF note import", () => {
  it("reads inline FDF text annotations without duplicating their parent dictionaries", () => {
    const source = String.raw`%FDF-1.2
1 0 obj
<< /FDF << /Annots [
  << /Type /Annot /Subtype /Text /Rect [10 100 20 110]
     /Contents (Check \(edge\)\nA\101) /T (Ada) >>
  << /Type /Annot /Subtype /Text /Rect [50 20 60 30]
     /Contents (Second (nested)) >>
] >> >>
endobj
%%EOF`;

    expect(parseImportedNotes(bytes(source), 200, 140)).toEqual([
      { x: 10, y: 30, text: "Check (edge)\nAA", author: "Ada" },
      { x: 50, y: 110, text: "Second (nested)", author: "" },
    ]);
  });

  it("scales PDF MediaBox coordinates and decodes UTF-16 hex strings", () => {
    const source = `%PDF-1.7
1 0 obj << /Type /Page /MediaBox [0 0 400 280] >> endobj
2 0 obj << /Type /Annot /Subtype /Text /Rect [100 140 120 160]
  /Contents <FEFF004800690020D83DDE80> /T <FEFF004100640061> >> endobj
%%EOF`;

    expect(parseImportedNotes(bytes(source), 200, 140)).toEqual([
      { x: 50, y: 60, text: "Hi 🚀", author: "Ada" },
    ]);
  });

  it("scales with the FIRST page's MediaBox, not the smallest dictionary (#156)", () => {
    // Page 1 is US Letter but its dictionary is padded fat; page 2 is a compact
    // A4. The annotation belongs to page 1 and sits at its very top, so the
    // Letter box puts it at y = 0. Sorting the scan by dictionary size picked the
    // A4 box instead and pushed the note ~6% down the document.
    const source = `%PDF-1.7
1 0 obj << /Type /Page /MediaBox [0 0 612 792] /Note (${"pad ".repeat(60)}) >> endobj
2 0 obj << /Type /Annot /Subtype /Text /Rect [0 782 10 792] /Contents (top) >> endobj
3 0 obj << /Type /Page /MediaBox [0 0 595 842] >> endobj
%%EOF`;

    expect(parseImportedNotes(bytes(source), 612, 792)).toEqual([
      { x: 0, y: 0, text: "top", author: "" },
    ]);
  });

  it("ignores non-text and malformed annotations", () => {
    const source = `%FDF-1.2
<< /FDF << /Annots [
  << /Subtype /Link /Rect [1 2 3 4] /Contents (link) >>
  << /Subtype /Text /Contents (no rectangle) >>
  << /Subtype /Text /Rect [1 nope 3 4] /Contents (bad rectangle) >>
  << /Subtype /Text /Rect [1 2 3 4] /Contents (valid) >>
] >> >>`;

    expect(parseImportedNotes(bytes(source), 100, 100)).toEqual([
      { x: 1, y: 96, text: "valid", author: "" },
    ]);
    expect(parseImportedNotes(bytes("not a PDF"), 100, 100)).toEqual([]);
    expect(parseImportedNotes(bytes(source), 0, 100)).toEqual([]);

    const streamed = `%PDF-1.7
1 0 obj << /Length 72 >> stream
<< /Subtype /Text /Rect [50 50 60 60] /Contents (inside a content stream) >>
endstream endobj
2 0 obj << /Subtype /Text /Rect [5 6 7 8] /Contents (real annotation) >> endobj`;
    expect(parseImportedNotes(bytes(streamed), 100, 100)).toEqual([
      { x: 5, y: 92, text: "real annotation", author: "" },
    ]);
  });

  it("caps imported annotations at the shared note persistence bound", () => {
    const annotations = Array.from({ length: MAX_PERSISTED_NOTES + 5 }, (_, i) =>
      `<< /Subtype /Text /Rect [${i} 0 ${i + 1} 1] /Contents (${i}) >>`,
    ).join("\n");
    const parsed = parseImportedNotes(bytes(`%FDF-1.2\n<< /FDF << /Annots [${annotations}] >> >>`), 2000, 100);
    expect(parsed).toHaveLength(MAX_PERSISTED_NOTES);
    expect(parsed[0].text).toBe("0");
    expect(parsed[MAX_PERSISTED_NOTES - 1].text).toBe(String(MAX_PERSISTED_NOTES - 1));
  });

  it("exports and enforces the 20 MiB input ceiling", () => {
    expect(MAX_NOTE_IMPORT_BYTES).toBe(20 * 1024 * 1024);
    expect(parseImportedNotes(new Uint8Array(MAX_NOTE_IMPORT_BYTES + 1), 100, 100)).toEqual([]);
  });
});
