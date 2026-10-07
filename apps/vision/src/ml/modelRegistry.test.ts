import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MODEL_REGISTRY, modelBytes, prettyBytes } from "./modelRegistry";

// The registry is the app-side source of truth for AI models; checksums.txt is
// the CI integrity gate for what actually ships in git. Plan 02 D1 requires them
// to stay in exact lockstep: files of bundled entries must equal the
// checksums.txt set, both directions (rel + sha256).
// Non-bundled real weights (drunet, sd15/**) are deliberately absent from
// checksums.txt (gitignored) and must not leak into that set.

function parseChecksums(): Map<string, string> {
  const text = readFileSync(new URL("../../public/models/checksums.txt", import.meta.url), "utf8");
  const map = new Map<string, string>();
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const [sha, path] = trimmed.split(/\s+/);
    const rel = path.replace(/^public\/models\//, "");
    map.set(rel, sha);
  }
  return map;
}

describe("MODEL_REGISTRY", () => {
  it("has unique ids", () => {
    const ids = MODEL_REGISTRY.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("declares a positive byte size for every real-weight file", () => {
    for (const def of MODEL_REGISTRY) {
      for (const f of def.files) {
        expect(f.bytes, `${def.id}:${f.rel}`).toBeGreaterThan(0);
      }
    }
  });

  it("never exposes a partial or unpinned hosted model", () => {
    for (const def of MODEL_REGISTRY) {
      const hosted = def.files.filter((file) => file.url);
      expect(hosted.length === 0 || hosted.length === def.files.length, def.id).toBe(true);
      for (const file of hosted) {
        expect(file.url, `${def.id}:${file.rel}`).toMatch(/^https:\/\//);
        expect(file.sha256, `${def.id}:${file.rel}`).toMatch(/^[0-9a-f]{64}$/);
      }
      if (hosted.length) expect(def.license, def.id).not.toMatch(/^(?:TBD|Unverified)\b/i);
    }
  });

  it("is in exact lockstep with checksums.txt", () => {
    const registrySet = new Map<string, string>();
    for (const def of MODEL_REGISTRY) {
      if (def.bundled) for (const f of def.files) registrySet.set(f.rel, f.sha256);
    }
    const checksums = parseChecksums();

    // Both directions: same rels, same sha256 for each.
    expect([...registrySet.keys()].sort()).toEqual([...checksums.keys()].sort());
    for (const [rel, sha] of registrySet) expect(checksums.get(rel), rel).toBe(sha);
  });

  it("keeps non-bundled real weights out of the checksums set", () => {
    const checksums = parseChecksums();
    for (const def of MODEL_REGISTRY) {
      if (def.bundled) continue;
      for (const f of def.files) expect(checksums.has(f.rel), f.rel).toBe(false);
    }
  });
});

describe("size helpers", () => {
  it("sums a unit's real weights", () => {
    const sd15 = MODEL_REGISTRY.find((d) => d.id === "sd15")!;
    expect(modelBytes(sd15)).toBe(sd15.files.reduce((n, f) => n + f.bytes, 0));
    expect(modelBytes(sd15)).toBeGreaterThan(2e9);
  });
  it("formats bytes", () => {
    expect(prettyBytes(240078)).toBe("240 KB");
    expect(prettyBytes(29546882)).toBe("29.5 MB");
    expect(prettyBytes(2402551426)).toBe("2.4 GB");
  });
});
