// thumbnailLoader.test — the (id, size) composite cache key. Regression guard:
// a photo's 128px filmstrip blob must never satisfy a 256px grid request (and
// vice-versa), or the grid renders a blurry upscaled thumbnail. The tauri fs +
// wasm generator are mocked so this stays a pure node unit test.

import { beforeEach, describe, expect, it, vi } from "vitest";

const catalogMock = vi.hoisted(() => ({
  recipeChanged: null as ((photoId: number) => void) | null,
}));

vi.mock("@tauri-apps/plugin-fs", () => ({
  readFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
}));
vi.mock("./thumbnails", () => ({
  fitDimensions: vi.fn((width: number, height: number, maxEdge: number) => {
    const scale = Math.min(1, maxEdge / Math.max(width, height));
    return { width: Math.round(width * scale), height: Math.round(height * scale) };
  }),
  generateThumbnail: vi.fn(async (_bytes: Uint8Array, _raw: boolean, maxEdge: number) => ({
    url: `blob:${maxEdge}`,
    width: maxEdge,
    height: maxEdge,
    encoded: new Uint8Array([maxEdge & 0xff]),
  })),
  urlFromEncoded: vi.fn(() => "blob:cache"),
}));
vi.mock("../rawDecode", () => ({
  rawFrameMetadata: vi.fn((value) => value),
}));
vi.mock("../catalog/catalog", () => ({
  catalogAvailable: vi.fn(() => false),
  previewRequest: vi.fn(async (_photoId: number, kind: string, maxEdge: number) => ({
    identity: {
      identityVersion: 2,
      sourceDigest: "00".repeat(32),
      decoderBackend: "fixture",
      backendRevision: "1",
      decoderVersion: "1",
      osBuild: "test",
      decodeIntentDigest: "11".repeat(32),
      nativeWidth: 4000,
      nativeHeight: 3000,
      activeArea: [0, 0, 4000, 3000],
      sourceOrientation: 1,
      outputOrientation: 1,
      orientationApplied: false,
      recipeDigest: "22".repeat(32),
      processVersion: 6,
      maskDigest: "33".repeat(32),
      modelVersions: [],
      workingProfileDigest: "44".repeat(32),
      coreRevision: "preview-identity-v2.3",
      previewKind: kind,
      outputWidth: maxEdge,
      outputHeight: Math.round(maxEdge * 0.75),
      scaleNumerator: maxEdge,
      scaleDenominator: 4000,
    },
    cacheKey: "default-key",
    recipeJson: JSON.stringify({ rawDecode: { mode: "asShot" }, basic: { exposure: 0 } }),
  })),
  previewGet: vi.fn(async () => null),
  previewPut: vi.fn(async () => {}),
  onRecipeChanged: vi.fn((listener: (photoId: number) => void) => {
    catalogMock.recipeChanged = listener;
    return () => {};
  }),
}));

import * as cat from "../catalog/catalog";
import type { PhotoRow, PreviewRequestV2 } from "../catalog/types";
import { generateThumbnail } from "./thumbnails";
import { loadPreview, loadThumbnail, peekThumbnail, buildPreviews, previewTargetEdge } from "./thumbnailLoader";

const gen = vi.mocked(generateThumbnail);

function photo(id: number): PhotoRow {
  return {
    id,
    path: `/p${id}.jpg`,
    format: "jpg",
    width: 4000,
    height: 3000,
    orientation: 1,
  } as unknown as PhotoRow;
}

