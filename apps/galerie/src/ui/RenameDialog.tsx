// RenameDialog — Lightroom's Library ▸ Rename Photos (F2): a filename template
// applied to the selection, with a live preview. Files rename on disk and the
// catalog repoints; the batch is one undoable step.

import { Button, Dialog, Field, Input } from "@monet-ui/monet-react";
import { useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { planRename } from "../lib/renamePlan";
import { store } from "../state/store";

const baseOf = (p: string): string => p.slice(Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")) + 1);

export function RenameDialog({ photos, onClose }: { photos: PhotoRow[]; onClose: () => void }) {
  const [template, setTemplate] = useState("{name}");
  const [customText, setCustomText] = useState("");
  const [startNumber, setStartNumber] = useState(1);
  const steps = planRename(photos, template, customText, startNumber);
  return (
    <Dialog
      open
      onClose={onClose}
      title={`Rename ${photos.length} Photo${photos.length === 1 ? "" : "s"}`}
      width={440}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={steps.length === 0}
            onClick={() => {
              void store.renamePhotos(steps);
              onClose();
            }}
          >
            Rename
          </Button>
        </>
      }
    >
      <Field label="Template" hint="Tokens: {name} {customtext} {sequence} {sequence:3} {copyname}">
        {(p) => <Input {...p} block value={template} onChange={(e) => setTemplate(e.target.value)} />}
      </Field>
      <Field label="Custom Text">
        {(p) => (
          <Input {...p} block value={customText} onChange={(e) => setCustomText(e.target.value)} />
        )}
      </Field>
      <Field label="Start Number">
        {(p) => (
          <Input
            {...p}
            type="number"
            value={startNumber}
            onChange={(e) => setStartNumber(Math.max(0, Number(e.target.value) || 0))}
          />
        )}
      </Field>
      <div className="gal-modal-msg">
        {steps.length === 0
          ? "Nothing to rename — the template yields the current names."
          : `${baseOf(steps[0].from)} → ${baseOf(steps[0].to)}` +
            (steps.length > 1 ? ` (and ${steps.length - 1} more)` : "")}
      </div>
    </Dialog>
  );
}
