// DOM regression tests for the floating-layer plumbing: dropdown positioning
// (#112), z-index re-reservation (#115) and Escape reaching only the top-most
// layer (#116). jsdom has no layout engine, so anchors are fed explicit rects;
// the assertions are about which number lands where, never real pixels.

import { describe, it, expect } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent } from "@testing-library/react";

import { Popover } from "../../src/overlay-core.tsx";
import { Menu, MenuBar, type MenuItemDef } from "../../src/menu.tsx";

const rect = (left: number, top: number, width: number, height: number) =>
  ({
    left, top, width, height,
    right: left + width, bottom: top + height,
    x: left, y: top, toJSON: () => ({}),
  }) as DOMRect;

const panels = () => Array.from(document.querySelectorAll<HTMLElement>(".monet-menu-popover"));

// ─── #112 · dropdowns must be measured once the portal attaches ─
describe("menu positioning (#112)", () => {
  const ITEMS: MenuItemDef[] = [
    { id: "undo", label: "Undo" },
    { id: "more", label: "More", items: [{ id: "deep", label: "Deep" }] },
  ];

  it("Menu places its dropdown at the trigger, not at the viewport origin", () => {
    render(
      <Menu items={ITEMS}>
        {(api) => (
          <button ref={api.ref} onClick={api.toggle} aria-haspopup={api["aria-haspopup"]}>
            Open
          </button>
        )}
      </Menu>,
    );
    const trigger = screen.getByRole("button", { name: "Open" });
    trigger.getBoundingClientRect = () => rect(100, 50, 60, 20);

    fireEvent.click(trigger);
    // side=bottom / align=start / offset=4 → left = anchor.left, top = bottom + 4.
    expect(panels()[0].style.left).toBe("100px");
    expect(panels()[0].style.top).toBe("74px");
  });

  it("SubMenu places its panel next to the parent row", () => {
    render(
      <Menu items={ITEMS}>
        {(api) => (
          <button ref={api.ref} onClick={api.toggle}>
            Open
          </button>
        )}
      </Menu>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Open" }));
    const row = screen.getByRole("menuitem", { name: /More/ });
    row.getBoundingClientRect = () => rect(200, 300, 140, 22);

    fireEvent.pointerEnter(row);
    // side=right / align=start / offset=2 → left = anchor.right + 2, top = anchor.top.
    const sub = panels()[1];
    expect(sub.style.left).toBe("342px");
    expect(sub.style.top).toBe("300px");
  });

  it("MenuBar places the open menu under its own button", () => {
    render(
      <MenuBar
        menus={[
          { id: "file", label: "File", items: [{ id: "new", label: "New" }] },
          { id: "edit", label: "Edit", items: [{ id: "undo", label: "Undo" }] },
        ]}
      />,
    );
    const edit = screen.getByRole("menuitem", { name: "Edit" });
    edit.getBoundingClientRect = () => rect(64, 8, 40, 22);

    fireEvent.click(edit);
    expect(panels()[0].style.left).toBe("64px");
    expect(panels()[0].style.top).toBe("34px");
  });
});

// ─── #115 · a reopened layer must take a fresh, top-most z ──────
describe("useLayer z-index re-reservation (#115)", () => {
  function TwoPopovers() {
    const [a, setA] = useState(false);
    const [b, setB] = useState(false);
    return (
      <>
        <Popover open={a} onOpenChange={setA} label="A" content={<div>A body</div>}>
          <button onClick={() => setA((v) => !v)}>A</button>
        </Popover>
        <Popover open={b} onOpenChange={setB} label="B" content={<div>B body</div>}>
          <button onClick={() => setB((v) => !v)}>B</button>
        </Popover>
      </>
    );
  }

  it("a reopened overlay stacks above one that opened after it", () => {
    render(<TwoPopovers />);
    const a = screen.getByRole("button", { name: "A" });
    const b = screen.getByRole("button", { name: "B" });
    const zOf = (name: string) => Number(screen.getByRole("dialog", { name }).style.zIndex);

    fireEvent.click(a);
    const z1 = zOf("A");
    fireEvent.click(a); // close A

    fireEvent.click(b);
    const z2 = zOf("B");
    expect(z2).toBeGreaterThan(z1);
    fireEvent.click(b); // close B

    fireEvent.click(a); // reopen A — must be re-reserved above B, not stuck at z1
    expect(zOf("A")).toBeGreaterThan(z2);
  });
});

// ─── #116 · Escape dismisses only the top-most layer ────────────
describe("Escape layering (#116)", () => {
  function NestedPopovers({ onOuter }: { onOuter: (open: boolean) => void }) {
    const [outer, setOuter] = useState(true);
    const [inner, setInner] = useState(false);
    return (
      <Popover
        open={outer}
        onOpenChange={(v) => { onOuter(v); setOuter(v); }}
        label="outer"
        content={
          <Popover open={inner} onOpenChange={setInner} label="inner" content={<div>inner body</div>}>
            <button onClick={() => setInner(true)}>open inner</button>
          </Popover>
        }
      >
        <button>outer trigger</button>
      </Popover>
    );
  }

  it("one Escape closes the inner popover and leaves the outer one open", () => {
    const onOuter = (open: boolean) => { outerCalls.push(open); };
    const outerCalls: boolean[] = [];
    render(<NestedPopovers onOuter={onOuter} />);
    fireEvent.click(screen.getByRole("button", { name: "open inner" }));
    expect(screen.getByRole("dialog", { name: "inner" })).not.toBeNull();

    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByRole("dialog", { name: "inner" })).toBeNull();
    expect(outerCalls).toEqual([]); // the outer layer never saw the Escape
    expect(screen.getByRole("dialog", { name: "outer" })).not.toBeNull();

    // the next Escape reaches the layer that is now top-most
    fireEvent.keyDown(document, { key: "Escape" });
    expect(outerCalls).toEqual([false]);
  });
});
