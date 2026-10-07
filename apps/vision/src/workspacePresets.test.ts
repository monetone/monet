// Guards VIS-WS-02(a): Window ▸ Workspace ships Photoshop's task-tuned starting
// layouts, so a fresh install has named workspaces before the user saves one.
// App.tsx is asserted at source level (importing it drags the whole app into a
// node test) — same style as workspaceLayout.test.ts / windowMenu.test.ts.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildPhotoshopMenus } from "./ui/psMenus";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");

/** The slice of App.tsx between `marker` and the next top-level `};`/`];`. */
function block(marker: string, close: string): string {
  const start = appSource.indexOf(marker);
  expect(start).toBeGreaterThan(-1);
  const end = appSource.indexOf(close, start);
  expect(end).toBeGreaterThan(start);
  return appSource.slice(start, end);
}

const builtinsSrc = block("const BUILTIN_WORKSPACES", "\n];");
const panelsSrc = block("  const panels = {", "\n  };");
const panelIds = [...panelsSrc.matchAll(/^ {4}(\w+): \{ title:/gm)].map((m) => m[1]);
// Quoted lowercase words inside the presets are panel ids; the workspace names
// ("Essentials", "Graphic and Web") all start uppercase or contain spaces.
const referencedIds = [...builtinsSrc.matchAll(/"([a-z]+)"/g)].map((m) => m[1]);

describe("built-in workspaces", () => {
  it("ships Photoshop's task-tuned layouts, Essentials reusing the factory seed", () => {
    const names = [...builtinsSrc.matchAll(/name: "([^"]+)"/g)].map((m) => m[1]);
    expect(names).toEqual([
      "Essentials", "Photography", "Painting", "Typography", "Graphic and Web", "Motion",
    ]);
    expect(builtinsSrc).toContain('{ name: "Essentials", layout: initialLayout }');
  });

  it("only references panels the app actually registers", () => {
    expect(panelIds).toContain("layers"); // regex sanity: the map was really parsed
    expect(referencedIds.length).toBeGreaterThan(20);
    expect(referencedIds.filter((id) => !panelIds.includes(id))).toEqual([]);
  });

  it("gives every preset the Layers panel — Vision is a layered raster editor", () => {
    // Essentials aliases initialLayout, so check that seed rather than the alias.
    expect(block("const initialLayout", "\n};")).toContain('"layers"');
    for (const preset of builtinsSrc.split(/(?=\{ name: ")/).slice(2)) {
      expect(preset).toContain('"layers"');
    }
  });

  it("feeds built-ins into the Window menu ahead of the user's saved layouts", () => {
    expect(appSource).toContain("workspaces: menuWorkspaces,");
    expect(appSource).toContain("BUILTIN_WORKSPACES.filter((w) => !custom.has(w.name))");
    // Apply resolves against the merged list, not just the saved ones.
    expect(appSource).toContain("const w = menuWorkspaces.find((x) => x.name === name);");
  });
});

describe("Window ▸ Workspace submenu", () => {
  const submenu = (workspaces: { name: string; builtin?: boolean }[]) => {
    const bar = buildPhotoshopMenus({ savews: () => {}, resetws: () => {}, delws: () => {} }, [], () => {}, {
      workspaces,
      onApplyWorkspace: () => {},
    });
    const win = bar.find((menu) => menu.id === "window")!;
    return win.items!.find((i) => i.id === "workspace")!.items!;
  };

  it("lists built-ins first, then custom layouts, separated", () => {
    const items = submenu([
      { name: "Essentials", builtin: true },
      { name: "Photography", builtin: true },
      { name: "Mine" },
    ]);
    const labels = items.filter((i) => !i.separator).map((i) => i.label);
    expect(labels.slice(0, 3)).toEqual(["Essentials", "Photography", "Mine"]);
    // A separator sits between the built-in block and the custom block.
    expect(items[2].separator).toBe(true);
    expect(items[3].label).toBe("Mine");
  });

  it("offers Delete Workspace… only once a custom layout exists", () => {
    const builtinOnly = submenu([{ name: "Essentials", builtin: true }]);
    expect(builtinOnly.some((i) => i.id === "delws")).toBe(false);
    expect(builtinOnly.some((i) => i.id === "resetws")).toBe(true);

    const withCustom = submenu([{ name: "Essentials", builtin: true }, { name: "Mine" }]);
    expect(withCustom.some((i) => i.id === "delws")).toBe(true);
  });

  it("applies by name, so a saved layout shadowing a built-in name still resolves", () => {
    const applied: string[] = [];
    const bar = buildPhotoshopMenus({}, [], () => {}, {
      workspaces: [{ name: "Photography", builtin: true }, { name: "Mine" }],
      onApplyWorkspace: (n) => applied.push(n),
    });
    const items = bar.find((menu) => menu.id === "window")!.items!.find((i) => i.id === "workspace")!.items!;
    items.filter((i) => !i.separator && i.label === "Photography")[0].action!();
    expect(applied).toEqual(["Photography"]);
  });
});
