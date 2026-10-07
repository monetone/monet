// Fake-timer tests for the auto-write queue: debounce coalescing, latest-state
// resolution, per-photo independence, and the off switch.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("../catalog/catalog", () => ({
  getRecipe: vi.fn(async () => null),
  listKeywords: vi.fn(async () => []),
  listPhotoKeywords: vi.fn(async () => []),
  listSnapshots: vi.fn(async () => []),
}));
vi.mock("./xmpSidecar", () => ({
  buildXmpSidecar: vi.fn(() => "<xml/>"),
  writeXmpFor: vi.fn(async (path: string) => ({ path, onDisk: "<xml/>" })),
  readXmpText: vi.fn(async () => null),
}));

import { listKeywords, listPhotoKeywords, listSnapshots } from "../catalog/catalog";
import type { KeywordRow, PhotoRow, SnapshotRow } from "../catalog/types";
import { buildXmpSidecar, writeXmpFor } from "./xmpSidecar";
import {
  exportKeywords,
  queueXmpWrite,
  resetXmpAutoWriteCache,
  setXmpAutoWriteEnabled,
  writeSidecarForPhoto,
  xmpAutoWriteEnabled,
  type KeywordVocabRow,
} from "./xmpAutoWrite";

const row = (id: number, path = `/p${id}.cr3`) => ({ id, path }) as PhotoRow;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  setXmpAutoWriteEnabled(true);
});

afterEach(() => {
  vi.useRealTimers();
  resetXmpAutoWriteCache();
});

describe("xmp auto-write queue", () => {
  it("coalesces a rapid burst into one write of the latest state", async () => {
    const a1 = row(1, "/old.cr3");
    const a2 = row(1, "/renamed.cr3");
    queueXmpWrite(a1, () => a2);
    queueXmpWrite(a1, () => a2); // burst — restarts the debounce
    await vi.advanceTimersByTimeAsync(2100);
    expect(writeXmpFor).toHaveBeenCalledTimes(1);
    expect(writeXmpFor).toHaveBeenCalledWith("/renamed.cr3", "<xml/>");
  });

  it("keeps per-photo timers independent", async () => {
    queueXmpWrite(row(1));
    queueXmpWrite(row(2));
    await vi.advanceTimersByTimeAsync(2100);
    expect(writeXmpFor).toHaveBeenCalledTimes(2);
  });

  it("is a no-op while disabled, and the toggle persists", () => {
    setXmpAutoWriteEnabled(false);
    queueXmpWrite(row(3));
    vi.advanceTimersByTime(3000);
    expect(writeXmpFor).not.toHaveBeenCalled();
    expect(xmpAutoWriteEnabled()).toBe(false);
  });
});

describe("hierarchical keywords", () => {
  const kw = (name: string, id: number): KeywordRow => ({ id, name });

  it("writes each keyword as its own lr:hierarchicalSubject path", async () => {
    vi.mocked(listPhotoKeywords).mockResolvedValueOnce([kw("Rome", 1), kw("Travel", 2)]);
    await writeSidecarForPhoto(row(1));
    const meta = vi.mocked(buildXmpSidecar).mock.calls[0][0];
    expect(meta.keywords).toEqual(["Rome", "Travel"]);
    expect(meta.hierarchical).toEqual(["Rome", "Travel"]);
  });

  it("keeps a name containing the path separator out of the hierarchy", async () => {
    vi.mocked(listPhotoKeywords).mockResolvedValueOnce([kw("A|B", 1), kw("Rome", 2)]);
    await writeSidecarForPhoto(row(1));
    const meta = vi.mocked(buildXmpSidecar).mock.calls[0][0];
    expect(meta.keywords).toEqual(["A|B", "Rome"]); // still a flat dc:subject
    expect(meta.hierarchical).toEqual(["Rome"]); // no fabricated "A" > "B" levels
  });

  it("writes full root→leaf paths from the vocabulary tree", async () => {
    vi.mocked(listPhotoKeywords).mockResolvedValueOnce([kw("dog", 2)]);
    vi.mocked(listKeywords).mockResolvedValueOnce([
      vocabRow({ id: 1, name: "animal" }),
      vocabRow({ id: 2, name: "dog", parentId: 1 }),
    ] as never);
    await writeSidecarForPhoto(row(1));
    const meta = vi.mocked(buildXmpSidecar).mock.calls[0][0];
    expect(meta.keywords).toEqual(["dog", "animal"]); // parent implied on export
    expect(meta.hierarchical).toEqual(["animal|dog"]);
  });
});

