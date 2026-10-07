import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// A literal NUL byte in a source file makes the WHOLE FILE binary to grep,
// file(1) and most diff viewers — they silently match nothing rather than
// erroring. That has bitten this repo twice: both times someone wrote a cache
// key as `${a}\0${b}` with a raw NUL instead of the two-character escape, and both
// times it produced a confident-but-false "this code is unused" conclusion,
// because every grep for the symbols inside came back empty.
//
// The escape is byte-identical at runtime, so there is never a reason to embed
// the raw byte. This guard fails the moment one reappears.
const ROOTS = ["apps", "packages"];
const SKIP = new Set(["node_modules", "target", "pkg", "dist", ".git", "engine"]);
const EXT = /\.(ts|tsx|rs|css|json|md)$/;

/** Every source file under `dir`, skipping build output and vendored trees. */
function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out; // unreadable dir (permissions, race) — not this test's business
  }
  for (const name of entries) {
    if (SKIP.has(name)) continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (EXT.test(name)) out.push(full);
  }
  return out;
}

describe("source files stay greppable", () => {
  it("embeds no literal NUL byte in any source file", () => {
    const repo = fileURLToPath(new URL("../../../../", import.meta.url));
    const offenders: string[] = [];
    for (const root of ROOTS) {
      for (const file of walk(join(repo, root))) {
        // The hardening fixtures deliberately carry control bytes as test data.
        if (file.endsWith("developRecipeHardening.test.ts")) continue;
        let bytes: Buffer;
        try {
          bytes = readFileSync(file);
        } catch (error) {
          // Another test may remove a generated fixture after walk() observed it.
          if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
          throw error;
        }
        if (bytes.includes(0)) offenders.push(file.slice(repo.length));
      }
    }
    expect(
      offenders,
      `write \\u0000 instead of a raw NUL — these files are invisible to grep:\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
