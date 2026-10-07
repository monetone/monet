// slideshowStyle — the persisted Slideshow settings record: sanitising what
// comes back out of storage (it lands in inline CSS and the video encoder) and
// the Options/Backdrop/Overlays → CSS mapping the overlay renders.

import { beforeEach, describe, expect, it } from "vitest";

import type { PresetStorage } from "../lib/exportPresets";
import {
  DEFAULT_SLIDESHOW_SETTINGS,
  backdropCss,
  ratingStars,
  sanitizeSlideshowSettings,
  saveSlideshowSettings,
  resetSlideshowSettingsCache,
  slideImageCss,
  slideshowSettings,
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

beforeEach(() => {
  resetSlideshowSettingsCache();
});

describe("sanitizeSlideshowSettings", () => {
  it("falls back to defaults for junk", () => {
    expect(sanitizeSlideshowSettings(null)).toEqual(DEFAULT_SLIDESHOW_SETTINGS);
    expect(sanitizeSlideshowSettings("nope")).toEqual(DEFAULT_SLIDESHOW_SETTINGS);
    expect(sanitizeSlideshowSettings({ random: "yes", durationMs: "4s" })).toEqual(
      DEFAULT_SLIDESHOW_SETTINGS,
    );
  });

  it("keeps valid values and clamps out-of-range numbers", () => {
    const s = sanitizeSlideshowSettings({
      durationMs: 8000,
      random: true,
      crossfadeMs: 99_999,
      strokeWidth: -3,
      identityPlate: "Monet Studio",
    });
    expect(s.durationMs).toBe(8000);
    expect(s.random).toBe(true);
    expect(s.crossfadeMs).toBe(10_000);
    expect(s.strokeWidth).toBe(0);
    expect(s.identityPlate).toBe("Monet Studio");
  });

  it("only accepts literal hex colours — they go straight into inline CSS", () => {
    expect(sanitizeSlideshowSettings({ backdropColor: "#1a2b3c" }).backdropColor).toBe("#1a2b3c");
    expect(sanitizeSlideshowSettings({ backdropColor: "#abc" }).backdropColor).toBe("#abc");
    expect(sanitizeSlideshowSettings({ backdropColor: "red; background: url(x)" }).backdropColor).toBe(
      DEFAULT_SLIDESHOW_SETTINGS.backdropColor,
    );
  });

  it("whitelists the enum fields", () => {
    expect(sanitizeSlideshowSettings({ panZoom: "high" }).panZoom).toBe("high");
    expect(sanitizeSlideshowSettings({ panZoom: "insane" }).panZoom).toBe("off");
    expect(sanitizeSlideshowSettings({ videoPreset: "4k" }).videoPreset).toBe("1080p");
  });

  it("caps the identity plate so an overgrown record can't cover the slide", () => {
    expect(sanitizeSlideshowSettings({ identityPlate: "x".repeat(500) }).identityPlate).toHaveLength(120);
  });
});

describe("slideshowSettings / saveSlideshowSettings", () => {
  it("round-trips through storage so a reopened slideshow keeps its look", () => {
    const storage = fakeStorage();
    saveSlideshowSettings({ ...DEFAULT_SLIDESHOW_SETTINGS, backdropColor: "#123456", castShadow: true }, storage);
    resetSlideshowSettingsCache();
    const loaded = slideshowSettings(storage);
    expect(loaded.backdropColor).toBe("#123456");
    expect(loaded.castShadow).toBe(true);
  });

  it("yields defaults for corrupt storage and for no storage at all", () => {
    expect(slideshowSettings(fakeStorage("{not json"))).toEqual(DEFAULT_SLIDESHOW_SETTINGS);
    resetSlideshowSettingsCache();
    expect(slideshowSettings(null)).toEqual(DEFAULT_SLIDESHOW_SETTINGS);
  });

  it("sanitises on the way in, so a hand-edited record can't reach the CSS", () => {
    const storage = fakeStorage(JSON.stringify({ strokeColor: "url(evil)", crossfadeMs: -5 }));
    const loaded = slideshowSettings(storage);
    expect(loaded.strokeColor).toBe(DEFAULT_SLIDESHOW_SETTINGS.strokeColor);
    expect(loaded.crossfadeMs).toBe(0);
  });

  it("survives storage that refuses to write", () => {
    const storage: PresetStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    const saved = saveSlideshowSettings({ ...DEFAULT_SLIDESHOW_SETTINGS, ratingStars: true }, storage);
    expect(saved.ratingStars).toBe(true);
  });
});

describe("backdropCss", () => {
  it("is the flat background colour by default", () => {
    expect(backdropCss(DEFAULT_SLIDESHOW_SETTINGS)).toEqual({ background: "#000000" });
  });

  it("washes the background colour with a radial gradient", () => {
    const css = backdropCss({ ...DEFAULT_SLIDESHOW_SETTINGS, colorWash: true, colorWashColor: "#445566" });
    expect(css.background).toContain("radial-gradient");
    expect(css.background).toContain("#445566");
    expect(css.background).toContain("#000000");
  });
});

describe("slideImageCss", () => {
  it("letterboxes by default and covers under Zoom to Fill", () => {
    expect(slideImageCss(DEFAULT_SLIDESHOW_SETTINGS)).toEqual({ objectFit: "contain" });
    const fill = slideImageCss({ ...DEFAULT_SLIDESHOW_SETTINGS, zoomToFill: true });
    expect(fill).toMatchObject({ objectFit: "cover", height: "100%", width: "100%" });
  });

  it("draws the stroke border inside the frame", () => {
    const css = slideImageCss({
      ...DEFAULT_SLIDESHOW_SETTINGS,
      strokeBorder: true,
      strokeColor: "#ff0000",
      strokeWidth: 6,
    });
    expect(css.border).toBe("6px solid #ff0000");
    expect(css.boxSizing).toBe("border-box");
  });

  it("skips a zero-width stroke and adds the shadow only when asked", () => {
    expect(slideImageCss({ ...DEFAULT_SLIDESHOW_SETTINGS, strokeBorder: true, strokeWidth: 0 }).border).toBeUndefined();
    expect(slideImageCss(DEFAULT_SLIDESHOW_SETTINGS).boxShadow).toBeUndefined();
    expect(slideImageCss({ ...DEFAULT_SLIDESHOW_SETTINGS, castShadow: true }).boxShadow).toContain("rgba");
  });
});

describe("ratingStars", () => {
  it("draws filled stars only, clamped to five", () => {
    expect(ratingStars(0)).toBe("");
    expect(ratingStars(3)).toBe("★★★");
    expect(ratingStars(9)).toBe("★★★★★");
    expect(ratingStars(-2)).toBe("");
  });
});
