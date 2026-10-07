// View ▸ 32-bit Preview Options… — the float-document preview tone mapping.
// The blueprint (psMenuData) ships this item without a `monetId`, so without a
// LABEL_WIRING row psMenus can never reach a host action and the item is a
// permanent disabled placeholder. These tests pin the wiring and the exact
// blueprint label/location it depends on, so a blueprint regeneration that
// renames or moves the item fails here instead of silently re-disabling it.

import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";
import { PS_MENUS, type PsNode } from "./psMenuData";

const LABEL = "32-bit Preview Options…";

const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const leaves = (bar: MenuBarEntry[]): MenuItemDef[] =>
  bar.flatMap((m) => flatten(m.items)).filter((it) => !it.separator && !it.items);

const countLabel = (nodes: PsNode[]): number =>
  nodes.reduce(
    (acc, n) =>
      acc + (n.kind === "submenu" ? countLabel(n.items) : n.kind === "item" && n.label === LABEL ? 1 : 0),
    0,
  );

describe("View ▸ 32-bit Preview Options…", () => {
  it("sits once at the View root in the blueprint, with no monetId of its own", () => {
    const view = PS_MENUS.find((m) => m.id === "view")!;
    expect(PS_MENUS.reduce((acc, m) => acc + countLabel(m.tree), 0)).toBe(1);
    const node = view.tree.find((n) => n.kind === "item" && n.label === LABEL);
    expect(node).toBeDefined();
    expect((node as { monetId?: string }).monetId).toBeUndefined();
  });

  it("wires to the host's hdrpreview action", () => {
    const fn = vi.fn<(...args: unknown[]) => void>();
    const item = leaves(buildPhotoshopMenus({ hdrpreview: fn })).find((it) => it.label === LABEL)!;
    expect(item.id).toBe("hdrpreview");
    expect(item.disabled).toBeFalsy();
    item.action!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("stays a disabled placeholder when the host provides no action", () => {
    const item = leaves(buildPhotoshopMenus({})).find((it) => it.label === LABEL)!;
    expect(item.disabled).toBe(true);
    expect(item.action).toBeUndefined();
  });
});
