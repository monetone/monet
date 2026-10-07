// Unit tests for the Frequency Separation menu wiring — the pure menu transform
// (the action itself drives the WASM engine and is covered by e2e).
import { describe, it, expect, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus } from "./psMenus";
import { PS_MENUS, type PsNode } from "./psMenuData";

const collectMonetIds = (nodes: PsNode[]): string[] =>
  nodes.flatMap((n) =>
    n.kind === "submenu" ? collectMonetIds(n.items) : n.kind === "item" && n.monetId ? [n.monetId] : [],
  );
const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);
const allLeaves = (bar: MenuBarEntry[]): MenuItemDef[] => bar.flatMap((m) => flatten(m.items));

describe("Frequency Separation menu wiring", () => {
  it("is present in the Filter blueprint under monetId 'freqsep'", () => {
    const filter = PS_MENUS.find((m) => m.id === "filter");
    expect(filter).toBeTruthy();
    expect(collectMonetIds(filter!.tree)).toContain("freqsep");
  });

  it("renders enabled and wired when a handler is supplied", () => {
    const fn = vi.fn();
    const bar = buildPhotoshopMenus({ freqsep: fn });
    const item = allLeaves(bar).find((it) => it.id === "freqsep");
    expect(item).toBeTruthy();
    expect(item!.label).toBe("Frequency Separation…");
    expect(item!.disabled).toBeFalsy();
    item!.action!();
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("renders as a disabled placeholder when no handler is supplied", () => {
    const bar = buildPhotoshopMenus({});
    const item = allLeaves(bar).find((it) => it.id === "freqsep");
    expect(item).toBeTruthy();
    expect(item!.disabled).toBe(true);
    expect(item!.action).toBeUndefined();
  });
});
