// ─────────────────────────────────────────────────────────────
// ui/panels/pathfinder-panel — Monet Pathfinder wired to the engine
// ─────────────────────────────────────────────────────────────
// Full Illustrator-parity panel: 4 shape-mode tiles + 6 pathfinder chips.

import { Pathfinder } from "@monet-ui/monet-react";
import { commands } from "../../commands";
import type { PathfinderOp } from "../../engine/ops/pathfinder";
import { useStore } from "../../state/store-context";

const accent = "var(--accent-vector)";

const MODE_TO_OP: Record<string, PathfinderOp> = {
  unite: "unite",
  minus: "minus-front",
  intersect: "intersect",
  exclude: "exclude",
};

export function PathfinderPanel() {
  const store = useStore();
  return (
    <div style={{ padding: 8 }}>
      <Pathfinder
        accent={accent}
        onMode={(v) => {
          if (v && MODE_TO_OP[v]) commands.pathfinder(store, MODE_TO_OP[v]);
        }}
        operations={[
          { value: "divide", label: "Divide" },
          { value: "trim", label: "Trim" },
          { value: "merge", label: "Merge" },
          { value: "crop", label: "Crop" },
          { value: "outline", label: "Outline" },
          { value: "minus-back", label: "Minus Back" },
        ]}
        operationsLabel="Pathfinders"
        onOperation={(v) => commands.pathfinder(store, v as PathfinderOp)}
      />
    </div>
  );
}
