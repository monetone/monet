// ─────────────────────────────────────────────────────────────
// transitions-panel.tsx — author scene-to-scene transitions (fade / slide /
// wipe / zoom) with a trigger (pointer, key, timer, manual). Exported as the
// mjTransition helper wired into the source scene's create().
// ─────────────────────────────────────────────────────────────

import { Button, Icon, I, Section } from "@monet-ui/monet-react";
import * as cmd from "../../commands";
import { useStore } from "../../state/app";
import type { Transition } from "../../model/types";
import { Row, SelectRow } from "../inspector-controls";

export function TransitionsPanel() {
  const project = useStore((s) => s.project);
  const scenes = project.scenes;
  const sceneOpts = scenes.map((s) => ({ value: s.id, label: s.name }));

  return (
    <div className="mj-col">
      <Section title="Transitions" defaultOpen actions={
        <button className="mj-tinybtn" disabled={scenes.length < 2} title="New transition"
          onClick={() => cmd.addTransition(scenes[0].id, scenes[1]?.id ?? scenes[0].id)}>
          <Icon d={I.plus} size={11} /> New
        </button>
      }>
        {scenes.length < 2 && <div className="mj-muted mj-pad">Add a second scene to create transitions between them.</div>}
        {project.transitions.length === 0 && scenes.length >= 2 && <div className="mj-muted mj-pad">No transitions yet.</div>}
        {project.transitions.map((tr) => (
          <TransitionEditor key={tr.id} tr={tr} sceneOpts={sceneOpts} />
        ))}
      </Section>
    </div>
  );
}

function TransitionEditor({ tr, sceneOpts }: { tr: Transition; sceneOpts: { value: string; label: string }[] }) {
  const u = (patch: Partial<Transition>) => cmd.updateTransition(tr.id, patch);
  return (
    <div style={{ borderTop: "0.5px solid var(--stroke-soft)", padding: "6px 0" }}>
      <SelectRow label="From" value={tr.fromSceneId} options={sceneOpts} onChange={(v) => u({ fromSceneId: v })} />
      <SelectRow label="To" value={tr.toSceneId} options={sceneOpts} onChange={(v) => u({ toSceneId: v })} />
      <SelectRow label="Effect" value={tr.kind} options={[
        { value: "fade", label: "Fade" },
        { value: "slide", label: "Slide" },
        { value: "wipe", label: "Wipe" },
        { value: "zoom", label: "Zoom" },
        { value: "none", label: "Cut" },
      ]} onChange={(v) => u({ kind: v as never })} />
      {(tr.kind === "slide" || tr.kind === "wipe") && (
        <SelectRow label="Direction" value={tr.direction} options={[
          { value: "left", label: "Left" }, { value: "right", label: "Right" }, { value: "up", label: "Up" }, { value: "down", label: "Down" },
        ]} onChange={(v) => u({ direction: v as never })} />
      )}
      <Row label="Duration">
        <input type="number" min={0} step={50} value={tr.duration} style={numStyle} onChange={(e) => u({ duration: Math.max(0, Number(e.target.value) || 0) })} />
        <span className="mj-muted">ms</span>
      </Row>
      <SelectRow label="Trigger" value={tr.trigger} options={[
        { value: "manual", label: "Manual (call)" },
        { value: "pointerdown", label: "On click" },
        { value: "key", label: "On key" },
        { value: "timer", label: "After delay" },
      ]} onChange={(v) => u({ trigger: v as never })} />
      {tr.trigger === "key" && (
        <Row label="Key">
          <input value={tr.triggerKey ?? "SPACE"} style={numStyle} onChange={(e) => u({ triggerKey: e.target.value.toUpperCase() })} />
        </Row>
      )}
      {tr.trigger === "timer" && (
        <Row label="Delay">
          <input type="number" min={0} step={100} value={tr.delay ?? 1000} style={numStyle} onChange={(e) => u({ delay: Math.max(0, Number(e.target.value) || 0) })} />
          <span className="mj-muted">ms</span>
        </Row>
      )}
      <div className="mj-row" style={{ paddingTop: 4 }}>
        <span className="mj-spacer" />
        <Button size="sm" variant="danger" onClick={() => cmd.removeTransition(tr.id)}>Delete</Button>
      </div>
    </div>
  );
}

const numStyle: React.CSSProperties = {
  width: 72,
  background: "var(--glass-1)",
  border: "0.5px solid var(--stroke-soft)",
  borderRadius: 4,
  color: "var(--text-1)",
  fontSize: 11.5,
  padding: "2px 5px",
};
