// ─────────────────────────────────────────────────────────────
// tools/type — the Type (T) tool: click to place text, edit inline
// ─────────────────────────────────────────────────────────────
// Editing uses an HTML <textarea> positioned over the text's origin (via the
// tool HTML-overlay channel). The SVG text node is hidden while editing.

import type { CSSProperties } from "react";
import { Mat, Ops, Query, type TextWritingMode, makeText, paintedFill, toCSS } from "../engine";
import type { Tool, ToolContext } from "./types";

const ACCENT = "var(--accent-vector, #4a9eff)";

export interface TypeToolOptions {
  id?: string;
  /** Illustrator's Vertical Type tool: new text is created in a vertical
   *  writing mode. The model, renderer, Character panel and SVG I/O already
   *  carry `writingMode`; the tool just seeds it. */
  writingMode?: TextWritingMode;
}

export function createTypeTool(opts: TypeToolOptions = {}): Tool {
  /** The id this tool CREATED in the open transaction, if any. Only a text
   *  object that did not exist before may be rolled back for being empty —
   *  emptying one that did exist is a deliberate edit, not a stray click. */
  let createdId: string | null = null;

  const finish = (ctx: ToolContext) => {
    const store = ctx.store;
    const id = store.getState().editingTextId;
    if (id) {
      const loc = Query.findItem(store.doc, id);
      const empty = !loc || (loc.item.type === "text" && loc.item.text.trim() === "");
      // Discard a just-created object left empty; otherwise commit, so clearing
      // an existing text is an undoable edit rather than being silently undone.
      if (empty && id === createdId) store.cancelTransaction();
      else store.endTransaction();
    }
    createdId = null;
    store.setEditingText(undefined);
  };

  return {
    id: opts.id ?? "type",
    cursor: "text",

    // Create/edit on pointer-UP so the click's own mouseup can't blur (and thus
    // cancel) the freshly-focused inline editor.
    onPointerUp(p, ctx) {
      const store = ctx.store;
      if (store.getState().editingTextId) finish(ctx);

      const hit = Query.hitTest(store.doc, p.world, 4 / ctx.zoom);
      if (hit && hit.leaf.item.type === "text") {
        store.setSelection([hit.leaf.item.id]);
        store.beginTransaction("Edit Text");
        createdId = null; // editing something that already existed
        store.setEditingText(hit.leaf.item.id);
        return;
      }

      const st = store.getState();
      const item = makeText("", p.world.x, p.world.y, { fontSize: 48, ...(opts.writingMode ? { writingMode: opts.writingMode } : {}) });
      store.beginTransaction("Type");
      store.mutate((d) => {
        Ops.Items.insertNew(d, item, { layerId: st.activeLayerId, mode: st.drawingMode, insideTargetId: st.drawInsideTarget });
      });
      createdId = item.id;
      store.setSelection([item.id]);
      store.setEditingText(item.id);
    },

    // Selection's double-click hands over by setting editingTextId and switching
    // tool. The switch runs canvas-view's leaked-transaction guard, so a
    // transaction opened BEFORE the switch is cancelled out from under the edit —
    // open it here instead, once this tool is actually live.
    onActivate(ctx) {
      const store = ctx.store;
      if (store.getState().editingTextId && store.transactionBase === null) {
        store.beginTransaction("Edit Text");
        createdId = null;
      }
    },

    onDeactivate(ctx) {
      finish(ctx);
    },

    renderHtmlOverlay(ctx) {
      const store = ctx.store;
      const id = store.getState().editingTextId;
      if (!id) return null;
      const loc = Query.findItem(store.doc, id);
      if (!loc || loc.item.type !== "text") return null;
      const it = loc.item;
      const world = Query.worldTransformAt(loc);
      const fontPx = it.fontSize * ctx.zoom;
      const fill = paintedFill(it);
      const color = fill.type === "solid" ? toCSS(fill.color) : "#000";
      // Anchor the editor to match the on-canvas geometry: area type fills its
      // box from the top-left; type-on-path starts at the path's first point;
      // point type sits on its baseline (offset up by the cap height).
      let local = { x: 0, y: 0 };
      if (it.pathD) {
        const m = /[Mm]\s*(-?[\d.]+)[\s,]+(-?[\d.]+)/.exec(it.pathD);
        if (m) local = { x: parseFloat(m[1]), y: parseFloat(m[2]) };
      }
      const origin = ctx.worldToScreen(Mat.applyToPoint(world, local));
      // Mirror the renderer's advanced metrics so the editor is WYSIWYG. The
      // overlay is screen-space, so length offsets are × zoom; scale is unitless.
      const hScale = (it.horizontalScale ?? 100) / 100;
      const vScale = (it.verticalScale ?? 100) / 100;
      const shiftPx = (it.baselineShift ?? 0) * ctx.zoom;
      const xform = hScale !== 1 || vScale !== 1 ? `scale(${hScale}, ${vScale})` : undefined;
      const style: CSSProperties = {
        left: origin.x,
        fontFamily: it.fontFamily,
        fontSize: fontPx,
        fontWeight: it.fontWeight,
        fontStyle: it.fontStyle,
        fontKerning: it.kerning === "none" ? "none" : undefined,
        letterSpacing: it.letterSpacing ? it.letterSpacing * ctx.zoom : undefined,
        lineHeight: String(it.lineHeight),
        color,
        textAlign: it.align,
        outlineColor: ACCENT,
        transform: xform,
        transformOrigin: "left top",
        ...(it.boxWidth
          ? {
              // Lay out at box ÷ scale (× zoom) so the scaled editor matches the box.
              top: origin.y - shiftPx,
              width: (it.boxWidth / hScale) * ctx.zoom,
              height: ((it.boxHeight ?? 120) / vScale) * ctx.zoom,
              boxSizing: "border-box",
              paddingLeft: it.indentLeft ? it.indentLeft * ctx.zoom : undefined,
              paddingRight: it.indentRight ? it.indentRight * ctx.zoom : undefined,
              whiteSpace: "pre-wrap",
              overflow: "hidden",
            }
          : { top: origin.y - fontPx * 0.8 - shiftPx }),
      };

      return (
        <textarea
          key={id}
          className="artisan-text-edit"
          autoFocus
          value={it.text}
          spellCheck={false}
          style={style}
          onChange={(e) => {
            const v = e.target.value;
            store.mutate((d) => {
              const l = Query.findItem(d, id);
              if (l && l.item.type === "text") {
                l.item.text = v;
                // Editing flattens rich runs → single-run text so the canvas
                // reflects the edit (the renderer prefers runs over .text).
                l.item.runs = undefined;
                if (v.trim()) l.item.name = v.slice(0, 24);
              }
            });
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              finish(ctx);
              store.setTool("selection");
            }
          }}
          onBlur={() => finish(ctx)}
        />
      );
    },
  };
}
