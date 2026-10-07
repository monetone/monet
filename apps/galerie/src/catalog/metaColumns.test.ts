// The Metadata browser's column ids are a wire contract: the frontend sends
// them in `PhotoFilter.meta` / asks for them in `listFilterOptions`, and
// catalog.rs resolves each to the SQL that produces the column's value. Nothing
// else links the two lists, so this test is the link — drift here means a
// column that silently filters nothing.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { META_COLUMNS } from "./types";

const RUST = readFileSync(
  fileURLToPath(new URL("../../src-tauri/src/catalog.rs", import.meta.url)),
  "utf8",
);

/** The ids in catalog.rs's `META_COLUMNS` table plus the join-backed keyword
 *  column, which lives in its own const. */
function rustColumnIds(): string[] {
  const start = RUST.indexOf("const META_COLUMNS: &[(&str, &str)] = &[");
  expect(start, "META_COLUMNS table not found in catalog.rs").toBeGreaterThan(-1);
  const end = RUST.indexOf("\n];", start);
  const table = RUST.slice(start, end);
  const ids = [...table.matchAll(/\(\s*"([a-z]+)",/g)].map((m) => m[1]);
  const keyword = /const META_KEYWORD: &str = "([a-z]+)";/.exec(RUST);
  expect(keyword, "META_KEYWORD not found in catalog.rs").not.toBeNull();
  return [...ids, keyword![1]];
}

describe("Metadata browser columns", () => {
  it("offers the same column ids the Rust catalog can resolve", () => {
    const ts = META_COLUMNS.map((c) => c.id);
    expect([...ts].sort()).toEqual([...rustColumnIds()].sort());
  });

  it("has unique ids and a label for every column", () => {
    const ids = META_COLUMNS.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of META_COLUMNS) expect(c.label.trim()).not.toBe("");
  });

  it("keeps the three date granularities LR drills through", () => {
    const ids = META_COLUMNS.map((c) => c.id);
    for (const d of ["year", "month", "day"]) expect(ids).toContain(d);
  });
});
