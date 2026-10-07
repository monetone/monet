import { describe, expect, it } from "vitest";
import {
  ArtisanStore,
  makeAnchor,
  makeCompound,
  makeDocument,
  Query,
  rgba,
  solid,
  type CompoundPathItem,
  type PathGeometry,
} from "../engine";
import { createAddAnchorTool, createConvertAnchorTool, createDeleteAnchorTool, createScissorsTool, createSmoothTool } from "./path-tools";
import { createPuppetWarpTool } from "./puppet-warp";
import { createReshapeTool } from "./reshape";
import type { Tool, ToolContext, ToolPointer } from "./types";

const ctxOf = (store: ArtisanStore): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (point) => point, screenToWorld: (point) => point, requestRender: () => {}, zoom: 1, viewport: { width: 800, height: 600 } }) as ToolContext;
const pointer = (x: number, y: number): ToolPointer =>
  ({ world: { x, y }, rawWorld: { x, y }, screen: { x, y }, shift: false, alt: false, mod: false, button: 0, detail: 1 }) as ToolPointer;
const square = (x: number): PathGeometry => ({
  closed: true,
  anchors: [makeAnchor({ x, y: 0 }), makeAnchor({ x: x + 20, y: 0 }), makeAnchor({ x: x + 20, y: 20 }), makeAnchor({ x, y: 20 })],
});
const setup = (subpaths: PathGeometry[] = [square(0), square(100)]) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const compound = makeCompound(subpaths, { fill: solid(rgba(120, 160, 220)) });
  doc.layers[0].items.push(compound);
  store.replaceDoc(doc, { markClean: true });
  return { store, id: compound.id };
};
const compoundOf = (store: ArtisanStore, id: string) => Query.getItem(store.getState().doc, id) as CompoundPathItem;
const click = (tool: Tool, ctx: ToolContext, x: number, y: number) => {
  tool.onPointerDown!(pointer(x, y), ctx);
  tool.onPointerUp?.(pointer(x, y), ctx);
};
const drag = (tool: Tool, ctx: ToolContext, from: [number, number], to: [number, number]) => {
  tool.onPointerDown!(pointer(...from), ctx);
  tool.onPointerMove!(pointer(...to), ctx);
  tool.onPointerUp!(pointer(...to), ctx);
};

describe("compound-aware path tools", () => {
  it("routes Delete and Convert through flat anchors on the second subpath", () => {
    const deletion = setup();
    click(createDeleteAnchorTool(), ctxOf(deletion.store), 100, 0);
    expect(compoundOf(deletion.store, deletion.id).subpaths.map((path) => path.anchors.length)).toEqual([4, 3]);

    const handled = square(100);
    handled.anchors[0] = makeAnchor({ x: 100, y: 0 }, { x: -10, y: 0 }, { x: 10, y: 0 });
    const conversion = setup([square(0), handled]);
    click(createConvertAnchorTool(), ctxOf(conversion.store), 100, 0);
    const anchor = compoundOf(conversion.store, conversion.id).subpaths[1].anchors[0];
    expect(anchor.handleIn).toEqual({ x: 0, y: 0 });
    expect(anchor.handleOut).toEqual({ x: 0, y: 0 });
  });

  it("routes Add and Scissors to the nearest compound subpath segment", () => {
    const addition = setup();
    createAddAnchorTool().onPointerDown!(pointer(110, 0), ctxOf(addition.store));
    expect(compoundOf(addition.store, addition.id).subpaths.map((path) => path.anchors.length)).toEqual([4, 5]);

    const cut = setup([
      square(0),
      { closed: false, anchors: [makeAnchor({ x: 100, y: 0 }), makeAnchor({ x: 120, y: 0 }), makeAnchor({ x: 140, y: 0 })] },
    ]);
    createScissorsTool().onPointerDown!(pointer(110, 0), ctxOf(cut.store));
    const paths = compoundOf(cut.store, cut.id).subpaths;
    expect(paths.map((path) => [path.closed, path.anchors.length])).toEqual([[true, 4], [false, 2], [false, 3]]);
  });

  it("lets Smooth and Reshape edit compound geometry without converting it", () => {
    const spike: PathGeometry = {
      closed: false,
      anchors: [makeAnchor({ x: 100, y: 0 }), makeAnchor({ x: 110, y: 30 }), makeAnchor({ x: 120, y: 0 })],
    };
    const smoothing = setup([{ closed: false, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 10, y: 0 }), makeAnchor({ x: 20, y: 0 })] }, spike]);
    smoothing.store.setSelection([smoothing.id]);
    drag(createSmoothTool(), ctxOf(smoothing.store), [110, 30], [110, 30]);
    expect(compoundOf(smoothing.store, smoothing.id).subpaths[1].anchors[1].point.y).toBeLessThan(30);
    expect(compoundOf(smoothing.store, smoothing.id).subpaths[0].anchors[1].point).toEqual({ x: 10, y: 0 });

    const reshaping = setup();
    drag(createReshapeTool(), ctxOf(reshaping.store), [100, 0], [110, 10]);
    expect(compoundOf(reshaping.store, reshaping.id).subpaths[1].anchors[0].point).toEqual({ x: 110, y: 10 });
    expect(compoundOf(reshaping.store, reshaping.id).subpaths[0].anchors[0].point).toEqual({ x: 0, y: 0 });
  });

  it("keeps Puppet Warp rest points aligned with flattened compound anchors", () => {
    const warped = setup();
    const tool = createPuppetWarpTool();
    const ctx = ctxOf(warped.store);
    click(tool, ctx, 0, 0);
    click(tool, ctx, 100, 0);
    drag(tool, ctx, [100, 0], [100, 30]);

    const paths = compoundOf(warped.store, warped.id).subpaths;
    expect(paths[1].anchors[0].point.y).toBeGreaterThan(25);
    expect(Math.abs(paths[0].anchors[0].point.y)).toBeLessThan(1);
  });
});