describe("snapshots — same list passed to write and status builds", () => {
  const snap = (over: Partial<SnapshotRow> & { name: string }): SnapshotRow => ({
    id: 1,
    photoId: 1,
    processVersion: null,
    createdAt: 0,
    recipeJson: "{}",
    ...over,
  });

  it("computes listSnapshots once and forwards the identical array to both builds", async () => {
    vi.mocked(listSnapshots).mockResolvedValueOnce([
      snap({ name: "Before", recipeJson: JSON.stringify({ basic: { exposure: 0.2 } }) }),
    ]);
    await writeSidecarForPhoto(row(1));
    expect(listSnapshots).toHaveBeenCalledTimes(1);

    const calls = vi.mocked(buildXmpSidecar).mock.calls;
    const writeSnaps = calls[0][3];
    const statusSnaps = calls[1][3];
    expect(writeSnaps).toEqual([{ name: "Before", recipe: { basic: { exposure: 0.2 } } }]);
    // Same array reference, not just equal content — impossible-by-construction
    // for the write/status builds to disagree on the snapshot list.
    expect(writeSnaps).toBe(statusSnaps);
  });

  it("degrades to no snapshots when listSnapshots is unavailable", async () => {
    vi.mocked(listSnapshots).mockRejectedValueOnce(new Error("boom"));
    await expect(writeSidecarForPhoto(row(9))).resolves.toBeDefined();
    const calls = vi.mocked(buildXmpSidecar).mock.calls;
    expect(calls[0][3]).toEqual([]);
  });
});

describe("exportKeywords (LR per-keyword export flags)", () => {
  const vocab: KeywordVocabRow[] = [
    vocabRow({ id: 1, name: "animal" }),
    vocabRow({ id: 2, name: "dog", parentId: 1, synonyms: "puppy, hound" }),
    vocabRow({ id: 3, name: "wip", includeOnExport: false }),
    vocabRow({ id: 4, name: "secret", parentId: 3 }),
  ];
  const tag = (id: number): KeywordRow => ({
    id,
    name: vocab.find((v) => v.id === id)?.name ?? `#${id}`,
  });

  it("expands ancestors and synonyms into dc:subject", () => {
    expect(exportKeywords([tag(2)], vocab)).toEqual({
      flat: ["dog", "puppy", "hound", "animal"],
      hierarchical: ["animal|dog"],
    });
  });

  it("drops a keyword whose Include On Export is off", () => {
    expect(exportKeywords([tag(3)], vocab)).toEqual({ flat: [], hierarchical: [] });
  });

  it("omits a non-export ancestor from both lists but keeps the child", () => {
    expect(exportKeywords([tag(4)], vocab)).toEqual({
      flat: ["secret"],
      hierarchical: ["secret"], // "wip" elided from the path
    });
  });

  it("honors Export Synonyms / Export Containing Keywords off", () => {
    const v = [
      vocabRow({ id: 1, name: "animal" }),
      vocabRow({
        id: 2,
        name: "dog",
        parentId: 1,
        synonyms: "puppy",
        exportSynonyms: false,
        exportContaining: false,
      }),
    ];
    expect(exportKeywords([{ id: 2, name: "dog" }], v)).toEqual({
      flat: ["dog"],
      hierarchical: ["animal|dog"], // the path itself still carries the parent
    });
  });

  it("falls back to flat names when the vocabulary is empty", () => {
    expect(exportKeywords([{ id: 9, name: "Rome" }], [])).toEqual({
      flat: ["Rome"],
      hierarchical: ["Rome"],
    });
  });
});

function vocabRow(partial: Partial<KeywordVocabRow> & { id: number; name: string }): KeywordVocabRow {
  return {
    parentId: null,
    synonyms: "",
    includeOnExport: true,
    exportContaining: true,
    exportSynonyms: true,
    ...partial,
  };
}
