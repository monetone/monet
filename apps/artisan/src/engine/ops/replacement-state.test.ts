import { describe, expect, it } from "vitest";
import {
  Ops,
  Query,
  defaultStroke,
  makeAnchor as anchor,
  makeDocument,
  makeLayer,
  makePath,
  makeRect,
  rgba,
  solid,
  type Item,
} from "../index";

const RED = solid(rgba(220, 0, 0));
const square = () => ({
  closed: true,
  anchors: [
    anchor({ x: 0, y: 0 }),
    anchor({ x: 100, y: 0 }),
    anchor({ x: 100, y: 100 }),
    anchor({ x: 0, y: 100 }),
  ],
});

const decoratedPath = () => {
  const item = makePath(square(), { fill: RED });
  item.visible = false;
  item.locked = true;
  item.appearance = { entries: [{ id: "appearance-fill", kind: "fill", paint: RED }] };
  item.effects = [{ type: "blur", radius: 3 }];
  item.overprintFill = true;
  item.overprintStroke = true;
  item.evenOdd = true;
  item.mask = [makeRect(0, 0, 5, 5)];
  item.maskType = "alpha";
  item.brush = {
    brushId: "brush",
    brushName: "Brush",
    kind: "calligraphic",
    settings: { size: 4, angle: 0, roundness: 1, paintSource: "stroke" },
  };
  return item;
};

describe("replacement operations preserve common item state", () => {
  it.each([
    [
      "Offset Path",
      (doc: ReturnType<typeof makeDocument>, source: Item) => {
        const id = Ops.OffsetPath.offsetPath(doc, [source.id], { distance: 5 })[0];
        return Query.getItem(doc, id)!;
      },
    ],
    [
      "Scribble",
      (doc: ReturnType<typeof makeDocument>, source: Item) => {
        Ops.Scribble.scribble(doc, [source.id], { angle: 0, spacing: 20, strokeWidth: 3 });
        const result = Query.getItem(doc, source.id)!;
        expect(result.fill.type).toBe("none");
        expect(result.stroke).toEqual({ ...defaultStroke(RED), width: 3 });
        return result;
      },
    ],
    [
      "Envelope bake",
      (doc: ReturnType<typeof makeDocument>, source: Item) => {
        const id = Ops.Envelope.makeWithWarp(doc, [source.id], { style: "arc", bend: 0.5 })!;
        Ops.Envelope.expand(doc, [id]);
        const group = Query.getItem(doc, id)!;
        if (group.type !== "group") throw new Error("expected expanded envelope group");
        return group.children[0];
      },
    ],
  ])("%s", (_name, run) => {
    const doc = makeDocument();
    const source = decoratedPath();
    Ops.Items.addItem(doc, source);

    const result = run(doc, source);

    expect(result).toMatchObject({
      visible: false,
      locked: true,
      appearance: source.appearance,
      effects: source.effects,
      overprintFill: true,
      overprintStroke: true,
      evenOdd: true,
      maskType: "alpha",
      brush: source.brush,
    });
    expect(result.mask).toEqual(source.mask);
    expect(result.appearance).not.toBe(source.appearance);
  });
});

describe("collectInNewLayer", () => {
  it("folds a hidden and locked source layer into the moved item", () => {
    const doc = makeDocument();
    const source = makeLayer("Hidden reference", [makeRect(0, 0, 10, 10)]);
    source.visible = false;
    source.locked = true;
    doc.layers.push(source);
    const item = source.items[0];

    const layerId = Ops.Layers.collectInNewLayer(doc, [item.id])!;
    const destination = doc.layers.find((layer) => layer.id === layerId)!;

    expect(destination).toMatchObject({ visible: true, locked: false });
    expect(destination.items).toEqual([item]);
    expect(item).toMatchObject({ visible: false, locked: true });
  });
});
