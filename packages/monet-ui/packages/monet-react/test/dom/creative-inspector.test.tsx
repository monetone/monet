// DOM tests for the creative-app inspector/layout components
// (creative-inspector.tsx). jsdom has no layout — these assert ROLES, ARIA,
// state, and callbacks only; never pixel geometry. No jest-dom: assertions
// read DOM properties/attributes directly.

import { describe, it, expect, vi } from "vitest";
import { useState } from "react";
import { render, screen, fireEvent, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  Section,
  SegmentedControl,
  ToggleGroup,
  ToolbarGroup,
  ToolbarSeparator,
  Breadcrumb,
  TreeView,
  SearchField,
  Badge,
  ProgressBar,
  Spinner,
  type TreeNode,
} from "../../src/creative-inspector.tsx";
import { IconButton } from "../../src/controls.tsx";

// ─── Section ───────────────────────────────────────────────────
describe("Section", () => {
  it("renders a disclosure header wired to its body region", () => {
    render(
      <Section title="Transform">
        <p>body</p>
      </Section>,
    );
    const header = screen.getByRole("button", { name: "Transform" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    const region = screen.getByRole("region", { name: "Transform" });
    expect(header.getAttribute("aria-controls")).toBe(region.id);
  });

  it("toggles open state and fires onOpenChange (uncontrolled)", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Section title="Layers" onOpenChange={onOpenChange}>
        <p>body</p>
      </Section>,
    );
    const header = screen.getByRole("button", { name: "Layers" });
    await user.click(header);
    expect(onOpenChange).toHaveBeenLastCalledWith(false);
    expect(header.getAttribute("aria-expanded")).toBe("false");
    await user.click(header);
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
  });

  it("respects a controlled open prop", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(
      <Section title="Effects" open={false} onOpenChange={onOpenChange}>
        <p>body</p>
      </Section>,
    );
    const header = screen.getByRole("button", { name: "Effects" });
    expect(header.getAttribute("aria-expanded")).toBe("false");
    await user.click(header);
    // controlled: state does not change locally, but the callback fires
    expect(onOpenChange).toHaveBeenLastCalledWith(true);
    expect(header.getAttribute("aria-expanded")).toBe("false");
  });

  it("a non-collapsible section is always expanded with an inert header", () => {
    render(
      <Section title="Always" collapsible={false}>
        <p>body</p>
      </Section>,
    );
    const header = screen.getByRole("button", { name: "Always" });
    expect(header.getAttribute("aria-expanded")).toBe("true");
    expect((header as HTMLButtonElement).disabled).toBe(true);
  });

  it("renders header actions without toggling on their click", async () => {
    const user = userEvent.setup();
    const onAction = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <Section
        title="Paint"
        onOpenChange={onOpenChange}
        actions={
          <IconButton icon="plus" aria-label="Add" onClick={onAction} />
        }
      >
        <p>body</p>
      </Section>,
    );
    await user.click(screen.getByRole("button", { name: "Add" }));
    expect(onAction).toHaveBeenCalledTimes(1);
    expect(onOpenChange).not.toHaveBeenCalled();
  });
});

// ─── SegmentedControl ──────────────────────────────────────────
const SEG = [
  { value: "design", label: "Design" },
  { value: "develop", label: "Develop" },
  { value: "test", label: "Test" },
];

describe("SegmentedControl", () => {
  it("renders a radiogroup of radios with roving tabindex", () => {
    render(<SegmentedControl items={SEG} aria-label="mode" defaultValue="design" />);
    const group = screen.getByRole("radiogroup", { name: "mode" });
    const radios = within(group).getAllByRole("radio");
    expect(radios).toHaveLength(3);
    expect(radios[0].getAttribute("aria-checked")).toBe("true");
    expect(radios[0].getAttribute("tabindex")).toBe("0");
    expect(radios[1].getAttribute("tabindex")).toBe("-1");
  });

  it("selects on click and fires onChange", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl items={SEG} aria-label="mode" onChange={onChange} />);
    await user.click(screen.getByRole("radio", { name: "Develop" }));
    expect(onChange).toHaveBeenLastCalledWith("develop");
  });

  it("arrow keys move + select, wrapping at the ends", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl items={SEG} aria-label="mode" defaultValue="design" onChange={onChange} />,
    );
    const design = screen.getByRole("radio", { name: "Design" });
    design.focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("develop");
    // wrap from the last back to the first
    screen.getByRole("radio", { name: "Test" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("design");
  });

  it("skips disabled segments during navigation", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SegmentedControl
        aria-label="mode"
        defaultValue="a"
        onChange={onChange}
        items={[
          { value: "a", label: "A" },
          { value: "b", label: "B", disabled: true },
          { value: "c", label: "C" },
        ]}
      />,
    );
    screen.getByRole("radio", { name: "A" }).focus();
    await user.keyboard("{ArrowRight}"); // skips disabled B → C
    expect(onChange).toHaveBeenLastCalledWith("c");
  });

  it("value={null} is controlled-with-nothing-selected, and stays reachable (#194)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SegmentedControl items={SEG} aria-label="mode" value={null} onChange={onChange} />);
    const radios = screen.getAllByRole("radio");
    radios.forEach((r) => expect(r.getAttribute("aria-checked")).toBe("false"));
    // the group must still have a tab stop even with no selection
    expect(radios.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    // controlled: clicking reports out but does not select locally
    await user.click(radios[1]);
    expect(onChange).toHaveBeenLastCalledWith("develop");
    expect(screen.getAllByRole("radio")[1].getAttribute("aria-checked")).toBe("false");
  });
});

