// ─────────────────────────────────────────────────────────────
// ops/clean-up.test — Object ▸ Path ▸ Clean Up (parity)
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator "Clean Up" removes stray points (isolated single
// anchors), unpainted objects (no fill AND no stroke), and empty text paths. It
// must NOT remove a clip group's clip path (unpainted by design).

import { describe, it, expect } from "vitest";
import { makeDocument, makePath, makeAnchor as anchor, makeRect, makeText, makeGroup, Ops, Query, solid, noPaint, defaultStroke, rgba } from "../index";

const RED = rgba(220, 0, 0);
const ghostStroke = () => defaultStroke(noPaint());

describe("ops.items.cleanUp", () => {
  it("removes a stray point (single-anchor path) and keeps a real path", () => {
    const doc = makeDocument();
    const stray = makePath({ closed: false, anchors: [anchor({ x: 10, y: 10 })] }, { fill: solid(RED) });
    const ok = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 50, y: 0 })] }, { fill: noPaint(), stroke: defaultStroke(solid(RED)) });
    Ops.Items.addItem(doc, stray);
    Ops.Items.addItem(doc, ok);
    expect(Ops.Items.cleanUp(doc)).toEqual([stray.id]);
    expect(Query.getItem(doc, stray.id)).toBeNull();
    expect(Query.getItem(doc, ok.id)).not.toBeNull();
  });

  it("removes unpainted objects (no fill + no stroke)", () => {
    const doc = makeDocument();
    const ghost = makeRect(0, 0, 50, 50, 0, 0, { fill: noPaint(), stroke: ghostStroke() });
    const painted = makeRect(60, 0, 50, 50, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, ghost);
    Ops.Items.addItem(doc, painted);
    expect(Ops.Items.cleanUp(doc)).toEqual([ghost.id]);
    expect(Query.getItem(doc, painted.id)).not.toBeNull();
  });

  it("removes empty text and keeps non-empty text", () => {
    const doc = makeDocument();
    const empty = makeText("", 0, 0);
    const hello = makeText("Hi", 0, 50);
    Ops.Items.addItem(doc, empty);
    Ops.Items.addItem(doc, hello);
    expect(Ops.Items.cleanUp(doc)).toEqual([empty.id]);
    expect(Query.getItem(doc, hello.id)).not.toBeNull();
  });

  it("keeps normal painted shapes (no-op)", () => {
    const doc = makeDocument();
    Ops.Items.addItem(doc, makeRect(0, 0, 50, 50, 0, 0, { fill: solid(RED) }));
    expect(Ops.Items.cleanUp(doc)).toEqual([]);
  });

  it("keeps shapes painted only by their appearance stack", () => {
    const doc = makeDocument();
    const painted = makeRect(0, 0, 50, 50, 0, 0, { fill: noPaint(), stroke: ghostStroke() });
    painted.appearance = { entries: [
      { id: "none", kind: "fill", paint: noPaint() },
      { id: "paint", kind: "fill", paint: solid(RED) },
    ] };
    Ops.Items.addItem(doc, painted);

    expect(Ops.Items.cleanUpTargets(doc)).toEqual([]);
    expect(Ops.Items.cleanUp(doc)).toEqual([]);
    expect(Query.getItem(doc, painted.id)).not.toBeNull();
  });

  it("never removes a clip group's (unpainted) clip path", () => {
    const doc = makeDocument();
    const clipShape = makeRect(0, 0, 100, 100, 0, 0, { fill: noPaint(), stroke: ghostStroke() });
    const content = makeRect(10, 10, 50, 50, 0, 0, { fill: solid(RED) });
    const g = makeGroup([clipShape, content]);
    g.clip = true;
    Ops.Items.addItem(doc, g);
    expect(Ops.Items.cleanUp(doc)).toEqual([]); // the clip path survives
    expect(Query.getItem(doc, clipShape.id)).not.toBeNull();
  });

  it("removes stray points nested inside a group", () => {
    const doc = makeDocument();
    const stray = makePath({ closed: false, anchors: [anchor({ x: 5, y: 5 })] }, { fill: solid(RED) });
    const ok = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(RED) });
    Ops.Items.addItem(doc, makeGroup([stray, ok]));
    expect(Ops.Items.cleanUp(doc)).toEqual([stray.id]);
    expect(Query.getItem(doc, ok.id)).not.toBeNull();
  });
});
