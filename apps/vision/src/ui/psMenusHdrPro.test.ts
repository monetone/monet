// File ▸ Automate ▸ Merge to HDR Pro… vs Image ▸ Merge to HDR (Exposure Fusion).
// The blueprint (psMenuData) ships both with the same monetId "hdr", which used
// to make the Pro entry a second door onto exposure fusion — an LDR blend. They
// are different commands: Pro recovers the camera response from the bracket and
// leaves a 32-bit radiance document. A PATH_WIRING row splits them, and these
// tests pin that split plus the blueprint labels it keys off, so a blueprint
// regeneration fails here instead of silently re-aliasing the two.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";

const PRO = ["File", "Automate", "Merge to HDR Pro…"] as const;
const FUSION = ["Image", "Merge to HDR (Exposure Fusion)"] as const;

const itemAtPath = (bar: MenuBarEntry[], path: readonly string[]): MenuItemDef | undefined => {
  let items = bar.find((menu) => menu.label === path[0])?.items;
  let found: MenuItemDef | undefined;
  for (const label of path.slice(1)) {
    found = items?.find((item) => item.label === label);
    items = found?.items;
  }
  return found;
};

describe("Merge to HDR Pro", () => {
  it("wires to hdrpro, not to the exposure-fusion command", () => {
    const pro = vi.fn<(...args: unknown[]) => void>();
    const fusion = vi.fn<(...args: unknown[]) => void>();
    const bar = buildPhotoshopMenus({ hdrpro: pro, hdr: fusion });

    const proItem = itemAtPath(bar, PRO);
    expect(proItem?.disabled).toBeFalsy();
    proItem?.action?.();
    expect(pro).toHaveBeenCalledTimes(1);
    expect(fusion).not.toHaveBeenCalled();

    const fusionItem = itemAtPath(bar, FUSION);
    expect(fusionItem?.disabled).toBeFalsy();
    fusionItem?.action?.();
    expect(fusion).toHaveBeenCalledTimes(1);
    expect(pro).toHaveBeenCalledTimes(1);
  });

  it("leaves Merge to HDR Pro disabled when only exposure fusion is implemented", () => {
    const bar = buildPhotoshopMenus({ hdr: vi.fn<(...args: unknown[]) => void>() });
    expect(itemAtPath(bar, PRO)?.disabled).toBe(true);
    expect(itemAtPath(bar, PRO)?.action).toBeUndefined();
    expect(itemAtPath(bar, FUSION)?.disabled).toBeFalsy();
  });
});
