import { describe, expect, it } from "vitest";
import { IMAGE_EXTS, imageDrops } from "./files";

// The drop filter is the only branch between "user dropped things on Jouer" and
// "these become sprite assets" — everything else in importDroppedImages is I/O.
describe("imageDrops", () => {
  it("keeps every supported image type", () => {
    const paths = IMAGE_EXTS.map((ext) => `/Users/x/hero.${ext}`);
    expect(imageDrops(paths)).toEqual(paths);
  });

  it("keeps drop order and drops non-images", () => {
    expect(
      imageDrops(["/x/a.png", "/x/game.jouer", "/x/b.JPG", "/x/notes.txt", "/x/README"]),
    ).toEqual(["/x/a.png", "/x/b.JPG"]);
  });

  it("does not mistake a dotless name for its own extension", () => {
    expect(imageDrops(["/tmp/png", "/tmp/pics.d/sprite"])).toEqual([]);
  });

  it("reads browser File objects by name", () => {
    const file = (name: string) => ({ name }) as File;
    const [png] = imageDrops([file("logo.webp"), file("save.jouer")]);
    expect(png?.name).toBe("logo.webp");
  });
});
