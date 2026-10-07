// ─────────────────────────────────────────────────────────────
// ui/panels/stroke-panel — stroke width / cap / join / align / dash editing
// ─────────────────────────────────────────────────────────────

import { Icon, Select } from "@monet-ui/monet-react";
import { Ops, Query, paintedStroke, type Stroke } from "../../engine";
import { commands } from "../../commands";
import type { WidthProfilePreset } from "../../engine/ops/width-profile";
import { useEditorState, useStore } from "../../state/store-context";
import { NumberField } from "../number-field";
import { dashPattern } from "../stroke-dash";

const WIDTH_PROFILES: { v: WidthProfilePreset; label: string }[] = [
  { v: "uniform", label: "Uniform" },
  { v: "profile-1", label: "Width Profile 1" },
  { v: "profile-2", label: "Width Profile 2" },
  { v: "profile-3", label: "Width Profile 3" },
  { v: "profile-4", label: "Width Profile 4" },
  { v: "profile-5", label: "Width Profile 5" },
  { v: "profile-6", label: "Width Profile 6" },
];

const CAPS: { v: Stroke["cap"]; d: string }[] = [
  { v: "butt", d: "M5 3L5 13 M5 8L11 8" },
  { v: "round", d: "M5 4A4 4 0 0 0 5 12 M5 8L11 8" },
  { v: "square", d: "M3 4L7 4L7 12L3 12Z M5 8L11 8" },
];
const JOINS: { v: Stroke["join"]; d: string }[] = [
  { v: "miter", d: "M3 13L3 3L13 3" },
  { v: "round", d: "M3 13L3 7A4 4 0 0 1 7 3L13 3" },
  { v: "bevel", d: "M3 13L3 6L6 3L13 3" },
];
// Illustrator "Align Stroke": a box outline with the stroke band on the centre /
// inside / outside of its top edge.
const ALIGNS: { v: Stroke["align"]; d: string; title: string }[] = [
  { v: "center", d: "M3 6L13 6L13 12L3 12 M3 4L13 4", title: "Align Stroke to Center" },
  { v: "inside", d: "M3 4L13 4L13 12L3 12Z M3 6L13 6", title: "Align Stroke to Inside" },
  { v: "outside", d: "M3 6L13 6L13 12L3 12Z M3 4L13 4", title: "Align Stroke to Outside" },
];
const ARROWS: { value: NonNullable<Stroke["startArrow"]>; label: string }[] = [
  { value: "none", label: "None" },
  { value: "triangle", label: "Triangle" },
  { value: "circle", label: "Circle" },
  { value: "square", label: "Square" },
  { value: "bar", label: "Bar" },
];

