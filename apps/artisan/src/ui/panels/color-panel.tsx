// ─────────────────────────────────────────────────────────────
// ui/panels/color-panel — Monet ColorPicker bound to fill/stroke
// ─────────────────────────────────────────────────────────────

import { useRef } from "react";
import { ColorPicker, type HSV } from "@monet-ui/monet-react";
import { Ops, solid, toHex } from "../../engine";
import { commands } from "../../commands";
import { useEditorState, useStore } from "../../state/store-context";
import { currentPaints } from "../paint-apply";
import { hsvToRgba } from "../color-convert";
import { paintBackground } from "../paint-css";

const accent = "var(--accent-vector)";

export function ColorPanel() {
  const store = useStore();
  const st = useEditorState();
  const dragging = useRef(false);
  const paints = currentPaints(store);
  const active = st.activePaint === "fill" ? paints.fill : paints.stroke;
  const value = active.type === "solid" ? toHex(active.color, true) : "#000000ff";
  const swatches = st.doc.swatches.filter((s) => s.type === "solid").map((s) => (s.type === "solid" ? toHex(s.color) : "#000"));

  const applyLive = (hsv: HSV) => {
    const paint = solid(hsvToRgba(hsv));
    if (!dragging.current) {
      store.beginTransaction("Color");
      dragging.current = true;
    }
    if (st.activePaint === "fill") store.setFill(paint);
    else store.setStroke({ ...store.getState().stroke, paint });
    const ids = store.selection;
    if (ids.length) {
      store.mutate((d) =>
        st.activePaint === "fill" ? Ops.Paint.applyFill(d, ids, paint) : Ops.Paint.applyStrokePaint(d, ids, paint),
      );
    }
  };
  const end = () => {
    if (dragging.current) {
      store.endTransaction();
      dragging.current = false;
    }
  };

  return (
    <div style={{ padding: 8 }}>
      <div className="monet-row" style={{ gap: 6, marginBottom: 10 }}>
        <button className={`artisan-swatch-btn ${st.activePaint === "fill" ? "is-active" : ""}`} style={paintBackground(paints.fill)} onClick={() => store.setActivePaint("fill")} title="Fill" />
        <span style={{ fontSize: 11, marginRight: 8 }}>Fill</span>
        <button className={`artisan-swatch-btn ${st.activePaint === "stroke" ? "is-active" : ""}`} style={paintBackground(paints.stroke)} onClick={() => store.setActivePaint("stroke")} title="Stroke" />
        <span style={{ fontSize: 11 }}>Stroke</span>
        <span style={{ flex: 1 }} />
        <button className="monet-iconbtn" data-fill-swap title="Swap Fill and Stroke (Shift+X)" onClick={() => commands.swapFillStroke(store)} style={{ width: 24, height: 22 }}>⇄</button>
        <button className="monet-iconbtn" data-fill-default title="Default Fill and Stroke (D)" onClick={() => commands.defaultFillStroke(store)} style={{ width: 24, height: 22 }}>◳</button>
        <button className="monet-iconbtn" data-fill-none title="None (/)" onClick={() => commands.noneFillStroke(store)} style={{ width: 24, height: 22 }}>⊘</button>
        <button className="monet-iconbtn" data-fill-complement title="Complement" onClick={() => commands.complementColor(store)} style={{ width: 24, height: 22 }}>◐</button>
        <button className="monet-iconbtn" data-fill-invert title="Invert" onClick={() => commands.invertColor(store)} style={{ width: 24, height: 22 }}>◑</button>
      </div>
      <ColorPicker value={value} onChange={applyLive} onChangeEnd={end} swatches={swatches} accent={accent} alpha />
    </div>
  );
}
