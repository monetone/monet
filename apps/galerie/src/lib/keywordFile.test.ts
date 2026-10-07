// keywordFile spec — Metadata ▸ Import/Export Keywords: the tab-indented LR
// keyword file round-trips a nested vocabulary with synonyms and the
// Include-on-Export bracket, and import merges into an existing vocabulary
// instead of duplicating it.

import { describe, expect, it, vi } from "vitest";

import {
  importKeywordTree,
  parseKeywordFile,
  serializeKeywordFile,
  type KeywordCreate,
} from "./keywordFile";
import type { KeywordVocabRow } from "./xmpAutoWrite";

const row = (
  id: number,
  name: string,
  parentId: number | null = null,
  extra: Partial<KeywordVocabRow> = {},
): KeywordVocabRow => ({
  id,
  name,
  parentId,
  synonyms: "",
  includeOnExport: true,
  exportContaining: true,
  exportSynonyms: true,
  ...extra,
});

describe("serializeKeywordFile", () => {
  it("writes tabs for nesting, {synonyms} and [brackets] for non-exporting", () => {
    const rows = [
      row(1, "animal"),
      row(2, "dog", 1, { synonyms: "canine, hound" }),
      row(3, "puppy", 2, { includeOnExport: false }),
      row(4, "sunset"),
    ];
    expect(serializeKeywordFile(rows)).toBe(
      ["animal", "\tdog", "\t\t{canine}", "\t\t{hound}", "\t\t[puppy]", "sunset", ""].join("\n"),
    );
  });

  it("is empty for an empty vocabulary", () => {
    expect(serializeKeywordFile([])).toBe("");
  });
});

describe("parseKeywordFile", () => {
  it("round-trips what serializeKeywordFile writes", () => {
    const rows = [
      row(1, "animal"),
      row(2, "dog", 1, { synonyms: "canine, hound" }),
      row(3, "puppy", 2, { includeOnExport: false }),
      row(4, "sunset"),
    ];
    const { roots, skipped } = parseKeywordFile(serializeKeywordFile(rows));
    expect(skipped).toBe(0);
    expect(roots).toEqual([
      {
        name: "animal",
        synonyms: [],
        includeOnExport: true,
        children: [
          {
            name: "dog",
            synonyms: ["canine", "hound"],
            includeOnExport: true,
            children: [
              { name: "puppy", synonyms: [], includeOnExport: false, children: [] },
            ],
          },
        ],
      },
      { name: "sunset", synonyms: [], includeOnExport: true, children: [] },
    ]);
  });

  it("tolerates CRLF, blank lines and over-indentation", () => {
    const { roots, skipped } = parseKeywordFile("animal\r\n\r\n\t\t\tdog\r\n");
    expect(skipped).toBe(0);
    expect(roots.map((r) => r.name)).toEqual(["animal"]);
    expect(roots[0].children.map((c) => c.name)).toEqual(["dog"]);
  });

  it("skips names carrying keyword delimiters and promotes their children", () => {
    // "a|b" can never be one keyword name — the catalog rejects it.
    const { roots, skipped } = parseKeywordFile("animal\n\ta|b\n\t\tdog\n");
    expect(skipped).toBe(1);
    expect(roots[0].children.map((c) => c.name)).toEqual(["dog"]);
  });

  it("skips a synonym line with no keyword above it", () => {
    expect(parseKeywordFile("{orphan}\n")).toEqual({ roots: [], skipped: 1 });
  });
});

describe("importKeywordTree", () => {
  it("creates only what is missing and nests under the new parents", async () => {
    let nextId = 10;
    const create = vi.fn<(kw: KeywordCreate) => Promise<number>>(async () => nextId++);
    const { roots } = parseKeywordFile("animal\n\tdog\n\t\t{canine}\n\t[cat]\n");

    const result = await importKeywordTree(roots, [{ id: 1, name: "Animal" }], create);

    expect(result).toEqual({ created: 2, failed: 0 });
    // "Animal" already exists (case-insensitively) — reused as the parent.
    expect(create.mock.calls.map(([kw]) => kw)).toEqual([
      { name: "dog", parentId: 1, synonyms: "canine", includeOnExport: true },
      { name: "cat", parentId: 1, synonyms: "", includeOnExport: false },
    ]);
  });

  it("re-importing the same file creates nothing", async () => {
    const create = vi.fn<(kw: KeywordCreate) => Promise<number>>(async () => 99);
    const { roots } = parseKeywordFile("animal\n\tdog\n");
    const existing = [
      { id: 1, name: "animal" },
      { id: 2, name: "dog" },
    ];
    expect(await importKeywordTree(roots, existing, create)).toEqual({ created: 0, failed: 0 });
    expect(create).not.toHaveBeenCalled();
  });

  it("counts a failed create and drops its subtree rather than misfiling it", async () => {
    const create = vi.fn<(kw: KeywordCreate) => Promise<number>>(async (kw) => {
      if (kw.name === "animal") throw new Error("duplicate");
      return 7;
    });
    const { roots } = parseKeywordFile("animal\n\tdog\n");

    expect(await importKeywordTree(roots, [], create)).toEqual({ created: 0, failed: 1 });
    expect(create).toHaveBeenCalledTimes(1); // "dog" never gets an orphan parent
  });
});
