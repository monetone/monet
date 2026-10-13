import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";

vi.mock("@engine", () => ({
  default: vi.fn().mockResolvedValue({ memory: new WebAssembly.Memory({ initial: 1 }) }),
  Engine: class Engine {},
}));

import { runBrowserSave } from "./browserSave";
import { Store, type AppSnapshot } from "./store";

interface SeedDocument {
  id: number;
  name: string;
  savedPath: string | null;
  dirty: boolean;
  contentRevision: number;
  pristineBlank: boolean;
}

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

function setupStore(seed: Array<Partial<SeedDocument> & Pick<SeedDocument, "id">> = [{ id: 1 }]) {
  const client = { engine: null, onCommit: null, lastBrush: [] as number[] };
  const store = new Store(client as never);
  const docs: SeedDocument[] = seed.map((doc) => ({
    id: doc.id,
    name: doc.name ?? `document-${doc.id}.mvision`,
    savedPath: doc.savedPath ?? `/documents/document-${doc.id}.mvision`,
    dirty: doc.dirty ?? true,
    contentRevision: doc.contentRevision ?? 1,
    pristineBlank: doc.pristineBlank ?? false,
  }));
  const internal = store as unknown as {
    docs: SeedDocument[];
    activeDocId: number;
    set: (patch: Partial<AppSnapshot>) => void;
  };
  internal.docs = docs;
  internal.activeDocId = docs[0]?.id ?? 0;
  internal.set({
    activeDocId: internal.activeDocId,
    documents: docs.map(({ id, name, dirty, savedPath }) => ({ id, name, dirty, hasFile: !!savedPath })),
  });
  const activate = (id: number) => {
    internal.activeDocId = id;
    internal.set({ activeDocId: id });
  };
  return { store, activate };
}

async function runInPlaceSave(store: Store, docId: number, write: (bytes: Uint8Array) => Promise<void>) {
  const revision = store.docContentRevision(docId);
  if (revision === null) return;
  const bytes = new Uint8Array([revision]);
  await write(bytes);
  store.markDocSavedAtRevision(docId, revision);
}

async function runSaveAs(
  store: Store,
  docId: number,
  choosePath: () => Promise<string>,
  write: (path: string, bytes: Uint8Array) => Promise<void>,
) {
  const revision = store.docContentRevision(docId);
  if (revision === null) return;
  const path = await choosePath();
  const bytes = new Uint8Array([revision]);
  await write(path, bytes);
  store.setDocPathAfterSave(docId, path, revision);
}