function request(
  cacheKey: string,
  recipeDigest = "22".repeat(32),
  previewKind: PreviewRequestV2["identity"]["previewKind"] = "thumbnail",
  maxEdge = 256,
): PreviewRequestV2 {
  return {
    identity: {
      identityVersion: 2,
      sourceDigest: "00".repeat(32),
      decoderBackend: "fixture",
      backendRevision: "1",
      decoderVersion: "1",
      osBuild: "test",
      decodeIntentDigest: "11".repeat(32),
      nativeWidth: 4000,
      nativeHeight: 3000,
      activeArea: [0, 0, 4000, 3000],
      sourceOrientation: 1,
      outputOrientation: 1,
      orientationApplied: false,
      recipeDigest,
      processVersion: 6,
      maskDigest: "33".repeat(32),
      modelVersions: [],
      workingProfileDigest: "44".repeat(32),
      coreRevision: "preview-identity-v2.3",
      previewKind,
      outputWidth: maxEdge,
      outputHeight: Math.round(maxEdge * 0.75),
      scaleNumerator: maxEdge,
      scaleDenominator: 4000,
    },
    cacheKey,
    recipeJson: JSON.stringify({ rawDecode: { mode: "asShot" }, basic: { exposure: 0 } }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(cat.previewRequest).mockReset().mockImplementation(async (_photoId, kind, maxEdge) =>
    request("default-key", "22".repeat(32), kind, maxEdge),
  );
  vi.mocked(cat.previewGet).mockReset().mockResolvedValue(null);
  vi.mocked(cat.previewPut).mockReset().mockResolvedValue(undefined);
  gen.mockReset().mockImplementation(async (_bytes, _raw, maxEdge) => ({
    url: `blob:${maxEdge}`,
    width: maxEdge,
    height: maxEdge,
    encoded: new Uint8Array([maxEdge & 0xff]),
  }));
  // Default: no native catalog (browser/node) — the composite-key tests below
  // exercise the pure in-memory path.
  vi.mocked(cat.catalogAvailable).mockReturnValue(false);
});

describe("thumbnailLoader composite (id, maxEdge) key", () => {
  it("caches per size — the 128px blob never satisfies a 256px request", async () => {
    const p = photo(1);
    const small = await loadThumbnail(p, 128);
    const large = await loadThumbnail(p, 256);
    expect(small).toBe("blob:128");
    expect(large).toBe("blob:256");
    // One decode per size (not a single blob shared across sizes by id).
    expect(gen).toHaveBeenCalledTimes(2);
    // peek is size-specific.
    expect(peekThumbnail(1, 128)).toBe("blob:128");
    expect(peekThumbnail(1, 256)).toBe("blob:256");
    // A size that was never generated is a miss (doesn't fall back to another).
    expect(peekThumbnail(1, 512)).toBeNull();
  });

  it("dedups concurrent same-size requests into one decode", async () => {
    gen.mockClear();
    const p = photo(2);
    const [a, b] = await Promise.all([loadThumbnail(p, 256), loadThumbnail(p, 256)]);
    expect(a).toBe("blob:256");
    expect(b).toBe("blob:256");
    expect(gen).toHaveBeenCalledTimes(1); // shared in-flight promise
  });
});

describe("thumbnailLoader native preview cache", () => {
  it("returns a native cache hit without decoding via the engine", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewGet).mockResolvedValueOnce(new Uint8Array([9, 9]));
    gen.mockClear();

    const url = await loadThumbnail(photo(10), 256);
    expect(url).toBe("blob:cache"); // from urlFromEncoded
    expect(cat.previewGet).toHaveBeenCalledWith(
      10,
      "thumbnail",
      expect.objectContaining({ outputWidth: 256, outputHeight: 192, recipeDigest: expect.any(String) }),
    );
    expect(gen).not.toHaveBeenCalled(); // engine decode skipped entirely
    expect(cat.previewPut).not.toHaveBeenCalled();
  });

  it("write-throughs a freshly generated thumbnail to the disk cache", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewGet).mockResolvedValueOnce(null); // cache miss
    gen.mockClear();
    vi.mocked(cat.previewPut).mockClear();

    const url = await loadThumbnail(photo(11), 256);
    expect(url).toBe("blob:256"); // freshly generated
    expect(gen).toHaveBeenCalledTimes(1);
    expect(cat.previewPut).toHaveBeenCalledWith(
      11,
      "thumbnail",
      256,
      expect.objectContaining({ outputWidth: 256, outputHeight: 192 }),
      null,
      expect.any(Uint8Array),
    );
  });

  it("consults Rust again and returns recipe-2 after a sequential recipe-1 load", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest)
      .mockResolvedValueOnce(request("recipe-1", "11".repeat(32)))
      .mockResolvedValueOnce(request("recipe-2", "22".repeat(32)));
    vi.mocked(cat.previewGet).mockResolvedValueOnce(null).mockResolvedValueOnce(null);
    gen
      .mockResolvedValueOnce({
        url: "blob:recipe-1",
        width: 256,
        height: 192,
        encoded: new Uint8Array([1]),
      })
      .mockResolvedValueOnce({
        url: "blob:recipe-2",
        width: 256,
        height: 192,
        encoded: new Uint8Array([2]),
      })
      .mockClear();

    expect(await loadThumbnail(photo(30), 256)).toBe("blob:recipe-1");
    expect(await loadThumbnail(photo(30), 256)).toBe("blob:recipe-2");
    expect(cat.previewRequest).toHaveBeenCalledTimes(2);
    expect(gen).toHaveBeenCalledTimes(2);
  });

  it("invalidates the mounted last-known URL and reloads the new identity", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest)
      .mockResolvedValueOnce(request("before"))
      .mockResolvedValueOnce(request("after", "55".repeat(32)));
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    gen
      .mockResolvedValueOnce({
        url: "blob:before",
        width: 256,
        height: 192,
        encoded: new Uint8Array([1]),
      })
      .mockResolvedValueOnce({
        url: "blob:after",
        width: 256,
        height: 192,
        encoded: new Uint8Array([2]),
      })
      .mockClear();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    expect(await loadThumbnail(photo(31), 256)).toBe("blob:before");
    expect(peekThumbnail(31, 256)).toBe("blob:before");
    catalogMock.recipeChanged!(31);
    expect(peekThumbnail(31, 256)).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:before");
    expect(await loadThumbnail(photo(31), 256)).toBe("blob:after");
    expect(peekThumbnail(31, 256)).toBe("blob:after");
    revoke.mockRestore();
  });

  it("rejects an old in-flight render after the recipe changes", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest)
      .mockResolvedValueOnce(request("old"))
      .mockResolvedValueOnce(request("current", "66".repeat(32)));
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    let finishOld!: (value: {
      url: string;
      width: number;
      height: number;
      encoded: Uint8Array;
    }) => void;
    gen
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            finishOld = resolve;
          }),
      )
      .mockResolvedValueOnce({
        url: "blob:current",
        width: 256,
        height: 192,
        encoded: new Uint8Array([2]),
      })
      .mockClear();
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    const old = loadThumbnail(photo(32), 256);
    await vi.waitFor(() => expect(gen).toHaveBeenCalledOnce());
    catalogMock.recipeChanged!(32);
    finishOld({ url: "blob:old", width: 256, height: 192, encoded: new Uint8Array([1]) });

    expect(await old).toBeNull();
    expect(peekThumbnail(32, 256)).toBeNull();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:old");
    expect(await loadThumbnail(photo(32), 256)).toBe("blob:current");
    expect(peekThumbnail(32, 256)).toBe("blob:current");
    revoke.mockRestore();
  });

  it("shares one decode for concurrent requests with the same Rust identity", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest).mockResolvedValue(request("same-current"));
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    gen
      .mockResolvedValueOnce({
        url: "blob:shared-current",
        width: 256,
        height: 192,
        encoded: new Uint8Array([1]),
      })
      .mockClear();

    const [first, second] = await Promise.all([
      loadThumbnail(photo(33), 256),
      loadThumbnail(photo(33), 256),
    ]);
    expect(first).toBe("blob:shared-current");
    expect(second).toBe("blob:shared-current");
    expect(gen).toHaveBeenCalledOnce();
  });
});

