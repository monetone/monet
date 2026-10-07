import { describe, it, expect } from "vitest";
import {
  Mat,
  Bez,
  Path,
  BBox,
  Shapes,
  Query,
  Ops,
  ArtisanStore,
  IO,
  makeDocument,
  makeRect,
  makeEllipse,
  makePolygon,
  makePath,
  makeGroup,
  makeText,
  makeAnchor as anchor,
  solid,
  type PathGeometry,
  type Paint,
} from "./index";

const approx = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) <= eps;

describe("matrix", () => {
  it("translates points", () => {
    const p = Mat.applyToPoint(Mat.translation(10, 5), { x: 0, y: 0 });
    expect(p).toEqual({ x: 10, y: 5 });
  });

  it("composes in apply-second-first order (mul(T,R) rotates then translates)", () => {
    const M = Mat.mul(Mat.translation(10, 0), Mat.rotation(Math.PI / 2));
    const p = Mat.applyToPoint(M, { x: 1, y: 0 });
    expect(approx(p.x, 10, 1e-9)).toBe(true);
    expect(approx(p.y, 1, 1e-9)).toBe(true);
  });

  it("inverts (roundtrip)", () => {
    const M = Mat.compose(Mat.translation(10, 20), Mat.scaling(2, 3), Mat.rotation(0.7));
    const p = { x: 3.5, y: -2.1 };
    const back = Mat.applyToPoint(Mat.invert(M), Mat.applyToPoint(M, p));
    expect(approx(back.x, p.x, 1e-9)).toBe(true);
    expect(approx(back.y, p.y, 1e-9)).toBe(true);
  });

  it("rotates around a pivot", () => {
    const M = Mat.aroundPoint({ x: 5, y: 5 }, Mat.rotation(Math.PI / 2));
    const p = Mat.applyToPoint(M, { x: 5, y: 0 });
    expect(approx(p.x, 10, 1e-9)).toBe(true);
    expect(approx(p.y, 5, 1e-9)).toBe(true);
  });
});

describe("bezier", () => {
  it("a line evaluates to its midpoint and box", () => {
    const c = Bez.line({ x: 0, y: 0 }, { x: 10, y: 4 });
    expect(Bez.evaluate(c, 0.5)).toEqual({ x: 5, y: 2 });
    const b = Bez.bbox(c);
    expect(approx(b.width, 10) && approx(b.height, 4)).toBe(true);
  });

  it("split is continuous", () => {
    const c = Bez.cubic({ x: 0, y: 0 }, { x: 0, y: 10 }, { x: 10, y: 10 }, { x: 10, y: 0 });
    const [l, r] = Bez.split(c, 0.5);
    expect(l.p3).toEqual(r.p0);
    expect(Bez.evaluate(l, 1)).toEqual(Bez.evaluate(c, 0.5));
  });

  it("projects a point onto a line", () => {
    const c = Bez.line({ x: 0, y: 0 }, { x: 10, y: 0 });
    const proj = Bez.project(c, { x: 5, y: 3 });
    expect(approx(proj.point.x, 5, 1e-3)).toBe(true);
    expect(approx(proj.point.y, 0, 1e-3)).toBe(true);
    expect(approx(proj.dist, 3, 1e-3)).toBe(true);
  });
});

describe("path", () => {
  const square: PathGeometry = {
    closed: true,
    anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 }), anchor({ x: 0, y: 10 })],
  };

  it("emits line segments as L commands", () => {
    expect(Path.toSVGPath(square)).toBe("M 0 0 L 10 0 L 10 10 L 0 10 Z");
  });

  it("contains interior points and rejects exterior", () => {
    expect(Path.containsPoint(square, { x: 5, y: 5 })).toBe(true);
    expect(Path.containsPoint(square, { x: 15, y: 5 })).toBe(false);
  });

  it("computes bounds", () => {
    const b = Path.bounds(square);
    expect(b).toEqual({ x: 0, y: 0, width: 10, height: 10 });
  });

  it("transforms points and handles", () => {
    const t = Path.transform(square, Mat.translation(5, 5));
    expect(t.anchors[0].point).toEqual({ x: 5, y: 5 });
  });
});

