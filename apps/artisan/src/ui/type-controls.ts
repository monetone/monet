// ─────────────────────────────────────────────────────────────
// ui/type-controls — pure availability rules for the Type panel
// ─────────────────────────────────────────────────────────────
// Kept React-free so the rules are unit-testable without rendering the panel
// (which pulls Monet components bound to a separate React copy).

import type { TextAlign, TextItem } from "../engine";

/** Whether a paragraph-alignment option should be disabled for `text`. Justify
 *  only applies to area type (wrapped); point text has no justify in Illustrator
 *  and SVG `text-anchor` can't express it. */
export const isAlignDisabled = (value: TextAlign, text: Pick<TextItem, "boxWidth">): boolean =>
  value === "justify" && !text.boxWidth;

export const togglePressed = <T>(items: T[], predicate: (item: T) => boolean): boolean | "mixed" => {
  const enabled = items.filter(predicate).length;
  return enabled === 0 ? false : enabled === items.length ? true : "mixed";
};
