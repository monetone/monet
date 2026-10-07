// metadataStatus tests: divergence classification, baseline persistence, the
// badge mapping, and the end-to-end save → edit → external-edit → conflict
// flow through writeSidecarForPhoto / recordMetadataRead / metadataStatusFor
// over an in-memory fake disk.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { disk } = vi.hoisted(() => ({ disk: new Map<string, string>() }));

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-fs", () => ({
  readTextFile: vi.fn(async (p: string) => {
    const t = disk.get(p);
    if (t == null) throw new Error(`ENOENT: ${p}`);
    return t;
  }),
  writeTextFile: vi.fn(async (p: string, t: string) => void disk.set(p, t)),
}));
vi.mock("../catalog/catalog", () => ({
  getRecipe: vi.fn(async () => null),
  listKeywords: vi.fn(async () => []),
  listPhotoKeywords: vi.fn(async () => []),
}));

import { xmpSidecarPath } from "@monet-ui/monet-photo";

import type { PhotoRow } from "../catalog/types";
import type { PresetStorage } from "./exportPresets";
import { metadataStatusBadge } from "../ui/photoBadges";
import {
  compareMetadataSync,
  contentDigest,
  getMetadataBaseline,
  onMetadataStatusChanged,
  recordMetadataSync,
  resetMetadataBaselines,
} from "./metadataStatus";
import { metadataStatusFor, recordMetadataRead, writeSidecarForPhoto } from "./xmpAutoWrite";

const row = (id: number, over: Partial<PhotoRow> = {}): PhotoRow =>
  ({
    id,
    path: `/p${id}.cr3`,
    rating: 0,
    flag: 0,
    colorLabel: null,
    title: null,
    caption: null,
    creator: null,
    copyright: null,
    city: null,
    stateProvince: null,
    country: null,
    jobTitle: null,
    credit: null,
    source: null,
    ...over,
  }) as PhotoRow;

function fakeStorage(): PresetStorage {
  const m = new Map<string, string>();
  return {
    getItem: (k) => m.get(k) ?? null,
    setItem: (k, v) => void m.set(k, v),
  };
}

beforeEach(() => {
  disk.clear();
  resetMetadataBaselines();
  try {
    globalThis.localStorage?.clear();
  } catch {
    // no localStorage in this environment — the in-memory cache is enough
  }
});

afterEach(() => {
  resetMetadataBaselines();
});

describe("compareMetadataSync", () => {
  const base = { file: contentDigest("<f/>"), catalog: contentDigest("<c/>") };

  it("classifies all four outcomes", () => {
    expect(compareMetadataSync(base, "<f/>", "<c/>")).toBe("synced");
    expect(compareMetadataSync(base, "<f/>", "<c2/>")).toBe("catalogNewer");
    expect(compareMetadataSync(base, "<f2/>", "<c/>")).toBe("fileNewer");
    expect(compareMetadataSync(base, "<f2/>", "<c2/>")).toBe("conflict");
  });

  it("counts a deleted sidecar as an external change", () => {
    expect(compareMetadataSync(base, null, "<c/>")).toBe("fileNewer");
  });
});

describe("baseline persistence", () => {
  it("round-trips through storage and notifies subscribers", () => {
    const storage = fakeStorage();
    const heard = vi.fn<(...args: unknown[]) => void>();
    const off = onMetadataStatusChanged(heard);
    recordMetadataSync(7, "<f/>", "<c/>", storage);
    expect(heard).toHaveBeenCalledTimes(1);
    // A fresh in-memory cache must reload the persisted blob.
    resetMetadataBaselines();
    expect(getMetadataBaseline(7, storage)).toEqual({
      file: contentDigest("<f/>"),
      catalog: contentDigest("<c/>"),
    });
    expect(getMetadataBaseline(8, storage)).toBeNull();
    off();
    recordMetadataSync(7, "<f/>", "<c/>", storage);
    expect(heard).toHaveBeenCalledTimes(1); // unsubscribed
  });
});

describe("metadataStatusBadge", () => {
  it("maps the three warning states to LR's arrows and hides the rest", () => {
    expect(metadataStatusBadge("catalogNewer")?.glyph).toBe("↑");
    expect(metadataStatusBadge("fileNewer")?.glyph).toBe("↓");
    expect(metadataStatusBadge("conflict")?.glyph).toBe("⇅");
    expect(metadataStatusBadge("synced")).toBeNull();
    expect(metadataStatusBadge("unknown")).toBeNull();
  });
});

describe("save / read / external-edit flow", () => {
  it("is unknown before any sync, synced after a save", async () => {
    const r = row(1);
    expect(await metadataStatusFor(r)).toBe("unknown");
    await writeSidecarForPhoto(r);
    expect(disk.has(xmpSidecarPath(r.path))).toBe(true);
    expect(await metadataStatusFor(r)).toBe("synced");
  });

  it("flags catalog edits, external edits, and both as conflict", async () => {
    const r = row(2);
    await writeSidecarForPhoto(r);
    const edited = row(2, { rating: 3 });
    expect(await metadataStatusFor(edited)).toBe("catalogNewer");

    const sidecar = xmpSidecarPath(r.path);
    disk.set(sidecar, disk.get(sidecar)! + "<!-- external edit -->");
    expect(await metadataStatusFor(r)).toBe("fileNewer");
    expect(await metadataStatusFor(edited)).toBe("conflict");

    disk.delete(sidecar); // deleted sidecar = external change too
    expect(await metadataStatusFor(r)).toBe("fileNewer");
  });

  it("re-baselines on Read Metadata from File (resolve: import from disk)", async () => {
    const r = row(3);
    await writeSidecarForPhoto(r);
    const sidecar = xmpSidecarPath(r.path);
    disk.set(sidecar, disk.get(sidecar)! + "<!-- external edit -->");
    expect(await metadataStatusFor(r)).toBe("fileNewer");
    // The panel applies the sidecar to the catalog, then records the read.
    await recordMetadataRead(r);
    expect(await metadataStatusFor(r)).toBe("synced");
  });

  it("re-baselines on save (resolve: overwrite settings)", async () => {
    const r = row(4);
    await writeSidecarForPhoto(r);
    const sidecar = xmpSidecarPath(r.path);
    disk.set(sidecar, disk.get(sidecar)! + "<!-- external edit -->");
    const edited = row(4, { title: "mine" });
    expect(await metadataStatusFor(edited)).toBe("conflict");
    await writeSidecarForPhoto(edited);
    expect(await metadataStatusFor(edited)).toBe("synced");
  });
});
