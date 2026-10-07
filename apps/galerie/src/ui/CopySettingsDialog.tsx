// CopySettingsDialog — Lightroom "Copy Settings" / "Synchronize Settings": pick
// which develop panels to take from the active photo. All checked means the
// whole recipe (masks + crop included); a subset means only those panels, merged
// over each target's own recipe (the store's scoped path) instead of clobbering
// it. `mode="copy"` fills the Copy/Paste clipboard (⇧⌘V applies it later);
// `mode="sync"` pushes straight to the rest of the selection, as LR's Develop
// Sync… button does. Built on the shared monet-react Dialog + Checkbox.

import { Button, Checkbox, Dialog } from "@monet-ui/monet-react";
import { useState } from "react";

import { store } from "../state/store";

const PANELS: { key: string; label: string }[] = [
  { key: "basic", label: "Basic" },
  { key: "toneCurve", label: "Tone Curve" },
  { key: "colorMixer", label: "Color Mixer" },
  { key: "colorGrading", label: "Color Grading" },
  { key: "detail", label: "Detail" },
  { key: "optics", label: "Optics" },
  { key: "transform", label: "Transform" },
  { key: "effects", label: "Effects" },
  { key: "pointColor", label: "Point Color" },
  { key: "calibration", label: "Calibration" },
  { key: "crop", label: "Crop" },
  { key: "heal", label: "Heal" },
  { key: "masks", label: "Masks" },
];

/** The checked panels as a store scope: null when everything is checked (the
 *  whole-recipe fast path), otherwise the panel keys in PANELS order. */
export function panelScope(checked: ReadonlySet<string>): string[] | null {
  return checked.size === PANELS.length ? null : PANELS.filter((p) => checked.has(p.key)).map((p) => p.key);
}

export function CopySettingsDialog({
  photoId,
  mode = "copy",
  onClose,
}: {
  photoId: number;
  /** "copy" fills the clipboard; "sync" pushes to the rest of the selection now. */
  mode?: "copy" | "sync";
  onClose: () => void;
}) {
  const [checked, setChecked] = useState<Set<string>>(() => new Set(PANELS.map((p) => p.key)));

  const toggle = (k: string) =>
    setChecked((s) => {
      const next = new Set(s);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  const setAll = (on: boolean) => setChecked(on ? new Set(PANELS.map((p) => p.key)) : new Set());

  const apply = () => {
    const scope = panelScope(checked);
    if (mode === "sync") {
      // The scope sticks on the store, so Auto Sync mirrors the same panels.
      void store.syncDevelop(photoId, store.getState().selection, { scope });
      onClose();
      return;
    }
    void store.copyDevelop(photoId, scope);
    store.notify(
      scope
        ? `Copied ${scope.length} panel${scope.length === 1 ? "" : "s"} — Paste (⇧⌘V) to apply.`
        : "Copied all settings — Paste (⇧⌘V) to apply.",
    );
    onClose();
  };

  return (
    <Dialog
      open
      onClose={onClose}
      title={mode === "sync" ? "Synchronize Settings" : "Copy Settings"}
      width={300}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={checked.size === 0} onClick={apply}>
            {mode === "sync" ? "Synchronize" : "Copy"}
          </Button>
        </>
      }
    >
      <div className="gal-copysettings">
        <div className="gal-copysettings-all">
          <Button variant="ghost" size="sm" onClick={() => setAll(true)}>Check All</Button>
          <Button variant="ghost" size="sm" onClick={() => setAll(false)}>Check None</Button>
        </div>
        {PANELS.map((p) => (
          <Checkbox key={p.key} checked={checked.has(p.key)} onChange={() => toggle(p.key)}>
            {p.label}
          </Checkbox>
        ))}
      </div>
    </Dialog>
  );
}
