// ─────────────────────────────────────────────────────────────
// ops/doc-info.test — Query.documentInfo (Document Info panel data)
// ─────────────────────────────────────────────────────────────
// Reference: Illustrator's Window ▸ Document Info reports facts about the document
// — object counts, fonts in use, artboard size, etc. documentInfo derives a
// read-only summary from the document + current selection (recursing into groups).

import { describe, it, expect } from "vitest";
import { makeDocument, makeRect, makePath, makeText, makeGroup, makeAnchor as anchor, Query, solid, rgba } from "../index";

const seg = () => ({ closed: false, anchors: [anchor({ x: 0, y: 0 }), anchor({ x: 10, y: 10 })] });

const setup = () => {
  const doc = makeDocument("Test Doc", 800, 600);
  const r1 = makeRect(0, 0, 40, 40, 0, 0, { fill: solid(rgba(220, 0, 0)) });
  const r2 = makeRect(60, 0, 40, 40, 0, 0, { fill: solid(rgba(0, 0, 220)) });
  const innerPath = makePath(seg());
  const innerText = makeText("Hello", 0, 0, { fontFamily: "Futura" });
  const group = makeGroup([innerPath, innerText]);
  const topText = makeText("World", 0, 80, { fontFamily: "Georgia" });
  const topText2 = makeText("Again", 0, 120, { fontFamily: "Futura" }); // duplicate font
  doc.layers[0].items.push(r1, r2, group, topText, topText2);
  return { doc, ids: [r1.id, r2.id] };
};

describe("Query.documentInfo", () => {
  it("counts objects recursively and by type", () => {
    const { doc } = setup();
    const info = Query.documentInfo(doc, []);
    // r1, r2, group, group's path + text, topText, topText2 = 7 items total (recursive)
    expect(info.objects).toBe(7);
    expect(info.byType.rect).toBe(2);
    expect(info.byType.group).toBe(1);
    expect(info.byType.path).toBe(1);
    expect(info.byType.text).toBe(3); // innerText + topText + topText2
  });

  it("collects a deduped, sorted list of fonts used by text", () => {
    const { doc } = setup();
    const info = Query.documentInfo(doc, []);
    expect(info.fonts).toEqual(["Futura", "Georgia"]); // deduped (Futura twice) + sorted
  });

  it("reports document meta, artboard, layer/swatch counts, and selection size", () => {
    const { doc, ids } = setup();
    const info = Query.documentInfo(doc, ids);
    expect(info.name).toBe("Test Doc");
    expect(info.colorMode).toBe("RGB");
    expect(info.artboards).toBe(1);
    expect(info.activeArtboard).toEqual({ name: "Artboard 1", width: 800, height: 600 });
    expect(info.layers).toBe(1);
    expect(info.swatches).toBeGreaterThan(0); // default swatches
    expect(info.graphicStyles).toBe(0);
    expect(info.selected).toBe(2);
  });

  it("handles an empty document", () => {
    const doc = makeDocument();
    const info = Query.documentInfo(doc, []);
    expect(info.objects).toBe(0);
    expect(info.byType).toEqual({});
    expect(info.fonts).toEqual([]);
    expect(info.selected).toBe(0);
  });
});
