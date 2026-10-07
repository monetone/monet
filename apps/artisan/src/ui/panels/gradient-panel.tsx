// ─────────────────────────────────────────────────────────────
// ui/panels/gradient-panel — Monet GradientEditor bound to fill or stroke
// ─────────────────────────────────────────────────────────────

import { useRef, useState } from "react";
import { ColorPicker, GradientEditor, type GradientValue, type HSV, SegmentedControl } from "@monet-ui/monet-react";
import { Ops, linearGradient, type GradientSpread, type Paint, toHex } from "../../engine";
import { commands } from "../../commands";
import { useEditorState, useStore } from "../../state/store-context";
import { currentPaints } from "../paint-apply";
import { gradientToMonet, hsvToRgba, monetToGradient } from "../color-convert";

const accent = "var(--accent-vector)";
const DEFAULT = linearGradient();

export function GradientPanel() {
  const store = useStore();
  const st = useEditorState(); // subscribe so the panel repaints when fill/stroke/selection changes
  const dragging = useRef(false);
  // The gradient panel edits whichever paint is active (fill or stroke), like Illustrator.
  const target = st.activePaint;
  const current = target === "stroke" ? currentPaints(store).stroke : currentPaints(store).fill;
  const writePaint = (p: Paint) =>
    target === "stroke" ? store.setStroke({ ...store.getState().stroke, paint: p }) : store.setFill(p);
  const applyPaintOp = (d: Parameters<typeof Ops.Paint.applyFill>[0], ids: string[], p: Paint) =>
    target === "stroke" ? Ops.Paint.applyStrokePaint(d, ids, p) : Ops.Paint.applyFill(d, ids, p);
  const value: GradientValue = gradientToMonet(current.type === "gradient" ? current.gradient : (DEFAULT as Extract<typeof DEFAULT, { type: "gradient" }>).gradient);

  // Which stop the inline Color picker recolors. Falls back to the first stop
  // when the previously selected id no longer exists (stop added/removed).
  const [selectedStop, setSelectedStop] = useState<string | undefined>(undefined);
  const selId = value.stops.some((s) => s.id === selectedStop) ? selectedStop : value.stops[0]?.id;
  const selColor = (value.stops.find((s) => s.id === selId)?.color ?? "#000000ff") as string;

  const apply = (gv: GradientValue) => {
    // GradientValue carries the radial centre/radius/focal and spread now, so the
    // converters round-trip them; the panel no longer patches them back by hand.
    const paint = { type: "gradient" as const, gradient: monetToGradient(gv) };
    if (!dragging.current) {
      store.beginTransaction("Gradient");
      dragging.current = true;
    }
    writePaint(paint);
    const ids = store.selection;
    if (ids.length) store.mutate((d) => applyPaintOp(d, ids, paint));
  };
  const end = () => {
    if (dragging.current) {
      store.endTransaction();
      dragging.current = false;
    }
  };

  // Recolor the selected stop in place (preserving every offset + the others).
  const recolorStop = (hsv: HSV) => {
    if (!selId) return;
    const hex = toHex(hsvToRgba(hsv), true);
    apply({ ...value, stops: value.stops.map((s) => (s.id === selId ? { ...s, color: hex } : s)) });
  };

  const setSpread = (spread: GradientSpread) => {
    const base = current.type === "gradient" ? current.gradient : (DEFAULT as Extract<typeof DEFAULT, { type: "gradient" }>).gradient;
    const paint = { type: "gradient" as const, gradient: { ...base, spread } };
    writePaint(paint);
    const ids = store.selection;
    if (ids.length) store.transact("Gradient Spread", (d) => applyPaintOp(d, ids, paint));
  };

  return (
    <div style={{ padding: 8 }}>
      <div className="monet-row" style={{ gap: 4, marginBottom: 8 }}>
        {(["fill", "stroke"] as const).map((t) => (
          <button
            key={t}
            type="button"
            data-gradient-target={t}
            className={`monet-chip ${target === t ? "is-accent" : ""}`}
            style={{ textTransform: "capitalize", flex: 1 }}
            onClick={() => store.setActivePaint(t)}
          >
            {t}
          </button>
        ))}
      </div>
      <GradientEditor value={value} onChange={apply} onChangeEnd={end} selectedStop={selId} onSelectStop={setSelectedStop} accent={accent} />
      <div style={{ marginTop: 10 }}>
        <div style={{ fontSize: 10, color: "var(--text-3)", marginBottom: 4 }}>Stop Color</div>
        <ColorPicker value={selColor} onChange={recolorStop} onChangeEnd={end} accent={accent} alpha />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span style={{ fontSize: 10, color: "var(--text-3)" }}>Spread</span>
        <SegmentedControl
          size="sm"
          accent={accent}
          value={(current.type === "gradient" ? current.gradient.spread : undefined) ?? "pad"}
          items={[
            { value: "pad", label: "Pad" },
            { value: "reflect", label: "Reflect" },
            { value: "repeat", label: "Repeat" },
          ]}
          onChange={(v) => setSpread(v as GradientSpread)}
        />
        <button
          type="button"
          data-testid="gradient-reverse"
          title="Reverse the gradient"
          onClick={() => commands.reverseGradient(store)}
          style={{ marginLeft: "auto", fontSize: 11, padding: "3px 8px", cursor: "pointer", background: "var(--bg-2)", color: "var(--text-1)", border: "1px solid var(--border-1)", borderRadius: 4 }}
        >
          Reverse
        </button>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-3)", marginTop: 10, lineHeight: 1.5 }}>
        Drag with the <b>Gradient</b> tool on the canvas to set direction. Click a stop to select it, then recolor it above.
      </div>
    </div>
  );
}
