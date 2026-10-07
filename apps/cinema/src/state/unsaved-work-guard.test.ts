// #506 — Cinema had no unsaved-work guard at all: the window close and every
// quit path (⌘Q, Dock ▸ Quit, logout) discarded a dirty project. The native
// hooks live in the shared Monet guard; this spec proves Cinema's store is the
// dirty source it asks, and that the guard is installed at boot.
import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const shared = vi.hoisted(() => ({ opts: null as { dirtyNames(): string[] } | null }));
vi.mock("@monet-ui/monet-react", () => ({
  installUnsavedWorkGuard: async (opts: { dirtyNames(): string[] }) => {
    shared.opts = opts;
  },
}));

import { createProject } from "../timeline/model/factory";
import { Store } from "./store";
import { installUnsavedWorkGuard } from "./unsaved-work-guard";

const store = new Store();

beforeEach(() => {
  shared.opts = null;
  store.replaceProject(createProject("Untitled"));
});

describe("unsaved work guard", () => {
  it("maps the store's dirty project onto the shared guard", async () => {
    await installUnsavedWorkGuard(store);
    expect(shared.opts).not.toBeNull();

    expect(shared.opts!.dirtyNames()).toEqual([]); // a clean project quits silently

    store.mutate("edit", (project) => {
      project.name = "Titles";
    });
    expect(shared.opts!.dirtyNames()).toEqual(["Titles"]);

    store.markSaved();
    expect(shared.opts!.dirtyNames()).toEqual([]);
  });

  it("is installed by the app entry point", () => {
    const main = readFileSync(new URL("../main.tsx", import.meta.url), "utf8");
    expect(main).toContain("installUnsavedWorkGuard(store)");
  });
});
