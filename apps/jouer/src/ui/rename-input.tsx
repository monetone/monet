// ─────────────────────────────────────────────────────────────
// rename-input.tsx — the shared in-place rename field (Unity F2 / double-click
// inline rename), used by the hierarchy object rows, the scene list and the
// asset list. One commit path (commit on Enter or blur — the multi-edit lesson),
// guarded so it fires once; Escape exits without renaming. Stops propagation so
// editing never selects the row or triggers global shortcuts.
// ─────────────────────────────────────────────────────────────

import { useRef, useState } from "react";

export function RenameInput({ initial, onCommit, onExit, testid }: { initial: string; onCommit: (name: string) => void; onExit: () => void; testid: string }) {
  const [draft, setDraft] = useState(initial);
  const done = useRef(false);
  const finish = (save: boolean) => {
    if (done.current) return;
    done.current = true;
    const name = draft.trim();
    if (save && name) onCommit(name);
    onExit();
  };
  return (
    <input
      className="mj-item-name"
      data-testid={testid}
      autoFocus
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      style={{ flex: 1, minWidth: 0, font: "inherit", background: "var(--glass-1)", color: "inherit", border: "1px solid var(--accent)", borderRadius: 3, padding: "0 4px" }}
    />
  );
}
