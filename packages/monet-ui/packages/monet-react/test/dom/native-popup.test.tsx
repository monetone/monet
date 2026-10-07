// DOM tests for native popup windows (native-popup.tsx). jsdom has no Tauri,
// so the desktop environment is simulated: `__MONET__.nativePopups` (what a
// monet-ui window injects) turns the native path on, `invoke` is mocked, and `window.open`
// returns a same-origin iframe's window — a real second document that React
// portals into, like the popup window's in the app. No jest-dom.

import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

const calls: Array<{ cmd: string; args: Record<string, unknown> }> = [];
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown>) => {
    calls.push({ cmd, args });
    if (cmd === "monet_popup_place") return { x: 10, y: 20, side: "bottom" };
    return null;
  }),
}));

const frames: HTMLIFrameElement[] = [];
const open = vi.fn(() => {
  const frame = document.createElement("iframe");
  document.body.appendChild(frame);
  frames.push(frame);
  // setup.ts polyfills only the main window's realm.
  const w = frame.contentWindow as Window & typeof globalThis;
  w.Element.prototype.scrollIntoView = () => {};
  return w;
});

let Select: typeof import("../../src/controls-select.tsx").Select;
let Menu: typeof import("../../src/menu.tsx").Menu;
let MenuBar: typeof import("../../src/menu.tsx").MenuBar;
let isDropdownOpen: typeof import("../../src/native-popup.tsx").isDropdownOpen;

beforeAll(async () => {
  (window as unknown as Record<string, unknown>).__MONET__ = { nativePopups: true };
  window.open = open as unknown as typeof window.open;
  // Imported after the environment is in place: availability is read at load.
  ({ Select } = await import("../../src/controls-select.tsx"));
  ({ Menu, MenuBar } = await import("../../src/menu.tsx"));
  ({ isDropdownOpen } = await import("../../src/native-popup.tsx"));
});

beforeEach(() => {
  calls.length = 0;
});

const settle = () => act(async () => {
  await new Promise((r) => setTimeout(r, 0));
});
// The popup document currently showing `selector` (the pool pre-creates windows).
const popupWith = (selector: string) =>
  frames.map((f) => f.contentDocument!).find((d) => d.querySelector(selector))!;
const OPTIONS = [
  { value: "a", label: "Alpha" },
  { value: "b", label: "Beta" },
];

