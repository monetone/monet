// ─────────────────────────────────────────────────────────────
// engine/json-roundtrip.test — .artisan save/load is LOSSLESS
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator's native .ai save/open preserves the full
// artwork. The .artisan format (JSON) must round-trip a feature-rich document —
// gradients, patterns, effects, masks, clip groups, text runs, compound paths,
// multiple layers/artboards, swatches — with zero loss.

import { describe, it, expect } from "vitest";
import {
  IO,
  makeDocument, makeLayer, makeArtboard, makeRect, makeEllipse, makePath, makeAnchor, makeText, makeGroup, makeCompound,
  solid, rgba, linearGradient, pattern, defaultStroke, BLACK,
} from "./index";

const richDoc = () => {
  const doc = makeDocument("Rich Doc");
  doc.layers.push(makeLayer("Layer 2"));
  doc.artboards.push(makeArtboard("Artboard 2", 600, 0, 400, 300));

  // rounded rect: opacity, blend mode, dashed/aligned stroke, drop-shadow effect
  const rect = makeRect(10, 20, 100, 80, 12, 12, {
    fill: solid(rgba(220, 30, 40)),
    stroke: { ...defaultStroke(solid(BLACK)), width: 3, cap: "round", join: "bevel", dash: [6, 4], dashOffset: 2, miterLimit: 8, align: "inside" },
  });
  rect.opacity = 0.5;
  rect.blendMode = "multiply";
  rect.effects = [{ type: "drop-shadow", dx: 6, dy: 6, blur: 6, color: rgba(0, 0, 0, 0.5) }];

  // ellipse: linear gradient fill with a spread
  const ell = makeEllipse(150, 20, 80, 60, { fill: linearGradient() });
  if (ell.fill.type === "gradient") ell.fill.gradient.spread = "reflect";

  // path with bezier handles + a glow effect
  const path = makePath(
    { closed: false, anchors: [makeAnchor({ x: 0, y: 0 }, { x: -5, y: -3 }, { x: 5, y: 3 }), makeAnchor({ x: 50, y: 40 }, { x: -4, y: 0 }, { x: 4, y: 0 })] },
    { fill: { type: "none" }, stroke: defaultStroke(solid(rgba(10, 20, 30))) },
  );
  path.effects = [{ type: "glow", blur: 8, color: rgba(255, 255, 0, 0.9) }];

  // text with rich runs
  const txt = makeText("Hi", 5, 200, { fontSize: 32, align: "center" });
  txt.runs = [{ text: "H", fill: solid(rgba(255, 0, 0)) }, { text: "i", dx: 2, fontWeight: 700 }];

  // clip group carrying an opacity mask
  const clipShape = makeEllipse(300, 20, 60, 60, { fill: solid(rgba(255, 255, 255)) });
  const child = makeRect(300, 20, 60, 60, 0, 0, { fill: solid(rgba(0, 120, 220)) });
  const grp = makeGroup([clipShape, child]);
  grp.clip = true;
  grp.mask = [makeRect(300, 20, 60, 60, 0, 0, { fill: solid(rgba(128, 128, 128)) })];

  doc.layers[0].items.push(rect, ell, path, txt, grp);

  // even-odd compound path on layer 2
  const comp = makeCompound(
    [
      { closed: true, anchors: [makeAnchor({ x: 0, y: 0 }), makeAnchor({ x: 40, y: 0 }), makeAnchor({ x: 40, y: 40 }), makeAnchor({ x: 0, y: 40 })] },
      { closed: true, anchors: [makeAnchor({ x: 10, y: 10 }), makeAnchor({ x: 30, y: 10 }), makeAnchor({ x: 30, y: 30 }), makeAnchor({ x: 10, y: 30 })] },
    ],
    { fill: solid(rgba(80, 80, 80)) },
  );
  comp.evenOdd = true;
  doc.layers[1].items.push(comp);

  // swatches: solid + gradient + pattern
  doc.swatches.push(solid(rgba(12, 34, 56)), linearGradient(), pattern([makeRect(0, 0, 8, 8, 0, 0, { fill: solid(rgba(200, 50, 50)) })], 8, 8));

  return doc;
};

describe(".artisan document round-trip", () => {
  it("losslessly round-trips a feature-rich document", () => {
    const doc = richDoc();
    const text = IO.serializeDocument(doc);
    const back = IO.deserializeDocument(text);
    // re-serializing the reloaded doc reproduces the exact bytes → zero loss
    expect(IO.serializeDocument(back)).toBe(text);
    // structure preserved
    expect(back.name).toBe("Rich Doc");
    expect(back.layers).toHaveLength(2);
    expect(back.artboards).toHaveLength(2);
    expect(back.swatches).toHaveLength(doc.swatches.length); // defaults + 3 added
  });

  it("preserves the rich per-item attributes", () => {
    const back = IO.deserializeDocument(IO.serializeDocument(richDoc()));
    const items = back.layers[0].items;
    const rect = items[0] as Extract<(typeof items)[number], { type: "rect" }>;
    expect(rect.opacity).toBe(0.5);
    expect(rect.blendMode).toBe("multiply");
    expect(rect.effects?.[0]).toEqual({ type: "drop-shadow", dx: 6, dy: 6, blur: 6, color: rgba(0, 0, 0, 0.5) });
    const ell = items[1];
    expect(ell.fill.type === "gradient" && ell.fill.gradient.spread).toBe("reflect");
    const txt = items[3] as Extract<(typeof items)[number], { type: "text" }>;
    expect(txt.runs).toHaveLength(2);
    const grp = items[4] as Extract<(typeof items)[number], { type: "group" }>;
    expect(grp.clip).toBe(true);
    expect(grp.mask).toHaveLength(1);
    const comp = back.layers[1].items[0] as Extract<(typeof items)[number], { type: "compound" }>;
    expect(comp.evenOdd).toBe(true);
    expect(comp.subpaths).toHaveLength(2);
  });

  it("writes the format/version header", () => {
    const data = JSON.parse(IO.serializeDocument(makeDocument("X")));
    expect(data.format).toBe(IO.ARTISAN_FORMAT);
    expect(data.version).toBe(IO.ARTISAN_VERSION);
    expect(data.document).toBeDefined();
  });

  it("tolerates a bare document object (no wrapper)", () => {
    const doc = richDoc();
    const bare = IO.deserializeDocument(JSON.stringify(doc));
    expect(bare.layers).toHaveLength(2);
    expect(bare.artboards).toHaveLength(2);
  });

  it("round-trips identically whether serialized pretty or compact", () => {
    const doc = richDoc();
    const compact = IO.serializeDocument(doc);
    const fromPretty = IO.serializeDocument(IO.deserializeDocument(IO.serializeDocument(doc, true)));
    expect(fromPretty).toBe(compact);
  });

  it("rejects input that is not an Artisan document", () => {
    expect(() => IO.deserializeDocument("null")).toThrow();
    expect(() => IO.deserializeDocument('"hello"')).toThrow();
    expect(() => IO.deserializeDocument('{"format":"something-else"}')).toThrow();
  });
});
