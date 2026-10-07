// DOM tests for the dockable view-layer helpers (dockable-views.tsx).
// beginPointerSession is the single drag driver for every dock gesture (tab
// drag, float move/resize, all four splitters, toolbar grip), so its teardown
// paths are the thing worth pinning.

import { describe, it, expect, vi, afterEach } from "vitest";
import { fireEvent, render } from "@testing-library/react";

import { beginPointerSession, DDock, DFloat } from "../../src/dockable-views.tsx";

afterEach(() => {
  window.dispatchEvent(new Event("blur"));
  document.body.style.cursor = "";
});

describe("beginPointerSession", () => {
  it("tears the session down on pointercancel (#175)", () => {
    const move = vi.fn();
    const up = vi.fn();
    const onCancel = vi.fn();
    beginPointerSession({ move, up, onCancel, cursor: "col-resize" });
    expect(document.body.style.cursor).toBe("col-resize");

    // A touch/pen interruption or a system gesture takeover fires pointercancel
    // INSTEAD of pointerup — the session used to survive it forever.
    window.dispatchEvent(new Event("pointercancel"));
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(up).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");

    // …and every listener is gone: no stale drag, no stale Escape handler.
    window.dispatchEvent(new Event("pointermove"));
    expect(move).not.toHaveBeenCalled();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel).toHaveBeenCalledTimes(1);
    window.dispatchEvent(new Event("pointerup"));
    expect(up).not.toHaveBeenCalled();
  });

  it("still commits on pointerup and cancels on Escape", () => {
    const up = vi.fn();
    const onCancel = vi.fn();
    beginPointerSession({ move: vi.fn(), up, onCancel, cursor: "row-resize" });
    window.dispatchEvent(new Event("pointerup"));
    expect(up).toHaveBeenCalledTimes(1);
    expect(onCancel).not.toHaveBeenCalled();
    expect(document.body.style.cursor).toBe("");

    const onCancel2 = vi.fn();
    beginPointerSession({ move: vi.fn(), up: vi.fn(), onCancel: onCancel2 });
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    expect(onCancel2).toHaveBeenCalledTimes(1);
  });

  it("drops interrupted and superseded sessions instead of moving two splitters", () => {
    const staleMove = vi.fn();
    const staleCancel = vi.fn();
    beginPointerSession({ move: staleMove, up: vi.fn(), onCancel: staleCancel });
    window.dispatchEvent(new Event("blur"));
    window.dispatchEvent(new Event("pointermove"));
    expect(staleCancel).toHaveBeenCalledTimes(1);
    expect(staleMove).not.toHaveBeenCalled();

    const firstMove = vi.fn();
    const firstCancel = vi.fn();
    beginPointerSession({ move: firstMove, up: vi.fn(), onCancel: firstCancel });
    const nextMove = vi.fn();
    beginPointerSession({ move: nextMove, up: vi.fn() });
    window.dispatchEvent(new Event("pointermove"));
    expect(firstMove).not.toHaveBeenCalled();
    expect(firstCancel).not.toHaveBeenCalled();
    expect(nextMove).toHaveBeenCalledTimes(1);
  });
});

describe("DDock splitter", () => {
  // `dock.size` is a body-local (pre-transform) px value, so a screen-pixel
  // pointer delta has to be divided by the .monet-body scale — every other
  // measurement path in the engine does it (DFloat resize, hit tests, snap rects).
  const renderDock = (scale: number, onResizeDock: (side: string, n: number) => void) => {
    const { container } = render(
      <div className="monet-body">
        <DDock side="left" dock={{ size: 300, cols: [] }} panels={{}} accent="#f00"
               onResizeDock={onResizeDock} />
      </div>,
    );
    const body = container.querySelector(".monet-body") as HTMLElement;
    Object.defineProperty(body, "offsetWidth", { configurable: true, value: 400 });
    body.getBoundingClientRect = () => ({ width: 400 * scale, height: 0, top: 0, left: 0, right: 0, bottom: 0, x: 0, y: 0, toJSON: () => ({}) });
    return container.querySelector('[role="separator"]') as HTMLElement;
  };

  afterEach(() => fireEvent.pointerUp(window));

  it("converts the pointer delta through the container scale (#179)", () => {
    const onResizeDock = vi.fn();
    const splitter = renderDock(2, onResizeDock);
    fireEvent.pointerDown(splitter, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0 });
    // 100 screen px at 2× zoom is 50 body-local px of dock width.
    expect(onResizeDock).toHaveBeenLastCalledWith("left", 350);
  });

  it("is unchanged at scale 1", () => {
    const onResizeDock = vi.fn();
    const splitter = renderDock(1, onResizeDock);
    fireEvent.pointerDown(splitter, { button: 0, clientX: 100, clientY: 0 });
    fireEvent.pointerMove(window, { clientX: 200, clientY: 0 });
    expect(onResizeDock).toHaveBeenLastCalledWith("left", 400);
  });
});

describe("DFloat — Escape", () => {
  // The float wraps arbitrary app panel content. Binding Escape to the float
  // ROOT means Escape inside any control the app renders — a search field, a
  // colour input — deletes the whole floating panel out of the layout.
  const floatWith = (onCloseFloat: () => void) => {
    const f = {
      id: "f1",
      x: 10,
      y: 10,
      w: 300,
      h: 200,
      cols: [{ kind: "panel", size: 300, stack: [{ tabs: ["p"], active: "p", flex: 1 }] }],
    };
    const panels = { p: { title: "Panel", render: () => <input data-testid="inner" /> } };
    return render(
      <DFloat
        f={f}
        panels={panels}
        accent="#888"
        onActivate={() => {}}
        onClose={() => {}}
        onDragTab={() => {}}
        onDragHeader={() => {}}
        onCloseFloat={onCloseFloat}
        onResize={() => {}}
        onResizeGroup={() => {}}
        onResizeCol={() => {}}
      />,
    );
  };

  it("does not close the float when Escape is pressed inside panel content", () => {
    const onCloseFloat = vi.fn();
    const { getByTestId } = floatWith(onCloseFloat);
    fireEvent.keyDown(getByTestId("inner"), { key: "Escape" });
    expect(onCloseFloat).not.toHaveBeenCalled();
  });

  it("still closes from the float's own chrome", () => {
    const onCloseFloat = vi.fn();
    const { container } = floatWith(onCloseFloat);
    const bar = container.querySelector(".monet-float-bar")!;
    fireEvent.keyDown(bar, { key: "Escape" });
    expect(onCloseFloat).toHaveBeenCalledWith("f1");
  });

  it("still closes when the float root itself has focus", () => {
    const onCloseFloat = vi.fn();
    const { container } = floatWith(onCloseFloat);
    const root = container.querySelector("[data-float-id]")!;
    fireEvent.keyDown(root, { key: "Escape" });
    expect(onCloseFloat).toHaveBeenCalledWith("f1");
  });
});
