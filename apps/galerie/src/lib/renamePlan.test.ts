import { describe, expect, it } from "vitest";

import { planRename } from "./renamePlan";

const photo = (id: number, path: string, copyName: string | null = null) => ({ id, path, copyName });

describe("planRename", () => {
  it("renders the template per photo with a running sequence, keeping dir + ext", () => {
    const steps = planRename(
      [photo(1, "/shoot/a.cr3"), photo(2, "/shoot/b.cr3")],
      "trip-{sequence:3}",
      "",
      7,
    );
    expect(steps).toEqual([
      { id: 1, from: "/shoot/a.cr3", to: "/shoot/trip-007.cr3" },
      { id: 2, from: "/shoot/b.cr3", to: "/shoot/trip-008.cr3" },
    ]);
  });

  it("keeps batch results unique when the template collides", () => {
    const steps = planRename(
      [photo(1, "/s/a.jpg"), photo(2, "/s/b.jpg")],
      "same",
      "",
      1,
    );
    expect(steps.map((s) => s.to)).toEqual(["/s/same.jpg", "/s/same-1.jpg"]);
  });

  it("drops photos whose rendered name equals the current one", () => {
    expect(planRename([photo(1, "/s/a.jpg")], "{name}", "", 1)).toEqual([]);
  });

  it("expands custom text and copy names", () => {
    const steps = planRename(
      [photo(1, "/s/a.jpg", "Crop")],
      "{customtext}{copyname}",
      "fin",
      1,
    );
    expect(steps[0].to).toBe("/s/fin-Crop.jpg");
  });
});
