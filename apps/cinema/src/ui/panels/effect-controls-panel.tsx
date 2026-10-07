// Effect Controls: Motion / Opacity for the selected clip, plus its applied
// effect stack. Edits route through cmd.editClip (undoable).

import * as cmd from "../../commands";
import { useStore } from "../../state/app";
import { activeSequence, findClip } from "../../timeline/model/query";
import type { Clip } from "../../timeline/model/types";
import { SectionLabel, SliderRow } from "../inspector-controls";

export function EffectControlsPanel() {
  const project = useStore((s) => s.project);
  const selection = useStore((s) => s.selection);

  const seq = activeSequence(project);
  const id = selection[selection.length - 1];
  const clip = seq && id ? findClip(seq, id)?.clip : null;

  if (!clip || !seq) {
    return <div style={{ padding: 14, color: "var(--text-3)", fontSize: 11 }}>Select a clip to edit its effects.</div>;
  }

  const t = clip.transform;
  const edit = (label: string, fn: (c: Clip) => void) => cmd.editClip(clip.id, label, fn);

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8 }}>
        <span style={{ width: 16, height: 10, borderRadius: 1, background: "var(--accent-motion)" }} />
        <span style={{ fontSize: 11 }}>{clip.name}</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 10, color: "var(--text-3)" }}>{clip.duration}f</span>
      </div>

      <SectionLabel>Motion</SectionLabel>
      <SliderRow label="Position X" value={t.x} min={-seq.width} max={seq.width} onChange={(v) => edit("Position", (c) => (c.transform.x = Math.round(v)))} />
      <SliderRow label="Position Y" value={t.y} min={-seq.height} max={seq.height} onChange={(v) => edit("Position", (c) => (c.transform.y = Math.round(v)))} />
      <SliderRow label="Scale" value={t.scaleX} min={0} max={400} onChange={(v) => edit("Scale", (c) => { c.transform.scaleX = c.transform.scaleY = c.transform.scale = Math.round(v); })} fmt={(v) => `${v.toFixed(0)}%`} />
      <SliderRow label="Rotation" value={t.rotation} min={-180} max={180} onChange={(v) => edit("Rotation", (c) => (c.transform.rotation = Math.round(v)))} fmt={(v) => `${v.toFixed(0)}°`} />

      <SectionLabel>Opacity</SectionLabel>
      <SliderRow label="Opacity" value={t.opacity} min={0} max={100} onChange={(v) => edit("Opacity", (c) => (c.transform.opacity = Math.round(v)))} fmt={(v) => `${v.toFixed(0)}%`} />

      <SectionLabel>Crop</SectionLabel>
      <SliderRow label="Left" value={t.cropL * 100} min={0} max={100} onChange={(v) => edit("Crop", (c) => (c.transform.cropL = v / 100))} fmt={(v) => `${v.toFixed(0)}%`} />
      <SliderRow label="Right" value={t.cropR * 100} min={0} max={100} onChange={(v) => edit("Crop", (c) => (c.transform.cropR = v / 100))} fmt={(v) => `${v.toFixed(0)}%`} />

      {clip.effects.length > 0 && <SectionLabel>Effects</SectionLabel>}
      {clip.effects.map((fx) => (
        <div key={fx.id} className="monet-row" style={{ height: 24 }}>
          <span
            className="monet-iconbtn"
            style={{ width: 14, color: fx.enabled ? "var(--accent-motion)" : "var(--text-3)" }}
            onClick={() => cmd.editClip(clip.id, "Toggle Effect", (c) => { const e = c.effects.find((x) => x.id === fx.id); if (e) e.enabled = !e.enabled; })}
          >
            ●
          </span>
          <span style={{ flex: 1, fontSize: 11 }}>{fx.name}</span>
          <span
            className="monet-iconbtn"
            style={{ width: 14, color: "var(--text-3)" }}
            onClick={() => cmd.editClip(clip.id, "Remove Effect", (c) => { c.effects = c.effects.filter((x) => x.id !== fx.id); })}
          >
            ×
          </span>
        </div>
      ))}
    </div>
  );
}
