// thumbnails.test — preview encoding regression guard (PERF-12): previews are
// lossy JPEG, never PNG (5-10× the bytes, slower encode/decode on the UI
// thread). The wasm engine + canvas are mocked so this stays a pure node test.

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../engine", () => ({
  decodeImage: vi.fn(async () => ({
    rgba: new Uint8Array(4 * 4 * 4),
    width: 4,
    height: 4,
  })),
}));

import { generateThumbnail, urlFromEncoded } from "./thumbnails";

const blobs: { type: string; quality?: number }[] = [];

class FakeCtx {
  imageSmoothingQuality = "";
  drawImage(): void {}
  putImageData(): void {}
}

class FakeOffscreenCanvas {
  constructor(
    public width: number,
    public height: number,
  ) {}
  getContext(): FakeCtx {
    return new FakeCtx();
  }
  convertToBlob(o: { type: string; quality?: number }) {
    blobs.push(o);
    return Promise.resolve({ arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)) });
  }
}

class FakeImageData {
  constructor(
    public data: Uint8ClampedArray,
    public width: number,
    public height: number,
  ) {}
}

const createdUrls: Blob[] = [];

beforeEach(() => {
  blobs.length = 0;
  createdUrls.length = 0;
  vi.stubGlobal("OffscreenCanvas", FakeOffscreenCanvas);
  vi.stubGlobal("ImageData", FakeImageData);
  URL.createObjectURL = vi.fn<(...args: unknown[]) => string>((blob) => {
    createdUrls.push(blob as Blob);
    return "blob:preview";
  });
});

describe("preview encoding", () => {
  it("generateThumbnail encodes JPEG, not PNG", async () => {
    const res = await generateThumbnail(new Uint8Array([1]), false, 2);

    expect(blobs).toHaveLength(1);
    expect(blobs[0].type).toBe("image/jpeg");
    expect(blobs[0].quality).toBeGreaterThan(0); // lossy on purpose
    expect(res.encoded).toHaveLength(4); // write-through bytes come from the same blob
  });

  it("urlFromEncoded serves cache hits as image/jpeg", () => {
    expect(urlFromEncoded(new Uint8Array([0xff, 0xd8]))).toBe("blob:preview");
    expect(createdUrls[0].type).toBe("image/jpeg");
  });
});