describe("shapes", () => {
  it("rect path bounds match width/height", () => {
    const b = Path.bounds(Shapes.rectPath(20, 10));
    expect(approx(b.width, 20) && approx(b.height, 10)).toBe(true);
  });

  it("ellipse path bounds approximate width/height", () => {
    const b = Path.bounds(Shapes.ellipsePath(40, 20));
    expect(approx(b.width, 40, 0.2) && approx(b.height, 20, 0.2)).toBe(true);
  });

  it("polygon has the requested vertex count", () => {
    const p = Shapes.polygonPath(50, 6);
    expect(p.anchors.length).toBe(6);
  });

  it("local bounds of a group unions transformed children", () => {
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(20, 20, 10, 10);
    const g = { type: "group" as const, id: "g", name: "g", transform: Mat.IDENTITY, fill: { type: "none" as const }, stroke: { paint: { type: "none" as const }, width: 1, cap: "butt" as const, join: "miter" as const, miterLimit: 10, dash: [], dashOffset: 0, align: "center" as const }, opacity: 1, blendMode: "normal" as const, visible: true, locked: false, children: [a, b], clip: false };
    const lb = Shapes.localBounds(g);
    expect(lb.x).toBe(0);
    expect(lb.width).toBe(30);
    expect(lb.height).toBe(30);
  });
});

describe("query", () => {
  it("computes world bounds and hit tests", () => {
    const doc = makeDocument();
    const rect = makeRect(10, 20, 30, 40);
    Ops.Items.addItem(doc, rect);
    const wb = Query.worldBounds(doc, rect.id)!;
    expect(wb).toEqual({ x: 10, y: 20, width: 30, height: 40 });

    const hit = Query.hitTest(doc, { x: 25, y: 40 });
    expect(hit?.leaf.item.id).toBe(rect.id);
    expect(Query.hitTest(doc, { x: 500, y: 500 })).toBeNull();
  });

  it("selects items by marquee rect", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 10, 10);
    const r2 = makeRect(100, 100, 10, 10);
    Ops.Items.addItems(doc, [r1, r2]);
    const ids = Query.itemsInRect(doc, { x: -5, y: -5, width: 30, height: 30 });
    expect(ids).toContain(r1.id);
    expect(ids).not.toContain(r2.id);
  });
});

describe("store undo/redo", () => {
  it("records and reverses document edits", () => {
    const store = new ArtisanStore();
    expect(store.doc.layers[0].items.length).toBe(0);

    const rect = makeRect(0, 0, 10, 10);
    store.transact("Add Rect", (d) => Ops.Items.addItem(d, rect));
    expect(store.doc.layers[0].items.length).toBe(1);
    expect(store.canUndo).toBe(true);

    store.undo();
    expect(store.doc.layers[0].items.length).toBe(0);
    store.redo();
    expect(store.doc.layers[0].items.length).toBe(1);
  });

  it("sanitizes selection that references removed items after undo", () => {
    const store = new ArtisanStore();
    const rect = makeRect(0, 0, 10, 10);
    store.transact("Add", (d) => Ops.Items.addItem(d, rect));
    store.setSelection([rect.id]);
    store.undo();
    expect(store.getState().selection).not.toContain(rect.id);
  });
});

describe("ops", () => {
  it("translates an item's world bounds", () => {
    const doc = makeDocument();
    const rect = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, rect);
    Ops.Transform.translateItems(doc, [rect.id], 15, 25);
    const wb = Query.worldBounds(doc, rect.id)!;
    expect(approx(wb.x, 15) && approx(wb.y, 25)).toBe(true);
  });

  it("groups and ungroups (roundtrip count)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const b = makeEllipse(20, 0, 10, 10);
    Ops.Items.addItems(doc, [a, b]);
    const gid = Ops.Group.group(doc, [a.id, b.id])!;
    expect(doc.layers[0].items.length).toBe(1);
    const g = doc.layers[0].items[0];
    expect(g.type).toBe("group");
    Ops.Group.ungroup(doc, [gid]);
    expect(doc.layers[0].items.length).toBe(2);
  });

  it("brings an item to front (end of z-order)", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    const b = makeRect(0, 0, 10, 10);
    const c = makePolygon(0, 0, 10, 5);
    Ops.Items.addItems(doc, [a, b, c]);
    Ops.Arrange.bringToFront(doc, [a.id]);
    expect(doc.layers[0].items[doc.layers[0].items.length - 1].id).toBe(a.id);
  });

  it("duplicates with a fresh id", () => {
    const doc = makeDocument();
    const a = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, a);
    const [dupId] = Ops.Items.duplicateItems(doc, [a.id]);
    expect(dupId).not.toBe(a.id);
    expect(doc.layers[0].items.length).toBe(2);
  });

  it("aligns items to the left of the selection bounds", () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 10, 10);
    const r2 = makeRect(100, 0, 10, 10);
    Ops.Items.addItems(doc, [r1, r2]);
    const ref = Query.selectionBounds(doc, [r1.id, r2.id])!;
    Ops.Align.align(doc, [r1.id, r2.id], "left", ref);
    expect(approx(Query.worldBounds(doc, r2.id)!.x, 0)).toBe(true);
  });
});

