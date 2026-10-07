// File ▸ Export ▸ Export PDF/X-1a… and PDF/X-4… — the two PDF/X presets
// `exportPDF` can actually write. Photoshop reaches PDF/X through presets in
// its Save Adobe PDF dialog, so the blueprint has no item for either; psMenus
// injects them beside Monet's other extra export encoders. Both functions
// existed for a while with ZERO callers, shipping dead — these tests pin the
// wiring so that cannot silently happen again.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";

const LABELS = ["Export PDF/X-1a…", "Export PDF/X-4…"] as const;
const IDS = { "Export PDF/X-1a…": "exportpdfx1a", "Export PDF/X-4…": "exportpdfx4" } as const;

const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const leaves = (bar: MenuBarEntry[]): MenuItemDef[] =>
  bar.flatMap((m) => flatten(m.items)).filter((it) => !it.separator && !it.items);

describe("File ▸ Export ▸ PDF/X presets", () => {
  for (const label of LABELS) {
    it(`wires ${label} to its host action`, () => {
      const fn = vi.fn<(...args: unknown[]) => void>();
      const item = leaves(buildPhotoshopMenus({ [IDS[label]]: fn })).find((it) => it.label === label)!;
      expect(item).toBeDefined();
      expect(item.disabled).toBeFalsy();
      item.action!();
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it(`leaves ${label} a disabled placeholder when the host provides no action`, () => {
      const item = leaves(buildPhotoshopMenus({})).find((it) => it.label === label)!;
      expect(item).toBeDefined();
      expect(item.disabled).toBe(true);
      expect(item.action).toBeUndefined();
    });
  }

  it("appears exactly once each, under File ▸ Export", () => {
    const bar = buildPhotoshopMenus({});
    const file = bar.find((m) => m.label === "File")!;
    const exportSub = flatten(file.items).find((it) => it.label === "Export")!;
    for (const label of LABELS) {
      expect(leaves(bar).filter((it) => it.label === label)).toHaveLength(1);
      expect(exportSub.items!.some((it) => it.label === label)).toBe(true);
    }
  });
});
