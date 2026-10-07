// GAL-LIB-19: File ▸ "New Collection…" used to be a silent no-op. It must now
// create through the store and browse the result, and refuse blank/reserved
// names the way the CollectionsPanel form does.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const createCollection = vi.fn<(...args: unknown[]) => Promise<number | null>>(async () => 7);
const setActiveCollection = vi.fn<(...args: unknown[]) => Promise<void>>(async () => {});
const setModule = vi.fn<(...args: unknown[]) => void>();
const notify = vi.fn<(...args: unknown[]) => void>();

vi.mock("../state/store", () => ({
  PREVIOUS_IMPORT_NAME: "Previous Import",
  store: { createCollection, setActiveCollection, setModule, notify },
}));

const { newCollectionFromMenu } = await import("./newCollection");

// vitest runs these under the node env, so window is stubbed like print.test.ts.
const promptWith = (value: string | null) => vi.stubGlobal("window", { prompt: () => value });

beforeEach(() => {
  createCollection.mockClear().mockResolvedValue(7);
  setActiveCollection.mockClear();
  setModule.mockClear();
  notify.mockClear();
});

afterEach(() => vi.unstubAllGlobals());

describe("newCollectionFromMenu", () => {
  it("creates the trimmed name and browses it in the grid", async () => {
    promptWith("  Iceland  ");
    await newCollectionFromMenu();
    expect(createCollection).toHaveBeenCalledWith("Iceland");
    expect(setModule).toHaveBeenCalledWith("grid");
    expect(setActiveCollection).toHaveBeenCalledWith(7);
  });

  it("does nothing when cancelled or given a blank name", async () => {
    promptWith(null);
    await newCollectionFromMenu();
    promptWith("   ");
    await newCollectionFromMenu();
    expect(createCollection).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
  });

  it("refuses the reserved sentinel names", async () => {
    promptWith("Quick Collection");
    await newCollectionFromMenu();
    promptWith("Previous Import");
    await newCollectionFromMenu();
    expect(createCollection).not.toHaveBeenCalled();
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it("stays put when the catalog refuses the create", async () => {
    createCollection.mockResolvedValue(null);
    promptWith("Iceland");
    await newCollectionFromMenu();
    expect(setModule).not.toHaveBeenCalled();
    expect(setActiveCollection).not.toHaveBeenCalled();
  });
});
