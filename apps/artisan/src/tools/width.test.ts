// ─────────────────────────────────────────────────────────────
// tools/width.test — the Width tool integration (parity)
// ─────────────────────────────────────────────────────────────
// Drives the real Width tool. Reference: Adobe Illustrator Width tool (Shift+W) —
// drag a stroke point to set the local stroke width; the edge follows the cursor,
// so the width = 2 × (cursor distance from the anchor). Stored as a per-anchor
// multiplier in stroke.widthProfile. Compounds use one flat profile across their
// subpaths; live shapes convert to a path first.

import { describe, it, expect } from "vitest";
import { createWidthTool } from "./width";
import { ArtisanStore, IO, makeDocument, makePath, makeCompound, makeAnchor as anchor, makeRect, defaultStroke, noPaint, solid, rgba, Query, type PathItem } from "../engine";
import type { Tool, ToolContext, ToolPointer } from "./types";

const BLACK = rgba(0, 0, 0);
const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const ptr = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const widen = (tool: Tool, ctx: ToolContext, anchorPt: [number, number], to: [number, number]) => {
  tool.onPointerDown!(ptr(anchorPt[0], anchorPt[1]), ctx);
  tool.onPointerMove!(ptr(to[0], to[1]), ctx);
  tool.onPointerUp!(ptr(to[0], to[1]), ctx);
};
const profileOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id)?.stroke.widthProfile;

describe("Width tool — integration", () => {
  const linePath = () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const line = makePath(
      { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
      { fill: noPaint(), stroke: { ...defaultStroke(solid(BLACK)), width: 10 } },
    );
    doc.layers[0].items.push(line);
    store.replaceDoc(doc, { markClean: true });
    return { store, line };
  };

  it("dragging a stroke point sets its width = 2 × cursor distance (as a multiplier)", () => {
    const { store, line } = linePath();
    const tool = createWidthTool();
    widen(tool, ctxOf(store), [0, 0], [0, 20]); // 20 from the anchor ⇒ width 40 ⇒ multiplier 40/10 = 4
    const wp = profileOf(store, line.id)!;
    expect(wp[0]).toBeCloseTo(4);
    expect(wp[1]).toBeCloseTo(1); // the other anchor is untouched
  });

  it("dragging farther makes the point wider (monotonic)", () => {
    const a = linePath();
    widen(createWidthTool(), ctxOf(a.store), [0, 0], [0, 15]); // mult 3
    const b = linePath();
    widen(createWidthTool(), ctxOf(b.store), [0, 0], [0, 35]); // mult 7
    expect(profileOf(b.store, b.line.id)![0]).toBeGreaterThan(profileOf(a.store, a.line.id)![0]);
  });

  it("converts a live shape to an editable path before applying width", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const r = makeRect(0, 0, 100, 80, 0, 0, { fill: noPaint(), stroke: { ...defaultStroke(solid(BLACK)), width: 6 } });
    doc.layers[0].items.push(r);
    store.replaceDoc(doc, { markClean: true });
    const tool = createWidthTool();
    widen(tool, ctxOf(store), [0, 0], [0, 12]); // drag the (0,0) corner
    const it = Query.getItem(store.getState().doc, r.id)!;
    expect(it.type).toBe("path"); // live rect became a path
    expect((it as PathItem).stroke.widthProfile).toBeDefined();
  });

  it("edits a compound subpath by flat anchor index and round-trips it", () => {
    const store = new ArtisanStore();
    const doc = makeDocument();
    const compound = makeCompound(
      [
        { closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 100, y: 0 })] },
        { closed: false, anchors: [anchor({ x: 0, y: 40 }), anchor({ x: 100, y: 40 })] },
      ],
      { fill: noPaint(), stroke: { ...defaultStroke(solid(BLACK)), width: 10 } },
    );
    doc.layers[0].items.push(compound);
    store.replaceDoc(doc, { markClean: true });

    widen(createWidthTool(), ctxOf(store), [0, 40], [0, 60]);

    expect(profileOf(store, compound.id)).toEqual([1, 1, 4, 1]);
    const reopened = IO.deserializeDocument(IO.serializeDocument(store.doc));
    expect(Query.getItem(reopened, compound.id)?.stroke.widthProfile).toEqual([1, 1, 4, 1]);
  });

  it("the width edit is one undoable transaction", () => {
    const { store, line } = linePath();
    widen(createWidthTool(), ctxOf(store), [0, 0], [0, 20]);
    expect(profileOf(store, line.id)).toBeDefined();
    store.undo();
    expect(profileOf(store, line.id)).toBeUndefined(); // back to a uniform stroke
  });

  it("reads and writes the top visible appearance stroke", () => {
    const { store, line } = linePath();
    store.transact("Appearance", (doc) => {
      const path = Query.getItem(doc, line.id)!;
      path.stroke = defaultStroke(noPaint());
      path.appearance = {
        entries: [
          { id: "legacy-none", kind: "stroke", stroke: defaultStroke(noPaint()) },
          { id: "visible", kind: "stroke", stroke: { ...defaultStroke(solid(BLACK)), width: 20 } },
        ],
      };
    });

    widen(createWidthTool(), ctxOf(store), [0, 0], [0, 20]); // width 40 / visible base 20 = 2

    const path = Query.getItem(store.getState().doc, line.id)! as PathItem;
    const visible = path.appearance!.entries[1];
    expect(visible.kind).toBe("stroke");
    if (visible.kind !== "stroke") throw new Error("expected stroke entry");
    expect(visible.stroke.widthProfile).toEqual([2, 1]);
    expect(path.stroke.width).toBe(20);
    expect(path.stroke.widthProfile).toEqual([2, 1]);
  });
});
