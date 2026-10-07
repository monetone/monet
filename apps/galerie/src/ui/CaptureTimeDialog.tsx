// CaptureTimeDialog — Lightroom's Metadata ▸ Edit Capture Time, minimal form:
// a native datetime-local field (local timezone, like LR) seeded from the
// photo's current capture instant. Clearing the field sets "unknown".

import { Button, Dialog } from "@monet-ui/monet-react";
import { useState } from "react";

import type { PhotoRow } from "../catalog/types";
import { epochToLocalInput, localInputToEpoch } from "../lib/captureTime";
import { store } from "../state/store";

export function CaptureTimeDialog({ photo, onClose }: { photo: PhotoRow; onClose: () => void }) {
  const [value, setValue] = useState(
    photo.captureTime != null ? epochToLocalInput(photo.captureTime) : "",
  );
  const parsed = value === "" ? null : localInputToEpoch(value);
  const invalid = value !== "" && parsed == null;
  return (
    <Dialog
      open
      onClose={onClose}
      title="Edit Capture Time"
      width={360}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={invalid}
            onClick={() => {
              void store.setCaptureTime(photo.id, parsed);
              onClose();
            }}
          >
            Change
          </Button>
        </>
      }
    >
      <div className="gal-modal-msg">
        <label style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <span>Capture time (local) — leave empty for unknown</span>
          <input
            type="datetime-local"
            value={value}
            onChange={(e) => setValue(e.target.value)}
          />
        </label>
      </div>
    </Dialog>
  );
}
