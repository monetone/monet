// ─────────────────────────────────────────────────────────────
// tools/drag-state-leak.test — hover must never act like a drag
// ─────────────────────────────────────────────────────────────
// The viewport calls onPointerMove on EVERY mouse move, button or not. A tool
// that keeps drag state past pointer-up (or past a tool switch) will therefore
// re-enter its drag path on a plain hover — creating artwork, or reverting the
// document to a stale snapshot, with no transaction open to undo it.

import { describe, it, expect } from "vitest";
import { createPerspectiveSelectionTool } from "./perspective";
import { createPencilTool } from "./freehand";
import { createPaintbrushTool } from "./paintbrush";
import { createTransformTool } from "./transform-tools";
import { createSliceSelectionTool } from "./slice";
import { ArtisanStore, makeDocument, makeRect, Ops, Query, solid, rgba, type GroupItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;

const setup = () => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const r = makeRect(0, 0, 100, 100, 0, 0, { fill: solid(rgba(200, 30, 30)) });
  doc.layers[0].items.push(r);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([r.id]);
  return { store, r };
};
const items = (store: ArtisanStore) => store.getState().doc.layers.flatMap((l) => l.items);
/** Perspective groups anywhere in the tree (a stale drag nests one inside another). */
const perspectiveGroups = (store: ArtisanStore): number => {
  let n = 0;
  const walk = (list: readonly { type: string }[]) => {
    for (const it of list) {
      if (it.type === "group") {
        if ((it as GroupItem).perspective) n++;
        walk((it as GroupItem).children);
      }
    }
  };
  walk(items(store));
  return n;
};

describe("Perspective Selection", () => {
  it("a hover after the drag ended does not wrap the artwork in a new group", () => {
    const { store } = setup();
    const tool = createPerspectiveSelectionTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(10, 10), ctx);
    tool.onPointerMove!(ptr(60, 10), ctx);
    tool.onPointerUp!(ptr(60, 10), ctx);
    const afterDrag = JSON.stringify(store.getState().doc);

    // Mouse moves on, no button down. A stale `ids` re-enters the drag path and
    // wraps the artwork in ANOTHER perspective group — nested inside the first,
    // so a top-level count would not notice.
    tool.onPointerMove!(ptr(200, 10), ctx);
    tool.onPointerMove!(ptr(240, 10), ctx);

    expect(JSON.stringify(store.getState().doc)).toBe(afterDrag);
    expect(perspectiveGroups(store)).toBe(1);
  });

  it("a hover with no prior drag at all does nothing", () => {
    const { store } = setup();
    const tool = createPerspectiveSelectionTool();
    const ctx = ctxOf(store);
    tool.onPointerMove!(ptr(200, 10), ctx);
    expect(items(store).some((it) => it.type === "group")).toBe(false);
    expect(store.canUndo).toBe(false);
  });
});

describe("Pencil", () => {
  it("switching tools mid-stroke does not leave state that a later hover replays", () => {
    const { store } = setup();
    const tool = createPencilTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(10, 10), ctx);
    tool.onPointerMove!(ptr(30, 10), ctx);
    (tool as Tool).onDeactivate?.(ctx); // user picks another tool mid-stroke

    const snapshot = JSON.stringify(store.getState().doc);
    tool.onPointerMove!(ptr(400, 400), ctx); // plain hover after re-activating
    expect(JSON.stringify(store.getState().doc)).toBe(snapshot);
  });

  it("an abandoned stroke leaves no artwork and no undo step", () => {
    const { store } = setup();
    const tool = createPencilTool();
    const ctx = ctxOf(store);
    const before = items(store).length;

    tool.onPointerDown!(ptr(10, 10), ctx);
    tool.onPointerMove!(ptr(30, 10), ctx);
    (tool as Tool).onDeactivate?.(ctx);

    expect(items(store)).toHaveLength(before);
    expect(store.canUndo).toBe(false);
  });
});


describe("Transform tools (rotate/scale/reflect/shear)", () => {
  // `ids` is the drag guard. A click WITHOUT a drag is a documented gesture (it
  // sets a custom pivot), and it used to leave `ids` armed — so the next mouse
  // move, no button down, ran a real transform outside any transaction.
  for (const kind of ["rotate", "scale", "reflect", "shear"] as const) {
    it(`${kind}: a hover after a pivot click does not transform the selection`, () => {
      const { store, r } = setup();
      const tool = createTransformTool(kind);
      const ctx = ctxOf(store);

      tool.onPointerDown!(ptr(50, 50), ctx);
      tool.onPointerUp!(ptr(50, 50), ctx); // click, no drag → sets the pivot
      const before = JSON.stringify(Query.getItem(store.getState().doc, r.id)!.transform);

      tool.onPointerMove!(ptr(300, 400), ctx); // buttonless hover

      expect(JSON.stringify(Query.getItem(store.getState().doc, r.id)!.transform)).toBe(before);
      expect(store.transactionBase, "and no transaction is left open").toBeNull();
    });
  }

  it("a completed rotate is not re-applied by a later hover", () => {
    const { store, r } = setup();
    const tool = createTransformTool("rotate");
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(150, 100), ctx);
    tool.onPointerMove!(ptr(100, 150), ctx);
    tool.onPointerUp!(ptr(100, 150), ctx);
    const after = JSON.stringify(Query.getItem(store.getState().doc, r.id)!.transform);

    tool.onPointerMove!(ptr(400, 400), ctx);
    expect(JSON.stringify(Query.getItem(store.getState().doc, r.id)!.transform)).toBe(after);
  });
});

describe("Paintbrush", () => {
  it("a tool switch mid-stroke cannot let a later hover clobber the document", () => {
    const { store } = setup();
    const tool = createPaintbrushTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(10, 10), ctx);
    tool.onPointerMove!(ptr(60, 10), ctx);
    tool.onDeactivate?.(ctx); // user switches tool mid-stroke

    // Real work with another tool.
    store.transact("Rectangle", (d) => Ops.Items.addItem(d, makeRect(200, 200, 50, 50)));
    const snapshot = JSON.stringify(store.getState().doc);

    tool.onPointerMove!(ptr(400, 400), ctx); // back on the brush, just hovering
    expect(JSON.stringify(store.getState().doc)).toBe(snapshot);
  });
});

describe("Slice Selection", () => {
  it("a hover after selecting a slice does not drag it", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    doc.slices = [{ id: "S1", name: "Slice", x: 50, y: 50, width: 100, height: 60 }];
    store.replaceDoc(doc, { markClean: true });
    const tool = createSliceSelectionTool();
    const ctx = ctxOf(store);

    tool.onPointerDown!(ptr(80, 70), ctx);
    tool.onPointerUp!(ptr(80, 70), ctx); // select, no drag
    const before = JSON.stringify(store.getState().doc.slices);

    tool.onPointerMove!(ptr(300, 300), ctx);

    expect(JSON.stringify(store.getState().doc.slices)).toBe(before);
    expect(store.transactionBase).toBeNull();
  });
});
