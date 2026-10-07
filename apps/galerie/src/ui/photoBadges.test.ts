import { describe, expect, it } from "vitest";

import { hasBadges, LABEL_COLORS, photoBadges } from "./photoBadges";

describe("photoBadges", () => {
  it("passes the flag + rating through and resolves the label colour", () => {
    expect(photoBadges({ flag: 1, rating: 4, colorLabel: "green" })).toEqual({
      flag: 1,
      rating: 4,
      labelColor: LABEL_COLORS.green,
    });
  });

  it("yields no label colour for a null or unknown label", () => {
    expect(photoBadges({ flag: 0, rating: 0, colorLabel: null }).labelColor).toBeNull();
    expect(photoBadges({ flag: 0, rating: 0, colorLabel: "chartreuse" }).labelColor).toBeNull();
  });

  it("carries the reject flag", () => {
    expect(photoBadges({ flag: -1, rating: 0, colorLabel: null }).flag).toBe(-1);
  });
});

describe("hasBadges", () => {
  it("is false only when unflagged, unrated, and unlabelled (or an unknown label)", () => {
    expect(hasBadges(photoBadges({ flag: 0, rating: 0, colorLabel: null }))).toBe(false);
    expect(hasBadges(photoBadges({ flag: 0, rating: 0, colorLabel: "nope" }))).toBe(false);
  });

  it("is true for any pick, reject, rating, or known label", () => {
    expect(hasBadges(photoBadges({ flag: 1, rating: 0, colorLabel: null }))).toBe(true);
    expect(hasBadges(photoBadges({ flag: -1, rating: 0, colorLabel: null }))).toBe(true);
    expect(hasBadges(photoBadges({ flag: 0, rating: 3, colorLabel: null }))).toBe(true);
    expect(hasBadges(photoBadges({ flag: 0, rating: 0, colorLabel: "red" }))).toBe(true);
  });
});
