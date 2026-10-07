// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { makeDocument } from "../engine";
import {
  buildExportForScreensManifest,
  createExportCompatibilityReport,
  type ExportContractOptions,
} from "./compatibility";
import { importFile } from "./import";
import { importPDForAI } from "./import/pdf";

const bytes = (s: string): Uint8Array => new TextEncoder().encode(s);
const latin1Bytes = (s: string): Uint8Array => new Uint8Array(Array.from(s, (c) => c.charCodeAt(0) & 0xff));
const issueCodes = (result: { report: { issues: { code: string }[] } }) => result.report.issues.map((issue) => issue.code);

describe("import compatibility reports", () => {
  it("reports SVG fidelity that the importer intentionally drops", async () => {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg">
      <style>rect { filter: url(#fx); }</style>
      <filter id="fx"><feColorMatrix type="saturate" values="0"/></filter>
      <foreignObject width="20" height="20"><div>HTML</div></foreignObject>
      <switch><rect width="2" height="2"/></switch>
      <image width="8" height="8" href="https://example.test/tracker.png"/>
      <rect width="10" height="10"/>
    </svg>`;

    const result = await importFile("unsafe.svg", bytes(svg));

    expect(result.report.format).toBe("svg");
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      "svg-stylesheet-rules-ignored",
      "svg-filter-primitive-dropped",
      "svg-foreignobject-dropped",
      "svg-switch-conditions-approximated",
      "svg-external-image-dropped",
    ]));
    expect(result.warnings.some((warning) => warning.includes("blocked and dropped"))).toBe(true);
  });

  it("reports unsupported PDF operators instead of silently dropping them", async () => {
    const pdf = `%PDF-1.4
3 0 obj<</Type/Page/MediaBox[0 0 100 100]/Contents 4 0 R>>endobj
4 0 obj<</Length 160>>stream
10 10 30 30 re W n
BT /F1 12 Tf (Hello) Tj ET
/Im0 Do
/GS0 gs
0 0 10 10 re f
endstream endobj
trailer<</Root 1 0 R>>
%%EOF`;

    const result = await importPDForAI(latin1Bytes(pdf), "pdf");

    expect(result.doc.layers[0].items.length).toBe(1);
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      "pdf-vector-subset-import",
      "pdf-text-operators-dropped",
      "pdf-image-operators-dropped",
      "pdf-clipping-operators-dropped",
      "pdf-transparency-dropped",
    ]));
  });

  it("reports legacy EPS/AI native edit data and text loss", async () => {
    const eps = `%!PS-Adobe-3.0 EPSF-3.0
%%Creator: Adobe Illustrator
30 30 m 90 30 L 90 90 L f
(Live text) show
%%EOF`;

    const result = await importFile("legacy.eps", latin1Bytes(eps));

    expect(result.report.format).toBe("ai");
    expect(result.report.sourceName).toBe("legacy.eps");
    expect(issueCodes(result)).toEqual(expect.arrayContaining([
      "ai-native-edit-data-not-imported",
      "ai-text-operators-dropped",
    ]));
  });
});

describe("export compatibility contract", () => {
  it("models all advertised export options and reports unsupported formats", () => {
    const options: ExportContractOptions[] = [
      { format: "svg", background: true, preserveEditability: true },
      { format: "pdf", compatibility: "pdf-1.7" },
      { format: "png", scale: 2, transparent: true },
      { format: "jpeg", quality: 0.85 },
      { format: "webp", quality: 0.8 },
      { format: "tiff", compression: "lzw" },
    ];

    const reports = options.map((option) => createExportCompatibilityReport(option));

    expect(reports.find((report) => report.format === "svg")?.issues).toHaveLength(0);
    expect(reports.find((report) => report.format === "png")?.issues).toHaveLength(0);
    expect(reports.find((report) => report.format === "pdf")?.issues[0]?.code).toBe("pdf-export-unsupported");
    expect(reports.find((report) => report.format === "jpeg")?.issues[0]?.code).toBe("jpeg-export-unsupported");
    expect(reports.find((report) => report.format === "webp")?.issues[0]?.code).toBe("webp-export-unsupported");
    expect(reports.find((report) => report.format === "tiff")?.issues[0]?.code).toBe("tiff-export-unsupported");
  });

  it("builds an export-for-screens manifest for slices with unsupported-format issues", () => {
    const doc = makeDocument("Export Doc", 100, 100);
    doc.slices = [{ id: "S1", name: "Hero Tile", x: 10, y: 20, width: 30, height: 40 }];

    const manifest = buildExportForScreensManifest(doc, {
      formats: ["svg", "png", "pdf", "tiff"],
      generatedAt: "2026-01-01T00:00:00.000Z",
      scale: 2,
    });

    expect(manifest.manifestPath).toBe("Export-Doc-export-for-screens.json");
    expect(manifest.entries).toHaveLength(1);
    expect(manifest.entries[0]).toMatchObject({
      source: "slice",
      id: "S1",
      region: { x: 10, y: 20, width: 30, height: 40 },
    });
    expect(manifest.entries[0].files.map((file) => [file.format, file.supported])).toEqual([
      ["svg", true],
      ["png", true],
      ["pdf", false],
      ["tiff", false],
    ]);
    expect(manifest.entries[0].files[0].filename).toBe("Export-Doc-slice-Hero-Tile-01@2x.svg");
    expect(manifest.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "pdf-export-unsupported",
      "tiff-export-unsupported",
    ]));
  });
});
