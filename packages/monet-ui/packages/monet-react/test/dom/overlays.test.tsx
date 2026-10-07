// DOM tests for the overlay layer (overlay-core.tsx / menu.tsx / dialog.tsx).
// Overlays render through a Portal into #monet-overlay-root on document.body;
// queries use screen.* which searches the whole document. No jest-dom.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within, act, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { Tooltip, Popover } from "../../src/overlay-core.tsx";
import { Menu, MenuBar, ContextMenu, type MenuItemDef } from "../../src/menu.tsx";
import { Dialog, ToastProvider, useToast } from "../../src/dialog.tsx";
import { Select } from "../../src/controls-select.tsx";

// ─── Dialog ────────────────────────────────────────────────────
describe("Dialog", () => {
  function DialogHost({ onClose }: { onClose: () => void }) {
    return (
      <Dialog open onClose={onClose} title="Settings" description="Tweak things">
        <input aria-label="field" />
      </Dialog>
    );
  }

  it("renders role=dialog aria-modal labelled by its title", () => {
    render(<DialogHost onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog.getAttribute("aria-modal")).toBe("true");
    // labelled by the title
    expect(dialog.getAttribute("aria-labelledby")).toBeTruthy();
    expect(screen.getByRole("heading", { name: "Settings" })).not.toBeNull();
  });

  it("preserves an explicitly auto-focused child", async () => {
    render(
      <Dialog open onClose={() => {}} title="Search">
        <input autoFocus aria-label="query" />
      </Dialog>,
    );
    const query = screen.getByRole("textbox", { name: "query" });
    await waitFor(() => expect(document.activeElement).toBe(query));
  });

  it("keeps focus inside the dialog when tabbing through it", async () => {
    const user = userEvent.setup();
    render(<DialogHost onClose={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const close = screen.getByRole("button", { name: "Close dialog" });
    const field = screen.getByRole("textbox", { name: "field" });
    await waitFor(() => expect(document.activeElement).toBe(close));
    field.focus();
    await user.tab();
    expect(document.activeElement).toBe(close);
    close.focus();
    await user.tab({ shift: true });
    expect(document.activeElement).toBe(field);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it("Escape calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHost onClose={onClose} />);
    await user.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("stays open when a nested Select handles Escape", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Settings">
        <Select aria-label="Preset" options={[{ value: "one", label: "One" }]} />
      </Dialog>,
    );
    const select = screen.getByRole("combobox", { name: "Preset" });
    await user.click(select);
    expect(screen.getByRole("listbox")).not.toBeNull();
    fireEvent.keyDown(select, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(screen.getByRole("dialog")).not.toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("clicking the backdrop calls onClose", () => {
    const onClose = vi.fn();
    render(<DialogHost onClose={onClose} />);
    const backdrop = document.querySelector(".monet-dialog-backdrop")!;
    // pointerdown directly on the backdrop (target === currentTarget) dismisses
    fireEvent.pointerDown(backdrop);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("close button calls onClose", async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<DialogHost onClose={onClose} />);
    await user.click(screen.getByRole("button", { name: "Close dialog" }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("restores focus to the opener when closed", async () => {
    const user = userEvent.setup();
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <div>
          <button onClick={() => setOpen(true)}>open</button>
          <Dialog open={open} onClose={() => setOpen(false)} ariaLabel="box">
            <input aria-label="field" />
          </Dialog>
        </div>
      );
    }
    render(<Host />);
    const opener = screen.getByRole("button", { name: "open" });
    opener.focus();
    await user.click(opener);
    expect(screen.getByRole("dialog")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    // focus returns to the element focused before the trap activated
    expect(document.activeElement).toBe(opener);
  });
});

// ─── Menu ──────────────────────────────────────────────────────
const MENU_ITEMS: MenuItemDef[] = [
  { id: "new", label: "New", action: () => {} },
  { id: "open", label: "Open", action: () => {} },
  { id: "sep", separator: true },
  { id: "quit", label: "Quit", disabled: true, action: () => {} },
];

describe("Menu", () => {
  function MenuHost({ items }: { items: MenuItemDef[] }) {
    return (
      <Menu items={items}>
        {(api) => (
          <button
            ref={api.ref}
            onClick={api.toggle}
            aria-haspopup={api["aria-haspopup"]}
            aria-expanded={api["aria-expanded"]}
            id={api.id}
          >
            File
          </button>
        )}
      </Menu>
    );
  }

  it("opens on trigger click and renders a role=menu with menuitems", async () => {
    const user = userEvent.setup();
    render(<MenuHost items={MENU_ITEMS} />);
    await user.click(screen.getByRole("button", { name: "File" }));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(3); // New, Open, Quit
    expect(within(menu).getByRole("separator")).not.toBeNull();
  });

  it("ArrowDown/ArrowUp move the active (focused) menuitem", async () => {
    const user = userEvent.setup();
    render(<MenuHost items={MENU_ITEMS} />);
    await user.click(screen.getByRole("button", { name: "File" }));
    const menu = screen.getByRole("menu");
    const newItem = within(menu).getByRole("menuitem", { name: "New" });
    const openItem = within(menu).getByRole("menuitem", { name: "Open" });
    // first interactive item auto-focuses on open
    expect(document.activeElement).toBe(newItem);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(openItem);
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(newItem);
  });

  it("Enter fires the focused item's action and closes the menu", async () => {
    const user = userEvent.setup();
    const onNew = vi.fn();
    render(
      <MenuHost
        items={[
          { id: "new", label: "New", action: onNew },
          { id: "open", label: "Open", action: () => {} },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.keyboard("{Enter}");
    expect(onNew).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("menu")).toBeNull();
  });

  it("clicking an item fires its action", async () => {
    const user = userEvent.setup();
    const onOpen = vi.fn();
    render(
      <MenuHost
        items={[
          { id: "new", label: "New", action: () => {} },
          { id: "open", label: "Open", action: onOpen },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: "Open" }));
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it("disabled items do not fire their action", async () => {
    const user = userEvent.setup();
    const onQuit = vi.fn();
    render(
      <MenuHost
        items={[
          { id: "open", label: "Open", action: () => {} },
          { id: "quit", label: "Quit", disabled: true, action: onQuit },
        ]}
      />,
    );
    await user.click(screen.getByRole("button", { name: "File" }));
    await user.click(screen.getByRole("menuitem", { name: "Quit" }));
    expect(onQuit).not.toHaveBeenCalled();
  });

  it("Escape closes the menu", async () => {
    const user = userEvent.setup();
    render(<MenuHost items={MENU_ITEMS} />);
    await user.click(screen.getByRole("button", { name: "File" }));
    expect(screen.getByRole("menu")).not.toBeNull();
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("menu")).toBeNull();
  });
});

// ─── MenuBar ───────────────────────────────────────────────────
describe("MenuBar", () => {
  const MENUS = [
    {
      id: "file",
      label: "File",
      items: [
        { id: "new", label: "New", action: () => {} },
        { id: "open", label: "Open", action: () => {} },
      ] as MenuItemDef[],
    },
    {
      id: "edit",
      label: "Edit",
      items: [{ id: "undo", label: "Undo", action: () => {} }] as MenuItemDef[],
    },
  ];

  it("renders role=menubar with a menuitem per top-level menu", () => {
    render(<MenuBar menus={MENUS} />);
    const bar = screen.getByRole("menubar");
    expect(within(bar).getAllByRole("menuitem")).toHaveLength(2);
  });

  it("clicking a menu opens its dropdown; ArrowDown moves the active item", async () => {
    const user = userEvent.setup();
    render(<MenuBar menus={MENUS} />);
    const fileBtn = screen.getByRole("menuitem", { name: "File" });
    await user.click(fileBtn);
    expect(fileBtn.getAttribute("aria-expanded")).toBe("true");
    const menu = screen.getByRole("menu");
    const newItem = within(menu).getByRole("menuitem", { name: "New" });
    const openItem = within(menu).getByRole("menuitem", { name: "Open" });
    expect(document.activeElement).toBe(newItem);
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(openItem);
  });
});

// ─── Tooltip ───────────────────────────────────────────────────
describe("Tooltip", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  it("shows content after the delay on focus and wires aria-describedby", () => {
    render(
      <Tooltip content="Helpful hint" delay={400}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      fireEvent.focus(trigger);
    });
    // not yet — still within the open delay
    expect(screen.queryByRole("tooltip")).toBeNull();
    act(() => {
      vi.advanceTimersByTime(400);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Helpful hint");
    // trigger now points at the tooltip via aria-describedby
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
  });

  it("hides on blur", () => {
    render(
      <Tooltip content="Hint" delay={100}>
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    act(() => {
      fireEvent.focus(trigger);
      vi.advanceTimersByTime(100);
    });
    expect(screen.getByRole("tooltip")).not.toBeNull();
    act(() => {
      fireEvent.blur(trigger);
    });
    expect(screen.queryByRole("tooltip")).toBeNull();
  });

  it("positions next to the anchor once the portal mounts, not at the 0,0 origin", () => {
    // Regression: the Portal mounts its content a render after `open` flips, so
    // the first reposition pass ran before the tip existed and the tip was left
    // stuck at its initial {0,0} (top-left of the screen). It must re-measure
    // when the node attaches. jsdom has no layout, so feed the anchor a rect.
    render(
      <Tooltip content="Hint" delay={100} side="right">
        <button>Trigger</button>
      </Tooltip>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    trigger.getBoundingClientRect = () =>
      ({ left: 100, top: 50, right: 140, bottom: 70, width: 40, height: 20, x: 100, y: 50, toJSON: () => ({}) }) as DOMRect;

    act(() => {
      fireEvent.focus(trigger);
      vi.advanceTimersByTime(100);
    });
    const tip = screen.getByRole("tooltip");
    // side=right → left = anchor.right + 6px offset (140 + 6). The decisive
    // check is that it's NOT the initial 0 — it tracks the anchor.
    expect(tip.style.left).toBe("146px");
    // top centers on the anchor's vertical span (~60), never the 0 origin.
    const top = parseFloat(tip.style.top);
    expect(top).toBeGreaterThan(50);
    expect(top).toBeLessThan(70);
  });

  it("composes inside a Popover on one shared anchor (forwardRef + prop passthrough)", () => {
    // A tool rail nests a Tooltip inside a flyout Popover; both must anchor to
    // the same DOM node, so the Popover's injected aria flows through the
    // Tooltip onto the trigger while the tooltip's own dwell still works.
    render(
      <Popover open onOpenChange={() => {}} role="menu" trapFocus={false} content={<div>Flyout</div>}>
        <Tooltip content="Shared tip" delay={100}>
          <button>Trigger</button>
        </Tooltip>
      </Popover>,
    );
    const trigger = screen.getByRole("button", { name: "Trigger" });
    expect(trigger.getAttribute("aria-haspopup")).toBe("menu");
    expect(trigger.getAttribute("aria-expanded")).toBe("true");

    act(() => {
      fireEvent.focus(trigger);
      vi.advanceTimersByTime(100);
    });
    const tip = screen.getByRole("tooltip");
    expect(tip.textContent).toBe("Shared tip");
    expect(trigger.getAttribute("aria-describedby")).toBe(tip.id);
  });
});

// ─── Popover ───────────────────────────────────────────────────
describe("Popover", () => {
  it("renders content when open and wires aria-haspopup/aria-expanded", () => {
    function Host() {
      const [open, setOpen] = useState(false);
      return (
        <Popover
          open={open}
          onOpenChange={setOpen}
          content={<div>Panel body</div>}
          label="Info"
        >
          <button onClick={() => setOpen((o) => !o)}>Anchor</button>
        </Popover>
      );
    }
    const { rerender } = render(<Host />);
    const anchor = screen.getByRole("button", { name: "Anchor" });
    expect(anchor.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("Panel body")).toBeNull();
    fireEvent.click(anchor);
    rerender(<Host />);
    expect(screen.getByText("Panel body")).not.toBeNull();
    expect(anchor.getAttribute("aria-expanded")).toBe("true");
  });
  it("stays open when an option of a nested Select (portalled listbox) is picked", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const onChange = vi.fn();
    render(
      <Popover open onOpenChange={onOpenChange} trapFocus={false}
        content={<Select aria-label="Size" options={[{ value: "s", label: "Small" }, { value: "l", label: "Large" }]} onChange={onChange} />}>
        <button>Anchor</button>
      </Popover>,
    );
    await user.click(screen.getByRole("combobox", { name: "Size" }));
    await user.click(screen.getByRole("option", { name: "Large" }));
    expect(onChange).toHaveBeenCalledWith("l");
    expect(onOpenChange).not.toHaveBeenCalled();
  });
  it("re-places itself when its content grows, so it stays inside the viewport", () => {
    const resized: Array<() => void> = [];
    vi.stubGlobal("ResizeObserver", class {
      constructor(cb: () => void) { resized.push(cb); }
      observe() {}
      disconnect() {}
    });
    try {
      render(
        <Popover open onOpenChange={() => {}} align="start" trapFocus={false} label="Grows" content={<div>Columns</div>}>
          <button>Anchor</button>
        </Popover>,
      );
      screen.getByRole("button", { name: "Anchor" }).getBoundingClientRect = () =>
        ({ left: 900, right: 960, top: 10, bottom: 30, width: 60, height: 20 }) as DOMRect;
      const panel = screen.getByRole("dialog", { name: "Grows" });
      Object.defineProperty(panel, "offsetWidth", { configurable: true, value: 300 });
      act(() => resized.forEach((cb) => cb()));
      // 1024px jsdom viewport − 8px padding − 300px panel
      expect(panel.style.left).toBe("716px");
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

// ─── Toast ─────────────────────────────────────────────────────
describe("Toast", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
  });

  function ToastHost() {
    const toast = useToast();
    return (
      <div>
        <button onClick={() => toast.push({ message: "Saved", duration: 5000 })}>
          push
        </button>
      </div>
    );
  }

  it("push renders a role=status item that auto-dismisses after its duration", () => {
    render(
      <ToastProvider>
        <ToastHost />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "push" }));
    });
    const toast = screen.getByRole("status");
    expect(toast.textContent).toContain("Saved");
    // info/success toasts are polite live regions
    expect(toast.getAttribute("aria-live")).toBe("polite");
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("manual dismiss removes the toast", () => {
    render(
      <ToastProvider>
        <ToastHost />
      </ToastProvider>,
    );
    act(() => {
      fireEvent.click(screen.getByRole("button", { name: "push" }));
    });
    expect(screen.getByRole("status")).not.toBeNull();
    act(() => {
      fireEvent.click(
        screen.getByRole("button", { name: "Dismiss notification" }),
      );
    });
    expect(screen.queryByRole("status")).toBeNull();
  });
});

// ─── ContextMenu ───────────────────────────────────────────────
describe("ContextMenu", () => {
  it("opens its menu on the contextmenu event", () => {
    render(
      <ContextMenu
        items={[
          { id: "copy", label: "Copy", action: () => {} },
          { id: "paste", label: "Paste", action: () => {} },
        ]}
      >
        <div>Right-click me</div>
      </ContextMenu>,
    );
    expect(screen.queryByRole("menu")).toBeNull();
    fireEvent.contextMenu(screen.getByText("Right-click me"));
    const menu = screen.getByRole("menu");
    expect(within(menu).getAllByRole("menuitem")).toHaveLength(2);
  });
  it("moves to a second right-click while open", () => {
    render(
      <ContextMenu items={[{ id: "copy", label: "Copy", action: () => {} }]}>
        <div>Right-click me</div>
      </ContextMenu>,
    );
    const region = screen.getByText("Right-click me");
    fireEvent.contextMenu(region, { clientX: 50, clientY: 60 });
    const panel = () => document.querySelector(".monet-menu-popover") as HTMLElement;
    expect(panel().style.left).toBe("50px");
    fireEvent.contextMenu(region, { clientX: 400, clientY: 300 });
    expect(panel().style.left).toBe("400px");
    expect(panel().style.top).toBe("300px");
  });
});

describe("MenuBar re-anchoring", () => {
  it("moves the open dropdown under the menu it switches to", () => {
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
    const panel = () => document.querySelector(".monet-menu-popover") as HTMLElement;
    expect(panel().style.left).toBe("10px");
    fireEvent.pointerEnter(edit); // hover-switch while a menu is open
    expect(screen.getByRole("menuitem", { name: "Undo" })).not.toBeNull();
    expect(panel().style.left).toBe("300px");
  });
});
