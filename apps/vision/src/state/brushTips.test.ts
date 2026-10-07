// Unit tests for the Brushes-panel custom-tip helpers. Engine-free (node); the
// capture + paint path is covered by the Rust brush_tip_tests and e2e/define-brush.
import { describe, it, expect } from "vitest";
import {
  MAX_BRUSH_TIP_LIBRARY_BYTES,
  MAX_BRUSH_TIP_SIDE,
  MAX_BRUSH_TIPS,
  defaultBrushTipName,
  addBrushTipTo,
  removeBrushTipAt,
  activeAfterRemove,
  parseBrushTips,
  serializeBrushTips,
  type BrushTip,
} from "./brushTips";
import { decodeProjectEnvelope, encodeProjectEnvelope } from "./projectEnvelope";

const tip = (name: string): BrushTip => ({ name, w: 2, h: 2, alpha: new Uint8Array([0, 255, 255, 0]) });

describe("defaultBrushTipName", () => {
  it("starts at 'Tip 1' and counts one past the highest 'Tip N'", () => {
    expect(defaultBrushTipName([])).toBe("Tip 1");
    expect(defaultBrushTipName(["Tip 1", "Tip 3"])).toBe("Tip 4");
    expect(defaultBrushTipName(["Tip", "my Tip 2"])).toBe("Tip 1"); // non-matching ignored
  });
});

describe("addBrushTipTo", () => {
  const base: BrushTip[] = [tip("Tip 1")];

  it("appends a new-named tip", () => {
    const next = addBrushTipTo(base, tip("Tip 2"));
    expect(next).not.toBe(base);
    expect(next.map((t) => t.name)).toEqual(["Tip 1", "Tip 2"]);
  });

  it("is a same-ref no-op for a duplicate name", () => {
    expect(addBrushTipTo(base, tip("Tip 1"))).toBe(base);
  });

  it("accepts the exact tip-count cap and refuses the next append", () => {
    const almostFull = Array.from({ length: MAX_BRUSH_TIPS - 1 }, (_, i) => ({ name: `Tip ${i}`, w: 1, h: 1, alpha: new Uint8Array(1) }));
    const full = addBrushTipTo(almostFull, { name: "Last", w: 1, h: 1, alpha: new Uint8Array(1) });
    expect(full).toHaveLength(MAX_BRUSH_TIPS);
    expect(addBrushTipTo(full, { name: "Dropped", w: 1, h: 1, alpha: new Uint8Array(1) })).toBe(full);
  });

  it("accepts the exact byte budget and refuses aggregate overflow", () => {
    const alpha = new Uint8Array(1024 * 1024);
    const large = (name: string): BrushTip => ({
      name,
      w: 1024,
      h: 1024,
      alpha,
    });
    let list: BrushTip[] = [];
    for (let i = 0; i < 64; i++) list = addBrushTipTo(list, large(`Large ${i}`));
    expect(list.reduce((total, item) => total + item.alpha.length, 0)).toBe(MAX_BRUSH_TIP_LIBRARY_BYTES);
    expect(addBrushTipTo(list, { name: "Overflow", w: 1, h: 1, alpha: new Uint8Array(1) })).toBe(list);
  });

  it("refuses a tip the persistence validator cannot retain", () => {
    expect(addBrushTipTo([], {
      name: "Too wide",
      w: MAX_BRUSH_TIP_SIDE + 1,
      h: 1,
      alpha: new Uint8Array(MAX_BRUSH_TIP_SIDE + 1),
    })).toEqual([]);
    expect(addBrushTipTo([], { name: "Bad buffer", w: 2, h: 2, alpha: new Uint8Array(3) })).toEqual([]);
  });
});

describe("removeBrushTipAt", () => {
  const base: BrushTip[] = [tip("A"), tip("B")];

  it("removes the tip at the index", () => {
    expect(removeBrushTipAt(base, 0).map((t) => t.name)).toEqual(["B"]);
  });

  it("is a same-ref no-op out of range", () => {
    expect(removeBrushTipAt(base, 5)).toBe(base);
    expect(removeBrushTipAt(base, -1)).toBe(base);
  });
});

describe("activeAfterRemove", () => {
  it("reverts to the round brush when the active tip is removed", () => {
    expect(activeAfterRemove(1, 1)).toBe(-1);
  });
  it("shifts the active index down when a lower tip is removed", () => {
    expect(activeAfterRemove(2, 0)).toBe(1);
  });
  it("leaves the active index alone when a higher tip is removed", () => {
    expect(activeAfterRemove(0, 2)).toBe(0);
  });
  it("is unchanged for a no-op (negative) removal", () => {
    expect(activeAfterRemove(1, -1)).toBe(1);
  });
});

describe("brush-tip persistence", () => {
  it("round-trips a tip library through the localStorage JSON text", () => {
    const list = [tip("Tip 1"), { name: "Wide", w: 3, h: 1, alpha: new Uint8Array([1, 128, 255]) }];
    expect(parseBrushTips(JSON.stringify(serializeBrushTips(list)))).toEqual(list);
  });

  it("keeps an empty saved library distinct from a missing one", () => {
    expect(parseBrushTips("[]")).toEqual([]);
    expect(parseBrushTips(null)).toBeNull();
    expect(parseBrushTips("")).toBeNull();
    expect(parseBrushTips("not json")).toBeNull();
    expect(parseBrushTips('{"name":"x"}')).toBeNull(); // not an array
  });

  it("drops entries whose alpha does not match their dimensions", () => {
    const [ok] = serializeBrushTips([tip("Tip 1")]);
    expect(parseBrushTips([ok, { ...ok, name: "Bad", w: 3 }])).toEqual([tip("Tip 1")]);
    expect(parseBrushTips([{ ...ok, name: "" }])).toEqual([]);
    expect(parseBrushTips([{ ...ok, alpha: "not base64!!" }])).toEqual([]);
    expect(parseBrushTips([{ ...ok, w: 0 }, { ...ok, h: 1e9 }, { ...ok, w: 1.5 }])).toEqual([]);
  });

  it("also accepts the runtime shape, copying the alpha buffer", () => {
    const source = tip("Tip 1");
    const parsed = parseBrushTips([source]);
    expect(parsed).toEqual([source]);
    expect(parsed?.[0].alpha).not.toBe(source.alpha);
  });
});

describe("custom brush tips in .mvision", () => {
  const engine = new Uint8Array([1, 2, 3, 255]);

  it("travels with the project document", () => {
    const brushTips = [tip("Tip 1"), { name: "Wide", w: 3, h: 1, alpha: new Uint8Array([1, 128, 255]) }];
    const decoded = decodeProjectEnvelope(
      encodeProjectEnvelope(engine, [], { colorProfileAssigned: true, brushTips }),
    );
    expect(decoded?.document.brushTips).toEqual(brushTips);
  });

  it("stays absent when the document has no custom tips", () => {
    const decoded = decodeProjectEnvelope(encodeProjectEnvelope(engine, []));
    expect(decoded?.document).toEqual({ colorProfileAssigned: true });
  });
});
