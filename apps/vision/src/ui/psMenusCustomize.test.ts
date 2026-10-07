// Guards V-WS-2: Edit ▸ Menus… and Edit ▸ Toolbar… are reachable, and the
// Menus tab's per-command visibility really prunes the bar. Dialogs.tsx is
// asserted at source level (importing it drags the whole app into a node test) —
// same style as workspaceToolbar.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
import type { MenuBarEntry, MenuItemDef } from "@monet-ui/monet-react";
import { buildPhotoshopMenus, listMenuCommands } from "./psMenus";

const dialogsSource = readFileSync(new URL("./Dialogs.tsx", import.meta.url), "utf8");

const itemAtPath = (bar: MenuBarEntry[], path: readonly string[]): MenuItemDef | undefined => {
  let items = bar.find((menu) => menu.label === path[0])?.items;
  let found: MenuItemDef | undefined;
  for (const label of path.slice(1)) {
    found = items?.find((item) => item.label === label);
    items = found?.items;
  }
  return found;
};
const flatten = (items: MenuItemDef[]): MenuItemDef[] =>
  items.flatMap((it) => [it, ...(it.items ? flatten(it.items) : [])]);

describe("Edit ▸ Menus… / Edit ▸ Toolbar…", () => {
  it("opens the Keyboard Shortcuts and Menus dialog from both of Photoshop's doors", () => {
    const shortcutAction = vi.fn<(...args: unknown[]) => void>();
    const generalAction = vi.fn<(...args: unknown[]) => void>();
    const bar = buildPhotoshopMenus({ keyboardshortcuts: shortcutAction, prefgeneral: generalAction });
    const menus = itemAtPath(bar, ["Edit", "Menus…"]);
    expect(menus?.disabled).toBeFalsy();
    menus?.action?.();
    // The blueprint ships Menus… as "prefgeneral", which is a different command.
    expect(shortcutAction).toHaveBeenCalledOnce();
    expect(generalAction).not.toHaveBeenCalled();
  });

  it("wires Edit ▸ Toolbar… to its own command id rather than General Preferences", () => {
    const customize = vi.fn<(...args: unknown[]) => void>();
    const generalAction = vi.fn<(...args: unknown[]) => void>();
    const bar = buildPhotoshopMenus({ customizetoolbar: customize, prefgeneral: generalAction });
    const toolbar = itemAtPath(bar, ["Edit", "Toolbar…"]);
    expect(toolbar?.disabled).toBeFalsy();
    toolbar?.action?.();
    expect(customize).toHaveBeenCalledOnce();
    expect(generalAction).not.toHaveBeenCalled();
  });
});

describe("menu visibility (Menus tab)", () => {
  it("lists every command and submenu with its nesting depth", () => {
    const commands = listMenuCommands();
    const paths = new Set(commands.map((c) => c.path));
    expect(paths.has("Edit ▸ Menus…")).toBe(true);
    expect(paths.has("Edit ▸ Preferences")).toBe(true);
    expect(paths.has("Edit ▸ Preferences ▸ General…")).toBe(true);
    expect(commands.find((c) => c.path === "Edit ▸ Preferences")?.depth).toBe(0);
    expect(commands.find((c) => c.path === "Edit ▸ Preferences ▸ General…")?.depth).toBe(1);
    // Paths are the storage key, so they must be unique.
    expect(paths.size).toBe(commands.length);
  });

  it("keeps a hidden command listed so it can be brought back", () => {
    const hidden = new Set(["Edit ▸ Preferences"]);
    expect(itemAtPath(buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, hidden), ["Edit", "Preferences"])).toBeUndefined();
    // listMenuCommands builds from the unfiltered tree — otherwise hiding a
    // command would strand it out of reach of the checkbox that unhides it.
    expect(listMenuCommands().some((c) => c.path === "Edit ▸ Preferences")).toBe(true);
  });

  it("prunes only the hidden path, not same-named commands in other menus", () => {
    const hidden = new Set(["Edit ▸ Toolbar…"]);
    const bar = buildPhotoshopMenus({ prefgeneral: () => {} }, [], () => {}, undefined, undefined, undefined, new Set(), false, hidden);
    expect(itemAtPath(bar, ["Edit", "Toolbar…"])).toBeUndefined();
    // Menus… shares the blueprint's "prefgeneral" id with Toolbar…; an id-keyed
    // hidden set would have taken it out too.
    expect(itemAtPath(bar, ["Edit", "Menus…"])).toBeDefined();
  });

  it("drops a submenu once all of its children are hidden", () => {
    const children = listMenuCommands()
      .filter((c) => c.path.startsWith("Edit ▸ Preferences ▸ "))
      .map((c) => c.path);
    expect(children.length).toBeGreaterThan(3);
    const bar = buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(children));
    expect(itemAtPath(bar, ["Edit", "Preferences"])).toBeUndefined();
  });

  it("leaves no doubled, leading or trailing separators behind", () => {
    const hidden = new Set(listMenuCommands().filter((_, i) => i % 3 === 0).map((c) => c.path));
    const bar = buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, hidden);
    const lists = [...bar.map((m) => m.items), ...flatten(bar.flatMap((m) => m.items)).filter((it) => it.items).map((it) => it.items!)];
    for (const items of lists) {
      expect(items.length).toBeGreaterThan(0);
      expect(items[0].separator).toBeFalsy();
      expect(items[items.length - 1].separator).toBeFalsy();
      expect(items.some((it, i) => !!it.separator && !!items[i - 1]?.separator)).toBe(false);
    }
  });

  it("returns the bar untouched when nothing is hidden", () => {
    const bar = buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set());
    expect(bar.map((m) => m.id)).toEqual(
      buildPhotoshopMenus({}, [], () => {}, undefined, undefined, undefined, new Set(), false, new Set(["nothing"])).map((m) => m.id),
    );
    expect(itemAtPath(bar, ["Edit", "Preferences", "General…"])).toBeDefined();
  });
});

describe("Keyboard Shortcuts and Menus dialog", () => {
  it("has a Menus tab that persists visibility on OK", () => {
    expect(dialogsSource).toContain('import { listMenuCommands, loadHiddenMenuCommands, saveHiddenMenuCommands } from "./psMenus";');
    expect(dialogsSource).toContain('const [tab, setTab] = useState<"shortcuts" | "menus">(arg === "menus" ? "menus" : "shortcuts");');
    expect(dialogsSource).toContain("const [hidden, setHidden] = useState<ReadonlySet<string>>(loadHiddenMenuCommands);");
    expect(dialogsSource).toContain("store.setKeyboardShortcuts(draft); saveHiddenMenuCommands(hidden); close();");
    expect(dialogsSource).toContain('items={[{ value: "shortcuts", label: "Keyboard Shortcuts" }, { value: "menus", label: "Menus" }]}');
    // Reset All is per-tab, like Photoshop's.
    expect(dialogsSource).toContain('if (tab === "menus") setHidden(new Set()); else chooseSet("");');
  });
});
