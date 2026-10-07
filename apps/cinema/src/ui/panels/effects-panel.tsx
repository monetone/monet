// Effects browser: video effects (added to the selected clip's stack) and
// transitions (applied to the selected clip edges).

import * as cmd from "../../commands";
import { useStore } from "../../state/app";
import type { TransitionKind } from "../../timeline/model/types";

const VIDEO_EFFECTS: Array<{ type: string; name: string }> = [
  { type: "lumetri", name: "Lumetri Color" },
  { type: "gaussian-blur", name: "Gaussian Blur" },
  { type: "crop", name: "Crop" },
  { type: "mosaic", name: "Mosaic" },
  { type: "ultra-key", name: "Ultra Key" },
  { type: "warp-stabilize", name: "Warp Stabilizer" },
  { type: "transform", name: "Transform" },
];

const TRANSITIONS: Array<{ kind: TransitionKind; name: string }> = [
  { kind: "cross-dissolve", name: "Cross Dissolve" },
  { kind: "dip-to-black", name: "Dip to Black" },
  { kind: "dip-to-white", name: "Dip to White" },
  { kind: "wipe", name: "Wipe" },
  { kind: "push", name: "Push" },
  { kind: "slide", name: "Slide" },
  { kind: "iris", name: "Iris" },
];

export function EffectsPanel() {
  const hasSel = useStore((s) => s.selection.length > 0);

  const row = (label: string, onClick: () => void) => (
    <div
      key={label}
      className="monet-row"
      style={{ height: 24, cursor: hasSel ? "pointer" : "default", opacity: hasSel ? 1 : 0.5 }}
      onDoubleClick={() => hasSel && onClick()}
      title={hasSel ? "Double-click to apply" : "Select a clip first"}
    >
      <span style={{ flex: 1, fontSize: 11 }}>{label}</span>
    </div>
  );

  return (
    <div>
      <div className="monet-section-label">Video Effects</div>
      {VIDEO_EFFECTS.map((e) => row(e.name, () => cmd.addEffectToSelected(e.type, e.name)))}
      <div className="monet-section-label" style={{ marginTop: 14 }}>Transitions</div>
      {TRANSITIONS.map((t) => row(t.name, () => cmd.addTransitionToSelected(t.kind)))}
    </div>
  );
}