describe("revision-aware document saves", () => {
  it("keeps history-transaction transitions dirty-neutral for active and background documents", () => {
    let activeTransaction = true;
    let backgroundTransaction = true;
    const activeEngine = { history_transaction_active: () => activeTransaction };
    const backgroundEngine = { history_transaction_active: () => backgroundTransaction };
    const commit = vi.fn();
    const refreshFromEngine = vi.fn();
    const client = {
      engine: activeEngine,
      onCommit: null,
      lastBrush: [] as number[],
      commit,
      refreshFromEngine,
    };
    const store = new Store(client as never);
    const docs = [
      { id: 1, engine: activeEngine, name: "active.mvision", dirty: false, contentRevision: 4, displayRevision: 0, pristineBlank: true },
      { id: 2, engine: backgroundEngine, name: "background.mvision", dirty: false, contentRevision: 8, displayRevision: 0, pristineBlank: true },
    ];
    const internal = store as unknown as {
      docs: typeof docs;
      activeDocId: number;
      set: (patch: Partial<AppSnapshot>) => void;
    };
    internal.docs = docs;
    internal.activeDocId = 1;
    internal.set({
      activeDocId: 1,
      documents: docs.map(({ id, name, dirty }) => ({ id, name, dirty, hasFile: false })),
    });

    expect(store.mutateDocEngine(1, () => { activeTransaction = false; return true; })).toBe(true);
    expect(refreshFromEngine).toHaveBeenCalledOnce();
    expect(commit).not.toHaveBeenCalled();
    expect(store.docContentRevision(1)).toBe(4);
    expect(store.docDirty(1)).toBe(false);

    expect(store.mutateDocEngine(1, () => { activeTransaction = true; return true; })).toBe(true);
    expect(refreshFromEngine).toHaveBeenCalledTimes(2);
    expect(store.docContentRevision(1)).toBe(4);

    // A cancelled dialog preview repaints the background document without
    // editing it: its display revision moves, so a Window ▸ Arrange pane
    // showing it redraws (#478).
    const shown = store.docDisplayRevision(2)!;
    expect(store.mutateDocEngine(2, () => { backgroundTransaction = false; return true; })).toBe(true);
    expect(store.docContentRevision(2)).toBe(8);
    expect(store.docDirty(2)).toBe(false);
    expect(store.docDisplayRevision(2)).toBeGreaterThan(shown);

    expect(store.mutateDocEngine(2, () => true)).toBe(true);
    expect(store.docContentRevision(2)).toBe(9);
    expect(store.docDirty(2)).toBe(true);
    expect(store.docDisplayRevision(2)).toBeGreaterThan(shown + 1);
  });

  it("repaints every open document's view after font provisioning without dirtying it", () => {
    const refreshFromEngine = vi.fn();
    const refreshVectorFonts = vi.fn();
    const store = new Store({ engine: null, onCommit: null, lastBrush: [], refreshFromEngine } as never);
    const docs = [1, 2].map((id) => ({ id, engine: { refreshVectorFonts }, name: `${id}.mvision`, dirty: false, contentRevision: 5, displayRevision: 0, pristineBlank: false }));
    (store as unknown as { docs: typeof docs }).docs = docs;

    store.refreshVectorFontsForOpenDocs();
    expect(refreshVectorFonts).toHaveBeenCalledTimes(2);
    for (const id of [1, 2]) {
      expect(store.docDisplayRevision(id)).toBe(6); // a background pane keys on this
      expect(store.docContentRevision(id)).toBe(5); // a save still matches
      expect(store.docDirty(id)).toBe(false);
    }
  });

  it("keeps an in-place document dirty when it changes during a deferred write", async () => {
    const { store } = setupStore([{ id: 1, contentRevision: 4 }]);
    const write = deferred<void>();
    const saving = runInPlaceSave(store, 1, () => write.promise);

    store.markDocDirty(1);
    expect(store.docContentRevision(1)).toBe(5);
    write.resolve();
    await saving;

    expect(store.docDirty(1)).toBe(true);
  });

  it("adopts a Save As path but stays dirty after edits during the dialog and write", async () => {
    const { store } = setupStore([{ id: 1, name: "draft.mvision", savedPath: null, contentRevision: 8 }]);
    const chosen = deferred<string>();
    const writeStarted = deferred<void>();
    const writeFinished = deferred<void>();
    const saving = runSaveAs(store, 1, () => chosen.promise, async () => {
      writeStarted.resolve();
      await writeFinished.promise;
    });

    store.markDocDirty(1);
    chosen.resolve("/documents/final.mvision");
    await writeStarted.promise;
    store.markDocDirty(1);
    writeFinished.resolve();
    await saving;

    expect(store.activePath()).toBe("/documents/final.mvision");
    expect(store.docName(1)).toBe("final.mvision");
    expect(store.docDirty(1)).toBe(true);
    expect(store.docContentRevision(1)).toBe(10);
  });

  it("does not let a browser download callback acknowledge a newer edit", () => {
    const { store } = setupStore([{ id: 1, contentRevision: 12 }]);
    const revision = store.docContentRevision(1)!;

    expect(runBrowserSave({
      exportFile: () => new Uint8Array([1]),
      download: () => store.markDocDirty(1),
      markSaved: () => { store.markDocSavedAtRevision(1, revision); },
      reportError: vi.fn(),
      shouldMarkSaved: true,
    })).toBe(true);

    expect(store.docContentRevision(1)).toBe(13);
    expect(store.docDirty(1)).toBe(true);
  });

  it("completes a deferred save against its original tab after a tab switch", async () => {
    const { store, activate } = setupStore([
      { id: 1, contentRevision: 2 },
      { id: 2, contentRevision: 20 },
    ]);
    const write = deferred<void>();
    const saving = runInPlaceSave(store, 1, () => write.promise);

    activate(2);
    store.markDirty();
    write.resolve();
    await saving;

    expect(store.docDirty(1)).toBe(false);
    expect(store.docContentRevision(1)).toBe(2);
    expect(store.docDirty(2)).toBe(true);
    expect(store.docContentRevision(2)).toBe(21);
  });

  it("clears dirty for unchanged in-place, Save As, and browser saves", async () => {
    const { store } = setupStore([{ id: 1, savedPath: null, contentRevision: 30 }]);

    await runInPlaceSave(store, 1, async () => undefined);
    expect(store.docDirty(1)).toBe(false);

    store.markDocDirty(1);
    await runSaveAs(store, 1, async () => "/documents/saved.mvision", async () => undefined);
    expect(store.activePath()).toBe("/documents/saved.mvision");
    expect(store.docDirty(1)).toBe(false);

    store.markDocDirty(1);
    const revision = store.docContentRevision(1)!;
    expect(runBrowserSave({
      exportFile: () => new Uint8Array([1]),
      download: () => undefined,
      markSaved: () => { store.markDocSavedAtRevision(1, revision); },
      reportError: vi.fn(),
      shouldMarkSaved: true,
    })).toBe(true);
    expect(store.docDirty(1)).toBe(false);
  });

  it("captures revisions before serialization or awaits in every app save path", () => {
    const source = readFileSync(fileURLToPath(new URL("./app.ts", import.meta.url)), "utf8");
    const inPlace = source.slice(
      source.indexOf("export const saveDocument = recordedCall("),
      source.indexOf("async function saveDocumentAsImpl(asCopy = false)"),
    );
    const saveAs = source.slice(
      source.indexOf("async function saveDocumentAsImpl(asCopy = false)"),
      source.indexOf("/** File ▸ Package"),
    );

    expect(inPlace.indexOf("store.docContentRevision(docId)")).toBeLessThan(inPlace.indexOf("bytesForExt(ext"));
    expect(inPlace).toContain("store.markDocSavedAtRevision(docId, contentRevision)");
    expect(saveAs.indexOf("store.docContentRevision(docId)")).toBeLessThan(saveAs.indexOf("await import("));
    expect(saveAs.indexOf("store.docContentRevision(docId)")).toBeLessThan(saveAs.indexOf("bytesForExt(ext"));
    expect(saveAs).toContain("store.setDocPathAfterSave(docId, target, contentRevision)");
    expect(saveAs).toContain("store.markDocSavedAtRevision(docId, contentRevision)");
  });
});
