import { createRef, useState } from "react";
import { createPortal } from "react-dom";
import { describe, expect, it, vi } from "vitest";
import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  DockableWorkspace,
  type DockableWorkspaceHandle,
  type DockLayout,
} from "../../src/dockable.tsx";

describe("DockableWorkspace", () => {
  it("renders the app window directly without simulated OS chrome", () => {
    const { container } = render(
      <DockableWorkspace platform="mac" canvas={<main>Canvas</main>} />,
    );

    expect(container.querySelector(".monet-os")).toBeNull();
    expect(container.firstElementChild?.classList.contains("monet-window--bare")).toBe(true);
  });

  it("keeps document tabs but omits simulated controls with a native frame", () => {
    const { container } = render(
      <DockableWorkspace platform="mac" nativeFrame docs={["Document.psd"]} canvas={<main>Canvas</main>} />,
    );

    expect(container.firstElementChild?.classList.contains("monet-window--native-frame")).toBe(true);
    expect(container.querySelector(".monet-documentbar")).not.toBeNull();
    expect(container.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("Document.psd");
    expect(container.querySelector(".monet-traffic")).toBeNull();
    expect(container.querySelector(".monet-app-pill")).toBeNull();
  });

  it("replays a persisted layout at mount but resets to the factory seed", () => {
    const ref = createRef<DockableWorkspaceHandle>();
    render(
      <DockableWorkspace
        ref={ref}
        platform="mac"
        panels={{
          factory: { title: "Factory", render: () => null },
          custom: { title: "Custom", render: () => null },
        }}
        initialLayout={{ right: { stack: [{ tabs: ["factory"] }] } }}
        layout={{ right: { stack: [{ tabs: ["custom"] }] } }}
      />,
    );

    expect(ref.current?.getLayout().right?.cols?.[0].stack?.[0].tabs).toEqual(["custom"]);
    act(() => ref.current?.reset());
    expect(ref.current?.getLayout().right?.cols?.[0].stack?.[0].tabs).toEqual(["factory"]);
  });

  it("collapses to icons, springs panels over the canvas and dismisses without deleting them (#479)", async () => {
    const user = userEvent.setup();
    const ref = createRef<DockableWorkspaceHandle>();
    const change = vi.fn();
    render(<DockableWorkspace ref={ref} panels={{
      layers: { title: "Layers", icon: <span>L</span>, render: () => <><input aria-label="Layer name"/>
        {createPortal(<button>Panel popup option</button>, document.body)}</> },
      history: { title: "History", render: () => <p>Edits</p> },
    }} initialLayout={{ right: { size: 312, stack: [{ tabs: ["layers", "history"] }] } }}
      canvas={<main data-testid="canvas">Canvas</main>} onLayoutChange={change}/>);

    await user.click(screen.getByRole("button", { name: "Collapse right dock" }));
    expect(ref.current?.getLayout().right?.collapsed).toBe(true);
    expect(ref.current?.getLayout().right?.size).toBe(312);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("separator", { name: "Resize right dock" })).toBeNull();
    const rail = screen.getByRole("button", { name: "Layers" });
    expect(rail.textContent).toBe("L");
    await user.click(rail);
    expect(screen.getByRole("dialog", { name: "Layers panel" }).classList.contains("monet-dock-flyout")).toBe(true);
    expect(screen.getByRole("tab", { name: "Layers" })).toBe(document.activeElement);
    expect(screen.getByRole("region", { name: "right dock" }).style.width).toBe("36px");
    await user.click(screen.getByRole("button", { name: "Panel popup option" }));
    expect(screen.getByRole("dialog", { name: "Layers panel" })).toBeTruthy();
    await user.click(screen.getByRole("textbox", { name: "Layer name" }));
    await user.keyboard("Something{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(rail).toBe(document.activeElement);
    await user.keyboard("{Enter}");
    expect(screen.getByRole("dialog")).toBeTruthy();
    await user.click(screen.getByTestId("canvas"));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(ref.current?.getLayout().right?.cols?.[0].stack?.[0].tabs).toEqual(["layers", "history"]);
    expect(change.mock.lastCall?.[0].right.collapsed).toBe(true);
    await user.click(screen.getByRole("button", { name: "Expand right dock" }));
    expect(screen.getByRole("region", { name: "right dock" }).style.width).toBe("312px");
    expect(screen.getByRole("textbox")).toBeTruthy();
  });

  it("keeps collapse in workspace snapshots and reset seeds, but never persists an open flyout", async () => {
    const user = userEvent.setup();
    const ref = createRef<DockableWorkspaceHandle>();
    const panels = { a: { title: "Panel A", render: () => <p>Body A</p> } };
    const { unmount } = render(<DockableWorkspace ref={ref} panels={panels}
      initialLayout={{ left: { collapsed: true, stack: [{ tabs: ["a"] }] } }}/>);
    await user.click(screen.getByRole("button", { name: "Panel A" }));
    const saved = JSON.parse(JSON.stringify(ref.current?.getLayout())) as DockLayout;
    expect(saved.left?.collapsed).toBe(true);
    act(() => ref.current?.reset());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Expand left dock" })).toBeTruthy();
    act(() => ref.current?.setDockCollapsed("left", false));
    act(() => ref.current?.setLayout(saved));
    expect(screen.getByRole("button", { name: "Panel A" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
    const before = ref.current?.getLayout();
    expect(() => ref.current?.setDockCollapsed("other" as any, true)).toThrow(/dock side/);
    expect(ref.current?.getLayout()).toBe(before);
    unmount();
    render(<DockableWorkspace panels={panels} initialLayout={saved}/>);
    expect(screen.getByRole("button", { name: "Expand left dock" })).toBeTruthy();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("double-clicks once, keeps a controlled flyout open on activation, and supports horizontal rails", async () => {
    const user = userEvent.setup();
    const panels = { a: { title: "Panel A", render: () => "A" }, b: { title: "Panel B", render: () => "B" } };
    function Controlled() {
      const [layout, setLayout] = useState<DockLayout>({ bottom: { size: 200, stack: [{ tabs: ["a", "b"] }] } });
      return <DockableWorkspace panels={panels} layout={layout} onLayoutChange={setLayout}/>;
    }
    render(<Controlled/>);
    await user.dblClick(screen.getByRole("button", { name: "Collapse bottom dock" }));
    expect(screen.getByRole("button", { name: "Expand bottom dock" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Panel B" }));
    expect(screen.getByRole("dialog", { name: "Panel B panel" })).toBeTruthy();
    expect(screen.getByRole("region", { name: "bottom dock" }).style.height).toBe("36px");
    await user.keyboard("{ArrowLeft}");
    expect(screen.getByRole("dialog", { name: "Panel A panel" })).toBeTruthy();
    fireEvent.doubleClick(screen.getByRole("button", { name: "Expand bottom dock" }).parentElement!);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByRole("region", { name: "bottom dock" }).style.height).toBe("200px");
  });

  // jsdom lays nothing out, so each test places the elements it measures.
  const place = (el: Element, r: { left: number; top: number; width: number; height: number }) => {
    el.getBoundingClientRect = () => ({ ...r, right: r.left + r.width, bottom: r.top + r.height, x: r.left, y: r.top, toJSON: () => ({}) });
  };

  it("never springs a panel out past the far edge of the workspace", async () => {
    const user = userEvent.setup();
    const { container } = render(<DockableWorkspace panels={{ a: { title: "Panel A", render: () => "A" } }}
      initialLayout={{ right: { size: 900, collapsed: true, stack: [{ tabs: ["a"] }] } }}/>);
    // A 900px right dock, collapsed in a 760px window: its rail sits at x=724.
    const body = container.querySelector(".monet-body")!;
    Object.defineProperty(body, "offsetWidth", { configurable: true, value: 760 });
    place(body, { left: 0, top: 0, width: 760, height: 600 });
    place(screen.getByRole("region", { name: "right dock" }), { left: 724, top: 0, width: 36, height: 600 });
    await user.click(screen.getByRole("button", { name: "Panel A" }));
    expect(screen.getByRole("dialog", { name: "Panel A panel" }).style.width).toBe("724px");
  });

  it("springs a collapsed dock's panel out for openPanel instead of expanding the dock", async () => {
    const user = userEvent.setup();
    const ref = createRef<DockableWorkspaceHandle>();
    render(<DockableWorkspace ref={ref} panels={{
      layers: { title: "Layers", render: () => "L" }, history: { title: "History", render: () => "H" },
    }} initialLayout={{ right: { collapsed: true, stack: [{ tabs: ["layers", "history"] }] } }}/>);
    act(() => ref.current?.openPanel("history"));
    expect(screen.getByRole("dialog", { name: "History panel" })).toBeTruthy();
    expect(ref.current?.getLayout().right?.collapsed).toBe(true);
    expect(ref.current?.getLayout().right?.cols?.[0].stack?.[0].tabs).toEqual(["layers", "history"]);
    // Escape hands focus back to the panel's own rail icon.
    await user.keyboard("{Escape}");
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "History" }));
    // Asking again springs it out again.
    act(() => ref.current?.openPanel("history"));
    expect(screen.getByRole("dialog", { name: "History panel" })).toBeTruthy();
  });

  it("adds a tab dropped on a collapsed rail as an icon instead of floating it over the rail", () => {
    const ref = createRef<DockableWorkspaceHandle>();
    const { container } = render(<DockableWorkspace ref={ref} panels={{
      a: { title: "Panel A", render: () => "A" }, b: { title: "Panel B", render: () => "B" },
    }} initialLayout={{ left: { stack: [{ tabs: ["a"] }] }, right: { collapsed: true, stack: [{ tabs: ["b"] }] } }}/>);
    place(container.querySelector(".monet-body")!, { left: 0, top: 0, width: 1000, height: 600 });
    place(screen.getByRole("region", { name: "right dock" }), { left: 964, top: 0, width: 36, height: 600 });
    fireEvent.pointerDown(screen.getByRole("tab", { name: "Panel A" }), { button: 0, clientX: 40, clientY: 10 });
    fireEvent.pointerMove(window, { clientX: 980, clientY: 300 });
    expect(screen.getByText("Add to icons")).toBeTruthy();
    fireEvent.pointerUp(window, { clientX: 980, clientY: 300 });
    const layout = ref.current!.getLayout();
    expect(layout.floating).toEqual([]);
    expect(layout.right?.collapsed).toBe(true);
    expect(layout.right?.cols?.[0].stack?.[0].tabs).toEqual(["b", "a"]);
    expect(screen.getByRole("button", { name: "Panel A" })).toBeTruthy();
  });

  it("keeps a sprung panel out on outside clicks when auto-collapse is off", async () => {
    const user = userEvent.setup();
    render(<DockableWorkspace autoCollapseFlyouts={false} panels={{ a: { title: "Panel A", render: () => "A" } }}
      initialLayout={{ right: { collapsed: true, stack: [{ tabs: ["a"] }] } }}
      canvas={<main data-testid="canvas">Canvas</main>}/>);
    const icon = screen.getByRole("button", { name: "Panel A" });
    await user.click(icon);
    await user.click(screen.getByTestId("canvas"));
    expect(screen.getByRole("dialog", { name: "Panel A panel" })).toBeTruthy();
    await user.click(icon);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("dismisses a sprung panel even when the outside control stops pointerdown propagation", async () => {
    const user = userEvent.setup();
    // Like Vision's on-canvas commit/cancel buttons, which keep the canvas from starting a gesture.
    render(<DockableWorkspace panels={{ a: { title: "Panel A", render: () => <p>Body A</p> } }}
      initialLayout={{ right: { collapsed: true, stack: [{ tabs: ["a"] }] } }}
      canvas={<main><button onPointerDown={(e) => e.stopPropagation()}>Commit</button></main>}/>);
    await user.click(screen.getByRole("button", { name: "Panel A" }));
    expect(screen.getByRole("dialog", { name: "Panel A panel" })).toBeTruthy();
    await user.click(screen.getByRole("button", { name: "Commit" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
