// ─────────────────────────────────────────────────────────────
// ui/panels/align-panel — Monet AlignBar wired to the align command
// ─────────────────────────────────────────────────────────────

import { useEffect, useState } from "react";
import { AlignBar, type AlignAction } from "@monet-ui/monet-react";
import { commands } from "../../commands";
import { useEditorState, useStore } from "../../state/store-context";
import { NumberField } from "../number-field";

const accent = "var(--accent-vector)";

export function AlignPanel() {
  const store = useStore();
  const state = useEditorState();
  const hasKey = !!state.keyObjectId;
  const [rel, setRel] = useState("selection");
  const [spacing, setSpacing] = useState(20); // Distribute Spacing gap value (pt)

  // Designating a key object auto-switches the target to "Align to Key Object";
  // clearing the key returns to "Align to Selection" (Illustrator parity).
  useEffect(() => {
    setRel((cur) => (hasKey ? "key-object" : cur === "key-object" ? "selection" : cur));
  }, [hasKey]);

  const relativeTo = rel === "artboard" ? "artboard" : rel === "key-object" ? "key-object" : "selection";

  // "Align to Key Object" is offered only while a key object is designated.
  const options = [
    { value: "selection", label: "Align to Selection" },
    { value: "artboard", label: "Align to Artboard" },
    ...(hasKey ? [{ value: "key-object", label: "Align to Key Object" }] : []),
  ];

  return (
    <div style={{ padding: 6 }}>
      <AlignBar
        accent={accent}
        onAlign={(a: AlignAction) => commands.align(store, a, relativeTo)}
        relativeTo={rel}
        onRelativeToChange={setRel}
        relativeToOptions={options}
      />
      {/* Distribute Spacing — lay objects out with an exact gap between them. */}
      <div className="monet-row" style={{ marginTop: 8, gap: 4, alignItems: "center" }}>
        <span className="lbl">Spacing</span>
        <label data-distribute-spacing>
          <NumberField value={spacing} onCommit={(v) => setSpacing(Math.max(0, v))} min={0} />
        </label>
        <button className="monet-chip" data-distribute-h title="Distribute horizontal spacing" onClick={() => commands.distributeSpacing(store, "h", spacing)}>
          H
        </button>
        <button className="monet-chip" data-distribute-v title="Distribute vertical spacing" onClick={() => commands.distributeSpacing(store, "v", spacing)}>
          V
        </button>
      </div>
    </div>
  );
}
