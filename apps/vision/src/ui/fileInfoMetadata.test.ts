import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// VIS-META-01: File ▸ File Info is the document's XMP editor, and Export As
// chooses how much of it an export carries. Source-level wiring check (same
// idiom as colorExportWiring.test.ts) — the packet-level proof lives in the
// engine tests under `mod file_info_metadata`.
const source = readFileSync(fileURLToPath(new URL("./Dialogs.tsx", import.meta.url)), "utf8");

function body(start: string, end: string): string {
  const from = source.indexOf(start);
  expect(from, `missing anchor: ${start}`).toBeGreaterThanOrEqual(0);
  const to = source.indexOf(end, from + start.length);
  expect(to, `missing anchor: ${end}`).toBeGreaterThan(from);
  return source.slice(from, to);
}

const fileInfo = body("function FileInfo() {", "\n/** Export As ▸ Metadata");

describe("VIS-META-01 — File Info authors the document's metadata", () => {
  it("writes the edited fields back to the engine and dirties the document", () => {
    expect(fileInfo).toContain("engine.e.set_document_metadata(");
    // Without this the user can close a document and silently lose the fields.
    expect(fileInfo).toContain("store.markDirty()");
  });

  it("gives every stored field a control", () => {
    const fields = body("interface FileInfoFields {", "\n}");
    const keys = [...fields.matchAll(/^ {2}(\w+):/gm)].map((match) => match[1]);
    expect(keys.length).toBeGreaterThan(10);
    for (const key of keys) {
      expect(fileInfo, `FileInfoFields.${key} has no control in the dialog`).toContain(key);
    }
  });
});

describe("VIS-META-01 — Export As chooses the metadata scope", () => {
  const exportPrefs = body("function ExportPrefs() {", "\n// ── Save for Web");
  const from = exportPrefs.indexOf("  const commit = () => {");
  const commit = exportPrefs.slice(from, exportPrefs.indexOf("\n  };", from));

  it("hands the Metadata choice to that export and does not leave it on the engine", () => {
    expect(commit).toContain("rememberExportAsMetadata(scope)");
    expect(commit.indexOf("rememberExportAsMetadata(scope)")).toBeLessThan(commit.indexOf("exportAs("));
    expect(commit).toContain("exportAs(baseName, normalizedRows, format, quality, scope)");
    expect(commit).not.toContain("set_export_metadata_scope(");
  });

  it("offers Photoshop's four scopes, matching the engine's codes", () => {
    const scopes = body("const EXPORT_METADATA_SCOPES = [", "\n];");
    expect(scopes).toContain('{ value: "0", label: "None" }');
    expect(scopes).toContain('{ value: "3", label: "All" }');
    expect(scopes).toContain("Copyright and Contact Info");
  });
});
