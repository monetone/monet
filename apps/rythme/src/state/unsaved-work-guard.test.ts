// #506 — Rythme had no unsaved-work guard at all: the window close and every
// quit path (⌘Q, Dock ▸ Quit, logout) discarded a dirty session. The native
// hooks live in the shared Monet guard; this spec proves Rythme's store is the
// dirty source it asks, and that the EditorProvider installs it.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ opts: null as { dirtyNames(): string[] } | null }));
vi.mock("@monet-ui/monet-react", () => ({
  installUnsavedWorkGuard: async (opts: { dirtyNames(): string[] }) => {
    shared.opts = opts;
  },
}));

import { emptyProject } from "../engine/model/factory";
import { setTempo } from "../engine/store/actions";
import { RythmeStore } from "../engine/store/store";
import { installUnsavedWorkGuard } from "./unsaved-work-guard";

let store: RythmeStore;

beforeEach(() => {
  shared.opts = null;
  store = new RythmeStore(emptyProject("Session", 1));
});

describe("unsaved work guard", () => {
  it("maps the store's dirty project onto the shared guard", async () => {
    await installUnsavedWorkGuard(store);
    expect(shared.opts).not.toBeNull();

    expect(shared.opts!.dirtyNames()).toEqual([]); // a clean session quits silently

    store.dispatch(setTempo(140));
    expect(shared.opts!.dirtyNames()).toEqual(["Session"]);

    store.markClean();
    expect(shared.opts!.dirtyNames()).toEqual([]);
  });

  it("is installed by the EditorProvider", () => {
    const ctx = readFileSync(new URL("./store-context.tsx", import.meta.url), "utf8");
    expect(ctx).toContain("installUnsavedWorkGuard(activeStore)");
  });
});
