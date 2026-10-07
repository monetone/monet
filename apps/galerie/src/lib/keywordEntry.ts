// keywordEntry — Lightroom Classic keyword-entry parsing (finding 18).
//
// LR treats commas and semicolons as list delimiters ("dog, cat") and |, >, <
// as hierarchy delimiters ("animal > dog" nests dog under animal; "dog < animal"
// is the same pair reversed); none of these may appear inside a keyword name.
// Each entry becomes a canonical "|"-joined root→leaf path ("animal|dog") —
// the catalog's add_keyword walks the path, creating missing levels and
// tagging the photo with the leaf. Pure — the KeywordsBar applies each path
// via the catalog.

/** Split a keyword-entry string into an ordered, case-insensitively deduped
 *  list of "|"-joined keyword paths to apply ("animal > dog, sunset" →
 *  ["animal|dog", "sunset"]). Empty segments/entries are dropped. */
export function parseKeywordEntry(input: string): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const item of input.split(/[,;]+/)) {
    // ponytail: "<" flips the whole entry leaf→root; an entry mixing < with
    // >/| falls back to forward order rather than resolving per-delimiter.
    const reversed = item.includes("<") && !/[>|]/.test(item);
    const segs = item
      .split(/[|<>]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (reversed) segs.reverse();
    if (segs.length === 0) continue;
    const path = segs.join("|");
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(path);
  }
  return out;
}