describe("loadPreview (cache-aware full-size, no LRU)", () => {
  it("returns a native cache hit without decoding", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewGet).mockResolvedValueOnce(new Uint8Array([7]));
    gen.mockClear();

    const url = await loadPreview(photo(20), "standard", 2560);
    expect(url).toBe("blob:cache");
    expect(cat.previewGet).toHaveBeenCalledWith(
      20,
      "standard",
      expect.objectContaining({ outputWidth: 2560, outputHeight: 1920 }),
    );
    expect(gen).not.toHaveBeenCalled();
  });

  it("decodes + write-throughs on a miss under the given kind/size", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewGet).mockResolvedValueOnce(null);
    gen.mockClear();
    vi.mocked(cat.previewPut).mockClear();

    const url = await loadPreview(photo(21), "standard", 2560);
    expect(url).toBe("blob:2560");
    expect(gen).toHaveBeenCalledTimes(1);
    expect(cat.previewPut).toHaveBeenCalledWith(
      21,
      "standard",
      2560,
      expect.objectContaining({ outputWidth: 2560, outputHeight: 1920 }),
      null,
      expect.any(Uint8Array),
    );
  });

  it("reuses the exact Rust identity after a RAW miss without a second decode", async () => {
    const raw = { ...photo(22), format: "raw:ARW" };
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest).mockClear();
    vi.mocked(cat.previewPut).mockClear();
    vi.mocked(cat.previewGet)
      .mockClear()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(new Uint8Array([8]));
    gen
      .mockResolvedValueOnce({
        url: "blob:fresh",
        width: 256,
        height: 192,
        encoded: new Uint8Array([8]),
        decodedRaw: { decoderBackend: "fixture" } as never,
      })
      .mockClear();

    expect(await loadPreview(raw, "standard", 256)).toBe("blob:fresh");
    await vi.waitFor(() => expect(cat.previewPut).toHaveBeenCalledTimes(1));
    const writtenIdentity = vi.mocked(cat.previewPut).mock.calls[0][3];

    expect(await loadPreview(raw, "standard", 256)).toBe("blob:cache");
    expect(gen).toHaveBeenCalledTimes(1);
    expect(vi.mocked(cat.previewGet).mock.calls[1][2]).toEqual(writtenIdentity);
  });

  it("renders and inserts the exact Rust recipe snapshot, including RAW intent", async () => {
    const raw = { ...photo(23), format: "raw:ARW" };
    const recipeJson = JSON.stringify({
      rawDecode: {
        mode: "neutralChromaticity",
        x: 0.31,
        y: 0.33,
        derivationDigest: "55".repeat(32),
      },
      basic: { exposure: 1 },
    });
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest).mockResolvedValueOnce({
      ...(await vi.mocked(cat.previewRequest)(23, "standard", 256)),
      recipeJson,
    });
    vi.mocked(cat.previewGet).mockResolvedValueOnce(null);
    gen.mockResolvedValueOnce({
      url: "blob:raw",
      width: 256,
      height: 192,
      encoded: new Uint8Array([1]),
      decodedRaw: { decoderBackend: "fixture" } as never,
    }).mockClear();

    await loadPreview(raw, "standard", 256);

    expect(gen).toHaveBeenCalledWith(
      expect.any(Uint8Array),
      true,
      256,
      raw.path,
      recipeJson,
      256,
      4000,
    );
    expect(cat.previewPut).toHaveBeenCalledWith(
      23,
      "standard",
      256,
      expect.objectContaining({ recipeDigest: "22".repeat(32) }),
      expect.anything(),
      expect.any(Uint8Array),
    );
  });

  it("settles a delayed write before resolving, then the next request is a zero-render hit", async () => {
    const p = photo(24);
    let stored: Uint8Array | null = null;
    let finishWrite!: () => void;
    const writeGate = new Promise<void>((resolve) => {
      finishWrite = resolve;
    });
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewGet).mockClear().mockImplementation(async () => stored);
    vi.mocked(cat.previewPut).mockClear().mockImplementationOnce(async (_id, _kind, _edge, _identity, _raw, bytes) => {
      await writeGate;
      stored = bytes;
    });
    gen.mockClear();

    const first = loadPreview(p, "standard", 256);
    await vi.waitFor(() => expect(cat.previewPut).toHaveBeenCalledTimes(1));
    let resolved = false;
    void first.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    finishWrite();
    expect(await first).toBe("blob:256");
    expect(await loadPreview(p, "standard", 256)).toBe("blob:cache");
    expect(gen).toHaveBeenCalledTimes(1);
  });

  it("revokes a stale generated URL and retries the current Rust identity", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest)
      .mockResolvedValueOnce(request("old", "11".repeat(32), "standard", 256))
      .mockResolvedValueOnce(request("current", "22".repeat(32), "standard", 256))
      .mockResolvedValueOnce(request("current", "22".repeat(32), "standard", 256));
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    vi.mocked(cat.previewPut)
      .mockRejectedValueOnce(new Error("actual render provenance does not match expected preview identity"))
      .mockResolvedValueOnce(undefined);
    gen
      .mockResolvedValueOnce({
        url: "blob:stale",
        width: 256,
        height: 192,
        encoded: new Uint8Array([1]),
      })
      .mockResolvedValueOnce({
        url: "blob:current",
        width: 256,
        height: 192,
        encoded: new Uint8Array([2]),
      });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await expect(loadPreview(photo(40), "standard", 256)).resolves.toBe("blob:current");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:stale");
    expect(gen).toHaveBeenCalledTimes(2);
    revoke.mockRestore();
  });

  it("revokes a stale disk hit racing recipe invalidation", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest)
      .mockResolvedValueOnce(request("old", "11".repeat(32), "standard", 256))
      .mockResolvedValueOnce(request("current", "22".repeat(32), "standard", 256));
    vi.mocked(cat.previewGet)
      .mockImplementationOnce(async () => {
        catalogMock.recipeChanged!(41);
        return new Uint8Array([1]);
      })
      .mockResolvedValueOnce(null);
    gen.mockResolvedValueOnce({
      url: "blob:current",
      width: 256,
      height: 192,
      encoded: new Uint8Array([2]),
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await expect(loadPreview(photo(41), "standard", 256)).resolves.toBe("blob:current");
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:cache");
    revoke.mockRestore();
  });

  it("returns a current URL when an unrelated insertion fails", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest).mockResolvedValue(
      request("unchanged", "22".repeat(32), "standard", 256),
    );
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    vi.mocked(cat.previewPut).mockRejectedValueOnce(new Error("disk full"));
    gen.mockResolvedValueOnce({
      url: "blob:fresh-current",
      width: 256,
      height: 192,
      encoded: new Uint8Array([2]),
    });
    const revoke = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});

    await expect(loadPreview(photo(42), "standard", 256)).resolves.toBe("blob:fresh-current");
    expect(cat.previewRequest).toHaveBeenCalledTimes(2);
    expect(revoke).not.toHaveBeenCalled();
    revoke.mockRestore();
  });

  it("bounds request-race retries and succeeds when the third attempt is stable", async () => {
    vi.mocked(cat.catalogAvailable).mockReturnValue(true);
    vi.mocked(cat.previewRequest).mockImplementation(async (_id, kind, edge) => {
      const call = vi.mocked(cat.previewRequest).mock.calls.length;
      if (call < 3) catalogMock.recipeChanged!(43);
      return request(`revision-${call}`, `${call}`.repeat(64).slice(0, 64), kind, edge);
    });
    vi.mocked(cat.previewGet).mockResolvedValue(null);
    gen.mockResolvedValueOnce({
      url: "blob:stable",
      width: 256,
      height: 192,
      encoded: new Uint8Array([3]),
    });

    await expect(loadPreview(photo(43), "standard", 256)).resolves.toBe("blob:stable");
    expect(cat.previewRequest).toHaveBeenCalledTimes(3);
    expect(gen).toHaveBeenCalledOnce();
  });
});

