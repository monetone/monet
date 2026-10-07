// ─────────────────────────────────────────────────────────────
// model/typography — shaping-ready text metadata helpers
// ─────────────────────────────────────────────────────────────

import type { FontFallback, FontResolution, TextItem } from "./types";

const genericFamilies = new Set(["serif", "sans-serif", "monospace", "cursive", "fantasy", "system-ui"]);

const familyParts = (family: string): string[] =>
  family
    .split(",")
    .map((part) => part.trim().replace(/^["']|["']$/g, ""))
    .filter(Boolean);

export const inferFontFallbacks = (fontFamily: string): FontFallback[] =>
  familyParts(fontFamily).map((family) => ({
    family,
    status: "unresolved",
    source: genericFamilies.has(family.toLowerCase()) ? "generic" : "system",
  }));

export const fontResolutionForText = (item: TextItem): FontResolution =>
  item.fontResolution ?? {
    requestedFamily: item.fontFamily,
    status: "unresolved",
    fallbacks: inferFontFallbacks(item.fontFamily),
  };

export const invalidateTextLayout = (item: TextItem): void => {
  item.layout = undefined;
};
