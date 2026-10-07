// Type ▸ Language Options — the three feature families. The blueprint ships
// "East Asian Features" and "Indic Features" without a monetId, so psMenus
// could never reach a host action for either and they were permanent
// placeholders (same failure mode as Create Droplet… / Script Events Manager…,
// see ./createDropletScriptEventsWiring.test.ts). These tests pin the menu-layer
// half: the labels resolve to stable host ids, wire when the host provides them,
// and stay disabled — not silently mis-wired to a neighbour — when it doesn't.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";

const LANG = ["Type", "Language Options"] as const;
const FAMILIES = {
  "East Asian Features": "langeastasian",
  "Indic Features": "langindic",
} as const;

const langItems = (actions: Record<string, () => void> = {}): MenuItemDef[] => {
  const bar: MenuBarEntry[] = buildPhotoshopMenus(actions);
  const type = bar.find((menu) => menu.label === LANG[0])!;
  return type.items.find((item) => item.label === LANG[1])!.items!;
};
const at = (label: string, actions?: Record<string, () => void>): MenuItemDef =>
  langItems(actions).find((item) => item.label === label)!;

describe("Type ▸ Language Options families", () => {
  for (const [label, id] of Object.entries(FAMILIES)) {
    it(`resolves ${label} to the ${id} host action`, () => {
      const fn = vi.fn<(...args: unknown[]) => void>();
      const item = at(label, { [id]: fn });
      expect(item.id).toBe(id);
      expect(item.disabled).toBeFalsy();
      item.action!();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it(`leaves ${label} a disabled placeholder when the host provides no action`, () => {
      const item = at(label);
      expect(item.disabled).toBe(true);
      expect(item.action).toBeUndefined();
    });
  }

  it("keeps the family ids off the neighbouring commands Monet already implements", () => {
    // The Middle Eastern family's commands live in the same submenu and are
    // wired individually; a family id must never steal one of them.
    const implemented = {
      composerworldready: vi.fn<(...args: unknown[]) => void>(),
      textdirrtl: vi.fn<(...args: unknown[]) => void>(),
      digitshindi: vi.fn<(...args: unknown[]) => void>(),
    };
    const items = langItems(implemented);
    for (const [label, id] of [
      ["World-Ready Composer", "composerworldready"],
      ["Right-to-Left Text Direction", "textdirrtl"],
      ["Use Hindi Digits", "digitshindi"],
    ] as const) {
      const item = items.find((entry) => entry.label === label)!;
      expect(item.id, label).toBe(id);
      expect(item.disabled, label).toBeFalsy();
    }
    // Both families stay disabled: none of the above is their action.
    for (const label of Object.keys(FAMILIES)) {
      expect(items.find((entry) => entry.label === label)!.disabled, label).toBe(true);
    }
  });

  it("still ships Middle Eastern Features as a label (its commands are the rows below)", () => {
    // Monet implements the Middle Eastern set (direction, digits, kashidas,
    // diacritic offsets on the Character panel) but has no app-level feature-set
    // switch, so the family label itself has no id to wire — pinned so a future
    // edit can't quietly point it at an unrelated command.
    const item = at("Middle Eastern Features");
    expect(item.disabled).toBe(true);
    expect(item.id).toBe("middle-eastern-features");
  });
});
