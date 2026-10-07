// Guards #449: Skin Smoothing was implemented, tested and reachable from MCP
// only — no menu entry, no dispatch, no pane. Like appCommands.test.ts, the
// App/Dialogs halves are asserted at source level (importing either drags the
// whole app into a node test); the blueprint is real data.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PS_MENUS, type PsNode } from "./psMenuData";

const appSource = readFileSync(new URL("../App.tsx", import.meta.url), "utf8");
const dialogsSource = readFileSync(new URL("./Dialogs.tsx", import.meta.url), "utf8");

function neuralFilters(): Extract<PsNode, { kind: "submenu" }> {
  const filter = PS_MENUS.find((m) => m.id === "filter")!;
  const walk = (nodes: PsNode[]): Extract<PsNode, { kind: "submenu" }> | undefined => {
    for (const n of nodes) {
      if (n.kind !== "submenu") continue;
      if (n.label === "Neural Filters") return n;
      const inner = walk(n.items);
      if (inner) return inner;
    }
    return undefined;
  };
  return walk(filter.tree)!;
}

describe("Filter ▸ Neural Filters ▸ Skin Smoothing (#449)", () => {
  it("is in the menu with its own id", () => {
    const entry = neuralFilters().items.find((n) => n.kind === "item" && n.monetId === "nskinsmooth");
    expect(entry).toBeDefined();
    expect(entry!.kind === "item" && entry!.label).toMatch(/^Skin Smoothing/);
  });

  it("deep-links into the Neural Filters dialog's own pane", () => {
    expect(appSource).toContain('nskinsmooth: () => open("neuralAI", "skinsmooth"),');
    expect(dialogsSource).toContain('arg === "skinsmooth" ? ssRef');
    expect(dialogsSource).toContain("<div ref={ssRef}");
  });

  it("drives the existing facade with the pane's Blur and Smoothness", () => {
    // The pane must not grow its own smoothing path beside the tested one.
    expect(dialogsSource).toContain("ml.skinSmoothing(ssBlur, ssSmooth, p)");
    expect(dialogsSource).toContain('data-testid="mv-skin-smoothing-apply"');
    // …and keeps the no-face-model notice readable after the run finishes.
    expect(dialogsSource).toContain("no face model installed");
  });
});