describe("Select in a native popup", () => {
  it("renders its list in the popup window, places it beside the trigger, and parks it on pick", async () => {
    const onChange = vi.fn();
    render(<Select aria-label="letter" options={OPTIONS} onChange={onChange} />);
    fireEvent.click(screen.getByRole("combobox", { name: "letter" }));
    await settle();

    expect(String(open.mock.calls[0][0])).toMatch(/^about:blank#monet-popup-/);
    // Not in the app document: in a popup's.
    expect(document.querySelector(".monet-listbox")).toBeNull();
    const doc = popupWith(".monet-listbox");
    expect(doc).toBeTruthy();
    const place = calls.find((c) => c.cmd === "monet_popup_place");
    expect(place?.args).toMatchObject({ side: "bottom", align: "start", offset: 4 });

    fireEvent.click(doc.querySelector('[role="option"][data-value="b"]')!);
    await settle();
    expect(onChange).toHaveBeenCalledWith("b");
    expect(calls.map((c) => c.cmd).filter((c) => c !== "monet_popup_cursor").at(-1)).toBe("monet_popup_hide");
    expect(doc.querySelector(".monet-listbox")).toBeNull();
  });

  it("reuses the pooled window and still reads keys on its trigger", async () => {
    const onChange = vi.fn();
    render(<Select aria-label="letter" options={OPTIONS} onChange={onChange} />);
    const trigger = screen.getByRole("combobox", { name: "letter" });
    const windows = open.mock.calls.length;
    fireEvent.click(trigger);
    await settle();
    expect(open.mock.calls.length).toBe(windows); // a pooled window, no new one
    fireEvent.keyDown(trigger, { key: "ArrowDown" });
    fireEvent.keyDown(trigger, { key: "Enter" });
    await settle();
    expect(onChange).toHaveBeenCalledWith("b");
  });

  it("counts as an open dropdown for app key handlers while its list is up", async () => {
    render(<Select aria-label="letter" options={OPTIONS} />);
    const trigger = screen.getByRole("combobox", { name: "letter" });
    expect(isDropdownOpen()).toBe(false);
    fireEvent.click(trigger);
    await settle();
    expect(document.querySelector(".monet-listbox")).toBeNull(); // it is in the popup
    expect(isDropdownOpen()).toBe(true);
    fireEvent.keyDown(trigger, { key: "Escape" });
    await settle();
    expect(isDropdownOpen()).toBe(false);
  });

  it("closes when the app window loses focus", async () => {
    render(<Select aria-label="letter" options={OPTIONS} />);
    const trigger = screen.getByRole("combobox", { name: "letter" });
    fireEvent.click(trigger);
    await settle();
    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    act(() => {
      window.dispatchEvent(new Event("blur"));
    });
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
  });

  it("drops a placement still queued when the list closes, so the popup stays parked", async () => {
    render(<Select aria-label="letter" options={OPTIONS} />);
    const trigger = screen.getByRole("combobox", { name: "letter" });
    fireEvent.click(trigger); // queues a placement
    fireEvent.keyDown(trigger, { key: "Escape" }); // closes before it runs
    await settle();
    await settle();
    const windowCalls = calls.map((c) => c.cmd).filter((c) => c !== "monet_popup_cursor");
    expect(windowCalls).not.toContain("monet_popup_place");
    expect(windowCalls.at(-1)).toBe("monet_popup_hide");
  });
});

describe("Menu in a native popup", () => {
  const items = (spy: () => void) => [
    { id: "one", label: "One", action: spy },
    {
      id: "more",
      label: "More",
      items: [{ id: "deep", label: "Deep" }],
    },
  ];

  it("forwards the app window's keys to the menu and anchors a submenu to its row", async () => {
    const one = vi.fn();
    render(
      <Menu items={items(one)}>
        {(api) => (
          <button ref={api.ref} onClick={api.toggle} aria-haspopup={api["aria-haspopup"]} aria-expanded={api["aria-expanded"]}>
            Open
          </button>
        )}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    await settle();
    const doc = popupWith('[role="menu"]');
    const activeRow = () => doc.querySelector(".monet-menu-item.is-active")?.textContent;
    await waitFor(() => expect(activeRow()).toContain("One"));
    // Nothing in the popup takes DOM focus (that would blur the app window).
    expect(doc.activeElement).toBe(doc.body);

    // The key lands on the app window; the menu in the popup handles it.
    fireEvent.keyDown(window, { key: "ArrowDown" });
    expect(activeRow()).toContain("More");

    calls.length = 0;
    fireEvent.keyDown(window, { key: "ArrowRight" });
    await settle();
    // The submenu opens in a second popup, anchored to the row's rect offset by
    // where the parent popup landed (10, 20).
    const sub = calls.filter((c) => c.cmd === "monet_popup_place").at(-1);
    expect(sub?.args).toMatchObject({ side: "right", anchor: { x: 10, y: 20 } });
    expect(frames.filter((f) => f.contentDocument!.querySelector('[role="menu"]')).length).toBe(2);

    fireEvent.keyDown(window, { key: "Escape" }); // closes the submenu
    fireEvent.keyDown(window, { key: "ArrowUp" });
    fireEvent.keyDown(window, { key: "Enter" });
    await settle();
    expect(one).toHaveBeenCalledTimes(1);
  });

  it("re-anchors the MenuBar dropdown when hovering to another menu", async () => {
    render(
      <MenuBar
        menus={[
          { id: "file", label: "File", items: [{ id: "new", label: "New" }] },
          { id: "edit", label: "Edit", items: [{ id: "undo", label: "Undo" }] },
        ]}
      />,
    );
    const file = screen.getByRole("menuitem", { name: "File" });
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    file.getBoundingClientRect = () => new DOMRect(10, 0, 40, 20);
    edit.getBoundingClientRect = () => new DOMRect(300, 0, 40, 20);
    fireEvent.click(file);
    await settle();
    calls.length = 0;
    fireEvent.pointerEnter(edit);
    await settle();
    const place = calls.filter((c) => c.cmd === "monet_popup_place").at(-1);
    expect(place?.args).toMatchObject({ anchor: { x: 300, y: 0 } });
    fireEvent.keyDown(window, { key: "Escape" });
    await settle();
  });
});

describe("page reload", () => {
  it("re-adopts the popup windows a previous document of the tab opened", async () => {
    // What the previous document left behind: its session, window count and
    // the (parked) windows themselves, reachable by name.
    const session = sessionStorage.getItem("monet-popup-session");
    const count = Number(sessionStorage.getItem("monet-popup-count"));
    expect(session && count).toBeTruthy();
    const named = new Map(frames.map((f, i) => [`monet-popup-${session}-${i + 1}`, f.contentWindow]));
    const before = open.mock.calls.length;
    open.mockImplementation(((url: string, name: string) =>
      url === "" ? (named.get(name) ?? null) : null) as never);
    try {
      vi.resetModules();
      const fresh = await import("../../src/native-popup.tsx");
      // Looked every window up by name; created none.
      const lookups = open.mock.calls.slice(before);
      expect(lookups.length).toBe(count);
      expect(lookups.every(([url]) => url === "")).toBe(true);
      expect(fresh.isDropdownOpen()).toBe(false);
    } finally {
      open.mockReset();
    }
  });
});
