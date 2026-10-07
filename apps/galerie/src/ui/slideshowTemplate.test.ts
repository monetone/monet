// slideshowTemplate — LR's Slideshow Template Browser: named settings records
// in storage. The look itself is covered by slideshowStyle.test.ts; this is the
// save/list/delete contract the overlay's Template panel drives.

import { describe, expect, it } from "vitest";

import type { PresetStorage } from "../lib/exportPresets";
import {
  DEFAULT_SLIDESHOW_SETTINGS,
  deleteSlideshowTemplate,
  listSlideshowTemplates,
  saveSlideshowTemplate,
} from "./slideshowStyle";

function fakeStorage(initial?: string): PresetStorage & { value: string | null } {
  return {
    value: initial ?? null,
    getItem(_key: string) {
      return this.value;
    },
    setItem(_key: string, v: string) {
      this.value = v;
    },
  };
}

describe("slideshow templates", () => {
  it("round-trips a named record so a configured show can be reopened", () => {
    const storage = fakeStorage();
    saveSlideshowTemplate(
      "Wedding",
      { ...DEFAULT_SLIDESHOW_SETTINGS, durationMs: 9000, random: true, introText: "Hello" },
      storage,
    );
    const [tpl] = listSlideshowTemplates(storage);
    expect(tpl.name).toBe("Wedding");
    expect(tpl.settings).toMatchObject({ durationMs: 9000, random: true, introText: "Hello" });
  });

  it("upserts by trimmed name and keeps the list sorted", () => {
    const storage = fakeStorage();
    saveSlideshowTemplate("Zoo", DEFAULT_SLIDESHOW_SETTINGS, storage);
    saveSlideshowTemplate("  Wedding  ", { ...DEFAULT_SLIDESHOW_SETTINGS, margin: 40 }, storage);
    saveSlideshowTemplate("Wedding", { ...DEFAULT_SLIDESHOW_SETTINGS, margin: 80 }, storage);
    const list = listSlideshowTemplates(storage);
    expect(list.map((t) => t.name)).toEqual(["Wedding", "Zoo"]);
    expect(list[0].settings.margin).toBe(80);
  });

  it("ignores a blank name", () => {
    const storage = fakeStorage();
    expect(saveSlideshowTemplate("   ", DEFAULT_SLIDESHOW_SETTINGS, storage)).toEqual([]);
  });

  it("deletes by name and leaves the rest alone", () => {
    const storage = fakeStorage();
    saveSlideshowTemplate("A", DEFAULT_SLIDESHOW_SETTINGS, storage);
    saveSlideshowTemplate("B", DEFAULT_SLIDESHOW_SETTINGS, storage);
    expect(deleteSlideshowTemplate("A", storage).map((t) => t.name)).toEqual(["B"]);
    expect(listSlideshowTemplates(storage).map((t) => t.name)).toEqual(["B"]);
  });

  it("sanitises stored records — they land in inline CSS like the live settings", () => {
    const storage = fakeStorage(
      JSON.stringify([
        { name: "Evil", settings: { backdropColor: "red; background: url(x)", crossfadeMs: -5 } },
        { name: "", settings: {} }, // nameless records aren't selectable, so drop them
      ]),
    );
    const list = listSlideshowTemplates(storage);
    expect(list).toHaveLength(1);
    expect(list[0].settings.backdropColor).toBe(DEFAULT_SLIDESHOW_SETTINGS.backdropColor);
    expect(list[0].settings.crossfadeMs).toBe(0);
  });

  it("treats corrupt storage and no storage as an empty browser", () => {
    expect(listSlideshowTemplates(fakeStorage("{not json"))).toEqual([]);
    expect(listSlideshowTemplates(fakeStorage(JSON.stringify({ nope: true })))).toEqual([]);
    expect(listSlideshowTemplates(null)).toEqual([]);
    expect(deleteSlideshowTemplate("A", null)).toEqual([]);
  });
});
