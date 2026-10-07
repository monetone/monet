// ─────────────────────────────────────────────────────────────
// commands-trim-view.test — View ▸ Trim View toggle (command)
// ─────────────────────────────────────────────────────────────
// Trim View is a non-destructive view-state flag (like Outline / Hide Edges):
// commands.toggleTrimView flips state.trimView, which defaults off.

import { describe, it, expect } from "vitest";
import { commands } from "./commands";
import { ArtisanStore } from "./engine";

describe("commands.toggleTrimView", () => {
  it("defaults off and toggles on then off", () => {
    const store = new ArtisanStore();
    expect(store.getState().trimView).toBe(false);
    commands.toggleTrimView(store);
    expect(store.getState().trimView).toBe(true);
    commands.toggleTrimView(store);
    expect(store.getState().trimView).toBe(false);
  });
});