export function StrokePanel() {
  const store = useStore();
  const st = useEditorState();
  const single = st.selection.length === 1 ? Query.getItem(st.doc, st.selection[0]) : null;
  const stroke = single && single.type !== "group" ? paintedStroke(single) : st.stroke;

  const patch = (p: Partial<Stroke>) => {
    store.setStroke({ ...store.getState().stroke, ...p });
    const ids = st.selection;
    if (ids.length) store.transact("Stroke", (d) => Ops.Paint.applyStroke(d, ids, p));
  };

  const dashed = stroke.dash.length > 0;
  const hasProfile = !!stroke.widthProfile && stroke.widthProfile.some((w) => w !== 1);

  return (
    <div style={{ padding: 8 }}>
      <div className="monet-row" style={{ marginBottom: 8 }}>
        <span className="lbl">Weight</span>
        <NumberField value={stroke.width} onCommit={(v) => patch({ width: v })} min={0} />
        <span className="val" style={{ marginLeft: 4 }}>pt</span>
      </div>

      <div className="monet-section-label">Cap</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {CAPS.map((c) => (
          <div key={c.v} className={`monet-iconbtn ${stroke.cap === c.v ? "is-active" : ""}`} style={{ width: 34, height: 28 }} onClick={() => patch({ cap: c.v })} title={c.v} data-stroke-cap={c.v}>
            <Icon d={c.d} size={16} />
          </div>
        ))}
      </div>

      <div className="monet-section-label">Corner</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8, alignItems: "center" }}>
        {JOINS.map((j) => (
          <div key={j.v} className={`monet-iconbtn ${stroke.join === j.v ? "is-active" : ""}`} style={{ width: 34, height: 28 }} onClick={() => patch({ join: j.v })} title={j.v} data-stroke-join={j.v}>
            <Icon d={j.d} size={16} />
          </div>
        ))}
        <span style={{ display: "flex", alignItems: "center", gap: 4, marginLeft: 8 }} data-stroke-miter>
          <span className="lbl">Limit</span>
          <NumberField value={stroke.miterLimit} onCommit={(v) => patch({ miterLimit: v })} min={1} disabled={stroke.join !== "miter"} />
          <span className="val">x</span>
        </span>
      </div>

      <div className="monet-section-label">Align Stroke</div>
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {ALIGNS.map((a) => (
          <div
            key={a.v}
            className={`monet-iconbtn ${stroke.align === a.v ? "is-active" : ""}`}
            style={{ width: 34, height: 28 }}
            onClick={() => patch({ align: a.v })}
            title={a.title}
            data-stroke-align={a.v}
          >
            <Icon d={a.d} size={16} />
          </div>
        ))}
      </div>

      <div className="monet-section-label">Arrowheads</div>
      <div className="monet-row" style={{ gap: 6, marginBottom: 8 }}>
        <span className="lbl">Start</span>
        <Select size="sm" data-arrow-start value={stroke.startArrow ?? "none"} onChange={(v) => patch({ startArrow: v as Stroke["startArrow"] })} options={ARROWS} />
        <span className="lbl">End</span>
        <Select size="sm" data-arrow-end value={stroke.endArrow ?? "none"} onChange={(v) => patch({ endArrow: v as Stroke["endArrow"] })} options={ARROWS} />
      </div>

      <div className="monet-row" style={{ marginTop: 6 }}>
        <span className="lbl">Dashed</span>
        <span className={`monet-chip ${dashed ? "is-accent" : ""}`} onClick={() => patch({ dash: dashed ? [] : [6, 4] })} data-stroke-dash={dashed ? "on" : "off"}>
          {dashed ? "On" : "Off"}
        </span>
        {dashed &&
          (() => {
            const d1 = stroke.dash[0] ?? 6;
            const g1 = stroke.dash[1] ?? 4;
            const d2 = stroke.dash[2] ?? 0;
            const g2 = stroke.dash[3] ?? 0;
            return (
              <>
                <label data-dash-field="dash1"><NumberField value={d1} onCommit={(v) => patch({ dash: dashPattern(v, g1, d2, g2) })} min={0} /></label>
                <label data-dash-field="gap1"><NumberField value={g1} onCommit={(v) => patch({ dash: dashPattern(d1, v, d2, g2) })} min={0} /></label>
                <label data-dash-field="dash2"><NumberField value={d2} onCommit={(v) => patch({ dash: dashPattern(d1, g1, v, g2) })} min={0} /></label>
                <label data-dash-field="gap2"><NumberField value={g2} onCommit={(v) => patch({ dash: dashPattern(d1, g1, d2, v) })} min={0} /></label>
              </>
            );
          })()}
      </div>

      <div className="monet-row" style={{ marginTop: 6 }}>
        <span className="lbl">Profile</span>
        <Select
          size="sm"
          data-stroke-profile
          value={hasProfile ? "custom" : "uniform"}
          onChange={(v) => commands.applyWidthProfile(store, v as WidthProfilePreset)}
          // "custom" is not a listed option: the trigger shows the placeholder
          // only when a non-preset (or applied) profile is active
          placeholder="Custom"
          options={WIDTH_PROFILES.map((p) => ({ value: p.v, label: p.label }))}
        />
      </div>
    </div>
  );
}
