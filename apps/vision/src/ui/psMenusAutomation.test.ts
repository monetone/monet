// File ▸ Automate ▸ Create Droplet… and File ▸ Scripts ▸ Script Events Manager…
// Both blueprint items (psMenuData) ship without a `monetId`, so without a
// LABEL_WIRING row psMenus can never reach a host action and they are permanent
// disabled placeholders. These tests pin the wiring plus the exact blueprint
// label/location it depends on, so a blueprint regeneration that renames or
// moves either item fails here instead of silently re-disabling it.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";
import { PS_MENUS, type PsNode } from "./psMenuData";

const CASES = [
  { label: "Create Droplet…", id: "createdroplet", path: "File ▸ Automate" },
  { label: "Script Events Manager…", id: "scripteventsmanager", path: "File ▸ Scripts" },
  { label: "Load Multiple DICOM Files…", id: "loaddicom", path: "File ▸ Scripts" }, // #466
] as const;

const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const leaves = (bar: MenuBarEntry[]): MenuItemDef[] =>
  bar.flatMap((m) => flatten(m.items)).filter((it) => !it.separator && !it.items);

/** Every blueprint location holding `label`, as "File ▸ Automate" style paths. */
function locate(nodes: PsNode[], label: string, parent: string[] = []): string[] {
  return nodes.flatMap((n) =>
    n.kind === "submenu"
      ? locate(n.items, label, [...parent, n.label])
      : n.kind === "item" && n.label === label
        ? [parent.join(" ▸ ")]
        : [],
  );
}
const blueprintNode = (label: string): PsNode | undefined => {
  const walk = (nodes: PsNode[]): PsNode | undefined => {
    for (const n of nodes) {
      if (n.kind === "submenu") { const hit = walk(n.items); if (hit) return hit; }
      else if (n.kind === "item" && n.label === label) return n;
    }
    return undefined;
  };
  return walk(PS_MENUS.flatMap((m) => m.tree));
};

describe.each(CASES)("$path ▸ $label", ({ label, id, path }) => {
  it("sits once in the blueprint at its Photoshop location, with no monetId of its own", () => {
    expect(PS_MENUS.flatMap((m) => locate(m.tree, label, [m.label]))).toEqual([path]);
    expect((blueprintNode(label) as { monetId?: string } | undefined)?.monetId).toBeUndefined();
  });

  it(`wires to the host's ${id} action`, () => {
    const fn = vi.fn<(...args: unknown[]) => void>();
    const item = leaves(buildPhotoshopMenus({ [id]: fn })).find((it) => it.label === label)!;
    expect(item.id).toBe(id);
    expect(item.disabled).toBeFalsy();
    item.action!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stays a disabled placeholder when the host provides no action", () => {
    const item = leaves(buildPhotoshopMenus({})).find((it) => it.label === label)!;
    expect(item.disabled).toBe(true);
    expect(item.action).toBeUndefined();
  });
});
