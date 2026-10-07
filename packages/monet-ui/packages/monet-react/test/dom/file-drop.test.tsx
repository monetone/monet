// DOM tests for the shared OS file-drop hook (src/file-drop.ts).
// jsdom is not a Tauri webview (no __TAURI_INTERNALS__), so these exercise the
// browser HTML5 branch — the same branch `vite dev` and Playwright hit. The
// native Tauri branch is a straight mapping onto the same callbacks.

import { afterEach, describe, it, expect, vi } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";

const native = vi.hoisted(() => ({
  handler: undefined as ((event: { payload: {
    type: string;
    paths?: string[];
    position?: { toLogical: (scale: number) => { x: number; y: number } };
  } }) => void) | undefined,
  unlisten: vi.fn(),
  error: undefined as Error | undefined,
}));

vi.mock("@tauri-apps/api/webview", () => ({
  getCurrentWebview: () => ({
    onDragDropEvent: async (handler: typeof native.handler) => {
      if (native.error) throw native.error;
      native.handler = handler;
      return native.unlisten;
    },
  }),
}));

import { useFileDrop } from "../../src/file-drop.ts";

// jsdom has no DragEvent constructor (so no dataTransfer/relatedTarget via an
// event init): build a cancelable Event and hang the drag props off it, which
// is all the hook reads. Returns true when nothing called preventDefault.
function drag(type: "dragover" | "dragleave" | "drop", props: object = {}): boolean {
  const e = Object.assign(new Event(type, { bubbles: true, cancelable: true }), { clientX: 0, clientY: 0 }, props);
  window.dispatchEvent(e);
  return !e.defaultPrevented;
}

const png = (name: string) => new File([new Uint8Array([1])], name, { type: "image/png" });
const transfer = (files: File[] = [], types = ["Files"]) => ({ files, types, dropEffect: "none" });

afterEach(() => {
  delete window.__TAURI_INTERNALS__;
  native.handler = undefined;
  native.unlisten.mockClear();
  native.error = undefined;
});

describe("useFileDrop", () => {
  it("reports hover on dragover and clears it only when the drag leaves the window", () => {
    const onOver = vi.fn();
    renderHook(() => useFileDrop({ onOver }));

    // preventDefault is required or the browser navigates to the dropped file.
    expect(drag("dragover", { dataTransfer: transfer() })).toBe(false);
    expect(onOver).toHaveBeenLastCalledWith(true, { x: 0, y: 0 });

    // A leave into a child element must NOT clear hover…
    drag("dragleave", { relatedTarget: document.body });
    expect(onOver).toHaveBeenCalledTimes(1);

    // …only one that exits the window entirely.
    drag("dragleave", { relatedTarget: null });
    expect(onOver).toHaveBeenLastCalledWith(false);
  });

  it("delivers dropped files and clears hover", () => {
    const onFiles = vi.fn();
    const onOver = vi.fn();
    renderHook(() => useFileDrop({ onFiles, onOver }));

    const files = [png("a.png"), png("b.png")];
    expect(drag("drop", { dataTransfer: transfer(files) })).toBe(false);
    expect(onFiles).toHaveBeenCalledTimes(1);
    expect(onFiles.mock.calls[0][0].map((f: File) => f.name)).toEqual(["a.png", "b.png"]);
    expect(onFiles.mock.calls[0][1]).toEqual({ x: 0, y: 0 });
    expect(onOver).toHaveBeenLastCalledWith(false);
  });

  it("does not fire onFiles for an empty drop, but still clears hover", () => {
    const onFiles = vi.fn();
    const onOver = vi.fn();
    renderHook(() => useFileDrop({ onFiles, onOver }));

    drag("drop", { dataTransfer: transfer() });
    expect(onFiles).not.toHaveBeenCalled();
    expect(onOver).toHaveBeenLastCalledWith(false);
  });

  it("calls the callbacks from the latest render without re-subscribing", () => {
    const first = vi.fn();
    const second = vi.fn();
    const { rerender } = renderHook(({ onFiles }) => useFileDrop({ onFiles }), {
      initialProps: { onFiles: first },
    });

    rerender({ onFiles: second });
    drag("drop", { dataTransfer: transfer([png("a.png")]) });

    expect(first).not.toHaveBeenCalled();
    // Once, not twice: a stale listener from the first render would double it.
    expect(second).toHaveBeenCalledTimes(1);
  });

  it("detaches its listeners on unmount", () => {
    const onFiles = vi.fn();
    const onOver = vi.fn();
    const { unmount } = renderHook(() => useFileDrop({ onFiles, onOver }));

    unmount();
    drag("dragover");
    drag("drop", { dataTransfer: transfer([png("a.png")]) });
    expect(onOver).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("ignores internal drags and element-scoped drop zones", () => {
    const onFiles = vi.fn();
    const onOver = vi.fn();
    renderHook(() => useFileDrop({ onFiles, onOver }));

    expect(drag("dragover", { dataTransfer: transfer([], ["text/plain"]) })).toBe(true);
    const claimed = Object.assign(new Event("drop", { bubbles: true, cancelable: true }), {
      dataTransfer: transfer([png("claimed.png")]),
    });
    claimed.preventDefault();
    window.dispatchEvent(claimed);

    expect(onOver).not.toHaveBeenCalled();
    expect(onFiles).not.toHaveBeenCalled();
  });

  it("maps native Tauri events to paths, hover state, and cleanup", async () => {
    window.__TAURI_INTERNALS__ = {};
    const onPaths = vi.fn();
    const onOver = vi.fn();
    const { unmount } = renderHook(() => useFileDrop({ onPaths, onOver }));
    await waitFor(() => expect(native.handler).toBeTypeOf("function"));

    const position = { toLogical: () => ({ x: 12, y: 34 }) };
    act(() => native.handler!({ payload: { type: "enter", paths: ["/tmp/a.png"], position } }));
    act(() => native.handler!({ payload: { type: "over", position } }));
    act(() => native.handler!({ payload: { type: "leave" } }));
    act(() => native.handler!({ payload: { type: "drop", paths: ["/tmp/a.png", "/tmp/b.psd"], position } }));
    act(() => native.handler!({ payload: { type: "drop", paths: [], position } }));

    expect(onOver.mock.calls.map(([over]) => over)).toEqual([true, true, false, false, false]);
    expect(onOver.mock.calls[0][1]).toEqual({ x: 12, y: 34 });
    expect(onPaths).toHaveBeenCalledOnce();
    expect(onPaths).toHaveBeenCalledWith(["/tmp/a.png", "/tmp/b.psd"], { x: 12, y: 34 });
    await Promise.resolve();
    unmount();
    expect(native.unlisten).toHaveBeenCalledOnce();
  });

  it("reports native listener registration failures", async () => {
    window.__TAURI_INTERNALS__ = {};
    native.error = new Error("IPC unavailable");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});

    renderHook(() => useFileDrop({}));

    await waitFor(() => expect(error).toHaveBeenCalledWith("File drop unavailable:", native.error));
    error.mockRestore();
  });
});
