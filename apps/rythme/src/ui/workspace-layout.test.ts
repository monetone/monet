// ─────────────────────────────────────────────────────────────
// ui/workspace-layout.test — panels dock LEFT like Adobe Audition
// ─────────────────────────────────────────────────────────────

import { describe, expect, it } from "vitest";
import { WORKSPACE_LAYOUT, WORKSPACE_TOOLBAR_LAYOUT, WORKSPACES, focusPanelInLayout, getWorkspaceLayout } from "./workspace-layout";

// The panel keys App.tsx registers; the layout may only reference these.
const PANELS = new Set(["properties", "effects", "generate", "analyze", "markers", "files", "video", "mixer", "history"]);

describe("workspace layout (Adobe Audition parity)", () => {
  it("docks the panels on the LEFT (Audition), not the right", () => {
    expect(WORKSPACE_LAYOUT.left).toBeDefined();
    expect((WORKSPACE_LAYOUT as Record<string, unknown>).right).toBeUndefined();
  });

  it("puts Files + Effects Rack at the top of the left column, Files active", () => {
    const top = WORKSPACE_LAYOUT.left.stack[0];
    expect(top.tabs).toEqual(expect.arrayContaining(["files", "effects"]));
    expect(top.active).toBe("files");
  });

  it("references only real panel keys", () => {
    for (const group of WORKSPACE_LAYOUT.left.stack) {
      for (const tab of group.tabs) expect(PANELS.has(tab), `unknown panel: ${tab}`).toBe(true);
    }
  });

  it("keeps every panel reachable in some tab group (none lost in the move)", () => {
    const placed = new Set(WORKSPACE_LAYOUT.left.stack.flatMap((g) => g.tabs));
    for (const panel of PANELS) expect(placed.has(panel), `panel not docked anywhere: ${panel}`).toBe(true);
  });

  it("docks the transport at the BOTTOM like Audition (not the top)", () => {
    expect(WORKSPACE_TOOLBAR_LAYOUT.bottom).toContain("options"); // transport bar
    expect((WORKSPACE_TOOLBAR_LAYOUT as Record<string, string[]>).top ?? []).not.toContain("options");
    expect(WORKSPACE_TOOLBAR_LAYOUT.left).toContain("tools"); // tool rail stays on the left
  });
});

describe("focusPanelInLayout (Window menu)", () => {
  // The legacy `stack` shape, as WORKSPACE_LAYOUT uses.
  const groups = (layout: typeof WORKSPACE_LAYOUT) => layout.left.stack;

  it("brings a panel's group to the front by setting its active tab", () => {
    const out = focusPanelInLayout(WORKSPACE_LAYOUT, "effects"); // in the top group (default active: files)
    expect(groups(out)[0].active).toBe("effects");
    expect(groups(out)[1].active).toBe("markers"); // other groups untouched
    expect(groups(out)[2].active).toBe("mixer");
  });

  it("focuses a panel in a lower group", () => {
    expect(groups(focusPanelInLayout(WORKSPACE_LAYOUT, "properties"))[1].active).toBe("properties");
    expect(groups(focusPanelInLayout(WORKSPACE_LAYOUT, "history"))[2].active).toBe("history");
  });

  it("leaves every active tab unchanged when no group holds the panel", () => {
    const out = focusPanelInLayout(WORKSPACE_LAYOUT, "does-not-exist");
    expect(groups(out).map((g) => g.active)).toEqual(["files", "markers", "mixer"]);
  });

  it("preserves the dock size and does not mutate the input", () => {
    const before = JSON.parse(JSON.stringify(WORKSPACE_LAYOUT));
    const out = focusPanelInLayout(WORKSPACE_LAYOUT, "analyze");
    expect(out.left.size).toBe(330);
    expect(WORKSPACE_LAYOUT).toEqual(before); // input untouched
  });

  it("handles the normalized `cols` shape too", () => {
    const layout = { left: { size: 280, cols: [{ stack: [{ tabs: ["a", "b"], active: "a" }] }] } };
    const out = focusPanelInLayout(layout, "b");
    expect(out.left.cols[0].stack[0].active).toBe("b");
  });
});

describe("workspace presets (Audition's Window ▸ Workspace switcher)", () => {
  const presetStack = (id: string) => (getWorkspaceLayout(id).left as typeof WORKSPACE_LAYOUT.left).stack;
  const workspaceStack = (workspace: { layout: unknown }) => ((workspace.layout as typeof WORKSPACE_LAYOUT).left).stack;

  it("offers Default first, then named task workspaces", () => {
    expect(WORKSPACES[0].id).toBe("default");
    expect(WORKSPACES.map((w) => w.label)).toEqual(
      expect.arrayContaining(["Maximum Waveform Editing", "Maximum Spectral Display", "Mixing", "Radio Production"]),
    );
    expect(WORKSPACES.length).toBeGreaterThanOrEqual(4);
  });

  it("the Default workspace is the standard boot layout", () => {
    expect(getWorkspaceLayout("default")).toBe(WORKSPACE_LAYOUT);
  });

  it("references only real panel keys and keeps the panels left-docked", () => {
    for (const w of WORKSPACES) {
      expect((w.layout as Record<string, unknown>).right, w.id).toBeUndefined();
      for (const group of workspaceStack(w)) {
        for (const tab of group.tabs) expect(PANELS.has(tab), `${w.id}: unknown panel ${tab}`).toBe(true);
      }
    }
  });

  it("keeps every preset's active tab inside its own group", () => {
    for (const w of WORKSPACES) {
      expect(workspaceStack(w).length, w.id).toBeGreaterThan(0);
      for (const group of workspaceStack(w)) expect(group.tabs, w.id).toContain(group.active);
    }
  });

  it("falls back to the Default workspace for an unknown id", () => {
    expect(getWorkspaceLayout("does-not-exist")).toBe(WORKSPACE_LAYOUT);
  });

  it("Maximum Waveform Editing shrinks the dock to enlarge the editor", () => {
    expect(getWorkspaceLayout("maxWaveform").left!.size).toBeLessThan(WORKSPACE_LAYOUT.left.size);
  });

  it("Maximum Spectral Display brings the Analyze panel to the front", () => {
    expect(presetStack("maxSpectral")[0].active).toBe("analyze");
  });

  it("Mixing leads with the Mixer", () => {
    expect(presetStack("mixing")[0].active).toBe("mixer");
  });

  it("resolves project custom workspaces before falling back to shipped presets", () => {
    const layout = { left: { size: 280, stack: [{ tabs: ["mixer"], active: "mixer", flex: 1 }] } };
    expect(getWorkspaceLayout("custom-mix", [{ id: "custom-mix", name: "Custom Mix", layout }])).toBe(layout);
  });
});
