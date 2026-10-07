export type FontFamilyClass = "sans" | "serif" | "mono" | "display";
export type FontMatchConfidence = "High" | "Medium" | "Low";

export interface FontMatchStyle {
  bold?: boolean;
  italic?: boolean;
  fauxBold?: boolean;
  fauxItalic?: boolean;
}

export interface RankedFontMatch {
  font: string;
  display: string;
  score: number;
  confidence: number;
  confidenceLabel: FontMatchConfidence;
}

const TOKEN_STOPWORDS = new Set([
  "apple",
  "geneva",
  "linotype",
  "monospace",
  "ms",
  "new",
  "palatino",
  "sans",
  "serif",
  "system",
  "ui",
]);

const normalizeFont = (font: string) => font.toLowerCase().replace(/["']/g, "").replace(/\s+/g, " ").trim();

export function fontDisplayName(font: string): string {
  return font.split(",")[0].replace(/["']/g, "").trim();
}

export function fontFamilyClass(font: string): FontFamilyClass {
  const f = normalizeFont(font);
  if (/\b(impact|haettenschweiler)\b/.test(f)) return "display";
  if (/\b(mono|monospace|courier|menlo|monaco|consolas)\b/.test(f)) return "mono";
  const withoutSansGeneric = f.replace(/\bsans-serif\b/g, "sans");
  if (/\b(serif|georgia|times|palatino|garamond|baskerville|bodoni)\b/.test(withoutSansGeneric)) return "serif";
  return "sans";
}

export function fontTokens(font: string): string[] {
  const seen = new Set<string>();
  const tokens = normalizeFont(font)
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length > 1 && !TOKEN_STOPWORDS.has(t));
  return tokens.filter((t) => {
    if (seen.has(t)) return false;
    seen.add(t);
    return true;
  });
}

export function fontMatchScore(target: string, candidate: string, style: FontMatchStyle = {}): number {
  const targetNorm = normalizeFont(target);
  const candidateNorm = normalizeFont(candidate);
  let score = 0;

  if (targetNorm === candidateNorm) score += 1000;
  if (normalizeFont(fontDisplayName(target)) === normalizeFont(fontDisplayName(candidate))) score += 500;

  const targetClass = fontFamilyClass(target);
  const candidateClass = fontFamilyClass(candidate);
  if (targetClass === candidateClass) score += 240;

  const candidateTokens = new Set(fontTokens(candidate));
  for (const token of fontTokens(target)) {
    if (candidateTokens.has(token)) score += 70;
  }

  const italic = style.italic || style.fauxItalic;
  const bold = style.bold || style.fauxBold;
  if (italic && /\b(italic|oblique)\b/.test(candidateNorm)) score += 20;
  if (!italic && /\b(italic|oblique)\b/.test(candidateNorm)) score -= 20;
  if (bold && /\b(bold|black|heavy|impact)\b/.test(candidateNorm)) score += 16;
  if (!bold && targetClass !== "display" && candidateClass === "display") score -= 16;

  return score;
}

export function fontMatchConfidence(score: number): number {
  if (score >= 1000) return 100;
  return Math.round(Math.max(0, Math.min(99, score / 5)));
}

export function fontMatchConfidenceLabel(confidence: number): FontMatchConfidence {
  if (confidence >= 75) return "High";
  if (confidence >= 50) return "Medium";
  return "Low";
}

export function rankFontMatches(target: string, candidates: string[], style: FontMatchStyle = {}): RankedFontMatch[] {
  return candidates
    .map((font, index) => {
      const score = fontMatchScore(target, font, style);
      const confidence = fontMatchConfidence(score);
      return {
        font,
        display: fontDisplayName(font),
        index,
        score,
        confidence,
        confidenceLabel: fontMatchConfidenceLabel(confidence),
      };
    })
    .sort((a, b) => (b.score - a.score) || (a.index - b.index))
    .map(({ index: _index, ...match }) => match);
}

export function rankFontCandidates(target: string, candidates: string[], style: FontMatchStyle = {}): string[] {
  return rankFontMatches(target, candidates, style).map(({ font }) => font);
}
