// slideshowModule — the Slideshow module panels that landed on top of the
// Impromptu Slideshow: Titles (Intro/Ending screens), Playback ▸ Fit to Music,
// Layout (margins + guides), Overlays (metadata text + Watermarking) and the
// Template Browser. The persisted-record plumbing itself is covered by
// slideshowStyle.test.ts; this file covers the added logic.

import { beforeEach, describe, expect, it } from "vitest";

import type { PhotoRow } from "../catalog/types";
import type { WatermarkSpecEx } from "../lib/exportImage";
import type { PresetStorage } from "../lib/exportPresets";
import {
  SLIDESHOW_INTERVAL_MS,
  fitToMusicDurationMs,
  slideSequence,
} from "../lib/slideshow";
import {
  DEFAULT_SLIDESHOW_SETTINGS,
  deleteSlideshowTemplate,
  guideCss,
  listSlideshowTemplates,
  overlayText,
  resetSlideshowSettingsCache,
  sanitizeSlideshowSettings,
  saveSlideshowTemplate,
  slideFrameCss,
  watermarkBoxCss,
  watermarkTextCss,
} from "./slideshowStyle";

const photo = (id: number, extra: Partial<PhotoRow> = {}) =>
  ({
    id,
    path: `/photos/p${id}.CR3`,
    rating: 0,
    width: 6000,
    height: 4000,
    cameraMake: "Canon",
    cameraModel: "EOS R5",
    fNumber: 2.8,
    ...extra,
  }) as PhotoRow;

const storage = (initial?: string): PresetStorage & { value: string | null } => ({
  value: initial ?? null,
  getItem() {
    return this.value;
  },
  setItem(_key: string, v: string) {
    this.value = v;
  },
});

beforeEach(() => {
  resetSlideshowSettingsCache();
});

describe("slideSequence (Titles panel)", () => {
  const photos = [photo(1), photo(2)];

  it("is the bare playlist when both title screens are empty", () => {
    const seq = slideSequence(photos, { intro: "", ending: "  " });
    expect(seq).toHaveLength(2);
    expect(seq.every((s) => s.kind === "photo")).toBe(true);
  });

  it("brackets the playlist with the Intro and Ending screens", () => {
    const seq = slideSequence(photos, { intro: "Iceland", ending: "Fin" });
    expect(seq.map((s) => s.kind)).toEqual(["title", "photo", "photo", "title"]);
    expect(seq[0]).toEqual({ kind: "title", role: "intro", text: "Iceland" });
    expect(seq[3]).toEqual({ kind: "title", role: "ending", text: "Fin" });
  });

  it("adds only the screen that has text", () => {
    expect(slideSequence(photos, { intro: "", ending: "Fin" }).map((s) => s.kind)).toEqual([
      "photo",
      "photo",
      "title",
    ]);
  });

  it("shows nothing at all for an empty playlist — titles need a show to bracket", () => {
    expect(slideSequence([], { intro: "Iceland", ending: "Fin" })).toEqual([]);
  });
});

describe("fitToMusicDurationMs", () => {
  it("divides the track across the show, to the nearest 100ms", () => {
    expect(fitToMusicDurationMs(30_000, 10)).toBe(3000);
    expect(fitToMusicDurationMs(10_040, 4)).toBe(2500);
  });

  it("clamps to the duration slider's range instead of drifting off it", () => {
    expect(fitToMusicDurationMs(600_000, 3)).toBe(20_000); // long track, short show
    expect(fitToMusicDurationMs(2000, 40)).toBe(1000); // short track, long show
  });

  it("falls back to the default slide length for a track or show it can't divide", () => {
    expect(fitToMusicDurationMs(0, 5)).toBe(SLIDESHOW_INTERVAL_MS);
    expect(fitToMusicDurationMs(Number.NaN, 5)).toBe(SLIDESHOW_INTERVAL_MS);
    expect(fitToMusicDurationMs(30_000, 0)).toBe(SLIDESHOW_INTERVAL_MS);
  });
});

describe("Layout panel", () => {
  it("insets the slide cell by the margin and draws the guide on the same rect", () => {
    const s = { ...DEFAULT_SLIDESHOW_SETTINGS, margin: 48, showGuides: true };
    expect(slideFrameCss(s)).toEqual({ inset: 48 });
    expect(guideCss(s).inset).toBe(48);
    expect(guideCss(s).border).toContain("dashed");
  });

  it("clamps a hand-edited margin — it drives the cell rect", () => {
    expect(sanitizeSlideshowSettings({ margin: -20 }).margin).toBe(0);
    expect(sanitizeSlideshowSettings({ margin: 99_999 }).margin).toBe(400);
  });
});