describe("ops.path-edit", () => {
  it("converts a live rect to an editable path, preserving id + bounds", () => {
    const doc = makeDocument();
    const r = makeRect(10, 20, 40, 30);
    Ops.Items.addItem(doc, r);
    const before = Query.worldBounds(doc, r.id)!;
    Ops.PathEdit.convertToPath(doc, r.id);
    const item = Query.getItem(doc, r.id)!;
    expect(item.type).toBe("path");
    const after = Query.worldBounds(doc, r.id)!;
    expect(approx(after.width, before.width, 0.01) && approx(after.height, before.height, 0.01)).toBe(true);
  });

  it("preserves every common item field when converting a live shape", () => {
    const doc = makeDocument();
    const r = makeRect(10, 20, 40, 30);
    r.effects = [{ type: "blur", radius: 3 }];
    r.appearance = { entries: [{ id: "fill", kind: "fill", paint: r.fill }] };
    r.mask = [makeEllipse(0, 0, 10, 10)];
    r.maskType = "alpha";
    r.overprintFill = true;
    r.overprintStroke = true;
    r.evenOdd = true;
    r.brush = {
      brushId: "brush",
      brushName: "Brush",
      kind: "calligraphic",
      settings: { size: 5, angle: 0, roundness: 1, paintSource: "stroke" },
    };
    Ops.Items.addItem(doc, r);

    Ops.PathEdit.convertToPath(doc, r.id);

    expect(Query.getItem(doc, r.id)).toMatchObject({
      effects: r.effects,
      appearance: r.appearance,
      mask: r.mask,
      maskType: "alpha",
      overprintFill: true,
      overprintStroke: true,
      evenOdd: true,
      brush: r.brush,
    });
  });

  it("moves selected anchors", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.moveAnchors(doc, p.id, [0], 5, 7);
    const item = Query.getItem(doc, p.id)!;
    expect(item.type === "path" && item.geometry.anchors[0].point).toEqual({ x: 5, y: 7 });
  });

  it("deletes the item when fewer than 2 anchors remain", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.deleteAnchors(doc, p.id, [1]);
    expect(Query.getItem(doc, p.id)).toBeNull();
  });

  it("inserts an anchor on a segment", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    Ops.Items.addItem(doc, p);
    const item = Query.getItem(doc, p.id)!;
    if (item.type === "path") item.geometry = Path.insertAnchor(item.geometry, 0, 0.5);
    expect(item.type === "path" && item.geometry.anchors.length).toBe(3);
  });

  it("joins a single open path by closing it", () => {
    const doc = makeDocument();
    const p = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 })] });
    Ops.Items.addItem(doc, p);
    Ops.PathEdit.joinPaths(doc, [p.id]);
    const item = Query.getItem(doc, p.id)!;
    expect(item.type === "path" && item.geometry.closed).toBe(true);
  });

  it("joins two open paths into one", () => {
    const doc = makeDocument();
    const a = makePath({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 })] });
    const b = makePath({ closed: false, anchors: [anchor({ x: 12, y: 0 }), anchor({ x: 20, y: 0 })] });
    Ops.Items.addItems(doc, [a, b]);
    const nid = Ops.PathEdit.joinPaths(doc, [a.id, b.id])!;
    expect(doc.layers[0].items.length).toBe(1);
    const item = Query.getItem(doc, nid)!;
    expect(item.type === "path" && item.geometry.anchors.length).toBe(4);
  });

  it("cuts a closed path into an open one", () => {
    const doc = makeDocument();
    const sq = makePath({
      closed: true,
      anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 0 }), anchor({ x: 10, y: 10 }), anchor({ x: 0, y: 10 })],
    });
    Ops.Items.addItem(doc, sq);
    Ops.PathEdit.cutPathAt(doc, sq.id, 0, 0.5);
    const item = Query.getItem(doc, sq.id)!;
    expect(item.type === "path" && item.geometry.closed).toBe(false);
    expect(item.type === "path" && item.geometry.anchors.length).toBe(6);
  });
});

