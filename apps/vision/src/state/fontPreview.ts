export const FONT_PREVIEW_CHOICES = [
  { value: "none", label: "None", command: "fontpreviewnone", fontSize: 0, minHeight: 26 },
  { value: "small", label: "Small", command: "fontpreviewsmall", fontSize: 12, minHeight: 26 },
  { value: "medium", label: "Medium", command: "fontpreviewmedium", fontSize: 16, minHeight: 30 },
  { value: "large", label: "Large", command: "fontpreviewlarge", fontSize: 20, minHeight: 34 },
  { value: "extraLarge", label: "Extra Large", command: "fontpreviewextralarge", fontSize: 24, minHeight: 38 },
  { value: "huge", label: "Huge", command: "fontpreviewhuge", fontSize: 30, minHeight: 44 },
] as const;

export type FontPreviewSize = (typeof FONT_PREVIEW_CHOICES)[number]["value"];

export const DEFAULT_FONT_PREVIEW_SIZE: FontPreviewSize = "medium";

export function normalizeFontPreviewSize(value: unknown): FontPreviewSize {
  return FONT_PREVIEW_CHOICES.some((choice) => choice.value === value)
    ? value as FontPreviewSize
    : DEFAULT_FONT_PREVIEW_SIZE;
}

export function fontPreviewOptionStyle(font: string, size: FontPreviewSize): {
  fontFamily: string;
  fontSize: number;
  minHeight: number;
  lineHeight: number;
} | undefined {
  const choice = FONT_PREVIEW_CHOICES.find((entry) => entry.value === size)!;
  return choice.fontSize === 0 ? undefined : {
    fontFamily: font,
    fontSize: choice.fontSize,
    minHeight: choice.minHeight,
    lineHeight: 1.1,
  };
}
