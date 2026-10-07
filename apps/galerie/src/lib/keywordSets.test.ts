// keywordSets spec — the pure model + recents ring behind LR Keyword Sets.

import { afterEach, describe, expect, it } from "vitest";

import {
  BUILT_IN_SETS,
  MAX_KEYWORDS,
  RECENT_SET_NAME,
  clampKeywords,
  isApplied,
  keywordSets,
  pushRecent,
  recentKeywords,
  recordKeywordUse,
  resetRecentKeywords,
  subscribeRecent,
  toggleKeyword,
} from "./keywordSets";

afterEach(resetRecentKeywords);

describe("isApplied", () => {
  const kws = [
    { id: 1, name: "Sky" },
    { id: 2, name: "Water" },
  ];
  it("matches case-insensitively and ignores surrounding space", () => {
    expect(isApplied(kws, "sky")).toBe(true);
    expect(isApplied(kws, "  WATER ")).toBe(true);
    expect(isApplied(kws, "Forest")).toBe(false);
  });
  it("is false for an empty keyword list", () => {
    expect(isApplied([], "Sky")).toBe(false);
  });
});

describe("toggleKeyword", () => {
  const kws = [
    { id: 1, name: "Sky" },
    { id: 2, name: "Water" },
  ];
  it("removes (with the matching id) when the keyword is already applied", () => {
    expect(toggleKeyword(kws, "sky")).toEqual({ action: "remove", id: 1 });
  });
  it("adds (trimmed) when the keyword is absent", () => {
    expect(toggleKeyword(kws, "  Forest ")).toEqual({ action: "add", name: "Forest" });
  });
  it("on an empty list always adds", () => {
    expect(toggleKeyword([], "Sky")).toEqual({ action: "add", name: "Sky" });
  });
});

describe("clampKeywords", () => {
  it("trims, drops blanks, and dedups case-insensitively (first wins)", () => {
    expect(clampKeywords(["  Sky ", "", "sky", "SKY", "Water"])).toEqual(["Sky", "Water"]);
  });

  it("caps at MAX_KEYWORDS", () => {
    const many = Array.from({ length: 20 }, (_, i) => `k${i}`);
    expect(clampKeywords(many)).toHaveLength(MAX_KEYWORDS);
    expect(clampKeywords(many)[0]).toBe("k0");
  });
});

describe("BUILT_IN_SETS", () => {
  it("are already normalized (≤9, no blanks, no case-dupes)", () => {
    expect(BUILT_IN_SETS.length).toBeGreaterThan(0);
    for (const set of BUILT_IN_SETS) {
      expect(set.keywords.length).toBeGreaterThan(0);
      expect(set.keywords.length).toBeLessThanOrEqual(MAX_KEYWORDS);
      // clamping a normalized list is a no-op
      expect(clampKeywords(set.keywords)).toEqual(set.keywords);
    }
  });

  it("have distinct names", () => {
    const names = BUILT_IN_SETS.map((s) => s.name);
    expect(new Set(names).size).toBe(names.length);
  });
});

describe("pushRecent", () => {
  it("prepends most-recent-first", () => {
    expect(pushRecent(["a"], "b")).toEqual(["b", "a"]);
  });

  it("moves a re-applied keyword to the front (case-insensitive dedup)", () => {
    expect(pushRecent(["b", "a"], "A")).toEqual(["A", "b"]);
  });

  it("trims and ignores blanks", () => {
    expect(pushRecent(["a"], "  ")).toEqual(["a"]);
    expect(pushRecent(["a"], "  b ")).toEqual(["b", "a"]);
  });

  it("caps at MAX_KEYWORDS, dropping the oldest", () => {
    let h: string[] = [];
    for (let i = 0; i < MAX_KEYWORDS + 3; i++) h = pushRecent(h, `k${i}`);
    expect(h).toHaveLength(MAX_KEYWORDS);
    expect(h[0]).toBe(`k${MAX_KEYWORDS + 2}`); // newest
    expect(h).not.toContain("k0"); // oldest evicted
  });
});

describe("recents ring + keywordSets()", () => {
  it("Recent Keywords set reflects the ring, newest first", () => {
    recordKeywordUse("Sky");
    recordKeywordUse("Water");
    recordKeywordUse("sky"); // re-apply moves to front, no dupe
    expect(recentKeywords()).toEqual(["sky", "Water"]);

    const sets = keywordSets();
    expect(sets[0].name).toBe(RECENT_SET_NAME);
    expect(sets[0].keywords).toEqual(["sky", "Water"]);
    // built-ins follow
    expect(sets.slice(1).map((s) => s.name)).toEqual(BUILT_IN_SETS.map((s) => s.name));
  });

  it("resetRecentKeywords empties the ring", () => {
    recordKeywordUse("Sky");
    resetRecentKeywords();
    expect(recentKeywords()).toEqual([]);
    expect(keywordSets()[0].keywords).toEqual([]);
  });

  it("notifies subscribers on change, not on no-op, and unsubscribes cleanly", () => {
    let hits = 0;
    const off = subscribeRecent(() => hits++);
    recordKeywordUse("Sky");
    expect(hits).toBe(1);
    recordKeywordUse("   "); // blank → no change → no notify
    expect(hits).toBe(1);
    off();
    recordKeywordUse("Water"); // after unsubscribe → no notify
    expect(hits).toBe(1);
  });
});
