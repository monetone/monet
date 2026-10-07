// ─────────────────────────────────────────────────────────────
// code-panel.tsx — live preview of the Phaser 4 code generated from the project,
// with one-click copy + export. This is the "export to Phaser" surface.
// ─────────────────────────────────────────────────────────────

import { useMemo } from "react";
import { Button, I } from "@monet-ui/monet-react";
import { useStore } from "../../state/app";
import { exportGameJs } from "../../io/export-phaser";
import { exportHtml, exportJs } from "../../io/files";

export function CodePanel() {
  const project = useStore((s) => s.project);
  const code = useMemo(() => exportGameJs(project), [project]);

  return (
    <div className="mj-col">
      <div className="mj-row" style={{ gap: 6, padding: "6px 10px", borderBottom: "0.5px solid var(--stroke-soft)" }}>
        <Button size="sm" iconStart={I.crop} onClick={() => void exportHtml()}>Standalone HTML</Button>
        <Button size="sm" onClick={() => void exportJs()}>Game .js</Button>
        <span className="mj-spacer" />
        <Button size="sm" variant="ghost" onClick={() => void navigator.clipboard?.writeText(code)}>Copy</Button>
      </div>
      <div className="mj-fill">
        <pre className="mj-code">{code}</pre>
      </div>
    </div>
  );
}
