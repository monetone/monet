// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NumberField } from "./number-field";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;
let container: HTMLElement | null = null;

afterEach(() => {
  act(() => root?.unmount());
  container?.remove();
  root = null;
  container = null;
});

describe("NumberField", () => {
  it("exposes spinbutton values and nudges the typed draft", () => {
    const onCommit = vi.fn();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    act(() => root!.render(<NumberField value={5} min={0} max={10} step={0.5} onCommit={onCommit} />));
    const input = container.querySelector("input")!;

    expect(input).toMatchObject({ role: "spinbutton" });
    expect(input.getAttribute("aria-valuenow")).toBe("5");
    act(() => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "0");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowUp", bubbles: true }));
    });

    expect(onCommit).toHaveBeenLastCalledWith(0.5);
    expect(input.value).toBe("0.5");
  });
});
