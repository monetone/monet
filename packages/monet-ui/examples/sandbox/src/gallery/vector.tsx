// Creative · Vector gallery demos — the Illustrator-style vector tool groups
// (Pathfinder shape-mode tiles + compound-path ops, and the align/distribute
// AlignBar). Both are controlled, so each demo wraps them in local useState so
// the aria-pressed toggles + "align to" Select actually respond in the panel.
import { useState } from "react";
import {
  Pathfinder,
  AlignBar,
  type AlignAction,
} from "@monet-ui/monet-react";
import type { GalleryEntry } from "./types";

// ─── Pathfinder ────────────────────────────────────────────────
// Single-select shape modes (controlled via activeMode → onMode; re-pressing
// the active tile clears to null) over momentary operation chips. We track the
// last fired operation just to show the momentary callbacks landing.
function PathfinderDemo() {
  const [mode, setMode] = useState<string | null>("unite");
  const [lastOp, setLastOp] = useState<string | null>(null);
  return (
    <div style={{ display: "grid", gap: 8, padding: 8 }}>
      <Pathfinder
        activeMode={mode}
        onMode={setMode}
        onOperation={setLastOp}
        accent="var(--accent-vector, #d6884a)"
        aria-label="Pathfinder"
      />
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        mode: {mode ?? "none"}
        {lastOp ? ` · op: ${lastOp}` : ""}
      </div>
    </div>
  );
}

// ─── AlignBar ──────────────────────────────────────────────────
// role="toolbar" with a roving tabindex (Arrow/Home/End move focus). align is
// momentary, but we hold the last-fired action in `active` so a click visibly
// becomes the pressed / tab-stop button; the "align to" Select is controlled
// via relativeTo + onRelativeToChange.
function AlignBarDemo() {
  const [active, setActive] = useState<AlignAction>("center-h");
  const [target, setTarget] = useState("selection");
  return (
    <div style={{ display: "grid", gap: 8, padding: 8 }}>
      <AlignBar
        active={active}
        onAlign={setActive}
        relativeTo={target}
        onRelativeToChange={setTarget}
        accent="var(--accent-vector, #d6884a)"
        aria-label="Align"
      />
      <div style={{ fontSize: 11, opacity: 0.7 }}>
        active: {active} · to: {target}
      </div>
    </div>
  );
}

export const vectorEntries: GalleryEntry[] = [
  {
    id: "vector/Pathfinder",
    label: "Pathfinder",
    category: "Vector",
    section: "Creative",
    render: () => <PathfinderDemo />,
  },
  {
    id: "vector/AlignBar",
    label: "AlignBar",
    category: "Vector",
    section: "Creative",
    render: () => <AlignBarDemo />,
  },
];
