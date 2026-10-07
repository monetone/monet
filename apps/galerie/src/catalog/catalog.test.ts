import { beforeEach, describe, expect, it, vi } from "vitest";

const eventMock = vi.hoisted(() => ({
  handler: null as ((event: { payload: number }) => void) | null,
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
  isTauri: vi.fn(() => true),
}));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (_name: string, handler: (event: { payload: number }) => void) => {
    eventMock.handler = handler;
    return () => {};
  }),
}));

import { invoke } from "@tauri-apps/api/core";

import { getDevelopExportIdentity, onPhotoRecipeChanged, onRecipeChanged, setRecipe } from "./catalog";

const nativeInvoke = vi.mocked(invoke);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("catalog recipe changes", () => {
  it("requests the native export identity as one typed catalog snapshot", async () => {
    nativeInvoke.mockResolvedValueOnce({ catalogId: "/catalog.galcat" });
    await getDevelopExportIdentity(7);
    expect(nativeInvoke).toHaveBeenCalledExactlyOnceWith(
      "plugin:catalog|catalog_get_develop_export_identity",
      { id: 7 },
    );
  });

  it("notifies thumbnail state only after Rust accepts the recipe", async () => {
    nativeInvoke.mockResolvedValueOnce('{"processVersion":6,"version":2}');
    const listener = vi.fn();
    const unsubscribe = onRecipeChanged(listener);

    await expect(setRecipe(7, '{"version":2}', 6)).resolves.toBe(
      '{"processVersion":6,"version":2}',
    );
    expect(listener).toHaveBeenCalledExactlyOnceWith(7);
    unsubscribe();
  });

  it("contains a throwing listener and still resolves canonical persistence", async () => {
    nativeInvoke.mockResolvedValueOnce('{"processVersion":6,"version":2}');
    const first = vi.fn(() => {
      throw new Error("listener exploded");
    });
    const second = vi.fn();
    const report = vi.spyOn(console, "error").mockImplementation(() => {});
    const stopFirst = onRecipeChanged(first);
    const stopSecond = onRecipeChanged(second);

    await expect(setRecipe(7, '{"version":2}', 6)).resolves.toBe(
      '{"processVersion":6,"version":2}',
    );
    expect(first).toHaveBeenCalledExactlyOnceWith(7);
    expect(second).toHaveBeenCalledExactlyOnceWith(7);
    expect(report).toHaveBeenCalledOnce();
    stopFirst();
    stopSecond();
    report.mockRestore();
  });

  it("does not invalidate accepted state when recipe persistence fails", async () => {
    nativeInvoke.mockRejectedValueOnce(new Error("invalid recipe"));
    const listener = vi.fn();
    const unsubscribe = onRecipeChanged(listener);

    await expect(setRecipe(7, '{"version":2}', 6)).rejects.toThrow("invalid recipe");
    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("uses a dispatch snapshot when listeners unsubscribe and subscribe", async () => {
    nativeInvoke.mockResolvedValue('{"processVersion":6,"version":2}');
    const calls: string[] = [];
    const added = vi.fn(() => calls.push("added"));
    let stopSecond = () => {};
    const stopFirst = onRecipeChanged(() => {
      calls.push("first");
      stopSecond();
      onRecipeChanged(added);
    });
    stopSecond = onRecipeChanged(() => calls.push("second"));

    await setRecipe(7, '{"version":2}', 6);
    expect(calls).toEqual(["first", "second"]);
    await setRecipe(7, '{"version":2}', 6);
    expect(calls).toEqual(["first", "second", "first", "added"]);
    stopFirst();
    stopSecond();
    onRecipeChanged(added)();
  });

  it("delivers remote recipe events without invoking persistence", () => {
    const listener = vi.fn();
    const unsubscribe = onRecipeChanged(listener);

    eventMock.handler!({ payload: 41 });

    expect(listener).toHaveBeenCalledExactlyOnceWith(41);
    expect(nativeInvoke).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("filters recipe subscriptions by photo and cleanup is exact", () => {
    const listener = vi.fn();
    const unsubscribe = onPhotoRecipeChanged(7, listener);

    eventMock.handler!({ payload: 8 });
    eventMock.handler!({ payload: 7 });
    unsubscribe();
    eventMock.handler!({ payload: 7 });

    expect(listener).toHaveBeenCalledOnce();
  });
});
