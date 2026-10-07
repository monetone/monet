// ─────────────────────────────────────────────────────────────
// ui/panels/color-guide-panel — Illustrator Color Guide (harmony rules)
// ─────────────────────────────────────────────────────────────

import { useState } from "react";
import { Select } from "@monet-ui/monet-react";
import { BLACK, HARMONY_RULES, type HarmonyRule, harmony, solid, toCSS, toHex } from "../../engine";
import { useEditorState, useStore } from "../../state/store-context";
import { applyPaintToActive, currentPaints } from "../paint-apply";

const LABELS: Record<HarmonyRule, string> = {
  complementary: "Complementary",
  analogous: "Analogous",
  triadic: "Triad",
  tetradic: "Tetrad",
  "split-complementary": "Split Complementary",
};

export function ColorGuidePanel() {
  const store = useStore();
  const st = useEditorState();
  const [rule, setRule] = useState<HarmonyRule>("complementary");

  // Base colour = the active paint's colour (Illustrator derives the guide from
  // the current base colour); falls back to black for non-solid paints.
  const paints = currentPaints(store);
  const active = st.activePaint === "fill" ? paints.fill : paints.stroke;
  const base = active.type === "solid" ? active.color : BLACK;
  const colors = harmony(base, rule);

  return (
    <div style={{ padding: 8 }}>
      <div className="monet-row" style={{ marginBottom: 8 }}>
        <span className="lbl">Harmony</span>
        <Select data-harmony-rule size="sm" value={rule} onChange={(v) => setRule(v as HarmonyRule)} options={HARMONY_RULES.map((rl) => ({ value: rl, label: LABELS[rl] }))} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${colors.length}, 1fr)`, gap: 4 }}>
        {colors.map((c, i) => (
          <button
            key={i}
            type="button"
            className="artisan-swatch-cell"
            data-harmony-swatch={i}
            title={toHex(c)}
            aria-label={`Apply ${toHex(c)}`}
            style={{ background: toCSS(c), height: 28, border: "1px solid var(--border-1)", borderRadius: 3, cursor: "pointer" }}
            onClick={() => applyPaintToActive(store, solid(c))}
          />
        ))}
      </div>
    </div>
  );
}