describe("ops.pathfinder", () => {
  const overlapping = () => {
    const doc = makeDocument();
    const r1 = makeRect(0, 0, 10, 10);
    const r2 = makeRect(5, 5, 10, 10);
    Ops.Items.addItems(doc, [r1, r2]);
    return { doc, r1, r2 };
  };

  it("unites two overlapping rects into one compound covering the union bounds", () => {
    const { doc, r1, r2 } = overlapping();
    const id = Ops.Pathfinder.pathfinder(doc, [r1.id, r2.id], "unite")!;
    expect(id).toBeTruthy();
    expect(doc.layers[0].items.length).toBe(1);
    const b = Query.worldBounds(doc, id)!;
    expect(approx(b.x, 0, 0.6) && approx(b.y, 0, 0.6)).toBe(true);
    expect(approx(b.width, 15, 0.6) && approx(b.height, 15, 0.6)).toBe(true);
  });

  it("intersects to the overlap region", () => {
    const { doc, r1, r2 } = overlapping();
    const id = Ops.Pathfinder.pathfinder(doc, [r1.id, r2.id], "intersect")!;
    const b = Query.worldBounds(doc, id)!;
    expect(approx(b.x, 5, 0.6) && approx(b.y, 5, 0.6)).toBe(true);
    expect(approx(b.width, 5, 0.6) && approx(b.height, 5, 0.6)).toBe(true);
  });

  it("minus-front keeps the back object's outer bounds", () => {
    const { doc, r1, r2 } = overlapping();
    const id = Ops.Pathfinder.pathfinder(doc, [r1.id, r2.id], "minus-front")!;
    const b = Query.worldBounds(doc, id)!;
    expect(approx(b.x, 0, 0.6) && approx(b.y, 0, 0.6)).toBe(true);
    expect(approx(b.width, 10, 0.6) && approx(b.height, 10, 0.6)).toBe(true);
  });
});

describe("ops.effects", () => {
  it("adds then clears an effect", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, r);
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("drop-shadow"));
    expect(Query.getItem(doc, r.id)!.effects?.[0].type).toBe("drop-shadow");
    Ops.Effects.clearEffects(doc, [r.id]);
    expect(Query.getItem(doc, r.id)!.effects).toBeUndefined();
  });

  it("replaces an effect of the same type rather than duplicating", () => {
    const doc = makeDocument();
    const r = makeRect(0, 0, 10, 10);
    Ops.Items.addItem(doc, r);
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("blur"));
    Ops.Effects.addEffect(doc, [r.id], Ops.Effects.defaultEffect("blur"));
    expect(Query.getItem(doc, r.id)!.effects?.length).toBe(1);
  });
});

