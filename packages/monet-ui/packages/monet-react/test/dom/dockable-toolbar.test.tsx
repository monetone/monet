// The toolbar half of the workspace contract a host persists: a saved toolbar
// placement is replayed at mount, every change is observable, and reset() goes
// back to the factory seed. Mirrors the panel-layout case in dockable.test.tsx.
import { createRef } from "react";
import { describe, expect, it, vi } from "vitest";
import { act, render } from "@testing-library/react";

import {
  DockableWorkspace,
  type DockableWorkspaceHandle,
  type ToolbarLayout,
} from "../../src/dockable.tsx";

const toolbarDefs = {
  tools: { render: () => null },
  options: { horizontalOnly: true, render: () => null },
};
const factory: ToolbarLayout = { left: ["tools"], top: ["options"] };

describe("DockableWorkspace toolbar layout", () => {
  it("replays a persisted toolbar placement at mount but resets to the factory seed", () => {
    const ref = createRef<DockableWorkspaceHandle>();
    render(
      <DockableWorkspace
        ref={ref}
        platform="mac"
        toolbarDefs={toolbarDefs}
        initialToolbarLayout={factory}
        toolbarLayout={{ bottom: ["options"], left: ["tools"] }}
      />,
    );

    expect(ref.current?.getToolbarLayout().bottom).toEqual([["options"]]);
    expect(ref.current?.getToolbarLayout().top).toEqual([]);
    act(() => ref.current?.reset());
    expect(ref.current?.getToolbarLayout().top).toEqual([["options"]]);
    expect(ref.current?.getToolbarLayout().bottom).toEqual([]);
  });

  it("reports every toolbar change so a host can persist it, skipping the mount", () => {
    const onToolbarLayoutChange = vi.fn<(...args: unknown[]) => void>();
    const ref = createRef<DockableWorkspaceHandle>();
    render(
      <DockableWorkspace
        ref={ref}
        platform="mac"
        toolbarDefs={toolbarDefs}
        initialToolbarLayout={factory}
        onToolbarLayoutChange={onToolbarLayoutChange}
      />,
    );

    expect(onToolbarLayoutChange).not.toHaveBeenCalled();
    act(() => ref.current?.setToolbarLayout({ right: ["tools"], top: ["options"] }));
    expect(onToolbarLayoutChange).toHaveBeenCalledTimes(1);
    // What the host stores must be a seed it can hand straight back.
    const reported = onToolbarLayoutChange.mock.calls[0][0] as ToolbarLayout;
    expect(reported.right).toEqual([["tools"]]);
    expect(reported.left).toEqual([]);
  });
});