describe("overlayText", () => {
  it("resolves the Loupe Info fields as tokens", () => {
    const text = overlayText(photo(1, { rating: 3 }), "{file} · {camera} · {aperture} · {rating}");
    expect(text).toBe("p1.CR3 · Canon EOS R5 · f/2.8 · ★★★");
  });

  it("renders an absent value as empty and leaves a typo literal", () => {
    expect(overlayText(photo(1, { lens: null }), "[{lens}]")).toBe("[]");
    expect(overlayText(photo(1), "{lense}")).toBe("{lense}");
  });

  it("caps the stored template so it can't paper over the slide", () => {
    expect(sanitizeSlideshowSettings({ textOverlay: "x".repeat(400) }).textOverlay).toHaveLength(200);
  });
});

describe("watermark placement", () => {
  const spec = (over: Partial<WatermarkSpecEx> = {}): WatermarkSpecEx => ({
    text: "© Monet",
    anchor: "bottom-right",
    opacity: 0.7,
    sizePct: 4,
    insetPct: 3,
    ...over,
  });

  it("anchors the layer on the spec's corner", () => {
    const css = watermarkBoxCss(spec());
    expect(css.justifyContent).toBe("flex-end");
    expect(css.alignItems).toBe("flex-end");
    expect(css.padding).toBe("3vmin");
  });

  it("centres both axes for the middle anchor and each axis independently", () => {
    expect(watermarkBoxCss(spec({ anchor: "center" }))).toMatchObject({
      alignItems: "center",
      justifyContent: "center",
    });
    expect(watermarkBoxCss(spec({ anchor: "top-center" }))).toMatchObject({
      alignItems: "flex-start",
      justifyContent: "center",
    });
    expect(watermarkBoxCss(spec({ anchor: "center-left" }))).toMatchObject({
      alignItems: "center",
      justifyContent: "flex-start",
    });
  });

  it("maps size/opacity/rotation onto the frame, and defaults the look", () => {
    const css = watermarkTextCss(spec({ rotateQuarter: 1, bold: true }));
    expect(css.fontSize).toBe("4vh");
    expect(css.opacity).toBe(0.7);
    expect(css.transform).toBe("rotate(90deg)");
    expect(css.fontWeight).toBe(700);
    expect(css.color).toBe("#ffffff");
    expect(css.textShadow).toContain("rgba");
  });

  it("honours shadow: false and an out-of-range opacity", () => {
    expect(watermarkTextCss(spec({ shadow: false })).textShadow).toBeUndefined();
    expect(watermarkTextCss(spec({ opacity: 4 })).opacity).toBe(1);
  });
});

describe("Template Browser", () => {
  it("round-trips a named template", () => {
    const s = storage();
    const list = saveSlideshowTemplate("Client Review", { ...DEFAULT_SLIDESHOW_SETTINGS, margin: 60 }, s);
    expect(list.map((t) => t.name)).toEqual(["Client Review"]);
    expect(listSlideshowTemplates(s)[0].settings.margin).toBe(60);
  });

  it("upserts by trimmed name and keeps the list sorted", () => {
    const s = storage();
    saveSlideshowTemplate("Zoo", DEFAULT_SLIDESHOW_SETTINGS, s);
    saveSlideshowTemplate("  Alps  ", { ...DEFAULT_SLIDESHOW_SETTINGS, castShadow: true }, s);
    saveSlideshowTemplate("Alps", { ...DEFAULT_SLIDESHOW_SETTINGS, castShadow: false }, s);
    const list = listSlideshowTemplates(s);
    expect(list.map((t) => t.name)).toEqual(["Alps", "Zoo"]);
    expect(list[0].settings.castShadow).toBe(false);
  });

  it("ignores a blank name and deletes by name", () => {
    const s = storage();
    saveSlideshowTemplate("   ", DEFAULT_SLIDESHOW_SETTINGS, s);
    expect(listSlideshowTemplates(s)).toEqual([]);
    saveSlideshowTemplate("Keep", DEFAULT_SLIDESHOW_SETTINGS, s);
    expect(deleteSlideshowTemplate("Keep", s)).toEqual([]);
    expect(listSlideshowTemplates(s)).toEqual([]);
  });

  it("sanitises stored templates — they land in inline CSS like the live record", () => {
    const s = storage(
      JSON.stringify([
        { name: "Evil", settings: { backdropColor: "url(x)", margin: 5000, panZoom: "warp" } },
        { name: 42, settings: {} },
      ]),
    );
    const list = listSlideshowTemplates(s);
    expect(list).toHaveLength(1);
    expect(list[0].settings.backdropColor).toBe(DEFAULT_SLIDESHOW_SETTINGS.backdropColor);
    expect(list[0].settings.margin).toBe(400);
    expect(list[0].settings.panZoom).toBe("off");
  });

  it("treats corrupt storage and no storage as an empty browser", () => {
    expect(listSlideshowTemplates(storage("{not json"))).toEqual([]);
    expect(listSlideshowTemplates(null)).toEqual([]);
    expect(deleteSlideshowTemplate("x", null)).toEqual([]);
  });
});