// ─── ToggleGroup ───────────────────────────────────────────────
describe("ToggleGroup", () => {
  const FMT = [
    { value: "bold", icon: "text", "aria-label": "Bold" },
    { value: "italic", icon: "pen", "aria-label": "Italic" },
    { value: "under", icon: "minus", "aria-label": "Underline" },
  ];

  it("renders a group of aria-pressed buttons (multi-select)", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleGroup items={FMT} aria-label="format" onChange={onChange} />);
    const group = screen.getByRole("group", { name: "format" });
    expect(within(group).getAllByRole("button")).toHaveLength(3);
    const bold = screen.getByRole("button", { name: "Bold" });
    expect(bold.getAttribute("aria-pressed")).toBe("false");
    await user.click(bold);
    expect(onChange).toHaveBeenLastCalledWith(["bold"]);
    expect(bold.getAttribute("aria-pressed")).toBe("true");
    await user.click(screen.getByRole("button", { name: "Italic" }));
    expect(onChange).toHaveBeenLastCalledWith(["bold", "italic"]);
  });

  it("exclusive mode keeps a single value", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ToggleGroup items={FMT} exclusive aria-label="format" onChange={onChange} />);
    await user.click(screen.getByRole("button", { name: "Bold" }));
    expect(onChange).toHaveBeenLastCalledWith(["bold"]);
    await user.click(screen.getByRole("button", { name: "Italic" }));
    expect(onChange).toHaveBeenLastCalledWith(["italic"]);
  });

  it("arrow keys move focus across the set", async () => {
    const user = userEvent.setup();
    render(<ToggleGroup items={FMT} aria-label="format" />);
    const bold = screen.getByRole("button", { name: "Bold" });
    bold.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Italic" }));
  });
});

// ─── ToolbarGroup ──────────────────────────────────────────────
describe("ToolbarGroup", () => {
  it("renders role=toolbar with aria-orientation and roving arrow focus", async () => {
    const user = userEvent.setup();
    render(
      <ToolbarGroup aria-label="tools">
        <IconButton icon="brush" aria-label="Brush" />
        <ToolbarSeparator />
        <IconButton icon="erase" aria-label="Erase" />
        <IconButton icon="pen" aria-label="Pen" />
      </ToolbarGroup>,
    );
    const bar = screen.getByRole("toolbar", { name: "tools" });
    expect(bar.getAttribute("aria-orientation")).toBe("horizontal");

    const brush = screen.getByRole("button", { name: "Brush" });
    brush.focus();
    await user.keyboard("{ArrowRight}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Erase" }));
    await user.keyboard("{End}");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Pen" }));
    await user.keyboard("{Home}");
    expect(document.activeElement).toBe(brush);
  });

  it("exposes a separator", () => {
    render(
      <ToolbarGroup aria-label="tools">
        <IconButton icon="brush" aria-label="Brush" />
        <ToolbarSeparator />
        <IconButton icon="pen" aria-label="Pen" />
      </ToolbarGroup>,
    );
    expect(screen.getByRole("separator")).not.toBeNull();
  });
});

// ─── Breadcrumb ────────────────────────────────────────────────
const CRUMBS = [
  { id: "home", label: "Home" },
  { id: "proj", label: "Project" },
  { id: "file", label: "File.psd" },
];

