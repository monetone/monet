// ─────────────────────────────────────────────────────────────
// tools/type-editor-overlay.test — inline editor matches text geometry
// ─────────────────────────────────────────────────────────────
// Reference: Adobe Illustrator — when you edit text, the cursor/box matches the
// object: area type edits inside its box (top-left, sized to the box), type-on-a-
// path edits from the path's start, point type sits on its baseline. We inspect
// the textarea the Type tool's HTML overlay returns. (worldToScreen is identity
// here, so screen coords equal world coords; zoom only scales sizes.)

import { describe, it, expect } from "vitest";
import type { ReactElement } from "react";
import { createTypeTool } from "./type";
import { ArtisanStore, makeDocument, makeText, Mat, noPaint, rgba, solid, type TextItem } from "../engine";
import type { ToolContext } from "./types";

const ctxOf = (store: ArtisanStore, zoom = 1): ToolContext =>
  ({ store, state: store.getState(), worldToScreen: (p) => p, screenToWorld: (p) => p, requestRender: () => {}, zoom, viewport: { width: 800, height: 600 } }) as ToolContext;

const overlayStyle = (store: ArtisanStore, zoom = 1): Record<string, number | string> => {
  const tool = createTypeTool();
  const el = tool.renderHtmlOverlay!(ctxOf(store, zoom)) as ReactElement<{ style: Record<string, number | string> }>;
  return el.props.style;
};

const setupEditing = (mutate: (t: TextItem) => void) => {
  const store = new ArtisanStore();
  const doc = makeDocument();
  const t = makeText("Edit", 0, 0, { fontSize: 20 });
  mutate(t);
  doc.layers[0].items.push(t);
  store.replaceDoc(doc, { markClean: true });
  store.setSelection([t.id]);
  store.beginTransaction("Edit Text");
  store.setEditingText(t.id);
  return { store, id: t.id };
};

describe("Type tool inline editor — geometry per text mode", () => {
  it("area-type editor is sized to the box and anchored at its top-left (no baseline offset)", () => {
    const { store } = setupEditing((t) => {
      t.transform = Mat.translation(50, 60);
      t.boxWidth = 200;
      t.boxHeight = 120;
    });
    const style = overlayStyle(store, 2);
    expect(style.left).toBe(50); // box origin x (identity worldToScreen)
    expect(style.top).toBe(60); // box top-left, NOT baseline-offset
    expect(style.width).toBe(400); // boxWidth 200 × zoom 2
    expect(style.height).toBe(240); // boxHeight 120 × zoom 2
    expect(style.whiteSpace).toBe("pre-wrap");
  });

  it("type-on-path editor anchors at the path's first point", () => {
    const { store } = setupEditing((t) => {
      t.pathD = "M30 40 L130 40";
    });
    const style = overlayStyle(store, 1);
    expect(style.left).toBe(30); // path start x
    expect(style.top).toBe(40 - 20 * 0.8); // path start y, minus point-type baseline offset (fontPx 20)
  });

  it("point-type editor sits on its baseline (offset above the origin)", () => {
    const { store } = setupEditing(() => {});
    const style = overlayStyle(store, 1);
    expect(style.left).toBe(0);
    expect(style.top).toBe(-20 * 0.8); // origin (0,0) minus baseline offset
    expect(style.width).toBeUndefined(); // point type isn't box-sized
  });

  it("reflects glyph scale, baseline shift and kerning so the editor is WYSIWYG", () => {
    const { store } = setupEditing((t) => {
      t.horizontalScale = 150;
      t.verticalScale = 50;
      t.baselineShift = 3;
      t.kerning = "none";
    });
    const style = overlayStyle(store, 2);
    expect(style.transform).toBe("scale(1.5, 0.5)");
    expect(style.fontKerning).toBe("none");
    // point text: top = 0 − fontPx(20×2=40)×0.8 − baselineShift(3×2=6) = −38
    expect(style.top).toBe(-38);
  });

  it("uses the top visible appearance fill for editor text", () => {
    const { store } = setupEditing((t) => {
      t.fill = noPaint();
      t.appearance = { entries: [
        { id: "hidden", kind: "fill", paint: solid(rgba(220, 0, 0)), visible: false },
        { id: "visible", kind: "fill", paint: solid(rgba(0, 0, 220)) },
      ] };
    });

    expect(overlayStyle(store).color).toBe("rgb(0,0,220)");
  });
});