describe("buildPreviews", () => {
  it("warms every photo, revokes URLs, and counts failures", async () => {
    const revoked: string[] = [];
    const orig = URL.revokeObjectURL;
    URL.revokeObjectURL = (u: string) => void revoked.push(u);
    try {
      const calls: number[] = [];
      const fake = async (p: { id: number }) => {
        calls.push(p.id);
        return p.id === 2 ? null : `blob:${p.id}`;
      };
      const failed = await buildPreviews(
        [photo(1), photo(2), photo(3)],
        "standard",
        2560,
        fake as never,
      );
      expect(failed).toBe(1);
      expect(calls).toEqual([1, 2, 3]);
      expect(revoked).toEqual(["blob:1", "blob:3"]);
    } finally {
      URL.revokeObjectURL = orig;
    }
  });

  it("resolves a per-photo edge function (1:1 builds)", async () => {
    const edges: number[] = [];
    const fake = async (p: { id: number }, _k: string, e: number) => {
      edges.push(e);
      return null;
    };
    await buildPreviews([photo(1), photo(2)], "standard", (p) => p.id * 100, fake as never);
    expect(edges).toEqual([100, 200]);
  });
});

describe("previewTargetEdge", () => {
  it("caps RAW at the engine proxy ceiling; non-RAW targets native", () => {
    const big = { ...photo(1), width: 8000, height: 6000 };
    expect(previewTargetEdge({ ...big, format: "raw:cr3" })).toBe(4096);
    expect(previewTargetEdge({ ...big, format: "jpeg" })).toBe(8000);
    expect(previewTargetEdge({ ...photo(2), width: 0, height: 0 })).toBe(0);
  });
});