describe("Breadcrumb", () => {
  it("renders a nav with a list; the last crumb is the current page", () => {
    render(<Breadcrumb items={CRUMBS} />);
    const nav = screen.getByRole("navigation", { name: "Breadcrumb" });
    expect(nav).not.toBeNull();
    const current = within(nav).getByText("File.psd");
    expect(current.getAttribute("aria-current")).toBe("page");
    // the current crumb is not a button
    expect(current.tagName).not.toBe("BUTTON");
  });

  it("interactive crumbs fire onNavigate with id + index", async () => {
    const user = userEvent.setup();
    const onNavigate = vi.fn();
    render(<Breadcrumb items={CRUMBS} onNavigate={onNavigate} />);
    await user.click(screen.getByRole("button", { name: "Project" }));
    expect(onNavigate).toHaveBeenCalledWith("proj", 1);
  });

  it("collapses the middle with an ellipsis when maxItems is exceeded", () => {
    const many = [
      { id: "a", label: "A" },
      { id: "b", label: "B" },
      { id: "c", label: "C" },
      { id: "d", label: "D" },
      { id: "e", label: "E" },
    ];
    render(<Breadcrumb items={many} maxItems={3} />);
    // first + ellipsis + last two are shown; middle ones are hidden
    expect(screen.getByText("A")).not.toBeNull();
    expect(screen.getByText("…")).not.toBeNull();
    expect(screen.getByText("D")).not.toBeNull();
    expect(screen.getByText("E")).not.toBeNull();
    expect(screen.queryByText("C")).toBeNull();
    // last is still the current page
    expect(screen.getByText("E").getAttribute("aria-current")).toBe("page");
  });
});

// ─── TreeView ──────────────────────────────────────────────────
const TREE: TreeNode[] = [
  {
    id: "g1",
    label: "Group 1",
    children: [
      { id: "n1", label: "Node 1" },
      { id: "n2", label: "Node 2" },
    ],
  },
  { id: "g2", label: "Group 2", children: [{ id: "n3", label: "Node 3" }] },
];

describe("TreeView", () => {
  it("renders role=tree with treeitems carrying level + expanded", () => {
    render(<TreeView nodes={TREE} aria-label="layers" defaultExpandedIds={["g1"]} />);
    const tree = screen.getByRole("tree", { name: "layers" });
    expect(tree).not.toBeNull();
    const g1 = screen.getByRole("treeitem", { name: /Group 1/ });
    expect(g1.getAttribute("aria-level")).toBe("1");
    expect(g1.getAttribute("aria-expanded")).toBe("true");
    // collapsed branch hides its children
    expect(screen.queryByRole("treeitem", { name: /Node 3/ })).toBeNull();
    // expanded branch shows children at the next level
    const n1 = screen.getByRole("treeitem", { name: /Node 1/ });
    expect(n1.getAttribute("aria-level")).toBe("2");
  });

  it("single roving tab stop (the selected item, else the first)", () => {
    render(
      <TreeView nodes={TREE} aria-label="layers" defaultExpandedIds={["g1"]} defaultSelectedId="n2" />,
    );
    const n2 = screen.getByRole("treeitem", { name: /Node 2/ });
    expect(n2.getAttribute("tabindex")).toBe("0");
    expect(n2.getAttribute("aria-selected")).toBe("true");
    expect(
      screen.getByRole("treeitem", { name: /Group 1/ }).getAttribute("tabindex"),
    ).toBe("-1");
  });

  it("keeps a tab stop when the selected node is disabled (#199)", () => {
    // Regression: the tab stop was resolved against ALL rows but vetoed again
    // for disabled ones at render, so a selectedId on a disabled node left every
    // row at tabindex -1 — the whole tree fell out of the tab order.
    render(
      <TreeView
        aria-label="layers"
        selectedId="b"
        nodes={[
          { id: "a", label: "A" },
          { id: "b", label: "B", disabled: true },
          { id: "c", label: "C" },
        ]}
      />,
    );
    const items = screen.getAllByRole("treeitem");
    expect(items.filter((r) => r.getAttribute("tabindex") === "0")).toHaveLength(1);
    expect(screen.getByRole("treeitem", { name: /A/ }).getAttribute("tabindex")).toBe("0");
  });

  it("click selects and fires onSelect with id + node", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <TreeView nodes={TREE} aria-label="layers" defaultExpandedIds={["g1"]} onSelect={onSelect} />,
    );
    await user.click(screen.getByRole("treeitem", { name: /Node 1/ }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0]).toBe("n1");
    expect(onSelect.mock.calls[0][1].id).toBe("n1");
  });

  it("ArrowRight expands a collapsed branch; ArrowLeft collapses it", async () => {
    const user = userEvent.setup();
    const onExpandedChange = vi.fn();
    render(
      <TreeView nodes={TREE} aria-label="layers" onExpandedChange={onExpandedChange} />,
    );
    const g1 = screen.getByRole("treeitem", { name: /Group 1/ });
    expect(g1.getAttribute("aria-expanded")).toBe("false");
    g1.focus();
    await user.keyboard("{ArrowRight}"); // expand
    expect(onExpandedChange).toHaveBeenLastCalledWith(["g1"]);
  });

  it("ArrowDown/ArrowUp move focus between visible rows", async () => {
    const user = userEvent.setup();
    render(<TreeView nodes={TREE} aria-label="layers" defaultExpandedIds={["g1"]} />);
    const g1 = screen.getByRole("treeitem", { name: /Group 1/ });
    g1.focus();
    await user.keyboard("{ArrowDown}");
    expect(document.activeElement).toBe(screen.getByRole("treeitem", { name: /Node 1/ }));
    await user.keyboard("{ArrowUp}");
    expect(document.activeElement).toBe(g1);
  });
});

