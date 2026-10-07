// ─────────────────────────────────────────────────────────────
// ui/options-bar — contextual top options strip
// ─────────────────────────────────────────────────────────────

import { OptionsBar } from "@monet-ui/monet-react";
import { TOOL_META } from "../tools/registry";
import { useEditorState, useStore } from "../state/store-context";
import { currentPaints } from "./paint-apply";
import { paintBackground } from "./paint-css";
import { NumberField } from "./number-field";

export function ArtisanOptionsBar() {
  const store = useStore();
  const st = useEditorState();
  const meta = TOOL_META.find((t) => t.id === st.tool);
  const paints = currentPaints(store);

  return (
    <OptionsBar>
      <OptionsBar.Group>
        <span style={{ fontSize: 11, color: "var(--text-2)", minWidth: 96 }}>{meta?.name ?? "Tool"}</span>
      </OptionsBar.Group>
      {st.tool === "magic-wand" && (
        <OptionsBar.Group>
          <span style={{ color: "var(--text-3)", fontSize: 10 }}>Match</span>
          <span className={`monet-chip ${st.magicWand.match === "fill" ? "is-accent" : ""}`} data-mw-match="fill" onClick={() => store.setMagicWand({ match: "fill" })}>Fill</span>
          <span className={`monet-chip ${st.magicWand.match === "stroke" ? "is-accent" : ""}`} data-mw-match="stroke" onClick={() => store.setMagicWand({ match: "stroke" })}>Stroke</span>
          <span style={{ color: "var(--text-3)", fontSize: 10, marginLeft: 6 }}>Tolerance</span>
          <span data-mw-tolerance>
            <NumberField value={st.magicWand.tolerance} onCommit={(v) => store.setMagicWand({ tolerance: Math.max(0, v) })} min={0} />
          </span>
        </OptionsBar.Group>
      )}
      <OptionsBar.Group>
        <span style={{ color: "var(--text-3)", fontSize: 10 }}>Fill</span>
        <button className={`artisan-swatch-btn ${st.activePaint === "fill" ? "is-active" : ""}`} style={paintBackground(paints.fill)} onClick={() => store.setActivePaint("fill")} title="Fill" />
        <span style={{ color: "var(--text-3)", fontSize: 10 }}>Stroke</span>
        <button className={`artisan-swatch-btn ${st.activePaint === "stroke" ? "is-active" : ""}`} style={paintBackground(paints.stroke)} onClick={() => store.setActivePaint("stroke")} title="Stroke" />
      </OptionsBar.Group>
      <div style={{ flex: 1 }} />
      <OptionsBar.Group>
        <span className={`monet-chip ${st.snap.enabled ? "is-accent" : ""}`} onClick={() => store.patchSnap({ enabled: !st.snap.enabled })}>Snap</span>
        <span className={`monet-chip ${st.grid.show ? "is-accent" : ""}`} onClick={() => store.patchGrid({ show: !st.grid.show })}>Grid</span>
        <span className={`monet-chip ${st.snap.toGrid ? "is-accent" : ""}`} onClick={() => store.patchSnap({ toGrid: !st.snap.toGrid })}>Snap Grid</span>
      </OptionsBar.Group>
    </OptionsBar>
  );
}
