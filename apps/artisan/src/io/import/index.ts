// ─────────────────────────────────────────────────────────────
// io/import — unified import dispatcher (magic bytes + extension)
// ─────────────────────────────────────────────────────────────

import { containerAppForExtension } from "@monet-ui/monet-format";
import { type Document, IO, Ops } from "../../engine";
import {
  analyzeSvgImportCompatibility,
  createImportCompatibilityReport,
  type ImportCompatibilityReport,
  type ImportFormat,
  mergeCompatibilityWarnings,
} from "../compatibility";
import { importSVG } from "./svg";
import { gunzip } from "./inflate";

export interface ImportResult {
  doc: Document;
  warnings: string[];
  report: ImportCompatibilityReport;
}

const latin1 = (b: Uint8Array, n = 256): string => {
  let s = "";
  const len = Math.min(n, b.length);
  for (let i = 0; i < len; i++) s += String.fromCharCode(b[i]);
  return s;
};

const textOf = (b: Uint8Array): string => new TextDecoder("utf-8").decode(b);
const ext = (name: string): string => (name.split(".").pop() ?? "").toLowerCase();

/** A Monet container is not an `ImportFormat` \u2014 it needs the wasm engine kept
 *  alive as a courier, so `io/commands` routes it before the pure importers ever
 *  see it. Widening here rather than in `io/compatibility` keeps the
 *  compatibility report vocabulary about *lossy* imports, which this is not. */
export type DetectedFormat = ImportFormat | "container";

const MANIFEST = "manifest.json";

/** A Monet container of ANY app: the STORE-only zip whose first entry is always
 *  `manifest.json` (docs/plans/11-universal-container.md). Checked ahead of the
 *  generic `PK` sniff, which would otherwise claim it as a CorelDRAW X4/X5 zip
 *  and hand back a plausible, empty document.
 *  ponytail: the same sniff as `monet-format`'s `isContainer`, open-coded because
 *  `detectFormat` is synchronous and `isContainer` needs the WASM booted. Drop it
 *  the day the dispatcher can await. */
export function isMonetContainer(bytes: Uint8Array): boolean {
  if (bytes.length < 30 + MANIFEST.length || latin1(bytes, 4) !== "PK\x03\x04") return false;
  const nameLen = bytes[26] | (bytes[27] << 8);
  return nameLen === MANIFEST.length && latin1(bytes.subarray(30, 30 + nameLen), nameLen) === MANIFEST;
}

/** The `"format"` discriminator of a JSON head, when there is one. Every Monet
 *  writer stamps one first ("monet-artisan" for a document, "monet" for a
 *  container manifest / `.monet` envelope). */
const jsonFormatTag = (head: string): string | null => /"format"\s*:\s*"([^"]{0,64})"/.exec(head)?.[1] ?? null;

/** Detect a format key from the bytes (authoritative) then the filename. */
export function detectFormat(name: string, bytes: Uint8Array): DetectedFormat {
  const head = latin1(bytes, 1024);
  if (head.startsWith("%PDF")) return "pdf"; // includes PDF-compatible .ai
  if (head.startsWith("%!PS") || head.includes("Adobe Illustrator")) return "ai";
  if (head.startsWith("\xC5\xD0\xD3\xC6")) return "ai"; // EPSF binary header
  if (head.startsWith("RIFF") && head.slice(8, 11).toLowerCase() === "cdr") return "cdr";
  if (isMonetContainer(bytes)) return "container"; // must precede the PK sniff
  if (head.startsWith("PK\x03\x04")) return "zip"; // CorelDRAW X4/X5 container
  const trimmed = head.replace(/^\uFEFF/, "").trimStart();
  if (trimmed.startsWith("<")) return "svg";
  if (trimmed.startsWith("{")) {
    // A leading `{` is not evidence of an Artisan document. A Cinema/Rythme
    // `.monet`, a `monet-graphics` manifest and a package.json all start with
    // one, so read the discriminator: only our own tag is an Artisan document,
    // and anything else reports what it actually is instead of dying as "not a
    // valid Artisan document".
    return jsonFormatTag(head) === IO.ARTISAN_FORMAT ? "artisan" : "unknown";
  }
  // extension fallback
  const e = ext(name);
  if (containerAppForExtension(`.${e}`)) return "container";
  if (e === "svg" || e === "svgz") return "svg";
  if (e === "ai") return "ai";
  if (e === "eps" || e === "ps") return "ai";
  if (e === "pdf") return "pdf";
  if (e === "cdr") return "cdr";
  if (e === "artisan") return "artisan";
  return "unknown";
}

export async function importFile(name: string, bytes: Uint8Array): Promise<ImportResult> {
  const fmt = detectFormat(name, bytes);
  const base = (name.replace(/\.[^.]+$/, "") || "Imported").split("/").pop()!;
  const warnings: string[] = [];

  let result: ImportResult;
  switch (fmt) {
    case "svg": {
      const source = bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b ? await gunzip(bytes) : bytes;
      const text = textOf(source);
      const doc = importSVG(text);
      doc.name = base;
      const report = analyzeSvgImportCompatibility(text, name);
      result = { doc, warnings: mergeCompatibilityWarnings(warnings, report), report };
      break;
    }
    case "artisan": {
      const doc = IO.deserializeDocument(textOf(bytes));
      const report = createImportCompatibilityReport("artisan", { sourceName: name });
      result = { doc, warnings, report };
      break;
    }
    case "pdf":
    case "ai": {
      const mod = await import("./pdf");
      result = await mod.importPDForAI(bytes, fmt as "pdf" | "ai");
      result.doc.name = base;
      break;
    }
    case "cdr":
    case "zip": {
      const mod = await import("./cdr");
      result = fmt === "zip" ? await mod.importCDRZip(bytes) : await mod.importCDR(bytes);
      result.doc.name = base;
      break;
    }
    case "container":
      // io/commands routes containers to the courier before reaching here;
      // landing in the pure importer means a caller bypassed that path.
      throw new Error(`"${name}" is a Monet container — it must be opened through the container courier.`);
    default: {
      const tag = jsonFormatTag(latin1(bytes, 1024));
      throw new Error(tag ? `"${name}" is a "${tag}" document, not a Monet Artisan document.` : `Unsupported file format for "${name}"`);
    }
  }

  if (!result.report.sourceName) {
    result = { ...result, report: { ...result.report, sourceName: name } };
  }
  result = { ...result, warnings: mergeCompatibilityWarnings(result.warnings, result.report) };

  // Re-mint ids only when the imported document actually contains id collisions
  // (a malformed/hostile file). Well-formed docs keep their ids untouched — the
  // format importers already mint fresh session-unique ids, and the `.artisan`
  // round-trip must stay byte-identical (lossless save/reopen). This still
  // upholds findItem's within-document uniqueness invariant (SEC-M2 / AR-H3/H4).
  if (Ops.Items.hasDuplicateItemIds(result.doc)) Ops.Items.reidDocument(result.doc);
  return result;
}
