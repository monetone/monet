import { describe, expect, it } from "vitest";

import type { PresetStorage } from "./exportPresets";
import { MAX_RECENT_CATALOGS, listRecentCatalogs, recordRecentCatalog } from "./recentCatalogs";

function memStorage(initial: Record<string, string> = {}): PresetStorage {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => map.get(k) ?? null, setItem: (k, v) => void map.set(k, v) };
}

describe("recent catalogs", () => {
  it("records most-recent-first with dedupe and a cap", () => {
    const s = memStorage();
    recordRecentCatalog("/a.galcat", s);
    recordRecentCatalog("/b.galcat", s);
    recordRecentCatalog("/a.galcat", s); // re-open bubbles to the front
    expect(listRecentCatalogs(s)).toEqual(["/a.galcat", "/b.galcat"]);

    for (let i = 0; i < MAX_RECENT_CATALOGS + 2; i++) recordRecentCatalog(`/c${i}.galcat`, s);
    const list = listRecentCatalogs(s);
    expect(list).toHaveLength(MAX_RECENT_CATALOGS);
    expect(list[0]).toBe(`/c${MAX_RECENT_CATALOGS + 1}.galcat`);
  });

  it("treats corrupt or foreign storage as empty", () => {
    expect(listRecentCatalogs(memStorage({ "galerie.recentCatalogs": "{oops" }))).toEqual([]);
    expect(listRecentCatalogs(memStorage({ "galerie.recentCatalogs": '[1,null,"/ok.galcat"]' }))).toEqual([
      "/ok.galcat",
    ]);
  });
});