// ─── SearchField ───────────────────────────────────────────────
describe("SearchField", () => {
  it("renders a search input and fires onChange while typing", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<SearchField aria-label="find" onChange={onChange} />);
    const input = screen.getByRole("searchbox", { name: "find" }) as HTMLInputElement;
    await user.type(input, "sky");
    expect(input.value).toBe("sky");
    expect(onChange).toHaveBeenLastCalledWith("sky");
  });

  it("shows a clear button once there is a query and clears on click", async () => {
    const user = userEvent.setup();
    const onClear = vi.fn();
    function Host() {
      const [v, setV] = useState("");
      return <SearchField aria-label="find" value={v} onChange={setV} onClear={onClear} />;
    }
    render(<Host />);
    const input = screen.getByRole("searchbox", { name: "find" }) as HTMLInputElement;
    expect(screen.queryByRole("button", { name: "Clear search" })).toBeNull();
    await user.type(input, "abc");
    const clear = screen.getByRole("button", { name: "Clear search" });
    await user.click(clear);
    expect(onClear).toHaveBeenCalledTimes(1);
    expect(input.value).toBe("");
  });

  it("Enter fires onSearch with the current value", async () => {
    const user = userEvent.setup();
    const onSearch = vi.fn();
    render(<SearchField aria-label="find" defaultValue="moon" onSearch={onSearch} />);
    const input = screen.getByRole("searchbox", { name: "find" });
    input.focus();
    await user.keyboard("{Enter}");
    expect(onSearch).toHaveBeenLastCalledWith("moon");
  });
});

// ─── Badge ─────────────────────────────────────────────────────
describe("Badge", () => {
  it("renders a span chip by default", () => {
    render(<Badge>New</Badge>);
    const el = screen.getByText("New");
    expect(el.tagName).toBe("SPAN");
    expect(el.className).toContain("monet-chip");
  });

  it("as=button renders an interactive button that fires onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <Badge as="button" onClick={onClick}>
        Filter
      </Badge>,
    );
    const btn = screen.getByRole("button", { name: "Filter" });
    expect(btn.className).toContain("monet-chip");
    await user.click(btn);
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("accent tone applies the is-accent modifier", () => {
    render(<Badge tone="accent">Pro</Badge>);
    expect(screen.getByText("Pro").className).toContain("is-accent");
  });
});

// ─── ProgressBar ───────────────────────────────────────────────
describe("ProgressBar", () => {
  it("exposes role=progressbar with aria value bounds when determinate", () => {
    render(<ProgressBar value={0.4} aria-label="upload" />);
    const bar = screen.getByRole("progressbar", { name: "upload" });
    expect(bar.getAttribute("aria-valuemin")).toBe("0");
    expect(bar.getAttribute("aria-valuemax")).toBe("1");
    expect(bar.getAttribute("aria-valuenow")).toBe("0.4");
  });

  it("clamps the value into 0..1", () => {
    render(<ProgressBar value={1.7} aria-label="upload" />);
    expect(
      screen.getByRole("progressbar", { name: "upload" }).getAttribute("aria-valuenow"),
    ).toBe("1");
  });

  it("omits aria-valuenow when indeterminate", () => {
    render(<ProgressBar aria-label="loading" />);
    const bar = screen.getByRole("progressbar", { name: "loading" });
    expect(bar.getAttribute("aria-valuenow")).toBeNull();
  });

  it("labels itself via its caption when no aria-label is given", () => {
    render(<ProgressBar value={0.5} label="Rendering" />);
    expect(screen.getByRole("progressbar", { name: "Rendering" })).not.toBeNull();
  });
});

// ─── Spinner ───────────────────────────────────────────────────
describe("Spinner", () => {
  it("is role=status with an accessible name when labelled", () => {
    render(<Spinner label="Loading" />);
    expect(screen.getByRole("status", { name: "Loading" })).not.toBeNull();
  });

  it("is aria-hidden (no status role) when unlabelled", () => {
    const { container } = render(<Spinner />);
    expect(screen.queryByRole("status")).toBeNull();
    expect(container.querySelector(".monet-cv-spinner")?.getAttribute("aria-hidden")).toBe(
      "true",
    );
  });
});