describe("io", () => {
  it("round-trips a document through .artisan JSON", () => {
    const doc = makeDocument("My Doc");
    Ops.Items.addItem(doc, makeRect(10, 20, 30, 40));
    Ops.Items.addItem(doc, makeEllipse(5, 5, 50, 50));
    const text = IO.serializeDocument(doc);
    const back = IO.deserializeDocument(text);
    expect(back.name).toBe("My Doc");
    expect(back.layers[0].items.length).toBe(2);
    expect(back.layers[0].items[0].type).toBe("rect");
  });

  it("rejects non-Artisan JSON", () => {
    expect(() => IO.deserializeDocument('{"hello":"world"}')).toThrow();
  });

  it("exports SVG with a viewBox and shape elements", () => {
    const doc = makeDocument("Export", 200, 100);
    Ops.Items.addItem(doc, makeRect(10, 10, 50, 30));
    const svg = IO.exportSVG(doc, { background: true });
    expect(svg).toContain("<svg");
    expect(svg).toContain('viewBox="0 0 200 100"');
    expect(svg).toContain("<rect");
  });

  it("exports gradient spreadMethod", () => {
    const grad: Paint = {
      type: "gradient",
      gradient: { type: "linear", stops: [{ offset: 0, color: { r: 0, g: 0, b: 0, a: 1 } }, { offset: 1, color: { r: 255, g: 255, b: 255, a: 1 } }], x1: 0, y1: 0, x2: 1, y2: 0, cx: 0.5, cy: 0.5, r: 0.5, spread: "reflect" },
    };
    const doc = makeDocument("G", 100, 100);
    Ops.Items.addItem(doc, makeRect(0, 0, 50, 50, 0, 0, { fill: grad }));
    expect(IO.exportSVG(doc)).toContain('spreadMethod="reflect"');
  });

  it("exports a pattern fill as <pattern>", () => {
    const pat: Paint = { type: "pattern", pattern: { tile: [makeRect(0, 0, 10, 10, 0, 0, { fill: solid({ r: 255, g: 0, b: 0, a: 1 }) })], width: 10, height: 10 } };
    const doc = makeDocument("P", 100, 100);
    Ops.Items.addItem(doc, makeRect(0, 0, 80, 80, 0, 0, { fill: pat }));
    const svg = IO.exportSVG(doc);
    expect(svg).toContain("<pattern");
    expect(svg).toContain("url(#pat");
  });

  it("exports a clip group as <clipPath> with flat path (no nested <g>)", () => {
    const clip = makeGroup([makeEllipse(0, 0, 40, 40), makeRect(0, 0, 60, 60)]);
    clip.clip = true;
    const doc = makeDocument("C", 100, 100);
    Ops.Items.addItem(doc, clip);
    const svg = IO.exportSVG(doc);
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('clip-path="url(#clip');
    // clipPath must contain a <path>, not a wrapping <g>
    expect(/<clipPath[^>]*><path/.test(svg)).toBe(true);
  });

  it("exports an item mask as <mask>", () => {
    const r = makeRect(0, 0, 50, 50);
    r.mask = [makeRect(0, 0, 50, 50, 0, 0, { fill: solid({ r: 255, g: 255, b: 255, a: 1 }) })];
    const doc = makeDocument("M", 100, 100);
    Ops.Items.addItem(doc, r);
    const svg = IO.exportSVG(doc);
    expect(svg).toContain("<mask");
    expect(svg).toContain('mask="url(#mask');
  });

  it("exports mask-type=alpha for an alpha mask, and omits it for luminance", () => {
    const alpha = makeRect(0, 0, 50, 50);
    alpha.mask = [makeRect(0, 0, 50, 50, 0, 0, { fill: solid({ r: 255, g: 255, b: 255, a: 1 }) })];
    alpha.maskType = "alpha";
    const lum = makeRect(0, 0, 50, 50);
    lum.mask = [makeRect(0, 0, 50, 50, 0, 0, { fill: solid({ r: 255, g: 255, b: 255, a: 1 }) })];
    const aDoc = makeDocument("MA", 100, 100);
    Ops.Items.addItem(aDoc, alpha);
    const lDoc = makeDocument("ML", 100, 100);
    Ops.Items.addItem(lDoc, lum);
    expect(IO.exportSVG(aDoc)).toContain('mask-type="alpha"');
    expect(IO.exportSVG(lDoc)).not.toContain("mask-type");
  });

  it("exports a glow effect as the SourceAlpha-blur / feFlood / feComposite-in / feMerge group", () => {
    const r = makeRect(0, 0, 50, 50);
    r.effects = [{ type: "glow", blur: 6, color: { r: 255, g: 212, b: 0, a: 0.9 } }];
    const doc = makeDocument("GL", 100, 100);
    Ops.Items.addItem(doc, r);
    const svg = IO.exportSVG(doc);
    // Locks the markup the importer's glow re-detection depends on.
    expect(svg).toContain('<feGaussianBlur in="SourceAlpha" stdDeviation="6"');
    expect(svg).toContain("<feFlood");
    expect(svg).toContain('flood-opacity="0.9"');
    expect(svg).toContain('<feComposite');
    expect(svg).toContain('operator="in"');
    expect(svg).toMatch(/<feMerge\b/); // result name is indexed per effect so repeats never collide
  });

  it("exports multi-run text as separate <tspan> runs", () => {
    const t = makeText("up down", 0, 0);
    t.runs = [
      { text: "up", fill: solid({ r: 255, g: 0, b: 0, a: 1 }) },
      { text: "down", fill: solid({ r: 0, g: 128, b: 0, a: 1 }), dy: 10 },
    ];
    const doc = makeDocument("T", 100, 100);
    Ops.Items.addItem(doc, t);
    const svg = IO.exportSVG(doc);
    expect((svg.match(/<tspan/g) || []).length).toBe(2);
    expect(svg).toContain(">up</tspan>");
    expect(svg).toContain('dy="10"');
  });

  it("renders content unclipped when a clip shape has no path geometry (no empty clipPath)", () => {
    const clip = makeGroup([makeText("X", 0, 0), makeRect(0, 0, 50, 50, 0, 0, { fill: solid({ r: 255, g: 0, b: 0, a: 1 }) })]);
    clip.clip = true;
    const doc = makeDocument("C2", 100, 100);
    Ops.Items.addItem(doc, clip);
    const svg = IO.exportSVG(doc);
    expect(svg).not.toContain("<clipPath"); // text clip → no geometry → no clip
    expect(svg).toContain("<rect"); // content still present
  });
});

