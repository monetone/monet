import { describe, expect, it } from "vitest";

import type { PhotoRow } from "../catalog/types";
import {
  comparePair,
  renderedObservation,
  SECONDARY_MODES,
  SECONDARY_ZOOMS,
  sharedSetNeeded,
  stepPinned,
  viewportMarker,
  zoomScale,
} from "./SecondaryDisplay";

const photo = (id: number) => ({ id, path: `/photo-${id}.png` }) as PhotoRow;
const rows = [photo(1), photo(2), photo(3)];

describe("secondary display views", () => {
  it("keeps the proof's frozen marker for the default Loupe/Fit view", () => {
    // src/secondaryProof.ts asserts this literal — every other view reports its
    // own marker, but Loupe+Fit must stay byte-identical.
    expect(viewportMarker("loupe", "fit")).toBe("secondary:fit");
    expect(viewportMarker("loupe", "1:1")).toBe("secondary:1:1");
    expect(viewportMarker("grid", "fit")).toBe("secondary:grid");
    expect(viewportMarker("survey", "fill")).toBe("secondary:survey");
    expect(
      renderedObservation(
        { url: "blob:x", photoId: 7, revision: 3 },
        { catalogId: "/c.galcat", activePhotoId: 7, selection: [7], revision: 3 },
        photo(7),
        3,
        32,
        32,
      )?.viewportMarker,
    ).toBe("secondary:fit");
    expect(
      renderedObservation(
        { url: "blob:x", photoId: 7, revision: 3 },
        { catalogId: "/c.galcat", activePhotoId: 7, selection: [7], revision: 3 },
        photo(7),
        3,
        32,
        32,
        viewportMarker("grid", "fit"),
      )?.viewportMarker,
    ).toBe("secondary:grid");
  });

  it("scales each zoom step off the natural size", () => {
    // 1000×500 in a 400×400 viewport: fit shrinks to the width, fill covers.
    expect(zoomScale("fit", 1000, 500, 400, 400, 1000)).toBeCloseTo(0.4);
    expect(zoomScale("fill", 1000, 500, 400, 400, 1000)).toBeCloseTo(0.8);
    expect(zoomScale("1:1", 1000, 500, 400, 400, 1000)).toBe(1);
    expect(zoomScale("2:1", 1000, 500, 400, 400, 1000)).toBe(2);
    expect(zoomScale("4:1", 1000, 500, 400, 400, 1000)).toBe(4);
    // A decode smaller than the pipeline's target upscales to reach true 1:1.
    expect(zoomScale("2:1", 500, 250, 400, 400, 1000)).toBe(4);
    // Degenerate geometry never divides by zero.
    for (const zoom of SECONDARY_ZOOMS) expect(zoomScale(zoom, 0, 0, 0, 0, 0)).toBe(1);
  });

  it("resolves the shared set only for the views that need it", () => {
    expect(sharedSetNeeded("loupe", false)).toBe(false);
    expect(sharedSetNeeded("loupe", true)).toBe(true);
    for (const mode of SECONDARY_MODES.filter((m) => m.id !== "loupe")) {
      expect(sharedSetNeeded(mode.id, false)).toBe(true);
    }
  });

  it("steps the pinned photo through the shared set, wrapping at both ends", () => {
    expect(stepPinned(rows, 1, 1)?.id).toBe(2);
    expect(stepPinned(rows, 3, 1)?.id).toBe(1);
    expect(stepPinned(rows, 1, -1)?.id).toBe(3);
    // Not in the set (locked on a photo the main window dropped): start at an end.
    expect(stepPinned(rows, 99, 1)?.id).toBe(1);
    expect(stepPinned(rows, null, -1)?.id).toBe(3);
    expect(stepPinned([], 1, 1)).toBeNull();
  });

  it("pairs Compare panes without showing the same photo twice", () => {
    expect(comparePair(rows, photo(2)).map((p) => p?.id)).toEqual([1, 2]);
    // Displaying the Select promotes the next photo to Candidate.
    expect(comparePair(rows, photo(1)).map((p) => p?.id)).toEqual([1, 2]);
    expect(comparePair([photo(1)], photo(1)).map((p) => p?.id)).toEqual([1, undefined]);
    expect(comparePair([], null)).toEqual([null, null]);
  });
});
