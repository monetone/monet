import { describe, expect, it } from "vitest";

import type { PhotoRow } from "../catalog/types";
import {
  DEFAULT_SLIDESHOW_OPTIONS,
  SLIDESHOW_INTERVAL_MS,
  advanceSlide,
  nextSlide,
  orderedPlaylist,
  slideshowPlaylist,
} from "./slideshow";

const p = (id: number) => ({ id }) as PhotoRow;

describe("slideshowPlaylist", () => {
  it("plays the selection in buffer order when 2+ selected", () => {
    const photos = [p(1), p(2), p(3), p(4)];
    expect(slideshowPlaylist(photos, [4, 2]).map((x) => x.id)).toEqual([2, 4]);
  });

  it("plays the whole view when the selection is 0 or 1 photos", () => {
    const photos = [p(1), p(2), p(3)];
    expect(slideshowPlaylist(photos, [2]).map((x) => x.id)).toEqual([1, 2, 3]);
    expect(slideshowPlaylist(photos, []).map((x) => x.id)).toEqual([1, 2, 3]);
  });
});

describe("nextSlide", () => {
  it("wraps in both directions and pins empty to 0", () => {
    expect(nextSlide(2, 3)).toBe(0);
    expect(nextSlide(0, 3, -1)).toBe(2);
    expect(nextSlide(0, 3)).toBe(1);
    expect(nextSlide(5, 0)).toBe(0);
  });
});

describe("orderedPlaylist", () => {
  const photos = [p(1), p(2), p(3), p(4), p(5), p(6)];
  const ids = (list: PhotoRow[]) => list.map((x) => x.id);

  it("keeps buffer order when random is off", () => {
    expect(ids(orderedPlaylist(photos, [], DEFAULT_SLIDESHOW_OPTIONS, 42))).toEqual([
      1, 2, 3, 4, 5, 6,
    ]);
  });

  it("shuffles to a permutation that is stable for a fixed seed", () => {
    const opts = { ...DEFAULT_SLIDESHOW_OPTIONS, random: true };
    const a = ids(orderedPlaylist(photos, [], opts, 42));
    expect([...a].sort((x, y) => x - y)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(ids(orderedPlaylist(photos, [], opts, 42))).toEqual(a);
    expect(ids(orderedPlaylist(photos, [], opts, 7))).not.toEqual(a);
    expect(ids(orderedPlaylist(photos, [], opts, 42))).not.toEqual([1, 2, 3, 4, 5, 6]);
  });

  it("still honours the selection rule and never mutates the input", () => {
    const opts = { ...DEFAULT_SLIDESHOW_OPTIONS, random: true };
    expect(ids(orderedPlaylist(photos, [3, 1], opts, 42)).sort((x, y) => x - y)).toEqual([1, 3]);
    expect(ids(photos)).toEqual([1, 2, 3, 4, 5, 6]);
  });
});

describe("advanceSlide", () => {
  it("wraps when repeat is on and stops at the ends when it is off", () => {
    expect(advanceSlide(2, 3, true)).toBe(0);
    expect(advanceSlide(2, 3, false)).toBeNull();
    expect(advanceSlide(0, 3, false, -1)).toBeNull();
    expect(advanceSlide(0, 3, true, -1)).toBe(2);
    expect(advanceSlide(0, 3, false)).toBe(1);
    expect(advanceSlide(0, 0, true)).toBeNull();
  });
});

describe("SlideshowOptions defaults", () => {
  it("defaults to LR's slide length, buffer order and repeat on", () => {
    expect(DEFAULT_SLIDESHOW_OPTIONS).toEqual({
      durationMs: SLIDESHOW_INTERVAL_MS,
      random: false,
      repeat: true,
      manual: false,
    });
  });
});
