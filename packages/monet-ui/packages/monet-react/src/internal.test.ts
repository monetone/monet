import { describe, expect, it } from "vitest";
import { isEditableTarget } from "./internal";

describe("isEditableTarget", () => {
  it("recognizes controls that own typed keys", () => {
    for (const tag of ["input", "textarea", "select"]) {
      expect(isEditableTarget(document.createElement(tag))).toBe(true);
    }
    expect(isEditableTarget(document.createElement("button"))).toBe(false);
    expect(isEditableTarget(null)).toBe(false);
  });

  it("gives an open Select its keys, but not a closed one", () => {
    const trigger = document.createElement("button");
    trigger.setAttribute("role", "combobox");
    trigger.setAttribute("aria-expanded", "false");
    expect(isEditableTarget(trigger)).toBe(false);
    trigger.setAttribute("aria-expanded", "true");
    expect(isEditableTarget(trigger)).toBe(true);
  });
});