describe("ops.group clip + opacity mask", () => {
  it("makes and releases a clip group", () => {
    const doc = makeDocument("C", 100, 100);
    const a = makeRect(0, 0, 50, 50);
    const b = makeRect(10, 10, 30, 30);
    Ops.Items.addItem(doc, a);
    Ops.Items.addItem(doc, b);
    const gid = Ops.Group.makeClipGroup(doc, [a.id, b.id]);
    const g = Query.getItem(doc, gid!);
    expect(g?.type).toBe("group");
    expect(g!.type === "group" && g!.clip).toBe(true);
    expect(g!.type === "group" && g!.children.length).toBe(2);
    const released = Ops.Group.releaseClipGroup(doc, [gid!]);
    expect(released.length).toBe(2);
    expect(Query.getItem(doc, gid!)).toBeNull(); // group dissolved
  });

  it("makes and releases an opacity mask", () => {
    const doc = makeDocument("M", 100, 100);
    const target = makeRect(0, 0, 50, 50);
    const mask = makeEllipse(0, 0, 50, 50);
    Ops.Items.addItem(doc, target);
    Ops.Items.addItem(doc, mask); // mask on top
    const tid = Ops.Group.makeOpacityMask(doc, [target.id, mask.id]);
    expect(tid).toBe(target.id);
    expect(Query.getItem(doc, target.id)?.mask?.length).toBe(1);
    expect(Query.getItem(doc, mask.id)).toBeNull(); // mask left the layer
    const released = Ops.Group.releaseOpacityMask(doc, [target.id]);
    expect(released).toContain(mask.id);
    expect(Query.getItem(doc, target.id)?.mask).toBeUndefined();
    expect(Query.getItem(doc, mask.id)).not.toBeNull(); // restored to layer
  });

  it("opacity mask round-trips position for a target nested in a transformed group", () => {
    const doc = makeDocument("MN", 200, 200);
    const target = makeRect(0, 0, 50, 50);
    const mask = makeEllipse(0, 0, 50, 50);
    const g = makeGroup([target, mask]);
    g.transform = { a: 2, b: 0, c: 0, d: 2, e: 30, f: 40 }; // non-identity ancestor
    Ops.Items.addItem(doc, g);
    const before = Query.worldTransform(doc, mask.id);
    Ops.Group.makeOpacityMask(doc, [target.id, mask.id]);
    Ops.Group.releaseOpacityMask(doc, [target.id]);
    const after = Query.worldTransform(doc, mask.id);
    for (const k of ["a", "b", "c", "d", "e", "f"] as const) expect(approx(after[k], before[k])).toBe(true);
  });
});

describe("ops.items deep clone", () => {
  it("reassigns ids on mask content and pattern tile artwork", () => {
    const tileRect = makeRect(0, 0, 10, 10);
    const pat: Paint = { type: "pattern", pattern: { tile: [tileRect], width: 10, height: 10 } };
    const r = makeRect(0, 0, 50, 50, 0, 0, { fill: pat });
    const maskRect = makeRect(0, 0, 50, 50);
    r.mask = [maskRect];
    const clone = Ops.Items.cloneItemDeep(r);
    expect(clone.id).not.toBe(r.id);
    expect(clone.mask?.[0].id).not.toBe(maskRect.id);
    expect(clone.fill.type === "pattern" && clone.fill.pattern.tile[0].id !== tileRect.id).toBe(true);
  });
});
