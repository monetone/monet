// A dirtying edit that never reaches the engine — File ▸ File Info
// (`store.markDirty()` in Dialogs.tsx) and Assign Profile's same-profile ICC
// swap — only mutated the private DocEntry. `state.documents` kept
// `dirty: false`, so closeDocumentTab (which reads the published summary)
// skipped its discard prompt and the edit was lost with no warning. Engine
// commits were safe only because commit → sync republishes the summaries.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tauri = vi.hoisted(() => ({ enabled: false }));

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));
vi.mock("@tauri-apps/api/core", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  isTauri: () => tauri.enabled,
}));

import { closeDocumentTab, store } from "./app";

type SeedDoc = { id: number; name: string; dirty: boolean; contentRevision: number; pristineBlank: boolean };
const seedDocs = (docs: SeedDoc[]) => { (store as unknown as { docs: SeedDoc[] }).docs = docs; };
const setActive = (id: number) => { (store as unknown as { activeDocId: number }).activeDocId = id; };

/** One open, saved document, with the summary published exactly as an ordinary
 *  open/save leaves it. */
function openSavedDoc(id = 1, name = "photo.psd") {
  seedDocs([{ id, name, dirty: false, contentRevision: 0, pristineBlank: false }]);
  setActive(id);
  store.markDocSaved(id); // publishes documents: [{ id, name, dirty: false }]
  return id;
}

beforeEach(() => {
  tauri.enabled = false;
  seedDocs([]);
  setActive(-1);
});
afterEach(() => { seedDocs([]); setActive(-1); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("a metadata-only edit marks the document dirty everywhere", () => {
  it("publishes the flag into state.documents, not just the private entry", () => {
    const id = openSavedDoc();
    expect(store.state.documents).toEqual([{ id, name: "photo.psd", dirty: false, hasFile: false }]);

    store.markDirty(); // exactly what File Info's save does after set_document_metadata

    expect(store.docDirty(id)).toBe(true);
    // The tab '*', the Window menu and the Document Browser dot all read this.
    expect(store.state.documents).toEqual([{ id, name: "photo.psd", dirty: true, hasFile: false }]);
  });

  it("prompts before closing the tab, instead of discarding the edit silently", async () => {
    const id = openSavedDoc();
    store.markDirty();
    const asked: string[] = [];
    vi.stubGlobal("confirm", (message: string) => { asked.push(message); return false; });

    await expect(closeDocumentTab(id)).resolves.toBe(false);

    expect(asked[0]).toContain("Save changes");
    expect(asked[0]).toContain("photo.psd");
    expect(asked[1]).toContain("without saving");
    expect(store.openDocIds()).toEqual([id]); // the work is still open
  });

  it("still closes a clean document without prompting", async () => {
    const id = openSavedDoc();
    const asked: string[] = [];
    vi.stubGlobal("confirm", (message: string) => { asked.push(message); return true; });

    await expect(closeDocumentTab(id)).resolves.toBe(true);

    expect(asked).toEqual([]);
    expect(store.openDocIds()).toEqual([]);
  });

  it("publishes once per dirty transition, not on every later edit", () => {
    const id = openSavedDoc();
    let publishes = 0;
    const stop = store.subscribe(() => { publishes++; });
    try {
      store.markDirty();
      const afterFirst = publishes;
      store.markDirty();
      store.markDirty();
      expect(publishes).toBe(afterFirst); // already dirty — no further notifications
    } finally { stop(); }
    expect(store.docDirty(id)).toBe(true);
  });
});
