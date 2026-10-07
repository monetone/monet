// LabelSetDialog — Lightroom's Metadata ▸ Color Label Set editor, minimal form:
// rename what each of the five label colors means. Blank entries revert to the
// color's own name.

import { Button, Dialog, Field, Input } from "@monet-ui/monet-react";
import { useState } from "react";

import {
  DEFAULT_LABEL_NAMES,
  LABEL_COLORS_ORDER,
  labelNames,
  saveLabelNames,
  type LabelColor,
} from "../lib/labelSet";

export function LabelSetDialog({ onClose }: { onClose: () => void }) {
  const [names, setNames] = useState<Record<LabelColor, string>>({ ...labelNames() });
  return (
    <Dialog
      open
      onClose={onClose}
      title="Color Label Set"
      width={360}
      footer={
        <>
          <Button variant="ghost" onClick={() => setNames({ ...DEFAULT_LABEL_NAMES })}>
            Reset
          </Button>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              saveLabelNames(names);
              onClose();
            }}
          >
            Save
          </Button>
        </>
      }
    >
      {LABEL_COLORS_ORDER.map((c) => (
        <Field key={c} label={c[0].toUpperCase() + c.slice(1)}>
          {(p) => (
            <Input
              {...p}
              block
              value={names[c]}
              onChange={(e) => setNames((n) => ({ ...n, [c]: e.target.value }))}
            />
          )}
        </Field>
      ))}
    </Dialog>
  );
}
