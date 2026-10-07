import { describe, expect, it, vi } from "vitest";

import { startHistogramPreview } from "./HistogramPanel";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

const imageFactory = () => {
  const image = { onload: null, onerror: null, src: "" } as unknown as HTMLImageElement;
  return { image, create: vi.fn(() => image) };
};

describe("HistogramPanel preview ownership", () => {
  it("revokes a preview resolved after cleanup without creating or committing an image", async () => {
    const preview = deferred<string | null>();
    const { create } = imageFactory();
    const commit = vi.fn();
    const revoke = vi.fn();
    const cleanup = startHistogramPreview(() => preview.promise, create, commit, revoke);

    cleanup();
    preview.resolve("blob:late");
    await preview.promise;
    await Promise.resolve();

    expect(create).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:late");
  });

  it("commits a loaded current image before revoking it exactly once", async () => {
    const events: string[] = [];
    const { image, create } = imageFactory();
    const commit = vi.fn(() => events.push("commit"));
    let cleanup = () => {};
    const revoke = vi.fn(() => {
      events.push("revoke");
      cleanup();
    });
    cleanup = startHistogramPreview(async () => "blob:loaded", create, commit, revoke);
    await Promise.resolve();

    image.onload?.(new Event("load"));
    cleanup();

    expect(commit).toHaveBeenCalledExactlyOnceWith(image);
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:loaded");
    expect(events).toEqual(["commit", "revoke"]);
  });

  it("revokes on cleanup before settlement and makes late load and error harmless", async () => {
    const { image, create } = imageFactory();
    const commit = vi.fn();
    const revoke = vi.fn();
    const cleanup = startHistogramPreview(async () => "blob:cancelled", create, commit, revoke);
    await Promise.resolve();

    cleanup();
    image.onload?.(new Event("load"));
    image.onerror?.(new Event("error"));

    expect(commit).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:cancelled");
  });

  it("revokes once on image error and not again during cleanup", async () => {
    const { image, create } = imageFactory();
    const commit = vi.fn();
    const revoke = vi.fn();
    const cleanup = startHistogramPreview(async () => "blob:error", create, commit, revoke);
    await Promise.resolve();

    image.onerror?.(new Event("error"));
    cleanup();

    expect(commit).not.toHaveBeenCalled();
    expect(revoke).toHaveBeenCalledExactlyOnceWith("blob:error");
  });

  it("does nothing for a null preview", async () => {
    const { create } = imageFactory();
    const commit = vi.fn();
    const revoke = vi.fn();
    const cleanup = startHistogramPreview(async () => null, create, commit, revoke);
    await Promise.resolve();
    cleanup();

    expect(create).not.toHaveBeenCalled();
    expect(commit).not.toHaveBeenCalled();
    expect(revoke).not.toHaveBeenCalled();
  });
});
